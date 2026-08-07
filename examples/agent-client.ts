/**
 * The whole town, end to end: discover → book a table → book a room → buy a
 * thing → download it → cancel → verify a signature.
 *
 *   PRIVATE_KEY=0x... BASE_URL=http://localhost:4038 npx tsx examples/agent-client.ts
 *
 * The wallet needs testnet USDC on Base Sepolia — faucet: https://faucet.circle.com
 * Three paid calls at $0.001 each. The whole run costs $0.003.
 *
 * This sandbox is DUAL-RAIL: every 402 offers USDC on Base *and* USDC on Solana.
 * This example takes the EVM rail (see the Solana note at the bottom of the file).
 */
import { privateKeyToAccount } from "viem/accounts";
import { selectPaymentRequirements } from "x402/client";
import type { PaymentRequirements } from "x402/types";
import { wrapFetchWithPayment } from "x402-fetch";

const BASE_URL = process.env.BASE_URL || "http://localhost:4038";
const pk = process.env.PRIVATE_KEY;
if (!pk) {
  console.error("Set PRIVATE_KEY to a funded Base Sepolia wallet (testnet USDC: https://faucet.circle.com)");
  process.exit(1);
}

const account = privateKeyToAccount(pk as `0x${string}`);

// The 402 lists both rails. A viem wallet can only sign the EVM one, so pin the
// selector to the EVM network instead of letting the default picker choose.
const EVM_NETWORK = (process.env.NETWORK || "base-sepolia") as "base" | "base-sepolia";
const payFetch = wrapFetchWithPayment(fetch, account, undefined, (reqs: PaymentRequirements[]) =>
  selectPaymentRequirements(reqs, EVM_NETWORK, "exact"),
);

function receipt(res: Response): string {
  const h = res.headers.get("x-payment-response");
  if (!h) return "(no X-PAYMENT-RESPONSE header)";
  try {
    return JSON.stringify(JSON.parse(Buffer.from(h, "base64").toString("utf8")));
  } catch {
    return h;
  }
}

const post = (path: string, body: unknown) =>
  payFetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function inDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  console.log(`agent wallet: ${account.address}\n`);

  // 0. Free: discover the town.
  const town = await (await fetch(`${BASE_URL}/town`)).json();
  console.log(`GET /town  (free) → ${town.merchants.length} merchants:`);
  for (const m of town.merchants) console.log(`  ${m.name.padEnd(22)} mirrors ${m.mirrors}`);
  console.log();

  // 1. Free: look at what's open. Same schema as x402-tablebook /availability.
  const avail = await (await fetch(`${BASE_URL}/restaurant/availability?date=${inDays(7)}&party=2`)).json();
  console.log(`GET /restaurant/availability  (free) → ${avail.slots.length} slots at ${avail.restaurant.name}\n`);

  // 2. Paid: book a table ($0.001). Response is the tablebook confirmation, verbatim.
  console.log("POST /restaurant/book  ($0.001) …");
  const bookRes = await post("/restaurant/book", {
    date: inDays(7),
    time: "19:00",
    party: 2,
    name: "Ada Lovelace",
    notes: "window please",
  });
  const reservation = await bookRes.json();
  console.log(JSON.stringify({ ...reservation, ics: `${reservation.ics?.slice(0, 24)}… (base64 ICS)` }, null, 2));
  console.log("payment receipt:", receipt(bookRes), "\n");

  // 3. Paid: book a room ($0.001).
  console.log("POST /hotel/book  ($0.001) …");
  const hotelRes = await post("/hotel/book", {
    checkIn: inDays(7),
    checkOut: inDays(9),
    guests: 2,
    name: "Ada Lovelace",
  });
  const booking = await hotelRes.json();
  console.log(
    JSON.stringify({ ...booking, ics: `${booking.ics?.slice(0, 24)}… (base64 ICS)` }, null, 2),
  );
  console.log("payment receipt:", receipt(hotelRes), "\n");

  // 4. Paid: buy a digital item ($0.001) — storefront's signed-artifact envelope.
  console.log("POST /store/buy  ($0.001) …");
  const buyRes = await post("/store/buy", { sku: "sandbox-guide" });
  const order = await buyRes.json();
  console.log(JSON.stringify(order, null, 2));
  console.log("payment receipt:", receipt(buyRes), "\n");

  // 5. Free: redeem the download token that purchase gave us.
  const asset = await (await fetch(`${BASE_URL}${order.payload.downloadUrl}`)).text();
  console.log(`GET ${order.payload.downloadUrl}  (free) → ${asset.length} bytes:\n`);
  console.log(asset.split("\n").slice(0, 3).join("\n"), "\n");

  // 6. Free: cancel the table. Echo confirmedTime so refundability is judged for real.
  const cancel = await (
    await fetch(`${BASE_URL}/restaurant/cancel/${reservation.reservationId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancelToken: reservation.cancelToken, confirmedTime: reservation.confirmedTime }),
    })
  ).json();
  console.log("POST /restaurant/cancel/:id  (free) →", JSON.stringify(cancel.refundLedgerEntry), "\n");

  // 7. Free: verify a signature without holding the secret.
  const verified = await (
    await fetch(`${BASE_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: order.payload, signature: order.signature }),
    })
  ).json();
  console.log("POST /verify  (free) → valid:", verified.valid);

  console.log("\nTotal spent: $0.003. Point BASE_URL at the real merchants and the same code runs unchanged.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Paying on the SOLANA rail instead
 *
 * The same 402 also offers `{ scheme: "exact", network: "solana", asset: <USDC
 * mint>, payTo: <base58>, maxAmountRequired, extra: { feePayer } }`. A Solana
 * agent builds an SPL `transferChecked` for that amount to `payTo` with the
 * facilitator's `feePayer` as fee payer (so it needs no SOL), signs it, and
 * retries with the base64 X-PAYMENT envelope:
 *
 *   const challenge = await (await fetch(`${BASE_URL}/store/buy`, {
 *     method: "POST", headers: { "Content-Type": "application/json" },
 *     body: JSON.stringify({ sku: "sandbox-guide" }),
 *   })).json();
 *   const accept = challenge.accepts.find((a) => a.network.startsWith("solana"));
 *   // build + sign the SPL transfer with @solana/web3.js, or let the browser
 *   // modal do it: @three-ws/x402-payment-modal drives Phantom end to end
 *   // (that is exactly what the demo page at GET / does).
 *   const xPayment = Buffer.from(JSON.stringify({
 *     x402Version: 1, scheme: "exact", network: accept.network,
 *     payload: { transaction: signedTxBase64 },
 *   })).toString("base64");
 *   // then retry the same request with { headers: { "X-PAYMENT": xPayment } }
 *
 * Raw dual-rail 402 body, for reference:
 *   curl -s -X POST http://localhost:4038/store/buy -H 'content-type: application/json' \
 *     -d '{"sku":"sandbox-guide"}' | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
 * ───────────────────────────────────────────────────────────────────────────── */
