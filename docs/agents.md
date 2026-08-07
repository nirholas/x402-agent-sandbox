# For AI agents

## Discovery

Three things tell an agent everything it needs:

- `GET /town` — the live directory. Merchants, routes, prices, and which real suite service
  each one mirrors. Start every session here.
- [`skill.md`](https://github.com/nirholas/x402-agent-sandbox/blob/main/skill.md) — the
  capability sheet: endpoints, request/response schemas, error codes, payment details. Served
  live at `GET /skill.md`.
- `GET /.well-known/x402` — the machine-readable manifest (`x402Version`, `resources[]` with
  price, **both networks**, asset, `payTo` per rail, and an `outputSchema` per route, plus a
  `mirrors` field pointing at the real service). This is the format indexed by
  [x402scan.com](https://x402scan.com), the x402 Bazaar, and
  [agentic.market](https://agentic.market).

## Paying — two rails, one 402

**Pay in USDC on Base or Solana — your client picks the rail.** Every paid route answers an
unpaid request with a single `402` whose `accepts` array carries both:

| rail | network | asset | payTo | signs |
|---|---|---|---|---|
| EVM | `base-sepolia` (default) / `base` | USDC (`0x036C…CF7e` on Sepolia) | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | EIP-3009 `transferWithAuthorization` |
| Solana | `solana` (default) / `solana-devnet` | USDC (`EPjF…TDt1v`) | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | SPL `transferChecked` |

Verification and settlement go to that rail's facilitator (`FACILITATOR_URL` for EVM,
`SOLANA_FACILITATOR_URL` for Solana) — the server never holds a key, and the Solana lane's
sponsor pays the SOL fee, so a paying agent needs only USDC.

Any x402 client works. With `x402-fetch` on the EVM rail:

```ts
import { privateKeyToAccount } from "viem/accounts";
import { selectPaymentRequirements } from "x402/client";
import { wrapFetchWithPayment } from "x402-fetch";

// Pin the selector to the EVM entry — a viem wallet can't sign the Solana one.
const payFetch = wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.PRIVATE_KEY),
  undefined, (reqs) => selectPaymentRequirements(reqs, "base-sepolia", "exact"));

const res = await payFetch(`${BASE}/restaurant/book`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ date: "2026-09-01", time: "19:00", party: 2, name: "Ada Lovelace" }),
});
const reservation = await res.json();                  // the artifact, in-response
const receipt = res.headers.get("x-payment-response");  // base64 settlement receipt
```

On the Solana rail, pick `accepts.find(a => a.network.startsWith("solana"))`, build and sign
the SPL transfer to its `payTo` using `extra.feePayer` as fee payer, and send the same base64
`X-PAYMENT` envelope. In a browser, `@three-ws/x402-payment-modal` does the whole Solana flow
against this challenge with no wallet code — that is exactly what the demo page at `GET /` does.

The flow is identical on both rails: request → `402` + requirements → client signs a USDC
payment → retry with `X-PAYMENT` → `201` with the artifact in the body and the receipt
(`{rail, network, transaction, payer}`) in `X-PAYMENT-RESPONSE`.

## What you get back

- `POST /restaurant/book` ($0.001) → **the reservation confirmation**, in
  [x402-tablebook](https://github.com/nirholas/x402-tablebook)'s schema field for field: table
  assignment, refund terms, `cancelToken`, ledger entry, base64 ICS invite, HMAC signature.
- `POST /hotel/book` ($0.001) → **the lodging confirmation**: room, nightly and total price,
  refund terms, `cancelToken`, ICS invite, signature.
- `POST /store/buy` ($0.001) → **the storefront envelope**
  (`{payload, signature, algorithm, canonicalization}`): a signed time-limited download URL plus
  license for digital items, or a signed order confirmation plus fulfillment record for physical
  ones.

Nothing is delivered "later" — every payment produces its artifact in the same response, which
is the suite's contract and the thing you are here to test against.

## Why this exists

Testing an agent's purchase flow against real merchants is expensive in three ways: real money,
real reservations someone has to cancel, and real state that makes runs unrepeatable. The
sandbox removes all three while keeping the part that matters — a genuine 402 challenge, a
genuine signed payment, a genuine facilitator settlement, and a response whose shape is
identical to production.

**Determinism** is what makes it a test target rather than a toy. Confirmations are seeded by
the request body, so:

```ts
const a = await book({ date: "2026-09-01", time: "19:00", party: 2, name: "Ada Lovelace" });
const b = await book({ date: "2026-09-01", time: "19:00", party: 2, name: "Ada Lovelace" });
a.reservationId === b.reservationId;   // true
a.cancelToken   === b.cancelToken;     // true
a.table.id      === b.table.id;        // true
```

Assert on exact values. Replay a failing conversation and it fails identically. No snapshot
files full of random ids.

## Porting to the real merchants

Change the base URL and drop the merchant prefix. Nothing about the request or response
changes:

| Sandbox | Real |
|---|---|
| `GET {sandbox}/restaurant/availability` | `GET {tablebook}/availability` — **$0.001**, free here |
| `POST {sandbox}/restaurant/book` | `POST {tablebook}/book` — **$0.01** hold, $0.001 here |
| `POST {sandbox}/restaurant/cancel/:id` | `POST {tablebook}/cancel/:id` — free both sides |
| `GET {sandbox}/hotel/search` | `GET {hotel-search}/search` — **$0.005**, free here |
| `GET {sandbox}/store/catalog` | `GET {storefront}/catalog` — free both sides |
| `POST {sandbox}/store/buy` `{sku}` | `GET {storefront}/buy/:sku` — per-item price |

Two things to remember when you switch: the reads that are free here **cost money there**, so
budget for them; and confirmations there are not deterministic, so drop any assertions on exact
ids.

## MCP integration

See [`examples/mcp-tool.md`](https://github.com/nirholas/x402-agent-sandbox/blob/main/examples/mcp-tool.md)
for a minimal MCP server exposing `sandbox_town`, `sandbox_book_table`, `sandbox_book_room` and
`sandbox_buy_item` to Claude, with a `claude_desktop_config.json` snippet.

Better still: [x402-mcp-commerce](https://github.com/nirholas/x402-mcp-commerce) is a full MCP
commerce server for the whole suite, and its config maps each tool to an upstream base URL.
Point those at this sandbox and you can rehearse the entire toolbox — including the agent's
spending caps and approval flow — without touching a real merchant.

## Listing this service

Operators: to make your deployment discoverable, keep `/.well-known/x402` reachable at your
public origin and submit the URL to x402scan.com, the x402 Bazaar, and agentic.market. The
manifest already carries prices, **both networks**, assets, `payTo` per rail, output schemas,
and a `mirrors` link per resource in their expected shape.

## Contact

**nichxbt@gmail.com**
