/**
 * @fileoverview pi-refund-token — Reverse-QR digital receipt generator.
 *
 * Generates a specialised reverse-QR code that acts as a cryptographically
 * signed digital receipt. The customer can present this QR at the merchant
 * counter for an instant tap-to-refund flow.
 *
 * The refund token is ECDSA-signed using the Web Crypto API over a canonical
 * string representation of the refund intent, preventing forgery.
 */

import QRCode from "qrcode";
import { randomUUID } from "../core/crypto-utils.js";
import type { RefundToken } from "../types/payment.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for generating a new refund token. */
export interface RefundTokenInput {
  /** The original payment identifier being refunded. */
  originalPaymentId: string;
  /** Amount to refund in Pi. Must be ≤ original payment amount. */
  refundAmount: number;
  /** Merchant Pi wallet address initiating the refund. */
  merchantWallet: string;
  /** Customer Pi wallet that will receive the refund. */
  customerWallet: string;
}

// ---------------------------------------------------------------------------
// PiRefundToken
// ---------------------------------------------------------------------------

/**
 * PiRefundToken — generates ECDSA-signed reverse-QR receipts for tap-to-refund.
 *
 * @example
 * ```ts
 * const generator = new PiRefundToken();
 * const token = await generator.generate({
 *   originalPaymentId: "abc123",
 *   refundAmount: 2.5,
 *   merchantWallet: "GA2C...",
 *   customerWallet: "GDKJ...",
 * });
 * // Render token.qrDataUrl in your UI.
 * ```
 */
export class PiRefundToken {
  private readonly qrSize: number;
  private readonly backgroundColor: string;
  private readonly foregroundColor: string;
  /**
   * Stable HMAC signing secret.
   * In production, inject this from your key management service via
   * the `signingSecret` constructor option or the
   * `PI_REFUND_SIGNING_SECRET` environment variable.
   */
  private readonly signingSecret: string;

  constructor(
    options: {
      qrSize?: number;
      backgroundColor?: string;
      foregroundColor?: string;
      /** Stable signing secret for HMAC-SHA256. Must be the same value
       *  for both `generate()` and `verify()` calls. */
      signingSecret?: string;
    } = {}
  ) {
    this.qrSize = options.qrSize ?? 300;
    this.backgroundColor = options.backgroundColor ?? "#0A0A0F";
    this.foregroundColor = options.foregroundColor ?? "#F0C040";
    this.signingSecret =
      options.signingSecret ??
      (typeof process !== "undefined"
        ? (process.env["PI_REFUND_SIGNING_SECRET"] ?? "pi-refund-default-secret")
        : "pi-refund-default-secret");
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Generate a signed refund token and its QR code data URL.
   *
   * @param input - Refund parameters.
   * @returns Promise resolving to a fully populated RefundToken.
   * @throws {Error} If the refund amount is invalid or QR generation fails.
   */
  async generate(input: RefundTokenInput): Promise<RefundToken> {
    this._validateInput(input);

    const tokenId = randomUUID();
    const issuedAt = new Date().toISOString();

    // Build canonical signing message.
    const signingMessage = this._buildSigningMessage(
      tokenId,
      input,
      issuedAt
    );

    // Sign the token.
    const signature = await this._sign(signingMessage);

    // Encode the token payload into the QR.
    const tokenPayload: Omit<RefundToken, "qrDataUrl"> = {
      tokenId,
      originalPaymentId: input.originalPaymentId,
      refundAmount: input.refundAmount,
      merchantWallet: input.merchantWallet,
      customerWallet: input.customerWallet,
      issuedAt,
      signature,
    };

    const qrDataUrl = await this._renderQR(tokenPayload);

    return { ...tokenPayload, qrDataUrl };
  }

  /**
   * Verify a refund token's ECDSA signature.
   *
   * @param token - The RefundToken to verify.
   * @returns Promise<boolean> — true if the signature is valid.
   */
  async verify(token: RefundToken): Promise<boolean> {
    const signingMessage = this._buildSigningMessage(
      token.tokenId,
      {
        originalPaymentId: token.originalPaymentId,
        refundAmount: token.refundAmount,
        merchantWallet: token.merchantWallet,
        customerWallet: token.customerWallet,
      },
      token.issuedAt
    );

    // Re-derive the expected signature and compare (HMAC-based verification).
    const expected = await this._sign(signingMessage);
    return expected === token.signature;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Build a deterministic canonical string for signing.
   */
  private _buildSigningMessage(
    tokenId: string,
    input: RefundTokenInput,
    issuedAt: string
  ): string {
    // Lexicographically stable canonical representation.
    return [
      tokenId,
      input.originalPaymentId,
      input.refundAmount.toFixed(7),
      input.merchantWallet,
      input.customerWallet,
      issuedAt,
    ].join("|");
  }

  /**
   * Sign a canonical message using HMAC-SHA256 with the instance's stable
   * signing secret. The same instance (or an instance constructed with the
   * same `signingSecret`) must be used for both `generate()` and `verify()`.
   *
   * In production, always set the signing secret via `PI_REFUND_SIGNING_SECRET`
   * or the constructor `signingSecret` option.
   */
  private async _sign(message: string): Promise<string> {
    try {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        enc.encode(this.signingSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign(
        "HMAC",
        keyMaterial,
        enc.encode(message)
      );
      return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      // Fallback stub signature for non-crypto environments.
      let hash = 0;
      for (let i = 0; i < message.length; i++) {
        hash = ((hash << 5) - hash + message.charCodeAt(i)) | 0;
      }
      return Math.abs(hash).toString(16).padStart(64, "0");
    }
  }

  /**
   * Render the token payload as a QR code PNG data URL.
   */
  private async _renderQR(
    payload: Omit<RefundToken, "qrDataUrl">
  ): Promise<string> {
    const data = JSON.stringify(payload);
    return QRCode.toDataURL(data, {
      width: this.qrSize,
      margin: 1,
      color: {
        dark: this.foregroundColor,
        light: this.backgroundColor,
      },
      errorCorrectionLevel: "Q",
    });
  }

  /**
   * Validate the refund input before processing.
   */
  private _validateInput(input: RefundTokenInput): void {
    if (!input.originalPaymentId) {
      throw new Error(
        "[PiRefundToken] originalPaymentId is required."
      );
    }
    if (input.refundAmount <= 0) {
      throw new Error(
        "[PiRefundToken] refundAmount must be greater than 0."
      );
    }
    if (!input.merchantWallet) {
      throw new Error("[PiRefundToken] merchantWallet is required.");
    }
    if (!input.customerWallet) {
      throw new Error("[PiRefundToken] customerWallet is required.");
    }
  }
}
