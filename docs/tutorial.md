# Tutorial

From a clean clone to a complete agent purchase flow — three merchants, three paid calls, about
a third of a cent.

## 1. Install

```bash
git clone https://github.com/nirholas/x402-agent-sandbox
cd x402-agent-sandbox
npm install
```

Node 18+ required.

## 2. Configure

```bash
cp .env.example .env
```

Every value already has a working default, so you can skip to step 3. The ones worth knowing:

```
PAY_TO_ADDRESS=0x40252CFDF8B20Ed757D61ff157719F33Ec332402        # EVM (Base) receive address
SOLANA_PAY_TO_ADDRESS=WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW  # Solana receive address
NETWORK=base-sepolia                                              # keep a sandbox on testnet
SOLANA_NETWORK=devnet
SIGNING_SECRET=                                                   # HMAC key for signatures
```

Those two `payTo` values are the suite's public receive addresses. Change them to your own
wallets if you want the (fractional) payments.

## 3. Run the town

```bash
npm run dev
```

```
x402-agent-sandbox — the fake town — listening on :4038
  rail evm     base-sepolia   USDC → 0x40252CFDF8B20Ed757D61ff157719F33Ec332402  (facilitator https://x402.org/facilitator)
  rail solana  solana-devnet  USDC → WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW  (facilitator https://facilitator.payai.network)
  paid routes:
    POST /restaurant/book  $0.001
    POST /hotel/book  $0.001
    POST /store/buy  $0.001
```

## 4. Look around — for free

```bash
curl -s http://localhost:4038/town | jq '.merchants[] | {name, mirrors}'
curl -s "http://localhost:4038/restaurant/availability?date=2026-09-01&party=2" | jq '.slots[0]'
curl -s "http://localhost:4038/hotel/search?checkIn=2026-09-01&checkOut=2026-09-03" | jq '.offers[0]'
curl -s http://localhost:4038/store/catalog | jq '.items[].sku'
```

Reads are free here. They cost money at the real merchants — `/availability` is $0.001 at
x402-tablebook and `/search` is $0.005 at x402-hotel-search — so remember to budget for them
when you point your agent at production.

## 5. Your first 402

```bash
curl -i -X POST http://localhost:4038/restaurant/book \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-01","time":"19:00","party":2,"name":"Ada Lovelace"}'
```

You get `402 Payment Required` with an `accepts` array holding **two** entries — USDC on Base
and USDC on Solana — each describing exactly what to pay (amount in atomic units, network,
asset address, `payTo`). That JSON *is* the x402 protocol. Your client picks the rail its
wallet supports; the server settles whichever one comes back in `X-PAYMENT`.

## 6. Pay for it

Fund a throwaway wallet with Base Sepolia USDC (https://faucet.circle.com), then run the whole
tour:

```bash
PRIVATE_KEY=0xAgentWallet BASE_URL=http://localhost:4038 npm run client
```

`examples/agent-client.ts` discovers the town, books a table, books a room, buys a digital item,
redeems the download, cancels the table, and verifies a signature — three paid calls, $0.003.
It uses `x402-fetch` with the selector pinned to the EVM entry, since a viem wallet cannot sign
the Solana one.

Prefer to click? Open **http://localhost:4038/** and use the drop-in payment modal. Connect
Phantom to pay on Solana or an EVM wallet to pay on Base — the same 402 serves both.

## 7. Read the artifact

```json
{
  "reservationId": "res_1a2b3c4d5e6f",
  "status": "confirmed",
  "restaurant": "Chez Sandbox",
  "confirmedTime": "2026-09-01T19:00",
  "party": 2,
  "table": { "id": "T1", "name": "Window 1", "type": "window", "seats": 2 },
  "refundTerms": { "holdPrice": "$0.001", "freeCancellationHours": 2, "description": "…" },
  "cancelToken": "…",
  "cancelEndpoint": "POST /restaurant/cancel/res_1a2b3c4d5e6f",
  "ledgerEntry": { "kind": "hold", "amount": "$0.001", "reason": "…", "at": "…" },
  "ics": "QkVHSU46VkNBTEVOREFS…",
  "sandbox": { "environment": "sandbox", "merchant": "restaurant", "note": "…" },
  "signature": "…"
}
```

That is x402-tablebook's confirmation, field for field, plus one extra `sandbox` block so you
can never mistake a rehearsal for the real thing. Keep `cancelToken` — it is the only way to
cancel, and it is returned exactly once.

The `X-PAYMENT-RESPONSE` header carries the receipt:
`{"success":true,"rail":"evm","network":"base-sepolia","transaction":"0x…","payer":"0x…"}`.

## 8. Prove the determinism

Run the same booking twice:

```bash
PRIVATE_KEY=0xAgentWallet npm run client
PRIVATE_KEY=0xAgentWallet npm run client
```

Same `reservationId`. Same `cancelToken`. Same table. Only `createdAt` moves. That is the
sandbox's whole reason for existing: your assertions can name exact values, a failing run
replays identically, and nobody has to snapshot a random id.

## 9. Cancel and verify

```bash
curl -s -X POST http://localhost:4038/restaurant/cancel/res_1a2b3c4d5e6f \
  -H 'Content-Type: application/json' \
  -d '{"cancelToken":"…","confirmedTime":"2026-09-01T19:00"}' | jq '.refundLedgerEntry'
```

Echo `confirmedTime` back and refundability is judged against the real clock — cancel inside the
2-hour window and you get a `forfeit` entry instead of a `refund`. Omit it and the hold is
treated as refundable, which is the friendlier default for a test target.

Any signed artifact can be checked without the secret:

```bash
curl -s -X POST http://localhost:4038/verify \
  -H 'Content-Type: application/json' \
  -d '{"payload":{…},"signature":"…"}' | jq
```

## 10. Point it at the real thing

The sandbox's job is done the moment your flow works. Move to production by changing the base
URL and dropping the merchant prefix:

| Sandbox | Real |
|---|---|
| `POST {sandbox}/restaurant/book` | `POST {tablebook}/book` |
| `POST {sandbox}/hotel/book` | the merchant's booking route |
| `POST {sandbox}/store/buy` `{sku}` | `GET {storefront}/buy/:sku` |

Request and response shapes do not change. What changes is that the money is real: set
`NETWORK=base` on the client side, point `FACILITATOR_URL` at a mainnet facilitator, and give
the agent a wallet with actual USDC and a spending cap.
