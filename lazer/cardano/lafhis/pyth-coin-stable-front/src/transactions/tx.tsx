import { HermesClient } from "@pythnetwork/hermes-client";
import {
  MeshTxBuilder,
  applyParamsToScript,
  mConStr0,
  mConStr1,
  resolvePaymentKeyHash,
  resolveScriptHash,
  resolveSlotNo,
  serializePlutusScript,
} from "@meshsdk/core";
import { bech32 } from "bech32";

const DEFAULT_FEED_A = 16; // ADA/USD

type TxInputRef = {
  txHash: string;
  outputIndex: number;
};

type UtxoLike = {
  input: TxInputRef;
};

type ProviderLike = {
  fetchTxInfo?: (txHash: string) => Promise<unknown>;
};

type WalletLike = {
  signTx: (unsignedTx: string, partialSign?: boolean, returnFullTx?: boolean) => Promise<string>;
  submitTx: (signedTx: string) => Promise<string>;
};

type PlutusValidator = {
  title: string;
  compiledCode: string;
};

type PlutusJson = {
  validators: PlutusValidator[];
};

export type DepositAParams = {
  provider: ProviderLike;
  wallet: WalletLike;
  utxos: UtxoLike[];
  playerOneAddress: string;
  playerPkh?: string;
  backendPkh: string;
  pythPolicyId: string;
  plutus: PlutusJson;
  feedA?: number;
  bet_lovelace: number;
  network?: "preprod" | "preview" | "mainnet";
  networkId?: 0 | 1;
};

export type DepositAResult = {
  partiallySignedTx: string; // user-signed CBOR, backend still needs to co-sign
  duelId: string;
  scriptAddress: string;
  spendScriptHash: string;
  mintPolicyId: string;
};

export type DepositBParams = {
  provider: ProviderLike;
  wallet: WalletLike;
  utxos: UtxoLike[];
  playerTwoAddress: string;
  playerTwoPkh?: string;
  playerOnePkh: string;
  depositATxHash: string;
  depositATxIndex: number;
  duelId: string;
  backendPkh: string;
  pythPolicyId: string;
  blockfrostId: string;
  priceFeedIdA: string;
  priceFeedIdB: string;
  plutus: PlutusJson;
  feedA: number;
  feedB: number;
  bet_lovelace: number;
  duelDuration: number;
  network?: "preprod" | "preview" | "mainnet";
  networkId?: 0 | 1;
};

export type DepositBResult = {
  partiallySignedTx: string; // user-signed CBOR, backend still needs to co-sign
  deadlinePosix: number;
  startPriceA: number;
  startPriceB: number;
  scriptAddress: string;
  spendScriptHash: string;
  mintPolicyId: string;
};

const cborBytesParam = (hex: string) => {
  const len = hex.length / 2;
  if (len < 24) return (0x40 | len).toString(16).padStart(2, "0") + hex;
  if (len < 256) return "58" + len.toString(16).padStart(2, "0") + hex;
  return (
    "59" +
    (len >> 8).toString(16).padStart(2, "0") +
    (len & 0xff).toString(16).padStart(2, "0") +
    hex
  );
};

const someD = (inner: unknown) => mConStr0([inner as never]);
const noneD = () => mConStr1([]);

const playerD = ({
  pkh,
  feedId,
  startPrice,
}: {
  pkh: string;
  feedId: number;
  startPrice: number | null;
}) => mConStr0([pkh, feedId, startPrice != null ? someD(startPrice) : noneD()]);

const duelDatumD = ({
  duelId,
  playerA,
  playerB,
  betLovelace,
  statusIdx = 0,
  deadline = null,
}: {
  duelId: string;
  playerA: { pkh: string; feedId: number; startPrice: number | null };
  playerB?: { pkh: string; feedId: number; startPrice: number | null } | null;
  betLovelace: number;
  statusIdx?: number;
  deadline?: number | null;
}) =>
  mConStr0([
    duelId,
    playerD(playerA),
    playerB ? someD(playerD(playerB)) : noneD(),
    betLovelace,
    statusIdx === 0 ? mConStr0([]) : mConStr1([]),
    deadline != null ? someD(deadline) : noneD(),
  ]);

const outputRefD = (txHash: string, index: number) => mConStr0([txHash, index]);

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex length");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function u64beBytes(value: number): Uint8Array {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(value));
  return new Uint8Array(view.buffer);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const data = new Uint8Array(bytes.byteLength);
  data.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

async function computeDuelId(txHash: string, outputIndex: number): Promise<string> {
  const txHashBytes = hexToBytes(txHash);
  const indexBytes = u64beBytes(outputIndex);
  return sha256Hex(concatBytes(txHashBytes, indexBytes));
}

function getCompiledCode(plutus: PlutusJson, title: string): string {
  const code = plutus.validators.find((v) => v.title === title)?.compiledCode;
  if (!code) throw new Error(`Missing compiled code for validator title: ${title}`);
  return code;
}

function deriveBetScripts({
  backendPkh,
  pythPolicyId,
  plutus,
  networkId,
}: {
  backendPkh: string;
  pythPolicyId: string;
  plutus: PlutusJson;
  networkId: 0 | 1;
}) {
  const nftCompiledCode = getCompiledCode(plutus, "nft.nft_policy.mint");
  const betCompiledCode = getCompiledCode(plutus, "validators.bet.spend");

  const mintScriptCbor = applyParamsToScript(
    nftCompiledCode,
    [cborBytesParam(backendPkh)],
    "CBOR",
  );
  const mintPolicyId = resolveScriptHash(mintScriptCbor, "V3");

  const spendScriptCbor = applyParamsToScript(
    betCompiledCode,
    [
      cborBytesParam(backendPkh),
      cborBytesParam(mintPolicyId),
      cborBytesParam(pythPolicyId),
    ],
    "CBOR",
  );
  const spendScriptHash = resolveScriptHash(spendScriptCbor, "V3");
  const scriptAddress = serializePlutusScript(
    { code: spendScriptCbor, version: "V3" },
    undefined,
    networkId,
    false,
  ).address;

  return {
    mintScriptCbor,
    mintPolicyId,
    spendScriptCbor,
    spendScriptHash,
    scriptAddress,
  };
}

function requiredString(name: string, value: string): string {
  if (!value || !value.trim()) throw new Error(`Missing required value: ${name}`);
  return value.trim();
}

function requiredNumber(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function utf8ToHex(value: string): string {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function scriptHashToRewardAddress(hash: string, networkId = 0): string {
  const header = networkId === 0 ? 0xf0 : 0xf1;
  const bytes = new Uint8Array(1 + hash.length / 2);
  bytes[0] = header;
  bytes.set(hexToBytes(hash), 1);
  return bech32.encode(networkId === 0 ? "stake_test" : "stake", bech32.toWords(bytes), 200);
}

function getBlockfrostBaseUrl(network: "preprod" | "preview" | "mainnet"): string {
  if (network === "mainnet") return "https://cardano-mainnet.blockfrost.io/api/v0";
  if (network === "preview") return "https://cardano-preview.blockfrost.io/api/v0";
  return "https://cardano-preprod.blockfrost.io/api/v0";
}

async function resolvePythState({
  blockfrostId,
  pythPolicyId,
  network,
}: {
  blockfrostId: string;
  pythPolicyId: string;
  network: "preprod" | "preview" | "mainnet";
}) {
  const base = getBlockfrostBaseUrl(network);
  const headers = { project_id: blockfrostId };
  const unit = pythPolicyId + utf8ToHex("Pyth State");

  const addrRes = await fetch(`${base}/assets/${unit}/addresses`, { headers });
  if (!addrRes.ok) throw new Error(`Pyth state lookup failed: ${await addrRes.text()}`);
  const addresses = (await addrRes.json()) as Array<{ address: string }>;
  if (!addresses[0]?.address) throw new Error("Pyth state address not found");

  const utxoRes = await fetch(`${base}/addresses/${addresses[0].address}/utxos/${unit}`, { headers });
  if (!utxoRes.ok) throw new Error(`Pyth UTxO lookup failed: ${await utxoRes.text()}`);
  const utxos = (await utxoRes.json()) as Array<{ tx_hash: string; output_index: number; data_hash?: string }>;
  const stateUtxo = utxos[0];
  if (!stateUtxo) throw new Error("Pyth state UTxO not found");

  let datum: unknown;
  if (stateUtxo.data_hash) {
    const datumRes = await fetch(`${base}/scripts/datum/${stateUtxo.data_hash}`, { headers });
    if (datumRes.ok) {
      const payload = (await datumRes.json()) as { json_value?: unknown };
      datum = payload.json_value;
    }
  }
  if (!datum) {
    const txRes = await fetch(`${base}/txs/${stateUtxo.tx_hash}/utxos`, { headers });
    if (!txRes.ok) throw new Error(`Pyth tx lookup failed: ${await txRes.text()}`);
    const txPayload = (await txRes.json()) as {
      outputs?: Array<{ output_index: number; inline_datum?: unknown }>;
    };
    datum = txPayload.outputs?.find((output) => output.output_index === stateUtxo.output_index)?.inline_datum;
  }
  if (!datum || typeof datum !== "object") throw new Error("Pyth datum not found");

  const fields = (datum as { fields?: Array<{ bytes?: string }>; constructor?: { fields?: Array<{ bytes?: string }> } })
    .fields ??
    (datum as { constructor?: { fields?: Array<{ bytes?: string }> } }).constructor?.fields;
  if (!fields || fields.length < 4 || !fields[3]?.bytes) {
    throw new Error("Unexpected Pyth datum shape");
  }

  const withdrawScriptHash = fields[3].bytes;
  const scriptRes = await fetch(`${base}/scripts/${withdrawScriptHash}/cbor`, { headers });
  if (!scriptRes.ok) throw new Error(`Pyth script CBOR lookup failed: ${await scriptRes.text()}`);
  const scriptPayload = (await scriptRes.json()) as { cbor?: string };
  if (!scriptPayload.cbor) throw new Error("Missing Pyth script CBOR");

  return {
    txHash: stateUtxo.tx_hash,
    txIndex: stateUtxo.output_index,
    withdrawScriptHash,
    scriptSize: scriptPayload.cbor.length / 2,
  };
}

async function fetchSignedPrices({
  priceFeedIds,
}: {
  priceFeedIds: [string, string];
}) {
  const client = new HermesClient("https://hermes.pyth.network", {});
  const response = await client.getLatestPriceUpdates(priceFeedIds, {
    encoding: "hex",
    parsed: true,
  });

  if (!response.binary.data[0]) throw new Error("Missing signed Pyth payload");

  return {
    signedUpdateHex: response.binary.data[0],
    parsedPrices: (response.parsed ?? []).map((feed: {
      id: string;
      price: { price: string; expo: number };
    }) => ({
      priceFeedId: feed.id,
      price: Number(feed.price.price),
      exponent: Number(feed.price.expo),
    })),
  };
}

export async function depositA({
  provider,
  wallet,
  utxos,
  playerOneAddress,
  playerPkh,
  backendPkh,
  pythPolicyId,
  plutus,
  feedA = DEFAULT_FEED_A,
  bet_lovelace,
  network = "preprod",
  networkId = 0,
}: DepositAParams): Promise<DepositAResult> {
  if (!utxos.length) {
    throw new Error("No UTxOs available in wallet");
  }

  const sanitizedBackendPkh = requiredString("backendPkh", backendPkh);
  const sanitizedPythPolicyId = requiredString("pythPolicyId", pythPolicyId);
  const sanitizedAddress = requiredString("playerOneAddress", playerOneAddress);
  const sanitizedPlayerPkh =
    playerPkh?.trim() && playerPkh.trim().length > 0
      ? playerPkh.trim()
      : resolvePaymentKeyHash(sanitizedAddress);
  if (!Number.isFinite(bet_lovelace) || bet_lovelace <= 0) {
    throw new Error("bet_lovelace must be a positive number");
  }
  const finalBetLovelace = bet_lovelace;

  const { mintScriptCbor, mintPolicyId, spendScriptHash, scriptAddress } = deriveBetScripts({
    backendPkh: sanitizedBackendPkh,
    pythPolicyId: sanitizedPythPolicyId,
    plutus,
    networkId,
  });

  const seed = utxos[0].input;
  const collateral = utxos[1]?.input ?? seed;
  const duelId = await computeDuelId(seed.txHash, seed.outputIndex);

  const datum = duelDatumD({
    duelId,
    playerA: { pkh: sanitizedPlayerPkh, feedId: feedA, startPrice: null },
    betLovelace: finalBetLovelace,
  });

  const mintRedeemer = mConStr0([outputRefD(seed.txHash, seed.outputIndex)]);

  const nowSlot = resolveSlotNo(network, Date.now());

  let tx = new MeshTxBuilder({ fetcher: provider as never, submitter: provider as never });
  tx = tx.invalidBefore(Number(nowSlot) - 600);
  tx = tx.invalidHereafter(Number(nowSlot) + 600);
  tx = tx.txInCollateral(collateral.txHash, collateral.outputIndex);
  tx = tx.txIn(seed.txHash, seed.outputIndex);
  tx = tx.mintPlutusScriptV3();
  tx = tx.mint("1", mintPolicyId, duelId);
  tx = tx.mintingScript(mintScriptCbor);
  tx = tx.mintRedeemerValue(mintRedeemer);
  tx = tx.requiredSignerHash(sanitizedBackendPkh); // backend must co-sign for the NFT mint policy
  tx = tx.txOut(scriptAddress, [
    { unit: "lovelace", quantity: String(finalBetLovelace) },
    { unit: mintPolicyId + duelId, quantity: "1" },
  ]);
  tx = tx.txOutInlineDatumValue(datum);
  tx = tx.changeAddress(sanitizedAddress);
  tx = tx.selectUtxosFrom(utxos as never);

  console.log("[depositA] building tx...");
  const unsigned = await tx.complete();
  console.log("[depositA] tx built, requesting wallet signature (partial)...");
  // partialSign=true: user signs their inputs; backend still needs to co-sign for the NFT mint
  const partiallySignedTx = await wallet.signTx(unsigned, true);
  console.log("[depositA] wallet signed OK, returning to frontend for backend co-sign...");

  return {
    partiallySignedTx,
    duelId,
    scriptAddress,
    spendScriptHash,
    mintPolicyId,
  };
}

export async function depositB({
  provider,
  wallet,
  utxos,
  playerTwoAddress,
  playerTwoPkh,
  playerOnePkh,
  depositATxHash,
  depositATxIndex,
  duelId,
  backendPkh,
  pythPolicyId,
  blockfrostId,
  priceFeedIdA,
  priceFeedIdB,
  plutus,
  feedA,
  feedB,
  bet_lovelace,
  duelDuration,
  network = "preprod",
  networkId = 0,
}: DepositBParams): Promise<DepositBResult> {
  if (!utxos.length) {
    throw new Error("No UTxOs available in wallet");
  }

  const sanitizedBackendPkh = requiredString("backendPkh", backendPkh);
  const sanitizedPythPolicyId = requiredString("pythPolicyId", pythPolicyId);
  const sanitizedBlockfrostId = requiredString("blockfrostId", blockfrostId);
  const sanitizedPriceFeedIdA = requiredString("priceFeedIdA", priceFeedIdA);
  const sanitizedPriceFeedIdB = requiredString("priceFeedIdB", priceFeedIdB);
  const sanitizedPlayerOnePkh = requiredString("playerOnePkh", playerOnePkh);
  const sanitizedPlayerTwoAddress = requiredString("playerTwoAddress", playerTwoAddress);
  const sanitizedPlayerTwoPkh =
    playerTwoPkh?.trim() && playerTwoPkh.trim().length > 0
      ? playerTwoPkh.trim()
      : resolvePaymentKeyHash(sanitizedPlayerTwoAddress);
  const sanitizedDepositATxHash = requiredString("depositATxHash", depositATxHash);
  requiredString("duelId", duelId);
  requiredNumber("feedA", feedA);
  requiredNumber("feedB", feedB);
  const finalBetLovelace = requiredNumber("bet_lovelace", bet_lovelace);
  const finalDuelDuration = requiredNumber("duelDuration", duelDuration);

  const { mintPolicyId, spendScriptCbor, spendScriptHash, scriptAddress } = deriveBetScripts({
    backendPkh: sanitizedBackendPkh,
    pythPolicyId: sanitizedPythPolicyId,
    plutus,
    networkId,
  });

  const pythState = await resolvePythState({
    blockfrostId: sanitizedBlockfrostId,
    pythPolicyId: sanitizedPythPolicyId,
    network,
  });
  const pythRewardAddress = scriptHashToRewardAddress(pythState.withdrawScriptHash, networkId);

  const { signedUpdateHex, parsedPrices } = await fetchSignedPrices({
    priceFeedIds: [sanitizedPriceFeedIdA, sanitizedPriceFeedIdB],
  });
  const priceA = parsedPrices.find((price: { priceFeedId: string }) => price.priceFeedId === sanitizedPriceFeedIdA);
  const priceB = parsedPrices.find((price: { priceFeedId: string }) => price.priceFeedId === sanitizedPriceFeedIdB);
  if (!priceA || !priceB) {
    throw new Error("Missing starting prices for one or more feeds");
  }

  const startPriceA = priceA.price;
  const startPriceB = priceB.price;
  const deadlinePosix = Date.now() + finalDuelDuration;
  const totalPot = finalBetLovelace * 2;

  const newDatum = duelDatumD({
    duelId,
    playerA: { pkh: sanitizedPlayerOnePkh, feedId: feedA, startPrice: startPriceA },
    playerB: { pkh: sanitizedPlayerTwoPkh, feedId: feedB, startPrice: startPriceB },
    betLovelace: finalBetLovelace,
    statusIdx: 1,
    deadline: deadlinePosix,
  });

  const joinRedeemer = mConStr0([sanitizedPlayerTwoPkh, feedB]);
  const collateral = utxos[0].input;
  const nowSlot = resolveSlotNo(network, Date.now());

  let tx = new MeshTxBuilder({ fetcher: provider as never, submitter: provider as never });
  tx = tx.invalidBefore(Number(nowSlot) - 600);
  tx = tx.invalidHereafter(Number(nowSlot) + 600);
  tx = tx.txInCollateral(collateral.txHash, collateral.outputIndex);
  tx = tx.requiredSignerHash(sanitizedBackendPkh);
  tx = tx.withdrawalPlutusScriptV3();
  tx = tx.withdrawal(pythRewardAddress, "0");
  tx = tx.withdrawalTxInReference(
    pythState.txHash,
    pythState.txIndex,
    String(pythState.scriptSize),
    pythState.withdrawScriptHash,
  );
  tx = tx.withdrawalRedeemerValue(mConStr0([signedUpdateHex]));
  tx = tx.spendingPlutusScriptV3();
  tx = tx.txIn(sanitizedDepositATxHash, depositATxIndex);
  tx = tx.txInInlineDatumPresent();
  tx = tx.txInRedeemerValue(joinRedeemer);
  tx = tx.txInScript(spendScriptCbor);
  tx = tx.txOut(scriptAddress, [
    { unit: "lovelace", quantity: String(totalPot) },
    { unit: mintPolicyId + duelId, quantity: "1" },
  ]);
  tx = tx.txOutInlineDatumValue(newDatum);
  tx = tx.changeAddress(sanitizedPlayerTwoAddress);
  tx = tx.selectUtxosFrom(utxos as never);

  console.log("[depositB] building tx...");
  const unsigned = await tx.complete();
  console.log("[depositB] tx built, requesting wallet signature (partial)...");
  const partiallySignedTx = await wallet.signTx(unsigned, true);
  console.log("[depositB] wallet signed OK, returning to frontend for backend co-sign...");

  return {
    partiallySignedTx,
    deadlinePosix,
    startPriceA,
    startPriceB,
    scriptAddress,
    spendScriptHash,
    mintPolicyId,
  };
}
