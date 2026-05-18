/**
 * @fileoverview pi-dynamic-hologram — Rotating QR security layer.
 *
 * Constantly rotates the QR code's visual pixel pattern every N milliseconds
 * (default 3 s) to prevent screenshot theft. Each rotation cycle embeds a
 * fresh cryptographic nonce into the payload so that an older frame is
 * cryptographically invalid while the encoded payment data remains stable.
 *
 * The generated frames are suitable for rendering on an HTML <canvas> element
 * or can be streamed to the DynamicQRCode React component.
 */

import QRCode from "qrcode";
import { randomHex, randomUUID } from "../core/crypto-utils.js";
import type {
  HologramConfig,
  HologramFrame,
  QRPayload,
} from "../types/payment.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<HologramConfig> = {
  rotationIntervalMs: 3_000,
  width: 300,
  height: 300,
  backgroundColor: "#0A0A0F",
  foregroundColor: "#F0C040",
};

// ---------------------------------------------------------------------------
// PiDynamicHologram
// ---------------------------------------------------------------------------

/**
 * PiDynamicHologram — generates a rotating series of QR frames to prevent
 * screenshot-based payment theft.
 *
 * Each frame contains an ephemeral nonce that is embedded into the QR data
 * alongside the stable payment payload. Your server's QR validation endpoint
 * should accept any frame nonce generated within the last rotation window.
 *
 * @example
 * ```ts
 * const hologram = new PiDynamicHologram(payload, { rotationIntervalMs: 3000 });
 * hologram.start((frame) => {
 *   document.getElementById("qr-img").src = frame.dataUrl;
 * });
 * // Later:
 * hologram.stop();
 * ```
 */
export class PiDynamicHologram {
  private readonly payload: QRPayload;
  private readonly config: Required<HologramConfig>;
  private _intervalHandle: ReturnType<typeof setInterval> | null = null;
  private _currentFrame: HologramFrame | null = null;
  private _frameIndex = 0;
  private _listeners: Set<(frame: HologramFrame) => void> = new Set();

  constructor(payload: QRPayload, config: HologramConfig = {}) {
    this.payload = payload;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start the rotation loop, immediately emitting the first frame.
   *
   * @param onFrame - Callback invoked each time a new frame is ready.
   */
  start(onFrame: (frame: HologramFrame) => void): void {
    this._listeners.add(onFrame);
    if (this._intervalHandle !== null) return; // Already running.

    // Render the first frame immediately.
    void this._renderAndEmit();

    this._intervalHandle = setInterval(() => {
      void this._renderAndEmit();
    }, this.config.rotationIntervalMs);
  }

  /**
   * Stop the rotation loop and remove the given callback.
   * If no callback is provided all listeners are removed and the loop stops.
   *
   * @param onFrame - The same reference passed to `start()`.
   */
  stop(onFrame?: (frame: HologramFrame) => void): void {
    if (onFrame) {
      this._listeners.delete(onFrame);
    } else {
      this._listeners.clear();
    }
    if (this._listeners.size === 0 && this._intervalHandle !== null) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
  }

  /**
   * Render a single, one-off QR frame without starting the rotation loop.
   *
   * @returns A promise resolving to a single HologramFrame.
   */
  async renderOnce(): Promise<HologramFrame> {
    return this._buildFrame(this._frameIndex++);
  }

  /**
   * Returns the most recently rendered frame, or null if none has been
   * generated yet.
   */
  get currentFrame(): HologramFrame | null {
    return this._currentFrame;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Render a new frame and notify all listeners. */
  private async _renderAndEmit(): Promise<void> {
    try {
      const frame = await this._buildFrame(this._frameIndex++);
      this._currentFrame = frame;
      for (const listener of this._listeners) {
        try {
          listener(frame);
        } catch {
          // Never let a listener crash the rotation loop.
        }
      }
    } catch (err) {
      console.error("[PiDynamicHologram] Failed to render QR frame:", err);
    }
  }

  /**
   * Build a single HologramFrame with a fresh nonce embedded.
   *
   * The nonce is appended as a query parameter so the stable payment data
   * is preserved while the visual pixel pattern changes every cycle.
   */
  private async _buildFrame(frameIndex: number): Promise<HologramFrame> {
    const nonce = randomHex(16);
    const sessionId = this.payload.sessionId || randomUUID();

    // Embed nonce into the serialised payload.
    const framedPayload = JSON.stringify({
      ...this.payload,
      sessionId,
      _nonce: nonce,
      _frame: frameIndex,
    });

    const dataUrl = await QRCode.toDataURL(framedPayload, {
      width: this.config.width,
      margin: 1,
      color: {
        dark: this.config.foregroundColor,
        light: this.config.backgroundColor,
      },
      errorCorrectionLevel: "H",
    });

    return {
      frameIndex,
      dataUrl,
      nonce,
      renderedAt: Date.now(),
    };
  }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

/**
 * Generate a single static QR data URL without the rotation loop.
 *
 * Useful for server-side rendering or one-time display scenarios.
 *
 * @param payload - The QR payment payload.
 * @param config  - Optional hologram configuration (width, colors, etc.).
 * @returns Promise resolving to a base-64 PNG data URL.
 */
export async function generateStaticQR(
  payload: QRPayload,
  config: HologramConfig = {}
): Promise<string> {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const hologram = new PiDynamicHologram(payload, merged);
  const frame = await hologram.renderOnce();
  return frame.dataUrl;
}
