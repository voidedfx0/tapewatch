const RPC_ENDPOINTS = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"] as const;
const EXPECTED_CHAIN_ID = "0xc4";

type RpcResponse<T> = { result?: T; error?: { message?: string } };

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

export async function GET() {
  let lastError = "X Layer public RPC is unavailable.";
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const [chainId, blockNumber, gasPrice, syncing] = await Promise.all([
        rpc<string>(endpoint, "eth_chainId", [], 1),
        rpc<string>(endpoint, "eth_blockNumber", [], 2),
        rpc<string>(endpoint, "eth_gasPrice", [], 3),
        rpc<boolean | Record<string, string>>(endpoint, "eth_syncing", [], 4)
      ]);
      if (chainId.toLowerCase() !== EXPECTED_CHAIN_ID) throw new Error("RPC chain ID mismatch; expected X Layer (196).");
      const block = await rpc<{ timestamp?: string; transactions?: unknown[] } | null>(
        endpoint, "eth_getBlockByNumber", [blockNumber, false], 5
      );
      if (!block) throw new Error("X Layer RPC returned no latest block.");
      const gasWei = BigInt(gasPrice);
      const gasPriceGwei = (Number(gasWei) / 1e9).toFixed(4);
      return Response.json({
        ok: true,
        network: "X Layer",
        chainId: 196,
        blockNumber: BigInt(blockNumber).toString(),
        blockTimestamp: block.timestamp ? BigInt(block.timestamp).toString() : "",
        transactionCount: block.transactions?.length ?? 0,
        gasPriceGwei,
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
