"use client";

import { useEffect, useMemo, useState } from "react";

type Token = { address: string; symbol: string; poolAddress: string; poolName: string; liquidityUsd: string | null; volume24hUsd: string | null; buys24h: number | null; sells24h: number | null; priceChange24h: string | null; priceUsd: string | null };
type Trade = { id: string; timestamp: string | null; side: string; hash: string; wallet: string; fromAmount: string | null; toAmount: string | null; priceUsd: string | null; volumeUsd: string | null };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type LiveEvent = { hash: string; block: string; time: string };

const money = (v: string | number | null | undefined) => v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });
const short = (v: string) => v ? v.slice(0, 8) + "…" + v.slice(-6) : "—";

export default function TokenActivityPanel({ token }: { token: Token }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [contract, setContract] = useState<{ isContract: boolean; bytecodeBytes: number; sourceVerification: string } | null>(null);
  const [feedState, setFeedState] = useState("Connecting to X Layer…");
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [tradeRes, candleRes, contractRes] = await Promise.all([
          fetch(`/api/tokens/xlayer/${token.poolAddress}?view=activity`, { cache: "no-store" }),
          fetch(`/api/tokens/xlayer/${token.poolAddress}?view=ohlcv`, { cache: "no-store" }),
          fetch(`/api/tokens/xlayer/${token.address}?view=contract`, { cache: "no-store" })
        ]);
        const [tradeData, candleData, contractData] = await Promise.all([tradeRes.json(), candleRes.json(), contractRes.json()]);
        if (!active) return;
        if (tradeData.ok) setTrades(tradeData.trades ?? []); else setError(tradeData.error ?? "Trade history unavailable.");
        if (candleData.ok) setCandles(candleData.candles ?? []);
        if (contractData.ok) setContract(contractData);
      } catch { if (active) setError("Some intelligence sources could not be reached."); }
    };
    void load();
    return () => { active = false; };
  }, [token.address, token.poolAddress]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let requestId = 1;
    const connect = () => {
      if (disposed) return;
      try {
        socket = new WebSocket("wss://xlayerws.okx.com");
        socket.onopen = () => {
          setFeedState("Live chain connection");
          socket?.send(JSON.stringify({ jsonrpc: "2.0", id: requestId++, method: "eth_subscribe", params: ["logs", { address: token.poolAddress }] }));
        };
        socket.onmessage = (message) => {
          try {
            const data = JSON.parse(String(message.data));
            const log = data?.params?.result;
            if (data?.error) setFeedState("Live feed unavailable");
            if (log?.transactionHash) {
              setEvents((current) => [{ hash: log.transactionHash, block: log.blockNumber ?? "—", time: new Date().toISOString() }, ...current.filter((item) => item.hash !== log.transactionHash)].slice(0, 12));
            }
          } catch { /* Ignore malformed provider messages. */ }
        };
        socket.onerror = () => setFeedState("Reconnecting to chain feed…");
        socket.onclose = () => { if (!disposed) { setFeedState("Reconnecting to chain feed…"); reconnect = setTimeout(connect, 4000); } };
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

  const points = candles.map((c) => c.close).filter((v) => Number.isFinite(v));
  const min = Math.min(...points, 0), max = Math.max(...points, 1);
  const path = points.map((v, i) => `${points.length > 1 ? (i / (points.length - 1)) * 300 : 0},${70 - ((v - min) / Math.max(max - min, 1e-12)) * 62}`).join(" ");
  const medianVolume = candles.length > 2 ? [...candles.slice(0, -1).map((c) => c.volume)].sort((a, b) => a - b)[Math.floor((candles.length - 2) / 2)] : 0;
  const latestVolume = candles.at(-1)?.volume ?? 0;
  const volumeMultiple = medianVolume > 0 ? latestVolume / medianVolume : null;
  const signals = [
    ...(volumeMultiple != null && volumeMultiple >= 3 ? [`Latest hourly volume is ${volumeMultiple.toFixed(1)}× the median of earlier candles.`] : []),
    ...(insights.buyShare != null && (insights.buyShare >= 70 || insights.buyShare <= 30) ? [`Reported 24h transaction mix is weighted ${insights.buyShare >= 70 ? "toward buys" : "toward sells"} (${insights.buyShare}% buys).`] : []),
    ...(token.priceChange24h != null && Math.abs(Number(token.priceChange24h)) >= 10 ? [`Provider reports a ${Number(token.priceChange24h).toFixed(2)}% 24h price move.`] : []),
    ...(Number(token.liquidityUsd) > 0 && Number(token.volume24hUsd) / Number(token.liquidityUsd) >= 1 ? ["24h reported volume is at least as large as current pool liquidity."] : [])
  ];

  return <div className="token-intelligence-extra">
    <div className="token-live-heading"><div><span className="changes-kicker">ON-CHAIN ACTIVITY</span><h3>Pool activity stream</h3></div><span className="token-live-status"><i/> {feedState}</span></div>
    <div className="token-intel-grid">
      <article><span>24H TRANSACTIONS</span><strong>{insights.total.toLocaleString()}</strong><small>{token.buys24h ?? "—"} buys · {token.sells24h ?? "—"} sells</small></article>
      <article><span>BUY SHARE</span><strong>{insights.buyShare == null ? "—" : insights.buyShare + "%"}</strong><small>Share of reported 24h pool transactions</small></article>
      <article><span>VOLUME / LIQUIDITY</span><strong>{insights.volumeLiquidity == null ? "—" : insights.volumeLiquidity.toFixed(2) + "×"}</strong><small>24h volume divided by current pool liquidity</small></article>
      <article><span>CONTRACT CODE</span><strong>{contract ? (contract.isContract ? "Detected" : "Not found") : "Checking…"}</strong><small>{contract ? `${contract.bytecodeBytes.toLocaleString()} bytecode bytes · source verification not checked` : "X Layer RPC lookup"}</small></article>
    </div>
    <section className="token-intel-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">OBSERVED SIGNALS</span><h3>Activity intelligence</h3></div><small>Rule-based observations · no price forecasts</small></div>
      {signals.length ? <ul className="token-signal-list">{signals.map((signal) => <li key={signal}><i/> {signal}</li>)}</ul> : <p className="token-empty-inline">No configured activity thresholds were crossed in the currently available data.</p>}
      <p className="token-footnote">Signals are descriptive thresholds, not proof of manipulation, token quality, or future price movement. Historical liquidity comparisons require a longer saved snapshot history.</p>
    </section>
    <section className="token-intel-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">MARKET HISTORY</span><h3>48-hour price trace</h3></div><small>Hourly candles · provider-indexed</small></div>
      {points.length > 1 ? <svg className="token-chart" viewBox="0 0 300 76" role="img" aria-label="Hourly token price chart"><polyline points={path} fill="none" stroke="#9bd39b" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/></svg> : <p className="token-empty-inline">Historical candles are not available for this pool yet.</p>}
      <div className="token-chart-footer"><span>Latest indexed price <strong>{money(token.priceUsd)}</strong></span><span>24h change <strong>{token.priceChange24h == null ? "—" : Number(token.priceChange24h).toFixed(2) + "%"}</strong></span></div>
    </section>
    <section className="token-intel-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">RECENT SWAPS</span><h3>Buy and sell transactions</h3></div><small>Latest provider-indexed trades</small></div>
      {trades.length ? <div className="token-trade-list">{trades.map((trade) => <div className="token-trade-row" key={trade.id + trade.hash}>
        <span className={trade.side.toLowerCase() === "buy" ? "trade-buy" : trade.side.toLowerCase() === "sell" ? "trade-sell" : ""}>{trade.side.toUpperCase()}</span>
        <span><strong>{money(trade.volumeUsd)}</strong><small>{trade.timestamp ? new Date(trade.timestamp).toLocaleString() : "Time unavailable"}</small></span>
        <span><strong>{short(trade.wallet)}</strong><small>Trader address</small></span>
        <a href={`https://www.okx.com/web3/explorer/xlayer/tx/${trade.hash}`} target="_blank" rel="noreferrer">Transaction ↗</a>
      </div>)}</div> : <p className="token-empty-inline">{error || "No indexed trades returned for this pool."}</p>}
      <p className="token-footnote">Trade labels and amounts come from the market-data provider. A transaction may be indexed after it is confirmed; this feed is not a pending-order or mempool feed.</p>
    </section>
    <section className="token-intel-panel">
      <div className="token-panel-title"><div><span className="changes-kicker">LIVE CHAIN EVENTS</span><h3>New pool logs</h3></div><small>WebSocket · X Layer mainnet</small></div>
      {events.length ? <div className="token-trade-list">{events.map((event) => <div className="token-trade-row" key={event.hash}><span className="trade-event">ON-CHAIN</span><span><strong>Pool event detected</strong><small>{new Date(event.time).toLocaleTimeString()} · block {Number.parseInt(event.block, 16).toLocaleString()}</small></span><span><strong>{short(event.hash)}</strong><small>Transaction hash</small></span><a href={`https://www.okx.com/web3/explorer/xlayer/tx/${event.hash}`} target="_blank" rel="noreferrer">Inspect ↗</a></div>)}</div> : <p className="token-empty-inline">Waiting for the next confirmed event emitted by this pool. The live feed reports raw logs; it does not guess buy/sell direction.</p>}
    </section>
    <p className="token-footnote">TapeWatch intelligence is observational, not a safety certification or investment recommendation. Contract bytecode presence does not prove that a token is safe, verified, or trustworthy.</p>
  </div>;
}
