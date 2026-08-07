# Raw x402 flow with curl

The x402 protocol is plain HTTP. Here is the 402 → pay → 200 walkthrough against a locally
running sandbox (`npm run dev` — both rails use the suite defaults, so no configuration).

## 0. Find the town

```bash
curl -s http://localhost:4021/town | jq '.merchants[] | {name, mirrors, routes}'
```

Everything an agent needs to plan a session: the three merchants, their routes, their prices,
and which real suite service each one mirrors.

## 1. Hit a paid route without payment → 402

```bash
curl -i -X POST http://localhost:4021/restaurant/book \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-01","time":"19:00","party":2,"name":"Ada Lovelace"}'
```

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 1,
  "error": "Payment required — pay in USDC on Base or Solana; your client picks the rail.",
  "resource": {
    "url": "http://localhost:4021/restaurant/book",
    "description": "Sandbox restaurant booking — returns the x402-tablebook confirmation schema",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "1000",          // $0.001 in 6-decimal USDC units
      "resource": "http://localhost:4021/restaurant/book",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "1000",
      "amount": "1000",
      "resource": "http://localhost:4021/restaurant/book",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "maxTimeoutSeconds": 60,
      "extra": { "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4", "name": "USDC", "decimals": 6 }
    }
  ]
}
```

Two entries, two rails. Take whichever your wallet can sign — the server settles that one.

Just want to see the rails?

```bash
curl -s -X POST http://localhost:4021/store/buy -H 'content-type: application/json' \
  -d '{"sku":"sandbox-guide"}' | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```

## 2. Pay

The `X-PAYMENT` header is a base64 payment matching **one** entry of `accepts`: an EIP-3009
`transferWithAuthorization` signature on the Base entry, or a signed SPL `transferChecked`
transaction on the Solana entry. Signing either by hand is painful — use any x402 client:

```bash
PRIVATE_KEY=0x… BASE_URL=http://localhost:4021 npx tsx examples/agent-client.ts
```

(`x402-fetch` intercepts the 402, signs the payment with your wallet, and retries. For the
Solana rail, use a Solana x402 client — or open `http://localhost:4021/` and let the payment
modal drive Phantom.)

## 3. Retry with X-PAYMENT → 201

```bash
curl -i -X POST http://localhost:4021/restaurant/book \
  -H 'Content-Type: application/json' \
  -H "X-PAYMENT: $PAYMENT_B64" \
  -d '{"date":"2026-09-01","time":"19:00","party":2,"name":"Ada Lovelace"}'
```

```
HTTP/1.1 201 Created
X-PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJyYWlsIjoiZXZtIiwi…

{
  "reservationId": "res_1a2b3c4d5e6f",
  "status": "confirmed",
  "restaurant": "Chez Sandbox",
  "confirmedTime": "2026-09-01T19:00",
  "party": 2,
  "table": { "id": "T1", "name": "Window 1", "type": "window", "seats": 2 },
  "cancelToken": "…",
  "ics": "QkVHSU46VkNBTEVOREFS…",
  "signature": "…"
}
```

The artifact is in the body. The receipt is in the header — base64 JSON:
`{"success":true,"rail":"evm"|"solana","network":"…","transaction":"…","payer":"…"}`.

Decode it:

```bash
echo "$RECEIPT_B64" | base64 -d | jq
```

## 4. The same request is the same confirmation

Confirmations are seeded by the request body, so replaying step 3 gives you back byte-identical
ids and tokens (only `createdAt` moves). That is what makes the sandbox usable in a test suite:

```bash
# both calls → the same reservationId and cancelToken
```

## 5. Free routes need no payment at all

```bash
curl -s "http://localhost:4021/restaurant/availability?date=2026-09-01&party=2" | jq '.slots[0]'
curl -s "http://localhost:4021/hotel/search?checkIn=2026-09-01&checkOut=2026-09-03&guests=2" | jq '.offers[0]'
curl -s http://localhost:4021/store/catalog | jq '.items'
curl -s http://localhost:4021/health

# cancel a reservation (echo confirmedTime so refundability is judged for real)
curl -s -X POST http://localhost:4021/restaurant/cancel/res_1a2b3c4d5e6f \
  -H 'Content-Type: application/json' \
  -d '{"cancelToken":"…","confirmedTime":"2026-09-01T19:00"}' | jq

# verify any signed artifact
curl -s -X POST http://localhost:4021/verify \
  -H 'Content-Type: application/json' \
  -d '{"payload":{…},"signature":"…"}' | jq
```

## 6. Point the same commands at a real merchant

Swap the base URL and the merchant prefix — the request and response shapes do not change:

```bash
# sandbox
curl -X POST http://localhost:4021/restaurant/book -d '{"date":"…","time":"19:00","party":2,"name":"Ada"}'
# the real thing
curl -X POST https://your-tablebook.example.com/book -d '{"date":"…","time":"19:00","party":2,"name":"Ada"}'
```
