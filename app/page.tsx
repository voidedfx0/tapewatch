"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type Site = { id: string; url: string; status: "Setup draft" };
type WebsiteCheck = { id: string; checked_at: string; status: string; http_status: number | null; final_url: string | null; content_hash: string | null; page_title: string | null; error_message: string | null };
type WebsiteChange = { id: string; detected_at: string; change_type: string; previous_check_id: string | null; current_check_id: string; previous_hash: string | null; current_hash: string | null; previous_title: string | null; current_title: string | null };
type MonitoringSetting = { id: string; website_id: string; user_id: string; enabled: boolean; frequency: "daily"; last_run_at: string | null; next_run_at: string | null };
type IntelligenceProfile = { id: string; website_id: string; business_name: string | null; summary: string | null; purpose: string | null; services: string[]; target_audience: string | null; key_topics: string[]; important_pages: { type: string; label: string; url: string }[]; source_urls: string[]; social_profiles: { platform: string; url: string }[]; pages_analyzed: { url: string; title: string | null; description: string | null }[]; confidence: string | null; analyzed_at: string | null };

const initialSites: Site[] = [];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.8Z"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    file: <><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
  };
  return <svg {...common}>{paths[name] ?? paths.grid}</svg>;
}

export default function Home() {
  const [sites, setSites] = useState<Site[]>(initialSites);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [savingSite, setSavingSite] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [activeSection, setActiveSection] = useState("");
  const [detailTab, setDetailTab] = useState<"overview" | "intelligence" | "changes" | "checks" | "timeline" | "settings">("overview");
  const [intelligenceProfile, setIntelligenceProfile] = useState<IntelligenceProfile | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [analyzingIntelligence, setAnalyzingIntelligence] = useState(false);
  const [checks, setChecks] = useState<WebsiteCheck[]>([]);
  const [changes, setChanges] = useState<WebsiteChange[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [checksLoading, setChecksLoading] = useState(false);
  const [checkingWebsite, setCheckingWebsite] = useState(false);
  const [compareOlderId, setCompareOlderId] = useState("");
  const [compareNewerId, setCompareNewerId] = useState("");
  const [verifyingCheckId, setVerifyingCheckId] = useState("");
  const [verificationResult, setVerificationResult] = useState<{ checkId: string; status: "verified" | "mismatch" | "unavailable"; message: string; verifiedAt: string } | null>(null);
  const [monitoringSetting, setMonitoringSetting] = useState<MonitoringSetting | null>(null);
  const [monitoredSiteIds, setMonitoredSiteIds] = useState<string[]>([]);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [savingMonitoring, setSavingMonitoring] = useState(false);


  useEffect(() => {
    let active = true;

    async function loadWebsites() {
      if (!supabase) {
        if (active) {
          setNotice("Supabase is not configured. Check the Vercel environment variables.");
          setSitesLoading(false);
        }
        return;
      }

      try {
        let { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (!session) {
          const { data, error } = await supabase.auth.signInAnonymously();
          if (error) throw error;
          session = data.session;
        }

        if (!session) throw new Error("A secure workspace session could not be created.");

        const { data, error } = await supabase
          .from("websites")
          .select("id, url, status")
          .order("created_at", { ascending: false });

        if (error) throw error;
        if (active) setSites((data ?? []) as Site[]);

        const { data: monitoringRows, error: monitoringError } = await supabase
          .from("website_monitoring_settings")
          .select("website_id")
          .eq("enabled", true);
        if (monitoringError) {
          console.error("TapeWatch active monitoring list failed:", monitoringError);
        } else if (active) {
          setMonitoredSiteIds((monitoringRows ?? []).map((row) => row.website_id as string));
        }
      } catch (error) {
        console.error("TapeWatch website loading failed:", error);
        if (active) setNotice(error instanceof Error ? error.message : "Could not load your saved websites.");
      } finally {
        if (active) setSitesLoading(false);
      }
    }

    void loadWebsites();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadChecks() {
      if (!selectedSite || !supabase) {
        setChecks([]);
        return;
      }
      setChecksLoading(true);
      const { data, error } = await supabase
        .from("website_checks")
        .select("id, checked_at, status, http_status, final_url, content_hash, page_title, error_message")
        .eq("website_id", selectedSite.id)
        .order("checked_at", { ascending: false });
      if (active) {
        if (error) {
          console.error("TapeWatch check history loading failed:", error);
          setNotice("Could not load this website's check history.");
        } else {
          setChecks((data ?? []) as WebsiteCheck[]);
        }
        setChecksLoading(false);
      }
    }
    void loadChecks();
    return () => { active = false; };
  }, [selectedSite?.id]);
  
  useEffect(() => {
    let active = true;
    async function loadMonitoringSetting() {
      if (!selectedSite || !supabase) {
        setMonitoringSetting(null);
        return;
      }
      setMonitoringLoading(true);
      const { data, error } = await supabase
        .from("website_monitoring_settings")
        .select("id, website_id, user_id, enabled, frequency, last_run_at, next_run_at")
        .eq("website_id", selectedSite.id)
        .maybeSingle();
      if (active) {
        if (error) {
          console.error("TapeWatch monitoring settings loading failed:", error);
          setNotice("Could not load this website's monitoring settings.");
          setMonitoringSetting(null);
        } else {
          setMonitoringSetting(data as MonitoringSetting | null);
        }
        setMonitoringLoading(false);
      }
    }
    void loadMonitoringSetting();
    return () => { active = false; };
  }, [selectedSite?.id]);

  useEffect(() => {
    let active = true;
    async function loadIntelligenceProfile() {
      if (!selectedSite || !supabase) {
        setIntelligenceProfile(null);
        return;
      }
      setIntelligenceLoading(true);
      const { data, error } = await supabase
        .from("website_intelligence_profiles")
        .select("id, website_id, business_name, summary, purpose, services, target_audience, key_topics, important_pages, source_urls, social_profiles, pages_analyzed, confidence, analyzed_at")
        .eq("website_id", selectedSite.id)
        .maybeSingle();
      if (active) {
        if (error) {
          console.error("TapeWatch intelligence profile loading failed:", error);
          setNotice("Could not load this website's intelligence profile.");
          setIntelligenceProfile(null);
        } else {
          setIntelligenceProfile(data as IntelligenceProfile | null);
        }
        setIntelligenceLoading(false);
      }
    }
    void loadIntelligenceProfile();
    return () => { active = false; };
  }, [selectedSite?.id]);

  useEffect(() => {
    let active = true;
    async function loadChanges() {
      if (!selectedSite || !supabase) {
        setChanges([]);
        return;
      }
      setChangesLoading(true);
      const { data, error } = await supabase
        .from("website_changes")
        .select("id, detected_at, change_type, previous_check_id, current_check_id, previous_hash, current_hash, previous_title, current_title")
        .eq("website_id", selectedSite.id)
        .order("detected_at", { ascending: false });
      if (active) {
        if (error) {
          console.error("TapeWatch change history loading failed:", error);
          setNotice("Could not load this website's change history.");
        } else {
          setChanges((data ?? []) as WebsiteChange[]);
        }
        setChangesLoading(false);
      }
    }
    void loadChanges();
    return () => { active = false; };
  }, [selectedSite?.id]);

  useEffect(() => {
    if (checks.length >= 2) {
      setCompareNewerId((current) => current || checks[0].id);
      setCompareOlderId((current) => current || checks[1].id);
    } else {
      setCompareNewerId("");
      setCompareOlderId("");
    }
  }, [checks, selectedSite?.id]);

  const compareOlder = checks.find((check) => check.id === compareOlderId) ?? null;
  const compareNewer = checks.find((check) => check.id === compareNewerId) ?? null;
  const comparisonReady = Boolean(compareOlder && compareNewer && compareOlder.id !== compareNewer.id);
  const fingerprintsMatch = comparisonReady && compareOlder?.content_hash && compareNewer?.content_hash
    ? compareOlder.content_hash === compareNewer.content_hash
    : null;

  const filteredSites = useMemo(() => sites.filter((site) => site.url.toLowerCase().includes(query.toLowerCase())), [sites, query]);
  const timelineEvents = useMemo(() => [
    ...checks.map((check) => ({ id: "check-" + check.id, at: check.checked_at, kind: "check", category: "OBSERVATION", title: check.status === "reachable" ? "Website check completed" : check.status === "reachable_partial" ? "Partial website capture" : check.status === "http_error" ? "Website returned an HTTP error" : "Website check unavailable", detail: (check.http_status ? "HTTP " + check.http_status + " · " : "") + (check.page_title || check.status.replaceAll("_", " ")), hash: check.content_hash, checkId: check.id, status: check.status, httpStatus: check.http_status, finalUrl: check.final_url, errorMessage: check.error_message, previousHash: null as string | null, currentHash: null as string | null, previousCheckId: null as string | null, currentCheckId: null as string | null })),
    ...changes.map((change) => ({ id: "change-" + change.id, at: change.detected_at, kind: "change", category: "DETECTED CHANGE", title: "Content fingerprint changed", detail: (change.previous_title || "Previous version") + " → " + (change.current_title || "New version"), hash: change.current_hash, checkId: null as string | null, status: change.change_type, httpStatus: null as number | null, finalUrl: null as string | null, errorMessage: null as string | null, previousHash: change.previous_hash, currentHash: change.current_hash, previousCheckId: change.previous_check_id, currentCheckId: change.current_check_id })),
    ...(verificationResult ? [{ id: "verification-" + verificationResult.checkId, at: verificationResult.verifiedAt, kind: "verification", category: "LIVE COMPARISON · SESSION ONLY", title: verificationResult.status === "verified" ? "Live fingerprint matched saved evidence" : verificationResult.status === "mismatch" ? "Live fingerprint differed from saved evidence" : "Live fingerprint comparison unavailable", detail: verificationResult.message, hash: null as string | null, checkId: verificationResult.checkId, status: verificationResult.status, httpStatus: null as number | null, finalUrl: null as string | null, errorMessage: null as string | null, previousHash: null as string | null, currentHash: null as string | null, previousCheckId: null as string | null, currentCheckId: null as string | null }] : []),
  ].sort((a,b) => new Date(b.at).getTime()-new Date(a.at).getTime()), [checks, changes, verificationResult]);
  const sectionContent: Record<string, { title: string; eyebrow: string; description: string; items: { title: string; description: string; state: string }[] }> = {
    circuits: { title: "Circuit intelligence", eyebrow: "ECOSYSTEM", description: "Explore supported circuit references and the website records associated with them. Contract sources will be added only after they are validated.", items: [{ title: "Circuit directory", description: "A searchable catalogue of supported circuit records.", state: "SOURCE REVIEW PENDING" }, { title: "Ownership activity", description: "Relevant ownership changes from verified on-chain events.", state: "AWAITING EVENTS" }, { title: "Linked websites", description: "Websites associated with each supported circuit.", state: "AWAITING DATA" }] },
    networks: { title: "Network explorer", eyebrow: "ECOSYSTEM", description: "Review network support and connection health. A listed network does not imply that TapeWatch is connected to it.", items: [{ title: "X Layer", description: "Planned first network integration. Read-only connection is not active.", state: "NOT CONNECTED" }, { title: "Network registry", description: "Supported chain identifiers, explorers and verified data sources.", state: "PLANNED" }, { title: "Source health", description: "RPC and indexer availability once integrations are configured.", state: "NOT CONNECTED" }] },
    timeline: { title: "Trust timeline", eyebrow: "EVIDENCE HISTORY", description: "A chronological record connecting website observations, integrity checks and relevant on-chain events.", items: [{ title: "Website observations", description: "Timestamped snapshots and detected differences.", state: "AWAITING MONITORING" }, { title: "Verification events", description: "Hash comparisons and source-backed verification outcomes.", state: "AWAITING VERIFICATION" }, { title: "On-chain activity", description: "Relevant circuit and ownership events from supported networks.", state: "AWAITING EVENTS" }] },
    alerts: { title: "Alerts centre", eyebrow: "MONITORING MANAGEMENT", description: "Configure and review notifications for meaningful changes after monitoring sources are connected.", items: [{ title: "Website availability", description: "Potential downtime and recovery notifications.", state: "NOT ACTIVE" }, { title: "Website changes", description: "Notifications when monitored content or files differ.", state: "NOT ACTIVE" }, { title: "Verification issues", description: "Alerts for failed or inconclusive evidence checks.", state: "NOT ACTIVE" }] },
    reports: { title: "Transparency reports", eyebrow: "SHAREABLE EVIDENCE", description: "Create clear, shareable summaries of a website's monitoring history and available integrity evidence.", items: [{ title: "Website integrity report", description: "A summary of observations, checks and known limitations.", state: "PLANNED" }, { title: "Public verification page", description: "A public-facing page for inspecting supported evidence.", state: "PLANNED" }, { title: "Export history", description: "Downloadable records with timestamps and source references.", state: "PLANNED" }] },
    settings: { title: "Workspace settings", eyebrow: "PREFERENCES", description: "Manage workspace preferences, monitoring defaults and future integrations.", items: [{ title: "Workspace profile", description: "Workspace name and account preferences.", state: "BASIC PREVIEW" }, { title: "Monitoring defaults", description: "Default check intervals and notification preferences.", state: "NOT ACTIVE" }, { title: "Connected services", description: "Manage approved network and data-source connections.", state: "NOT CONNECTED" }] }
  };

  function openSection(section: string) {
    setSelectedSite(null);
    setShowChanges(section === "changes");
    setActiveSection(section === "changes" || section === "overview" || section === "websites" ? "" : section);
  }

  async function addSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!/^https?:\/\/.+\..+/.test(trimmed)) {
      setNotice("Enter a complete website address, including https://");
      return;
    }
    if (!supabase) {
      setNotice("Supabase is not configured. Check the Vercel environment variables.");
      return;
    }

    let normalizedUrl = trimmed;
    try {
      const parsed = new URL(trimmed);
      parsed.hash = "";
      normalizedUrl = parsed.toString().replace(/\/$/, "");
    } catch {
      setNotice("Enter a valid website address, including https://");
      return;
    }

    setSavingSite(true);
    setNotice("");
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) throw new Error("Your workspace session is not ready. Refresh and try again.");

      const { data, error } = await supabase
        .from("websites")
        .insert({
          user_id: session.user.id,
          url: trimmed,
          normalized_url: normalizedUrl,
          status: "Setup draft",
        })
        .select("id, url, status")
        .single();

      if (error) {
        if (error.code === "23505") throw new Error("This website is already in your watchlist.");
        throw error;
      }

      setSites((current) => [data as Site, ...current]);
      setUrl("");
      setShowAdd(false);
      setNotice("Website saved to your TapeWatch workspace. Monitoring has not started yet.");
    } catch (error) {
      console.error("TapeWatch website save failed:", error);
      setNotice(error instanceof Error ? error.message : "Could not save this website. Please try again.");
    } finally {
      setSavingSite(false);
    }
  }

  async function toggleDailyMonitoring(enabled: boolean) {
    if (!selectedSite || !supabase) return;
    setSavingMonitoring(true);
    setNotice("");
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.user?.id) throw new Error("Your workspace session is not ready. Refresh and try again.");
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("website_monitoring_settings")
        .upsert({
          website_id: selectedSite.id,
          user_id: session.user.id,
          enabled,
          frequency: "daily",
          next_run_at: enabled ? (monitoringSetting?.next_run_at || now) : null,
          updated_at: now,
        }, { onConflict: "website_id" })
        .select("id, website_id, user_id, enabled, frequency, last_run_at, next_run_at")
        .single();
      if (error) throw error;
      setMonitoringSetting(data as MonitoringSetting);
      setMonitoredSiteIds((current) => enabled
        ? Array.from(new Set([...current, selectedSite.id]))
        : current.filter((id) => id !== selectedSite.id));
      setNotice(enabled
        ? "Daily monitoring enabled. The next scheduled run will check this website."
        : "Daily monitoring paused. Existing check and change history is preserved.");
    } catch (error) {
      console.error("TapeWatch monitoring setting save failed:", error);
      setNotice(error instanceof Error ? error.message : "Could not update monitoring settings.");
    } finally {
      setSavingMonitoring(false);
    }
  }

  async function analyzeWebsiteIntelligence() {
    if (!selectedSite || !supabase) return;
    setAnalyzingIntelligence(true);
    setNotice("");
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error("Your workspace session is not ready. Refresh and try again.");
      const response = await fetch("/api/intelligence/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ websiteId: selectedSite.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Website intelligence analysis failed.");
      setIntelligenceProfile(result.profile as IntelligenceProfile);
      setNotice("Intelligence updated: analysed " + (result.pagesAnalysed || 1) + " public pages and found " + (result.socialProfilesFound || 0) + " social profiles.");
    } catch (error) {
      console.error("TapeWatch intelligence analysis failed:", error);
      setNotice(error instanceof Error ? error.message : "Could not analyse this website.");
    } finally {
      setAnalyzingIntelligence(false);
    }
  }

  async function runWebsiteCheck() {
    if (!selectedSite || !supabase) return;
    setCheckingWebsite(true);
    setNotice("");
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error("Your workspace session is not ready. Refresh and try again.");
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ websiteId: selectedSite.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The website check failed.");
      setChecks((current) => [result.check as WebsiteCheck, ...current]);
      if (result.change) setChanges((current) => [result.change as WebsiteChange, ...current]);
      setDetailTab("checks");
      setNotice(result.change
        ? "Website check complete. A content change was detected and saved to Change history."
        : result.changeDetectionError
          ? result.changeDetectionError
          : result.baselineCaptured
            ? "Website check complete. Its first content fingerprint is saved as the baseline."
            : result.check.content_hash
              ? "Website check complete. The content matches the previous fingerprint; no new change was recorded."
              : result.check.status === "reachable_partial"
                ? "Website responded, but its content exceeded the capture limit. No full fingerprint comparison was possible."
                : "Website check recorded. Review the result for details.");
    } catch (error) {
      console.error("TapeWatch website check failed:", error);
      setNotice(error instanceof Error ? error.message : "Could not complete the website check.");
    } finally {
      setCheckingWebsite(false);
    }
  }

  async function verifySavedCheck(savedCheck: WebsiteCheck) {
    if (!selectedSite || !supabase) return;
    setVerifyingCheckId(savedCheck.id);
    setVerificationResult(null);
    setNotice("");
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error("Your workspace session is not ready. Refresh and try again.");
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ websiteId: selectedSite.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The live evidence check failed.");
      const liveCheck = result.check as WebsiteCheck;
      setChecks((current) => [liveCheck, ...current]);
      if (result.change) setChanges((current) => [result.change as WebsiteChange, ...current]);
      const verifiedAt = new Date().toISOString();
      const status = !savedCheck.content_hash || !liveCheck.content_hash
        ? "unavailable"
        : savedCheck.content_hash === liveCheck.content_hash ? "verified" : "mismatch";
      setVerificationResult({
        checkId: savedCheck.id,
        status,
        verifiedAt,
        message: status === "verified"
          ? "The current complete response matches this saved SHA-256 fingerprint."
          : status === "mismatch"
            ? "The current response fingerprint differs from this saved check. The website may have changed since it was recorded."
            : "A complete fingerprint is missing from the saved check or the latest response, so a comparison was not possible.",
      });
    } catch (error) {
      console.error("TapeWatch evidence verification failed:", error);
      setVerificationResult({
        checkId: savedCheck.id,
        status: "unavailable",
        verifiedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : "The live evidence check could not be completed.",
      });
    } finally {
      setVerifyingCheckId("");
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="TapeWatch home">
          <span className="brand-mark"><span /></span>
          <span>Tape<span className="brand-light">Watch</span></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          <a className={`nav-item ${!selectedSite && !showChanges && !activeSection ? "active" : ""}`} href="#overview" onClick={() => openSection("overview")}><Icon name="grid"/> Overview</a>
          <a className="nav-item" href="#websites" onClick={() => { openSection("websites"); document.getElementById("websites")?.scrollIntoView({ behavior: "smooth" }); }}><Icon name="globe"/> Websites <span className="nav-count">{sites.length}</span></a>
          <a className={`nav-item ${showChanges ? "active" : ""}`} href="#changes" onClick={() => openSection("changes")}><Icon name="activity"/> Changes</a>
          <a className={`nav-item ${activeSection === "timeline" || (selectedSite && detailTab === "timeline") ? "active" : ""}`} href="#timeline" onClick={() => { if (sites.length) { setSelectedSite(sites[0]); setDetailTab("timeline"); setShowChanges(false); setActiveSection(""); } else { openSection("timeline"); } }}><Icon name="clock"/> Trust Timeline</a>
        </nav>
        <div className="workspace-label nav-group-label">ECOSYSTEM</div>
        <nav className="nav-list" aria-label="Ecosystem navigation">
          <a className={`nav-item ${activeSection === "circuits" ? "active" : ""}`} href="#circuits" onClick={() => openSection("circuits")}><Icon name="layers"/> Circuits</a>
          <a className={`nav-item ${activeSection === "networks" ? "active" : ""}`} href="#networks" onClick={() => openSection("networks")}><Icon name="globe"/> Networks</a>
        </nav>
        <div className="workspace-label nav-group-label">MANAGEMENT</div>
        <nav className="nav-list" aria-label="Management navigation">
          <a className={`nav-item ${activeSection === "alerts" ? "active" : ""}`} href="#alerts" onClick={() => openSection("alerts")}><Icon name="activity"/> Alerts</a>
          <a className={`nav-item ${activeSection === "reports" ? "active" : ""}`} href="#reports" onClick={() => openSection("reports")}><Icon name="file"/> Reports</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="network-card">
            <div className="network-top"><span className="network-dot"/> NETWORK</div>
            <strong>X Layer</strong>
            <span className="network-sub">Read-only connection · not active</span>
          </div>
          <a className={`nav-item settings-link ${activeSection === "settings" ? "active" : ""}`} href="#settings" onClick={() => openSection("settings")}><Icon name="settings"/> Settings</a>
          <div className="profile">
            <div className="avatar">V</div>
            <div><strong>voidedfx0</strong><span>Personal workspace</span></div>
            <span className="profile-menu">···</span>
          </div>
        </div>
      </aside>

      <section className="main-panel" id="overview">
        <header className="topbar">
          <div className="breadcrumbs">Workspace <span>/</span> <strong>{selectedSite ? "Website details" : showChanges ? "Change intelligence" : activeSection ? sectionContent[activeSection]?.title ?? "Workspace" : "Overview"}</strong></div>
          <div className="topbar-right"><span className="preview-pill"><span/> Preview environment</span><button className="icon-button" aria-label="Search websites" onClick={() => document.getElementById("site-search")?.focus()}><Icon name="search"/></button></div>
        </header>

        {selectedSite ? (
          <div className="content detail-content">
            <button className="back-link" onClick={() => { setSelectedSite(null); setDetailTab("overview"); }}>← Back to websites</button>
            <div className="detail-hero">
              <div className="detail-site-icon"><Icon name="globe" size={24}/></div>
              <div className="detail-site-copy"><div className="eyebrow">WEBSITE WORKSPACE · SETUP DRAFT</div><h1 className="detail-url-capsule">{selectedSite.url}</h1><p className="intro">A dedicated view for this website's integrity and monitoring setup.</p></div>
              <div className="detail-actions"><span className={`draft-status detail-status ${checks.length ? "observed" : ""}`}><span/> {checks.length ? "Observed" : "Setup draft"}</span><button className="primary-button" onClick={runWebsiteCheck} disabled={checkingWebsite}>{checkingWebsite ? "Checking…" : checks.length ? "Check again" : "Check now"} <Icon name="activity" size={15}/></button></div>
            </div>
            <div className="detail-notice"><Icon name="shield" size={18}/><div><strong>{checks.length ? "Website observations are being recorded" : "Ready for its first observation"}</strong><p>{checks.length ? "TapeWatch has saved on-demand website checks for this entry. These are point-in-time observations, not continuous monitoring or an on-chain verification." : "Run Check now to record reachability, response details, and an initial SHA-256 content fingerprint when a complete response is available."}</p></div></div>
            <div className="detail-tabs" role="tablist" aria-label="Website details sections">
              {(["overview", "intelligence", "changes", "checks", "timeline", "settings"] as const).map((tab) => <button key={tab} role="tab" aria-selected={detailTab === tab} className={detailTab === tab ? "detail-tab active" : "detail-tab"} onClick={() => setDetailTab(tab)}>{tab === "overview" ? "Overview" : tab === "intelligence" ? "Intelligence" : tab === "changes" ? "Change history" : tab === "checks" ? "Checks" : tab === "timeline" ? "Trust timeline" : "Settings"}</button>)}<button type="button" className="detail-tab detail-tab-action" onClick={() => { void runWebsiteCheck(); }} disabled={checkingWebsite}>{checkingWebsite ? "Checking…" : "Check now"}</button>
            </div>
            {detailTab === "overview" && <div className="detail-grid">
              <section className="detail-card detail-wide"><div className="detail-card-heading"><div><span className="mini-icon"><Icon name="shield" size={17}/></span><h2>Integrity status</h2></div><span className="coming-soon">AWAITING SETUP</span></div><div className="integrity-placeholder"><div className="integrity-ring"><Icon name="shield" size={27}/></div><div><strong>Not yet verified</strong><p>An integrity result will appear after a verification source is configured and the first check completes.</p></div></div></section>
              <section className="detail-card"><div className="detail-card-heading"><div><span className="mini-icon"><Icon name="clock" size={17}/></span><h2>Monitoring schedule</h2></div></div><div className="detail-metric">{checks.length}</div><p className="detail-muted">On-demand observations saved</p></section>
              <section className="detail-card"><div className="detail-card-heading"><div><span className="mini-icon"><Icon name="activity" size={17}/></span><h2>Detected changes</h2></div></div><div className="detail-metric">{changes.length}</div><p className="detail-muted">Content differences recorded</p></section>
              <section className="detail-card detail-wide"><div className="detail-card-heading"><div><span className="mini-icon"><Icon name="globe" size={17}/></span><h2>Website information</h2></div></div><div className="info-rows"><div><span>Website address</span><strong>{selectedSite.url}</strong></div><div><span>Entry status</span><strong>Setup draft</strong></div><div><span>Monitoring source</span><strong>On-demand HTTP check</strong></div><div><span>Last checked</span><strong>{checks[0] ? new Date(checks[0].checked_at).toLocaleString() : "Never"}</strong></div></div></section>
            </div>}
            {detailTab === "intelligence" && <section className="detail-card intelligence-card">
              <div className="detail-card-heading"><div><span className="mini-icon"><Icon name="globe" size={17}/></span><h2>Website intelligence profile</h2></div><span className="coming-soon">{intelligenceProfile ? "PROFILE SAVED" : "NOT ANALYSED"}</span></div>
              <p className="detail-muted intelligence-intro">A multi-page profile built from publicly accessible pages and linked social profiles. Findings are limited to information TapeWatch could actually retrieve.</p>
              <div className="intelligence-action-row"><span className="detail-muted">{intelligenceProfile?.analyzed_at ? "Last analysed " + new Date(intelligenceProfile.analyzed_at).toLocaleString() : "No profile has been created yet."}</span><button type="button" className="primary-button" onClick={() => void analyzeWebsiteIntelligence()} disabled={analyzingIntelligence || intelligenceLoading}>{analyzingIntelligence ? "Analysing…" : intelligenceProfile ? "Refresh profile" : "Analyse website"} <Icon name="activity" size={14}/></button></div>
              {intelligenceLoading ? <p className="detail-muted">Loading saved profile…</p> : intelligenceProfile ? <>
                <div className="intelligence-summary"><span>OVERVIEW</span><h3>{intelligenceProfile.business_name || selectedSite.url}</h3><p>{intelligenceProfile.summary || "The homepage did not provide a clear summary."}</p></div>
                <div className="intelligence-grid">
                  <article><span>PURPOSE</span><p>{intelligenceProfile.purpose || "Not clearly stated in the pages analysed."}</p></article>
                  <article><span>TARGET AUDIENCE</span><p>{intelligenceProfile.target_audience || "Not confidently identified from available page evidence."}</p></article>
                  <article><span>SERVICES & PRODUCTS</span>{intelligenceProfile.services?.length ? <ul>{intelligenceProfile.services.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No clear service headings found.</p>}</article>
                  <article><span>KEY TOPICS</span>{intelligenceProfile.key_topics?.length ? <div className="intelligence-tags">{intelligenceProfile.key_topics.map((item, index) => <span key={index}>{item}</span>)}</div> : <p>No key topics extracted.</p>}</article>
                </div>
                <div className="intelligence-socials"><div className="intelligence-section-heading"><span>SOCIAL PROFILES DISCOVERED</span><small>{intelligenceProfile.social_profiles?.length || 0} FOUND</small></div>{intelligenceProfile.social_profiles?.length ? <div className="intelligence-social-grid">{intelligenceProfile.social_profiles.map((social, index) => <a key={index} href={social.url} target="_blank" rel="noreferrer"><strong>{social.platform}</strong><span>Open profile</span><Icon name="external" size={13}/></a>)}</div> : <p className="intelligence-empty-note">No recognised social links were found on the pages TapeWatch could access. Some sites do not publish social links publicly.</p>}</div>
                <div className="intelligence-pages"><span>IMPORTANT PAGES FOUND</span>{intelligenceProfile.important_pages?.length ? intelligenceProfile.important_pages.map((page, index) => <a key={index} href={page.url} target="_blank" rel="noreferrer"><span>{page.type}</span><strong>{page.label}</strong><Icon name="external" size={13}/></a>) : <p>No recognised About, Products, Services, Pricing, Contact or Documentation pages could be reached.</p>}</div>
                <div className="intelligence-pages"><span>ANALYSED SOURCE PAGES ({intelligenceProfile.pages_analyzed?.length || intelligenceProfile.source_urls?.length || 0})</span>{intelligenceProfile.pages_analyzed?.length ? intelligenceProfile.pages_analyzed.map((page, index) => <a key={index} href={page.url} target="_blank" rel="noreferrer"><span>Source {index + 1}</span><strong>{page.title || page.url}</strong><Icon name="external" size={13}/></a>) : intelligenceProfile.source_urls?.map((source, index) => <a key={index} href={source} target="_blank" rel="noreferrer"><span>Source {index + 1}</span><strong>{source}</strong><Icon name="external" size={13}/></a>)}</div>
                <p className="intelligence-disclaimer">Extraction confidence: {intelligenceProfile.confidence || "limited"}. TapeWatch checks up to 7 publicly linked pages on the same site. Social profiles are shown only when a recognised public link is found. This is structured page extraction, not independent business verification.</p>
              </> : <div className="checks-empty"><h3>No intelligence profile yet</h3><p>Analyse up to 7 relevant public pages to discover the site purpose, products, services, topics, important pages and linked social profiles.</p><button className="secondary-button" onClick={() => void analyzeWebsiteIntelligence()} disabled={analyzingIntelligence}>{analyzingIntelligence ? "Analysing…" : "Build intelligence profile"}</button></div>}
            </section>}
            {detailTab === "changes" && <section className="detail-card checks-history-card">
              <div className="detail-card-heading check-history-heading"><div><span className="mini-icon"><Icon name="activity" size={17}/></span><h2>Detected content changes</h2></div><span className="coming-soon">{changes.length} EVENTS</span></div>
              {changesLoading ? <p className="detail-muted">Loading change history…</p> : changes.length ? <div className="check-history-list">{changes.map((change) => <article className="check-history-row" key={change.id}>
                <div className="check-history-top"><strong>Website content changed</strong><span className="coming-soon">SHA-256 DIFFERENCE</span></div>
                <p>{new Date(change.detected_at).toLocaleString()}</p>
                {(change.previous_title || change.current_title) && <div className="info-rows"><div><span>Previous page title</span><strong>{change.previous_title || "Not available"}</strong></div><div><span>Current page title</span><strong>{change.current_title || "Not available"}</strong></div></div>}
                {change.previous_hash && <div className="check-hash"><span>Previous SHA-256</span><code>{change.previous_hash}</code></div>}
                {change.current_hash && <div className="check-hash"><span>Current SHA-256</span><code>{change.current_hash}</code></div>}
                <p className="detail-muted">A different page-content fingerprint was observed. This records a difference; it does not by itself mean the change is harmful.</p>
              </article>)}</div> : <div className="checks-empty"><h3>No content changes recorded</h3><p>The first complete check establishes a baseline. If a later Check now produces a different fingerprint, the evidence will appear here.</p></div>}
            </section>}
            {detailTab === "checks" && <section className="detail-card version-compare-card">
              <div className="detail-card-heading"><div><span className="mini-icon"><Icon name="layers" size={17}/></span><h2>Compare website versions</h2></div><span className="coming-soon">FINGERPRINT COMPARISON</span></div>
              <p className="detail-muted version-compare-intro">Choose two saved checks to compare their recorded evidence. The newest checks are selected automatically when available.</p>
              {checks.length < 2 ? <div className="version-compare-empty">Run at least two website checks to compare versions.</div> : <>
                <div className="version-compare-selectors">
                  <label>Earlier check<select value={compareOlderId} onChange={(event) => setCompareOlderId(event.target.value)}><option value="">Select a check</option>{checks.map((check) => <option key={check.id} value={check.id}>{new Date(check.checked_at).toLocaleString()}</option>)}</select></label>
                  <label>Later check<select value={compareNewerId} onChange={(event) => setCompareNewerId(event.target.value)}><option value="">Select a check</option>{checks.map((check) => <option key={check.id} value={check.id}>{new Date(check.checked_at).toLocaleString()}</option>)}</select></label>
                </div>
                {!comparisonReady ? <p className="version-compare-warning">Choose two different checks to compare.</p> : <>
                  <div className={`version-compare-result ${fingerprintsMatch === true ? "same" : fingerprintsMatch === false ? "different" : "unknown"}`}>
                    <strong>{fingerprintsMatch === true ? "Fingerprints match" : fingerprintsMatch === false ? "Content fingerprints differ" : "Comparison unavailable"}</strong>
                    <span>{fingerprintsMatch === true ? "Both complete captures produced the same SHA-256 fingerprint." : fingerprintsMatch === false ? "The captured response content differs between these checks." : "One or both checks do not have a complete content fingerprint."}</span>
                  </div>
                  <div className="version-compare-grid">
                    {[{ label: "Earlier check", check: compareOlder! }, { label: "Later check", check: compareNewer! }].map(({ label, check }) => <article className="version-compare-side" key={check.id}>
                      <span>{label}</span><strong>{check.page_title || "Title not captured"}</strong>
                      <p>{new Date(check.checked_at).toLocaleString()}</p>
                      <p>{check.http_status ? `HTTP ${check.http_status}` : check.status.replaceAll("_", " ")}</p>
                      <div className="check-hash"><span>SHA-256</span><code>{check.content_hash || "No complete fingerprint available"}</code></div>
                    </article>)}
                  </div>
                </>}
                <p className="version-compare-disclaimer">A matching fingerprint means the captured response bodies match. A different fingerprint is an observed difference, not proof of a security issue. This comparison does not display changed lines.</p>
              </>}
            </section>}
            {detailTab === "checks" && <section className="detail-card checks-history-card">
              <div className="detail-card-heading check-history-heading"><div><span className="mini-icon"><Icon name="activity" size={17}/></span><h2>Website check history</h2></div><div className="check-history-actions"><span className="coming-soon">{checks.length} RECORDS</span><button className="primary-button check-now-button" onClick={runWebsiteCheck} disabled={checkingWebsite}>{checkingWebsite ? "Checking…" : checks.length ? "Check again" : "Check now"} <Icon name="activity" size={14}/></button></div></div>
              {checksLoading ? <p className="detail-muted">Loading check history…</p> : checks.length ? <div className="check-history-list">{checks.map((check) => <article className="check-history-row" key={check.id}>
                <div className="check-history-top"><strong>{check.status === "reachable" ? "Website reachable" : check.status === "reachable_partial" ? "Reachable · partial capture" : check.status === "http_error" ? "HTTP response error" : "Website unavailable"}</strong><span className="coming-soon">{check.http_status ? `HTTP ${check.http_status}` : check.status.toUpperCase()}</span></div>
                <p>{new Date(check.checked_at).toLocaleString()}{check.page_title ? ` · ${check.page_title}` : ""}</p>
                {check.content_hash && <div className="check-hash"><span>SHA-256</span><code>{check.content_hash}</code></div>}
                <div className="evidence-verify-actions"><button className="secondary-button" onClick={() => verifySavedCheck(check)} disabled={Boolean(verifyingCheckId)}>{verifyingCheckId === check.id ? "Checking live site…" : "Verify against live site"}</button></div>
                {verificationResult?.checkId === check.id && <div className={`evidence-verify-result ${verificationResult.status}`}><strong>{verificationResult.status === "verified" ? "Current fingerprint matches" : verificationResult.status === "mismatch" ? "Fingerprint mismatch" : "Unable to verify"}</strong><span>{verificationResult.message}</span><small>Checked {new Date(verificationResult.verifiedAt).toLocaleString()}</small></div>}
                {check.error_message && <p className="check-error">{check.error_message}</p>}
                {check.final_url && <p className="detail-muted">Final address: {check.final_url}</p>}
              </article>)}</div> : <div className="checks-empty"><h3>No website checks yet</h3><p>Select Check now to record the first observation for this website.</p><button className="secondary-button" onClick={runWebsiteCheck} disabled={checkingWebsite}>{checkingWebsite ? "Checking…" : "Run first check"}</button></div>}
            </section>}
            {detailTab === "timeline" && <section className="detail-card trust-timeline-card">
              <div className="detail-card-heading"><div><span className="mini-icon"><Icon name="clock" size={17}/></span><h2>Trust timeline</h2></div><span className="coming-soon">{timelineEvents.length} EVENTS</span></div>
              <p className="detail-muted timeline-intro">A chronological evidence trail for this website, combining saved checks, detected fingerprint changes and live comparison outcomes.</p>
              {checksLoading || changesLoading ? <p className="detail-muted">Loading evidence history…</p> : timelineEvents.length ? <div className="trust-timeline-list">{timelineEvents.map((event) => <article className="trust-timeline-event" key={event.id}>
                <span className={`trust-timeline-marker ${event.kind}`}><Icon name={event.kind === "check" ? "activity" : event.kind === "change" ? "layers" : "shield"} size={14}/></span>
                <div className="trust-timeline-event-body"><div className="trust-timeline-event-top"><div className="trust-timeline-event-heading"><span className={`timeline-category ${event.kind}`}>{event.category}</span><strong>{event.title}</strong></div><time>{new Date(event.at).toLocaleString()}</time></div><p>{event.detail}</p>{event.hash && <div className="check-hash"><span>SHA-256 EVIDENCE</span><code>{event.hash}</code></div>}
                  <details className="timeline-event-details"><summary>Inspect event evidence</summary>
                    {event.kind === "check" && <div className="timeline-evidence-grid"><div><span>Saved check ID</span><code>{event.checkId}</code></div><div><span>Recorded status</span><strong>{event.status?.replaceAll("_", " ")}</strong></div><div><span>HTTP response</span><strong>{event.httpStatus ? "HTTP " + event.httpStatus : "Not available"}</strong></div><div><span>Final address</span><strong>{event.finalUrl || "Not recorded"}</strong></div>{event.errorMessage && <div className="timeline-evidence-full"><span>Recorded note</span><strong>{event.errorMessage}</strong></div>}</div>}
                    {event.kind === "change" && <div className="timeline-evidence-grid"><div><span>Previous check ID</span><code>{event.previousCheckId || "Not linked"}</code></div><div><span>Current check ID</span><code>{event.currentCheckId || "Not linked"}</code></div><div><span>Previous SHA-256</span><code>{event.previousHash || "Unavailable"}</code></div><div><span>Current SHA-256</span><code>{event.currentHash || "Unavailable"}</code></div></div>}
                    {event.kind === "verification" && <div className="timeline-evidence-grid"><div><span>Compared saved check</span><code>{event.checkId}</code></div><div><span>Outcome</span><strong>{event.status}</strong></div><p className="timeline-evidence-full">This live comparison is a session result, not a permanent verification certificate.</p></div>}
                  </details>
                </div>
              </article>)}</div> : <div className="checks-empty"><h3>No evidence events yet</h3><p>Run a website check to create the first timestamped event. Later changes and live comparisons will appear here too.</p><button className="secondary-button" onClick={runWebsiteCheck} disabled={checkingWebsite}>{checkingWebsite ? "Checking…" : "Run first check"}</button></div>}
              <p className="version-compare-disclaimer">This timeline is built from saved website checks and change records. A live comparison result is shown for this session; it is not a permanent verification certificate. No on-chain events are connected yet.</p>
            </section>}
            {detailTab === "settings" && <section className="detail-card settings-preview"><div className="detail-card-heading"><div><span className="mini-icon"><Icon name="settings" size={17}/></span><h2>Monitoring preferences</h2></div><span className={monitoringSetting?.enabled ? "status-pill status-active" : "coming-soon"}>{monitoringSetting?.enabled ? "DAILY MONITORING ON" : "PAUSED"}</span></div><div className="monitoring-control-row"><div><strong>Automatic daily checks</strong><p className="detail-muted">Capture a website fingerprint once per day and record detected content changes.</p></div><button type="button" className={monitoringSetting?.enabled ? "secondary-button" : "primary-button"} onClick={() => void toggleDailyMonitoring(!monitoringSetting?.enabled)} disabled={monitoringLoading || savingMonitoring}>{monitoringLoading ? "Loading…" : savingMonitoring ? "Saving…" : monitoringSetting?.enabled ? "Pause monitoring" : "Enable daily checks"}</button></div><div className="info-rows"><div><span>Check frequency</span><strong>Daily</strong></div><div><span>Last scheduled check</span><strong>{monitoringSetting?.last_run_at ? new Date(monitoringSetting.last_run_at).toLocaleString() : "Not run yet"}</strong></div><div><span>Next scheduled check</span><strong>{monitoringSetting?.enabled && monitoringSetting.next_run_at ? new Date(monitoringSetting.next_run_at).toLocaleString() : "Not scheduled"}</strong></div></div><p className="detail-muted settings-footnote">Scheduled checks run through the secure server scheduler. Pausing monitoring preserves existing evidence history. Change notifications are not active yet.</p></section>}
          </div>
        ) : activeSection && sectionContent[activeSection] ? <div className="content module-workspace" id={activeSection}><div className="workspace-title-row"><div><div className="eyebrow">{sectionContent[activeSection].eyebrow}</div><h1>{sectionContent[activeSection].title}<span>.</span></h1><p className="intro">{sectionContent[activeSection].description}</p></div><span className="preview-pill"><span/> PREVIEW</span></div><div className="module-notice"><Icon name="shield" size={18}/><div><strong>Data sources are not connected</strong><p>This section is a frontend foundation. It will display real records only after the relevant monitoring or network integration is implemented and validated.</p></div></div><div className="module-page-grid">{sectionContent[activeSection].items.map((item) => <article className="module-page-card" key={item.title}><div className="module-page-card-top"><span className="mini-icon"><Icon name={activeSection === "settings" ? "settings" : activeSection === "timeline" ? "clock" : activeSection === "reports" ? "file" : "shield"} size={17}/></span><span className="coming-soon">{item.state}</span></div><h2>{item.title}</h2><p>{item.description}</p></article>)}</div><div className="module-evidence-note"><strong>Evidence-first design.</strong> No live activity, verification result or network status is being fabricated in this preview.</div></div> : showChanges ? <div className="content changes-workspace" id="changes">
          <div className="workspace-title-row">
            <div><div className="eyebrow">WEBSITE INTELLIGENCE</div><h1>Change intelligence<span>.</span></h1><p className="intro">Investigate what changed across your monitored websites, with a clear trail back to the evidence.</p></div>
            <span className="preview-pill"><span/> ENGINE NOT CONNECTED</span>
          </div>
          <section className="changes-intro-card">
            <div className="changes-intro-icon"><Icon name="activity" size={22}/></div>
            <div><span className="changes-kicker">THE CHANGE WORKFLOW</span><h2>From a detected difference to an explainable record.</h2><p>When monitoring is connected, this workspace will group observations into reviewable changes. Each record will include the affected files, observation time, previous and current hashes, and any available verification evidence.</p></div>
          </section>
          <div className="changes-summary-grid">
            <article className="changes-summary-card"><span>CHANGES DETECTED</span><strong>—</strong><p>No monitoring data collected</p></article>
            <article className="changes-summary-card"><span>AWAITING REVIEW</span><strong>—</strong><p>Review queue not active</p></article>
            <article className="changes-summary-card"><span>VERIFIED RECORDS</span><strong>—</strong><p>Verification source not connected</p></article>
          </div>
          <section className="section-card changes-records-card">
            <div className="section-heading"><div><h2>Change records</h2><p>Historical differences will appear here after the first real observation.</p></div><span className="coming-soon">NO DATA SOURCE</span></div>
            <div className="changes-empty">
              <div className="empty-illustration"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="empty-globe"><Icon name="activity" size={28}/></div></div>
              <h3>No change records yet</h3>
              <p>TapeWatch has not monitored a website or captured a baseline. Once a real monitoring source is connected, detected differences will appear here for investigation.</p>
              <button className="secondary-button" onClick={() => { setShowChanges(false); setShowAdd(true); setNotice(""); }}><Icon name="plus" size={15}/> Add a website</button>
            </div>
          </section>
          <section className="changes-evidence-note"><Icon name="shield" size={17}/><p><strong>Evidence before conclusions.</strong> A detected difference is an observation, not automatically a security issue. Verification status will only be shown when the relevant hashes and source records have actually been checked.</p></section>
        </div> : <div className="content">
          <div className="welcome-row">
            <div><div className="eyebrow">WEBSITE INTELLIGENCE PLATFORM</div><h1>See the signal <span>behind every change.</span></h1><p className="intro">Monitor websites, investigate changes, and connect integrity evidence with on-chain activity.</p></div>
            <button className="primary-button" onClick={() => { setShowAdd(true); setNotice(""); }}><Icon name="plus" size={17}/> Add a website</button>
            <div className="motion-visual" aria-hidden="true">
              <div className="motion-grid" />
              <div className="motion-ring ring-outer" />
              <div className="motion-ring ring-middle" />
              <div className="motion-ring ring-inner" />
              <div className="motion-core eye-core" aria-label="TapeWatch watchful eye"><svg className="watch-eye" viewBox="0 0 88 56" role="img" aria-hidden="true"><path className="eye-outline" d="M5 28C15 12 29 4 44 4s29 8 39 24C73 44 59 52 44 52S15 44 5 28Z"/><ellipse className="eye-iris" cx="44" cy="28" rx="13" ry="16"/><circle className="eye-pupil" cx="44" cy="28" r="6"/><circle className="eye-glint" cx="48" cy="22" r="2.5"/></svg></div>
              <span className="motion-node node-a" /><span className="motion-node node-b" /><span className="motion-node node-c" />
              <div className="motion-scan" />
              <div className="motion-caption"><span className="motion-live-dot" /> INTEGRITY SIGNAL <b>READY TO CONNECT</b></div>
            </div>
          </div>

          <div className="notice-bar"><span className="notice-icon"><Icon name="shield" size={17}/></span><div><strong>Preview workspace · data connections pending</strong><p>Your workspace is ready to configure. Live website observations, integrity results, and blockchain events will appear after their data sources are connected.</p></div><span className="preview-tag">PREVIEW</span></div>

          <section className="stats-grid" aria-label="Monitoring summary">
            <article className="stat-card"><div className="stat-head">Websites on watchlist <span className="stat-icon"><Icon name="globe"/></span></div><div className="stat-number">{sites.length}<small> / —</small></div><div className="stat-foot">Saved workspace entries</div></article>
            <article className="stat-card"><div className="stat-head">Verified observations <span className="stat-icon"><Icon name="shield"/></span></div><div className="stat-number">—</div><div className="stat-foot">Verification source not connected</div></article>
            <article className="stat-card"><div className="stat-head">Changes recorded <span className="stat-icon"><Icon name="activity"/></span></div><div className="stat-number">—</div><div className="stat-foot">Change history not connected</div></article>
            <article className="stat-card"><div className="stat-head">Linked circuits <span className="stat-icon"><Icon name="layers"/></span></div><div className="stat-number">—</div><div className="stat-foot">Contract sources not configured</div></article>
          </section>

          {sites.length === 0 && <section className="getting-started" aria-label="Getting started">
            <div className="getting-started-main">
              <div className="getting-started-kicker"><span className="getting-started-dot"/> YOUR FIRST WORKFLOW</div>
              <h2>Start with one website.</h2>
              <p>Build a trustworthy history from the first observation. TapeWatch will only show verification results after a real source has been connected and checked.</p>
              <button className="primary-button" onClick={() => { setShowAdd(true); setNotice(""); }}><Icon name="plus" size={16}/> Add your first website</button>
            </div>
            <div className="getting-started-steps">
              <div className="getting-step"><span className="getting-step-number">01</span><div><strong>Register a website</strong><p>Add a public URL or a supported DeWEB reference.</p></div><span className="getting-step-state">READY</span></div>
              <div className="getting-step"><span className="getting-step-number">02</span><div><strong>Capture a baseline</strong><p>Record the initial files and available integrity metadata.</p></div><span className="getting-step-state pending">NEXT</span></div>
              <div className="getting-step"><span className="getting-step-number">03</span><div><strong>Track verified changes</strong><p>Compare later observations and inspect their evidence.</p></div><span className="getting-step-state pending">PLANNED</span></div>
            </div>
          </section>}

          <section className="section-card" id="websites">
            <div className="section-heading"><div><h2>Website watchlist</h2><p>Your saved websites and their current setup state.</p></div><button className="text-button" onClick={() => setShowAdd(true)}>Add website <Icon name="arrow" size={15}/></button></div>
            <div className="table-toolbar"><div className="table-title">ALL SITES <span>{sites.length}</span></div><label className="search-box"><Icon name="search" size={16}/><input id="site-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search websites..." /></label></div>
            {sitesLoading ? <div className="empty-state"><p>Loading your saved websites…</p></div> : filteredSites.length ? <div className="site-list">{filteredSites.map((site) => <button className="site-row site-row-button" key={site.id} onClick={() => { setSelectedSite(site); setDetailTab("overview"); }}><div className="site-favicon"><Icon name="globe" size={17}/></div><div className="site-details"><strong className="watchlist-name-window" title={site.url}><span className="watchlist-name-track"><span>{site.url}</span><span aria-hidden="true">{site.url}</span></span></strong><span>Saved in your workspace</span></div><span className={`draft-status ${monitoredSiteIds.includes(site.id) ? "monitoring-on" : ""}`} title={monitoredSiteIds.includes(site.id) ? "Daily monitoring is enabled" : "Daily monitoring is off"}><span/> {monitoredSiteIds.includes(site.id) ? "Monitoring on" : "Setup draft"}</span><span className="site-open"><Icon name="arrow" size={15}/></span></button>)}</div> : <div className="empty-state"><div className="empty-illustration"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="empty-globe"><Icon name="globe" size={29}/></div><span className="spark spark-one"/> <span className="spark spark-two"/></div><h3>{query ? "No matching websites" : "Nothing on your watchlist yet"}</h3><p>{query ? "Try a different search term." : "Add a website to start setting up your monitoring workspace. You can review the setup before anything is connected."}</p>{!query && <button className="secondary-button" onClick={() => setShowAdd(true)}><Icon name="plus" size={16}/> Add your first website</button>}</div>}
          </section>

          <section className="intelligence-section" aria-label="TapeWatch intelligence modules">
            <div className="intelligence-heading"><div><div className="eyebrow">THE TAPEWATCH LAYERS</div><h2>From observation to evidence.</h2><p>One workspace for website changes, integrity signals, and relevant blockchain activity.</p></div><span className="module-count">03 MODULES</span></div>
            <div className="intelligence-grid">
              <article className="intelligence-card">
                <div className="intelligence-card-top"><span className="intelligence-icon"><Icon name="activity" size={19}/></span><span className="module-state">ENGINE IN DEVELOPMENT</span></div>
                <div className="intelligence-card-body"><h3>Change intelligence</h3><p>Compare website versions, inspect detected differences, and follow the history of each observation.</p></div>
                <div className="intelligence-card-foot"><span>Version history · File changes</span><span className="module-arrow"><Icon name="arrow" size={15}/></span></div>
              </article>
              <article className="intelligence-card">
                <div className="intelligence-card-top"><span className="intelligence-icon"><Icon name="layers" size={19}/></span><span className="module-state">SOURCE REVIEW PENDING</span></div>
                <div className="intelligence-card-body"><h3>Blockchain transparency</h3><p>Connect supported DeWEB records, circuit references, ownership events, and on-chain integrity evidence.</p></div>
                <div className="intelligence-card-foot"><span>X Layer · Circuit records</span><span className="module-arrow"><Icon name="arrow" size={15}/></span></div>
              </article>
              <article className="intelligence-card">
                <div className="intelligence-card-top"><span className="intelligence-icon"><Icon name="clock" size={19}/></span><span className="module-state">AWAITING EVENTS</span></div>
                <div className="intelligence-card-body"><h3>Trust timeline</h3><p>Bring observations, verification checks, and relevant chain events into one chronological record.</p></div>
                <div className="intelligence-card-foot"><span>Evidence trail · Event history</span><span className="module-arrow"><Icon name="arrow" size={15}/></span></div>
              </article>
            </div>
          </section>
          <div className="lower-grid">
            <section className="mini-card" id="circuits"><div className="mini-heading"><div><span className="mini-icon"><Icon name="layers" size={17}/></span><h2>Circuit intelligence</h2></div><span className="coming-soon">NOT CONNECTED</span></div><p>TapeWatch will show circuit records and related ownership activity after the correct contracts, event sources, and network support are verified.</p><div className="mini-foot"><span><Icon name="clock" size={14}/> No chain events loaded</span><span>Evidence first <Icon name="arrow" size={13}/></span></div></section>
            <section className="mini-card" id="activity"><div className="mini-heading"><div><span className="mini-icon"><Icon name="activity" size={17}/></span><h2>Trust timeline</h2></div><span className="coming-soon">AWAITING DATA</span></div><div className="activity-empty"><span className="activity-line"/><p>Website observations and verified events will appear here once their sources are connected.</p></div></section>
          </div>
          <footer className="footer"><span>© 2026 TapeWatch</span><span>Built for transparency <i>·</i> Read-only by design</span></footer>
        </div>}
      </section>

      {showAdd && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAdd(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><div className="eyebrow">NEW WATCHLIST ENTRY</div><h2 id="modal-title">Add a website</h2></div><button className="icon-button" onClick={() => setShowAdd(false)} aria-label="Close"><Icon name="close"/></button></div><p className="modal-copy">Enter the public website address you'd like to monitor. This saves the website to your private TapeWatch workspace. Monitoring does not start yet.</p><form onSubmit={addSite}><label className="field-label" htmlFor="website-url">Website URL</label><input id="website-url" className="url-input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" autoFocus/><div className="modal-note"><Icon name="shield" size={15}/> No wallet connection or transaction required.</div>{notice && <p className="form-notice">{notice}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowAdd(false)}>Cancel</button><button type="submit" className="primary-button" disabled={savingSite}>{savingSite ? "Saving…" : "Save website"} <Icon name="arrow" size={15}/></button></div></form></section></div>}
      {notice && !showAdd && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><Icon name="close" size={14}/></button></div>}
    </main>
  );
}
