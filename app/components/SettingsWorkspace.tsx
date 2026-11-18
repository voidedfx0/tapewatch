"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type Site = { id: string; url: string };
type Section = "workspace" | "monitoring" | "alerts" | "services" | "data" | "security";
type Health = "checking" | "connected" | "disconnected" | "not-configured";

const sections: { id: Section; label: string; description: string; icon: string }[] = [
  { id: "workspace", label: "Workspace", description: "Profile and local preferences", icon: "◈" },
  { id: "monitoring", label: "Monitoring", description: "Scheduled checks and coverage", icon: "⌁" },
  { id: "alerts", label: "Alerts", description: "Alert sources and delivery", icon: "◉" },
  { id: "services", label: "Connected services", description: "Database and network health", icon: "⌘" },
  { id: "data", label: "Data management", description: "Export your saved records", icon: "▤" },
  { id: "security", label: "Security", description: "Session and configuration status", icon: "⬡" },
];

function Status({ state, children }: { state: Health | "active" | "limited"; children: React.ReactNode }) {
  return <span className={`settings-status settings-status-${state}`}><i />{children}</span>;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function SettingsWorkspace({ sites }: { sites: Site[] }) {
  const [section, setSection] = useState<Section>("workspace");
  const [workspaceName, setWorkspaceName] = useState("TapeWatch Workspace");
  const [savedName, setSavedName] = useState("TapeWatch Workspace");
  const [monitoringCount, setMonitoringCount] = useState<number | null>(null);
  const [monitoringTotal, setMonitoringTotal] = useState<number | null>(null);
  const [monitoringLoading, setMonitoringLoading] = useState(true);
  const [databaseHealth, setDatabaseHealth] = useState<Health>("checking");
  const [networkHealth, setNetworkHealth] = useState<Health>("checking");
  const [networkDetail, setNetworkDetail] = useState("Checking X Layer RPC");
  const [sessionActive, setSessionActive] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("tapewatch.workspace-name");
      if (stored?.trim()) {
        setWorkspaceName(stored);
        setSavedName(stored);
      }
    } catch {
      // Browser storage can be unavailable; the default remains usable.
    }
  }, []);

  const runDiagnostics = useCallback(async () => {
    setChecking(true);
    setDatabaseHealth(supabase ? "checking" : "not-configured");
    setNetworkHealth("checking");
    setNetworkDetail("Checking X Layer RPC");
    if (supabase) {
      const [dbResult, sessionResult] = await Promise.all([
        supabase.from("websites").select("id", { count: "exact", head: true }),
        supabase.auth.getSession(),
      ]);
      setDatabaseHealth(dbResult.error ? "disconnected" : "connected");
      setSessionActive(Boolean(sessionResult.data.session));
    } else {
      setDatabaseHealth("not-configured");
      setSessionActive(false);
    }
    try {
      const response = await fetch("/api/network/xlayer", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok || payload.chainId !== 196) {
        throw new Error(payload.error || "X Layer RPC health check failed.");
      }
      setNetworkHealth("connected");
      setNetworkDetail(`Chain ID 196 · latest block ${payload.blockNumber}`);
    } catch (error) {
      setNetworkHealth("disconnected");
      setNetworkDetail(error instanceof Error ? error.message : "X Layer RPC is unavailable.");
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    void runDiagnostics();
  }, [runDiagnostics]);

  useEffect(() => {
    let active = true;
    async function loadMonitoring() {
      if (!supabase || sites.length === 0) {
        setMonitoringCount(0);
        setMonitoringTotal(sites.length);
        setMonitoringLoading(false);
        return;
      }
      setMonitoringLoading(true);
      const { data, error } = await supabase
        .from("website_monitoring_settings")
        .select("website_id, enabled, frequency")
        .in("website_id", sites.map((site) => site.id));
      if (!active) return;
      if (error) {
        setMonitoringCount(null);
        setMonitoringTotal(sites.length);
      } else {
        setMonitoringCount((data ?? []).filter((row) => row.enabled).length);
        setMonitoringTotal(sites.length);
      }
      setMonitoringLoading(false);
    }
    void loadMonitoring();
    return () => { active = false; };
  }, [sites]);

  function saveWorkspaceName() {
    const clean = workspaceName.trim();
    if (!clean) {
      setMessage("Enter a workspace name before saving.");
      return;
    }
    try {
      window.localStorage.setItem("tapewatch.workspace-name", clean);
      setWorkspaceName(clean);
      setSavedName(clean);
      setMessage("Workspace name saved on this browser.");
    } catch {
      setMessage("This browser did not allow local storage. The name was not saved.");
    }
  }

  async function exportWorkspace() {
    if (!supabase) {
      setMessage("The database connection is not configured, so records cannot be exported.");
      return;
    }
    if (!sites.length) {
      downloadJson("tapewatch-workspace-export.json", { exportedAt: new Date().toISOString(), websites: [], checks: [], changes: [] });
      setMessage("Exported an empty workspace because no websites are saved.");
      return;
    }
    setExporting(true);
    setMessage("");
    const ids = sites.map((site) => site.id);
    const [checksResult, changesResult] = await Promise.all([
      supabase.from("website_checks")
        .select("id, website_id, checked_at, status, http_status, final_url, content_hash, page_title, error_message")
        .in("website_id", ids).order("checked_at", { ascending: false }).limit(5000),
      supabase.from("website_changes")
        .select("id, website_id, detected_at, change_type, previous_check_id, current_check_id, previous_hash, current_hash, previous_title, current_title")
        .in("website_id", ids).order("detected_at", { ascending: false }).limit(5000),
    ]);
    if (checksResult.error || changesResult.error) {
      setMessage("Export failed. No records were changed. Please retry after checking the database connection.");
    } else {
      downloadJson("tapewatch-workspace-export.json", {
        exportedAt: new Date().toISOString(),
        note: "Export is limited to records returned by the current workspace session and up to 5,000 checks and 5,000 changes.",
        websites: sites,
        checks: checksResult.data ?? [],
        changes: changesResult.data ?? [],
      });
      setMessage("Workspace export created. Up to 5,000 checks and 5,000 changes are included.");
    }
    setExporting(false);
  }

  const activeSection = sections.find((item) => item.id === section) ?? sections[0];

  return (
    <div className="content settings-workspace" id="settings">
      <div className="workspace-title-row settings-title-row">
        <div><div className="eyebrow">WORKSPACE CONTROL</div><h1>Settings<span>.</span></h1><p className="intro">Manage your workspace, monitoring, connected services and data controls.</p></div>
        <button className="secondary-button settings-refresh" type="button" onClick={() => void runDiagnostics()} disabled={checking}>{checking ? "Checking…" : "Refresh diagnostics"}</button>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map((item) => (
            <button type="button" key={item.id} className={section === item.id ? "settings-nav-item active" : "settings-nav-item"} onClick={() => { setSection(item.id); setMessage(""); }}>
              <span className="settings-nav-icon">{item.icon}</span><span><strong>{item.label}</strong><small>{item.description}</small></span><b>›</b>
            </button>
          ))}
        </nav>
        <section className="settings-panel">
          <div className="settings-panel-heading"><div><span className="settings-kicker">SETTINGS / {activeSection.label.toUpperCase()}</span><h2>{activeSection.label}</h2><p>{activeSection.description}</p></div></div>

          {section === "workspace" && <div className="settings-stack">
            <article className="settings-card"><div className="settings-card-heading"><div><h3>Workspace profile</h3><p>Choose a label for this workspace on this browser.</p></div><Status state="active">LOCAL PREFERENCE</Status></div>
              <label className="settings-field">Workspace name<input value={workspaceName} maxLength={60} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="TapeWatch Workspace" /></label>
              <div className="settings-actions"><button className="primary-button" type="button" onClick={saveWorkspaceName}>Save workspace name</button><span>Current saved name: {savedName}</span></div>
              <p className="settings-footnote">This label is stored in this browser only. It does not rename your Supabase project, GitHub repository or Vercel project.</p>
            </article>
            <article className="settings-card"><div className="settings-card-heading"><div><h3>Workspace overview</h3><p>Current workspace inventory.</p></div></div><div className="settings-stat-grid"><div><span>SAVED WEBSITES</span><strong>{sites.length}</strong></div><div><span>MONITORED WEBSITES</span><strong>{monitoringLoading ? "…" : monitoringCount ?? "—"}</strong></div><div><span>DEFAULT FREQUENCY</span><strong>Daily</strong></div></div></article>
          </div>}

          {section === "monitoring" && <div className="settings-stack">
            <article className="settings-card"><div className="settings-card-heading"><div><h3>Monitoring coverage</h3><p>Live counts from your saved website monitoring settings.</p></div><Status state={monitoringLoading ? "checking" : monitoringCount === null ? "disconnected" : "active"}>{monitoringLoading ? "LOADING" : monitoringCount === null ? "UNAVAILABLE" : "DATABASE RECORDS"}</Status></div>
              <div className="settings-stat-grid"><div><span>SAVED WEBSITES</span><strong>{sites.length}</strong></div><div><span>DAILY MONITORING ON</span><strong>{monitoringLoading ? "…" : monitoringCount ?? "—"}</strong></div><div><span>PAUSED / NOT SET</span><strong>{monitoringLoading || monitoringCount === null ? "—" : Math.max(0, sites.length - monitoringCount)}</strong></div></div>
              <div className="settings-info-row"><span>Supported schedule</span><strong>Daily checks</strong></div><div className="settings-info-row"><span>Where to change an individual schedule</span><strong>Websites → select a site → Settings</strong></div>
              <p className="settings-footnote">Daily is the only schedule currently supported by the monitoring workflow. Workspace-wide frequency overrides are not available, so no unsupported intervals are offered here.</p>
            </article>
          </div>}

          {section === "alerts" && <div className="settings-stack">
            <article className="settings-card"><div className="settings-card-heading"><div><h3>In-app alert sources</h3><p>Alerts are currently derived from saved monitoring evidence.</p></div><Status state="limited">IN-APP ONLY</Status></div>
              <div className="settings-info-row"><span>Website availability events</span><strong>Shown in Alerts Centre</strong></div><div className="settings-info-row"><span>Detected content changes</span><strong>Shown in Alerts Centre</strong></div><div className="settings-info-row"><span>Email and push delivery</span><strong>Not configured</strong></div><div className="settings-info-row"><span>Custom severity rules</span><strong>Not available yet</strong></div>
              <p className="settings-footnote">This page does not offer notification switches that would appear to work without a delivery service. Review current records in the Alerts section.</p>
            </article>
          </div>}

          {section === "services" && <div className="settings-stack">
            <article className="settings-card"><div className="settings-card-heading"><div><h3>Supabase</h3><p>Workspace database and saved monitoring records.</p></div><Status state={databaseHealth}>{databaseHealth === "checking" ? "CHECKING" : databaseHealth === "connected" ? "CONNECTED" : databaseHealth === "not-configured" ? "NOT CONFIGURED" : "CONNECTION ERROR"}</Status></div><p className="settings-service-detail">Health check: read-only query against the websites table.</p></article>
            <article className="settings-card"><div className="settings-card-heading"><div><h3>X Layer</h3><p>Public read-only network RPC.</p></div><Status state={networkHealth}>{networkHealth === "checking" ? "CHECKING" : networkHealth === "connected" ? "CONNECTED" : "UNAVAILABLE"}</Status></div><p className="settings-service-detail">{networkDetail}</p><p className="settings-footnote">The RPC endpoint is checked through TapeWatch’s server route. No wallet connection or signing is used.</p></article>
          </div>}

          {section === "data" && <div className="settings-stack">
            <article className="settings-card"><div className="settings-card-heading"><div><h3>Export workspace data</h3><p>Download saved website records and their available monitoring evidence.</p></div><Status state="active">READ ONLY</Status></div>
              <div className="settings-info-row"><span>Included</span><strong>Websites, checks and detected changes</strong></div><div className="settings-info-row"><span>Export format</span><strong>JSON</strong></div><div className="settings-info-row"><span>Record limit</span><strong>Up to 5,000 checks + 5,000 changes</strong></div>
              <div className="settings-actions"><button className="primary-button" type="button" onClick={() => void exportWorkspace()} disabled={exporting}>{exporting ? "Preparing export…" : "Export workspace data"}</button></div>
              <p className="settings-footnote">Export respects the current workspace session and database access policies. This action does not modify or delete saved records.</p>
            </article>
          </div>}

          {section === "security" && <div className="settings-stack">
            <article className="settings-card"><div className="settings-card-heading"><div><h3>Workspace session</h3><p>Authentication state reported by the current Supabase client.</p></div><Status state={sessionActive === null ? "checking" : sessionActive ? "connected" : "disconnected"}>{sessionActive === null ? "CHECKING" : sessionActive ? "SESSION ACTIVE" : "NO ACTIVE SESSION"}</Status></div><p className="settings-service-detail">Session tokens and secret values are never displayed in Settings.</p></article>
            <article className="settings-card"><div className="settings-card-heading"><div><h3>Configuration safety</h3><p>Only configuration presence and service health are shown.</p></div><Status state={databaseHealth === "connected" ? "active" : "limited"}>{databaseHealth === "connected" ? "DATABASE CHECK PASSED" : "REVIEW CONNECTION"}</Status></div><div className="settings-info-row"><span>Supabase client configuration</span><strong>{supabase ? "Present" : "Missing"}</strong></div><div className="settings-info-row"><span>Secret values</span><strong>Hidden</strong></div><div className="settings-info-row"><span>Data deletion controls</span><strong>Not provided here</strong></div><p className="settings-footnote">This is a basic connection and session overview, not a full security audit or access-control manager.</p></article>
          </div>}

          {message && <p className="settings-message" role="status">{message}</p>}
          <div className="settings-bottom-note">Evidence-first controls · Existing website records are preserved · No secrets are exposed</div>
        </section>
      </div>
    </div>
  );
}
