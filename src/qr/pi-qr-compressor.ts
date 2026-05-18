/**
 * @fileoverview pi-qr-compressor — QR payload optimisation utility.
 *
 * Auto-optimises the data density and error-correction level of a QR payload
 * so it scans instantly on cracked screens, budget camera lenses, or in
 * low-light conditions.
 *
 * Strategy:
 *  1. Serialise the payload and measure raw byte length.
 *  2. Apply JSON minification and field-aliasing to reduce character count.
 *  3. Select the lowest QR version (1–40) that can encode the data.
 *  4. Downgrade error-correction level from H→Q→M→L until the payload fits
 *     in a lower QR version, unless the caller forces a minimum level.
 *  5. Return the recommended options alongside the optimised data string.
 */

import type {
  CompressedQROptions,
  QRErrorCorrectionLevel,
  QRPayload,
} from "../types/payment.js";

// ---------------------------------------------------------------------------
// QR version capacity table (byte mode)
// Bytes that can be encoded per QR version at each error-correction level.
// Source: ISO/IEC 18004:2015 Table 7.
// ---------------------------------------------------------------------------

type ECLevel = QRErrorCorrectionLevel;

/** Maximum data bytes for each QR version (index 0 = version 1) at L / M / Q / H. */
const QR_CAPACITY: Record<ECLevel, number[]> = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858, 929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953],
  M: [14, 26, 42, 62, 84, 106, 122, 154, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482, 509, 565, 611, 661, 715, 751, 805, 868, 908, 982, 1030, 1112, 1168, 1228, 1283, 1351, 1423, 1499, 1579, 1663],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220, 250, 280, 310, 338, 382, 403, 439, 461, 511, 535, 593, 625, 658, 698, 742, 790, 842, 898, 958, 983, 1051, 1093, 1139, 1219, 1273],
};

const EC_LEVELS_DESC: ECLevel[] = ["H", "Q", "M", "L"];

// ---------------------------------------------------------------------------
// Field aliasing map
// Reduce payload byte length by shortening common field names.
// ---------------------------------------------------------------------------

type AliasMap = Record<string, string>;

const FIELD_ALIAS: AliasMap = {
  sessionId: "si",
  amount: "a",
  walletAddress: "w",
  memo: "m",
  createdAt: "c",
  expiresAt: "e",
  metadata: "d",
  orderId: "o",
  note: "n",
};

// ---------------------------------------------------------------------------
// PiQRCompressor
// ---------------------------------------------------------------------------

/**
 * PiQRCompressor — automatically optimises QR payloads for maximum scan speed.
 *
 * @example
 * ```ts
 * const compressor = new PiQRCompressor();
 * const options = compressor.compress(qrPayload);
 * // Pass options.encodedData to QRCode.toDataURL with options.errorCorrectionLevel
 * ```
 */
export class PiQRCompressor {
  /**
   * Whether to apply field aliasing to reduce payload size.
   * Disable if your scanner cannot decode aliased payloads.
   * Default: true.
   */
  private readonly useAliasing: boolean;

  /**
   * Minimum error-correction level to allow. The compressor will not go below
   * this level even if a lower version QR could be used.
   * Default: "M" (recommended for cracked screens).
   */
  private readonly minECLevel: ECLevel;

  constructor(
    options: { useAliasing?: boolean; minECLevel?: ECLevel } = {}
  ) {
    this.useAliasing = options.useAliasing ?? true;
    this.minECLevel = options.minECLevel ?? "M";
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Compress a QR payload and return recommended encoding options.
   *
   * @param payload - The payment QR payload to optimise.
   * @returns CompressedQROptions with the recommended EC level, QR version,
   *          and final data string.
   */
  compress(payload: QRPayload): CompressedQROptions {
    // Step 1: Serialise the payload.
    const rawData = JSON.stringify(payload);
    const originalByteLength = new TextEncoder().encode(rawData).length;

    // Step 2: Minify + alias field names.
    const processedData = this.useAliasing
      ? this._applyAliasing(payload)
      : rawData;

    const finalByteLength = new TextEncoder().encode(processedData).length;

    // Step 3: Find the best EC level + QR version combination.
    const { version, errorCorrectionLevel } = this._selectVersion(finalByteLength);

    return {
      errorCorrectionLevel,
      version,
      compressed: this.useAliasing && finalByteLength < originalByteLength,
      encodedData: processedData,
      originalByteLength,
      finalByteLength,
    };
  }

  /**
   * Restore a full QRPayload from an aliased / compressed data string.
   *
   * @param data - The compressed data string (as returned in `encodedData`).
   * @returns Restored QRPayload.
   */
  decompress(data: string): QRPayload {
    const parsed: Record<string, unknown> = JSON.parse(data);
    const reverseAlias: AliasMap = Object.fromEntries(
      Object.entries(FIELD_ALIAS).map(([full, alias]) => [alias, full])
    );

    const restored: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const fullKey = reverseAlias[key] ?? key;
      restored[fullKey] = value;
    }

    return restored as unknown as QRPayload;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Apply field aliasing to a QRPayload and stringify the result.
   */
  private _applyAliasing(payload: QRPayload): string {
    const aliased: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(
      payload as unknown as Record<string, unknown>
    )) {
      const alias = FIELD_ALIAS[key] ?? key;
      if (value !== undefined && value !== null) {
        aliased[alias] = value;
      }
    }

    // Further minify metadata sub-object.
    if (aliased["d"] && typeof aliased["d"] === "object") {
      const meta = aliased["d"] as Record<string, unknown>;
      const metaAliased: Record<string, unknown> = {};
      for (const [mk, mv] of Object.entries(meta)) {
        metaAliased[FIELD_ALIAS[mk] ?? mk] = mv;
      }
      aliased["d"] = metaAliased;
    }

    return JSON.stringify(aliased);
  }

  /**
   * Select the lowest QR version that can hold `byteLength` data bytes
   * at the highest acceptable EC level.
   *
   * Iterates from highest EC level downward, stopping at `minECLevel`.
   * Within each level, picks the smallest version that fits.
   */
  private _selectVersion(byteLength: number): {
    version: number;
    errorCorrectionLevel: ECLevel;
  } {
    const minLevelIndex = EC_LEVELS_DESC.indexOf(this.minECLevel);

    for (let li = 0; li < EC_LEVELS_DESC.length; li++) {
      const level = EC_LEVELS_DESC[li];

      // Don't go below the caller's minimum level.
      if (li > minLevelIndex) break;

      const capacities = QR_CAPACITY[level];
      for (let vi = 0; vi < capacities.length; vi++) {
        if (capacities[vi] >= byteLength) {
          return { version: vi + 1, errorCorrectionLevel: level };
        }
      }
    }

    // Fallback: max version at lowest level.
    return { version: 40, errorCorrectionLevel: "L" };
  }
}
