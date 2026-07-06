"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createWalletClient,
  custom,
  formatUnits,
  type Chain,
  type WalletClient,
} from "viem";
import {
  createPaymentHeader,
  parsePaymentRequirements,
  selectPaymentRequirements,
  type PaymentRequirements,
} from "@/lib/x402";
import {
  CROSS_CHAIN_DEMO_NETWORKS,
  CROSS_CHAIN_DEMO_SOURCE_NETWORKS,
  CROSS_CHAIN_DESTINATION_CHAIN_ID,
  getCrossChainDemoChain,
  getCrossChainDemoNetworkByChainId,
  type CrossChainDemoNetwork,
} from "@/lib/cross-chain-demo";

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

type PaymentResult = {
  success: boolean;
  message?: string;
  error?: string;
  selectedRoute?: {
    sourceNetwork: string;
    destinationChainId?: number;
  };
  settlement?: {
    success: boolean;
    transaction: string;
    network: string;
    payer?: string;
    errorReason?: string;
  };
};

function getEthereum(): Eip1193Provider | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return (window as Window & { ethereum?: Eip1193Provider }).ethereum;
}

function usdcAmount(amount: string): string {
  return formatUnits(BigInt(amount), 6);
}

function getPaymentRouteLabel(requirement: PaymentRequirements): string {
  const source = CROSS_CHAIN_DEMO_NETWORKS[
    requirement.network as CrossChainDemoNetwork
  ];

  return source ? `${source.name} -> Base` : requirement.network;
}

async function readJsonResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const text = await response.text();

  if (!text) {
    throw new Error(`${fallbackMessage} (${response.status})`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${fallbackMessage} (${response.status})`);
  }
}

export default function CrossChainPage() {
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [chain, setChain] = useState<Chain | null>(null);
  const [client, setClient] = useState<WalletClient | null>(null);
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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
      setChain(null);
      return;
    }

    const chainIdHex = (await ethereum.request({
      method: "eth_chainId",
    })) as string;
    const chainId = Number.parseInt(chainIdHex, 16);
    const nextChain = getCrossChainDemoChain(chainId);
    const nextAccount = accounts[0] as `0x${string}`;

    setAccount(nextAccount);
    setChain(nextChain);
    setClient(
      createWalletClient({
        account: nextAccount,
        chain: nextChain,
        transport: custom(ethereum),
      }),
    );
  }, []);

  const loadChallenge = useCallback(async () => {
    const response = await fetch("/api/cross-chain", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const body = await readJsonResponse<ChallengeResponse>(
      response,
      "Payment requirement request returned an invalid response",
    );
    const accepts = body.accepts.map((entry) =>
      parsePaymentRequirements(entry),
    );

    setChallenge({ ...body, accepts });
    return { ...body, accepts };
  }, []);

  useEffect(() => {
    void loadChallenge().catch((loadError) => {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load payment requirements.",
      );
    });
    void refreshWalletState();
  }, [loadChallenge, refreshWalletState]);

  useEffect(() => {
    const ethereum = getEthereum();
    if (!ethereum?.on) {
      return;
    }

    const handleAccountsChanged = () => {
      void refreshWalletState();
    };
    const handleChainChanged = () => {
      void refreshWalletState();
    };

    ethereum.on("accountsChanged", handleAccountsChanged);
    ethereum.on("chainChanged", handleChainChanged);

    return () => {
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [refreshWalletState]);

  const connectedNetwork = useMemo(() => {
    if (!chain) {
      return undefined;
    }

    return getCrossChainDemoNetworkByChainId(chain.id)?.network;
  }, [chain]);

  const selectedPaymentRequirements = useMemo(() => {
    if (!challenge || !connectedNetwork) {
      return undefined;
    }

    return selectPaymentRequirements(challenge.accepts, connectedNetwork);
  }, [challenge, connectedNetwork]);

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

  const switchToSource = async (network: CrossChainDemoNetwork) => {
    const ethereum = getEthereum();
    if (!ethereum) {
      setError("No EVM wallet provider found.");
      return;
    }

    const source = CROSS_CHAIN_DEMO_NETWORKS[network];
    const chainIdHex = `0x${source.chainId.toString(16)}`;

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
            chainName: source.name,
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [...source.rpcUrls],
            blockExplorerUrls: [source.explorerUrl],
          },
        ],
      });
    }

    await refreshWalletState();
  };

  const pay = async () => {
    setError("");
    setResult(null);

    if (!client || !account) {
      await connectWallet();
      return;
    }

    setIsLoading(true);

    try {
      setStatus("Loading seller payment requirements");
      const latestChallenge = await loadChallenge();
      const walletNetwork = chain
        ? getCrossChainDemoNetworkByChainId(chain.id)?.network
        : undefined;

      if (!chain || !walletNetwork) {
        throw new Error("Connected wallet is on an unsupported network.");
      }

      const selected = selectPaymentRequirements(
        latestChallenge.accepts,
        walletNetwork,
      );

      if (!selected) {
        throw new Error(
          `No payment route is available for ${chain.name ?? walletNetwork}.`,
        );
      }

      setStatus(`Signing ${getPaymentRouteLabel(selected)} payment`);
      const paymentHeader = await createPaymentHeader(
        client,
        latestChallenge.x402Version,
        selected,
        chain.id,
      );

      setStatus("Requesting paid resource");
      const response = await fetch("/api/cross-chain", {
        headers: {
          Accept: "application/json",
          "X-PAYMENT": paymentHeader,
        },
        cache: "no-store",
      });

      const body = await readJsonResponse<PaymentResult>(
        response,
        "Payment request returned an invalid response",
      );
      setResult(body);

      if (!response.ok || !body.success) {
        throw new Error(body.error ?? "Payment failed.");
      }

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

  const connectedDemoNetwork = chain
    ? getCrossChainDemoNetworkByChainId(chain.id)
    : undefined;

  return (
    <main className="min-h-screen bg-[#0f1115] px-6 py-10 text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-300">
            Meridian developer demo
          </p>
          <h1 className="text-3xl font-semibold tracking-normal md:text-5xl">
            Cross-chain x402 payments
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
            The seller endpoint returns several source-chain payment
            requirements. The browser selects the route for the connected
            wallet chain and signs one EIP-3009 authorization.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-lg font-medium">Wallet</h2>
            <div className="mt-4 space-y-2 text-sm text-slate-300">
              <p>
                Account:{" "}
                <span className="font-mono text-white">
                  {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Not connected"}
                </span>
              </p>
              <p>
                Network:{" "}
                <span className="text-white">
                  {chain?.name ?? "No network detected"}
                </span>
              </p>
              <p>
                Selected route:{" "}
                <span className="text-white">
                  {selectedPaymentRequirements
                    ? getPaymentRouteLabel(selectedPaymentRequirements)
                    : connectedDemoNetwork
                      ? "Loading route"
                      : "Unsupported source chain"}
                </span>
              </p>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={connectWallet}
                className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-300"
              >
                {account ? "Refresh wallet" : "Connect wallet"}
              </button>
              <button
                type="button"
                onClick={pay}
                disabled={isLoading || !selectedPaymentRequirements}
                className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-600 disabled:text-slate-300"
              >
                {isLoading ? "Processing" : "Pay selected route"}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-lg font-medium">Source Chains</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              {CROSS_CHAIN_DEMO_SOURCE_NETWORKS.map((network) => {
                const source = CROSS_CHAIN_DEMO_NETWORKS[network];
                const isConnected = chain?.id === source.chainId;

                return (
                  <button
                    key={network}
                    type="button"
                    onClick={() => switchToSource(network)}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      isConnected
                        ? "border-emerald-300 bg-emerald-300 text-slate-950"
                        : "border-white/10 bg-slate-900 text-slate-200 hover:border-white/30"
                    }`}
                  >
                    {source.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Destination chain: Base ({CROSS_CHAIN_DESTINATION_CHAIN_ID}).
              Cross-chain routes use Across exact-input settlement.
            </p>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-medium">Seller `accepts`</h2>
            <button
              type="button"
              onClick={() => loadChallenge()}
              className="rounded-md border border-white/10 px-3 py-2 text-sm text-slate-200 hover:border-white/30"
            >
              Refresh
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="border-b border-white/10 py-2 pr-4 font-medium">
                    Source
                  </th>
                  <th className="border-b border-white/10 py-2 pr-4 font-medium">
                    Amount
                  </th>
                  <th className="border-b border-white/10 py-2 pr-4 font-medium">
                    Asset
                  </th>
                  <th className="border-b border-white/10 py-2 pr-4 font-medium">
                    Destination
                  </th>
                </tr>
              </thead>
              <tbody>
                {(challenge?.accepts ?? []).map((requirement) => (
                  <tr key={requirement.network}>
                    <td className="border-b border-white/10 py-3 pr-4">
                      {getPaymentRouteLabel(requirement)}
                    </td>
                    <td className="border-b border-white/10 py-3 pr-4">
                      {usdcAmount(requirement.maxAmountRequired)} USDC
                    </td>
                    <td className="border-b border-white/10 py-3 pr-4 font-mono text-xs text-slate-300">
                      {requirement.asset}
                    </td>
                    <td className="border-b border-white/10 py-3 pr-4">
                      Base ({String(requirement.extra?.destinationChainId)})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {(status || error || result) && (
          <section className="rounded-lg border border-white/10 bg-slate-950 p-5">
            <h2 className="text-lg font-medium">Result</h2>
            {status ? <p className="mt-3 text-sm text-emerald-300">{status}</p> : null}
            {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
            {result ? (
              <pre className="mt-4 max-h-80 overflow-auto rounded-md bg-black p-4 text-xs text-slate-200">
                {JSON.stringify(result, null, 2)}
              </pre>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
