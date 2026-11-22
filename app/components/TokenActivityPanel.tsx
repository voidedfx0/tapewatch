"use client";

import { useEffect, useMemo, useState } from "react";
import TokenSignalFusion from "./TokenSignalFusion";

type Token = { networkKey: string; address: string; name: string; symbol: string; role: string; poolAddress: string; poolName: string; poolCreatedAt: string | null; dex: string; liquidityUsd: string | null; volume24hUsd: string | null; buys24h: number | null; sells24h: number | null; priceChange24h: string | null; priceUsd: string | null };
type Trade = { id: string; timestamp: string | null; side: string; hash: string; wallet: string; fromAmount: string | null; toAmount: string | null; priceUsd: string | null; volumeUsd: string | null };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type LiveEvent = { hash: string; block: string; time: string };
type Range = "1H" | "24H" | "7D" | "30D" | "90D" | "6M";
type CandleInterval = "1m" | "5m";
const ranges: Range[] = ["1H", "24H", "7D", "30D", "90D", "6M"];

const money = (v: string | number | null | undefined) => v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 8 });
const short = (v: string) => v ? v.slice(0, 8) + "…" + v.slice(-6) : "—";
const compact = (v: number) => Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(v);

const NETWORK_META: Record<string, { name: string; explorer: string; txPath: string; accountPath: string; poolPath: string }> = { xlayer: { name: "X Layer", explorer: "https://www.okx.com/web3/explorer/xlayer", txPath: "/tx/", accountPath: "/token/", poolPath: "/address/" }, ethereum: { name: "Ethereum", explorer: "https://etherscan.io", txPath: "/tx/", accountPath: "/token/", poolPath: "/address/" }, bnb: { name: "BNB Chain", explorer: "https://bscscan.com", txPath: "/tx/", accountPath: "/token/", poolPath: "/address/" }, solana: { name: "Solana", explorer: "https://solscan.io", txPath: "/tx/", accountPath: "/token/", poolPath: "/account/" } };

export default function TokenActivityPanel({ token }: { token: Token }) {
  const network = NETWORK_META[token.networkKey] ?? NETWORK_META.xlayer;
  const apiBase = `/api/tokens/${token.networkKey}/${encodeURIComponent(token.poolAddress)}`;
  const [trades, setTrades] = useState<Trade[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [range, setRange] = useState<Range>("1H");
  const [candleInterval, setCandleInterval] = useState<CandleInterval>("1m");
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState("");
  const [chartUpdated, setChartUpdated] = useState("");
  const [contract, setContract] = useState<{ isContract: boolean; bytecodeBytes: number | null; sourceVerification: string; accountType?: string; owner?: string | null; executable?: boolean | null } | null>(null);
  const [feedState, setFeedState] = useState("Connecting to indexed market feed…");
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState("");
  const [activityUpdated, setActivityUpdated] = useState("");
  const [latestBlock, setLatestBlock] = useState("");

  useEffect(() => {
    let active = true;
    let busy = false;
    let contractBusy = false;
    const loadTrades = async () => {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch(`${apiBase}?view=activity&side=${token.role}`, { cache: "no-store" });
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
      if (contractBusy) return;
      contractBusy = true;
      try {
        const response = await fetch(`/api/tokens/${token.networkKey}/${encodeURIComponent(token.address)}?view=contract`, { cache: "no-store" });
        const data = await response.json();
        if (active && data.ok) setContract(data);
      } catch { /* Contract lookup is independent of the live activity feed. */ }
      finally { contractBusy = false; }
    };
    void loadTrades();
    void loadContract();
    const timer = window.setInterval(() => { void loadTrades(); void loadContract(); }, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token.address, token.poolAddress, token.role, token.networkKey, apiBase]);

  useEffect(() => {
    let active = true;
    let chartBusy = false;
    const loadChart = async () => {
      if (chartBusy) return;
      chartBusy = true;
      setChartLoading(true);
      setChartError("");
      try {
        const response = await fetch(`${apiBase}?view=ohlcv&side=${token.role}&range=${range}&interval=${candleInterval}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Price history is unavailable for this pool.");
        if (active) { setCandles(data.candles ?? []); setChartUpdated(data.checkedAt ?? ""); }
      } catch (caught) {
        if (active) setChartError(caught instanceof Error ? caught.message : "Price history is unavailable.");
      } finally { chartBusy = false; if (active) setChartLoading(false); }
    };
    void loadChart();
    const timer = window.setInterval(() => { void loadChart(); }, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token.poolAddress, token.role, token.networkKey, apiBase, range, candleInterval]);

  useEffect(() => {
    if (token.networkKey !== "xlayer") { setFeedState("Provider-indexed polling · " + network.name); setEvents([]); setLatestBlock(""); return; }
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
  }, [token.poolAddress, token.networkKey, network.name]);

  const insights = useMemo(() => {
    const buys = token.buys24h ?? 0, sells = token.sells24h ?? 0, total = buys + sells;
    const buyShare = total ? Math.round((buys / total) * 100) : null;
    const volumeLiquidity = Number(token.liquidityUsd) > 0 ? Number(token.volume24hUsd) / Number(token.liquidityUsd) : null;
    return { total, buyShare, volumeLiquidity };
  }, [token.buys24h, token.sells24h, token.liquidityUsd, token.volume24hUsd]);

  const validCandles = candles.filter((c) => [c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0));
  const points = validCandles.map((c) => c.close);
  const low = validCandles.length ? Math.min(...validCandles.map((c) => c.low)) : 0;
  const high = validCandles.length ? Math.max(...validCandles.map((c) => c.high)) : 0;
  const spread = Math.max(high - low, Math.abs(high) * 0.001, 1e-12);
  const yFor = (value: number) => 190 - ((value - low) / spread) * 158;
  const candleWidth = Math.max(2, Math.min(9, 560 / Math.max(validCandles.length, 1) * 0.58));
  const candleShapes = validCandles.map((c, i) => {
    const x = 14 + (i / Math.max(validCandles.length - 1, 1)) * 572;
    const up = c.close >= c.open;
    return { x, wickTop: yFor(c.high), wickBottom: yFor(c.low), bodyTop: Math.min(yFor(c.open), yFor(c.close)), bodyHeight: Math.max(1.5, Math.abs(yFor(c.open) - yFor(c.close))), up, key: c.time };
  });
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
        <div><span>Token / mint address</span><strong><a href={`${network.explorer}${network.accountPath}${token.address}`} target="_blank" rel="noreferrer">{short(token.address)} ↗</a></strong></div>
        <div><span>Pool / account explorer</span><strong><a href={`${network.explorer}${network.poolPath}${token.poolAddress}`} target="_blank" rel="noreferrer">{short(token.poolAddress)} ↗</a></strong></div>
      </div>
      <p className="token-footnote">Venue and pair identify where this indexed liquidity pool exists. They do not confirm a centralized exchange listing or recommend a trading venue.</p>
    </section>
    <div className="token-intel-grid">
      <article><span>24H TRANSACTIONS</span><strong>{insights.total.toLocaleString()}</strong><small>{token.buys24h ?? "—"} buys · {token.sells24h ?? "—"} sells</small></article>
      <article><span>BUY SHARE</span><strong>{insights.buyShare == null ? "—" : insights.buyShare + "%"}</strong><small>Share of reported 24h pool transactions</small></article>
      <article><span>VOLUME / LIQUIDITY</span><strong>{insights.volumeLiquidity == null ? "—" : insights.volumeLiquidity.toFixed(2) + "×"}</strong><small>24h volume divided by current pool liquidity</small></article>
      <article><span>ACCOUNT / CODE</span><strong>{contract ? (contract.isContract ? "Detected" : "Not found") : "Checking…"}</strong><small>{contract ? `${contract.bytecodeBytes == null ? (contract.accountType ?? "Account found") : contract.bytecodeBytes.toLocaleString() + " bytecode bytes"} · source verification not checked` : network.name + " RPC account lookup"}</small></article>
    </div>
    <TokenSignalFusion token={token} contract={contract} signals={signals} />
    <section className="token-intel-panel token-chart-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">MARKET HISTORY</span><h3>Price chart</h3></div><small>{chartUpdated ? `Indexed data · updated ${new Date(chartUpdated).toLocaleTimeString()}` : "Historical market data"}</small></div>
      <div className="token-chart-controls">
        <div className="token-chart-toolbar" role="group" aria-label="Chart time range">
          {ranges.map((item) => <button type="button" key={item} className={range === item ? "active" : ""} onClick={() => setRange(item)} aria-pressed={range === item}>{item}</button>)}
        </div>
        {(range === "1H" || range === "24H") && <div className="token-chart-toolbar token-interval-toolbar" role="group" aria-label="Candle interval">
          <span>INTERVAL</span>
          {(["1m", "5m"] as CandleInterval[]).map((item) => <button type="button" key={item} className={candleInterval === item ? "active" : ""} onClick={() => setCandleInterval(item)} aria-pressed={candleInterval === item}>{item}</button>)}
        </div>}
      </div>
      <div className="token-chart-summary">
        <div><span>LAST RECORDED CLOSE</span><strong>{money(latest?.close ?? token.priceUsd)}</strong></div>
        <div><span>RANGE CHANGE</span><strong className={change == null ? "" : change >= 0 ? "token-positive" : "token-negative"}>{change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</strong></div>
        <div><span>RANGE VOLUME</span><strong>{volumeTotal ? `$${compact(volumeTotal)}` : "—"}</strong></div>
      </div>
      {chartLoading ? <div className="token-chart-placeholder">Loading {range} price history…</div> : chartError ? <p className="token-empty-inline">{chartError}</p> : validCandles.length > 0 ? <div className="token-chart-canvas">
        <svg className="token-chart" viewBox="0 0 600 220" role="img" aria-label={`${range} candlestick price chart for ${token.symbol}`}>
          {[40, 90, 140, 190].map((y) => <line key={y} x1="8" x2="592" y1={y} y2={y} stroke="#ffffff" strokeOpacity=".08" strokeDasharray="3 5"/>)}
          {candleShapes.map((c) => <g key={c.key}>
            <line x1={c.x} x2={c.x} y1={c.wickTop} y2={c.wickBottom} stroke={c.up ? "#b5ef73" : "#e18b8b"} strokeWidth="1.3"/>
            <rect x={c.x - candleWidth / 2} y={c.bodyTop} width={candleWidth} height={c.bodyHeight} rx=".8" fill={c.up ? "#b5ef73" : "#e18b8b"} opacity=".92"/>
          </g>)}
          {latest && <g><line x1="8" x2="592" y1={yFor(latest.close)} y2={yFor(latest.close)} stroke="#b5ef73" strokeOpacity=".5" strokeDasharray="4 4"/><circle cx="586" cy={yFor(latest.close)} r="3.5" fill="#b5ef73"/></g>}
        </svg>
        <div className="token-chart-axis"><span>{new Date(first?.time ? first.time * 1000 : 0).toLocaleString()}</span><span>{new Date(latest?.time ? latest.time * 1000 : 0).toLocaleString()}</span></div>
      </div> : <div className="token-chart-placeholder">Not enough indexed candles are available for this range.</div>}
      <div className="token-chart-legend"><span><i/> Price in USD · OHLC candles</span><span>{candles.length.toLocaleString()} candles · {range}{(range === "1H" || range === "24H") ? ` · ${candleInterval}` : ""}</span><span>Source: GeckoTerminal</span></div>
      <p className="token-footnote">Historical candles are provider-indexed. The live event stream is a separate on-chain feed where a chain WebSocket is connected; raw logs are not automatically decoded into trades.</p>
    </section>
    <section className="token-intel-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">OBSERVED SIGNALS</span><h3>Activity intelligence</h3></div><small>Rule-based observations · no forecasts</small></div>
      {signals.length ? <ul className="token-signal-list">{signals.map((signal) => <li key={signal}><i/> {signal}</li>)}</ul> : <p className="token-empty-inline">No configured activity thresholds were crossed in the currently available data.</p>}
      <p className="token-footnote">Signals are descriptive thresholds, not proof of manipulation, token quality, or future price movement.</p>
    </section>
    <section className="token-intel-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">RECENT SWAPS</span><h3>Buy and sell transactions</h3></div><small>{activityUpdated ? `Provider checked ${new Date(activityUpdated).toLocaleTimeString()} · refreshes every 5s` : "Provider-indexed trades"}</small></div>
      {trades.length ? <div className="token-trade-list">{trades.map((trade) => <div className="token-trade-row" key={trade.id + trade.hash}>
        <span className={trade.side.toLowerCase() === "buy" ? "trade-buy" : trade.side.toLowerCase() === "sell" ? "trade-sell" : "trade-event"}>{trade.side.toUpperCase()}</span>
        <span><strong>{money(trade.volumeUsd)}</strong><small>{trade.timestamp ? new Date(trade.timestamp).toLocaleString() : "Time unavailable"}</small></span>
        <span><strong>{short(trade.wallet)}</strong><small>Trader address</small></span>
        <a href={`${network.explorer}${network.txPath}${trade.hash}`} target="_blank" rel="noreferrer">Transaction ↗</a>
      </div>)}</div> : <p className="token-empty-inline">{error || "No indexed trades returned for this pool."}</p>}
      <p className="token-footnote">Trade labels and amounts come from the market-data provider. This feed is requested every 5 seconds; provider indexing and caching may delay newly confirmed transactions. The X Layer pool also has a raw WebSocket log stream; other networks use indexed polling until dedicated live subscriptions are connected.</p>
    </section>
    <section className="token-intel-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">LIVE CHAIN EVENTS</span><h3>New pool logs</h3></div><small>{token.networkKey === "xlayer" ? "WebSocket · X Layer mainnet" : "Provider-indexed · " + network.name}</small></div>
      {events.length ? <div className="token-trade-list">{events.map((event) => <div className="token-trade-row" key={event.hash}><span className="trade-event">ON-CHAIN</span><span><strong>Pool event detected</strong><small>{new Date(event.time).toLocaleTimeString()} · block {Number.parseInt(event.block, 16).toLocaleString()}</small></span><span><strong>{short(event.hash)}</strong><small>Transaction hash</small></span><a href={`${network.explorer}${network.txPath}${event.hash}`} target="_blank" rel="noreferrer">Inspect ↗</a></div>)}</div> : <p className="token-empty-inline">{token.networkKey === "xlayer" ? "Waiting for the next event emitted by this pool. Raw logs and new block headers are not automatically classified as buys or sells." : "Dedicated raw WebSocket subscriptions are not connected for this network yet. TapeWatch uses indexed trade polling here; no live event stream is claimed."}</p>}
    </section>
    <p className="token-footnote">Contract bytecode presence does not prove that a token is safe, verified, or trustworthy. TapeWatch is an informational monitoring interface.</p>
  </div>;
}