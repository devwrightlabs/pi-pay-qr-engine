"use client";

/**
 * @fileoverview DynamicQRCode — Premium Devright Labs QR UI component.
 *
 * Renders the Pi payment QR code on an HTML canvas using the Devright Labs
 * enterprise design system:
 *   - Background: #0A0A0F (near-black)
 *   - QR pixels / accents: #F0C040 (gold)
 *
 * When `enableHologram` is true (default), the QR pixel pattern rotates every
 * `rotationIntervalMs` milliseconds (default 3 s) via PiDynamicHologram to
 * prevent screenshot theft while maintaining scan validity.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PiDynamicHologram } from "../qr/pi-dynamic-hologram.js";
import type {
  DynamicQRCodeProps,
  HologramFrame,
} from "../types/payment.js";

// ---------------------------------------------------------------------------
// Default design-system tokens
// ---------------------------------------------------------------------------

const DEFAULT_BACKGROUND = "#0A0A0F";
const DEFAULT_FOREGROUND = "#F0C040";
const DEFAULT_SIZE = 300;
const DEFAULT_ROTATION_MS = 3_000;

// ---------------------------------------------------------------------------
// DynamicQRCode component
// ---------------------------------------------------------------------------

/**
 * DynamicQRCode — enterprise-grade QR code renderer for Pi payments.
 *
 * Renders a rotating holographic QR on a canvas element. The QR is generated
 * by PiDynamicHologram and updates on a configurable interval to prevent
 * screenshot-based fraud.
 *
 * @example
 * ```tsx
 * "use client";
 *
 * import { DynamicQRCode } from "@devright/pi-pay-qr-engine/react";
 *
 * export function CheckoutQR({ qrPayload }: { qrPayload: QRPayload }) {
 *   return (
 *     <DynamicQRCode
 *       payload={qrPayload}
 *       size={320}
 *       enableHologram
 *       rotationIntervalMs={3000}
 *     />
 *   );
 * }
 * ```
 */
export function DynamicQRCode({
  payload,
  size = DEFAULT_SIZE,
  backgroundColor = DEFAULT_BACKGROUND,
  foregroundColor = DEFAULT_FOREGROUND,
  enableHologram = true,
  rotationIntervalMs = DEFAULT_ROTATION_MS,
  ariaLabel = "Pi payment QR code",
  className,
}: DynamicQRCodeProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hologramRef = useRef<PiDynamicHologram | null>(null);
  const [currentFrame, setCurrentFrame] = useState<HologramFrame | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Frame handler ──────────────────────────────────────────────────────────

  const handleFrame = useCallback((frame: HologramFrame) => {
    setCurrentFrame(frame);
  }, []);

  // ── Draw frame to canvas ───────────────────────────────────────────────────

  useEffect(() => {
    if (!currentFrame || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.onerror = () => {
      setError("Failed to render QR frame.");
    };
    img.src = currentFrame.dataUrl;
  }, [currentFrame]);

  // ── Hologram lifecycle ─────────────────────────────────────────────────────

  useEffect(() => {
    setError(null);

    // Tear down any existing hologram.
    if (hologramRef.current) {
      hologramRef.current.stop(handleFrame);
      hologramRef.current = null;
    }

    const hologram = new PiDynamicHologram(payload, {
      rotationIntervalMs: enableHologram ? rotationIntervalMs : 0,
      width: size,
      height: size,
      backgroundColor,
      foregroundColor,
    });

    hologramRef.current = hologram;

    if (enableHologram) {
      hologram.start(handleFrame);
    } else {
      // Static render — render once and stop.
      hologram
        .renderOnce()
        .then((frame) => setCurrentFrame(frame))
        .catch((err: unknown) => {
          setError(
            err instanceof Error ? err.message : "QR render failed."
          );
        });
    }

    return () => {
      hologram.stop(handleFrame);
      hologramRef.current = null;
    };
  }, [
    payload,
    size,
    backgroundColor,
    foregroundColor,
    enableHologram,
    rotationIntervalMs,
    handleFrame,
  ]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: backgroundColor,
        padding: "16px",
        borderRadius: "12px",
        border: `1px solid ${foregroundColor}22`,
        boxShadow: `0 0 24px ${foregroundColor}18`,
        width: size + 32,
        boxSizing: "border-box",
      }}
      role="img"
      aria-label={ariaLabel}
    >
      {/* Header badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "12px",
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: foregroundColor,
            animation: enableHologram
              ? "piPulse 1.5s ease-in-out infinite"
              : "none",
          }}
        />
        <span
          style={{
            fontFamily: "monospace",
            fontSize: "10px",
            letterSpacing: "0.12em",
            color: foregroundColor,
            textTransform: "uppercase",
          }}
        >
          Pi Pay
        </span>
      </div>

      {/* QR Canvas */}
      {error ? (
        <div
          style={{
            width: size,
            height: size,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FF4D4F",
            fontSize: "12px",
            textAlign: "center",
            padding: "8px",
          }}
        >
          {error}
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          style={{
            display: "block",
            borderRadius: "6px",
            background: backgroundColor,
          }}
          aria-hidden="true"
        />
      )}

      {/* Amount display */}
      {payload.amount > 0 && (
        <div
          style={{
            marginTop: "12px",
            fontFamily: "monospace",
            fontSize: "14px",
            fontWeight: 700,
            color: foregroundColor,
            letterSpacing: "0.05em",
          }}
        >
          {payload.amount.toFixed(2)}{" "}
          <span style={{ opacity: 0.7, fontSize: "11px" }}>π</span>
        </div>
      )}

      {/* Memo */}
      {payload.memo && (
        <div
          style={{
            marginTop: "4px",
            fontFamily: "sans-serif",
            fontSize: "11px",
            color: `${foregroundColor}99`,
            textAlign: "center",
            maxWidth: size,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {payload.memo}
        </div>
      )}

      {/* Rotation indicator */}
      {enableHologram && (
        <div
          style={{
            marginTop: "8px",
            fontFamily: "monospace",
            fontSize: "9px",
            color: `${foregroundColor}55`,
            letterSpacing: "0.1em",
          }}
        >
          HOLOGRAPHIC • ROTATES EVERY {rotationIntervalMs / 1000}s
        </div>
      )}

      {/* Inline keyframe animation */}
      <style>{`
        @keyframes piPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.75); }
        }
      `}</style>
    </div>
  );
}

DynamicQRCode.displayName = "DynamicQRCode";
