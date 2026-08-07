# x402-agent-sandbox — agent skill

A fake town on testnet. Three merchants — a restaurant, a hotel, and a store — implement the
x402 suite's **exact** response contracts, so agent code you write against this sandbox ports
1:1 to the real services. Every paid route costs $0.001 and returns a deterministic,
HMAC-signed confirmation in the same response. Reads are free here, so exploring the town
costs nothing. Nothing is really reserved, shipped, or charged beyond the micropayment.

**Base URL**: `{BASE_URL}` (self-hosted — e.g. `http://localhost:4021`)

**Start here**: `GET /town` — the merchant directory, with every route, price, and what it mirrors.

## What each merchant mirrors

| Sandbox merchant | Routes | Mirrors |
|---|---|---|
| Chez Sandbox (restaurant) | `/restaurant/availability`, `/restaurant/book`, `/restaurant/cancel/:id` | [x402-tablebook](https://github.com/nirholas/x402-tablebook) |
| The Sandbox Inn (hotel) | `/hotel/search`, `/hotel/book`, `/hotel/cancel/:id` | [x402-hotel-search](https://github.com/nirholas/x402-hotel-search) offers + the suite lodging confirmation |
| Sandbox Supply Co. (store) | `/store/catalog`, `/store/buy`, `/store/download/:token` | [x402-storefront](https://github.com/nirholas/x402-storefront) |

**Determinism**: confirmations are seeded by the request body. The same booking request always
returns the same `reservationId`/`bookingId`/`orderId`, the same `cancelToken`, and the same
table or room assignment. Assert on those fields freely — only timestamps move.

## Endpoints

### GET /town — free
Directory of merchants, their routes and prices, what each mirrors, plus the payment rails and
the discovery manifest URL. Start every session here.

### POST /restaurant/book — $0.001 (paid via x402)
Mirrors `x402-tablebook POST /book`.

Body:
```json
{ "date": "2026-09-01", "time": "19:00", "party": 2, "name": "Ada Lovelace", "notes": "window please" }
```
`date` `YYYY-MM-DD`, `time` `HH:MM` 24h within 17:00–22:00, `party` 1–8, `name` required, `notes` optional.

Response `201` (the purchased artifact — keep `cancelToken`):
```json
{
  "reservationId": "res_1a2b3c4d5e6f",
  "status": "confirmed",
  "restaurant": "Chez Sandbox",
  "confirmedTime": "2026-09-01T19:00",
  "party": 2,
  "name": "Ada Lovelace",
  "table": { "id": "T1", "name": "Window 1", "type": "window", "seats": 2 },
  "refundTerms": { "holdPrice": "$0.001", "freeCancellationHours": 2, "description": "…" },
  "cancelToken": "…64 hex chars",
  "cancelEndpoint": "POST /restaurant/cancel/res_1a2b3c4d5e6f",
  "ledgerEntry": { "kind": "hold", "amount": "$0.001", "reason": "refundable reservation hold paid via x402", "at": "…" },
  "ics": "QkVHSU46VkNBTEVOREFS… (base64 .ics)",
  "createdAt": "2026-08-07T12:00:00.000Z",
  "sandbox": { "environment": "sandbox", "merchant": "restaurant", "note": "…" },
  "signature": "hex HMAC-SHA256 over the canonical confirmation"
}
```
Errors: `400 INVALID_DATE|INVALID_TIME|INVALID_PARTY|INVALID_NAME`, `409 OUTSIDE_HOURS|NO_TABLE`.

### POST /hotel/book — $0.001 (paid via x402)
The lodging sibling of the reservation confirmation.

Body:
```json
{ "checkIn": "2026-09-01", "checkOut": "2026-09-03", "guests": 2, "name": "Ada Lovelace", "roomType": "DELUXE_KING" }
```
`roomType` optional (`STANDARD_KING`, `STANDARD_TWIN`, `DELUXE_KING`, `SUITE`); `guests` 1–4.

Response `201`:
```json
{
  "bookingId": "htl_1a2b3c4d5e6f",
  "status": "confirmed",
  "hotel": "The Sandbox Inn",
  "hotelId": "HTL_SANDBOX_01",
  "stay": { "checkIn": "2026-09-01", "checkOut": "2026-09-03", "nights": 2, "checkInTime": "15:00", "checkOutTime": "11:00" },
  "guests": 2,
  "name": "Ada Lovelace",
  "room": { "roomType": "DELUXE_KING", "description": "Deluxe king, park view", "beds": 1, "maxOccupancy": 3 },
  "price": { "nightly": "189.00", "total": "378.00", "currency": "USD", "nights": 2 },
  "refundTerms": { "holdPrice": "$0.001", "freeCancellationHours": 24, "description": "…" },
  "cancelToken": "…", "cancelEndpoint": "POST /hotel/cancel/htl_1a2b3c4d5e6f",
  "ledgerEntry": { "kind": "hold", "amount": "$0.001", "reason": "refundable room hold paid via x402", "at": "…" },
  "ics": "…", "createdAt": "…", "sandbox": { … }, "signature": "…"
}
```
Errors: `400 INVALID_DATE|INVALID_GUESTS|INVALID_NAME`, `409 NO_ROOM`.

### POST /store/buy — $0.001 (paid via x402)
Mirrors `x402-storefront GET /buy/:sku`. Same `{ payload, signature, algorithm, canonicalization }` envelope.

Body: `{ "sku": "sandbox-guide" }`, plus `name`, `address`, `country` for physical items.
SKUs: `sandbox-guide` and `sandbox-dataset` (digital), `sandbox-stickers` and `sandbox-mug` (physical).

Digital response `201`:
```json
{
  "payload": {
    "orderId": "ord_…", "sku": "sandbox-guide", "kind": "digital",
    "downloadUrl": "/store/download/<signed-token>",
    "downloadExpiresAt": "2026-08-07T13:00:00.000Z",
    "contentType": "text/markdown",
    "contentSha256": "…",
    "license": "single-purchaser, non-transferable, unlimited personal/agent use",
    "purchasedAt": "…", "sandbox": { … }
  },
  "signature": "hex…", "algorithm": "HMAC-SHA256", "canonicalization": "sorted-keys-json"
}
```
Fetch `downloadUrl` (free, no payment) before `downloadExpiresAt`; verify with `contentSha256`.

Physical response `201`:
```json
{
  "payload": {
    "orderId": "ord_…", "sku": "sandbox-stickers", "kind": "physical",
    "fulfillment": {
      "status": "accepted",
      "promise": "ships within 5 business days (sandbox — nothing actually ships)",
      "shipTo": { "name": "Ada Lovelace", "address": "1 Testnet Row", "country": "US" },
      "weightGrams": 20
    },
    "supportEmail": "nichxbt@gmail.com", "purchasedAt": "…", "sandbox": { … }
  },
  "signature": "hex…", "algorithm": "HMAC-SHA256", "canonicalization": "sorted-keys-json"
}
```
Errors: `400 INVALID_SKU`, `404 UNKNOWN_SKU`, `409 UNSUPPORTED_COUNTRY`.

### Free routes
- `GET /restaurant/availability?date&party&days` — open slots (tablebook `/availability` schema).
- `GET /hotel/search?checkIn&checkOut&guests` — room offers (hotel-search `/search` schema).
- `GET /store/catalog` — items, prices, buy route (storefront `/catalog` schema).
- `POST /restaurant/cancel/:id` `{cancelToken, confirmedTime?}` — cancellation record + refund ledger entry.
- `POST /hotel/cancel/:id` `{cancelToken, checkIn?}` — same shape.
- `GET /store/download/:token` — redeems a digital purchase; returns the raw bytes.
- `POST /verify` `{payload, signature}` — `{valid, canonical}` for any artifact this sandbox signed.
- `GET /health`, `GET /skill.md`, `GET /.well-known/x402`.

Echo `confirmedTime` / `checkIn` back on a cancel to have refundability judged against the real
clock; omit it and the hold is treated as refundable (the friendly default for a test target).

## Payment

x402 protocol (HTTP 402). **Pay in USDC on Base or Solana — your client picks the rail.**

Every paid route answers an unpaid request with one `402` whose `accepts` array lists both rails:

| rail | network | asset | payTo | facilitator |
|---|---|---|---|---|
| EVM | `base-sepolia` (default) or `base` | USDC | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `https://x402.org/facilitator` |
| Solana | `solana` (default) or `solana-devnet` | USDC | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | `https://facilitator.payai.network` |

Flow: call the route → receive `402` with `accepts` → pick the entry your wallet supports → sign
the USDC payment (EIP-3009 authorization on EVM, SPL `transferChecked` on Solana) → retry with
the base64 `X-PAYMENT` header. The artifact comes back in the `201` body and the settlement
receipt (`{rail, network, transaction, payer}`) in the `X-PAYMENT-RESPONSE` header.

Pay with `x402-fetch` + `viem` (EVM), any x402 Solana client, or `@three-ws/x402-payment-modal`
in a browser. At $0.001 a call on testnet, running your whole purchase flow end to end costs
essentially nothing.

## Error codes

| HTTP | code | meaning |
|---|---|---|
| 400 | `INVALID_DATE` / `INVALID_TIME` / `INVALID_PARTY` / `INVALID_GUESTS` / `INVALID_NAME` / `INVALID_SKU` | malformed request |
| 402 | (x402) | payment required — pay and retry |
| 403 | `BAD_CANCEL_TOKEN` / `BAD_TOKEN` / `TOKEN_EXPIRED` | cancel or download token rejected |
| 404 | `NOT_FOUND` / `UNKNOWN_SKU` | unknown id or sku |
| 409 | `OUTSIDE_HOURS` / `NO_TABLE` / `NO_ROOM` / `UNSUPPORTED_COUNTRY` / `ALREADY_CANCELLED` | request conflicts with the merchant's rules |
| 500 | `INTERNAL` | unexpected error |

Machine-readable manifest: [`/.well-known/x402`]({BASE_URL}/.well-known/x402)

Contact: **nichxbt@gmail.com**
