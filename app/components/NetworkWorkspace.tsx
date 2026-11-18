"use client";

import { useCallback, useEffect, useState } from "react";

type RecentBlock = {
  number: string;
  hash: string;
  timestamp: string;
  transactionCount: number;
  gasUsed: string;
  gasLimit: string;
  baseFeeGwei: string | null;
};

type NetworkStatus = {
  ok: boolean;
  network: string;
  chainId: number;
  blockNumber: string;
  blockTimestamp: string;
  transactionCount: number;
  gasPriceGwei: string | null;
  averageBlockTimeSeconds: number | null;
  recentBlocks: RecentBlock[];
  syncing: boolean | Record<string, string>;
  rpcEndpoint: string;
  checkedAt: string;
};

const EXPLORER = "https://www.okx.com/web3/explorer/xlayer";
const formatNumber = (value: string | number) => Number(value).toLocaleString();
const formatTime = (value: string) => value ? new Date(Number(value) * 1000).toLocaleString() : "Unavailable";

export default function NetworkWorkspace() {
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/network/xlayer", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Network status is unavailable.");
      setStatus(data as NetworkStatus);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not read X Layer network status.");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 15_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const syncing = status?.syncing === false
    ? "Not syncing"
    : status?.syncing === true
      ? "Syncing"
      : status?.syncing
        ? "Sync progress reported"
        : "Unknown";
  const blockTime = status?.averageBlockTimeSeconds != null
    ? status.averageBlockTimeSeconds + " seconds (recent average)"
    : "Not available";
  const connectionLabel = loading ? "Checking…" : status ? "Connected" : "Unavailable";

  return (
    <div className="content module-workspace network-workspace" id="networks">
      <div className="workspace-title-row">
        <div>
          <div className="eyebrow">ECOSYSTEM · LIVE PUBLIC DATA</div>
          <h1>Network explorer<span>.</span></h1>
          <p className="intro">Live, read-only health and activity signals from X Layer public RPC. No wallet connection or API credentials are required.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Checking…" : "Refresh network"}</button>
      </div>

      <section className="circuit-source-banner">
        <div className="circuit-source-mark">X</div>
        <div>
          <span className="changes-kicker">NETWORK PROFILE · CHAIN 196</span>
          <h2>X Layer</h2>
          <p>Ethereum-compatible Layer 2 network. TapeWatch only reads public chain data; it cannot submit transactions or modify network state.</p>
        </div>
        <a href={EXPLORER} target="_blank" rel="noreferrer">Open block explorer ↗</a>
      </section>

      {error && <div className="module-notice circuit-error"><span className="circuit-status-dot error"/> <div><strong>Live network read unavailable</strong><p>{error}</p></div></div>}

      <div className="circuit-metrics-grid network-metrics-grid">
        <article className="circuit-metric-card"><span>NETWORK STATUS</span><strong>{connectionLabel}</strong><small>{status ? "Chain identity verified · read-only" : "Waiting for public RPC response"}</small></article>
        <article className="circuit-metric-card"><span>LATEST BLOCK</span><strong>{status ? formatNumber(status.blockNumber) : "—"}</strong><small>{status ? "Latest block reported by RPC" : "No live block data"}</small></article>
        <article className="circuit-metric-card"><span>GAS PRICE</span><strong>{status?.gasPriceGwei ? status.gasPriceGwei + " Gwei" : "—"}</strong><small>Current network gas-price estimate</small></article>
        <article className="circuit-metric-card"><span>AVG. BLOCK TIME</span><strong>{status?.averageBlockTimeSeconds != null ? status.averageBlockTimeSeconds + "s" : "—"}</strong><small>Calculated from recent block timestamps</small></article>
      </div>

      <section className="detail-card circuit-registry-card">
        <div className="detail-card-heading"><div><span className="mini-icon">◎</span><h2>Network diagnostics</h2></div><span className={status ? "circuit-evidence-badge" : "coming-soon"}>{status ? "LIVE RPC READ" : "AWAITING READ"}</span></div>
        <div className="info-rows">
          <div><span>Network</span><strong>X Layer</strong></div>
          <div><span>Chain ID</span><strong>{status?.chainId ?? "196 (expected)"}</strong></div>
          <div><span>Native token</span><strong>OKB</strong></div>
          <div><span>Latest block timestamp</span><strong>{status ? formatTime(status.blockTimestamp) : "Unavailable"}</strong></div>
          <div><span>Transactions in latest block</span><strong>{status ? formatNumber(status.transactionCount) : "—"}</strong></div>
          <div><span>Recent average block time</span><strong>{blockTime}</strong></div>
          <div><span>Sync indicator</span><strong>{syncing}</strong></div>
          <div><span>Last checked</span><strong>{status?.checkedAt ? new Date(status.checkedAt).toLocaleString() : "Not checked"}</strong></div>
          <div><span>RPC source</span><strong>{status?.rpcEndpoint ?? "Not connected"}</strong></div>
        </div>
      </section>

      <section className="detail-card circuit-registry-card network-blocks-card">
        <div className="detail-card-heading"><div><span className="mini-icon">▤</span><h2>Recent blocks</h2></div><span className="circuit-evidence-badge">{status?.recentBlocks.length ?? 0} BLOCKS</span></div>
        <p className="circuit-directory-intro">Latest block headers returned by the connected public RPC endpoint.</p>
        {status?.recentBlocks.length ? (
          <div className="network-block-list">
            {status.recentBlocks.map((block) => (
              <div className="network-block-row" key={block.number}>
                <div className="network-block-main">
                  <strong>Block #{formatNumber(block.number)}</strong>
                  <small>{formatTime(block.timestamp)}</small>
                </div>
                <div className="network-block-stats">
                  <strong>{formatNumber(block.transactionCount)} tx</strong>
                  <small>Gas used {formatNumber(block.gasUsed)}</small>
                </div>
                <div className="network-block-stats">
                  <strong>{block.baseFeeGwei ? block.baseFeeGwei + " Gwei" : "—"}</strong>
                  <small>Base fee</small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="circuit-empty-state">{loading ? "Loading recent block headers…" : "Recent block data will appear when the RPC connection is available."}</div>
        )}
      </section>

      <div className="circuit-integrity-note">
        <strong>Evidence limits:</strong> values are point-in-time responses from a public RPC provider. Average block time uses the returned recent headers; it is not a long-term performance metric. RPC data does not independently prove uptime, decentralization, transaction finality, or network security.
      </div>
    </div>
  );
}
