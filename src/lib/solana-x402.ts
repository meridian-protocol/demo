// Minimal Solana x402 helpers built on @solana/web3.js and @solana/spl-token
// only — no SDK required. Payments on Solana are partially-signed transactions
// instead of EIP-3009 signatures: the buyer signs a `settle` instruction for
// Meridian's on-chain program, the facilitator co-signs as fee payer and
// broadcasts it. See https://docs.mrdn.finance for the integration guide.

import {
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Protocol types and constants
// ---------------------------------------------------------------------------

// On-chain settlement config, served by the facilitator at
// GET /v1/solana/facilitator?network=... and echoed inside the 402
// challenge's `extra` field.
export interface SolanaFacilitatorInfo {
  network: string;
  facilitator: string;
  programId: string;
  configPda: string;
  usdcMint?: string;
  treasury?: string;
  treasuryToken?: string;
  treasuryFeeBps?: number;
  paused?: boolean;
}

export const CONFIG_SEED = Uint8Array.from([99, 111, 110, 102, 105, 103]); // "config"
export const SETTLE_DISCRIMINATOR = Uint8Array.from([
  241, 208, 6, 43, 81, 61, 213, 10,
]);
export const SETTLE_IX_DATA_LEN = 66;

const ONCHAIN_CONFIG_ERROR =
  "facilitator did not return on-chain config for Solana settlement";
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const I64_MIN = -(BigInt(1) << BigInt(63));
const I64_MAX = (BigInt(1) << BigInt(63)) - BigInt(1);

export function deriveConfigPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId)[0];
}

export async function fetchSolanaFacilitatorInfo(
  baseUrl: string,
  network: string,
): Promise<SolanaFacilitatorInfo> {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const response = await fetch(
    `${normalizedBaseUrl}/v1/solana/facilitator?network=${encodeURIComponent(network)}`,
  );

  if (!response.ok) {
    throw new Error(
      `failed to fetch Solana facilitator info: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as SolanaFacilitatorInfo;
}

// ---------------------------------------------------------------------------
// Settle instruction encoding
// ---------------------------------------------------------------------------

interface SettleTransactionParams {
  info: SolanaFacilitatorInfo;
  from: PublicKey;
  recipient: PublicKey;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Uint8Array;
  recentBlockhash: string;
  platform?: PublicKey;
  platformFeeBps?: number;
}

function assertRange(value: bigint, min: bigint, max: bigint, name: string) {
  if (value < min || value > max) {
    throw new Error(`${name} is out of range`);
  }
}

function encodeSettleInstructionData({
  value,
  validAfter,
  validBefore,
  nonce,
  platformFeeBps,
}: SettleTransactionParams & { platformFeeBps: number }): Buffer {
  if (nonce.length !== 32) {
    throw new Error("nonce must be 32 bytes");
  }
  assertRange(value, BigInt(0), U64_MAX, "value");
  assertRange(validAfter, I64_MIN, I64_MAX, "validAfter");
  assertRange(validBefore, I64_MIN, I64_MAX, "validBefore");
  if (
    !Number.isInteger(platformFeeBps) ||
    platformFeeBps < 0 ||
    platformFeeBps > 65535
  ) {
    throw new Error("platformFeeBps must be a u16");
  }

  const data = Buffer.alloc(SETTLE_IX_DATA_LEN);
  data.set(SETTLE_DISCRIMINATOR, 0);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setBigUint64(8, value, true);
  view.setBigInt64(16, validAfter, true);
  view.setBigInt64(24, validBefore, true);
  data.set(nonce, 32);
  view.setUint16(64, platformFeeBps, true);
  return data;
}

// Builds the raw settle transaction for Meridian's x402 program. The
// facilitator is the fee payer; the buyer only co-signs the instruction.
function buildRawSettleTransaction(params: SettleTransactionParams): Transaction {
  const { info, from, recipient, recentBlockhash, platform } = params;
  if (!info.usdcMint || !info.treasury || !info.treasuryToken) {
    throw new Error(ONCHAIN_CONFIG_ERROR);
  }
  if (info.paused) {
    throw new Error("Solana settlement program is paused");
  }

  const payer = new PublicKey(info.facilitator);
  const programId = new PublicKey(info.programId);
  const configPda = new PublicKey(info.configPda);
  const usdcMint = new PublicKey(info.usdcMint);
  const treasuryToken = new PublicKey(info.treasuryToken);
  const platformFeeBps = params.platformFeeBps ?? 0;

  const fromToken = getAssociatedTokenAddressSync(usdcMint, from);
  const recipientToken = getAssociatedTokenAddressSync(usdcMint, recipient, true);
  const platformToken = platform
    ? getAssociatedTokenAddressSync(usdcMint, platform, true)
    : programId;

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: from, isSigner: true, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: fromToken, isSigner: false, isWritable: true },
      { pubkey: recipientToken, isSigner: false, isWritable: true },
      { pubkey: platformToken, isSigner: false, isWritable: Boolean(platform) },
      { pubkey: treasuryToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: encodeSettleInstructionData({ ...params, platformFeeBps }),
  });

  const transaction = new Transaction({
    feePayer: payer,
    recentBlockhash,
  });
  transaction.add(instruction);
  return transaction;
}

// ---------------------------------------------------------------------------
// Facilitator config
// ---------------------------------------------------------------------------

export interface FacilitatorConfig {
  info: SolanaFacilitatorInfo;
  facilitator: PublicKey;
  programId: PublicKey;
  configPda: PublicKey;
  treasury: PublicKey;
  usdcMint: PublicKey;
  treasuryToken: PublicKey;
  treasuryFeeBps: number;
  paused: boolean;
}

type FacilitatorInfoField =
  | "network"
  | "facilitator"
  | "programId"
  | "configPda"
  | "treasury"
  | "usdcMint"
  | "treasuryToken";

function requireStringField(
  info: Record<string, unknown>,
  field: FacilitatorInfoField,
): string {
  const value = info[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${ONCHAIN_CONFIG_ERROR} (${field} missing)`);
  }
  return value;
}

export function facilitatorConfigFromInfo(
  info: SolanaFacilitatorInfo,
): FacilitatorConfig {
  const fields = info as unknown as Record<string, unknown>;
  const treasuryFeeBps =
    typeof fields.treasuryFeeBps === "number" ? fields.treasuryFeeBps : 0;
  const paused = fields.paused === true;
  const network = requireStringField(fields, "network");
  const facilitator = requireStringField(fields, "facilitator");
  const programId = requireStringField(fields, "programId");
  const configPda = requireStringField(fields, "configPda");
  const treasury = requireStringField(fields, "treasury");
  const usdcMint = requireStringField(fields, "usdcMint");
  const treasuryToken = requireStringField(fields, "treasuryToken");
  const normalizedInfo: SolanaFacilitatorInfo = {
    network,
    facilitator,
    programId,
    configPda,
    treasury,
    usdcMint,
    treasuryToken,
    treasuryFeeBps,
    paused,
  };

  return {
    info: normalizedInfo,
    facilitator: new PublicKey(facilitator),
    programId: new PublicKey(programId),
    configPda: new PublicKey(configPda),
    treasury: new PublicKey(treasury),
    usdcMint: new PublicKey(usdcMint),
    treasuryToken: new PublicKey(treasuryToken),
    treasuryFeeBps,
    paused,
  };
}

export async function fetchFacilitatorConfig(
  source: SolanaFacilitatorInfo | string,
): Promise<FacilitatorConfig> {
  if (typeof source !== "string") {
    return facilitatorConfigFromInfo(source);
  }

  const response = await fetch(source, { cache: "no-store" });
  const data = (await response.json()) as SolanaFacilitatorInfo & {
    error?: string;
    errorReason?: string;
  };
  if (!response.ok || data.error) {
    throw new Error(
      data.error ??
        data.errorReason ??
        `facilitator info failed (${response.status})`,
    );
  }

  return facilitatorConfigFromInfo(data);
}

// ---------------------------------------------------------------------------
// Buyer (browser) helpers
// ---------------------------------------------------------------------------

export interface BuildSettleTxParams {
  connection: Connection;
  config: FacilitatorConfig;
  /** The paying user (connected wallet). */
  from: PublicKey;
  /** Wallet owner receiving the payment (not a token account). */
  recipient: PublicKey;
  /** Amount in USDC base units (6 decimals). */
  value: bigint;
  /** Optional platform fee destination (wallet owner). */
  platform?: PublicKey;
  platformFeeBps: number;
  /** Fee payer that co-signs server-side. */
  facilitator: PublicKey;
}

/**
 * Builds the x402 settlement transaction. The facilitator is the fee payer, and
 * all token accounts must already exist; no ATA rent is funded inside the
 * payment transaction.
 */
export async function buildSettleTransaction({
  connection,
  config,
  from,
  recipient,
  value,
  platform,
  platformFeeBps,
  facilitator,
}: BuildSettleTxParams): Promise<Transaction> {
  if (!facilitator.equals(config.facilitator)) {
    throw new Error("settle fee payer does not match facilitator info");
  }

  const mint = config.usdcMint;
  const fromToken = getAssociatedTokenAddressSync(mint, from);
  const recipientToken = getAssociatedTokenAddressSync(mint, recipient, true);
  const platformToken = platform
    ? getAssociatedTokenAddressSync(mint, platform, true)
    : null;

  await assertAssociatedTokenAccountExists(
    connection,
    fromToken,
    from,
    mint,
    "payer",
  );
  await assertAssociatedTokenAccountExists(
    connection,
    recipientToken,
    recipient,
    mint,
    "recipient",
  );
  if (platform && platformToken) {
    await assertAssociatedTokenAccountExists(
      connection,
      platformToken,
      platform,
      mint,
      "platform",
    );
  }

  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const now = Math.floor(Date.now() / 1000);
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const tx = buildRawSettleTransaction({
    info: config.info,
    from,
    recipient,
    value,
    validAfter: BigInt(0),
    validBefore: BigInt(now + 600),
    nonce,
    recentBlockhash: blockhash,
    platform,
    platformFeeBps,
  });
  tx.lastValidBlockHeight = lastValidBlockHeight;
  return tx;
}

async function assertAssociatedTokenAccountExists(
  connection: Connection,
  tokenAccount: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  label: string,
): Promise<void> {
  try {
    const account = await getAccount(connection, tokenAccount, "confirmed");
    if (!account.owner.equals(owner) || !account.mint.equals(mint)) {
      throw new Error(`${label} associated token account is invalid`);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("associated token account is invalid")
    ) {
      throw error;
    }

    throw new Error(
      `${label} USDC associated token account does not exist; create it before paying`,
    );
  }
}
