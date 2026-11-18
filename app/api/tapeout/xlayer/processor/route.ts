const RPC_ENDPOINTS = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"] as const;
const CHAIN_ID = "0xc4";
const FACTORY = "0x1f09daefa827f02cbb40967cc91b259763760761";
const CPU_AT = "0x4bc7cbbd";
const NAME = "0x06fdde03";
const OWNER_OF = "0x6352211e";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const HISTORY_BLOCKS = BigInt(20000);
const LOG_CHUNK_BLOCKS = BigInt(100);
type Rpc<T> = { result?: T; error?: { message?: string; code?: number } };
async function rpc<T>(endpoint: string, method: string, params: unknown[], id: number): Promise<T> {
  const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), cache: "no-store", signal: AbortSignal.timeout(12000) });
  const raw = await response.text();
  if (!response.ok) throw new Error("RPC " + method + " returned HTTP " + response.status + (raw ? ": " + raw.slice(0, 180) : ""));
  let data: Rpc<T>;
  try { data = JSON.parse(raw) as Rpc<T>; } catch { throw new Error("RPC " + method + " returned invalid JSON."); }
  if (data.error) throw new Error("RPC " + method + " failed (" + (data.error.code ?? "unknown") + "): " + (data.error.message || "request rejected"));
  if (data.result === undefined) throw new Error("RPC " + method + " returned no result.");
  return data.result;
}
function decodeAddress(value: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("Invalid address returned by contract.");
  return "0x" + value.slice(-40);
}
function decodeString(value: string): string {
  try {
    const offset = Number(BigInt("0x" + value.slice(2, 66)));
    const lengthStart = 2 + offset * 2;
    const length = Number(BigInt("0x" + value.slice(lengthStart, lengthStart + 64)));
    if (!Number.isSafeInteger(length) || length < 0 || length > 256) return "";
    const hex = value.slice(lengthStart + 64, lengthStart + 64 + length * 2);
    return new TextDecoder().decode(Uint8Array.from(hex.match(/.{2}/g) ?? [], byte => parseInt(byte, 16)));
  } catch { return ""; }
}
type TransferLog = { topics: string[]; blockNumber: string; transactionHash: string; logIndex: string };
async function readTransferLogs(endpoint: string, address: string, fromBlock: bigint, toBlock: bigint, tokenId: string | null) {
  const topics: (string | null)[] = [TRANSFER_TOPIC, null, null];
  if (tokenId !== null) topics.push("0x" + BigInt(tokenId).toString(16).padStart(64, "0"));
  const all: TransferLog[] = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_BLOCKS) {
    const end = start + LOG_CHUNK_BLOCKS - BigInt(1) > toBlock ? toBlock : start + LOG_CHUNK_BLOCKS - BigInt(1);
    const logs = await rpc<TransferLog[]>(endpoint, "eth_getLogs", [{
      address, fromBlock: "0x" + start.toString(16), toBlock: "0x" + end.toString(16), topics
    }], 5);
    all.push(...logs);
  }
  return all;
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  const number = Number(url.searchParams.get("processorNumber"));
  const address = url.searchParams.get("address") ?? "";
  const tokenId = url.searchParams.get("tokenId");
  if (!Number.isSafeInteger(number) || number < 0 || !/^0x[a-fA-F0-9]{40}$/.test(address)) return Response.json({ ok: false, error: "A valid processor number and address are required." }, { status: 400 });
  if (tokenId !== null && (!/^\d+$/.test(tokenId) || BigInt(tokenId) < BigInt(1) || BigInt(tokenId) >= (BigInt(1) << BigInt(256)))) return Response.json({ ok: false, error: "Token ID must be a positive uint256." }, { status: 400 });
  let lastError = "X Layer RPC is unavailable.";
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const chainId = await rpc<string>(endpoint, "eth_chainId", [], 1);
      if (chainId.toLowerCase() !== CHAIN_ID) throw new Error("RPC chain ID mismatch.");
      const blockHex = await rpc<string>(endpoint, "eth_blockNumber", [], 2);
      const block = BigInt(blockHex);
      const index = BigInt(number).toString(16).padStart(64, "0");
      const registered = decodeAddress(await rpc<string>(endpoint, "eth_call", [{ to: FACTORY, data: CPU_AT + index }, "latest"], 3));
      if (registered.toLowerCase() !== address.toLowerCase()) return Response.json({ ok: false, error: "That address does not match this processor number in the live factory registry." }, { status: 404 });
      const nameHex = await rpc<string>(endpoint, "eth_call", [{ to: address, data: NAME }, "latest"], 4).catch(() => "0x");
      const fromBlock = block > HISTORY_BLOCKS ? block - HISTORY_BLOCKS : BigInt(0);
      const logs = await readTransferLogs(endpoint, address, fromBlock, block, tokenId);
      const transfers = logs.filter(log => log.topics.length >= 4).slice(-30).reverse().map(log => ({
        from: decodeAddress(log.topics[1]), to: decodeAddress(log.topics[2]), tokenId: BigInt(log.topics[3]).toString(),
        blockNumber: BigInt(log.blockNumber).toString(), transactionHash: log.transactionHash, logIndex: Number(BigInt(log.logIndex))
      }));
      let token: { tokenId: string; owner: string } | null = null;
      if (tokenId !== null) {
        const encoded = BigInt(tokenId).toString(16).padStart(64, "0");
        const ownerHex = await rpc<string>(endpoint, "eth_call", [{ to: address, data: OWNER_OF + encoded }, "latest"], 6);
        token = { tokenId, owner: decodeAddress(ownerHex) };
      }
      return Response.json({ ok: true, processorNumber: number, address, name: decodeString(nameHex), blockNumber: block.toString(), token, transfers,
        historyNote: "Transfer events are shown only for blocks " + fromBlock.toString() + "–" + block.toString() + " (latest 20,000 blocks, queried in 100-block batches). Older events may exist. This is recent ERC-721 transfer activity, not a complete audited ownership record.",
        rpcEndpoint: endpoint }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) { lastError = error instanceof Error ? error.message : "Unknown RPC error"; }
  }
  return Response.json({ ok: false, error: lastError }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
