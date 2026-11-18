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
  const [selectedProcessor, setSelectedProcessor] = useState<Processor | null>(null);
  const [tokenId, setTokenId] = useState("1");
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const inspectProcessor = async (processor: Processor, selectedToken?: string) => {
    setSelectedProcessor(processor); setDetail(null); setDetailError(""); setDetailLoading(true);
    try {
      const params = new URLSearchParams({ processorNumber: String(processor.processorNumber), address: processor.address });
      if (selectedToken) params.set("tokenId", selectedToken);
      const response = await fetch("/api/tapeout/xlayer/processor?" + params.toString(), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not read processor details.");
      setDetail(data);
    } catch (caught) { setDetailError(caught instanceof Error ? caught.message : "Processor details are unavailable."); }
    finally { setDetailLoading(false); }
  };
  const readTokenHistory = async () => {
    if (!selectedProcessor || !/^\\d+$/.test(tokenId) || BigInt(tokenId) < BigInt(1)) { setDetailError("Enter a valid token ID greater than zero."); return; }
    await inspectProcessor(selectedProcessor, tokenId);
  };

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
                <div className="circuit-row-actions"><button type="button" className="circuit-inspect-button" onClick={() => void inspectProcessor(processor)}>Inspect</button><a href={EXPLORER + "/address/" + processor.address} target="_blank" rel="noreferrer">Explorer ↗</a></div>
              </div>
            ))}
          </div>
        )}

        {selectedProcessor && (
          <section className="circuit-processor-detail" aria-live="polite">
            <div className="circuit-detail-heading"><div><span className="changes-kicker">PROCESSOR INSPECTOR</span><h3>Processor #{selectedProcessor.processorNumber}</h3></div><button type="button" className="circuit-close-detail" onClick={() => { setSelectedProcessor(null); setDetail(null); setDetailError(""); }}>Close</button></div>
            <code className="circuit-detail-address">{selectedProcessor.address}</code>
            {detailLoading && <p className="circuit-detail-status">Reading processor contract on X Layer…</p>}
            {detailError && <p className="circuit-detail-error">{detailError}</p>}
            {detail && <>
              <div className="circuit-detail-facts"><div><span>CONTRACT NAME</span><strong>{detail.name || "Not exposed"}</strong></div><div><span>NETWORK</span><strong>X Layer · 196</strong></div><div><span>READ BLOCK</span><strong>{Number(detail.blockNumber).toLocaleString()}</strong></div><div><span>ON-CHAIN CODE</span><strong>{detail.contractCode?.deployed ? "Present" : "No code found"}</strong><small>{detail.contractCode?.deployed ? `${Number(detail.contractCode.bytecodeBytes).toLocaleString()} bytes` : "Address has no runtime bytecode"}</small></div></div><div className="circuit-contract-source-note">Code presence is checked directly on X Layer. This does not mean the source code is verified or that the contract has been security-audited.</div><div className="circuit-contract-links"><a href={EXPLORER + "/address/" + selectedProcessor.address} target="_blank" rel="noreferrer">Open contract on X Layer Explorer ↗</a></div>
              <div className="circuit-activity-panel">
                <div className="circuit-activity-heading"><div><strong>Raw contract activity</strong><p>Recent on-chain logs emitted by this processor contract.</p></div><span>{detail.contractEvents?.length ?? 0} shown</span></div>
                {detail.contractEvents?.length ? <div className="circuit-activity-list">{detail.contractEvents.map((event: any) => <div className="circuit-activity-row" key={event.transactionHash + event.logIndex}><div><strong>Block {Number(event.blockNumber).toLocaleString()}</strong><small>Log #{event.logIndex} · {event.topicsCount} topic{event.topicsCount === 1 ? "" : "s"} · {event.dataBytes} data bytes</small><code>{event.topic0}</code></div><a href={EXPLORER + "/tx/" + event.transactionHash} target="_blank" rel="noreferrer">View transaction ↗</a></div>)}</div> : <p className="circuit-detail-status">No contract logs were returned in this recent block window. This does not prove the contract has never been active.</p>}
                <p className="circuit-history-limit">{detail.historyNote}</p>
              </div>
              <div className="circuit-token-lookup"><div><strong>Circuit token lookup</strong><p>Enter a token ID to read its current holder and recent ERC-721 transfer records.</p></div><div className="circuit-token-controls"><input inputMode="numeric" value={tokenId} onChange={event => setTokenId(event.target.value)} aria-label="Circuit token ID" placeholder="Token ID"/><button type="button" className="secondary-button" onClick={() => void readTokenHistory()} disabled={detailLoading}>Read token</button></div></div>
              {detail.token && <div className="circuit-holder-card"><span>CURRENT HOLDER · TOKEN #{detail.token.tokenId}</span><code>{detail.token.owner}</code><a href={EXPLORER + "/address/" + detail.token.owner} target="_blank" rel="noreferrer">View holder ↗</a></div>}
              <div className="circuit-history-heading"><strong>{detail.token ? "Recent transfer history · #" + detail.token.tokenId : "Recent processor activity"}</strong><span>Last 100 blocks</span></div>
              {detail.transfers?.length ? <div className="circuit-transfer-list">{detail.transfers.map((event: any) => <div className="circuit-transfer-row" key={event.transactionHash + event.logIndex}><div><strong>{event.from.toLowerCase() === "0x0000000000000000000000000000000000000000" ? "Mint" : "Transfer"} · Token #{event.tokenId}</strong><small>Block {Number(event.blockNumber).toLocaleString()}</small></div><div className="circuit-transfer-addresses"><span>From <code>{event.from}</code></span><span>To <code>{event.to}</code></span></div><a href={EXPLORER + "/tx/" + event.transactionHash} target="_blank" rel="noreferrer">Tx ↗</a></div>)}</div> : <p className="circuit-detail-status">No matching transfer events were found in the scanned block window.</p>}
              <p className="circuit-history-limit">{detail.historyNote}</p>
            </>}
          </section>
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
