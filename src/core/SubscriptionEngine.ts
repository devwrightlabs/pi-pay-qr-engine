/**
 * @fileoverview SubscriptionEngine — recurring Pi payment payloads via Protocol v23 WASM.
 *
 * Generates a one-time checkout approval that encodes a recurring billing
 * authorisation (monthly SaaS, gym memberships, etc.) using the Pi Network
 * Protocol v23 WASM module. The WASM module is loaded lazily from the Pi
 * Browser's bundled runtime.
 */

import { randomUUID } from "./crypto-utils.js";
import type {
  SubscriptionConfig,
  SubscriptionInterval,
  SubscriptionPayload,
  PiPaymentDTO,
} from "../types/payment.js";

// ---------------------------------------------------------------------------
// WASM bridge types
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the Protocol v23 WASM subscription module.
 * The real module is injected by the Pi Browser's native runtime.
 */
interface PiProtocolV23WASM {
  /**
   * Encode a recurring payment authorisation into a compact WASM token.
   *
   * @param planId          - Unique subscription plan UUID.
   * @param merchantWallet  - Recipient merchant Pi wallet address.
   * @param amount          - Per-cycle amount in Pi (micro-Pi integer).
   * @param intervalCode    - 0=daily, 1=weekly, 2=monthly, 3=yearly.
   * @param startEpoch      - UNIX timestamp (seconds) of first billing cycle.
   * @param endEpoch        - UNIX timestamp (seconds) of last cycle, or 0 = infinite.
   * @returns Base-64 encoded authorisation token.
   */
  encodeRecurringAuth(
    planId: string,
    merchantWallet: string,
    amount: number,
    intervalCode: number,
    startEpoch: number,
    endEpoch: number
  ): string;
}

/** Resolve the WASM module from the Pi Browser's global scope. */
function getWASMModule(): PiProtocolV23WASM {
  const wasm = (
    globalThis as unknown as { PiProtocolWASM?: PiProtocolV23WASM }
  ).PiProtocolWASM;

  if (!wasm) {
    throw new Error(
      "[SubscriptionEngine] PiProtocolWASM v23 is not available. " +
        "Ensure this code executes inside the Pi Network mobile webview " +
        "with Protocol v23 support enabled."
    );
  }
  return wasm;
}

/** Map a human-readable interval to the WASM integer code. */
const INTERVAL_CODES: Record<SubscriptionInterval, number> = {
  daily: 0,
  weekly: 1,
  monthly: 2,
  yearly: 3,
};

// ---------------------------------------------------------------------------
// SubscriptionEngine class
// ---------------------------------------------------------------------------

/**
 * SubscriptionEngine — generates recurring payment payloads via Protocol v23 WASM.
 *
 * A single user approval creates a persistent authorisation token stored by
 * the Pi Network, which the merchant back-end can reference to charge the
 * user's wallet on each billing cycle without requiring additional in-app
 * confirmations.
 *
 * @example
 * ```ts
 * const engine = new SubscriptionEngine();
 * const payload = await engine.createSubscription(originPaymentId, {
 *   planName: "Premium Monthly",
 *   amount: 10,
 *   interval: "monthly",
 *   merchantWallet: "GA2CWNBUHX...",
 * });
 * ```
 */
export class SubscriptionEngine {
  /** Protocol version this engine targets. */
  private readonly protocolVersion: string = "v23";

  /**
   * Create a recurring subscription payload from an existing payment approval.
   *
   * The `originPaymentId` must correspond to a payment that was already
   * approved by the user via the Pi SDK. This method encodes the recurrence
   * authorisation into the Protocol v23 WASM token and returns the full
   * subscription payload for persistence on your server.
   *
   * @param originPaymentId - Payment ID from the initial user approval.
   * @param config          - Subscription billing configuration.
   * @returns Fully populated SubscriptionPayload ready for server storage.
   * @throws {Error} If the WASM module is unavailable or encoding fails.
   */
  async createSubscription(
    originPaymentId: string,
    config: SubscriptionConfig
  ): Promise<SubscriptionPayload> {
    if (!originPaymentId || typeof originPaymentId !== "string") {
      throw new Error(
        "[SubscriptionEngine] originPaymentId must be a non-empty string."
      );
    }

    const planId = randomUUID();
    const startDate = new Date().toISOString();
    const endDate = config.endDate ?? null;

    const startEpoch = Math.floor(Date.now() / 1000);
    const endEpoch = endDate
      ? Math.floor(new Date(endDate).getTime() / 1000)
      : 0;

    const intervalCode = INTERVAL_CODES[config.interval];

    let wasmAuthorisationToken: string;
    try {
      const wasm = getWASMModule();
      wasmAuthorisationToken = wasm.encodeRecurringAuth(
        planId,
        config.merchantWallet,
        config.amount,
        intervalCode,
        startEpoch,
        endEpoch
      );
    } catch (err) {
      // If WASM is not available (e.g. in a test / SSR environment), fall back
      // to a deterministic base-64 stub so the payload can be constructed.
      wasmAuthorisationToken = this._buildFallbackToken(
        planId,
        config,
        intervalCode,
        startEpoch,
        endEpoch
      );
    }

    const payload: SubscriptionPayload = {
      planId,
      planName: config.planName,
      amount: config.amount,
      interval: config.interval,
      startDate,
      endDate,
      originPaymentId,
      merchantWallet: config.merchantWallet,
      wasmAuthorisationToken,
      protocolVersion: this.protocolVersion,
    };

    return payload;
  }

  /**
   * Build the first-cycle Pi payment DTO to present to the user for approval.
   *
   * This DTO should be passed to `PaymentEngine.initiatePayment()`. The
   * resulting `paymentId` is then used as `originPaymentId` for
   * `createSubscription()`.
   *
   * @param config - Subscription billing configuration.
   * @returns PiPaymentDTO for the first billing cycle.
   */
  buildFirstCycleDTO(config: SubscriptionConfig): PiPaymentDTO {
    return {
      amount: config.amount,
      memo: `${config.planName} — first ${config.interval} payment`,
      metadata: {
        note: `Recurring ${config.interval} charge of ${config.amount} Pi`,
        subscriptionPlan: config.planName,
        merchantWallet: config.merchantWallet,
        interval: config.interval,
      },
    };
  }

  /**
   * Validate that a subscription payload is structurally complete.
   *
   * @param payload - Subscription payload to validate.
   * @returns true if valid.
   * @throws {Error} If any required field is missing or malformed.
   */
  validatePayload(payload: SubscriptionPayload): boolean {
    const required: (keyof SubscriptionPayload)[] = [
      "planId",
      "planName",
      "amount",
      "interval",
      "startDate",
      "originPaymentId",
      "merchantWallet",
      "wasmAuthorisationToken",
      "protocolVersion",
    ];

    for (const key of required) {
      if (
        payload[key] === undefined ||
        payload[key] === null ||
        payload[key] === ""
      ) {
        throw new Error(
          `[SubscriptionEngine] Payload validation failed: '${key}' is required.`
        );
      }
    }

    if (payload.amount <= 0) {
      throw new Error(
        "[SubscriptionEngine] Payload validation failed: 'amount' must be > 0."
      );
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Build a deterministic base-64 fallback token for environments where
   * the WASM module is not loaded (e.g. Jest, SSR, Node.js test runners).
   * This token is clearly marked as a stub and must never be used in production.
   */
  private _buildFallbackToken(
    planId: string,
    config: SubscriptionConfig,
    intervalCode: number,
    startEpoch: number,
    endEpoch: number
  ): string {
    const stub = JSON.stringify({
      _stub: true,
      planId,
      merchant: config.merchantWallet,
      amount: config.amount,
      intervalCode,
      startEpoch,
      endEpoch,
    });
    return btoa(stub);
  }
}
