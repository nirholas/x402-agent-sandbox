/**
 * HMAC-SHA256 signing over canonical JSON.
 *
 * Every artifact this store returns (order confirmations, download tokens,
 * fulfillment records) is signed so buyers and third parties can verify it
 * offline with the shared SIGNING_SECRET, or via GET /verify.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_DEV_SECRET = "x402-agent-sandbox-dev-secret-change-me";

export function signingSecret(): string {
  return process.env.SIGNING_SECRET ?? DEFAULT_DEV_SECRET;
}

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}

export function sign(payload: unknown): string {
  return createHmac("sha256", signingSecret()).update(canonicalize(payload)).digest("hex");
}

export interface SignedArtifact<T> {
  payload: T;
  signature: string;
  algorithm: "HMAC-SHA256";
  canonicalization: "sorted-keys-json";
}

export function signArtifact<T>(payload: T): SignedArtifact<T> {
  return {
    payload,
    signature: sign(payload),
    algorithm: "HMAC-SHA256",
    canonicalization: "sorted-keys-json",
  };
}

export function verify(payload: unknown, signature: string): boolean {
  const expected = sign(payload);
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

/** Compact, URL-safe signed token: base64url(json) + "." + hmac. */
export function encodeToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function decodeToken(token: string): Record<string, unknown> | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  if (mac.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}
