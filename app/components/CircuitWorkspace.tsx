"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Processor = { processorNumber: number; address: string };
type CircuitSnapshot = {
  ok: boolean;
  network: string;
  chainId: number;
  blockNumber?: string;
  processorCount?: string;
  offset?: number;
  limit?: number;
  processors?: Processor[];
  hasMore?: boolean;
  factory?: string;
  rpcEndpoint?: string;
  checkedAt?: string;
  sourceStatus: string;
  error?: string;
};

const EXPLORER = "https://www.okx.com/web3/explorer/xlayer";
const PAGE_SIZE = 25;

export default function CircuitWorkspace() {
  const [snapshot, setSnapshot] = useState<CircuitSnapshot | null>(null);
  const [processors, setProcessors] = useState<Processor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);

  const readPage = useCallback(async (offset: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/tapeout/xlayer?offset=${offset}&limit=${PAGE_SIZE}`, { cache: "no-store" });
      const data = (await response.json()) as CircuitSnapshot;
      if (!response.ok || !data.ok) throw new Error(data.error || "The read-only network check could not be completed.");
      setSnapshot(data);
      setProcessors((current) => append ? [...current, ...(data.processors ?? [])] : (data.processors ?? []));
      setHasMore(Boolean(data.hasMore));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "TapeWatch could not reach its circuit data endpoint. Please try again.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setSearch("");
    void readPage(0, false);
  }, [readPage]);

  useEffect(() => { void readPage(0, false); }, [readPage]);

  const filteredProcessors = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return processors;
    return processors.filter((processor) =>
      processor.address.toLowerCase().includes(term) ||
      String(processor.processorNumber).includes(term)
    );
  }, [processors, search]);

  return (
    <div className="content module-workspace circuit-workspace" id="circuits">
      <div className="workspace-title-row">
        <div>
          <div className="eyebrow">TAPEOUT ECOSYSTEM · READ-ONLY</div>
          <h1>Circuit intelligence<span>.</span></h1>
          <p className="intro">A live, read-only view of TapeOut's processor registry on X Layer, with source references and clear verification limits.</p>
        </div>
        <span className="preview-pill"><span/> {snapshot?.ok ? "RPC CONNECTED" : "SOURCE CHECK"}</span>
      </div>

      <section className="circuit-source-banner">
        <div className="circuit-source-mark">T</div>
        <div>
          <span className="changes-kicker">TAPEOUT PROTOCOL REFERENCE</span>
          <h2>Connected to the X Layer processor registry</h2>
          <p>TapeWatch reads public contract data only. It does not connect a wallet, submit transactions, or change circuit ownership.</p>
        </div>
        <a href="https://github.com/TapeOutProtocol/TAPs/blob/main/TAPs/TAP-10.md" target="_blank" rel="noreferrer">TAP-10 source ↗</a>
      </section>

      {error && <div className="module-notice circuit-error"><span className="circuit-status-dot error"/> <div><strong>Live read unavailable</strong><p>{error}</p></div></div>}

      <div className="circuit-metrics-grid">
        <article className="circuit-metric-card">
          <span>PROCESSOR CONTRACTS</span>
          <strong>{loading ? "—" : snapshot?.ok ? snapshot.processorCount ?? "—" : "—"}</strong>
          <small>Reported by TapeOut factory · X Layer</small>
        </article>
        <article className="circuit-metric-card">
          <span>NETWORK</span>
          <strong>X Layer</strong>
          <small>Chain ID 196 · Native token OKB</small>
        </article>
        <article className="circuit-metric-card">
          <span>LAST READ BLOCK</span>
          <strong>{snapshot?.ok && snapshot.blockNumber ? Number(snapshot.blockNumber).toLocaleString() : "—"}</strong>
          <small>{snapshot?.checkedAt ? new Date(snapshot.checkedAt).toLocaleTimeString() : "Waiting for first read"}</small>
        </article>
      </div>

      <section className="detail-card circuit-registry-card">
        <div className="detail-card-heading">
          <div><span className="mini-icon">⌘</span><h2>Processor directory</h2></div>
          <button className="secondary-button" type="button" onClick={refresh} disabled={loading || loadingMore}>{loading ? "Reading…" : "Refresh registry"}</button>
        </div>
        <p className="detail-muted circuit-directory-intro">Browse the factory's processor contracts in pages of 25. Search filters addresses and indexes currently loaded in the directory. Processor contracts are not individual circuit NFTs.</p>
        <label className="circuit-search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search loaded processor address or number…" aria-label="Search loaded processors"/>
          {search && <button type="button" onClick={() => setSearch("")}>Clear</button>}
        </label>
        {loading && <div className="circuit-empty-state">Reading the X Layer factory and latest block…</div>}
        {!loading && processors.length === 0 && !error && <div className="circuit-empty-state">The factory returned no processor contracts at this block.</div>}
        {!loading && processors.length > 0 && filteredProcessors.length === 0 && <div className="circuit-empty-state">No loaded processor matches that search. Load more pages to expand the searchable directory.</div>}
        {!loading && !!filteredProcessors.length && (
          <div className="circuit-processor-list">
            {filteredProcessors.map((processor) => (
              <div className="circuit-processor-row" key={processor.processorNumber}>
                <div className="circuit-processor-index">#{processor.processorNumber}</div>
                <div className="circuit-processor-address"><strong>Processor {processor.processorNumber}</strong><code>{processor.address}</code></div>
                <a href={`${EXPLORER}/address/${processor.address}`} target="_blank" rel="noreferrer">View contract ↗</a>
              </div>
            ))}
          </div>
        )}
        <div className="circuit-pagination">
          <span>{processors.length.toLocaleString()} of {snapshot?.processorCount ?? "—"} processors loaded</span>
          {hasMore && <button className="secondary-button" type="button" onClick={() => void readPage(processors.length, true)} disabled={loadingMore || loading}>{loadingMore ? "Loading next page…" : "Load next 25"}</button>}
        </div>
      </section>

      <div className="circuit-integrity-note">
        <strong>What this confirms:</strong> the RPC reports chain ID 196, and the listed factory successfully returned its processor count and the processor addresses shown above at the displayed block.
        <br/><strong>What it does not confirm:</strong> independent contract security, circuit correctness, NFT ownership history, or a full audit of the TapeOut protocol.
      </div>
      <p className="intelligence-disclaimer">{snapshot?.sourceStatus ?? "Factory address is referenced from TapeOut's TAP-10 draft."} {snapshot?.rpcEndpoint ? `RPC: ${snapshot.rpcEndpoint}` : ""}</p>
    </div>
  );
}
