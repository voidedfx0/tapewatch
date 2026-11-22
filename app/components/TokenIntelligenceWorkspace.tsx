"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Token = {
  address: string; name: string; symbol: string; decimals: number | null; imageUrl: string | null;
  coingeckoId: string | null; role: string; poolAddress: string; poolName: string;
  poolCreatedAt: string | null; dex: string; liquidityUsd: string | null; volume24hUsd: string | null;
  priceChange24h: string | null; buys24h: number | null; sells24h: number | null; priceUsd: string | null;
};
type Snapshot = { ok: boolean; network: string; chainId: number; source: string; scope: string; tokens: Token[]; poolCount: number; checkedAt: string; error?: string };
const EXPLORER = "https://www.okx.com/web3/explorer/xlayer";
const fmtUsd = (v: string | null) => v == null ? "—" : Number(v).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const fmtNum = (v: string | null) => v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
const short = (v: string) => v.slice(0, 6) + "…" + v.slice(-4);

export default function TokenIntelligenceWorkspace() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Token | null>(null);
  const [lastUpdated, setLastUpdated] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/tokens/xlayer", { cache: "no-store" });
      const data = await response.json() as Snapshot;
      if (!response.ok || !data.ok) throw new Error(data.error || "Token discovery is unavailable.");
      setSnapshot(data); setLastUpdated(data.checkedAt);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load X Layer token data.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const tokens = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = snapshot?.tokens ?? [];
    if (!term) return rows;
    return rows.filter((t) => t.name.toLowerCase().includes(term) || t.symbol.toLowerCase().includes(term) || t.address.toLowerCase().includes(term));
  }, [snapshot, search]);

  return (
    <div className="content module-workspace token-workspace" id="token-intelligence">
      <div className="workspace-title-row">
        <div>
          <div className="eyebrow">X LAYER ECOSYSTEM · TOKEN DISCOVERY</div>
          <h1>Token intelligence<span>.</span></h1>
          <p className="intro">A live discovery feed for tokens appearing in newly indexed X Layer liquidity pools.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh tokens"}</button>
      </div>

      <section className="circuit-source-banner token-source-banner">
        <div className="circuit-source-mark">◎</div>
        <div>
          <span className="changes-kicker">DISCOVERY SOURCE · GECKOTERMINAL</span>
          <h2>X Layer token and pool activity</h2>
          <p>Public market-index data, refreshed automatically. Detection means a token appears in an indexed pool; it does not mean OKX has exchange-listed or endorsed it.</p>
        </div>
        <a href="https://www.geckoterminal.com/x-layer/pools" target="_blank" rel="noreferrer">Open source ↗</a>
      </section>

      <div className="circuit-metrics-grid token-metrics-grid">
        <article className="circuit-metric-card"><span>DISCOVERED TOKENS</span><strong>{snapshot?.tokens.length ?? "—"}</strong><small>Unique token contracts in this feed</small></article>
        <article className="circuit-metric-card"><span>NEW POOLS INDEXED</span><strong>{snapshot?.poolCount ?? "—"}</strong><small>Returned by the discovery source</small></article>
        <article className="circuit-metric-card"><span>NETWORK</span><strong>X Layer</strong><small>Chain ID 196 · Mainnet</small></article>
        <article className="circuit-metric-card"><span>DATA STATUS</span><strong>{loading ? "Checking…" : snapshot ? "Connected" : "Unavailable"}</strong><small>{lastUpdated ? "Updated " + new Date(lastUpdated).toLocaleTimeString() : "Waiting for source response"}</small></article>
      </div>

      {error && <div className="module-notice circuit-error"><span className="circuit-status-dot error"/><div><strong>Token discovery unavailable</strong><p>{error}</p></div></div>}

      <section className="detail-card circuit-registry-card">
        <div className="detail-card-heading"><div><span className="mini-icon">⌕</span><h2>Discovered token directory</h2></div><span className="circuit-evidence-badge">LIVE INDEX</span></div>
        <p className="circuit-directory-intro">{snapshot?.scope ?? "Tokens are listed when the data provider indexes a new liquidity pool. A contract deployment without a tracked pool may not appear here."}</p>
        <label className="circuit-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search token name, symbol or contract…" aria-label="Search X Layer tokens"/>{search && <button type="button" onClick={() => setSearch("")}>Clear</button>}</label>
        {loading && !snapshot && <div className="circuit-empty-state">Connecting to X Layer token discovery…</div>}
        {!loading && !error && tokens.length === 0 && <div className="circuit-empty-state">{search ? "No token matches that search." : "No newly indexed pools were returned by the source."}</div>}
        {tokens.length > 0 && <div className="token-table-wrap"><table className="token-table">
          <thead><tr><th>TOKEN</th><th>CONTRACT</th><th>POOL LIQUIDITY</th><th>24H VOLUME</th><th>24H CHANGE</th><th>POOL CREATED</th></tr></thead>
          <tbody>{tokens.map((token) => <tr key={token.address} onClick={() => setSelected(token)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setSelected(token); }}>
            <td><div className="token-identity">{token.imageUrl ? <img src={token.imageUrl} alt="" loading="lazy"/> : <span className="token-placeholder">{token.symbol.slice(0,1)}</span>}<span><strong>{token.name}</strong><small>{token.symbol}</small></span></div></td>
            <td><code>{short(token.address)}</code></td><td>{fmtUsd(token.liquidityUsd)}</td><td>{fmtUsd(token.volume24hUsd)}</td>
            <td className={token.priceChange24h && Number(token.priceChange24h) < 0 ? "token-negative" : "token-positive"}>{token.priceChange24h == null ? "—" : Number(token.priceChange24h).toFixed(2) + "%"}</td>
            <td>{token.poolCreatedAt ? new Date(token.poolCreatedAt).toLocaleDateString() : "—"}</td>
          </tr>)}</tbody>
        </table></div>}
        <p className="token-footnote">Market metrics are supplied by GeckoTerminal and may be delayed or incomplete. They are informational only, not a token safety assessment or investment recommendation.</p>
      </section>

      {selected && <div className="token-modal-backdrop" role="presentation" onClick={() => setSelected(null)}>
        <section className="token-modal detail-card" role="dialog" aria-modal="true" aria-label={selected.name + " token details"} onClick={(e) => e.stopPropagation()}>
          <div className="detail-card-heading"><div><span className="mini-icon">◎</span><h2>{selected.name} <span className="token-symbol">({selected.symbol})</span></h2></div><button className="secondary-button" type="button" onClick={() => setSelected(null)}>Close</button></div>
          <p className="circuit-directory-intro">Public market-index record. This does not verify the token's safety, ownership or official exchange listing.</p>
          <div className="info-rows">
            <div><span>Contract</span><strong><a href={EXPLORER + "/token/" + selected.address} target="_blank" rel="noreferrer">{selected.address} ↗</a></strong></div>
            <div><span>Pool</span><strong>{selected.poolName}</strong></div>
            <div><span>DEX</span><strong>{selected.dex}</strong></div>
            <div><span>Pool liquidity</span><strong>{fmtUsd(selected.liquidityUsd)}</strong></div>
            <div><span>24h volume</span><strong>{fmtUsd(selected.volume24hUsd)}</strong></div>
            <div><span>Price (provider-reported)</span><strong>{fmtUsd(selected.priceUsd)}</strong></div>
            <div><span>24h buys / sells</span><strong>{selected.buys24h ?? "—"} / {selected.sells24h ?? "—"}</strong></div>
            <div><span>Pool created</span><strong>{selected.poolCreatedAt ? new Date(selected.poolCreatedAt).toLocaleString() : "Unavailable"}</strong></div>
          </div>
          <p className="token-footnote">A newly detected pool is not proof that a token is legitimate. Verify contract details independently before drawing conclusions.</p>
        </section>
      </div>}
    </div>
  );
}
