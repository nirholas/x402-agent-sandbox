# API reference

Base URL: your deployment (default `http://localhost:4038`). Paid routes speak x402: an unpaid
request returns `402` with `PaymentRequirements` listing **both** payment rails (USDC on Base
and USDC on Solana); pay either and retry with `X-PAYMENT`.
Full machine-readable spec: [`openapi.json`](https://github.com/nirholas/x402-agent-sandbox/blob/main/openapi.json).

Every response carries a `sandbox` block (`{environment: "sandbox", merchant, note}`) so a
rehearsal can never be mistaken for a real booking.

---

## GET /town — free

The directory. Start every session here.

```json
{
  "town": "x402 Agent Sandbox",
  "baseUrl": "http://localhost:4038",
  "payment": {
    "protocol": "x402",
    "note": "Pay in USDC on Base or Solana — your client picks the rail.",
    "rails": ["base-sepolia | base", "solana | solana-devnet"],
    "manifest": "http://localhost:4038/.well-known/x402"
  },
  "determinism": "Confirmations are seeded by the request body: the same booking request always returns the same ids, tokens, and assignments.",
  "merchants": [
    {
      "id": "restaurant", "name": "Chez Sandbox", "kind": "restaurant",
      "mirrors": "x402-tablebook",
      "mirrorsUrl": "https://github.com/nirholas/x402-tablebook",
      "routes": [
        { "route": "GET /restaurant/availability", "price": "free", "note": "$0.001 at the real merchant", "url": "…" },
        { "route": "POST /restaurant/book", "price": "$0.001", "note": "returns the tablebook confirmation schema", "url": "…" },
        { "route": "POST /restaurant/cancel/:id", "price": "free", "note": "auth by cancelToken", "url": "…" }
      ]
    }
  ]
}
```

---

# Chez Sandbox — restaurant

Mirrors [x402-tablebook](https://github.com/nirholas/x402-tablebook).

## GET /restaurant/availability — free

*(`$0.001` at the real merchant — budget for it in production.)*

| Param | Type | Notes |
|---|---|---|
| `date` | `YYYY-MM-DD` | Restrict to one day. |
| `party` | integer 1–8 | Only slots that can seat this many. |
| `days` | integer | Scan window when no `date` is given (default 7, max 30). |

`200` — the x402-tablebook `/availability` schema:

```json
{
  "restaurant": { "name": "Chez Sandbox", "timezone": "America/New_York", "address": "1 Testnet Row, Sandbox City" },
  "slotMinutes": 30,
  "seatingMinutes": 90,
  "refundPolicy": { "holdPrice": "$0.001", "freeCancellationHours": 2, "description": "…" },
  "generatedAt": "2026-08-07T12:00:00.000Z",
  "slots": [
    { "date": "2026-09-01", "time": "19:00", "partySizes": [1,2,3,4,5,6,7,8], "tableTypes": ["window","standard","round"], "openTables": 6 }
  ]
}
```

Occupancy is deterministic per `date`+`time` — the same slot is always equally busy.

## POST /restaurant/book — $0.001

**Body**

| Field | Type | Notes |
|---|---|---|
| `date` | `YYYY-MM-DD` | Required. |
| `time` | `HH:MM` 24h | Required, within 17:00–22:00. |
| `party` | integer 1–8 | Required. |
| `name` | string | Required. |
| `notes` | string | Optional; part of the seed, so different notes → a different reservation. |

**`201`** — the x402-tablebook confirmation, field for field:

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
  "ics": "QkVHSU46VkNBTEVOREFS…",
  "createdAt": "2026-08-07T12:00:00.000Z",
  "sandbox": { "environment": "sandbox", "merchant": "restaurant", "note": "…" },
  "signature": "hex HMAC-SHA256 over the canonical confirmation"
}
```

`cancelToken` is returned exactly once and is the only way to cancel. `ics` is base64 RFC 5545.

**Errors**: `400 INVALID_DATE | INVALID_TIME | INVALID_PARTY | INVALID_NAME`, `402`,
`409 OUTSIDE_HOURS | NO_TABLE`.

## POST /restaurant/cancel/:id — free

**Body**: `{ "cancelToken": "…", "confirmedTime": "2026-09-01T19:00" }` (or header
`X-Cancel-Token`). `confirmedTime` is optional — echo it from your confirmation and
refundability is judged against the real clock; omit it and the hold is treated as refundable.

**`200`**

```json
{
  "reservationId": "res_1a2b3c4d5e6f",
  "status": "cancelled",
  "refunded": true,
  "refundLedgerEntry": { "kind": "refund", "amount": "$0.001", "reason": "…", "at": "…" },
  "ledger": [ { "kind": "hold", … }, { "kind": "refund", … } ],
  "sandbox": { … },
  "signature": "…"
}
```

`refunded` is `false` with `kind: "forfeit"` when cancelling inside the 2-hour window.

**Errors**: `403 BAD_CANCEL_TOKEN`, `404 NOT_FOUND`, `409 ALREADY_CANCELLED`.

---

# The Sandbox Inn — hotel

Offers mirror [x402-hotel-search](https://github.com/nirholas/x402-hotel-search); the
confirmation is the lodging sibling of the reservation above.

## GET /hotel/search — free

*(`$0.005` at the real merchant.)*

| Param | Type | Notes |
|---|---|---|
| `checkIn` | `YYYY-MM-DD` | Defaults to today. |
| `checkOut` | `YYYY-MM-DD` | Defaults to `checkIn` + 1 day. Must be after `checkIn`. |
| `guests` | integer 1–4 | Default 2. Filters by `maxOccupancy`. |

**`200`**

```json
{
  "hotel": {
    "hotelId": "HTL_SANDBOX_01", "name": "The Sandbox Inn", "cityCode": "SBX",
    "address": "2 Faucet Street, Sandbox City", "timezone": "America/New_York",
    "checkInTime": "15:00", "checkOutTime": "11:00"
  },
  "stay": { "checkIn": "2026-09-01", "checkOut": "2026-09-03", "nights": 2, "guests": 2 },
  "currency": "USD",
  "generatedAt": "…",
  "offers": [
    {
      "offerId": "off_…", "roomType": "DELUXE_KING", "description": "Deluxe king, park view",
      "beds": 1, "maxOccupancy": 3, "available": true,
      "price": { "nightly": "189.00", "total": "378.00", "currency": "USD", "nights": 2 },
      "cancellationPolicy": { "holdPrice": "$0.001", "freeCancellationHours": 24, "description": "…" }
    }
  ]
}
```

Room types: `STANDARD_KING`, `STANDARD_TWIN`, `DELUXE_KING`, `SUITE`.

## POST /hotel/book — $0.001

**Body**

| Field | Type | Notes |
|---|---|---|
| `checkIn` | `YYYY-MM-DD` | Required. |
| `checkOut` | `YYYY-MM-DD` | Required, after `checkIn`. |
| `guests` | integer 1–4 | Default 2. |
| `name` | string | Required. |
| `roomType` | enum | Optional; omit to let the sandbox assign one deterministically. |

**`201`**

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
  "cancelToken": "…",
  "cancelEndpoint": "POST /hotel/cancel/htl_1a2b3c4d5e6f",
  "ledgerEntry": { "kind": "hold", "amount": "$0.001", "reason": "refundable room hold paid via x402", "at": "…" },
  "ics": "…", "createdAt": "…", "sandbox": { … }, "signature": "…"
}
```

Note that `price` is the *room* price the merchant would charge on arrival — the x402 payment
is only the $0.001 hold. That split is deliberate: it is how the real lodging contract works.

**Errors**: `400 INVALID_DATE | INVALID_GUESTS | INVALID_NAME`, `402`, `409 NO_ROOM`.

## POST /hotel/cancel/:id — free

**Body**: `{ "cancelToken": "…", "checkIn": "2026-09-01" }`. Same response shape as the
restaurant cancellation, keyed by `bookingId`. Free-cancellation window is 24 hours.

**Errors**: `403 BAD_CANCEL_TOKEN`, `404 NOT_FOUND`, `409 ALREADY_CANCELLED`.

---

# Sandbox Supply Co. — store

Mirrors [x402-storefront](https://github.com/nirholas/x402-storefront), including its
`{ payload, signature, algorithm, canonicalization }` envelope.

## GET /store/catalog — free

```json
{
  "store": { "name": "Sandbox Supply Co.", "shipsTo": ["US","CA","GB","DE","JP"], "supportEmail": "nichxbt@gmail.com" },
  "items": [
    { "sku": "sandbox-guide", "name": "The Sandbox Guide to Agentic Commerce", "type": "digital", "price": "$0.001", "description": "…", "buy": "POST /store/buy" }
  ],
  "sandbox": { … }
}
```

SKUs: `sandbox-guide`, `sandbox-dataset` (digital); `sandbox-stickers`, `sandbox-mug` (physical).

## POST /store/buy — $0.001

**Body**

| Field | Type | Notes |
|---|---|---|
| `sku` | string | Required. |
| `name`, `address`, `country` | string | Physical items only; sensible defaults are filled in. `country` must be one of `shipsTo`. |

**Digital `201`**

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

**Physical `201`**

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

**Errors**: `400 INVALID_SKU`, `402`, `404 UNKNOWN_SKU`, `409 UNSUPPORTED_COUNTRY`.

## GET /store/download/:token — free

Redeems a digital purchase's signed token. Returns the raw bytes with the item's
`Content-Type`. Verify against `payload.contentSha256`.

**Errors**: `403 BAD_TOKEN` (missing, malformed, or tampered), `403 TOKEN_EXPIRED`.

---

## POST /verify — free

`{ "payload": {...}, "signature": "hex" }` → `{ "valid": true, "canonical": "…" }`.

Works for any artifact this sandbox signed. `canonical` is the exact string that was HMAC'd —
keys sorted recursively, no whitespace — so you can reproduce the signature offline with
`SIGNING_SECRET`.

## GET /health — free

`{ ok: true, service: "x402-agent-sandbox", rails: ["base", "solana"] }`.

## GET /skill.md, GET /.well-known/x402 — free

The agent-facing capability sheet and the machine-readable discovery manifest.

## POST /api/x402-checkout — free

The browser payment modal's Solana `prepare`/`encode` endpoints. Phantom signs serialized
transactions rather than typed data, so the SPL transfer is built server-side. Agents never
call this; the EVM rail needs nothing equivalent.

---

## 402 shape (all paid routes)

Dual-rail: `accepts` always lists **both** USDC on Base and USDC on Solana. Pay either one.

```json
{
  "x402Version": 1,
  "error": "Payment required — pay in USDC on Base or Solana; your client picks the rail.",
  "resource": {
    "url": "http://localhost:4038/restaurant/book",
    "description": "Sandbox restaurant booking — returns the x402-tablebook confirmation schema",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "1000",
      "resource": "http://localhost:4038/restaurant/book",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "maxTimeoutSeconds": 60, "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact", "network": "solana", "maxAmountRequired": "1000", "amount": "1000",
      "resource": "http://localhost:4038/restaurant/book",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "maxTimeoutSeconds": 60,
      "extra": { "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4", "name": "USDC", "decimals": 6 }
    }
  ]
}
```

Amounts are atomic units — USDC has 6 decimals, so `1000` is $0.001.

On success the `201` carries the artifact in the body and the receipt in `X-PAYMENT-RESPONSE`
(base64 JSON: `{success, rail, network, transaction, payer}`).

## Error codes

| HTTP | code | meaning |
|---|---|---|
| 400 | `INVALID_DATE` / `INVALID_TIME` / `INVALID_PARTY` / `INVALID_GUESTS` / `INVALID_NAME` / `INVALID_SKU` / `INVALID_REQUEST` | malformed request |
| 402 | (x402) | payment required — pay and retry |
| 403 | `BAD_CANCEL_TOKEN` / `BAD_TOKEN` / `TOKEN_EXPIRED` | cancel or download token rejected |
| 404 | `NOT_FOUND` / `UNKNOWN_SKU` | unknown id or sku |
| 409 | `OUTSIDE_HOURS` / `NO_TABLE` / `NO_ROOM` / `UNSUPPORTED_COUNTRY` / `ALREADY_CANCELLED` | conflicts with the merchant's rules |
| 500 | `INTERNAL` | unexpected error |
