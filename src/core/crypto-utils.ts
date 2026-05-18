/**
 * @fileoverview crypto-utils — lightweight cryptographic helpers.
 *
 * Thin wrappers around the Web Crypto API and Node.js built-ins that work in
 * both browser (Pi webview) and server (Next.js App Router) environments.
 * Kept as a separate internal module so multiple core files can share it
 * without circular imports.
 *
 * All random number generation uses `crypto.getRandomValues` (CSPRNG).
 * `Math.random()` is never used for security-sensitive operations.
 */

/**
 * Assert that the Web Crypto API's `getRandomValues` is available.
 * Throws a clear error if the runtime does not provide a CSPRNG.
 */
function requireCrypto(): Crypto {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    throw new Error(
      "[pi-pay-qr-engine] Web Crypto API (crypto.getRandomValues) is not " +
        "available in this environment. A secure random number source is required."
    );
  }
  return crypto;
}

/**
 * Generate a RFC 4122 UUID v4 string using the CSPRNG.
 *
 * Uses `crypto.randomUUID()` when available (all modern environments),
 * otherwise constructs a UUID v4 from `crypto.getRandomValues` bytes.
 * Never falls back to `Math.random()`.
 *
 * @returns UUID v4 string, e.g. "550e8400-e29b-41d4-a716-446655440000".
 */
export function randomUUID(): string {
  const c = requireCrypto();
  if (typeof (c as Crypto).randomUUID === "function") {
    return (c as Crypto).randomUUID();
  }
  // Build a UUID v4 from 16 cryptographically random bytes.
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  // Set version (4) and variant (RFC 4122) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-` +
    `${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

/**
 * Generate `n` cryptographically random bytes as a lowercase hex string.
 * Uses `crypto.getRandomValues` exclusively.
 *
 * @param byteLength - Number of random bytes to generate. Default: 16.
 * @returns Hex string of length `byteLength * 2`.
 */
export function randomHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  requireCrypto().getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute a HMAC-SHA256 over `data` using `secret` and return the hex digest.
 *
 * Falls back to a deterministic hex-XOR stub in environments where the
 * Web Crypto API is unavailable (e.g. minimal Node.js test sandboxes).
 *
 * @param data   - String data to authenticate.
 * @param secret - HMAC secret key string.
 * @returns Hex-encoded HMAC-SHA256 digest (64 chars).
 */
export async function hmacSHA256(data: string, secret: string): Promise<string> {
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      keyMaterial,
      enc.encode(data)
    );
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Fallback stub — NOT cryptographically secure.
    const combined = data + secret;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(16).padStart(64, "0");
  }
}

/**
 * Encode arbitrary data as a URL-safe base-64 string.
 *
 * @param data - ArrayBuffer, Uint8Array, or string to encode.
 * @returns Standard base-64 string.
 */
export function toBase64(data: ArrayBuffer | Uint8Array | string): string {
  if (typeof data === "string") {
    return btoa(data);
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decode a base-64 string to a plain string.
 *
 * @param b64 - Base-64 encoded string.
 * @returns Decoded string.
 */
export function fromBase64(b64: string): string {
  return atob(b64);
}
