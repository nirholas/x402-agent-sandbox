---
name: x402-sandbox-town
description: Run and drive the x402-agent-sandbox test town (restaurant, hotel, store) to test an agent purchase flow end to end at $0.001 per paid call. Use when building or debugging an x402 buying agent against a deterministic target.
---

# x402-agent-sandbox

A test target for agents that buy things over x402. Three merchants implement
the contracts of the real x402 suite services, so code written against the
sandbox ports to the real ones. Every paid route costs $0.001 and returns a
deterministic, HMAC-signed confirmation: the same request body always yields the
same ids and tokens, so you can assert on them. Nothing is reserved or shipped.

## Run the server

It is a self-hosted Node server (Express, Node 18 or newer). Run it from a clone:

```bash
git clone https://github.com/nirholas/x402-agent-sandbox && cd x402-agent-sandbox
npm install
cp .env.example .env     # then adjust; see the comments in the file
npm run dev              # tsx src/server.ts, listens on PORT (default 4038)
```

`npm run build` then `npm start` runs the compiled server. `npm run client`
runs `examples/agent-client.ts`, a reference paying client. Set `PAY_TO_ADDRESS`
and `SOLANA_PAY_TO_ADDRESS` to your own wallets to be paid yourself.

Also set `SIGNING_SECRET` for stable signatures and `DOWNLOAD_TTL_SECONDS`
(default 3600) for store download links.

## Start here

`GET /town` (free) lists every merchant, route, price and what it mirrors.

## Routes

| Route | Price | Purpose |
| --- | --- | --- |
| `POST /restaurant/book` | $0.001 | body `date`, `time` (HH:MM, 17:00 to 22:00), `party` 1 to 8, `name`, optional `notes` |
| `POST /hotel/book` | $0.001 | body `checkIn`, `checkOut`, `guests` 1 to 4, `name`, optional `roomType` |
| `POST /store/buy` | $0.001 | body `sku` (`sandbox-guide`, `sandbox-dataset`, `sandbox-stickers`, `sandbox-mug`), plus `name`, `address`, `country` for physical items |
| `GET /restaurant/availability` | free | open slots |
| `GET /hotel/search` | free | room offers |
| `GET /store/catalog` | free | items and prices |
| `POST /restaurant/cancel/:id`, `POST /hotel/cancel/:id` | free | body `cancelToken` |
| `GET /store/download/:token` | free | redeems a digital purchase |
| `POST /verify` | free | body `{ payload, signature }`, returns `{ valid }` |
| `GET /health`, `GET /skill.md`, `GET /.well-known/x402` | free | |

Keep the `cancelToken` from a booking response. Digital store orders return a
`downloadUrl`; fetch it before `downloadExpiresAt` and check `contentSha256`.

## Example

```bash
curl -s http://localhost:4038/town
curl -s -X POST http://localhost:4038/restaurant/book -H 'content-type: application/json' \
  -d '{"date":"2026-09-01","time":"19:00","party":2,"name":"Ada Lovelace"}'   # 402 challenge first
```

## Paying (x402)

Paid routes follow the x402 protocol. An unpaid call returns HTTP 402 with an
`accepts` array listing USDC on Base and USDC on Solana. Sign for one rail,
retry with the base64 payload in the `X-PAYMENT` header, and the 200 body
carries the result; the settlement receipt is in the `X-PAYMENT-RESPONSE`
header. Clients: `x402-fetch` (EVM), `@three-ws/x402-payment-modal` (browser,
both rails), or any x402 client. The rail networks are chosen by `NETWORK`
(EVM, `base-sepolia` by default) and `SOLANA_NETWORK` in `.env`; see
`.env.example`. Settlement moves real USDC on the chosen network: show the user
the recipient, amount and network and get an explicit yes before every paid call.
