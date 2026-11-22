"use client";

import { useEffect, useMemo, useState } from "react";

type Token = { address: string; name: string; symbol: string; role: string; poolAddress: string; poolName: string; poolCreatedAt: string | null; dex: string; liquidityUsd: string | null; volume24hUsd: string | null; buys24h: number | null; sells24h: number | null; priceChange24h: string | null; priceUsd: string | null };
type Trade = { id: string; timestamp: string | null; side: string; hash: string; wallet: string; fromAmount: string | null; toAmount: string | null; priceUsd: string | null; volumeUsd: string | null };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type LiveEvent = { hash: string; block: string; time: string };
type Range = "1H" | "24H" | "7D" | "30D" | "90D" | "6M";
const ranges: Range[] = ["1H", "24H", "7D", "30D", "90D", "6M"];

const money = (v: string | number | null | undefined) => v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 8 });
const short = (v: string) => v ? v.slice(0, 8) + "…" + v.slice(-6) : "—";
const compact = (v: number) => Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(v);

export default function TokenActivityPanel({ token }: { token: Token }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [range, setRange] = useState<Range>("7D");
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState("");
  const [chartUpdated, setChartUpdated] = useState("");
  const [contract, setContract] = useState<{ isContract: boolean; bytecodeBytes: number; sourceVerification: string } | null>(null);
  const [feedState, setFeedState] = useState("Connecting to X Layer…");
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState("");
  const [activityUpdated, setActivityUpdated] = useState("");
  const [latestBlock, setLatestBlock] = useState("");

  useEffect(() => {
    let active = true;
    let busy = false;
    const loadTrades = async () => {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch(`/api/tokens/xlayer/${token.poolAddress}?view=activity&side=${token.role}`, { cache: "no-store" });
        const data = await response.json();
        if (!active) return;
        if (response.ok && data.ok) {
          setTrades(data.trades ?? []);
          setActivityUpdated(data.checkedAt ?? new Date().toISOString());
          setError("");
        } else setError(data.error ?? "Trade history unavailable.");
      } catch { if (active) setError("Trade history source could not be reached."); }
      finally { busy = false; }
    };
    const loadContract = async () => {
      try {
        const response = await fetch(`/api/tokens/xlayer/${token.address}?view=contract`, { cache: "no-store" });
        const data = await response.json();
        if (active && data.ok) setContract(data);
      } catch { /* Contract lookup is independent of the live activity feed. */ }
    };
    void loadTrades();
    void loadContract();
    const timer = window.setInterval(() => { void loadTrades(); }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token.address, token.poolAddress, token.role]);

  useEffect(() => {
    let active = true;
    const loadChart = async () => {
      setChartLoading(true);
      setChartError("");
      try {
        const response = await fetch(`/api/tokens/xlayer/${token.poolAddress}?view=ohlcv&side=${token.role}&range=${range}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Price history is unavailable for this pool.");
        if (active) { setCandles(data.candles ?? []); setChartUpdated(data.checkedAt ?? ""); }
      } catch (caught) {
        if (active) setChartError(caught instanceof Error ? caught.message : "Price history is unavailable.");
      } finally { if (active) setChartLoading(false); }
    };
    void loadChart();
    return () => { active = false; };
    const timer = window.setInterval(() => { void loadChart(); }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token.poolAddress, token.role, range]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let requestId = 1;
    const pendingSubscriptions = new Map<number, "blocks" | "pool">();
    const connect = () => {
      if (disposed) return;
      try {
        setFeedState("Connecting to X Layer…");
        socket = new WebSocket("wss://xlayerws.okx.com");
        socket.onopen = () => {
          const blocksId = requestId++;
          const poolId = requestId++;
          pendingSubscriptions.set(blocksId, "blocks");
          pendingSubscriptions.set(poolId, "pool");
          socket?.send(JSON.stringify({ jsonrpc: "2.0", id: blocksId, method: "eth_subscribe", params: ["newHeads"] }));
          socket?.send(JSON.stringify({ jsonrpc: "2.0", id: poolId, method: "eth_subscribe", params: ["logs", { address: token.poolAddress }] }));
        };
        socket.onmessage = (message) => {
          try {
            const data = JSON.parse(String(message.data));
            if (typeof data?.id === "number" && pendingSubscriptions.has(data.id)) {
              const kind = pendingSubscriptions.get(data.id);
              pendingSubscriptions.delete(data.id);
              if (data.result) setFeedState(kind === "blocks" ? "Connected · live block stream" : "Connected · pool log stream");
              else setFeedState("Subscription rejected · retrying");
              return;
            }
            if (data?.error) { setFeedState("Live subscription unavailable"); return; }
            if (data?.method !== "eth_subscription") return;
            const result = data?.params?.result;
            if (result?.number && result?.hash) {
              setLatestBlock(result.number);
              setFeedState("Live · X Layer blocks received");
            }
            if (result?.transactionHash) {
              setFeedState("Live · pool events received");
              setEvents((current) => [{ hash: result.transactionHash, block: result.blockNumber ?? "—", time: new Date().toISOString() }, ...current.filter((item) => item.hash !== result.transactionHash)].slice(0, 12));
            }
          } catch { /* Ignore malformed provider messages. */ }
        };
        socket.onerror = () => setFeedState("Connection error · retrying");
        socket.onclose = () => { if (!disposed) { setFeedState("Disconnected · retrying"); reconnect = setTimeout(connect, 4000); } };
      } catch { setFeedState("Live feed unavailable"); }
    };
    connect();
    return () => { disposed = true; if (reconnect) clearTimeout(reconnect); socket?.close(); };
  }, [token.poolAddress]);

  const insights = useMemo(() => {
    const buys = token.buys24h ?? 0, sells = token.sells24h ?? 0, total = buys + sells;
    const buyShare = total ? Math.round((buys / total) * 100) : null;
    const volumeLiquidity = Number(token.liquidityUsd) > 0 ? Number(token.volume24hUsd) / Number(token.liquidityUsd) : null;
    return { total, buyShare, volumeLiquidity };
  }, [token.buys24h, token.sells24h, token.liquidityUsd, token.volume24hUsd]);

  const points = candles.map((c) => c.close).filter((v) => Number.isFinite(v) && v > 0);
  const low = points.length ? Math.min(...points) : 0;
  const high = points.length ? Math.max(...points) : 0;
  const spread = Math.max(high - low, Math.abs(high) * 0.001, 1e-12);
  const chartPath = points.map((v, i) => `${points.length > 1 ? 8 + (i / (points.length - 1)) * 584 : 8},${190 - ((v - low) / spread) * 158}`).join(" ");
  const areaPath = points.length ? `M ${chartPath.replaceAll(" ", " L ")} L 592 198 L 8 198 Z` : "";
  const latest = candles[candles.length - 1];
  const first = candles[0];
  const change = first && latest && first.open > 0 ? ((latest.close - first.open) / first.open) * 100 : null;
  const volumeTotal = candles.reduce((sum, candle) => sum + (Number(candle.volume) || 0), 0);
  const medianVolume = candles.length > 2 ? [...candles.slice(0, -1).map((c) => c.volume)].sort((a, b) => a - b)[Math.floor((candles.length - 2) / 2)] : 0;
  const latestVolume = latest?.volume ?? 0;
  const volumeMultiple = medianVolume > 0 ? latestVolume / medianVolume : null;
  const signals = [
    ...(volumeMultiple != null && volumeMultiple >= 3 ? [`Latest candle volume is ${volumeMultiple.toFixed(1)}× the median of earlier candles.`] : []),
    ...(insights.buyShare != null && (insights.buyShare >= 70 || insights.buyShare <= 30) ? [`Reported 24h transaction mix is weighted ${insights.buyShare >= 70 ? "toward buys" : "toward sells"} (${insights.buyShare}% buys).`] : []),
    ...(token.priceChange24h != null && Math.abs(Number(token.priceChange24h)) >= 10 ? [`Provider reports a ${Number(token.priceChange24h).toFixed(2)}% 24h price move.`] : []),
    ...(Number(token.liquidityUsd) > 0 && Number(token.volume24hUsd) / Number(token.liquidityUsd) >= 1 ? ["24h reported volume is at least as large as current pool liquidity."] : [])
  ];

  return <div className="token-intelligence-extra">
    <div className="token-live-heading"><div><span className="changes-kicker">ON-CHAIN ACTIVITY</span><h3>Pool activity stream</h3></div><span className="token-live-status"><i/> {feedState}{latestBlock ? ` · block ${Number.parseInt(latestBlock, 16).toLocaleString()}` : ""}</span></div>
    <section className="token-intel-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">TOKEN & MARKET CONTEXT</span><h3>{token.name} ({token.symbol})</h3></div><small>{activityUpdated ? `Activity checked ${new Date(activityUpdated).toLocaleTimeString()}` : "Waiting for market data"}</small></div>
      <div className="info-rows">
        <div><span>Indexed venue</span><strong>{token.dex}</strong></div>
        <div><span>Pool / pair</span><strong>{token.poolName}</strong></div>
        <div><span>Pool age</span><strong>{token.poolCreatedAt ? new Date(token.poolCreatedAt).toLocaleString() : "Not supplied"}</strong></div>
        <div><span>Token contract</span><strong><a href={`https://www.okx.com/web3/explorer/xlayer/token/${token.address}`} target="_blank" rel="noreferrer">{short(token.address)} ↗</a></strong></div>
        <div><span>Pool contract / explorer</span><strong><a href={`https://www.okx.com/web3/explorer/xlayer/address/${token.poolAddress}`} target="_blank" rel="noreferrer">{short(token.poolAddress)} ↗</a></strong></div>
      </div>
      <p className="token-footnote">Venue and pair identify where this indexed liquidity pool exists. They do not confirm a centralized exchange listing or recommend a trading venue.</p>
    </section>
    <div className="token-intel-grid">
      <article><span>24H TRANSACTIONS</span><strong>{insights.total.toLocaleString()}</strong><small>{token.buys24h ?? "—"} buys · {token.sells24h ?? "—"} sells</small></article>
      <article><span>BUY SHARE</span><strong>{insights.buyShare == null ? "—" : insights.buyShare + "%"}</strong><small>Share of reported 24h pool transactions</small></article>
      <article><span>VOLUME / LIQUIDITY</span><strong>{insights.volumeLiquidity == null ? "—" : insights.volumeLiquidity.toFixed(2) + "×"}</strong><small>24h volume divided by current pool liquidity</small></article>
      <article><span>CONTRACT CODE</span><strong>{contract ? (contract.isContract ? "Detected" : "Not found") : "Checking…"}</strong><small>{contract ? `${contract.bytecodeBytes.toLocaleString()} bytecode bytes · source verification not checked` : "X Layer RPC lookup"}</small></article>
    </div>
    <section className="token-intel-panel token-chart-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">MARKET HISTORY</span><h3>Price chart</h3></div><small>{chartUpdated ? `Indexed data · updated ${new Date(chartUpdated).toLocaleTimeString()}` : "Historical market data"}</small></div>
      <div className="token-chart-toolbar" role="group" aria-label="Chart time range">
        {ranges.map((item) => <button type="button" key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)} aria-pressed={range === item}>{item}</button>)}
      </div>
      <div className="token-chart-summary">
        <div><span>LAST RECORDED CLOSE</span><strong>{money(latest?.close ?? token.priceUsd)}</strong></div>
        <div><span>RANGE CHANGE</span><strong className={change == null ? "" : change >= 0 ? "token-positive" : "token-negative"}>{change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</strong></div>
        <div><span>RANGE VOLUME</span><strong>{volumeTotal ? `$${compact(volumeTotal)}` : "—"}</strong></div>
      </div>
      {chartLoading ? <div className="token-chart-placeholder">Loading {range} price history…</div> : chartError ? <p className="token-empty-inline">{chartError}</p> : points.length > 1 ? <div className="token-chart-canvas">
        <svg className="token-chart" viewBox="0 0 600 220" role="img" aria-label={`${range} price chart for ${token.symbol}`}>
          {[40, 90, 140, 190].map((y) => <line key={y} x1="8" x2="592" y1={y} y2={y} stroke="#ffffff" strokeOpacity=".08" strokeDasharray="3 5"/>)}
          <defs><linearGradient id="token-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#b5ef73" stopOpacity=".22"/><stop offset="100%" stopColor="#b5ef73" stopOpacity="0"/></linearGradient></defs>
          <path d={areaPath} fill="url(#token-chart-fill)"/>
          <polyline points={chartPath} fill="none" stroke="#b5ef73" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
          <circle cx="592" cy={190 - ((points[points.length - 1] - low) / spread) * 158} r="4" fill="#b5ef73"/>
        </svg>
        <div className="token-chart-axis"><span>{new Date(first?.time ? first.time * 1000 : 0).toLocaleString()}</span><span>{new Date(latest?.time ? latest.time * 1000 : 0).toLocaleString()}</span></div>
      </div> : <div className="token-chart-placeholder">Not enough indexed candles are available for this range.</div>}
      <div className="token-chart-legend"><span><i/> Price in USD</span><span>{candles.length.toLocaleString()} candles · {range}</span><span>Source: GeckoTerminal</span></div>
      <p className="token-footnote">Historical candles are provider-indexed. The X Layer event stream below is a separate on-chain feed; a raw pool log is not itself a decoded trade or a live USD price tick.</p>
    </section>
    <section className="token-intel-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">OBSERVED SIGNALS</span><h3>Activity intelligence</h3></div><small>Rule-based observations · no forecasts</small></div>
      {signals.length ? <ul className="token-signal-list">{signals.map((signal) => <li key={signal}><i/> {signal}</li>)}</ul> : <p className="token-empty-inline">No configured activity thresholds were crossed in the currently available data.</p>}
      <p className="token-footnote">Signals are descriptive thresholds, not proof of manipulation, token quality, or future price movement.</p>
    </section>
    <section className="token-intel-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">RECENT SWAPS</span><h3>Buy and sell transactions</h3></div><small>{activityUpdated ? `Provider checked ${new Date(activityUpdated).toLocaleTimeString()} · refreshes every 60s` : "Provider-indexed trades"}</small></div>
      {trades.length ? <div className="token-trade-list">{trades.map((trade) => <div className="token-trade-row" key={trade.id + trade.hash}>
        <span className={trade.side.toLowerCase() === "buy" ? "trade-buy" : trade.side.toLowerCase() === "sell" ? "trade-sell" : "trade-event"}>{trade.side.toUpperCase()}</span>
        <span><strong>{money(trade.volumeUsd)}</strong><small>{trade.timestamp ? new Date(trade.timestamp).toLocaleString() : "Time unavailable"}</small></span>
        <span><strong>{short(trade.wallet)}</strong><small>Trader address</small></span>
        <a href={`https://www.okx.com/web3/explorer/xlayer/tx/${trade.hash}`} target="_blank" rel="noreferrer">Transaction ↗</a>
      </div>)}</div> : <p className="token-empty-inline">{error || "No indexed trades returned for this pool."}</p>}
      <p className="token-footnote">Trade labels and amounts come from the market-data provider. This feed refreshes every 60 seconds; provider data may itself be cached for about one minute. New X Layer blocks arrive over WebSocket, but raw logs are not automatically classified as buys or sells.</p>
    </section>
    <section className="token-intel-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">LIVE CHAIN EVENTS</span><h3>New pool logs</h3></div><small>WebSocket · X Layer mainnet</small></div>
      {events.length ? <div className="token-trade-list">{events.map((event) => <div className="token-trade-row" key={event.hash}><span className="trade-event">ON-CHAIN</span><span><strong>Pool event detected</strong><small>{new Date(event.time).toLocaleTimeString()} · block {Number.parseInt(event.block, 16).toLocaleString()}</small></span><span><strong>{short(event.hash)}</strong><small>Transaction hash</small></span><a href={`https://www.okx.com/web3/explorer/xlayer/tx/${event.hash}`} target="_blank" rel="noreferrer">Inspect ↗</a></div>)}</div> : <p className="token-empty-inline">Waiting for the next event emitted by this pool. The live feed reports raw logs and new block headers; it does not guess buy/sell direction. A DEX-specific swap decoder is required to classify every pool event accurately.</p>}
    </section>
    <p className="token-footnote">Contract bytecode presence does not prove that a token is safe, verified, or trustworthy. TapeWatch is an informational monitoring interface.</p>
  </div>;
}