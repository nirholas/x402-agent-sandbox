import "dotenv/config";
import express from "express";
import { join } from "node:path";
import { paywall, railSummary, type RoutePrices } from "./payments.js";
import {
  SandboxError,
  hotelBook,
  hotelCancel,
  hotelSearch,
  restaurantAvailability,
  restaurantBook,
  restaurantCancel,
  storeBuy,
  storeCatalog,
  storeDownload,
  verifyArtifact,
} from "./service.js";
import { MERCHANTS } from "./town.js";
// @ts-expect-error — the package ships no types for the express adapter subpath.
import { x402CheckoutRouter } from "@three-ws/x402-payment-modal/server/express";

// Paid routes — one per merchant, all $0.001, all returning a signed
// confirmation in the same response. Reads are free here (they cost money at
// the real merchants) so exploring the town is cheap.
const PRICES: RoutePrices = {
  "POST /restaurant/book": {
    price: "$0.001",
    description: "Sandbox restaurant booking — returns the x402-tablebook confirmation schema",
  },
  "POST /hotel/book": {
    price: "$0.001",
    description: "Sandbox hotel booking — returns the suite lodging confirmation schema",
  },
  "POST /store/buy": {
    price: "$0.001",
    description: "Sandbox store purchase — returns the x402-storefront signed artifact schema",
  },
};

const app = express();
app.use(express.json({ limit: "256kb" }));

// The browser checkout modal is served from the demo page on the same origin,
// but keep CORS permissive so the sandbox is usable from anywhere.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-payment, x-cancel-token");
  res.setHeader("Access-Control-Expose-Headers", "x-payment-response");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// Browser Solana checkout. Phantom only signs serialized transactions, so the
// payment modal on the demo page POSTs here to have the SPL transferChecked
// built (`prepare`) and the signed tx wrapped into the X-PAYMENT envelope
// (`encode`). The EVM rail needs nothing server-side — the wallet signs
// EIP-3009 typed data entirely in the browser.
app.all("/api/x402-checkout", x402CheckoutRouter({ rpcUrl: process.env.SOLANA_RPC_URL }));

// Dual-rail x402: every paid route offers USDC on Base *and* USDC on Solana.
app.use(paywall(PRICES));

app.use(express.static(join(process.cwd(), "public"), { dotfiles: "allow", index: false }));

// ---------------------------------------------------------------- free routes

// GET /town — the directory. Start here.
app.get("/town", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({
    town: "x402 Agent Sandbox",
    description:
      "A fake town on testnet. Three merchants implement the x402 suite's exact response contracts so agent code written here ports 1:1 to the real services.",
    baseUrl: base,
    payment: {
      protocol: "x402",
      note: "Pay in USDC on Base or Solana — your client picks the rail.",
      rails: ["base-sepolia | base", "solana | solana-devnet"],
      manifest: `${base}/.well-known/x402`,
    },
    determinism:
      "Confirmations are seeded by the request body: the same booking request always returns the same ids, tokens, and assignments.",
    merchants: MERCHANTS.map((m) => ({
      ...m,
      routes: m.routes.map((r) => ({ ...r, url: `${base}/${r.route.split(" ")[1].replace(/^\//, "")}` })),
    })),
    demo: `${base}/`,
    skill: `${base}/skill.md`,
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "x402-agent-sandbox", rails: ["base", "solana"] });
});

app.get("/skill.md", (_req, res) => {
  res.type("text/markdown").sendFile(join(process.cwd(), "skill.md"));
});

// Free reads — priced at the real merchants, free here so exploring is cheap.
app.get("/restaurant/availability", (req, res) => {
  try {
    res.json(restaurantAvailability(req.query as Record<string, string>));
  } catch (e) {
    handleError(res, e);
  }
});

app.get("/hotel/search", (req, res) => {
  try {
    res.json(hotelSearch(req.query as Record<string, string>));
  } catch (e) {
    handleError(res, e);
  }
});

app.get("/store/catalog", (_req, res) => {
  res.json(storeCatalog());
});

// Free cancellations — auth by the cancelToken from the paid confirmation.
app.post("/restaurant/cancel/:id", (req, res) => {
  try {
    res.json(
      restaurantCancel(
        req.params.id,
        req.body?.cancelToken || req.header("X-Cancel-Token") || undefined,
        req.body?.confirmedTime,
      ),
    );
  } catch (e) {
    handleError(res, e);
  }
});

app.post("/hotel/cancel/:id", (req, res) => {
  try {
    res.json(
      hotelCancel(req.params.id, req.body?.cancelToken || req.header("X-Cancel-Token") || undefined, req.body?.checkIn),
    );
  } catch (e) {
    handleError(res, e);
  }
});

// Free — redeem a digital purchase's signed download token.
app.get("/store/download/:token", (req, res) => {
  try {
    const { item, body } = storeDownload(req.params.token);
    res.type(item.contentType || "application/octet-stream").send(body);
  } catch (e) {
    handleError(res, e);
  }
});

// Free — verify any signed artifact this sandbox produced.
app.post("/verify", (req, res) => {
  const { payload, signature } = req.body || {};
  if (payload === undefined || typeof signature !== "string") {
    res.status(400).json({ error: "INVALID_REQUEST", message: "send { payload, signature }" });
    return;
  }
  res.json(verifyArtifact(payload, signature));
});

// ---------------------------------------------------------------- paid routes

// POST /restaurant/book ($0.001) — tablebook-shaped confirmation.
app.post("/restaurant/book", (req, res) => {
  try {
    res.status(201).json(restaurantBook(req.body || {}));
  } catch (e) {
    handleError(res, e);
  }
});

// POST /hotel/book ($0.001) — lodging confirmation.
app.post("/hotel/book", (req, res) => {
  try {
    res.status(201).json(hotelBook(req.body || {}));
  } catch (e) {
    handleError(res, e);
  }
});

// POST /store/buy ($0.001) — storefront-shaped signed artifact.
app.post("/store/buy", (req, res) => {
  try {
    res.status(201).json(storeBuy(req.body || {}));
  } catch (e) {
    handleError(res, e);
  }
});

// The human checkout demo page.
app.get("/", (_req, res) => {
  res.sendFile(join(process.cwd(), "public", "index.html"));
});

// -------------------------------------------------------------------- helpers

function handleError(res: express.Response, e: unknown): void {
  if (e instanceof SandboxError) {
    res.status(e.status).json({ error: e.code, message: e.message });
    return;
  }
  console.error(e);
  res.status(500).json({ error: "INTERNAL", message: "unexpected error" });
}

const port = Number(process.env.PORT || 4021);
app.listen(port, () => {
  console.log(`x402-agent-sandbox — the fake town — listening on :${port}`);
  for (const line of railSummary()) console.log(line);
  console.log("  paid routes:");
  for (const [route, cfg] of Object.entries(PRICES)) console.log(`    ${route}  ${cfg.price}`);
  console.log("  free routes: GET /town, /health, /restaurant/availability, /hotel/search, /store/catalog,");
  console.log("               /store/download/:token, POST /restaurant/cancel/:id, /hotel/cancel/:id, /verify");
  console.log(`  demo page:  http://localhost:${port}/`);
  console.log("  discovery:  GET /.well-known/x402, /skill.md");
});
