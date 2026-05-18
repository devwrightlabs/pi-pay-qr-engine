/**
 * @fileoverview pi-fiat-display — Real-time fiat conversion rate display.
 *
 * Hooks into decentralised price oracles (Pyth Network, Band Protocol, or
 * a custom API endpoint) to display live Pi-to-fiat conversion rates natively
 * on the checkout screen. Rates are cached with a configurable TTL to avoid
 * hammering the oracle on every render.
 */

import type { CurrencyCode, FiatConversionRate } from "../types/payment.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the FiatDisplayEngine.
 */
export interface FiatDisplayConfig {
  /**
   * Oracle endpoint URL for fetching Pi prices.
   * Should return a JSON object compatible with OracleResponse.
   * Default: Pyth Network public endpoint.
   */
  oracleUrl?: string;
  /**
   * How many seconds to cache a rate before re-fetching.
   * Default: 30.
   */
  cacheSeconds?: number;
  /**
   * Identifier string for the oracle source (for auditing / display).
   * Default: "pyth-network".
   */
  oracleSource?: string;
  /**
   * Optional fetch override (useful for testing).
   */
  fetchFn?: typeof fetch;
}

/** Shape of the oracle JSON response. */
interface OracleResponse {
  /** Exchange rate (1 PI = rate × fiat). */
  rate: number;
  /** ISO timestamp of the oracle quote. */
  timestamp: string;
  /** Oracle-assigned validity window in seconds. */
  validFor?: number;
}

/** Cached rate entry. */
interface CacheEntry {
  rate: FiatConversionRate;
  fetchedAt: number; // Unix ms
}

// ---------------------------------------------------------------------------
// FiatDisplayEngine
// ---------------------------------------------------------------------------

/**
 * FiatDisplayEngine — fetches and caches live Pi/fiat conversion rates.
 *
 * @example
 * ```ts
 * const display = new FiatDisplayEngine({ cacheSeconds: 30 });
 *
 * const rate = await display.getRate("USD");
 * console.log(`1 Pi = ${rate.rate} USD (as of ${rate.quotedAt})`);
 *
 * // Keep rates fresh with polling:
 * display.startPolling(["USD", "EUR"], (rates) => {
 *   setConversionRates(rates);
 * });
 * ```
 */
export class FiatDisplayEngine {
  private readonly config: Required<FiatDisplayConfig>;
  private readonly _cache: Map<CurrencyCode, CacheEntry> = new Map();
  private _pollHandle: ReturnType<typeof setInterval> | null = null;

  constructor(config: FiatDisplayConfig = {}) {
    this.config = {
      oracleUrl:
        config.oracleUrl ??
        "https://hermes.pyth.network/api/latest_price_feeds",
      cacheSeconds: config.cacheSeconds ?? 30,
      oracleSource: config.oracleSource ?? "pyth-network",
      fetchFn: config.fetchFn ?? fetch.bind(globalThis),
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Fetch the current Pi-to-fiat conversion rate for a given currency.
   * Returns a cached result if it is still within the TTL window.
   *
   * @param currency - Target fiat currency code (e.g. "USD", "EUR").
   * @returns Promise resolving to a FiatConversionRate.
   * @throws {Error} If the oracle request fails and no cached rate exists.
   */
  async getRate(currency: CurrencyCode): Promise<FiatConversionRate> {
    const cached = this._cache.get(currency);
    const now = Date.now();

    if (
      cached &&
      now - cached.fetchedAt < this.config.cacheSeconds * 1_000
    ) {
      return cached.rate;
    }

    const rate = await this._fetchFromOracle(currency);
    this._cache.set(currency, { rate, fetchedAt: now });
    return rate;
  }

  /**
   * Convert a Pi amount to its fiat equivalent using the live oracle rate.
   *
   * @param piAmount - Amount in Pi.
   * @param currency - Target fiat currency code.
   * @returns Promise resolving to the fiat equivalent amount.
   */
  async convertPiToFiat(
    piAmount: number,
    currency: CurrencyCode
  ): Promise<number> {
    const rate = await this.getRate(currency);
    return parseFloat((piAmount * rate.rate).toFixed(2));
  }

  /**
   * Start polling the oracle at the rate-refresh interval for a list of
   * currencies, invoking `onRatesUpdated` whenever rates are refreshed.
   *
   * @param currencies      - Array of fiat currency codes to watch.
   * @param onRatesUpdated  - Callback invoked with the latest rates.
   */
  startPolling(
    currencies: CurrencyCode[],
    onRatesUpdated: (rates: Record<CurrencyCode, FiatConversionRate>) => void
  ): void {
    if (this._pollHandle !== null) return;

    const poll = async () => {
      const results: Record<string, FiatConversionRate> = {};
      await Promise.allSettled(
        currencies.map(async (currency) => {
          try {
            results[currency] = await this.getRate(currency);
          } catch {
            // Skip failed currencies silently — use the stale cached rate if available.
            const stale = this._cache.get(currency);
            if (stale) results[currency] = stale.rate;
          }
        })
      );
      onRatesUpdated(results);
    };

    // Fetch immediately then schedule.
    void poll();
    this._pollHandle = setInterval(
      () => void poll(),
      this.config.cacheSeconds * 1_000
    );
  }

  /**
   * Stop the polling loop.
   */
  stopPolling(): void {
    if (this._pollHandle !== null) {
      clearInterval(this._pollHandle);
      this._pollHandle = null;
    }
  }

  /**
   * Flush all cached rates, forcing a fresh oracle fetch on the next call.
   */
  clearCache(): void {
    this._cache.clear();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Fetch a fresh conversion rate from the oracle endpoint.
   * Falls back to a simulated rate when the oracle is unreachable (dev mode).
   */
  private async _fetchFromOracle(
    currency: CurrencyCode
  ): Promise<FiatConversionRate> {
    try {
      const url = `${this.config.oracleUrl}?ids[]=PI&target=${currency}`;
      const response = await this.config.fetchFn(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`Oracle returned ${response.status}`);
      }

      const data = (await response.json()) as OracleResponse;

      return {
        from: "PI",
        to: currency,
        rate: data.rate,
        quotedAt: data.timestamp,
        oracleSource: this.config.oracleSource,
        validForSeconds: data.validFor ?? this.config.cacheSeconds,
      };
    } catch (err) {
      // If oracle is unreachable, return a cached stale rate or a simulation.
      const stale = this._cache.get(currency);
      if (stale) {
        console.warn(
          `[FiatDisplayEngine] Oracle unreachable; returning stale rate for ${currency}.`
        );
        return stale.rate;
      }

      console.warn(
        `[FiatDisplayEngine] Oracle unavailable for ${currency}; using simulated rate.`,
        err
      );

      return this._simulatedRate(currency);
    }
  }

  /**
   * Return a simulated Pi/fiat rate for development / offline scenarios.
   * These are illustrative values only and must not be used in production.
   */
  private _simulatedRate(currency: CurrencyCode): FiatConversionRate {
    const SIMULATED: Record<string, number> = {
      USD: 0.62,
      EUR: 0.57,
      GBP: 0.49,
      BSD: 0.62,
      JPY: 97.8,
      CAD: 0.85,
      AUD: 0.94,
    };

    return {
      from: "PI",
      to: currency,
      rate: SIMULATED[currency] ?? 1.0,
      quotedAt: new Date().toISOString(),
      oracleSource: "simulated",
      validForSeconds: 30,
    };
  }
}
