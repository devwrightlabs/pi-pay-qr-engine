/**
 * @fileoverview pi-tax-calc — Regional VAT / Sales Tax middleware.
 *
 * A middleware utility that mathematically appends the appropriate regional
 * VAT or Sales Tax to a Pi transaction payload right before QR generation.
 *
 * Supports both exclusive tax (added on top of the base price) and
 * inclusive tax (already embedded in the stated price). Ships with a
 * built-in jurisdiction table for common countries/regions, with support
 * for custom overrides.
 */

import type {
  PiPaymentDTO,
  TaxAugmentedPayload,
  TaxConfig,
} from "../types/payment.js";

// ---------------------------------------------------------------------------
// Built-in jurisdiction tax table
// ---------------------------------------------------------------------------

/** Built-in tax rates for supported jurisdictions. */
const BUILT_IN_TAX_RATES: Record<string, TaxConfig> = {
  // United States (federal has no VAT; state rates vary — 8.25% is a common example)
  US: { countryCode: "US", taxRate: 0.0825, taxLabel: "Sales Tax", inclusive: false },
  "US-TX": { countryCode: "US", regionCode: "TX", taxRate: 0.0825, taxLabel: "Sales Tax", inclusive: false },
  "US-CA": { countryCode: "US", regionCode: "CA", taxRate: 0.0725, taxLabel: "Sales Tax", inclusive: false },
  "US-NY": { countryCode: "US", regionCode: "NY", taxRate: 0.08, taxLabel: "Sales Tax", inclusive: false },
  "US-FL": { countryCode: "US", regionCode: "FL", taxRate: 0.06, taxLabel: "Sales Tax", inclusive: false },
  // UK
  GB: { countryCode: "GB", taxRate: 0.20, taxLabel: "VAT", inclusive: false },
  // EU members (20% average as fallback; override per country as needed)
  DE: { countryCode: "DE", taxRate: 0.19, taxLabel: "MwSt.", inclusive: false },
  FR: { countryCode: "FR", taxRate: 0.20, taxLabel: "TVA", inclusive: false },
  IT: { countryCode: "IT", taxRate: 0.22, taxLabel: "IVA", inclusive: false },
  ES: { countryCode: "ES", taxRate: 0.21, taxLabel: "IVA", inclusive: false },
  NL: { countryCode: "NL", taxRate: 0.21, taxLabel: "BTW", inclusive: false },
  // Bahamas (VAT 10%)
  BS: { countryCode: "BS", taxRate: 0.10, taxLabel: "VAT", inclusive: false },
  // Canada (GST 5%)
  CA: { countryCode: "CA", taxRate: 0.05, taxLabel: "GST", inclusive: false },
  "CA-ON": { countryCode: "CA", regionCode: "ON", taxRate: 0.13, taxLabel: "HST", inclusive: false },
  "CA-QC": { countryCode: "CA", regionCode: "QC", taxRate: 0.14975, taxLabel: "GST+QST", inclusive: false },
  // Australia (GST 10%)
  AU: { countryCode: "AU", taxRate: 0.10, taxLabel: "GST", inclusive: false },
  // Japan (consumption tax 10%)
  JP: { countryCode: "JP", taxRate: 0.10, taxLabel: "消費税", inclusive: false },
  // Singapore (GST 9%)
  SG: { countryCode: "SG", taxRate: 0.09, taxLabel: "GST", inclusive: false },
  // UAE (VAT 5%)
  AE: { countryCode: "AE", taxRate: 0.05, taxLabel: "VAT", inclusive: false },
  // No tax / zero-rated
  "0": { countryCode: "XX", taxRate: 0, taxLabel: "No Tax", inclusive: false },
};

// ---------------------------------------------------------------------------
// PiTaxCalculator
// ---------------------------------------------------------------------------

/**
 * PiTaxCalculator — appends regional tax to a Pi payment payload.
 *
 * @example
 * ```ts
 * const calc = new PiTaxCalculator();
 *
 * // Using a built-in jurisdiction:
 * const result = calc.apply(baseDTO, "US-TX");
 *
 * // Or with a custom TaxConfig:
 * const result = calc.apply(baseDTO, {
 *   countryCode: "MY",
 *   taxRate: 0.06,
 *   taxLabel: "SST",
 *   inclusive: false,
 * });
 * ```
 */
export class PiTaxCalculator {
  /** Custom jurisdiction overrides registered at runtime. */
  private readonly _customRates: Map<string, TaxConfig> = new Map();

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Apply tax to a base PiPaymentDTO.
   *
   * @param basePayment     - The original payment DTO before tax.
   * @param jurisdictionOrConfig - ISO 3166 country/region code (e.g. "US-TX",
   *                          "GB") or a custom TaxConfig object.
   * @returns A TaxAugmentedPayload with tax separated from the base amount.
   * @throws {Error} If the jurisdiction is unknown and no custom config provided.
   */
  apply(
    basePayment: PiPaymentDTO,
    jurisdictionOrConfig: string | TaxConfig
  ): TaxAugmentedPayload {
    const config = this._resolveConfig(jurisdictionOrConfig);
    const { taxAmount, totalAmount } = this._computeAmounts(
      basePayment.amount,
      config
    );

    return {
      basePayment,
      taxAmount,
      totalAmount,
      taxConfig: config,
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * Build the final PiPaymentDTO with tax baked into the amount and memo.
   *
   * Use this when you want a single DTO that includes tax for passing to
   * `PaymentEngine.initiatePayment()`.
   *
   * @param basePayment     - The original payment DTO.
   * @param jurisdictionOrConfig - Jurisdiction key or custom TaxConfig.
   * @returns A PiPaymentDTO with the tax-inclusive total amount.
   */
  buildTaxInclusiveDTO(
    basePayment: PiPaymentDTO,
    jurisdictionOrConfig: string | TaxConfig
  ): PiPaymentDTO {
    const augmented = this.apply(basePayment, jurisdictionOrConfig);
    const { taxConfig, taxAmount, totalAmount } = augmented;

    return {
      amount: totalAmount,
      memo: `${basePayment.memo} (incl. ${taxConfig.taxLabel} ${(taxConfig.taxRate * 100).toFixed(2)}%)`,
      metadata: {
        ...basePayment.metadata,
        baseAmount: basePayment.amount,
        taxAmount,
        taxLabel: taxConfig.taxLabel,
        taxRate: taxConfig.taxRate,
        totalAmount,
      },
    };
  }

  /**
   * Register a custom jurisdiction tax rate at runtime.
   *
   * @param key    - Lookup key (e.g. "MY", "PH", "GH").
   * @param config - TaxConfig for this jurisdiction.
   */
  registerJurisdiction(key: string, config: TaxConfig): void {
    this._customRates.set(key.toUpperCase(), config);
  }

  /**
   * List all registered jurisdiction keys (built-in + custom).
   *
   * @returns Array of jurisdiction keys.
   */
  listJurisdictions(): string[] {
    return [
      ...Object.keys(BUILT_IN_TAX_RATES),
      ...Array.from(this._customRates.keys()),
    ];
  }

  /**
   * Look up a TaxConfig by jurisdiction key without applying it.
   *
   * @param key - Jurisdiction key (e.g. "GB", "US-CA").
   * @returns TaxConfig or undefined if not found.
   */
  lookupJurisdiction(key: string): TaxConfig | undefined {
    const upper = key.toUpperCase();
    return this._customRates.get(upper) ?? BUILT_IN_TAX_RATES[upper];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve a jurisdiction key or a raw TaxConfig into a TaxConfig.
   */
  private _resolveConfig(
    jurisdictionOrConfig: string | TaxConfig
  ): TaxConfig {
    if (typeof jurisdictionOrConfig === "object") {
      return jurisdictionOrConfig;
    }

    const key = jurisdictionOrConfig.toUpperCase();
    const config =
      this._customRates.get(key) ?? BUILT_IN_TAX_RATES[key];

    if (!config) {
      throw new Error(
        `[PiTaxCalculator] Unknown jurisdiction '${jurisdictionOrConfig}'. ` +
          `Use registerJurisdiction() to add it, or pass a TaxConfig object directly.`
      );
    }

    return config;
  }

  /**
   * Compute the tax and total amounts from a base price and TaxConfig.
   */
  private _computeAmounts(
    baseAmount: number,
    config: TaxConfig
  ): { taxAmount: number; totalAmount: number } {
    let taxAmount: number;
    let totalAmount: number;

    if (config.inclusive) {
      // Tax is already included in baseAmount.
      taxAmount = parseFloat(
        (baseAmount - baseAmount / (1 + config.taxRate)).toFixed(7)
      );
      totalAmount = baseAmount;
    } else {
      // Tax is added on top.
      taxAmount = parseFloat((baseAmount * config.taxRate).toFixed(7));
      totalAmount = parseFloat((baseAmount + taxAmount).toFixed(7));
    }

    return { taxAmount, totalAmount };
  }
}
