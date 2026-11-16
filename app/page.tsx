"use client";

import { FormEvent, useMemo, useState } from "react";

type Site = { id: number; url: string; status: "Setup draft" };

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
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
  };
  return <svg {...common}>{paths[name] ?? paths.grid}</svg>;
}

export default function Home() {
  const [sites, setSites] = useState<Site[]>(initialSites);
  const [showAdd, setShowAdd] = useState(false);
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");

  const filteredSites = useMemo(() => sites.filter((site) => site.url.toLowerCase().includes(query.toLowerCase())), [sites, query]);

  function addSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!/^https?:\/\/.+\..+/.test(trimmed)) {
      setNotice("Enter a complete website address, including https://");
      return;
    }
    setSites((current) => [...current, { id: Date.now(), url: trimmed, status: "Setup draft" }]);
    setUrl("");
    setShowAdd(false);
    setNotice("Draft added to this preview. Monitoring is not connected yet.");
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
          <a className="nav-item active" href="#overview"><Icon name="grid"/> Overview</a>
          <a className="nav-item" href="#websites"><Icon name="globe"/> Websites <span className="nav-count">{sites.length}</span></a>
          <a className="nav-item" href="#circuits"><Icon name="layers"/> Circuits</a>
          <a className="nav-item" href="#activity"><Icon name="activity"/> Activity</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="network-card">
            <div className="network-top"><span className="network-dot"/> NETWORK</div>
            <strong>X Layer</strong>
            <span className="network-sub">Read-only connection · not active</span>
          </div>
          <a className="nav-item settings-link" href="#settings"><Icon name="settings"/> Settings</a>
          <div className="profile">
            <div className="avatar">V</div>
            <div><strong>voidedfx0</strong><span>Personal workspace</span></div>
            <span className="profile-menu">···</span>
          </div>
        </div>
      </aside>

      <section className="main-panel" id="overview">
        <header className="topbar">
          <div className="breadcrumbs">Workspace <span>/</span> <strong>Overview</strong></div>
          <div className="topbar-right"><span className="preview-pill"><span/> Preview environment</span><button className="icon-button" aria-label="Search websites" onClick={() => document.getElementById("site-search")?.focus()}><Icon name="search"/></button></div>
        </header>

        <div className="content">
          <div className="welcome-row">
            <div><div className="eyebrow">MONITORING WORKSPACE</div><h1>Website integrity, <span>in focus.</span></h1><p className="intro">A clear view of what changes across your DeWEB sites and circuits.</p></div>
            <button className="primary-button" onClick={() => { setShowAdd(true); setNotice(""); }}><Icon name="plus" size={17}/> Add a website</button>
            <div className="motion-visual" aria-hidden="true">
              <div className="motion-grid" />
              <div className="motion-ring ring-outer" />
              <div className="motion-ring ring-middle" />
              <div className="motion-ring ring-inner" />
              <div className="motion-core"><span className="core-mark" /></div>
              <span className="motion-node node-a" /><span className="motion-node node-b" /><span className="motion-node node-c" />
              <div className="motion-scan" />
              <div className="motion-caption"><span className="motion-live-dot" /> INTEGRITY SIGNAL <b>READY TO CONNECT</b></div>
            </div>
          </div>

          <div className="notice-bar"><span className="notice-icon"><Icon name="shield" size={17}/></span><div><strong>You're viewing the TapeWatch preview</strong><p>No live blockchain data or website monitoring is connected yet. Nothing here is presented as a verified result.</p></div><span className="preview-tag">PREVIEW</span></div>

          <section className="stats-grid" aria-label="Monitoring summary">
            <article className="stat-card"><div className="stat-head">Websites monitored <span className="stat-icon"><Icon name="globe"/></span></div><div className="stat-number">{sites.length}<small> / —</small></div><div className="stat-foot">Sites added to this preview</div></article>
            <article className="stat-card"><div className="stat-head">Integrity checks <span className="stat-icon"><Icon name="shield"/></span></div><div className="stat-number">—</div><div className="stat-foot">Awaiting verification setup</div></article>
            <article className="stat-card"><div className="stat-head">Changes detected <span className="stat-icon"><Icon name="activity"/></span></div><div className="stat-number">—</div><div className="stat-foot">No live event feed connected</div></article>
            <article className="stat-card"><div className="stat-head">Circuits tracked <span className="stat-icon"><Icon name="layers"/></span></div><div className="stat-number">—</div><div className="stat-foot">Contract integration pending</div></article>
          </section>

          <section className="section-card" id="websites">
            <div className="section-heading"><div><h2>Your websites</h2><p>Manage the sites you want to keep an eye on.</p></div><button className="text-button" onClick={() => setShowAdd(true)}>Add website <Icon name="arrow" size={15}/></button></div>
            <div className="table-toolbar"><div className="table-title">ALL SITES <span>{sites.length}</span></div><label className="search-box"><Icon name="search" size={16}/><input id="site-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search websites..." /></label></div>
            {filteredSites.length ? <div className="site-list">{filteredSites.map((site) => <div className="site-row" key={site.id}><div className="site-favicon"><Icon name="globe" size={17}/></div><div className="site-details"><strong>{site.url}</strong><span>Added in this browser preview</span></div><span className="draft-status"><span/> Setup draft</span></div>)}</div> : <div className="empty-state"><div className="empty-illustration"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="empty-globe"><Icon name="globe" size={29}/></div><span className="spark spark-one"/> <span className="spark spark-two"/></div><h3>{query ? "No matching websites" : "Nothing on your watchlist yet"}</h3><p>{query ? "Try a different search term." : "Add a website to start setting up your monitoring workspace. You can review the setup before anything is connected."}</p>{!query && <button className="secondary-button" onClick={() => setShowAdd(true)}><Icon name="plus" size={16}/> Add your first website</button>}</div>}
          </section>

          <div className="lower-grid">
            <section className="mini-card" id="circuits"><div className="mini-heading"><div><span className="mini-icon"><Icon name="layers" size={17}/></span><h2>Circuit activity</h2></div><span className="coming-soon">IN DEVELOPMENT</span></div><p>Track circuit NFT ownership and related events once the relevant contracts and event sources are verified.</p><div className="mini-foot"><span><Icon name="clock" size={14}/> Not connected</span><span>Learn about circuits <Icon name="arrow" size={13}/></span></div></section>
            <section className="mini-card" id="activity"><div className="mini-heading"><div><span className="mini-icon"><Icon name="activity" size={17}/></span><h2>Recent activity</h2></div><span className="coming-soon">LIVE FEED PENDING</span></div><div className="activity-empty"><span className="activity-line"/><p>Activity will appear here when monitoring is connected.</p></div></section>
          </div>
          <footer className="footer"><span>© 2026 TapeWatch</span><span>Built for transparency <i>·</i> Read-only by design</span></footer>
        </div>
      </section>

      {showAdd && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAdd(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><div className="eyebrow">NEW WATCHLIST ENTRY</div><h2 id="modal-title">Add a website</h2></div><button className="icon-button" onClick={() => setShowAdd(false)} aria-label="Close"><Icon name="close"/></button></div><p className="modal-copy">Enter the public website address you'd like to monitor. For now, this creates a local preview draft only.</p><form onSubmit={addSite}><label className="field-label" htmlFor="website-url">Website URL</label><input id="website-url" className="url-input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" autoFocus/><div className="modal-note"><Icon name="shield" size={15}/> No wallet connection or transaction required.</div>{notice && <p className="form-notice">{notice}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setShowAdd(false)}>Cancel</button><button type="submit" className="primary-button">Add preview draft <Icon name="arrow" size={15}/></button></div></form></section></div>}
      {notice && !showAdd && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><Icon name="close" size={14}/></button></div>}
    </main>
  );
}
