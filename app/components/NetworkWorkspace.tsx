"use client";

import { useCallback, useEffect, useState } from "react";

type NetworkStatus = {
  ok: boolean;
  network: string;
  chainId: number;
  blockNumber: string;
  blockTimestamp: string;
  transactionCount: number;
  gasPriceGwei: string;
  syncing: boolean | Record<string, string>;
  rpcEndpoint: string;
  checkedAt: string;
};

const EXPLORER = "https://www.okx.com/web3/explorer/xlayer";

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

  useEffect(() => { void refresh(); }, [refresh]);

  const syncing = status?.syncing === false ? "Not syncing" : status?.syncing ? "Sync status reported" : "Unknown";
  const blockTime = status?.blockTimestamp ? new Date(Number(status.blockTimestamp) * 1000).toLocaleString() : "Unavailable";

  return (
    <div className="content module-workspace network-workspace" id="networks">
      <div className="workspace-title-row">
        <div>
          <div className="eyebrow">ECOSYSTEM · LIVE PUBLIC DATA</div>
          <h1>Network explorer<span>.</span></h1>
          <p className="intro">Read-only health and activity signals from X Layer's public RPC. No wallet connection or API credentials are required.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Checking…" : "Refresh network"}</button>
      </div>

      <section className="circuit-source-banner">
        <div className="circuit-source-mark">X</div>
        <div>
          <span className="changes-kicker">NETWORK PROFILE · CHAIN 196</span>
          <h2>X Layer</h2>
          <p>Ethereum-compatible Layer 2 network. TapeWatch reads public chain metadata only; it cannot submit transactions or modify network state.</p>
        </div>
        <a href={EXPLORER} target="_blank" rel="noreferrer">Open block explorer ↗</a>
      </section>

      {error && <div className="module-notice circuit-error"><span className="circuit-status-dot error"/> <div><strong>Live network read unavailable</strong><p>{error}</p></div></div>}

      <div className="circuit-metrics-grid">
        <article className="circuit-metric-card"><span>CONNECTION</span><strong>{loading ? "Checking…" : status ? "Connected" : "Unavailable"}</strong><small>{status?.rpcEndpoint ?? "Public RPC endpoints"}</small></article>
        <article className="circuit-metric-card"><span>CHAIN ID</span><strong>{status?.chainId ?? "196"}</strong><small>{status ? "Chain identity verified" : "Expected X Layer chain ID"}</small></article>
        <article className="circuit-metric-card"><span>LATEST BLOCK</span><strong>{status ? Number(status.blockNumber).toLocaleString() : "—"}</strong><small>{status ? "Latest block returned by RPC" : "Waiting for live read"}</small></article>
        <article className="circuit-metric-card"><span>GAS PRICE</span><strong>{status ? status.gasPriceGwei + " Gwei" : "—"}</strong><small>Current RPC gas-price estimate</small></article>
      </div>

      <section className="detail-card circuit-registry-card">
        <div className="detail-card-heading"><div><span className="mini-icon">◎</span><h2>Network diagnostics</h2></div><span className={status ? "circuit-evidence-badge" : "coming-soon"}>{status ? "LIVE RPC READ" : "AWAITING READ"}</span></div>
        <div className="info-rows">
          <div><span>Network</span><strong>X Layer</strong></div>
          <div><span>Native token</span><strong>OKB</strong></div>
          <div><span>Block timestamp</span><strong>{blockTime}</strong></div>
          <div><span>Transactions in latest block</span><strong>{status ? status.transactionCount.toLocaleString() : "—"}</strong></div>
          <div><span>Sync indicator</span><strong>{syncing}</strong></div>
          <div><span>Last checked</span><strong>{status?.checkedAt ? new Date(status.checkedAt).toLocaleString() : "Not checked"}</strong></div>
          <div><span>RPC source</span><strong>{status?.rpcEndpoint ?? "Not connected"}</strong></div>
        </div>
      </section>

      <div className="circuit-integrity-note">
        <strong>Evidence limits:</strong> these values are read from a public RPC endpoint at the time of the request. They are a point-in-time connectivity and network snapshot, not a guarantee of uptime, decentralization, transaction finality, or network security.
      </div>
    </div>
  );
}
