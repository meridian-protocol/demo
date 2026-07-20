"use client";

import { useCallback, useEffect, useState } from "react";
import {
  bytesToHex,
  createWalletClient,
  custom,
  defineChain,
  formatUnits,
  type WalletClient,
} from "viem";
import { NETWORK, type PaymentRequirements } from "@/lib/protected-demo";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    callback: (...args: unknown[]) => void,
  ) => void;
};

type ChallengeResponse = {
  x402Version: number;
  error?: string;
  accepts: PaymentRequirements[];
};

type PaidResponse = {
  success: boolean;
  message?: string;
  error?: string;
  content?: Record<string, unknown>;
  settlement?: Record<string, unknown>;
};

const baseSepolia = defineChain({
  id: NETWORK.chainId,
  name: NETWORK.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [...NETWORK.rpcUrls] },
    public: { http: [...NETWORK.rpcUrls] },
  },
  blockExplorers: {
    default: { name: "Basescan", url: NETWORK.explorerUrl },
  },
});

function getEthereum(): Eip1193Provider | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as Window & { ethereum?: Eip1193Provider }).ethereum;
}

export default function ProtectedPage() {
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [client, setClient] = useState<WalletClient | null>(null);
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [result, setResult] = useState<PaidResponse | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const requirement = challenge?.accepts.find(
    (entry) => entry.network === NETWORK.id,
  );

  const refreshWalletState = useCallback(async () => {
    const ethereum = getEthereum();
    if (!ethereum) {
      setError("No EVM wallet provider found.");
      return;
    }

    const accounts = (await ethereum.request({
      method: "eth_accounts",
    })) as string[];

    if (accounts.length === 0) {
      setAccount(null);
      setClient(null);
      setChainId(null);
      return;
    }

    const chainIdHex = (await ethereum.request({
      method: "eth_chainId",
    })) as string;
    const nextChainId = Number.parseInt(chainIdHex, 16);
    const nextAccount = accounts[0] as `0x${string}`;

    setAccount(nextAccount);
    setChainId(nextChainId);
    setClient(
      createWalletClient({
        account: nextAccount,
        chain: baseSepolia,
        transport: custom(ethereum),
      }),
    );
  }, []);

  useEffect(() => {
    // Preview the seller challenge on load; the pay flow re-fetches it.
    fetch("/api/protected", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: ChallengeResponse) => setChallenge(body))
      .catch(() => setError("Failed to load payment requirements."));
    void refreshWalletState();
  }, [refreshWalletState]);

  useEffect(() => {
    const ethereum = getEthereum();
    if (!ethereum?.on) {
      return;
    }

    const handleChange = () => {
      void refreshWalletState();
    };

    ethereum.on("accountsChanged", handleChange);
    ethereum.on("chainChanged", handleChange);

    return () => {
      ethereum.removeListener?.("accountsChanged", handleChange);
      ethereum.removeListener?.("chainChanged", handleChange);
    };
  }, [refreshWalletState]);

  const connectWallet = async () => {
    const ethereum = getEthereum();
    if (!ethereum) {
      setError("No EVM wallet provider found.");
      return;
    }

    setError("");
    await ethereum.request({ method: "eth_requestAccounts" });
    await refreshWalletState();
  };

  const switchToBaseSepolia = async () => {
    const ethereum = getEthereum();
    if (!ethereum) {
      setError("No EVM wallet provider found.");
      return;
    }

    const chainIdHex = `0x${NETWORK.chainId.toString(16)}`;

    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } catch (switchError) {
      const code =
        typeof switchError === "object" &&
        switchError !== null &&
        "code" in switchError
          ? (switchError as { code?: number }).code
          : undefined;

      if (code !== 4902) {
        throw switchError;
      }

      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainIdHex,
            chainName: NETWORK.name,
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [...NETWORK.rpcUrls],
            blockExplorerUrls: [NETWORK.explorerUrl],
          },
        ],
      });
    }

    await refreshWalletState();
  };

  // Sign the EIP-3009 TransferWithAuthorization as typed data and resubmit
  // the request with the signed payload — the flow from the Quickstart docs.
  const payAndRetry = async (
    selected: PaymentRequirements,
    walletClient: WalletClient,
    buyer: `0x${string}`,
  ): Promise<PaidResponse> => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const authorization = {
      from: buyer,
      to: selected.payTo as `0x${string}`,
      value: BigInt(selected.maxAmountRequired),
      validAfter: BigInt(0),
      validBefore: now + BigInt(selected.maxTimeoutSeconds),
      nonce: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
    };

    const signature = await walletClient.signTypedData({
      account: buyer,
      domain: {
        name: selected.extra?.name ?? "USD Coin",
        version: selected.extra?.version ?? "2",
        chainId: NETWORK.chainId,
        verifyingContract: selected.asset as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: authorization,
    });

    const paymentPayload = {
      x402Version: 1,
      scheme: "exact",
      network: selected.network,
      payload: {
        signature,
        authorization: {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value.toString(),
          validAfter: authorization.validAfter.toString(),
          validBefore: authorization.validBefore.toString(),
          nonce: authorization.nonce,
        },
      },
    };

    const response = await fetch("/api/protected", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentPayload }),
    });

    const body = (await response.json()) as PaidResponse & {
      error?: string;
    };

    if (!response.ok || !body.success) {
      throw new Error(body.error ?? "Payment was rejected");
    }

    return body;
  };

  const requestResource = async () => {
    setError("");
    setResult(null);

    if (!client || !account) {
      await connectWallet();
      return;
    }

    if (chainId !== NETWORK.chainId) {
      setError(`Switch your wallet to ${NETWORK.name} first.`);
      return;
    }

    setIsLoading(true);

    try {
      setStatus("Requesting protected resource");
      const response = await fetch("/api/protected", { cache: "no-store" });

      if (response.status !== 402) {
        throw new Error(`Expected a 402 challenge, got ${response.status}`);
      }

      const latestChallenge = (await response.json()) as ChallengeResponse;
      setChallenge(latestChallenge);

      const selected = latestChallenge.accepts.find(
        (entry) => entry.network === NETWORK.id,
      );
      if (!selected) {
        throw new Error(`No ${NETWORK.name} payment requirement in accepts`);
      }

      setStatus("Signing EIP-3009 authorization");
      const paid = await payAndRetry(selected, client, account);

      setResult(paid);
      setStatus("Payment settled");
    } catch (payError) {
      setError(
        payError instanceof Error ? payError.message : "Payment failed.",
      );
      setStatus("");
    } finally {
      setIsLoading(false);
    }
  };

  const onCorrectChain = chainId === NETWORK.chainId;

  return (
    <main className="min-h-[calc(100vh-3.5rem)] px-6 py-10 text-[var(--foreground)] xl:min-h-[calc(100vh-4rem)]">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="font-funnel-display text-sm font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
            Developer demo
          </p>
          <h1 className="font-funnel-display text-3xl font-semibold tracking-tight md:text-5xl">
            Same-chain x402 payment
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-[var(--text-secondary)] md:text-base">
            The seller endpoint returns a 402 challenge for {NETWORK.name}. The
            browser signs one EIP-3009 authorization with viem and resubmits
            the request; the server settles it through Meridian. No transaction
            is submitted by the buyer and no gas is paid.
          </p>
        </header>

        <section className="rounded-2xl bg-[var(--card-bg)] p-5">
          <h2 className="font-funnel-display text-lg font-medium">Wallet</h2>
          <div className="mt-4 space-y-2 text-sm text-[var(--text-secondary)]">
            <p>
              Account:{" "}
              <span className="font-mono text-[var(--foreground)]">
                {account
                  ? `${account.slice(0, 6)}...${account.slice(-4)}`
                  : "Not connected"}
              </span>
            </p>
            <p>
              Network:{" "}
              <span className="text-[var(--foreground)]">
                {chainId === null
                  ? "No network detected"
                  : onCorrectChain
                    ? NETWORK.name
                    : `Chain ${chainId} (switch to ${NETWORK.name})`}
              </span>
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={connectWallet}
              className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)]"
            >
              {account ? "Refresh wallet" : "Connect wallet"}
            </button>
            {account && !onCorrectChain ? (
              <button
                type="button"
                onClick={switchToBaseSepolia}
                className="rounded-xl bg-[var(--input-bg)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--pay-section-bg)]"
              >
                Switch to {NETWORK.name}
              </button>
            ) : null}
            <button
              type="button"
              onClick={requestResource}
              disabled={isLoading || !account || !onCorrectChain}
              className="rounded-xl bg-[var(--input-bg)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--pay-section-bg)] disabled:cursor-not-allowed disabled:bg-[var(--pay-primary-disabled-bg)] disabled:text-[var(--text-muted)]"
            >
              {isLoading ? "Processing" : "Request protected resource"}
            </button>
          </div>
        </section>

        <section className="rounded-2xl bg-[var(--card-bg)] p-5">
          <h2 className="font-funnel-display text-lg font-medium">Seller `accepts`</h2>
          {requirement ? (
            <div className="mt-4 space-y-2 text-sm text-[var(--text-secondary)]">
              <p>
                Price:{" "}
                <span className="text-[var(--foreground)]">
                  {formatUnits(BigInt(requirement.maxAmountRequired), 6)} USDC
                </span>
              </p>
              <p>
                Asset:{" "}
                <span className="font-mono text-xs text-[var(--foreground)]">
                  {requirement.asset}
                </span>
              </p>
              <p>
                Pay to (facilitator):{" "}
                <span className="font-mono text-xs text-[var(--foreground)]">
                  {requirement.payTo}
                </span>
              </p>
              <p>
                Network: <span className="text-[var(--foreground)]">{requirement.network}</span>
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--text-secondary)]">Loading challenge…</p>
          )}
          <p className="mt-4 text-xs leading-5 text-[var(--text-muted)]">
            Test USDC on {NETWORK.name} is available from Circle&apos;s faucet
            (faucet.circle.com). `payTo` targets the Meridian facilitator, not
            the merchant wallet — the payout recipient is configured in
            organization settings.
          </p>
        </section>

        {(status || error || result) && (
          <section className="rounded-2xl bg-[var(--pay-section-bg)] p-5">
            <h2 className="font-funnel-display text-lg font-medium">Result</h2>
            {status ? (
              <p className="mt-3 text-sm text-[var(--pay-receipt-title)]">{status}</p>
            ) : null}
            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            {result ? (
              <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-[var(--input-bg)] p-4 text-xs text-[var(--foreground)]">
                {JSON.stringify(result, null, 2)}
              </pre>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
