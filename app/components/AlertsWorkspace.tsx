"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type Site = { id: string; url: string };
type AlertRecord = {
  id: string;
  website_id: string;
  at: string;
  kind: "availability" | "change";
  title: string;
  detail: string;
  status: string;
};

export default function AlertsWorkspace({ sites }: { sites: Site[] }) {
  const [records, setRecords] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "availability" | "change">("all");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) {
        setError("The database connection is not configured.");
        setRecords([]);
        setLoading(false);
        return;
      }
      if (!sites.length) {
        setRecords([]);
        setError("");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      const ids = sites.map((site) => site.id);
      const [checks, changes] = await Promise.all([
        supabase.from("website_checks")
          .select("id, website_id, checked_at, status, http_status, error_message")
          .in("website_id", ids).order("checked_at", { ascending: false }).limit(100),
        supabase.from("website_changes")
          .select("id, website_id, detected_at, change_type, previous_title, current_title")
          .in("website_id", ids).order("detected_at", { ascending: false }).limit(100),
      ]);
      if (!active) return;
      if (checks.error || changes.error) {
        console.error("TapeWatch alerts feed failed:", checks.error || changes.error);
        setError("Alerts could not be loaded. Check your workspace connection and try again.");
        setRecords([]);
        setLoading(false);
        return;
      }
      const availability: AlertRecord[] = (checks.data ?? [])
        .filter((item) => item.status === "http_error" || item.status === "unreachable")
        .map((item) => ({
          id: "check-" + item.id,
          website_id: item.website_id,
          at: item.checked_at,
          kind: "availability",
          title: item.status === "http_error" ? "Website returned an HTTP error" : "Website could not be reached",
          detail: [item.http_status ? "HTTP " + item.http_status : "", item.error_message || item.status.replaceAll("_", " ")].filter(Boolean).join(" · "),
          status: item.status,
        }));
      const contentChanges: AlertRecord[] = (changes.data ?? []).map((item) => ({
        id: "change-" + item.id,
        website_id: item.website_id,
        at: item.detected_at,
        kind: "change",
        title: "Website content changed",
        detail: (item.previous_title || "Previous version") + " → " + (item.current_title || "New version"),
        status: item.change_type,
      }));
      setRecords([...availability, ...contentChanges].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)));
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [sites, refreshKey]);

  const filtered = useMemo(() => filter === "all" ? records : records.filter((item) => item.kind === filter), [records, filter]);
  const availabilityCount = records.filter((item) => item.kind === "availability").length;
  const changeCount = records.filter((item) => item.kind === "change").length;
  const siteUrl = useCallback((id: string) => sites.find((site) => site.id === id)?.url || "Website record", [sites]);

  return (
    <div className="content module-workspace alerts-workspace" id="alerts">
      <div className="workspace-title-row">
        <div><div className="eyebrow">MONITORING MANAGEMENT</div><h1>Alerts centre<span>.</span></h1><p className="intro">Review availability problems and detected website changes from your saved monitoring evidence.</p></div>
        <button className="secondary-button" type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>Refresh alerts</button>
      </div>
      <div className="alerts-summary-grid">
        <article className="alerts-summary-card"><span>ALL ALERTS</span><strong>{loading ? "…" : records.length}</strong><p>Saved alert events</p></article>
        <article className="alerts-summary-card"><span>AVAILABILITY</span><strong>{loading ? "…" : availabilityCount}</strong><p>HTTP errors or unreachable checks</p></article>
        <article className="alerts-summary-card"><span>CONTENT CHANGES</span><strong>{loading ? "…" : changeCount}</strong><p>Fingerprint differences detected</p></article>
      </div>
      <section className="section-card alerts-records-card">
        <div className="section-heading"><div><h2>Recent alert events</h2><p>Derived from saved website checks and change records. Latest 200 events.</p></div><span className="coming-soon">{loading ? "LOADING" : "SAVED RECORDS"}</span></div>
        <div className="alerts-filters" aria-label="Filter alerts">
          {(["all", "availability", "change"] as const).map((value) => <button key={value} type="button" className={filter === value ? "alerts-filter active" : "alerts-filter"} onClick={() => setFilter(value)}>{value === "all" ? "All alerts" : value === "availability" ? "Availability" : "Content changes"}</button>)}
        </div>
        {loading ? <div className="changes-feed-state">Loading alert events…</div> : error ? <div className="changes-feed-state"><p>{error}</p><button className="secondary-button" onClick={() => setRefreshKey((value) => value + 1)}>Try again</button></div> : filtered.length === 0 ? <div className="changes-empty"><h3>No matching alerts</h3><p>{records.length ? "There are no events in this filter." : "When a saved check detects an availability problem or a fingerprint difference, it will appear here."}</p></div> : <div className="alerts-list">{filtered.map((item) => <article className="alerts-item" key={item.id}><div className="alerts-item-mark">{item.kind === "availability" ? "!" : "↗"}</div><div className="alerts-item-main"><div className="alerts-item-top"><strong>{item.title}</strong><time>{new Date(item.at).toLocaleString()}</time></div><div className="alerts-item-site">{siteUrl(item.website_id)}</div><p>{item.detail}</p><span className={item.kind === "availability" ? "alerts-kind alerts-kind-warning" : "alerts-kind"}>{item.kind === "availability" ? "AVAILABILITY" : "CONTENT CHANGE"}</span></div></article>)}</div>}
      </section>
      <div className="alerts-evidence-note"><strong>Evidence-based alerts.</strong> These are in-app events built from saved records. Email, push delivery, user-configurable alert rules, and persisted verification alerts are not enabled yet. A content difference is an observation, not automatically a security issue.</div>
    </div>
  );
}
