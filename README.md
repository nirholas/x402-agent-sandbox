# x402-agent-sandbox

> A fake town on testnet — mock restaurant, hotel, and store implementing the suite's exact contracts, for end-to-end agent purchase testing.

![License](https://img.shields.io/badge/license-Apache--2.0-blue) ![x402](https://img.shields.io/badge/payments-x402-0052ff) ![USDC](https://img.shields.io/badge/asset-USDC-2775CA) ![Rails](https://img.shields.io/badge/rails-Base%20%2B%20Solana-9945FF)

**Pay in USDC on Base or Solana — your client picks the rail.**

Three sandbox merchants — **Chez Sandbox**, **The Sandbox Inn**, and **Sandbox Supply Co.** —
speak the x402 suite's response contracts field for field. Rehearse an agent's whole
book-a-table / book-a-room / buy-a-thing flow for **$0.003 a run**, then point the same code at
the real merchants without changing a line of parsing.

The payments are real x402: a genuine 402 challenge, a genuine signed USDC payment, a genuine
facilitator settlement. What is fake is the inventory.

## Why x402 for this

A test double you can't pay is a test double that never exercises the interesting half of your
code. Mocking the 402 handshake means mocking exactly the part most likely to break — payment
selection, signing, retry, receipt parsing. Because x402 payments are per-request and cost a
tenth of a cent on testnet, the sandbox can charge for real and still be free enough to run in
CI. You test the payment path, not a stub of it.

## Quickstart

```bash
git clone https://github.com/nirholas/x402-agent-sandbox
cd x402-agent-sandbox && npm install
npm run dev                                          # the town on :4021, both rails live

# agent side — the whole tour, three paid calls, $0.003 total
# (Base Sepolia USDC faucet: https://faucet.circle.com)
PRIVATE_KEY=0xAgentWallet npm run client
```

### Run the demo

Open **http://localhost:4021/** for the human checkout page: three merchant cards, each wired to
the drop-in payment modal. Connect Phantom to pay on Solana or an EVM wallet to pay on Base —
the same 402 serves both — and the signed confirmation renders straight from the 200 body.

## The town

| Merchant | Routes | Mirrors |
|---|---|---|
| **Chez Sandbox** (restaurant) | `/restaurant/availability`, `/restaurant/book`, `/restaurant/cancel/:id` | [x402-tablebook](https://github.com/nirholas/x402-tablebook) |
| **The Sandbox Inn** (hotel) | `/hotel/search`, `/hotel/book`, `/hotel/cancel/:id` | [x402-hotel-search](https://github.com/nirholas/x402-hotel-search) offers + the suite lodging confirmation |
| **Sandbox Supply Co.** (store) | `/store/catalog`, `/store/buy`, `/store/download/:token` | [x402-storefront](https://github.com/nirholas/x402-storefront) |

## API

| Route | Price | What you get back |
|---|---|---|
| `GET /town` | free | Directory: merchants, routes, prices, what each mirrors. **Start here.** |
| `POST /restaurant/book` | **$0.001** | Signed reservation confirmation — table, refund terms, cancel token, ledger entry, base64 ICS invite. |
| `POST /hotel/book` | **$0.001** | Signed lodging confirmation — room, nightly + total price, refund terms, cancel token, ICS invite. |
| `POST /store/buy` | **$0.001** | Signed artifact — digital download URL + license, or order confirmation + fulfillment record. |
| `GET /restaurant/availability` | free | Open slots. *($0.001 at the real merchant.)* |
| `GET /hotel/search` | free | Room offers. *($0.005 at the real merchant.)* |
| `GET /store/catalog` | free | Items, prices, buy route. |
| `POST /restaurant/cancel/:id` · `POST /hotel/cancel/:id` | free | Cancellation record + refund ledger entry, auth by `cancelToken`. |
| `GET /store/download/:token` | free | Redeems a digital purchase. |
| `POST /verify` | free | Check any signature this sandbox produced. |

Every paid call returns its artifact in the same `201` body — the suite's iron rule, and the
behaviour you are here to test against. Reads are free so exploring the town costs nothing;
remember they are **not** free at the real merchants.

Full reference: [docs/api.md](docs/api.md) · [openapi.json](openapi.json)

## Deterministic by design

Confirmations are seeded by the request body. The same booking request always returns the same
ids, tokens, and assignments — only timestamps move:

```ts
const a = await book({ date: "2026-09-01", time: "19:00", party: 2, name: "Ada Lovelace" });
const b = await book({ date: "2026-09-01", time: "19:00", party: 2, name: "Ada Lovelace" });
a.reservationId === b.reservationId;   // true
a.cancelToken   === b.cancelToken;     // true
a.table.id      === b.table.id;        // true
```

Assert on exact values in your test suite. Replay a failing conversation and it fails
identically. No snapshot files full of random ids.

Every response also carries a `sandbox` block (`{environment: "sandbox", merchant, note}`) so a
rehearsal can never be mistaken for a real booking.

## How x402 works

1. Call a paid route → `402 Payment Required` with an `accepts` array listing **both rails**:
   USDC on Base (EVM, EIP-3009) and USDC on Solana (SPL `transferChecked`).
2. Your client picks whichever entry its wallet supports and signs that payment.
3. Retry with the base64 `X-PAYMENT` header; the matching facilitator verifies and settles on-chain.
4. `201` — artifact in the body, settlement receipt (`{rail, network, transaction, payer}`) in `X-PAYMENT-RESPONSE`.

| rail | network (default) | mainnet | payTo | facilitator |
|---|---|---|---|---|
| EVM | `base-sepolia` | `NETWORK=base` | `PAY_TO_ADDRESS` | `FACILITATOR_URL` (default `https://x402.org/facilitator`) |
| Solana | `solana` | `SOLANA_NETWORK=devnet` for testing | `SOLANA_PAY_TO_ADDRESS` | `SOLANA_FACILITATOR_URL` (default `https://facilitator.payai.network`) |

Both rails ship with the suite's public receive addresses pre-filled in `.env.example`, so
`npm run dev` works with zero configuration. A rail with an invalid address is simply omitted
from `accepts` — the service still runs on the other. A sandbox has no business on mainnet;
keep `NETWORK=base-sepolia`.

## Human checkout

`public/index.html` is a working checkout demo built on
[`@three-ws/x402-payment-modal`](https://www.npmjs.com/package/@three-ws/x402-payment-modal),
loaded from the CDN. Each merchant card is a `data-x402-endpoint` button; the modal reads the
dual-rail 402, drives Phantom or an EVM wallet, and hands the artifact back on `x402:result`.

It also handles **SIWX re-entry** (sign in with your wallet once and a second purchase skips the
prompt) and **client-side spending caps**, which is exactly the pattern a human-in-the-loop
approval flow needs. The modal is a proprietary npm package by the same author — referenced via
CDN and npm only, never vendored, so this repo stays Apache-2.0.

The Solana lane needs two small server endpoints (`POST /api/x402-checkout`) because Phantom
signs serialized transactions rather than typed data; they are mounted from the package's
Express adapter. The EVM lane needs nothing server-side.

## Real backend / API keys

There isn't one, deliberately. The sandbox is self-contained — inventory, catalog, and
availability are fixture data in `src/town.ts`, marked as such — so the demo runs with no keys
and no network beyond the facilitator. Two envs matter:

- `SIGNING_SECRET` — the HMAC key behind every `signature` and every download token. Unset falls
  back to an insecure dev default, which is fine for a sandbox.
- `SOLANA_RPC_URL` — used by the browser checkout endpoints. The public RPC is heavily rate
  limited; pass a dedicated one for anything beyond a demo.

## For AI agents

- `GET /town` — the live directory, the first call any agent should make.
- [`skill.md`](skill.md) — agent-facing capability sheet, served at `GET /skill.md`.
- `GET /.well-known/x402` — machine-readable manifest ([source](public/.well-known/x402)) listing
  both networks, output schemas, and a `mirrors` link per resource, in the format indexed by
  [x402scan.com](https://x402scan.com), the x402 Bazaar, and [agentic.market](https://agentic.market).
- MCP: [`examples/mcp-tool.md`](examples/mcp-tool.md) exposes the town as Claude tools with a
  `claude_desktop_config.json` example. Or point
  [x402-mcp-commerce](https://github.com/nirholas/x402-mcp-commerce) at this sandbox and
  rehearse the entire suite toolbox at once.
- Guide: [docs/agents.md](docs/agents.md).

## Docs

Site: **https://nirholas.github.io/x402-agent-sandbox/** — [tutorial](docs/tutorial.md) · [API](docs/api.md) · [agents](docs/agents.md) · [curl walkthrough](examples/curl.md)

Part of the [x402 Suite](https://github.com/nirholas/x402-suite).

## Support

Questions, bugs, integration help: **nichxbt@gmail.com**

## License

[Apache-2.0](LICENSE)
