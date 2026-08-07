/**
 * The fake town: three sandbox merchants whose response schemas mirror the real
 * x402 suite services 1:1.
 *
 *   /restaurant/*  ↔  x402-tablebook
 *   /hotel/*       ↔  the suite's lodging contract (x402-hotel-search offers +
 *                     a tablebook-shaped booking confirmation)
 *   /store/*       ↔  x402-storefront
 *
 * Inventory below is fixture data — the sandbox is deliberately self-contained
 * so the demo runs with no keys and no network. Everything a paid route returns
 * is derived deterministically from the request (see seed.ts) and signed with
 * the same HMAC-SHA256-over-canonical-JSON scheme the real merchants use.
 */

// Fixture data — the sandbox has no upstream; this IS the inventory.
export const RESTAURANT = {
  name: "Chez Sandbox",
  timezone: "America/New_York",
  address: "1 Testnet Row, Sandbox City",
  slotMinutes: 30,
  seatingMinutes: 90,
  bookingWindowDays: 30,
  openHours: { from: "17:00", to: "22:00" },
  refundPolicy: {
    holdPrice: "$0.001",
    freeCancellationHours: 2,
    description: "Sandbox hold — cancel more than 2h before seating for a full refund of the hold.",
  },
  tables: [
    { id: "T1", name: "Window 1", type: "window", seats: 2 },
    { id: "T2", name: "Window 2", type: "window", seats: 4 },
    { id: "T3", name: "Standard 1", type: "standard", seats: 2 },
    { id: "T4", name: "Standard 2", type: "standard", seats: 4 },
    { id: "T5", name: "Round", type: "round", seats: 6 },
    { id: "T6", name: "Patio", type: "patio", seats: 4 },
    { id: "T7", name: "Counter", type: "counter", seats: 1 },
    { id: "T8", name: "Private", type: "private", seats: 8 },
  ],
} as const;

export const HOTEL = {
  name: "The Sandbox Inn",
  hotelId: "HTL_SANDBOX_01",
  timezone: "America/New_York",
  address: "2 Faucet Street, Sandbox City",
  cityCode: "SBX",
  checkInTime: "15:00",
  checkOutTime: "11:00",
  currency: "USD",
  cancellationPolicy: {
    holdPrice: "$0.001",
    freeCancellationHours: 24,
    description: "Sandbox hold — cancel more than 24h before check-in for a full refund of the hold.",
  },
  rooms: [
    { roomType: "STANDARD_KING", description: "Standard king, city view", beds: 1, maxOccupancy: 2, nightlyRate: "129.00" },
    { roomType: "STANDARD_TWIN", description: "Standard twin", beds: 2, maxOccupancy: 2, nightlyRate: "129.00" },
    { roomType: "DELUXE_KING", description: "Deluxe king, park view", beds: 1, maxOccupancy: 3, nightlyRate: "189.00" },
    { roomType: "SUITE", description: "One-bedroom suite with lounge", beds: 2, maxOccupancy: 4, nightlyRate: "329.00" },
  ],
} as const;

export interface StoreItem {
  sku: string;
  name: string;
  type: "digital" | "physical";
  price: string;
  description: string;
  contentType?: string;
  content?: string;
  weightGrams?: number;
}

export const STORE = {
  name: "Sandbox Supply Co.",
  shipsTo: ["US", "CA", "GB", "DE", "JP"],
  supportEmail: "nichxbt@gmail.com",
  items: [
    {
      sku: "sandbox-guide",
      name: "The Sandbox Guide to Agentic Commerce",
      type: "digital",
      price: "$0.001",
      description: "A short markdown guide. Delivered as a signed, time-limited download URL.",
      contentType: "text/markdown",
      content:
        "# The Sandbox Guide to Agentic Commerce\n\n" +
        "You bought this with an HTTP request. No account, no card, no checkout page —\n" +
        "just a 402, a signed USDC payment, and a 200 with the goods in the body.\n\n" +
        "That is the whole idea. Everything else is plumbing.\n",
    },
    {
      sku: "sandbox-dataset",
      name: "Sandbox Fixture Dataset (JSON)",
      type: "digital",
      price: "$0.001",
      description: "A tiny JSON fixture, handy for asserting download + checksum handling.",
      contentType: "application/json",
      content: '{"rows":[{"id":1,"label":"alpha"},{"id":2,"label":"beta"},{"id":3,"label":"gamma"}]}\n',
    },
    {
      sku: "sandbox-stickers",
      name: "Sandbox Sticker Pack",
      type: "physical",
      price: "$0.001",
      description: "A physical good — returns a signed order confirmation + fulfillment record.",
      weightGrams: 20,
    },
    {
      sku: "sandbox-mug",
      name: "402 Payment Required Mug",
      type: "physical",
      price: "$0.001",
      description: "A heavier physical good, for testing shipping fields.",
      weightGrams: 420,
    },
  ] as StoreItem[],
};

export const MERCHANTS = [
  {
    id: "restaurant",
    name: RESTAURANT.name,
    kind: "restaurant",
    mirrors: "x402-tablebook",
    mirrorsUrl: "https://github.com/nirholas/x402-tablebook",
    routes: [
      { route: "GET /restaurant/availability", price: "free", note: "$0.001 at the real merchant" },
      { route: "POST /restaurant/book", price: "$0.001", note: "returns the tablebook confirmation schema" },
      { route: "POST /restaurant/cancel/:id", price: "free", note: "auth by cancelToken" },
    ],
  },
  {
    id: "hotel",
    name: HOTEL.name,
    kind: "hotel",
    mirrors: "x402-hotel-search + suite lodging contract",
    mirrorsUrl: "https://github.com/nirholas/x402-hotel-search",
    routes: [
      { route: "GET /hotel/search", price: "free", note: "$0.005 at the real merchant" },
      { route: "POST /hotel/book", price: "$0.001", note: "returns the lodging confirmation schema" },
      { route: "POST /hotel/cancel/:id", price: "free", note: "auth by cancelToken" },
    ],
  },
  {
    id: "store",
    name: STORE.name,
    kind: "store",
    mirrors: "x402-storefront",
    mirrorsUrl: "https://github.com/nirholas/x402-storefront",
    routes: [
      { route: "GET /store/catalog", price: "free", note: "free at the real merchant too" },
      { route: "POST /store/buy", price: "$0.001", note: "returns the storefront signed-artifact schema" },
      { route: "GET /store/download/:token", price: "free", note: "redeems a digital purchase" },
    ],
  },
] as const;
