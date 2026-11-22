"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TokenActivityPanel from "./TokenActivityPanel";

type Token = {
  networkKey: string; address: string; name: string; symbol: string; decimals: number | null; imageUrl: string | null;
  coingeckoId: string | null; role: string; poolAddress: string; poolName: string;
  poolCreatedAt: string | null; dex: string; liquidityUsd: string | null; volume24hUsd: string | null;
  priceChange24h: string | null; buys24h: number | null; sells24h: number | null; priceUsd: string | null;
};
type Snapshot = { ok: boolean; network: string; networkKey?: string; chainId: number | null; family?: string; explorer?: string; source: string; scope: string; tokens: Token[]; poolCount: number; checkedAt: string; page?: number; maxPage?: number; search?: string | null; error?: string };
const EXPLORER = "https://www.okx.com/web3/explorer/xlayer";
const fmtUsd = (v: string | null) => v == null ? "—" : Number(v).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const short = (v: string) => v.slice(0, 6) + "…" + v.slice(-4);

export default function TokenIntelligenceWorkspace() {
  const [network, setNetwork] = useState("xlayer");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Token | null>(null);
  const [lastUpdated, setLastUpdated] = useState("");

  const refresh = useCallback(async (targetPage: number, query: string) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (query.length >= 2) params.set("search", query);
      const response = await fetch("/api/tokens/" + network + "?" + params.toString(), { cache: "no-store" });
      const data = await response.json() as Snapshot;
      if (!response.ok || !data.ok) throw new Error(data.error || "Token discovery is unavailable.");
      setSnapshot({ ...data, tokens: (data.tokens ?? []).map((token: Token) => ({ ...token, networkKey: network })) }); setLastUpdated(data.checkedAt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load token data for the selected network.");
    } finally { setLoading(false); }
  }, [network]);

  useEffect(() => { setPage(1); setSearch(""); }, [debouncedSearch, network]);
  useEffect(() => { void refresh(page, debouncedSearch); }, [refresh, page, debouncedSearch]);
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(page, debouncedSearch); }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh, page, debouncedSearch]);

  const tokens = useMemo(() => snapshot?.tokens ?? [], [snapshot]);
  const maxPage = snapshot?.maxPage ?? 10;
  const isWideSearch = debouncedSearch.length >= 2;
  const networkLabel = snapshot?.network ?? ({ xlayer: "X Layer", ethereum: "Ethereum", bnb: "BNB Chain", solana: "Solana" }[network] ?? network);
  return (
    <div className="content module-workspace token-workspace" id="token-intelligence">
      <div className="workspace-title-row token-workspace-heading">
        <div>
          <div className="eyebrow">MULTI-CHAIN ECOSYSTEM · TOKEN DISCOVERY</div>
          <h1>Token intelligence<span>.</span></h1>
          <p className="intro">A multi-chain intelligence workspace, starting with the live X Layer integration.</p>
        </div>
        <div className="token-workspace-actions">
          <label className="token-network-select"><span>NETWORK</span><select value={network} onChange={(event) => { setNetwork(event.target.value); setPage(1); setSelected(null); }} aria-label="Select token network"><option value="xlayer">X Layer</option><option value="ethereum">Ethereum</option><option value="bnb">BNB Chain</option><option value="solana">Solana</option></select></label>
          <button className="secondary-button" type="button" onClick={() => void refresh(page, debouncedSearch)} disabled={loading}>{loading ? "Refreshing…" : "Refresh tokens"}</button>
        </div>
      </div>
      <div className="token-network-roadmap" role="status"><span className="token-network-live-dot" /><div><strong>{networkLabel} is selected</strong><p>Discovery uses GeckoTerminal indexed pools. Detailed contract and live activity analysis currently remains X Layer-only; additional network-specific evidence is being integrated.</p></div><span className="token-network-count">01 DATA SOURCE</span></div>

      <section className="circuit-source-banner token-source-banner">
        <div className="circuit-source-mark">◎</div>
        <div>
          <span className="changes-kicker">DISCOVERY SOURCE · GECKOTERMINAL</span>
          <h2>{networkLabel} token and pool activity</h2>
          <p>Public market-index data, refreshed automatically. Detection means a token appears in an indexed pool; it does not mean OKX has exchange-listed or endorsed it.</p>
        </div>
        <a href={"https://www.geckoterminal.com/" + (snapshot?.networkKey === "xlayer" ? "x-layer" : snapshot?.networkKey === "ethereum" ? "eth" : snapshot?.networkKey === "bnb" ? "bsc" : "solana") + "/pools"} target="_blank" rel="noreferrer">Open source ↗</a>
      </section>

      <div className="circuit-metrics-grid token-metrics-grid">
        <article className="circuit-metric-card"><span>TOKENS ON THIS PAGE</span><strong>{snapshot?.tokens.length ?? "—"}</strong><small>{isWideSearch ? "Matches returned for this search page" : "Unique token contracts returned for this page"}</small></article>
        <article className="circuit-metric-card"><span>POOLS RETURNED</span><strong>{snapshot?.poolCount ?? "—"}</strong><small>From the selected discovery page</small></article>
        <article className="circuit-metric-card"><span>NETWORK</span><strong>{networkLabel}</strong><small>{snapshot?.chainId ? "Chain ID " + snapshot.chainId : network === "solana" ? "Solana mainnet" : "Network metadata loading"}</small></article>
        <article className="circuit-metric-card"><span>DATA STATUS</span><strong>{loading ? "Checking…" : snapshot ? "Connected" : "Unavailable"}</strong><small>{lastUpdated ? "Updated " + new Date(lastUpdated).toLocaleTimeString() : "Waiting for source response"}</small></article>
      </div>

      {error && <div className="module-notice circuit-error"><span className="circuit-status-dot error"/><div><strong>Token discovery unavailable</strong><p>{error}</p></div></div>}

      <section className="detail-card circuit-registry-card">
        <div className="detail-card-heading"><div><span className="mini-icon">⌕</span><h2>{isWideSearch ? `Search ${networkLabel} token directory` : "Discovered token directory"}</h2></div><span className="circuit-evidence-badge">{isWideSearch ? "WIDE SEARCH" : "LIVE INDEX"}</span></div>
        <p className="circuit-directory-intro">{isWideSearch ? `Search is sent to GeckoTerminal indexed ${networkLabel} pool search, not just the tokens currently loaded in this table. Try a token name, symbol or full contract address.` : snapshot?.scope ?? "Tokens are listed when the data provider indexes a new liquidity pool. A contract deployment without a tracked pool may not appear here."}</p>
        <label className="circuit-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); setDebouncedSearch(search.trim()); } }} placeholder={"Search across " + networkLabel + " by name, symbol or contract…"} aria-label={"Search across " + networkLabel + " tokens"}/><button type="button" onClick={() => { setPage(1); setDebouncedSearch(search.trim()); }} disabled={search.trim().length < 2 || loading}>Search</button>{(search || debouncedSearch) && <button type="button" onClick={() => { setSearch(""); setDebouncedSearch(""); setPage(1); }}>Clear</button>}</label>
        {search.trim().length === 1 && <p className="token-footnote">Enter at least 2 characters to search the wider provider index.</p>}
        {loading && <div className="circuit-empty-state">{isWideSearch ? `Searching the wider ${networkLabel} index…` : "Loading token page…"}</div>}
        {!loading && !error && tokens.length === 0 && <div className="circuit-empty-state">{isWideSearch ? `No indexed pools on ${networkLabel} matched that search.` : `No pools were returned for ${networkLabel} on this page.`}</div>}
        {tokens.length > 0 && <div className="token-table-wrap"><table className="token-table">
          <thead><tr><th>TOKEN</th><th>CONTRACT</th><th>PRICE</th><th>POOL LIQUIDITY</th><th>24H VOLUME</th><th>24H CHANGE</th><th>POOL CREATED</th></tr></thead>
          <tbody>{tokens.map((token) => <tr key={token.address} onClick={() => setSelected(token)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setSelected(token); }}>
            <td><div className="token-identity">{token.imageUrl ? <img src={token.imageUrl} alt="" loading="lazy"/> : <span className="token-placeholder">{token.symbol.slice(0,1)}</span>}<span><strong>{token.name}</strong><small>{token.symbol}</small></span></div></td>
            <td><code>{short(token.address)}</code></td><td>{fmtUsd(token.priceUsd)}</td><td>{fmtUsd(token.liquidityUsd)}</td><td>{fmtUsd(token.volume24hUsd)}</td>
            <td className={token.priceChange24h && Number(token.priceChange24h) < 0 ? "token-negative" : "token-positive"}>{token.priceChange24h == null ? "—" : Number(token.priceChange24h).toFixed(2) + "%"}</td>
            <td>{token.poolCreatedAt ? new Date(token.poolCreatedAt).toLocaleDateString() : "—"}</td>
          </tr>)}</tbody>
        </table></div>}
        <div className="token-pagination">
          <button className="secondary-button" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>← Previous</button>
          <span>Page <strong>{page}</strong> of <strong>{maxPage}</strong>{isWideSearch ? " · search results" : " · new pools"}</span>
          <button className="secondary-button" type="button" onClick={() => setPage((current) => Math.min(maxPage, current + 1))} disabled={page >= maxPage || loading}>Next →</button>
        </div>
        <p className="token-footnote">{isWideSearch ? "Search results are based on GeckoTerminal's indexed pools and can omit contracts without indexed liquidity pools." : "Browse up to 10 pages of newly indexed pools. The provider limits this feed to recent pool activity; it is not a complete list of all deployed X Layer contracts."} Market metrics may be delayed or incomplete and are informational only, not a token safety assessment or investment recommendation.</p>
      </section>

      {selected && <div className="token-modal-backdrop" role="presentation" onClick={() => setSelected(null)}>
        <section className="token-modal detail-card" role="dialog" aria-modal="true" aria-label={selected.name + " token details"} onClick={(e) => e.stopPropagation()}>
          <div className="detail-card-heading"><div><span className="mini-icon">◎</span><h2>{selected.name} <span className="token-symbol">({selected.symbol})</span></h2></div><button className="secondary-button" type="button" onClick={() => setSelected(null)}>Close</button></div>
          <p className="circuit-directory-intro">Public market-index record. This does not verify the token's safety, ownership or official exchange listing.</p>
          <div className="info-rows">
            <div><span>Contract</span><strong><a href={(snapshot?.explorer ?? EXPLORER) + (network === "solana" ? "/account/" : "/token/") + selected.address} target="_blank" rel="noreferrer">{selected.address} ↗</a></strong></div>
            <div><span>Pool</span><strong>{selected.poolName}</strong></div>
            <div><span>DEX</span><strong>{selected.dex}</strong></div>
            <div><span>Pool liquidity</span><strong>{fmtUsd(selected.liquidityUsd)}</strong></div>
            <div><span>24h volume</span><strong>{fmtUsd(selected.volume24hUsd)}</strong></div>
            <div><span>Price (provider-reported)</span><strong>{fmtUsd(selected.priceUsd)}</strong></div>
            <div><span>24h buys / sells</span><strong>{selected.buys24h ?? "—"} / {selected.sells24h ?? "—"}</strong></div>
            <div><span>Pool created</span><strong>{selected.poolCreatedAt ? new Date(selected.poolCreatedAt).toLocaleString() : "Unavailable"}</strong></div>
          </div>
          {selected.networkKey === "xlayer" ? <TokenActivityPanel token={selected} /> : <div className="module-notice"><strong>Extended intelligence is being connected for {networkLabel}.</strong><p>Token discovery and pool metrics are available from GeckoTerminal. Trade history, contract checks and live event subscriptions are currently enabled only for X Layer.</p></div>}
          <p className="token-footnote">A newly detected pool is not proof that a token is legitimate. Verify contract details independently before drawing conclusions.</p>
        </section>
      </div>}
    </div>
  );
}
