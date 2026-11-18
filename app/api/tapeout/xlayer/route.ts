const X_LAYER_RPC_ENDPOINTS = [
  "https://rpc.xlayer.tech",
  "https://xlayerrpc.okx.com",
] as const;

const X_LAYER_CHAIN_ID = "0xc4";
const TAPEOUT_FACTORY = "0x1f09daefa827f02cbb40967cc91b259763760761";
const CPU_COUNT_SELECTOR = "0xa94da8a7";
const CPU_AT_SELECTOR = "0x4bc7cbbd";
const MAX_PROCESSORS_TO_RETURN = 12;

type RpcResult<T> = { jsonrpc: "2.0"; id: number; result?: T; error?: { message?: string } };

async function rpc<T>(endpoint: string, method: string, params: unknown[], id: number): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
  const payload = (await response.json()) as RpcResult<T>;
  if (payload.error) throw new Error(payload.error.message || "RPC request failed");
  if (payload.result === undefined) throw new Error("RPC response did not include a result");
  return payload.result;
}

function decodeUint(value: string): bigint {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) throw new Error("Invalid integer response from RPC");
  return BigInt(value);
}

function decodeAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("Invalid processor address response");
  return `0x${value.slice(-40)}`;
}

export async function GET() {
  let lastError = "No X Layer RPC endpoint responded.";
  for (const endpoint of X_LAYER_RPC_ENDPOINTS) {
    try {
      const chainId = await rpc<string>(endpoint, "eth_chainId", [], 1);
      if (chainId.toLowerCase() !== X_LAYER_CHAIN_ID) {
        throw new Error(`RPC chain ID mismatch: expected 196, received ${chainId}`);
      }

      const [blockHex, countHex] = await Promise.all([
        rpc<string>(endpoint, "eth_blockNumber", [], 2),
        rpc<string>(endpoint, "eth_call", [{ to: TAPEOUT_FACTORY, data: CPU_COUNT_SELECTOR }, "latest"], 3),
      ]);
      const processorCount = decodeUint(countHex);
      const blockNumber = decodeUint(blockHex);
      const visibleCount = Number(processorCount > BigInt(MAX_PROCESSORS_TO_RETURN) ? BigInt(MAX_PROCESSORS_TO_RETURN) : processorCount);

      const processors = await Promise.all(
        Array.from({ length: visibleCount }, async (_, index) => {
          const encodedIndex = BigInt(index).toString(16).padStart(64, "0");
          const result = await rpc<string>(
            endpoint,
            "eth_call",
            [{ to: TAPEOUT_FACTORY, data: CPU_AT_SELECTOR + encodedIndex }, "latest"],
            10 + index,
          );
          return { processorNumber: index, address: decodeAddress(result) };
        }),
      );

      return Response.json({
        ok: true,
        network: "X Layer",
        chainId: 196,
        blockNumber: blockNumber.toString(),
        processorCount: processorCount.toString(),
        processors,
        truncated: processorCount > BigInt(visibleCount),
        factory: TAPEOUT_FACTORY,
        rpcEndpoint: endpoint,
        checkedAt: new Date().toISOString(),
        sourceStatus: "Factory address is listed in TapeOut TAP-10, a draft specification. TapeWatch confirms the RPC chain ID and successful read-only contract calls, but does not independently audit the factory.",
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown RPC error";
    }
  }

  return Response.json({
    ok: false,
    network: "X Layer",
    chainId: 196,
    error: lastError,
    sourceStatus: "TapeOut factory reference is from the TAP-10 draft specification.",
  }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
