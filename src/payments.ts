/**
 * Dual-rail x402 paywall — USDC on Base (EVM) *and* USDC on Solana (SVM).
 *
 * Every paid route answers an unpaid request with a single 402 that advertises
 * BOTH rails in `accepts`. The client picks whichever one its wallet supports:
 * an EVM agent (x402-fetch + viem) signs the EIP-3009 authorization, a Solana
 * agent (or the @three-ws/x402-payment-modal in a browser, which drives Phantom)
 * signs an SPL transferChecked. Neither rail is privileged.
 *
 * Verification and settlement are delegated to x402 facilitators via
 * `useFacilitator()` from the `x402` package (the same client `x402-express`
 * uses internally) — this server never holds a private key and never pays gas:
 *
 *   EVM    → FACILITATOR_URL        (default https://x402.org/facilitator, base-sepolia)
 *   Solana → SOLANA_FACILITATOR_URL (default https://facilitator.payai.network)
 *
 * The x402.org reference facilitator only settles base-sepolia, so the Solana
 * lane defaults to PayAI's public facilitator (no API key, sponsors the SOL fee).
 *
 * If a rail is unconfigured (no payTo for it) it is simply omitted from
 * `accepts` and logged at boot — the service still runs on the remaining rail.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { findMatchingPaymentRequirements, processPriceToAtomicAmount, safeBase64Decode, safeBase64Encode } from "x402/shared";
import { PaymentPayloadSchema, type Network, type PaymentRequirements } from "x402/types";
import { useFacilitator } from "x402/verify";

/** Suite default receive addresses. Public, safe to commit — override to get paid yourself. */
export const DEFAULT_EVM_PAY_TO = "0x40252CFDF8B20Ed757D61ff157719F33Ec332402";
export const DEFAULT_SOLANA_PAY_TO = "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW";

/**
 * Public facilitator sponsor account that pays the SOL network fee for Solana
 * settlements, so a paying agent needs only USDC and no SOL. Not a secret and
 * not a payout address — point it at your facilitator's sponsor if you self-host.
 */
const SOLANA_FEE_PAYER = process.env.SOLANA_FEE_PAYER || "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4";

const EVM_PAY_TO = process.env.PAY_TO_ADDRESS || DEFAULT_EVM_PAY_TO;
const SOLANA_PAY_TO = process.env.SOLANA_PAY_TO_ADDRESS || DEFAULT_SOLANA_PAY_TO;

/** `base-sepolia` (default) or `base`. */
export const EVM_NETWORK = (process.env.NETWORK || "base-sepolia") as Network;
/** `solana` (mainnet-beta, default) or `solana-devnet`. */
export const SOLANA_NETWORK = (
  (process.env.SOLANA_NETWORK || "mainnet-beta") === "devnet" ? "solana-devnet" : "solana"
) as Network;

const EVM_FACILITATOR = (process.env.FACILITATOR_URL || "https://x402.org/facilitator") as `${string}://${string}`;
const SOLANA_FACILITATOR = (process.env.SOLANA_FACILITATOR_URL ||
  "https://facilitator.payai.network") as `${string}://${string}`;

const evmFacilitator = useFacilitator({ url: EVM_FACILITATOR });
const svmFacilitator = useFacilitator({ url: SOLANA_FACILITATOR });

const EVM_ENABLED = /^0x[0-9a-fA-F]{40}$/.test(EVM_PAY_TO);
const SOLANA_ENABLED = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(SOLANA_PAY_TO);

export type RoutePrices = Record<string, { price: string; description: string }>;

/** Human-readable summary for the startup banner. */
export function railSummary(): string[] {
  const lines: string[] = [];
  lines.push(
    EVM_ENABLED
      ? `  rail evm     ${EVM_NETWORK.padEnd(14)} USDC → ${EVM_PAY_TO}  (facilitator ${EVM_FACILITATOR})`
      : "  rail evm     disabled — PAY_TO_ADDRESS is not a 0x address",
  );
  lines.push(
    SOLANA_ENABLED
      ? `  rail solana  ${SOLANA_NETWORK.padEnd(14)} USDC → ${SOLANA_PAY_TO}  (facilitator ${SOLANA_FACILITATOR})`
      : "  rail solana  disabled — SOLANA_PAY_TO_ADDRESS is not a base58 address",
  );
  if (EVM_PAY_TO === DEFAULT_EVM_PAY_TO || SOLANA_PAY_TO === DEFAULT_SOLANA_PAY_TO) {
    lines.push("  note: using suite default payTo — set PAY_TO_ADDRESS / SOLANA_PAY_TO_ADDRESS to receive funds yourself");
  }
  return lines;
}

/** Build the `accepts` array advertised in a 402 for one resource. */
export function buildAccepts(resource: string, price: string, description: string): PaymentRequirements[] {
  const accepts: PaymentRequirements[] = [];

  if (EVM_ENABLED) {
    const evm = processPriceToAtomicAmount(price, EVM_NETWORK);
    if ("error" in evm) {
      console.warn(`[x402] cannot price ${resource} on ${EVM_NETWORK}: ${evm.error}`);
    } else {
      accepts.push({
        scheme: "exact",
        network: EVM_NETWORK,
        maxAmountRequired: evm.maxAmountRequired,
        resource: resource as `${string}://${string}`,
        description,
        mimeType: "application/json",
        payTo: EVM_PAY_TO,
        maxTimeoutSeconds: 60,
        asset: evm.asset.address,
        extra: "eip712" in evm.asset ? evm.asset.eip712 : undefined,
      });
    }
  }

  if (SOLANA_ENABLED) {
    const svm = processPriceToAtomicAmount(price, SOLANA_NETWORK);
    if ("error" in svm) {
      console.warn(`[x402] cannot price ${resource} on ${SOLANA_NETWORK}: ${svm.error}`);
    } else {
      accepts.push({
        scheme: "exact",
        network: SOLANA_NETWORK,
        maxAmountRequired: svm.maxAmountRequired,
        resource: resource as `${string}://${string}`,
        description,
        mimeType: "application/json",
        payTo: SOLANA_PAY_TO,
        maxTimeoutSeconds: 60,
        asset: svm.asset.address,
        // `amount` + `extra.feePayer` are what the browser checkout modal reads;
        // `maxAmountRequired` is what x402 SDK clients read. Carrying both keeps
        // one entry usable by every client without a second, near-duplicate accept.
        extra: { feePayer: SOLANA_FEE_PAYER, name: "USDC", decimals: svm.asset.decimals },
        ...({ amount: svm.maxAmountRequired } as Record<string, string>),
      } as PaymentRequirements);
    }
  }

  return accepts;
}

/** Absolute URL of the request, used as the x402 `resource` identifier. */
function resourceUrl(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  return `${proto}://${req.get("host")}${req.baseUrl}${req.path}`;
}

function matchRoute(prices: RoutePrices, req: Request): { price: string; description: string } | undefined {
  const path = req.baseUrl + req.path;
  for (const [pattern, cfg] of Object.entries(prices)) {
    const [verb, rawPath] = pattern.split(/\s+/);
    if (verb !== "*" && verb.toUpperCase() !== req.method.toUpperCase()) continue;
    const rx = new RegExp(`^${rawPath.replace(/\*/g, "[^/]+").replace(/\//g, "\\/")}\\/?$`);
    if (rx.test(path)) return cfg;
  }
  return undefined;
}

/**
 * Express middleware. `prices` maps `"<VERB> /path"` (with `*` wildcards for
 * path params) to a price string and a human description.
 */
export function paywall(prices: RoutePrices): RequestHandler {
  if (!EVM_ENABLED && !SOLANA_ENABLED) {
    console.error("[x402] no payment rail is configured — every paid route will return 402 forever");
  }

  return async function paywallMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    const route = matchRoute(prices, req);
    if (!route) {
      next();
      return;
    }

    const resource = resourceUrl(req);
    const accepts = buildAccepts(resource, route.price, route.description);

    const challenge = (error: string) => ({
      x402Version: 1,
      error,
      resource: { url: resource, description: route.description, mimeType: "application/json" },
      accepts,
    });

    const header = req.header("X-PAYMENT");
    if (!header) {
      res.status(402).json(challenge("Payment required — pay in USDC on Base or Solana; your client picks the rail."));
      return;
    }

    // 1. Decode the base64-JSON X-PAYMENT envelope.
    let payload;
    try {
      payload = PaymentPayloadSchema.parse(JSON.parse(safeBase64Decode(header)));
    } catch (e) {
      res.status(402).json(challenge(`Malformed X-PAYMENT header: ${(e as Error).message}`));
      return;
    }

    // 2. Match it back to one of the rails we actually offered.
    const requirement = findMatchingPaymentRequirements(accepts, payload);
    if (!requirement) {
      res.status(402).json(challenge("X-PAYMENT does not match any offered payment requirement"));
      return;
    }

    // 3. Pick the facilitator for that rail and verify + settle.
    const isSolana = String(requirement.network).startsWith("solana");
    const facilitator = isSolana ? svmFacilitator : evmFacilitator;
    try {
      const verification = await facilitator.verify(payload, requirement);
      if (!verification.isValid) {
        res.status(402).json(challenge(`Payment rejected: ${verification.invalidReason ?? "unknown reason"}`));
        return;
      }
      const settlement = await facilitator.settle(payload, requirement);
      if (!settlement.success) {
        res.status(402).json(challenge(`Settlement failed: ${settlement.errorReason ?? "unknown reason"}`));
        return;
      }
      // 4. Receipt goes back with the artifact in the very same response.
      res.setHeader(
        "X-PAYMENT-RESPONSE",
        safeBase64Encode(
          JSON.stringify({
            success: true,
            rail: isSolana ? "solana" : "evm",
            network: settlement.network,
            transaction: settlement.transaction,
            payer: settlement.payer ?? verification.payer ?? null,
          }),
        ),
      );
      res.setHeader("Access-Control-Expose-Headers", "X-PAYMENT-RESPONSE");
      next();
    } catch (e) {
      res.status(402).json(challenge(`Facilitator error: ${(e as Error).message}`));
    }
  };
}
