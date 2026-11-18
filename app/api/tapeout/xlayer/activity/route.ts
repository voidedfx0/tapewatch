const RPC_ENDPOINTS = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"] as const;
const FACTORY = "0x1f09daefa827f02cbb40967cc91b259763760761";
const CHAIN_ID = "0xc4";
const LOOKBACK_BLOCKS = BigInt(1000);
const MAX_EVENTS = 20;

async function rpc<T>(endpoint: string, method: string, params: unknown[], id: number): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("X Layer RPC returned HTTP " + response.status);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error || payload.result === undefined) throw new Error(payload.error?.message || "X Layer RPC returned no result.");
  return payload.result;
}

type RawLog = { blockNumber: string; transactionHash: string; logIndex: string; topics: string[]; data: string };

export async function GET() {
  let lastError = "X Layer RPC is unavailable.";
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const chainId = await rpc<string>(endpoint, "eth_chainId", [], 1);
      if (chainId.toLowerCase() !== CHAIN_ID) throw new Error("Connected RPC is not X Layer.");
      const blockHex = await rpc<string>(endpoint, "eth_blockNumber", [], 2);
      const latestBlock = BigInt(blockHex);
      const fromBlock = latestBlock > LOOKBACK_BLOCKS ? latestBlock - LOOKBACK_BLOCKS : BigInt(0);
      const logs = await rpc<RawLog[]>(endpoint, "eth_getLogs", [{
        address: FACTORY,
        fromBlock: "0x" + fromBlock.toString(16),
        toBlock: "0x" + latestBlock.toString(16),
      }], 3);
      const recent = logs.slice(-MAX_EVENTS).reverse();
      const blockNumbers = [...new Set(recent.map((log) => log.blockNumber))];
      const blocks = await Promise.all(blockNumbers.map(async (block, index) => {
        const value = await rpc<{ timestamp: string } | null>(endpoint, "eth_getBlockByNumber", [block, false], 10 + index);
        return [block, value?.timestamp ? new Date(Number(BigInt(value.timestamp)) * 1000).toISOString() : null] as const;
      }));
      const timestamps = new Map(blocks);
      const events = recent.map((log) => ({
        blockNumber: BigInt(log.blockNumber).toString(),
        at: timestamps.get(log.blockNumber) ?? null,
        transactionHash: log.transactionHash,
        logIndex: Number(BigInt(log.logIndex)),
        topic0: log.topics[0] ?? "No event signature",
        topicsCount: log.topics.length,
        dataBytes: Math.max(0, (log.data.length - 2) / 2),
      }));
      return Response.json({
        ok: true,
        network: "X Layer",
        chainId: 196,
        factory: FACTORY,
        blockNumber: latestBlock.toString(),
        windowFromBlock: fromBlock.toString(),
        windowToBlock: latestBlock.toString(),
        events,
        checkedAt: new Date().toISOString(),
        historyNote: "These are raw logs emitted by the TapeOut factory in the latest 1,000-block window. They are network-wide observations, not evidence linked to a selected website. Event names are not inferred from unknown signatures.",
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown X Layer RPC error.";
    }
  }
  return Response.json({ ok: false, network: "X Layer", chainId: 196, events: [], error: lastError }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
