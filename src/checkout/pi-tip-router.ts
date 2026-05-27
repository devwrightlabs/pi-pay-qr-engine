/**
 * @fileoverview pi-tip-router — Gratuity separation and routing.
 *
 * Mathematically separates the main bill from the gratuity inside a Pi
 * payment payload. The tip is routed directly to the service worker's wallet
 * as a separate Pi payment DTO, ensuring the worker receives gratuity without
 * merchant intermediation.
 *
 * Both the bill and tip DTOs are returned for sequential or parallel
 * submission to the Pi SDK via PaymentEngine.
 */

import type {
  PiPaymentDTO,
  TipRouteConfig,
  TipRoutedPayload,
} from "../types/payment.js";

// ---------------------------------------------------------------------------
// PiTipRouter
// ---------------------------------------------------------------------------

/**
 * PiTipRouter — splits a total into merchant bill + worker tip.
 *
 * @example
 * ```ts
 * const router = new PiTipRouter();
 *
 * // Build from subtotal + explicit tip amount:
 * const split = router.splitByAmount({
 *   workerWallet: "GA2C...",
 *   tipAmount: 1.5,
 * }, subtotalDTO);
 *
 * // Or build from subtotal + tip percentage:
 * const split = router.splitByPercentage(subtotalDTO, "GA2C...", 18);
 * ```
 */
export class PiTipRouter {
  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Split a base payment DTO into a merchant bill and a worker tip using an
   * explicit tip amount.
   *
   * @param tipConfig   - Worker wallet address and explicit tip amount.
   * @param basePayment - The original full-amount PiPaymentDTO (bill only, excl. tip).
   * @returns A TipRoutedPayload with separate bill and tip DTOs.
   * @throws {Error} If tip amount is negative or exceeds the base amount.
   */
  splitByAmount(
    tipConfig: TipRouteConfig,
    basePayment: PiPaymentDTO
  ): TipRoutedPayload {
    this._validateTipAmount(tipConfig.tipAmount, basePayment.amount);

    const billAmount = parseFloat(
      (basePayment.amount).toFixed(7)
    );
    const tipAmount = parseFloat(tipConfig.tipAmount.toFixed(7));
    const grandTotal = parseFloat((billAmount + tipAmount).toFixed(7));
    const tipPercentage =
      tipConfig.tipPercentage ??
      parseFloat(((tipAmount / billAmount) * 100).toFixed(2));

    const billPayment: PiPaymentDTO = {
      amount: billAmount,
      memo: basePayment.memo,
      metadata: {
        ...basePayment.metadata,
        paymentType: "bill",
        grandTotal,
        tipAmount,
      },
    };

    const tipPayment: PiPaymentDTO = {
      amount: tipAmount,
      memo: `Tip for ${tipConfig.workerWallet.slice(0, 8)}… (${tipPercentage}%)`,
      metadata: {
        workerWallet: tipConfig.workerWallet,
        paymentType: "tip",
        originalBillAmount: billAmount,
        tipPercentage,
        note: "Gratuity — routed directly to service worker",
      },
    };

    return {
      billPayment,
      tipPayment,
      summary: {
        subtotal: billAmount,
        tipAmount,
        grandTotal,
        tipPercentage,
      },
    };
  }

  /**
   * Split a base payment DTO into a merchant bill and a worker tip by applying
   * a percentage of the subtotal as gratuity.
   *
   * @param basePayment       - The original bill PiPaymentDTO (subtotal only).
   * @param workerWallet      - Pi wallet address of the service worker.
   * @param tipPercentage     - Tip as a percentage of the subtotal (e.g. 18 = 18%).
   * @returns A TipRoutedPayload.
   * @throws {Error} If the percentage is out of range (0–100).
   */
  splitByPercentage(
    basePayment: PiPaymentDTO,
    workerWallet: string,
    tipPercentage: number
  ): TipRoutedPayload {
    if (tipPercentage < 0 || tipPercentage > 100) {
      throw new Error(
        `[PiTipRouter] tipPercentage must be between 0 and 100, got ${tipPercentage}.`
      );
    }

    const tipAmount = parseFloat(
      ((basePayment.amount * tipPercentage) / 100).toFixed(7)
    );

    return this.splitByAmount(
      { workerWallet, tipAmount, tipPercentage },
      basePayment
    );
  }

  /**
   * Calculate the suggested tip amounts for a given subtotal at common
   * tip percentages (10%, 15%, 18%, 20%, 25%).
   *
   * @param subtotal - Bill subtotal in Pi.
   * @returns An object mapping percentage labels to Pi amounts.
   */
  suggestTips(
    subtotal: number
  ): Record<string, { tipAmount: number; total: number }> {
    const percentages = [10, 15, 18, 20, 25];
    const suggestions: Record<string, { tipAmount: number; total: number }> = {};

    for (const pct of percentages) {
      const tipAmount = parseFloat(
        ((subtotal * pct) / 100).toFixed(7)
      );
      suggestions[`${pct}%`] = {
        tipAmount,
        total: parseFloat((subtotal + tipAmount).toFixed(7)),
      };
    }

    return suggestions;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Validate that the tip amount is within acceptable bounds.
   */
  private _validateTipAmount(tipAmount: number, baseAmount: number): void {
    if (tipAmount < 0) {
      throw new Error(
        `[PiTipRouter] tipAmount must be >= 0, got ${tipAmount}.`
      );
    }
    if (tipAmount > baseAmount * 2) {
      // Allow generous tips up to 200% but prevent obvious data errors.
      throw new Error(
        `[PiTipRouter] tipAmount (${tipAmount}) exceeds 200% of the base amount (${baseAmount}). ` +
          `Check your inputs.`
      );
    }
  }
}
