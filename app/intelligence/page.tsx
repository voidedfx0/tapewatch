"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AuthPanel from "../components/AuthPanel";
import { supabase } from "../../lib/supabase";
import "./intelligence.css";

type Site = { id: string; url: string; status?: string };
type Check = { id: string; website_id: string; checked_at: string; status: string; http_status: number | null; page_title: string | null; content_hash: string | null };
type Change = { id: string; website_id: string; detected_at: string; change_type: string; previous_title: string | null; current_title: string | null; previous_hash: string | null; current_hash: string | null };
type Message = { role: "user" | "assistant"; content: string };

const starters = [
  { icon: "◉", title: "Investigate a website", prompt: "Investigate my selected website. Summarize what TapeWatch knows, the latest observations, and what still needs verification." },
  { icon: "↗", title: "Explain recent changes", prompt: "Analyze the latest recorded website changes. Explain what changed, why it may matter, and what evidence supports each conclusion." },
  { icon: "⌁", title: "Review integrity evidence", prompt: "Review the available SHA-256 fingerprints and check history. Tell me what can and cannot be verified from the saved evidence." },
  { icon: "◇", title: "Explore X Layer", prompt: "Explain the X Layer and TapeOut information currently available in TapeWatch, and clearly separate verified facts from missing data." },
];

function Mark({ children }: { children: React.ReactNode }) {
  return <span className="tw-mark" aria-hidden="true">{children}</span>;
}

export default function IntelligencePage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("all");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [connected, setConnected] = useState(false);
  const [authRequest, setAuthRequest] = useState(0);
  const handleAccessChange = useCallback((next: "visitor" | "authenticated") => setConnected(next === "authenticated"), []);
  const [error, setError] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [activity, setActivity] = useState("Ready for investigation");
  const [lastRun, setLastRun] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    async function loadWorkspace() {
      if (!supabase) {
        setLoadingData(false);
        setError("Supabase is not configured. Add the existing public Supabase environment variables in Vercel.");
        return;
      }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user || session.user.is_anonymous) {
          if (active) {
            setConnected(false);
            setLoadingData(false);
          }
          return;
        }
        const [siteResult, checkResult, changeResult] = await Promise.all([
          supabase.from("websites").select("id, url, status").order("created_at", { ascending: false }).limit(100),
          supabase.from("website_checks").select("id, website_id, checked_at, status, http_status, page_title, content_hash").order("checked_at", { ascending: false }).limit(100),
          supabase.from("website_changes").select("id, website_id, detected_at, change_type, previous_title, current_title, previous_hash, current_hash").order("detected_at", { ascending: false }).limit(100),
        ]);
        if (siteResult.error) throw siteResult.error;
        if (checkResult.error) throw checkResult.error;
        if (changeResult.error) throw changeResult.error;
        if (active) {
          setSites((siteResult.data ?? []) as Site[]);
          setChecks((checkResult.data ?? []) as Check[]);
          setChanges((changeResult.data ?? []) as Change[]);
          setConnected(true);
          setAuthEmail(session.user.email ?? "");
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load TapeWatch workspace data.");
      } finally {
        if (active) setLoadingData(false);
      }
    }
    void loadWorkspace();
    return () => { active = false; };
  }, []);

  const selectedSite = sites.find((site) => site.id === selectedSiteId) ?? null;
  const scopedSiteIds = selectedSite ? [selectedSite.id] : sites.map((site) => site.id);
  const scopedChecks = useMemo(() => checks.filter((item) => scopedSiteIds.includes(item.website_id)).slice(0, 12), [checks, selectedSiteId, sites]);
  const scopedChanges = useMemo(() => changes.filter((item) => scopedSiteIds.includes(item.website_id)).slice(0, 12), [changes, selectedSiteId, sites]);
  const siteName = selectedSite?.url ?? "All monitored websites";
  const evidenceCount = scopedChecks.length + scopedChanges.length;
  const latestCheck = scopedChecks[0] ?? null;
  const latestChange = scopedChanges[0] ?? null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function submitMessage(event?: FormEvent, preset?: string) {
    event?.preventDefault();
    const text = (preset ?? draft).trim();
    if (!text || busy) return;
    if (!supabase) {
      setAuthRequest((value) => value + 1);
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || session.user.is_anonymous) {
        setAuthRequest((value) => value + 1);
        setError("Sign in to start an investigation with your private TapeWatch evidence.");
        return;
      }
    } catch {
      setError("Could not verify your TapeWatch session. Please sign in again.");
      setAuthRequest((value) => value + 1);
      return;
    }
    const nextMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setDraft("");
    setBusy(true);
    setError("");
    setActivity("Reviewing workspace evidence");
    try {
      const context = {
        selectedWebsite: selectedSite ? { id: selectedSite.id, url: selectedSite.url } : null,
        websites: sites.map(({ id, url, status }) => ({ id, url, status })),
        checks: scopedChecks,
        changes: scopedChanges,
        xLayer: "TapeWatch has read-only X Layer / TapeOut API routes. No fresh chain data is attached to this request; do not invent current block heights, transactions, or circuit counts.",
      };
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || session.user.is_anonymous) throw new Error("Your TapeWatch session expired. Please sign in again.");
      const response = await fetch("/api/intelligence/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ messages: nextMessages.slice(-12), context }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The intelligence service could not complete this request.");
      setMessages([...nextMessages, { role: "assistant", content: payload.reply }]);
      setActivity("Investigation complete");
      setLastRun(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setActivity("Investigation paused");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="tw-intel-shell">
      <AuthPanel onAccessChange={handleAccessChange} requestAuth={authRequest} showTrigger={false} openOnVisitor={false} />
      <aside className="tw-intel-sidebar">
        <Link className="tw-intel-brand" href="/" aria-label="TapeWatch home"><Mark>◉</Mark><span>Tape<span>Watch</span></span></Link>
        <div className="tw-side-label">WORKSPACE</div>
        <nav className="tw-side-nav">
          <Link href="/"><span>▦</span> Overview</Link>
          <Link href="/#websites"><span>◎</span> Websites</Link>
          <Link href="/#changes"><span>⌁</span> Changes</Link>
          <Link href="/#timeline"><span>◷</span> Trust Timeline</Link>
        </nav>
        <div className="tw-side-label">ECOSYSTEM</div>
        <nav className="tw-side-nav">
          <Link href="/#circuits"><span>◇</span> Circuits</Link>
          <Link href="/#networks"><span>⌘</span> Networks</Link>
        </nav>
        <div className="tw-side-label">INTELLIGENCE</div>
        <nav className="tw-side-nav">
          <a className="active" href="/intelligence"><span>✳</span> AI Intelligence <i>NEW</i></a>
          <Link href="/#alerts"><span>◌</span> Alerts</Link>
          <Link href="/#reports"><span>▤</span> Reports</Link>
        </nav>
        <div className="tw-sidebar-spacer" />
        <div className="tw-sidebar-status"><span className={connected ? "live" : ""} />{connected ? "WORKSPACE CONNECTED" : "READ-ONLY PREVIEW"}<small>{connected ? authEmail || "Authenticated workspace" : "Sign in to load private evidence"}</small></div>
        <Link className="tw-settings-link" href="/#settings">⚙ <span>Settings</span></Link>
        <div className="tw-profile"><div className="tw-avatar">{authEmail ? authEmail.slice(0,1).toUpperCase() : "T"}</div><div><b>{authEmail || "TapeWatch visitor"}</b><small>Personal workspace</small></div><span>···</span></div>
      </aside>

      <section className="tw-intel-main">
        <header className="tw-intel-topbar">
          <div><span className="tw-crumb">TapeWatch</span><span className="tw-crumb-sep">/</span><b>AI Intelligence</b></div>
          <div className="tw-top-actions"><span className="tw-secure"><span /> PRIVATE WORKSPACE</span>{!connected && <button type="button" onClick={() => setAuthRequest((value) => value + 1)}>Sign in</button>}<button type="button" onClick={() => { setMessages([]); setError(""); setActivity("Ready for investigation"); }}>＋ New investigation</button></div>
        </header>

        <div className="tw-intel-content">
          <section className="tw-chat-column">
            <div className="tw-page-heading">
              <div><div className="tw-eyebrow"><span className="tw-pulse" /> TAPEWATCH INTELLIGENCE ENGINE</div><h1>See beyond the surface.</h1><p>An investigative AI built around website integrity, change history and on-chain evidence.</p></div>
              <div className="tw-model-chip"><Mark>✳</Mark><span><b>Intelligence core</b><small>Evidence-aware analysis</small></span><span className="tw-model-dot" /></div>
            </div>

            <div className="tw-chat-frame">
              <div className="tw-chat-toolbar"><div><span className="tw-orb">✳</span><span><b>Investigation room</b><small>{selectedSite ? selectedSite.url : "Workspace-wide intelligence"}</small></span></div><div className="tw-chat-toolbar-right"><span className="tw-live-dot" /> READY</div></div>
              <div className="tw-chat-scroll">
                {messages.length === 0 ? (
                  <div className="tw-welcome">
                    <div className="tw-welcome-orbit"><span /><i /><b>✳</b></div>
                    <div className="tw-welcome-kicker">YOUR WEBSITE INTELLIGENCE ANALYST</div>
                    <h2>What should we<br /><em>investigate?</em></h2>
                    <p>Ask a question. I'll start with your TapeWatch evidence, connect the relevant signals, and clearly show where the data ends and uncertainty begins.</p>
                    <div className="tw-starter-grid">
                      {starters.map((item) => <button key={item.title} type="button" onClick={() => void submitMessage(undefined, item.prompt)}><span>{item.icon}</span><b>{item.title}</b><i>↗</i></button>)}
                    </div>
                    {!connected && <div className="tw-preview-note">Connect your TapeWatch workspace to let the assistant analyze saved checks, changes and fingerprints.</div>}
                  </div>
                ) : (
                  <div className="tw-messages">
                    {messages.map((message, index) => <div className={"tw-message " + message.role} key={index}><div className="tw-message-avatar">{message.role === "assistant" ? "✳" : "Y"}</div><div className="tw-message-body"><div className="tw-message-meta">{message.role === "assistant" ? "TAPEWATCH INTELLIGENCE" : "YOU"}<span>{message.role === "assistant" ? "EVIDENCE-AWARE RESPONSE" : "MESSAGE"}</span></div><div className="tw-message-text">{message.content}</div></div></div>)}
                    {busy && <div className="tw-message assistant"><div className="tw-message-avatar">✳</div><div className="tw-message-body"><div className="tw-message-meta">TAPEWATCH INTELLIGENCE <span>INVESTIGATING</span></div><div className="tw-thinking"><i /><i /><i /><span>{activity}…</span></div></div></div>}
                    <div ref={endRef} />
                  </div>
                )}
              </div>
              {error && <div className="tw-error">{error}</div>}
              <form className="tw-composer" onSubmit={(event) => void submitMessage(event)}>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitMessage(); } }} placeholder="Ask TapeWatch to investigate a website, change or integrity signal…" rows={2} disabled={busy} />
                <div className="tw-composer-bottom"><span><kbd>↵</kbd> to send · <kbd>Shift + ↵</kbd> for a new line</span><button type="submit" disabled={busy || !draft.trim()}>{busy ? "Investigating…" : "Investigate"} <span>↑</span></button></div>
              </form>
            </div>
            <div className="tw-footnote"><span>◈</span> Responses are grounded in available evidence. TapeWatch AI does not treat an unexplained change as proof of compromise.</div>
          </section>

          <aside className="tw-intel-rail">
            <div className="tw-rail-heading"><div><span className="tw-eyebrow">LIVE CONTEXT</span><h3>Intelligence panel</h3></div><button type="button" title="Refresh workspace data" onClick={() => window.location.reload()}>↻</button></div>
            <div className="tw-context-card">
              <div className="tw-context-top"><span>INVESTIGATION SCOPE</span><span className="tw-context-icon">◎</span></div>
              <select value={selectedSiteId} onChange={(event) => setSelectedSiteId(event.target.value)}><option value="all">All monitored websites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.url}</option>)}</select>
              <small>{loadingData ? "Loading workspace…" : connected ? sites.length + " websites available to analyze" : "Workspace data not connected"}</small>
            </div>
            <div className="tw-rail-section"><div className="tw-rail-title">EVIDENCE INVENTORY <span>{loadingData ? "…" : evidenceCount}</span></div>
              <div className="tw-evidence-row"><span className="tw-evidence-icon">◷</span><div><b>Website checks</b><small>Saved observations</small></div><strong>{scopedChecks.length}</strong></div>
              <div className="tw-evidence-row"><span className="tw-evidence-icon">⌁</span><div><b>Change records</b><small>Detected differences</small></div><strong>{scopedChanges.length}</strong></div>
              <div className="tw-evidence-row"><span className="tw-evidence-icon">#</span><div><b>Fingerprints</b><small>SHA-256 values available</small></div><strong>{scopedChecks.filter((item) => item.content_hash).length}</strong></div>
            </div>
            <div className="tw-rail-section"><div className="tw-rail-title">LATEST SIGNALS <span className="tw-signal-live">● LIVE DATA</span></div>
              <div className="tw-signal-card"><div><span className="tw-signal-dot" /> LAST WEBSITE CHECK</div><b>{latestCheck ? new Date(latestCheck.checked_at).toLocaleString() : "No saved checks"}</b><small>{latestCheck ? (latestCheck.page_title || latestCheck.status) + (latestCheck.http_status ? " · HTTP " + latestCheck.http_status : "") : "Add a website and run its first check."}</small></div>
              <div className="tw-signal-card"><div><span className="tw-signal-dot amber" /> LAST DETECTED CHANGE</div><b>{latestChange ? new Date(latestChange.detected_at).toLocaleString() : "No change records"}</b><small>{latestChange ? (latestChange.previous_title || "Previous version") + " → " + (latestChange.current_title || "Current version") : "Changes will appear after comparison checks."}</small></div>
            </div>
            <div className="tw-rail-section"><div className="tw-rail-title">ANALYST MODULES</div>
              {["Website investigator", "Change intelligence", "Integrity verification", "X Layer / TapeOut"].map((name, index) => <div className="tw-agent-row" key={name}><span>{["◎", "⌁", "⬡", "◇"][index]}</span><b>{name}</b><i>{index === 3 ? "READ-ONLY" : "READY"}</i></div>)}
            </div>
            <div className="tw-rail-footer"><span>✳</span><div><b>{lastRun ? "Last investigation completed" : "Evidence-first intelligence"}</b><small>{lastRun ? new Date(lastRun).toLocaleTimeString() : "No unsupported claims. No fabricated signals."}</small></div></div>
          </aside>
        </div>
      </section>
    </main>
  );
}
