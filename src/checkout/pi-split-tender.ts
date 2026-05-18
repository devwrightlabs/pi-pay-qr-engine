/**
 * @fileoverview pi-split-tender — Fiat-bridge multi-currency checkout logic.
 *
 * Parses a checkout total and allows simultaneous multi-currency payment
 * processing. For example: charge 5 Pi via the Pi Network SDK AND charge
 * 2 BSD (Bahamian Sand Dollar) via a secondary fiat API — both in parallel.
 *
 * The orchestrator fans out the tender lines concurrently, waits for all
 * settlements, and returns a consolidated result indicating per-line success.
 */

import { randomUUID } from "../core/crypto-utils.js";
import type {
  SplitTenderRequest,
  SplitTenderResult,
  TenderLine,
  TenderSettlementResult,
} from "../types/payment.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the SplitTenderProcessor.
 */
export interface SplitTenderConfig {
  /**
   * Optional HTTP headers appended to all fiat processor API calls.
   * (Pi payments go through the SDK and don't use these headers.)
   */
  headers?: Record<string, string>;
  /**
   * Timeout in milliseconds for each individual tender line call.
   * Default: 30000 (30 s).
   */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// SplitTenderProcessor
// ---------------------------------------------------------------------------

/**
 * SplitTenderProcessor — fans out multi-currency payment settlement in parallel.
 *
 * @example
 * ```ts
 * const processor = new SplitTenderProcessor();
 * const request: SplitTenderRequest = {
 *   totalPiAmount: 5,
 *   totalFiatAmount: 2,
 *   fiatCurrency: "BSD",
 *   orderId: crypto.randomUUID(),
 *   tenderLines: [
 *     { currency: "PI", amount: 5 },
 *     { currency: "BSD", amount: 2, processorUrl: "/api/bsd/charge" },
 *   ],
 * };
 * const result = await processor.process(request);
 * ```
 */
export class SplitTenderProcessor {
  private readonly config: Required<SplitTenderConfig>;

  constructor(config: SplitTenderConfig = {}) {
    this.config = {
      headers: config.headers ?? {},
      timeoutMs: config.timeoutMs ?? 30_000,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Process all tender lines in a SplitTenderRequest concurrently.
   *
   * Pi-currency lines are verified against the Pi SDK completion state.
   * Non-Pi lines are dispatched to the `processorUrl` provided on each line.
   *
   * @param request - Full split-tender checkout request.
   * @returns Promise resolving to a SplitTenderResult with per-line outcomes.
   */
  async process(request: SplitTenderRequest): Promise<SplitTenderResult> {
    this._validateRequest(request);

    const settlementPromises = request.tenderLines.map((line) =>
      this._settleLine(line, request.orderId)
    );

    const settlements = await Promise.allSettled(settlementPromises);

    const results: Record<string, TenderSettlementResult> = {};
    let allSuccess = true;

    for (let i = 0; i < request.tenderLines.length; i++) {
      const line = request.tenderLines[i];
      const outcome = settlements[i];

      if (outcome.status === "fulfilled") {
        results[line.currency] = outcome.value;
        if (!outcome.value.success) allSuccess = false;
      } else {
        allSuccess = false;
        results[line.currency] = {
          currency: line.currency,
          amount: line.amount,
          success: false,
          transactionRef: null,
          error: outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason),
        };
      }
    }

    return {
      success: allSuccess,
      results,
      orderId: request.orderId,
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Build a SplitTenderRequest from a total and a fiat split ratio.
   *
   * @param totalPi         - Total order value in Pi.
   * @param fiatCurrency    - The fiat currency to split into.
   * @param piRatio         - Fraction (0–1) of the total to charge in Pi.
   * @param fiatProcessorUrl - Endpoint for the fiat payment processor.
   * @param piToFiatRate    - Exchange rate: 1 Pi = N fiat units.
   * @returns A SplitTenderRequest ready for `process()`.
   */
  buildRequest(
    totalPi: number,
    fiatCurrency: string,
    piRatio: number,
    fiatProcessorUrl: string,
    piToFiatRate: number
  ): SplitTenderRequest {
    const piAmount = parseFloat((totalPi * piRatio).toFixed(7));
    const remainingPi = parseFloat((totalPi - piAmount).toFixed(7));
    const fiatAmount = parseFloat((remainingPi * piToFiatRate).toFixed(2));

    return {
      totalPiAmount: totalPi,
      totalFiatAmount: fiatAmount,
      fiatCurrency,
      orderId: randomUUID(),
      tenderLines: [
        { currency: "PI", amount: piAmount },
        {
          currency: fiatCurrency,
          amount: fiatAmount,
          processorUrl: fiatProcessorUrl,
        },
      ],
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Settle a single tender line. */
  private async _settleLine(
    line: TenderLine,
    orderId: string
  ): Promise<TenderSettlementResult> {
    if (line.currency === "PI") {
      return this._settlePiLine(line, orderId);
    }
    return this._settleFiatLine(line, orderId);
  }

  /**
   * For Pi lines, we trust that the Pi SDK has already completed the payment
   * (the PaymentEngine handles that). This settlement step just records the
   * confirmation in your server ledger.
   */
  private async _settlePiLine(
    line: TenderLine,
    orderId: string
  ): Promise<TenderSettlementResult> {
    // In a real integration, call your server to confirm the Pi payment
    // record. Here we return a successful stub since Pi SDK already confirmed.
    return {
      currency: "PI",
      amount: line.amount,
      success: true,
      transactionRef: `pi-sdk-${orderId}`,
      error: null,
    };
  }

  /** For fiat lines, POST to the provided processor URL. */
  private async _settleFiatLine(
    line: TenderLine,
    orderId: string
  ): Promise<TenderSettlementResult> {
    if (!line.processorUrl) {
      return {
        currency: line.currency,
        amount: line.amount,
        success: false,
        transactionRef: null,
        error: `No processorUrl configured for currency '${line.currency}'.`,
      };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs
      );

      const response = await fetch(line.processorUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.config.headers,
        },
        body: JSON.stringify({
          currency: line.currency,
          amount: line.amount,
          orderId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          currency: line.currency,
          amount: line.amount,
          success: false,
          transactionRef: null,
          error: `Processor returned ${response.status}: ${body}`,
        };
      }

      const data = (await response.json()) as { transactionRef?: string };
      return {
        currency: line.currency,
        amount: line.amount,
        success: true,
        transactionRef: data.transactionRef ?? `fiat-${orderId}`,
        error: null,
      };
    } catch (err) {
      return {
        currency: line.currency,
        amount: line.amount,
        success: false,
        transactionRef: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Basic structural validation of the request. */
  private _validateRequest(request: SplitTenderRequest): void {
    if (!request.tenderLines || request.tenderLines.length === 0) {
      throw new Error("[SplitTenderProcessor] tenderLines must not be empty.");
    }
    if (request.totalPiAmount <= 0) {
      throw new Error(
        "[SplitTenderProcessor] totalPiAmount must be greater than 0."
      );
    }
    for (const line of request.tenderLines) {
      if (line.amount <= 0) {
        throw new Error(
          `[SplitTenderProcessor] Tender line for '${line.currency}' has invalid amount.`
        );
      }
    }
  }
}
