type IncludedToken = { id?: string; type?: string; attributes?: { address?: string; name?: string; symbol?: string; decimals?: number; image_url?: string; coingecko_coin_id?: string } };
type Pool = {
  id?: string;
  attributes?: {
    address?: string; name?: string; pool_created_at?: string; base_token_price_usd?: string; reserve_in_usd?: string;
    volume_usd?: { h24?: string }; transactions?: { h24?: { buys?: number; sells?: number } };
    price_change_percentage?: { h24?: string };
  };
  relationships?: {
    base_token?: { data?: { id?: string } }; quote_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } };
  };
};
const SOURCE = "https://api.geckoterminal.com/api/v2";
const NETWORKS = {
  xlayer: { slug: "x-layer", name: "X Layer", chainId: 196, family: "evm", explorer: "https://www.okx.com/web3/explorer/xlayer", enabled: true },
  ethereum: { slug: "eth", name: "Ethereum", chainId: 1, family: "evm", explorer: "https://etherscan.io", enabled: true },
  bnb: { slug: "bsc", name: "BNB Chain", chainId: 56, family: "evm", explorer: "https://bscscan.com", enabled: true },
  solana: { slug: "solana", name: "Solana", chainId: null, family: "solana", explorer: "https://solscan.io", enabled: true },
} as const;
const MAX_PAGE = 10;
export async function GET(request: Request, context: { params: Promise<{ network: string }> }) {
  const { network } = await context.params;
  const config = NETWORKS[network as keyof typeof NETWORKS];
  if (!config) return Response.json({ ok: false, error: "Unsupported network." }, { status: 404 });
  try {
    const params = new URL(request.url).searchParams;
    const page = Math.min(MAX_PAGE, Math.max(1, Number(params.get("page") || 1)));
    const search = (params.get("search") || "").trim().slice(0, 100);
    const endpoint = search
      ? `${SOURCE}/search/pools?${new URLSearchParams({ query: search, network: config.slug, include: "base_token,quote_token,dex", page: String(page) })}`
      : `${SOURCE}/networks/${config.slug}/new_pools?${new URLSearchParams({ include: "base_token,quote_token,dex", page: String(page) })}`;
    const response = await fetch(endpoint, { headers: { Accept: "application/json;version=20230203" }, cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`GeckoTerminal returned HTTP ${response.status}`);
    const payload = await response.json() as { data?: Pool[]; included?: IncludedToken[] };
    const included = new Map((payload.included ?? []).filter((item) => item.type === "token" && item.attributes?.address).map((item) => [item.id ?? "", item]));
    const tokens = new Map<string, Record<string, unknown>>();
    for (const pool of payload.data ?? []) {
      const attrs = pool.attributes ?? {};
      const base = included.get(pool.relationships?.base_token?.data?.id ?? "");
      const quote = included.get(pool.relationships?.quote_token?.data?.id ?? "");
      const poolAddress = attrs.address ?? pool.id?.split("_").slice(1).join("_") ?? "";
      if (!poolAddress) continue;
      const poolDetails = {
        poolAddress, poolName: attrs.name ?? "Liquidity pool", poolCreatedAt: attrs.pool_created_at ?? null,
        dex: pool.relationships?.dex?.data?.id ?? "Unknown DEX", liquidityUsd: attrs.reserve_in_usd ?? null,
        volume24hUsd: attrs.volume_usd?.h24 ?? null, buys24h: attrs.transactions?.h24?.buys ?? null, sells24h: attrs.transactions?.h24?.sells ?? null,
      };
      for (const [token, role] of [[base, "base"], [quote, "quote"]] as const) {
        const a = token?.attributes;
        if (!a?.address) continue;
        const address = a.address;
        const key = address.toLowerCase();
        const previous = tokens.get(key);
        if (!previous || (role === "base" && previous.role !== "base")) {
          tokens.set(key, {
            address, name: a.name ?? "Unknown token", symbol: a.symbol ?? "—", decimals: a.decimals ?? null,
            imageUrl: a.image_url ?? null, coingeckoId: a.coingecko_coin_id ?? null, role, ...poolDetails,
            priceChange24h: role === "base" ? (attrs.price_change_percentage?.h24 ?? null) : null,
            priceUsd: role === "base" ? (attrs.base_token_price_usd ?? null) : null,
          });
        }
      }
    }
    return Response.json({
      ok: true, network: config.name, networkKey: network, chainId: config.chainId, family: config.family,
      explorer: config.explorer, source: "GeckoTerminal", sourceUrl: `https://www.geckoterminal.com/${config.slug}/pools`,
      scope: search
        ? `Matching tokens from GeckoTerminal's indexed ${config.name} pool search. This is not a complete list of deployed contracts or exchange listings.`
        : `Tokens appearing in newly indexed ${config.name} liquidity pools. This is not a complete list of deployed contracts or exchange listings.`,
      search: search || null, page, maxPage: search ? 1 : MAX_PAGE, tokens: [...tokens.values()],
      poolCount: (payload.data ?? []).length, checkedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return Response.json({ ok: false, network: config.name, source: "GeckoTerminal", error: error instanceof Error ? error.message : "Token discovery source is unavailable.", checkedAt: new Date().toISOString() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
