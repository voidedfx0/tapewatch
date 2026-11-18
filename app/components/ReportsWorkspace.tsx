"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type Site = { id: string; url: string };
type Check = { id: string; website_id: string; checked_at: string; status: string; http_status: number | null; page_title: string | null; error_message: string | null };
type Change = { id: string; website_id: string; detected_at: string; change_type: string; previous_title: string | null; current_title: string | null; previous_hash: string | null; current_hash: string | null };

function dateInput(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toLocaleDateString("en-CA");
}

export default function ReportsWorkspace({ sites }: { sites: Site[] }) {
  const [siteId, setSiteId] = useState("all");
  const [from, setFrom] = useState(dateInput(30));
  const [to, setTo] = useState(dateInput(0));
  const [checks, setChecks] = useState<Check[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) {
        setError("The database connection is not configured.");
        setChecks([]);
        setChanges([]);
        return;
      }
      const selectedSites = siteId === "all" ? sites : sites.filter((site) => site.id === siteId);
      if (!selectedSites.length) {
        setChecks([]);
        setChanges([]);
        setError("");
        return;
      }
      if (from && to && from > to) {
        setError("The start date must be before the end date.");
        return;
      }
      setLoading(true);
      setError("");
      const ids = selectedSites.map((site) => site.id);
      const start = from ? new Date(from + "T00:00:00").toISOString() : undefined;
      const endDate = to ? new Date(to + "T23:59:59.999").toISOString() : undefined;
      let checksQuery = supabase.from("website_checks")
        .select("id, website_id, checked_at, status, http_status, page_title, error_message")
        .in("website_id", ids).order("checked_at", { ascending: false }).limit(1000);
      let changesQuery = supabase.from("website_changes")
        .select("id, website_id, detected_at, change_type, previous_title, current_title, previous_hash, current_hash")
        .in("website_id", ids).order("detected_at", { ascending: false }).limit(1000);
      if (start) {
        checksQuery = checksQuery.gte("checked_at", start);
        changesQuery = changesQuery.gte("detected_at", start);
      }
      if (endDate) {
        checksQuery = checksQuery.lte("checked_at", endDate);
        changesQuery = changesQuery.lte("detected_at", endDate);
      }
      const [checkResult, changeResult] = await Promise.all([checksQuery, changesQuery]);
      if (!active) return;
      if (checkResult.error || changeResult.error) {
        console.error("TapeWatch report data failed:", checkResult.error || changeResult.error);
        setError("Report records could not be loaded. Check the workspace connection and try again.");
        setChecks([]);
        setChanges([]);
      } else {
        setChecks((checkResult.data ?? []) as Check[]);
        setChanges((changeResult.data ?? []) as Change[]);
      }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [sites, siteId, from, to, refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => setRefresh((value) => value + 1), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const siteUrl = (id: string) => sites.find((site) => site.id === id)?.url ?? "Website record";
  const failedChecks = checks.filter((item) => item.status === "http_error" || item.status === "unreachable");
  const events = useMemo(() => [
    ...checks.map((item) => ({ id: "check-" + item.id, at: item.checked_at, site: item.website_id, type: "Website check", result: item.status, detail: [item.http_status ? "HTTP " + item.http_status : "", item.error_message || item.page_title || ""].filter(Boolean).join(" · ") })),
    ...changes.map((item) => ({ id: "change-" + item.id, at: item.detected_at, site: item.website_id, type: "Content change", result: item.change_type, detail: (item.previous_title || "Previous version") + " → " + (item.current_title || "Current version") })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), [checks, changes]);

  function exportCsv() {
    const rows = [["Timestamp", "Website", "Event", "Result", "Details"], ...events.map((item) => [item.at, siteUrl(item.site), item.type, item.result, item.detail])];
    const csv = rows.map((row) => row.map((value) => '"' + String(value ?? "").replace(/"/g, '""') + '"').join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tapewatch-report-" + from + "-to-" + to + ".csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="content module-workspace reports-workspace" id="reports">
      <div className="workspace-title-row">
        <div><div className="eyebrow">SHAREABLE EVIDENCE</div><h1>Transparency reports<span>.</span></h1><p className="intro">Build a dated summary from saved website checks and recorded content changes.</p></div>
        <div className="reports-actions"><button className="secondary-button" type="button" onClick={() => window.print()}>Print report</button><button className="primary-button" type="button" onClick={exportCsv} disabled={loading || events.length === 0}>Export CSV</button></div>
      </div>
      <section className="section-card reports-filter-card">
        <div className="section-heading"><div><h2>Report scope</h2><p>Choose the website and observation period to include.</p></div><span className="coming-soon">SAVED EVIDENCE</span></div>
        <div className="reports-controls">
          <label>Website<select value={siteId} onChange={(event) => setSiteId(event.target.value)}><option value="all">All saved websites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.url}</option>)}</select></label>
          <label>From<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>To<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
          <button className="secondary-button" type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loading}>Refresh</button>
        </div>
      </section>
      <div className="reports-summary-grid">
        <article className="reports-summary-card"><span>WEBSITE CHECKS</span><strong>{loading ? "…" : checks.length}</strong><p>Saved observations in range</p></article>
        <article className="reports-summary-card"><span>AVAILABILITY ERRORS</span><strong>{loading ? "…" : failedChecks.length}</strong><p>HTTP errors or unreachable checks</p></article>
        <article className="reports-summary-card"><span>CONTENT CHANGES</span><strong>{loading ? "…" : changes.length}</strong><p>Recorded fingerprint differences</p></article>
      </div>
      <section className="section-card reports-evidence-card">
        <div className="section-heading"><div><h2>Evidence timeline</h2><p>{events.length} records · newest first · maximum 1,000 checks and 1,000 changes per report.</p></div><span className="coming-soon">{loading ? "LOADING" : "OBSERVATIONS"}</span></div>
        {loading ? <div className="changes-feed-state">Preparing report…</div> : error ? <div className="changes-feed-state"><p>{error}</p><button className="secondary-button" onClick={() => setRefresh((value) => value + 1)}>Try again</button></div> : !sites.length ? <div className="changes-empty"><h3>No websites saved yet</h3><p>Add a website and collect monitoring records before creating a report.</p></div> : !events.length ? <div className="changes-empty"><h3>No evidence in this period</h3><p>There are no saved checks or content changes for the selected scope and dates.</p></div> : <div className="reports-table-wrap"><table className="reports-table"><thead><tr><th>Time</th><th>Website</th><th>Event</th><th>Result</th><th>Details</th></tr></thead><tbody>{events.map((item) => <tr key={item.id}><td>{new Date(item.at).toLocaleString()}</td><td>{siteUrl(item.site)}</td><td>{item.type}</td><td>{item.result}</td><td>{item.detail || "No additional detail recorded"}</td></tr>)}</tbody></table></div>}
      </section>
      <div className="reports-evidence-note"><strong>Evidence limitations.</strong> This report contains records actually saved by TapeWatch. A content difference is not automatically a security issue, and a successful check is not a cryptographic verification. CSV exports include the displayed observation records; no missing data is inferred.</div>
    </div>
  );
}
