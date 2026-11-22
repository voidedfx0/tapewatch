type IncludedToken = { id?: string; type?: string; attributes?: { address?: string; name?: string; symbol?: string; decimals?: number; image_url?: string; coingecko_coin_id?: string } };
type Pool = { id?: string; attributes?: { address?: string; name?: string; pool_created_at?: string; base_token_price_usd?: string; reserve_in_usd?: string; volume_usd?: { h24?: string }; transactions?: { h24?: { buys?: number; sells?: number } }; price_change_percentage?: { h24?: string } }; relationships?: { base_token?: { data?: { id?: string } }; quote_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } } };
const SOURCE = "https://api.geckoterminal.com/api/v2";
const NETWORK = "x-layer";
const MAX_PAGE = 10;

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const page = Math.min(MAX_PAGE, Math.max(1, Number(params.get("page") || 1)));
    const search = (params.get("search") || "").trim().slice(0, 100);
    const endpoint = search
      ? `${SOURCE}/search/pools?${new URLSearchParams({ query: search, network: NETWORK, include: "base_token,quote_token,dex", page: String(page) })}`
      : `${SOURCE}/networks/${NETWORK}/new_pools?${new URLSearchParams({ include: "base_token,quote_token,dex", page: String(page) })}`;
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json;version=20230203" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`GeckoTerminal returned HTTP ${response.status}`);
    const payload = await response.json() as { data?: Pool[]; included?: IncludedToken[] };
    const included = new Map((payload.included ?? []).filter((item) => item.type === "token" && item.attributes?.address).map((item) => [item.id ?? "", item]));
    const tokens = new Map<string, Record<string, unknown>>();
    for (const pool of payload.data ?? []) {
      const attrs = pool.attributes ?? {};
      const baseId = pool.relationships?.base_token?.data?.id ?? "";
      const quoteId = pool.relationships?.quote_token?.data?.id ?? "";
      const base = included.get(baseId);
      const quote = included.get(quoteId);
      const resolvedPoolAddress = (attrs.address && /^0x[a-fA-F0-9]{40}$/.test(attrs.address) ? attrs.address : pool.id?.match(/0x[a-fA-F0-9]{40}/)?.[0]) ?? "";
      if (!resolvedPoolAddress) continue;
      const poolDetails = {
        poolAddress: resolvedPoolAddress,
        poolName: attrs.name ?? "Liquidity pool",
        poolCreatedAt: attrs.pool_created_at ?? null,
        dex: pool.relationships?.dex?.data?.id ?? "Unknown DEX",
        liquidityUsd: attrs.reserve_in_usd ?? null,
        volume24hUsd: attrs.volume_usd?.h24 ?? null,
        buys24h: attrs.transactions?.h24?.buys ?? null,
        sells24h: attrs.transactions?.h24?.sells ?? null,
      };
      for (const [token, role] of [[base, "base"], [quote, "quote"]] as const) {
        const a = token?.attributes;
        if (!a?.address || !/^0x[a-fA-F0-9]{40}$/.test(a.address)) continue;
        const address = a.address.toLowerCase();
        const previous = tokens.get(address);
        if (!previous || (role === "base" && previous.role !== "base")) {
          tokens.set(address, {
            address: a.address,
            name: a.name ?? "Unknown token",
            symbol: a.symbol ?? "—",
            decimals: a.decimals ?? null,
            imageUrl: a.image_url ?? null,
            coingeckoId: a.coingecko_coin_id ?? null,
            role,
            ...poolDetails,
            priceChange24h: role === "base" ? (attrs.price_change_percentage?.h24 ?? null) : null,
            priceUsd: role === "base" ? (attrs.base_token_price_usd ?? null) : null,
          });
        }
      }
    }
    return Response.json({
      ok: true,
      network: "X Layer",
      chainId: 196,
      source: "GeckoTerminal",
      sourceUrl: "https://www.geckoterminal.com/x-layer/pools",
      scope: search
        ? "Matching tokens from GeckoTerminal's indexed X Layer pool search. Results depend on the provider's search index and are not a complete list of deployed contracts or exchange listings."
        : "Tokens appearing in newly indexed X Layer liquidity pools. Browse up to 10 provider pages; this is not a complete list of deployed contracts or exchange listings.",
      search: search || null,
      page,
      maxPage: search ? 1 : MAX_PAGE,
      tokens: [...tokens.values()],
      poolCount: (payload.data ?? []).length,
      checkedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return Response.json({
      ok: false,
      network: "X Layer",
      source: "GeckoTerminal",
      error: error instanceof Error ? error.message : "Token discovery source is unavailable.",
      checkedAt: new Date().toISOString(),
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
