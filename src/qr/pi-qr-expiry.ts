/**
 * @fileoverview pi-qr-expiry — QR payload TTL / expiry wrapper.
 *
 * Attaches a strict Time-To-Live countdown to a QR invoice payload.
 * The payload is completely invalidated after the TTL (default 60 s),
 * preventing replay attacks where an attacker captures an old QR image
 * and attempts to re-use it for a fraudulent payment.
 *
 * An HMAC-SHA256 integrity token is bound to the payload + expiry timestamp,
 * so any tampering with the expiry field is immediately detectable.
 */

import { randomUUID, hmacSHA256 } from "../core/crypto-utils.js";
import type { ExpiringQRPayload, QRPayload } from "../types/payment.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_TTL_SECONDS = 60;

/** Shared HMAC secret — in production, inject from your key management service. */
const INTEGRITY_SECRET =
  process.env["PI_QR_INTEGRITY_SECRET"] ?? "pi-qr-engine-default-secret";

// ---------------------------------------------------------------------------
// PiQRExpiry
// ---------------------------------------------------------------------------

/**
 * PiQRExpiry — wraps a QRPayload with a strict TTL and HMAC integrity token.
 *
 * @example
 * ```ts
 * const expiry = new PiQRExpiry({ ttlSeconds: 60 });
 * const wrapped = await expiry.wrap(qrPayload);
 * // On scan:
 * const valid = await expiry.validate(wrapped);
 * ```
 */
export class PiQRExpiry {
  private readonly ttlSeconds: number;

  constructor(options: { ttlSeconds?: number } = {}) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Wrap a QRPayload with expiry metadata and an HMAC integrity token.
   *
   * @param payload - The base QR payload to protect.
   * @returns Promise resolving to an ExpiringQRPayload.
   */
  async wrap(payload: QRPayload): Promise<ExpiringQRPayload> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + this.ttlSeconds;

    // Ensure the inner payload's expiresAt is consistent.
    const stamped: QRPayload = {
      ...payload,
      sessionId: payload.sessionId || randomUUID(),
      createdAt: issuedAt,
      expiresAt,
    };

    const integrityToken = await this._computeIntegrityToken(
      stamped,
      expiresAt
    );

    return {
      payload: stamped,
      issuedAt,
      expiresAt,
      ttlSeconds: this.ttlSeconds,
      integrityToken,
    };
  }

  /**
   * Validate an ExpiringQRPayload.
   *
   * Checks:
   *  1. The current time is before `expiresAt`.
   *  2. The HMAC integrity token matches (prevents tampering).
   *
   * @param wrapped - The ExpiringQRPayload to validate.
   * @returns Promise<boolean> — true if the payload is valid and unexpired.
   */
  async validate(wrapped: ExpiringQRPayload): Promise<boolean> {
    const nowSeconds = Math.floor(Date.now() / 1000);

    // Check expiry.
    if (nowSeconds > wrapped.expiresAt) {
      return false;
    }

    // Check integrity.
    const expectedToken = await this._computeIntegrityToken(
      wrapped.payload,
      wrapped.expiresAt
    );

    return expectedToken === wrapped.integrityToken;
  }

  /**
   * Returns the number of seconds remaining before the payload expires.
   * Returns 0 if already expired.
   *
   * @param wrapped - The ExpiringQRPayload to inspect.
   */
  remainingSeconds(wrapped: ExpiringQRPayload): number {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return Math.max(0, wrapped.expiresAt - nowSeconds);
  }

  /**
   * Returns true if the payload has expired.
   */
  isExpired(wrapped: ExpiringQRPayload): boolean {
    return this.remainingSeconds(wrapped) === 0;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Compute an HMAC-SHA256 integrity token over the canonical payload string
   * and the expiry timestamp, bound with the shared secret.
   */
  private async _computeIntegrityToken(
    payload: QRPayload,
    expiresAt: number
  ): Promise<string> {
    const canonical =
      `${payload.sessionId}:${payload.amount}:${payload.walletAddress}:` +
      `${payload.memo}:${payload.createdAt}:${expiresAt}`;

    return hmacSHA256(canonical, INTEGRITY_SECRET);
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a QRPayload with the default 60-second TTL in one call.
 *
 * @param payload    - QR payload to protect.
 * @param ttlSeconds - Custom TTL. Default: 60.
 * @returns Promise resolving to an ExpiringQRPayload.
 */
export async function wrapWithExpiry(
  payload: QRPayload,
  ttlSeconds = DEFAULT_TTL_SECONDS
): Promise<ExpiringQRPayload> {
  const expiry = new PiQRExpiry({ ttlSeconds });
  return expiry.wrap(payload);
}

/**
 * Validate an ExpiringQRPayload in one call.
 *
 * @param wrapped - The payload to validate.
 * @returns Promise<boolean>
 */
export async function validateExpiry(
  wrapped: ExpiringQRPayload
): Promise<boolean> {
  const expiry = new PiQRExpiry();
  return expiry.validate(wrapped);
}
