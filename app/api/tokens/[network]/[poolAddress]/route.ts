type GeckoTrade = { id?: string; attributes?: { block_timestamp?: string; kind?: string; tx_hash?: string; tx_from_address?: string; from_token_amount?: string; to_token_amount?: string; price_from_in_usd?: string; price_to_in_usd?: string; volume_in_usd?: string } };
const GECKO = "https://api.geckoterminal.com/api/v2";
const headers = { Accept: "application/json;version=20230203" };
const NETWORKS = {
  xlayer: { slug: "x-layer", rpc: "https://rpc.xlayer.tech", family: "evm", explorer: "https://www.okx.com/web3/explorer/xlayer" },
  ethereum: { slug: "eth", rpc: "https://ethereum-rpc.publicnode.com", family: "evm", explorer: "https://etherscan.io" },
  bnb: { slug: "bsc", rpc: "https://bsc-rpc.publicnode.com", family: "evm", explorer: "https://bscscan.com" },
  solana: { slug: "solana", rpc: "https://api.mainnet-beta.solana.com", family: "solana", explorer: "https://solscan.io" },
} as const;
const chartRanges: Record<string, { timeframe: "minute" | "hour" | "day"; aggregate: number; limit: number; label: string }> = {
  "1H": { timeframe: "minute", aggregate: 1, limit: 60, label: "1 hour · 1-minute candles" },
  "24H": { timeframe: "minute", aggregate: 5, limit: 288, label: "24 hours · 5-minute candles" },
  "7D": { timeframe: "hour", aggregate: 1, limit: 168, label: "7 days · hourly candles" },
  "30D": { timeframe: "hour", aggregate: 4, limit: 180, label: "30 days · 4-hour candles" },
  "90D": { timeframe: "day", aggregate: 1, limit: 90, label: "90 days · daily candles" },
  "6M": { timeframe: "day", aggregate: 1, limit: 180, label: "Up to 6 months · daily candles" },
};

export async function GET(request: Request, context: { params: Promise<{ network: string; poolAddress: string }> }) {
  const { network, poolAddress } = await context.params;
  const config = NETWORKS[network as keyof typeof NETWORKS];
  if (!config) return Response.json({ ok: false, error: "Unsupported network." }, { status: 404 });
  if (!poolAddress || poolAddress.length > 100) return Response.json({ ok: false, error: "Invalid pool or account address." }, { status: 400 });
  const params = new URL(request.url).searchParams;
  const view = params.get("view") ?? "activity";
  const side = params.get("side") === "quote" ? "quote" : "base";
  const rpcCall = async (method: string, rpcParams: unknown[]) => {
    const response = await fetch(config.rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: rpcParams }), cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(network + " RPC returned HTTP " + response.status);
    const data = await response.json() as { result?: any; error?: { message?: string } };
    if (data.error) throw new Error(data.error.message ?? "RPC request failed.");
    return data.result;
  };
  try {
    if (view === "contract") {
      if (config.family === "solana") {
        const result = await rpcCall("getAccountInfo", [poolAddress, { encoding: "jsonParsed", commitment: "confirmed" }]);
        const account = result?.value;
        return Response.json({ ok: true, address: poolAddress, isContract: Boolean(account), bytecodeBytes: null, accountType: account?.data?.program ?? (account?.executable ? "Executable program" : "Solana account"), owner: account?.owner ?? null, executable: account?.executable ?? null, sourceVerification: "Not checked; account existence is not a safety or authority assessment", checkedAt: new Date().toISOString(), source: "Solana mainnet RPC" }, { headers: { "Cache-Control": "no-store" } });
      }
      if (!/^0x[a-fA-F0-9]{40}$/.test(poolAddress)) return Response.json({ ok: false, error: "Invalid EVM address." }, { status: 400 });
      const code = await rpcCall("eth_getCode", [poolAddress, "latest"]) as string;
      return Response.json({ ok: true, address: poolAddress, isContract: code !== "0x" && code !== "0x0", bytecodeBytes: Math.max(0, (code.length - 2) / 2), accountType: "EVM contract bytecode", sourceVerification: "Not checked by this endpoint", checkedAt: new Date().toISOString(), source: network + " public RPC" }, { headers: { "Cache-Control": "no-store" } });
    }
    if (view === "ohlcv") {
      const rangeKey = params.get("range") ?? "7D";
      const range = chartRanges[rangeKey] ?? chartRanges["7D"];
      const requestedInterval = params.get("interval") === "5m" ? "5m" : "1m";
      const shortRange = rangeKey === "1H" || rangeKey === "24H";
      const aggregate = shortRange ? (requestedInterval === "5m" ? 5 : 1) : range.aggregate;
      const limit = shortRange ? (rangeKey === "1H" ? (requestedInterval === "5m" ? 12 : 60) : 288) : range.limit;
      const timeframe = shortRange ? "minute" : range.timeframe;
      const label = shortRange ? rangeKey + " · " + aggregate + "-minute candles" : range.label;
      const url = GECKO + "/networks/" + config.slug + "/pools/" + encodeURIComponent(poolAddress) + "/ohlcv/" + timeframe + "?" + new URLSearchParams({ aggregate: String(aggregate), limit: String(limit), currency: "usd", token: side });
      const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("Market history source returned HTTP " + response.status);
      const data = await response.json() as { data?: { attributes?: { ohlcv_list?: number[][] } } };
      const candles = (data.data?.attributes?.ohlcv_list ?? []).map((row) => ({ time: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5] })).reverse();
      return Response.json({ ok: true, candles, range: rangeKey, interval: label, source: "GeckoTerminal", network, checkedAt: new Date().toISOString(), freshness: "Provider-indexed OHLC candles; public market data can be cached and is not a tick-by-tick stream." }, { headers: { "Cache-Control": "no-store" } });
    }
    const url = GECKO + "/networks/" + config.slug + "/pools/" + encodeURIComponent(poolAddress) + "/trades";
    const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("Trade feed returned HTTP " + response.status);
    const data = await response.json() as { data?: GeckoTrade[] };
    const trades = (data.data ?? []).slice(0, 30).map((trade) => {
      const a = trade.attributes ?? {};
      return { id: trade.id ?? a.tx_hash ?? "", timestamp: a.block_timestamp ?? null, side: side === "quote" ? (a.kind === "buy" ? "sell" : a.kind === "sell" ? "buy" : a.kind ?? "unknown") : (a.kind ?? "unknown"), hash: a.tx_hash ?? "", wallet: a.tx_from_address ?? "", fromAmount: a.from_token_amount ?? null, toAmount: a.to_token_amount ?? null, priceUsd: a.price_to_in_usd ?? a.price_from_in_usd ?? null, volumeUsd: a.volume_in_usd ?? null };
    });
    return Response.json({ ok: true, trades, source: "GeckoTerminal", network, checkedAt: new Date().toISOString(), freshness: "Provider-indexed trades; upstream indexing and caching may delay new transactions." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ ok: false, network, error: error instanceof Error ? error.message : "Intelligence data unavailable.", checkedAt: new Date().toISOString() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
