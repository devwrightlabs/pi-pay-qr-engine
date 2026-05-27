"use client";

/**
 * @fileoverview useCheckout — Custom hook for the Pi payment lifecycle.
 *
 * Exposes the complete payment lifecycle and all 16 utility module instances
 * to any component inside a <QrCheckoutProvider> tree.
 *
 * @example
 * ```tsx
 * "use client";
 *
 * import { useCheckout } from "@devright/pi-pay-qr-engine/react";
 *
 * export function CheckoutButton() {
 *   const {
 *     engineState,
 *     initiatePayment,
 *     resetPayment,
 *     isTerminal,
 *     taxCalculator,
 *     tipRouter,
 *     fiatDisplay,
 *   } = useCheckout();
 *
 *   const handlePay = async () => {
 *     const dto = taxCalculator.buildTaxInclusiveDTO(
 *       { amount: 5, memo: "Coffee", metadata: {} },
 *       "US-TX",
 *     );
 *     await initiatePayment(dto);
 *   };
 *
 *   return (
 *     <button onClick={handlePay} disabled={engineState.state !== "IDLE"}>
 *       Pay {engineState.state === "IDLE" ? "Now" : `(${engineState.state})`}
 *     </button>
 *   );
 * }
 * ```
 */

import { useMemo } from "react";
import { useCheckoutContext } from "./QrCheckoutProvider.js";
import { SubscriptionEngine } from "../core/SubscriptionEngine.js";
import { PaymentRecovery } from "../core/pi-payment-recovery.js";
import { PiDynamicHologram } from "../qr/pi-dynamic-hologram.js";
import { PiQRCompressor } from "../qr/pi-qr-compressor.js";
import { PiRefundToken } from "../qr/pi-refund-token.js";
import { PiStealthQR } from "../qr/pi-stealth-qr.js";
import { PiQRExpiry } from "../qr/pi-qr-expiry.js";
import { SplitTenderProcessor } from "../checkout/pi-split-tender.js";
import { MicroTabManager } from "../checkout/pi-micro-tab.js";
import { FiatDisplayEngine } from "../checkout/pi-fiat-display.js";
import { PiTaxCalculator } from "../checkout/pi-tax-calc.js";
import { PiTipRouter } from "../checkout/pi-tip-router.js";
import { PiInvoiceAirdrop } from "../checkout/pi-invoice-airdrop.js";
import { PiOfflineCheckout } from "../checkout/pi-offline-checkout.js";
import type {
  CheckoutContextValue,
  PaymentEngineConfig,
} from "../types/payment.js";

// ---------------------------------------------------------------------------
// Extended hook return type
// ---------------------------------------------------------------------------

/**
 * The full value returned by `useCheckout()`.
 *
 * Includes all properties from CheckoutContextValue plus pre-instantiated
 * instances of every utility module.
 */
export interface UseCheckoutReturn extends CheckoutContextValue {
  // ── Core modules ──────────────────────────────────────────────────────────
  /** Protocol v23 WASM subscription engine. */
  subscriptionEngine: SubscriptionEngine;
  /** Blockchain polling recovery utility. */
  paymentRecovery: PaymentRecovery;

  // ── QR modules ────────────────────────────────────────────────────────────
  /** Dynamic hologram QR rotator. */
  dynamicHologram: typeof PiDynamicHologram;
  /** QR payload compressor / optimiser. */
  qrCompressor: PiQRCompressor;
  /** Reverse-QR refund token generator. */
  refundToken: PiRefundToken;
  /** Amount-masking stealth QR generator. */
  stealthQR: PiStealthQR;
  /** QR payload TTL / expiry wrapper. */
  qrExpiry: PiQRExpiry;

  // ── Checkout modules ──────────────────────────────────────────────────────
  /** Fiat-bridge split-tender processor. */
  splitTender: SplitTenderProcessor;
  /** Micro-tab aggregated purchase manager. */
  microTab: MicroTabManager;
  /** Oracle-based fiat conversion rate display. */
  fiatDisplay: FiatDisplayEngine;
  /** Regional VAT / sales-tax calculator. */
  taxCalculator: PiTaxCalculator;
  /** Bill / gratuity tip router. */
  tipRouter: PiTipRouter;
  /** Web Bluetooth LE invoice airdrop. */
  invoiceAirdrop: PiInvoiceAirdrop;
  /** Offline cryptographic transaction signer. */
  offlineCheckout: PiOfflineCheckout;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useCheckout — access the full Pi payment lifecycle and all utility modules.
 *
 * Must be called inside a component that is a descendant of
 * `<QrCheckoutProvider>`.
 *
 * All module instances are stable references (memoised) and do not change
 * between renders unless the provider is remounted.
 *
 * @param recoveryConfig - Optional override for the PaymentRecovery instance.
 *                         If omitted, defaults to the engine's configured URLs.
 * @returns UseCheckoutReturn
 */
export function useCheckout(
  recoveryConfig?: Partial<PaymentEngineConfig>
): UseCheckoutReturn {
  const ctx = useCheckoutContext();

  // Stable utility module instances — only recreated if recoveryConfig changes.
  const modules = useMemo(() => {
    const approvalUrl = recoveryConfig?.approvalUrl ?? "";
    const completionUrl = recoveryConfig?.completionUrl ?? "";

    return {
      subscriptionEngine: new SubscriptionEngine(),
      paymentRecovery: new PaymentRecovery({ approvalUrl, completionUrl }),
      dynamicHologram: PiDynamicHologram,
      qrCompressor: new PiQRCompressor(),
      refundToken: new PiRefundToken(),
      stealthQR: new PiStealthQR(),
      qrExpiry: new PiQRExpiry(),
      splitTender: new SplitTenderProcessor(),
      microTab: new MicroTabManager(),
      fiatDisplay: new FiatDisplayEngine(),
      taxCalculator: new PiTaxCalculator(),
      tipRouter: new PiTipRouter(),
      invoiceAirdrop: new PiInvoiceAirdrop(),
      offlineCheckout: new PiOfflineCheckout(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recoveryConfig?.approvalUrl, recoveryConfig?.completionUrl]);

  return {
    ...ctx,
    ...modules,
  };
}
