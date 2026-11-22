"use client";

type TokenSignalInput = {
  name: string;
  symbol: string;
  liquidityUsd: string | null;
  volume24hUsd: string | null;
  buys24h: number | null;
  sells24h: number | null;
  priceChange24h: string | null;
  poolCreatedAt: string | null;
  dex: string;
};
type ContractSignalInput = { isContract: boolean; bytecodeBytes: number; sourceVerification: string } | null;

export default function TokenSignalFusion({ token, contract, signals }: {
  token: TokenSignalInput;
  contract: ContractSignalInput;
  signals: string[];
}) {
  const liquidity = Number(token.liquidityUsd);
  const volume = Number(token.volume24hUsd);
  const total = (token.buys24h ?? 0) + (token.sells24h ?? 0);
  const buyShare = total ? (token.buys24h ?? 0) / total : null;
  const volumeRatio = Number.isFinite(liquidity) && liquidity > 0 && Number.isFinite(volume) ? volume / liquidity : null;
  const flags = [
    ...(volumeRatio !== null && volumeRatio >= 1 ? [{ key: "turnover", title: "Elevated pool turnover", detail: `Reported 24h volume is ${volumeRatio.toFixed(2)}× current liquidity.`, severity: "watch" }] : []),
    ...(buyShare !== null && (buyShare >= 0.7 || buyShare <= 0.3) ? [{ key: "mix", title: "One-sided transaction mix", detail: `${Math.round(buyShare * 100)}% of reported 24h pool transactions are buys.`, severity: "watch" }] : []),
    ...(token.priceChange24h !== null && Number.isFinite(Number(token.priceChange24h)) && Math.abs(Number(token.priceChange24h)) >= 10 ? [{ key: "move", title: "Large reported 24h price move", detail: `Provider-reported change: ${Number(token.priceChange24h).toFixed(2)}%.`, severity: "watch" }] : []),
    ...(liquidity > 0 && liquidity < 5000 ? [{ key: "depth", title: "Limited pool depth", detail: "Current indexed pool liquidity is below $5,000; smaller trades may have greater price impact.", severity: "context" }] : []),
    ...(!contract ? [{ key: "contract-pending", title: "Contract checks incomplete", detail: "Bytecode was not retrieved, so contract presence and verification remain unconfirmed.", severity: "unknown" }] : []),
    ...(contract && !contract.isContract ? [{ key: "no-code", title: "No contract bytecode returned", detail: "The RPC lookup did not return deployed bytecode for this address.", severity: "unknown" }] : []),
  ];
  const combined = flags.some((item) => item.key === "turnover") && flags.some((item) => item.key === "mix");
  const ageHours = token.poolCreatedAt ? Math.max(0, (Date.now() - new Date(token.poolCreatedAt).getTime()) / 3_600_000) : null;
  const ageText = ageHours === null || !Number.isFinite(ageHours) ? "Unknown" : ageHours < 24 ? `${Math.max(0, Math.floor(ageHours))}h` : `${Math.floor(ageHours / 24)}d`;

  return <section className="token-intel-panel token-signal-fusion">
    <div className="token-panel-title">
      <div><span className="changes-kicker">TAPEWATCH INTELLIGENCE ENGINE</span><h3>Signal fusion brief</h3></div>
      <small>Evidence-led · live indexed snapshot</small>
    </div>
    <div className="token-fusion-summary">
      <div><span>REVIEW SIGNALS</span><strong>{flags.length}</strong><small>Observed checks needing context</small></div>
      <div><span>POOL AGE</span><strong>{ageText}</strong><small>Pool age, not token deployment age</small></div>
      <div><span>DATA COVERAGE</span><strong>{contract ? "Partial" : "Limited"}</strong><small>Market index + RPC bytecode lookup</small></div>
    </div>
    {combined && <div className="token-fusion-relationship"><strong>Related pattern detected</strong><p>Elevated turnover and a one-sided transaction mix are present together. This combination can warrant closer review, but does not establish manipulation, coordinated activity or selling pressure.</p></div>}
    {flags.length ? <div className="token-fusion-list">{flags.map((flag) => <article key={flag.key} data-severity={flag.severity}><span>{flag.severity === "watch" ? "REVIEW" : flag.severity === "unknown" ? "UNVERIFIED" : "CONTEXT"}</span><div><strong>{flag.title}</strong><p>{flag.detail}</p></div></article>)}</div> : <p className="token-empty-inline">No configured review thresholds were crossed in the available snapshot. This is not a clean bill of health.</p>}
    <div className="token-fusion-next"><strong>What TapeWatch cannot confirm yet</strong><p>Market cap, FDV, circulating supply, top holders, CEX wallet balances, ownership privileges, source verification and historical contract changes require additional reliable sources. They are intentionally shown as unavailable until verified data is connected.</p></div>
    <p className="token-footnote">Signals are rule-based observations from the displayed pool snapshot. They are not a security audit, a threat verdict or a prediction. {signals.length ? `${signals.length} additional activity observation(s) are available in the Activity Intelligence section.` : "No additional activity threshold is currently active."}</p>
  </section>;
}
