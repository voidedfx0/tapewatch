type GeckoTrade = { id?: string; attributes?: { block_timestamp?: string; kind?: string; tx_hash?: string; tx_from_address?: string; from_token_amount?: string; to_token_amount?: string; price_from_in_usd?: string; price_to_in_usd?: string; volume_in_usd?: string } };
const GECKO = "https://api.geckoterminal.com/api/v2";
const RPC = "https://rpc.xlayer.tech";
const headers = { Accept: "application/json;version=20230203" };

export async function GET(request: Request, context: { params: Promise<{ poolAddress: string }> }) {
  const { poolAddress } = await context.params;
  if (!/^0x[a-fA-F0-9]{40}$/.test(poolAddress)) return Response.json({ ok: false, error: "Invalid pool address." }, { status: 400 });
  const view = new URL(request.url).searchParams.get("view") ?? "activity";
  try {
    if (view === "contract") {
      const response = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [poolAddress, "latest"] }), cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("X Layer RPC is unavailable.");
      const data = await response.json() as { result?: string; error?: { message?: string } };
      if (data.error) throw new Error(data.error.message ?? "Contract lookup failed.");
      const code = data.result ?? "0x";
      return Response.json({ ok: true, address: poolAddress, isContract: code !== "0x" && code !== "0x0", bytecodeBytes: Math.max(0, (code.length - 2) / 2), sourceVerification: "Not checked by this endpoint", checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
    }
    if (view === "ohlcv") {
      const url = `${GECKO}/networks/x-layer/pools/${poolAddress}/ohlcv/hour?aggregate=1&limit=48&currency=usd&token=base`;
      const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`Market history source returned HTTP ${response.status}`);
      const data = await response.json() as { data?: { attributes?: { ohlcv_list?: number[][] } } };
      const candles = (data.data?.attributes?.ohlcv_list ?? []).map((row) => ({ time: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] })).reverse();
      return Response.json({ ok: true, candles, source: "GeckoTerminal", checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
    }
    const url = `${GECKO}/networks/x-layer/pools/${poolAddress}/trades?include=`;
    const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Trade feed returned HTTP ${response.status}`);
    const data = await response.json() as { data?: GeckoTrade[] };
    const trades = (data.data ?? []).slice(0, 30).map((trade) => {
      const a = trade.attributes ?? {};
      return { id: trade.id ?? a.tx_hash ?? "", timestamp: a.block_timestamp ?? null, side: a.kind ?? "unknown", hash: a.tx_hash ?? "", wallet: a.tx_from_address ?? "", fromAmount: a.from_token_amount ?? null, toAmount: a.to_token_amount ?? null, priceUsd: a.price_to_in_usd ?? a.price_from_in_usd ?? null, volumeUsd: a.volume_in_usd ?? null };
    });
    return Response.json({ ok: true, trades, source: "GeckoTerminal", sourceUrl: "https://www.geckoterminal.com/x-layer/pools", checkedAt: new Date().toISOString(), freshness: "Provider-indexed; public API data may be cached for about one minute." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Activity data unavailable.", checkedAt: new Date().toISOString() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
