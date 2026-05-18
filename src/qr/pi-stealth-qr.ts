/**
 * @fileoverview pi-stealth-qr — Amount-masked QR code module.
 *
 * Masks the total payment amount within the visual QR matrix until the
 * scanning user successfully authenticates via biometric unlock (Face ID /
 * Fingerprint). The amount is AES-GCM encrypted before being embedded in
 * the QR payload. Only the wallet address and a public memo are visible
 * in the unencrypted portion of the QR data.
 *
 * The biometric challenge flow:
 *   1. Merchant generates a StealthQRPayload (amount AES-GCM encrypted).
 *   2. Customer scans the QR; the Pi app reads the publicMemo and wallet.
 *   3. Pi app calls `navigator.credentials.get` (WebAuthn) using the
 *      embedded biometricChallenge nonce.
 *   4. On success, the Pi app decrypts the encryptedAmount using the
 *      session-derived AES key to display and confirm the payment.
 */

import QRCode from "qrcode";
import { randomUUID, randomHex, toBase64 } from "../core/crypto-utils.js";
import type { StealthQRPayload } from "../types/payment.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for creating a stealth QR payload. */
export interface StealthQRInput {
  /** The true payment amount to conceal. */
  amount: number;
  /** Recipient Pi wallet address (visible in QR). */
  walletAddress: string;
  /** Public-facing memo (does not reveal amount). */
  publicMemo: string;
}

/** A StealthQRPayload bundled with the QR data URL for display. */
export interface StealthQRBundle {
  /** The stealth payload (store on your server). */
  payload: StealthQRPayload;
  /** Base-64 PNG data URL for rendering the QR. */
  qrDataUrl: string;
  /**
   * The AES-GCM key material (base-64) used to encrypt the amount.
   * Send this to the scanning client via a secure, authenticated channel
   * (e.g. a signed JWT or WebSocket push). Never embed it in the QR.
   */
  encryptionKeyBase64: string;
}

// ---------------------------------------------------------------------------
// PiStealthQR
// ---------------------------------------------------------------------------

/**
 * PiStealthQR — generates amount-masked QR codes with biometric protection.
 *
 * @example
 * ```ts
 * const stealth = new PiStealthQR();
 * const bundle = await stealth.generate({
 *   amount: 42.00,
 *   walletAddress: "GA2C...",
 *   publicMemo: "Thank you for your purchase",
 * });
 * // Render bundle.qrDataUrl; securely deliver bundle.encryptionKeyBase64
 * // to the scanning device through your authenticated session channel.
 * ```
 */
export class PiStealthQR {
  private readonly qrSize: number;
  private readonly backgroundColor: string;
  private readonly foregroundColor: string;

  constructor(
    options: {
      qrSize?: number;
      backgroundColor?: string;
      foregroundColor?: string;
    } = {}
  ) {
    this.qrSize = options.qrSize ?? 300;
    this.backgroundColor = options.backgroundColor ?? "#0A0A0F";
    this.foregroundColor = options.foregroundColor ?? "#F0C040";
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Generate a stealth QR bundle with AES-GCM encrypted payment amount.
   *
   * @param input - Stealth QR parameters.
   * @returns Promise resolving to a StealthQRBundle.
   * @throws {Error} If the amount is invalid or encryption fails.
   */
  async generate(input: StealthQRInput): Promise<StealthQRBundle> {
    if (input.amount <= 0) {
      throw new Error("[PiStealthQR] amount must be greater than 0.");
    }
    if (!input.walletAddress) {
      throw new Error("[PiStealthQR] walletAddress is required.");
    }

    // Generate AES-GCM key.
    const { key, keyBase64 } = await this._generateAESKey();

    // Encrypt the amount.
    const amountString = input.amount.toFixed(7);
    const { encryptedData, ivBase64 } = await this._encrypt(
      amountString,
      key
    );

    const sessionId = randomUUID();
    const biometricChallenge = randomHex(32);
    const createdAt = Math.floor(Date.now() / 1000);

    const payload: StealthQRPayload = {
      sessionId,
      walletAddress: input.walletAddress,
      encryptedAmount: encryptedData,
      iv: ivBase64,
      publicMemo: input.publicMemo,
      createdAt,
      biometricChallenge,
    };

    // The QR encodes a redacted version of the payload (no key, no plaintext amount).
    const qrData = JSON.stringify({
      sessionId: payload.sessionId,
      walletAddress: payload.walletAddress,
      encryptedAmount: payload.encryptedAmount,
      iv: payload.iv,
      publicMemo: payload.publicMemo,
      createdAt: payload.createdAt,
      biometricChallenge: payload.biometricChallenge,
    });

    const qrDataUrl = await QRCode.toDataURL(qrData, {
      width: this.qrSize,
      margin: 1,
      color: {
        dark: this.foregroundColor,
        light: this.backgroundColor,
      },
      errorCorrectionLevel: "Q",
    });

    return {
      payload,
      qrDataUrl,
      encryptionKeyBase64: keyBase64,
    };
  }

  /**
   * Decrypt the amount from a StealthQRPayload using the AES-GCM key.
   *
   * Call this on the client side after successful biometric authentication.
   *
   * @param payload          - The scanned StealthQRPayload.
   * @param encryptionKeyB64 - Base-64 AES-GCM key (received via secure channel).
   * @returns Decrypted payment amount (number).
   */
  async revealAmount(
    payload: StealthQRPayload,
    encryptionKeyB64: string
  ): Promise<number> {
    const keyBytes = Uint8Array.from(atob(encryptionKeyB64), (c) =>
      c.charCodeAt(0)
    );
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const iv = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
    const encrypted = Uint8Array.from(atob(payload.encryptedAmount), (c) =>
      c.charCodeAt(0)
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encrypted
    );

    const amountString = new TextDecoder().decode(decrypted);
    const amount = parseFloat(amountString);

    if (isNaN(amount)) {
      throw new Error("[PiStealthQR] Failed to decrypt amount: invalid data.");
    }

    return amount;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Generate a 256-bit AES-GCM key and return it along with its base-64 export.
   */
  private async _generateAESKey(): Promise<{
    key: CryptoKey;
    keyBase64: string;
  }> {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    const exported = await crypto.subtle.exportKey("raw", key);
    const keyBase64 = toBase64(exported);
    return { key, keyBase64 };
  }

  /**
   * Encrypt `plaintext` with the given AES-GCM key.
   *
   * @returns Base-64 ciphertext and IV.
   */
  private async _encrypt(
    plaintext: string,
    key: CryptoKey
  ): Promise<{ encryptedData: string; ivBase64: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );

    return {
      encryptedData: toBase64(cipherBuffer),
      ivBase64: toBase64(iv),
    };
  }
}
