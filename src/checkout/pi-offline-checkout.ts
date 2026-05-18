/**
 * @fileoverview pi-offline-checkout — Offline cryptographic transaction signing.
 *
 * Cryptographically signs a Pi payment payload locally on the user's device
 * so the merchant's POS can queue it and upload it to the Pi blockchain the
 * moment internet connectivity is restored.
 *
 * Uses the Web Crypto API (ECDSA P-256) for signing. The key pair should be
 * generated once per device / session and the public key registered with the
 * merchant's backend for verification.
 */

import { randomUUID, toBase64 } from "../core/crypto-utils.js";
import type { OfflineSignedTransaction, PiPaymentDTO } from "../types/payment.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A generated ECDSA P-256 key pair for offline signing. */
export interface OfflineKeyPair {
  /** CryptoKey for signing (private). */
  privateKey: CryptoKey;
  /** CryptoKey for verification (public). */
  publicKey: CryptoKey;
  /** Base-64 DER-encoded public key for server registration. */
  publicKeyBase64: string;
}

/** Configuration for PiOfflineCheckout. */
export interface OfflineCheckoutConfig {
  /**
   * Maximum number of transactions to queue before flushing is required.
   * Default: 100.
   */
  maxQueueSize?: number;
  /**
   * Callback invoked when the queue is flushed to the backend.
   * Receives the list of signed transactions that were uploaded.
   */
  onFlushComplete?: (uploaded: OfflineSignedTransaction[]) => void;
}

// ---------------------------------------------------------------------------
// PiOfflineCheckout
// ---------------------------------------------------------------------------

/**
 * PiOfflineCheckout — locally signs Pi payment DTOs for offline POS queuing.
 *
 * @example
 * ```ts
 * const checkout = new PiOfflineCheckout();
 * const keyPair = await checkout.generateKeyPair();
 * // Register keyPair.publicKeyBase64 with your server.
 *
 * // While offline:
 * const signed = await checkout.signTransaction(dto, keyPair.privateKey, keyPair.publicKeyBase64);
 * checkout.enqueue(signed);
 *
 * // When internet returns:
 * const results = await checkout.flushQueue("/api/pi/offline-upload");
 * ```
 */
export class PiOfflineCheckout {
  private readonly config: Required<OfflineCheckoutConfig>;
  private readonly _queue: OfflineSignedTransaction[] = [];

  constructor(config: OfflineCheckoutConfig = {}) {
    this.config = {
      maxQueueSize: config.maxQueueSize ?? 100,
      onFlushComplete: config.onFlushComplete ?? (() => undefined),
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Generate an ECDSA P-256 key pair for offline signing.
   *
   * Call this once on the device and store the private key securely
   * (e.g. in IndexedDB with the `nonExtractable` flag).
   *
   * @returns Promise resolving to an OfflineKeyPair.
   */
  async generateKeyPair(): Promise<OfflineKeyPair> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true, // extractable so we can export the public key
      ["sign", "verify"]
    );

    const rawPublicKey = await crypto.subtle.exportKey(
      "spki",
      keyPair.publicKey
    );
    const publicKeyBase64 = toBase64(rawPublicKey);

    return {
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      publicKeyBase64,
    };
  }

  /**
   * Cryptographically sign a PiPaymentDTO with the provided ECDSA private key.
   *
   * @param dto            - The payment DTO to sign.
   * @param privateKey     - The ECDSA P-256 private CryptoKey.
   * @param publicKeyBase64- Base-64 encoded public key (DER/SPKI).
   * @returns Promise resolving to an OfflineSignedTransaction.
   */
  async signTransaction(
    dto: PiPaymentDTO,
    privateKey: CryptoKey,
    publicKeyBase64: string
  ): Promise<OfflineSignedTransaction> {
    const txId = randomUUID();
    const signedAt = Date.now();

    // Canonical representation of the payload for signing.
    const canonical = this._canonicalise(dto, txId, signedAt);
    const signature = await this._sign(canonical, privateKey);

    return {
      txId,
      payload: dto,
      signature,
      publicKey: publicKeyBase64,
      signedAt,
      uploaded: false,
      uploadedAt: null,
    };
  }

  /**
   * Verify a signed transaction using the provided ECDSA public key.
   *
   * @param tx         - The signed transaction to verify.
   * @param publicKey  - The CryptoKey (public) or raw base-64 public key.
   * @returns Promise<boolean> — true if the signature is valid.
   */
  async verifyTransaction(
    tx: OfflineSignedTransaction,
    publicKey: CryptoKey | string
  ): Promise<boolean> {
    try {
      let cryptoKey: CryptoKey;

      if (typeof publicKey === "string") {
        // Import from base-64 DER/SPKI.
        const raw = Uint8Array.from(atob(publicKey), (c) => c.charCodeAt(0));
        cryptoKey = await crypto.subtle.importKey(
          "spki",
          raw,
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"]
        );
      } else {
        cryptoKey = publicKey;
      }

      const canonical = this._canonicalise(
        tx.payload,
        tx.txId,
        tx.signedAt
      );
      const sigBytes = Uint8Array.from(
        tx.signature.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
      );

      return crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        cryptoKey,
        sigBytes,
        new TextEncoder().encode(canonical)
      );
    } catch {
      return false;
    }
  }

  /**
   * Add a signed transaction to the offline queue.
   *
   * @param tx - The signed transaction to queue.
   * @throws {Error} If the queue has reached its maximum size.
   */
  enqueue(tx: OfflineSignedTransaction): void {
    if (this._queue.length >= this.config.maxQueueSize) {
      throw new Error(
        `[PiOfflineCheckout] Queue is full (max ${this.config.maxQueueSize}). ` +
          `Call flushQueue() before adding more transactions.`
      );
    }
    this._queue.push(tx);
  }

  /**
   * Returns a snapshot of the current transaction queue.
   */
  getQueue(): OfflineSignedTransaction[] {
    return [...this._queue];
  }

  /**
   * Flush all queued transactions to the backend upload endpoint.
   *
   * @param uploadUrl - URL of the server endpoint that accepts the queue.
   * @param headers   - Optional HTTP headers (e.g. Authorization).
   * @returns Array of transactions that were successfully uploaded.
   */
  async flushQueue(
    uploadUrl: string,
    headers: Record<string, string> = {}
  ): Promise<OfflineSignedTransaction[]> {
    if (this._queue.length === 0) return [];

    const toUpload = [...this._queue];
    const uploaded: OfflineSignedTransaction[] = [];

    for (const tx of toUpload) {
      try {
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify(tx),
        });

        if (response.ok) {
          tx.uploaded = true;
          tx.uploadedAt = new Date().toISOString();
          uploaded.push(tx);
        }
      } catch {
        // Leave failed transactions in the queue for retry.
      }
    }

    // Remove successfully uploaded transactions from the queue.
    for (const tx of uploaded) {
      const idx = this._queue.indexOf(tx);
      if (idx !== -1) this._queue.splice(idx, 1);
    }

    this.config.onFlushComplete(uploaded);
    return uploaded;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Build a canonical string representation of a payment for signing.
   * The canonical form is deterministic and tamper-evident.
   */
  private _canonicalise(
    dto: PiPaymentDTO,
    txId: string,
    signedAt: number
  ): string {
    return [
      txId,
      dto.amount.toFixed(7),
      dto.memo,
      JSON.stringify(dto.metadata, Object.keys(dto.metadata).sort()),
      signedAt.toString(),
    ].join("||");
  }

  /**
   * Sign a canonical string with ECDSA-P256-SHA256 and return a hex string.
   */
  private async _sign(
    canonical: string,
    privateKey: CryptoKey
  ): Promise<string> {
    const data = new TextEncoder().encode(canonical);
    const sigBuffer = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      data
    );
    return Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
}
