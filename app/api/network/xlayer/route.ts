const RPC_ENDPOINTS = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"] as const;
const EXPECTED_CHAIN_ID = "0xc4";
const RECENT_BLOCK_COUNT = 6;

type RpcResponse<T> = { result?: T; error?: { message?: string } };
type RpcBlock = {
  number?: string;
  hash?: string;
  timestamp?: string;
  transactions?: unknown[];
  gasUsed?: string;
  gasLimit?: string;
  baseFeePerGas?: string;
};

async function rpc<T>(endpoint: string, method: string, params: unknown[], id: number): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("X Layer RPC returned HTTP " + response.status);
  const payload = await response.json() as RpcResponse<T>;
  if (payload.error || payload.result === undefined) throw new Error(payload.error?.message || "X Layer RPC returned no result.");
  return payload.result;
}

function toGwei(value?: string) {
  if (!value) return null;
  return (Number(BigInt(value)) / 1e9).toFixed(4);
}

export async function GET() {
  let lastError = "X Layer public RPC is unavailable.";
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const [chainId, blockNumberHex, gasPrice, syncing] = await Promise.all([
        rpc<string>(endpoint, "eth_chainId", [], 1),
        rpc<string>(endpoint, "eth_blockNumber", [], 2),
        rpc<string>(endpoint, "eth_gasPrice", [], 3),
        rpc<boolean | Record<string, string>>(endpoint, "eth_syncing", [], 4)
      ]);
      if (chainId.toLowerCase() !== EXPECTED_CHAIN_ID) throw new Error("RPC chain ID mismatch; expected X Layer (196).");

      const latestNumber = BigInt(blockNumberHex);
      const blockNumbers = Array.from({ length: RECENT_BLOCK_COUNT }, (_, index) => latestNumber - BigInt(index))
        .filter((number) => number >= BigInt(0));
      const blocks = await Promise.all(blockNumbers.map((number, index) =>
        rpc<RpcBlock | null>(endpoint, "eth_getBlockByNumber", ["0x" + number.toString(16), false], 10 + index)
      ));
      if (blocks.some((block) => !block)) throw new Error("X Layer RPC returned an incomplete recent-block range.");
      const validBlocks = blocks as RpcBlock[];
      for (let index = 0; index < validBlocks.length; index += 1) {
        const block = validBlocks[index];
        if (!block.number || BigInt(block.number) !== blockNumbers[index]) {
          throw new Error("X Layer RPC returned a block at an unexpected height.");
        }
        if (!block.timestamp || !block.hash || !/^0x[0-9a-f]{64}$/i.test(block.hash)) {
          throw new Error("X Layer RPC returned an incomplete block header.");
        }
      }
      const latestBlock = validBlocks[0];
      if (!latestBlock) throw new Error("X Layer RPC returned no latest block.");

      const timestamps = validBlocks.map((block) => Number(BigInt(block.timestamp!)));
      const intervals = timestamps.slice(0, -1)
        .map((timestamp, index) => timestamps[index + 1] - timestamp)
        .filter((seconds) => seconds > 0);
      const averageBlockTimeSeconds = intervals.length
        ? Math.round((intervals.reduce((sum, seconds) => sum + seconds, 0) / intervals.length) * 10) / 10
        : null;

      const recentBlocks = validBlocks.map((block) => ({
        number: block.number ? BigInt(block.number).toString() : "",
        hash: block.hash ?? "",
        timestamp: block.timestamp ? BigInt(block.timestamp).toString() : "",
        transactionCount: block.transactions?.length ?? 0,
        gasUsed: block.gasUsed ? BigInt(block.gasUsed).toString() : "0",
        gasLimit: block.gasLimit ? BigInt(block.gasLimit).toString() : "0",
        baseFeeGwei: toGwei(block.baseFeePerGas)
      }));

      return Response.json({
        ok: true,
        network: "X Layer",
        chainId: 196,
        blockNumber: latestNumber.toString(),
        blockTimestamp: latestBlock.timestamp ? BigInt(latestBlock.timestamp).toString() : "",
        transactionCount: latestBlock.transactions?.length ?? 0,
        gasPriceGwei: toGwei(gasPrice),
        averageBlockTimeSeconds,
        recentBlocks,
        syncing,
        rpcEndpoint: endpoint,
        checkedAt: new Date().toISOString()
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown X Layer RPC error.";
    }
  }
  return Response.json({ ok: false, error: lastError }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
