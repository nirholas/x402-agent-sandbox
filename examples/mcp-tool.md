# Exposing the sandbox as MCP tools for Claude

Point Claude's commerce tools at the sandbox instead of real merchants, and the whole
book-a-table / book-a-room / buy-a-thing flow becomes safe to rehearse for $0.003 a run.

> Ready-made alternative: [x402-mcp-commerce](https://github.com/nirholas/x402-mcp-commerce) is
> a full MCP server for the entire x402 suite, and its config maps tools → upstream base URLs.
> Point those URLs at this sandbox to test the whole toolbox without touching a real merchant.
> This page shows the minimal DIY version.

## Minimal MCP server (stdio)

```ts
// mcp-sandbox.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import { selectPaymentRequirements } from "x402/client";
import { wrapFetchWithPayment } from "x402-fetch";

const BASE_URL = process.env.SANDBOX_URL || "http://localhost:4038";
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

// The sandbox's 402 offers both rails; pin the EVM one for a viem wallet.
const payFetch = wrapFetchWithPayment(fetch, account, undefined, (reqs) =>
  selectPaymentRequirements(reqs, "base-sepolia", "exact"),
);

const post = (path: string, body: unknown) =>
  payFetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const server = new McpServer({ name: "x402-agent-sandbox", version: "0.1.0" });

server.tool(
  "sandbox_town",
  "List the sandbox merchants, their routes and prices, and which real service each mirrors (free).",
  {},
  async () => {
    const res = await fetch(`${BASE_URL}/town`);
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

server.tool(
  "sandbox_book_table",
  "Book a table at the sandbox restaurant ($0.001, x402). Returns the same confirmation schema as x402-tablebook.",
  {
    date: z.string().describe("YYYY-MM-DD"),
    time: z.string().describe("HH:MM, 24h, between 17:00 and 22:00"),
    party: z.number().int().min(1).max(8),
    name: z.string(),
    notes: z.string().optional(),
  },
  async (args) => {
    const res = await post("/restaurant/book", args);
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

server.tool(
  "sandbox_book_room",
  "Book a room at the sandbox hotel ($0.001, x402). Returns the suite lodging confirmation schema.",
  {
    checkIn: z.string().describe("YYYY-MM-DD"),
    checkOut: z.string().describe("YYYY-MM-DD"),
    guests: z.number().int().min(1).max(4).optional(),
    name: z.string(),
    roomType: z.enum(["STANDARD_KING", "STANDARD_TWIN", "DELUXE_KING", "SUITE"]).optional(),
  },
  async (args) => {
    const res = await post("/hotel/book", args);
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

server.tool(
  "sandbox_buy_item",
  "Buy an item from the sandbox store ($0.001, x402). Digital items return a signed download URL; physical items return a signed order confirmation.",
  {
    sku: z.enum(["sandbox-guide", "sandbox-dataset", "sandbox-stickers", "sandbox-mug"]),
    name: z.string().optional(),
    address: z.string().optional(),
    country: z.string().optional().describe("ISO country code — US, CA, GB, DE, JP"),
  },
  async (args) => {
    const res = await post("/store/buy", args);
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

await server.connect(new StdioServerTransport());
```

## Claude Desktop config

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "x402-agent-sandbox": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-sandbox.ts"],
      "env": {
        "SANDBOX_URL": "http://localhost:4038",
        "PRIVATE_KEY": "0x…funded Base Sepolia wallet…"
      }
    }
  }
}
```

Restart Claude Desktop, then ask it to book a table for two next Friday. It will call
`sandbox_book_table`, pay $0.001 in testnet USDC, and read the confirmation straight out of the
response — the exact sequence it would run against a real restaurant.

## Why rehearse here first

Determinism. The sandbox seeds every confirmation from the request body, so a tool call with
the same arguments returns the same `reservationId` and `cancelToken` every time. That makes
agent behaviour reproducible: a failing conversation replays identically, and a test suite that
asserts on ids stays green.

When the flow works, change one env var — point `SANDBOX_URL` at a real deployment (or swap the
route prefixes) — and nothing else in the tool definitions has to move.

Discovery for agents that browse: `GET /town`, `GET /.well-known/x402`, and `GET /skill.md`.
