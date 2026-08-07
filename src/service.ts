/**
 * Sandbox merchant logic.
 *
 * Every paid route returns its artifact in the same response, in the exact
 * schema of the real suite merchant it mirrors, so client code ports 1:1:
 *
 *   POST /restaurant/book  →  x402-tablebook  POST /book
 *   POST /hotel/book       →  suite lodging confirmation
 *   POST /store/buy        →  x402-storefront GET /buy/:sku
 *
 * Confirmations are deterministic: the same request body always yields the same
 * ids, tokens, and assignments (see seed.ts). Cancellations and download
 * redemptions need state, so those live in an in-memory map — restart clears it,
 * but re-booking the same body regenerates the identical confirmation.
 */
import { createHash } from "node:crypto";
import { buildIcsBase64 } from "./ics.js";
import { seedFrom } from "./seed.js";
import { canonicalize, decodeToken, encodeToken, sign, signArtifact, type SignedArtifact } from "./sign.js";
import { HOTEL, RESTAURANT, STORE, type StoreItem } from "./town.js";

export class SandboxError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// --------------------------------------------------------------- tiny state
// Only what genuinely needs memory: whether something has been cancelled.
const cancelled = new Map<string, { at: string; refunded: boolean }>();

// --------------------------------------------------------------- validation

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function reqStr(v: unknown, code: string, what: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new SandboxError(400, code, `${what} is required`);
  return s;
}

function reqDate(v: unknown, code: string, what: string): string {
  const s = reqStr(v, code, what);
  if (!DATE_RX.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    throw new SandboxError(400, code, `${what} must be YYYY-MM-DD`);
  }
  return s;
}

function reqInt(v: unknown, code: string, what: string, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new SandboxError(400, code, `${what} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function slotDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00Z`);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function money(perNight: string, nights: number): string {
  return (Number(perNight) * nights).toFixed(2);
}

// ============================================================== RESTAURANT
// Mirrors x402-tablebook exactly.

/** Free here; $0.001 at the real merchant. Same response shape. */
export function restaurantAvailability(q: { date?: string; party?: string; days?: string }) {
  const party = q.party ? reqInt(Number(q.party), "INVALID_PARTY", "party", 1, 8) : undefined;
  const days = Math.min(Number(q.days) || 7, RESTAURANT.bookingWindowDays);
  const start = q.date ? reqDate(q.date, "INVALID_DATE", "date") : new Date().toISOString().slice(0, 10);
  const dayCount = q.date ? 1 : days;

  const [openH] = RESTAURANT.openHours.from.split(":").map(Number);
  const [closeH] = RESTAURANT.openHours.to.split(":").map(Number);
  const slots: Array<{
    date: string;
    time: string;
    partySizes: number[];
    tableTypes: string[];
    openTables: number;
  }> = [];

  for (let d = 0; d < dayCount; d++) {
    const date = new Date(Date.parse(`${start}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    for (let h = openH; h < closeH; h++) {
      for (const m of [0, 30]) {
        const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        // Deterministic "occupancy": the same date+time is always equally busy.
        const s = seedFrom("availability", { date, time });
        const free = RESTAURANT.tables.filter((t) => s.int(10, t.id.length) > 1 && (!party || t.seats >= party));
        if (!free.length) continue;
        slots.push({
          date,
          time,
          partySizes: [...new Set(free.flatMap((t) => Array.from({ length: t.seats }, (_, i) => i + 1)))].sort(
            (a, b) => a - b,
          ),
          tableTypes: [...new Set(free.map((t) => t.type))],
          openTables: free.length,
        });
      }
    }
  }

  return {
    restaurant: { name: RESTAURANT.name, timezone: RESTAURANT.timezone, address: RESTAURANT.address },
    slotMinutes: RESTAURANT.slotMinutes,
    seatingMinutes: RESTAURANT.seatingMinutes,
    refundPolicy: RESTAURANT.refundPolicy,
    generatedAt: new Date().toISOString(),
    slots,
  };
}

/** PAID $0.001 — mirrors x402-tablebook POST /book field for field. */
export function restaurantBook(body: Record<string, unknown>) {
  const date = reqDate(body.date, "INVALID_DATE", "date");
  const time = reqStr(body.time, "INVALID_TIME", "time");
  if (!TIME_RX.test(time)) throw new SandboxError(400, "INVALID_TIME", "time must be HH:MM (24h)");
  const party = reqInt(body.party, "INVALID_PARTY", "party", 1, 8);
  const name = reqStr(body.name, "INVALID_NAME", "name");
  const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;

  const [openH] = RESTAURANT.openHours.from.split(":").map(Number);
  const [closeH] = RESTAURANT.openHours.to.split(":").map(Number);
  const hour = Number(time.slice(0, 2));
  if (hour < openH || hour >= closeH) {
    throw new SandboxError(409, "OUTSIDE_HOURS", `${RESTAURANT.name} seats ${RESTAURANT.openHours.from}–${RESTAURANT.openHours.to}`);
  }

  const seed = seedFrom("restaurant/book", { date, time, party, name, notes });
  const candidates = RESTAURANT.tables.filter((t) => t.seats >= party);
  if (!candidates.length) throw new SandboxError(409, "NO_TABLE", `no table seats a party of ${party}`);
  const table = seed.pick(candidates);

  const reservationId = `res_${seed.hex(12)}`;
  const cancelToken = seed.hex(64, 12);
  const createdAt = new Date().toISOString();

  const ics = buildIcsBase64({
    uid: `${reservationId}@x402-agent-sandbox`,
    start: slotDate(date, time),
    durationMinutes: RESTAURANT.seatingMinutes,
    summary: `${RESTAURANT.name} — table for ${party} (${name})`,
    description: `Reservation ${reservationId} at ${RESTAURANT.name}. ${RESTAURANT.refundPolicy.description}`,
    location: RESTAURANT.address,
  });

  const confirmation = {
    reservationId,
    status: "confirmed" as const,
    restaurant: RESTAURANT.name,
    confirmedTime: `${date}T${time}`,
    party,
    name,
    table: { id: table.id, name: table.name, type: table.type, seats: table.seats },
    refundTerms: RESTAURANT.refundPolicy,
    cancelToken,
    cancelEndpoint: `POST /restaurant/cancel/${reservationId}`,
    ledgerEntry: {
      kind: "hold" as const,
      amount: RESTAURANT.refundPolicy.holdPrice,
      reason: "refundable reservation hold paid via x402",
      at: createdAt,
    },
    ics,
    createdAt,
    sandbox: sandboxNote("restaurant"),
  };
  return { ...confirmation, signature: sign(confirmation) };
}

/** Free — mirrors x402-tablebook POST /cancel/:id. */
export function restaurantCancel(reservationId: string, cancelToken: string | undefined, confirmedTime?: string) {
  if (!reservationId.startsWith("res_")) throw new SandboxError(404, "NOT_FOUND", `no reservation ${reservationId}`);
  if (!cancelToken) throw new SandboxError(403, "BAD_CANCEL_TOKEN", "cancelToken is required");
  const prior = cancelled.get(reservationId);
  if (prior) throw new SandboxError(409, "ALREADY_CANCELLED", "reservation is already cancelled");

  // The sandbox is stateless about bookings, so refundability is judged from the
  // seating time the caller echoes back (from their confirmation). Omit it and
  // the hold is treated as refundable — the friendly default for a test target.
  const hoursOut = confirmedTime ? (Date.parse(`${confirmedTime}:00Z`) - Date.now()) / 3_600_000 : Infinity;
  const refunded = hoursOut >= RESTAURANT.refundPolicy.freeCancellationHours;
  const at = new Date().toISOString();
  cancelled.set(reservationId, { at, refunded });

  const hold = {
    kind: "hold" as const,
    amount: RESTAURANT.refundPolicy.holdPrice,
    reason: "refundable reservation hold paid via x402",
    at,
  };
  const entry = {
    kind: refunded ? ("refund" as const) : ("forfeit" as const),
    amount: RESTAURANT.refundPolicy.holdPrice,
    reason: refunded
      ? `cancelled ${hoursOut === Infinity ? "outside" : `${hoursOut.toFixed(1)}h before`} the free-cancellation window — hold refunded`
      : `cancelled inside the ${RESTAURANT.refundPolicy.freeCancellationHours}h window — hold forfeited`,
    at,
  };
  const record = {
    reservationId,
    status: "cancelled" as const,
    refunded,
    refundLedgerEntry: entry,
    ledger: [hold, entry],
    sandbox: sandboxNote("restaurant"),
  };
  return { ...record, signature: sign(record) };
}

// =================================================================== HOTEL
// Offer shape mirrors x402-hotel-search; the confirmation is the suite's
// lodging sibling of the tablebook reservation.

/** Free here; $0.005 at the real merchant. */
export function hotelSearch(q: { checkIn?: string; checkOut?: string; guests?: string }) {
  const checkIn = q.checkIn ? reqDate(q.checkIn, "INVALID_DATE", "checkIn") : new Date().toISOString().slice(0, 10);
  const checkOut = q.checkOut
    ? reqDate(q.checkOut, "INVALID_DATE", "checkOut")
    : new Date(Date.parse(`${checkIn}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const nights = daysBetween(checkIn, checkOut);
  if (nights < 1) throw new SandboxError(400, "INVALID_DATE", "checkOut must be after checkIn");
  const guests = q.guests ? reqInt(Number(q.guests), "INVALID_GUESTS", "guests", 1, 4) : 2;

  const offers = HOTEL.rooms
    .filter((r) => r.maxOccupancy >= guests)
    .map((r) => {
      const seed = seedFrom("hotel/offer", { checkIn, checkOut, guests, roomType: r.roomType });
      return {
        offerId: `off_${seed.hex(12)}`,
        roomType: r.roomType,
        description: r.description,
        beds: r.beds,
        maxOccupancy: r.maxOccupancy,
        available: seed.int(10) > 0,
        price: { nightly: r.nightlyRate, total: money(r.nightlyRate, nights), currency: HOTEL.currency, nights },
        cancellationPolicy: HOTEL.cancellationPolicy,
      };
    });

  return {
    hotel: {
      hotelId: HOTEL.hotelId,
      name: HOTEL.name,
      cityCode: HOTEL.cityCode,
      address: HOTEL.address,
      timezone: HOTEL.timezone,
      checkInTime: HOTEL.checkInTime,
      checkOutTime: HOTEL.checkOutTime,
    },
    stay: { checkIn, checkOut, nights, guests },
    currency: HOTEL.currency,
    generatedAt: new Date().toISOString(),
    offers,
  };
}

/** PAID $0.001 — lodging confirmation, tablebook-shaped. */
export function hotelBook(body: Record<string, unknown>) {
  const checkIn = reqDate(body.checkIn, "INVALID_DATE", "checkIn");
  const checkOut = reqDate(body.checkOut, "INVALID_DATE", "checkOut");
  const nights = daysBetween(checkIn, checkOut);
  if (nights < 1) throw new SandboxError(400, "INVALID_DATE", "checkOut must be after checkIn");
  const guests = reqInt(body.guests ?? 2, "INVALID_GUESTS", "guests", 1, 4);
  const name = reqStr(body.name, "INVALID_NAME", "name");
  const requestedType = typeof body.roomType === "string" ? body.roomType.trim().toUpperCase() : undefined;

  const candidates = HOTEL.rooms.filter(
    (r) => r.maxOccupancy >= guests && (!requestedType || r.roomType === requestedType),
  );
  if (!candidates.length) {
    throw new SandboxError(409, "NO_ROOM", `no room matches roomType=${requestedType ?? "any"} for ${guests} guest(s)`);
  }

  const seed = seedFrom("hotel/book", { checkIn, checkOut, guests, name, roomType: requestedType });
  const room = seed.pick(candidates);
  const bookingId = `htl_${seed.hex(12)}`;
  const cancelToken = seed.hex(64, 12);
  const createdAt = new Date().toISOString();

  const ics = buildIcsBase64({
    uid: `${bookingId}@x402-agent-sandbox`,
    start: new Date(`${checkIn}T${HOTEL.checkInTime}:00Z`),
    durationMinutes: nights * 24 * 60,
    summary: `${HOTEL.name} — ${room.roomType} for ${guests} (${name})`,
    description: `Booking ${bookingId} at ${HOTEL.name}. ${HOTEL.cancellationPolicy.description}`,
    location: HOTEL.address,
  });

  const confirmation = {
    bookingId,
    status: "confirmed" as const,
    hotel: HOTEL.name,
    hotelId: HOTEL.hotelId,
    stay: { checkIn, checkOut, nights, checkInTime: HOTEL.checkInTime, checkOutTime: HOTEL.checkOutTime },
    guests,
    name,
    room: {
      roomType: room.roomType,
      description: room.description,
      beds: room.beds,
      maxOccupancy: room.maxOccupancy,
    },
    price: { nightly: room.nightlyRate, total: money(room.nightlyRate, nights), currency: HOTEL.currency, nights },
    refundTerms: HOTEL.cancellationPolicy,
    cancelToken,
    cancelEndpoint: `POST /hotel/cancel/${bookingId}`,
    ledgerEntry: {
      kind: "hold" as const,
      amount: HOTEL.cancellationPolicy.holdPrice,
      reason: "refundable room hold paid via x402",
      at: createdAt,
    },
    ics,
    createdAt,
    sandbox: sandboxNote("hotel"),
  };
  return { ...confirmation, signature: sign(confirmation) };
}

/** Free — same shape as the restaurant cancellation record. */
export function hotelCancel(bookingId: string, cancelToken: string | undefined, checkIn?: string) {
  if (!bookingId.startsWith("htl_")) throw new SandboxError(404, "NOT_FOUND", `no booking ${bookingId}`);
  if (!cancelToken) throw new SandboxError(403, "BAD_CANCEL_TOKEN", "cancelToken is required");
  if (cancelled.get(bookingId)) throw new SandboxError(409, "ALREADY_CANCELLED", "booking is already cancelled");

  const hoursOut = checkIn ? (Date.parse(`${checkIn}T${HOTEL.checkInTime}:00Z`) - Date.now()) / 3_600_000 : Infinity;
  const refunded = hoursOut >= HOTEL.cancellationPolicy.freeCancellationHours;
  const at = new Date().toISOString();
  cancelled.set(bookingId, { at, refunded });

  const hold = {
    kind: "hold" as const,
    amount: HOTEL.cancellationPolicy.holdPrice,
    reason: "refundable room hold paid via x402",
    at,
  };
  const entry = {
    kind: refunded ? ("refund" as const) : ("forfeit" as const),
    amount: HOTEL.cancellationPolicy.holdPrice,
    reason: refunded
      ? "cancelled outside the free-cancellation window — hold refunded"
      : `cancelled inside the ${HOTEL.cancellationPolicy.freeCancellationHours}h window — hold forfeited`,
    at,
  };
  const record = {
    bookingId,
    status: "cancelled" as const,
    refunded,
    refundLedgerEntry: entry,
    ledger: [hold, entry],
    sandbox: sandboxNote("hotel"),
  };
  return { ...record, signature: sign(record) };
}

// =================================================================== STORE
// Mirrors x402-storefront exactly: `{ payload, signature, algorithm,
// canonicalization }` with a digital or physical payload.

const DOWNLOAD_TTL_SECONDS = Number(process.env.DOWNLOAD_TTL_SECONDS || 3600);

export function storeCatalog() {
  return {
    store: { name: STORE.name, shipsTo: STORE.shipsTo, supportEmail: STORE.supportEmail },
    items: STORE.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      type: i.type,
      price: i.price,
      description: i.description,
      buy: "POST /store/buy",
    })),
    sandbox: sandboxNote("store"),
  };
}

function findItem(sku: string): StoreItem {
  const item = STORE.items.find((i) => i.sku === sku);
  if (!item) throw new SandboxError(404, "UNKNOWN_SKU", `no item with sku ${sku}`);
  return item;
}

/** PAID $0.001 — mirrors x402-storefront GET /buy/:sku. */
export function storeBuy(body: Record<string, unknown>): SignedArtifact<Record<string, unknown>> {
  const sku = reqStr(body.sku, "INVALID_SKU", "sku");
  const item = findItem(sku);
  const seed = seedFrom("store/buy", { sku, name: body.name, address: body.address, country: body.country });
  const orderId = `ord_${seed.hex(12)}`;
  const purchasedAt = new Date().toISOString();

  if (item.type === "digital") {
    const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString();
    const token = encodeToken({ sku, orderId, exp: Math.floor(Date.parse(expiresAt) / 1000) });
    return signArtifact({
      orderId,
      sku,
      kind: "digital",
      downloadUrl: `/store/download/${token}`,
      downloadExpiresAt: expiresAt,
      contentType: item.contentType,
      contentSha256: contentHash(item),
      license: "single-purchaser, non-transferable, unlimited personal/agent use",
      purchasedAt,
      sandbox: sandboxNote("store"),
    });
  }

  const shipTo = {
    name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Sandbox Tester",
    address: typeof body.address === "string" && body.address.trim() ? body.address.trim() : "1 Testnet Row",
    country: typeof body.country === "string" && body.country.trim() ? body.country.trim().toUpperCase() : "US",
  };
  if (!STORE.shipsTo.includes(shipTo.country)) {
    throw new SandboxError(409, "UNSUPPORTED_COUNTRY", `${STORE.name} ships to ${STORE.shipsTo.join(", ")}`);
  }
  return signArtifact({
    orderId,
    sku,
    kind: "physical",
    fulfillment: {
      status: "accepted",
      promise: "ships within 5 business days (sandbox — nothing actually ships)",
      shipTo,
      weightGrams: item.weightGrams,
    },
    supportEmail: STORE.supportEmail,
    purchasedAt,
    sandbox: sandboxNote("store"),
  });
}

/** Free — redeems a signed download token from a digital purchase. */
export function storeDownload(token: string): { item: StoreItem; body: string } {
  const claims = decodeToken(token);
  if (!claims) throw new SandboxError(403, "BAD_TOKEN", "download token is missing, malformed, or tampered with");
  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) {
    throw new SandboxError(403, "TOKEN_EXPIRED", "download token has expired — buy again to get a fresh one");
  }
  const item = findItem(String(claims.sku));
  return { item, body: item.content ?? "" };
}

function contentHash(item: StoreItem): string {
  return createHash("sha256").update(item.content ?? "").digest("hex");
}

/** Verify any signed artifact this sandbox produced. */
export function verifyArtifact(payload: unknown, signature: string): { valid: boolean; canonical: string } {
  return { valid: sign(payload) === signature, canonical: canonicalize(payload) };
}

function sandboxNote(merchant: string): { environment: "sandbox"; merchant: string; note: string } {
  return {
    environment: "sandbox",
    merchant,
    note: "Fake town on testnet — this confirmation is real x402 output but nothing is reserved, shipped, or charged beyond the micropayment.",
  };
}
