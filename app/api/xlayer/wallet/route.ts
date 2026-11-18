import { createHmac } from "node:crypto";

const API_HOST = "https://web3.okx.com";
const API_PATH = "/api/v5/xlayer/address/transaction-list";
const EXPLORER = "https://www.okx.com/web3/explorer/xlayer";

type OkxTransaction = {
  txId?: string; height?: string; transactionTime?: string; from?: string; to?: string;
  isFromContract?: boolean; isToContract?: boolean; amount?: string; transactionSymbol?: string;
  state?: string; methodId?: string; txFee?: string; nonce?: string;
};
type OkxResponse = { code?: string; msg?: string; data?: Array<{ transactionLists?: OkxTransaction[]; totalPage?: string; page?: string; limit?: string }> };

function sign(timestamp: string, requestPath: string, secret: string) {
  return createHmac("sha256", secret).update(timestamp + "GET" + requestPath).digest("base64");
}

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json({ ok: false, error: "Enter a valid 0x wallet address." }, { status: 400 });
  }

  const apiKey = process.env.OKX_ONCHAIN_API_KEY;
  const secret = process.env.OKX_ONCHAIN_API_SECRET;
  const passphrase = process.env.OKX_ONCHAIN_API_PASSPHRASE;
  if (!apiKey || !secret || !passphrase) {
    return Response.json({
      ok: false,
      code: "PROVIDER_NOT_CONFIGURED",
      error: "Wallet transaction data is not connected yet. The OKX Onchain API credentials must be added as private Vercel environment variables."
    }, { status: 503 });
  }

  const query = new URLSearchParams({
    chainShortName: "xlayer",
    address,
    protocolType: "transaction",
    page: "1",
    limit: "30"
  });
  const requestPath = API_PATH + "?" + query.toString();
  const timestamp = new Date().toISOString();
  try {
    const response = await fetch(API_HOST + requestPath, {
      method: "GET",
      headers: {
        "OK-ACCESS-KEY": apiKey,
        "OK-ACCESS-SIGN": sign(timestamp, requestPath, secret),
        "OK-ACCESS-TIMESTAMP": timestamp,
        "OK-ACCESS-PASSPHRASE": passphrase
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000)
    });
    const payload = await response.json() as OkxResponse;
    if (!response.ok || payload.code !== "0") {
      const providerMessage = payload.msg || "The OKX data provider rejected the request.";
      return Response.json({ ok: false, error: providerMessage }, { status: response.status >= 400 ? response.status : 502 });
    }
    const page = payload.data?.[0];
    const transactions = (page?.transactionLists ?? []).filter(tx =>
      typeof tx.txId === "string" && /^0x[a-fA-F0-9]{64}$/.test(tx.txId)
    ).map(tx => ({
      hash: tx.txId!,
      blockNumber: tx.height ?? "",
      timestamp: tx.transactionTime ?? "",
      from: tx.from ?? "",
      to: tx.to ?? "",
      fromIsContract: Boolean(tx.isFromContract),
      toIsContract: Boolean(tx.isToContract),
      amount: tx.amount ?? "0",
      symbol: tx.transactionSymbol ?? "OKB",
      status: tx.state ?? "unknown",
      methodId: tx.methodId ?? "",
      fee: tx.txFee ?? "",
      nonce: tx.nonce ?? ""
    }));

    const normalized = address.toLowerCase();
    const outgoing = transactions.filter(tx => tx.from.toLowerCase() === normalized).length;
    const incoming = transactions.filter(tx => tx.to.toLowerCase() === normalized).length;
    const contractInteractions = transactions.filter(tx =>
      (tx.from.toLowerCase() === normalized && tx.toIsContract) ||
      (tx.to.toLowerCase() === normalized && tx.fromIsContract)
    ).length;
    const counterparties = new Set(transactions.map(tx =>
      tx.from.toLowerCase() === normalized ? tx.to.toLowerCase() :
      tx.to.toLowerCase() === normalized ? tx.from.toLowerCase() : ""
    ).filter(Boolean));

    return Response.json({
      ok: true,
      network: "X Layer",
      chainId: 196,
      address,
      source: "OKX X Layer Data API",
      summary: {
        returnedTransactions: transactions.length,
        outgoing,
        incoming,
        contractInteractions,
        uniqueCounterparties: counterparties.size,
        totalPages: Number(page?.totalPage ?? 1)
      },
      transactions,
      note: "This is the latest page of indexed normal transactions, limited to 30 records. It is not a complete wallet history; token transfers and internal transactions are not included in this view."
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet data provider is unavailable.";
    return Response.json({ ok: false, error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
