const RPC_ENDPOINTS = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"] as const;
const FACTORY = "0x1f09daefa827f02cbb40967cc91b259763760761";
const CHAIN_ID = "0xc4";
const CPU_COUNT = "0x4c9c8ce5";
const CPU_AT = "0x4bc7cbbd";

async function rpc<T>(endpoint: string, method: string, params: unknown[], id: number): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("X Layer RPC returned HTTP " + response.status);
  const payload = await response.json() as { result?: T; error?: { message?: string } };
  if (payload.error || payload.result === undefined) throw new Error(payload.error?.message || "X Layer RPC returned no result.");
  return payload.result;
}

function wordAddress(value: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("Invalid processor address returned by factory.");
  return "0x" + value.slice(-40);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const limit = Math.min(25, Math.max(1, Number(url.searchParams.get("limit") || 25)));
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(limit)) {
    return Response.json({ ok: false, error: "Invalid pagination parameters." }, { status: 400 });
  }

  let lastError = "X Layer RPC is unavailable.";
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const [chainId, blockHex, countHex] = await Promise.all([
        rpc<string>(endpoint, "eth_chainId", [], 1),
        rpc<string>(endpoint, "eth_blockNumber", [], 2),
        rpc<string>(endpoint, "eth_call", [{ to: FACTORY, data: CPU_COUNT }, "latest"], 3)
      ]);
      if (chainId.toLowerCase() !== CHAIN_ID) throw new Error("Connected RPC is not X Layer.");
      const total = BigInt(countHex);
      const end = Math.min(offset + limit, Number(total));
      const indexes = Array.from({ length: Math.max(0, end - offset) }, (_, i) => offset + i);
      const processors = await Promise.all(indexes.map(async (index) => {
        const encoded = BigInt(index).toString(16).padStart(64, "0");
        const result = await rpc<string>(endpoint, "eth_call", [{ to: FACTORY, data: CPU_AT + encoded }, "latest"], 10 + index);
        return { processorNumber: index, address: wordAddress(result) };
      }));
      return Response.json({
        ok: true,
        network: "X Layer",
        chainId: 196,
        blockNumber: BigInt(blockHex).toString(),
        processorCount: total.toString(),
        offset,
        limit,
        processors,
        hasMore: end < Number(total),
        factory: FACTORY,
        rpcEndpoint: endpoint,
        checkedAt: new Date().toISOString(),
        sourceStatus: "live"
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown X Layer RPC error.";
    }
  }
  return Response.json({ ok: false, network: "X Layer", chainId: 196, sourceStatus: "unavailable", error: lastError }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
