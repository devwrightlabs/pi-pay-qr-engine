/**
 * @fileoverview @devright/pi-pay-qr-engine — main entry point.
 *
 * Re-exports all modules, classes, hooks, React components, and TypeScript
 * types for consumers of the library.
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  // Primitives
  CurrencyCode,
  UnixTimestamp,
  ProtocolVersion,
  Base64String,
  HexString,
  UUIDv4,
  // Payment state machine
  PaymentState,
  // Pi SDK
  PiPaymentMetadata,
  PiPaymentDTO,
  PiTransaction,
  PiPayment,
  PiPaymentStatusFlags,
  PiPaymentCallbacks,
  // Engine
  PaymentEngineConfig,
  PaymentEngineState,
  // Subscription
  SubscriptionInterval,
  SubscriptionPayload,
  SubscriptionConfig,
  // QR
  QRErrorCorrectionLevel,
  QRPayload,
  ExpiringQRPayload,
  HologramFrame,
  HologramConfig,
  CompressedQROptions,
  RefundToken,
  StealthQRPayload,
  // Checkout
  TenderLine,
  SplitTenderRequest,
  SplitTenderResult,
  TenderSettlementResult,
  MicroTabItem,
  MicroTab,
  FiatConversionRate,
  TaxConfig,
  TaxAugmentedPayload,
  TipRouteConfig,
  TipRoutedPayload,
  OfflineSignedTransaction,
  AirdropResult,
  // React
  CheckoutContextValue,
  QrCheckoutProviderProps,
  DynamicQRCodeProps,
} from "./types/payment.js";

// ---------------------------------------------------------------------------
// Core — Payment Engine
// ---------------------------------------------------------------------------

export { PaymentEngine } from "./core/PaymentEngine.js";

// ---------------------------------------------------------------------------
// Core — Subscription Engine
// ---------------------------------------------------------------------------

export { SubscriptionEngine } from "./core/SubscriptionEngine.js";

// ---------------------------------------------------------------------------
// Core — Payment Recovery
// ---------------------------------------------------------------------------

export { PaymentRecovery } from "./core/pi-payment-recovery.js";
export type {
  RecoverySuccessCallback,
  RecoveryErrorCallback,
  PaymentRecoveryConfig,
} from "./core/pi-payment-recovery.js";

// ---------------------------------------------------------------------------
// Core — Crypto utilities (internal, exported for advanced consumers)
// ---------------------------------------------------------------------------

export { randomUUID, randomHex, hmacSHA256, toBase64, fromBase64 } from "./core/crypto-utils.js";

// ---------------------------------------------------------------------------
// QR — Dynamic Hologram
// ---------------------------------------------------------------------------

export {
  PiDynamicHologram,
  generateStaticQR,
} from "./qr/pi-dynamic-hologram.js";

// ---------------------------------------------------------------------------
// QR — Compressor
// ---------------------------------------------------------------------------

export { PiQRCompressor } from "./qr/pi-qr-compressor.js";

// ---------------------------------------------------------------------------
// QR — Refund Token
// ---------------------------------------------------------------------------

export { PiRefundToken } from "./qr/pi-refund-token.js";
export type { RefundTokenInput } from "./qr/pi-refund-token.js";

// ---------------------------------------------------------------------------
// QR — Stealth QR
// ---------------------------------------------------------------------------

export { PiStealthQR } from "./qr/pi-stealth-qr.js";
export type { StealthQRInput, StealthQRBundle } from "./qr/pi-stealth-qr.js";

// ---------------------------------------------------------------------------
// QR — Expiry
// ---------------------------------------------------------------------------

export {
  PiQRExpiry,
  wrapWithExpiry,
  validateExpiry,
} from "./qr/pi-qr-expiry.js";

// ---------------------------------------------------------------------------
// Checkout — Split Tender
// ---------------------------------------------------------------------------

export { SplitTenderProcessor } from "./checkout/pi-split-tender.js";
export type { SplitTenderConfig } from "./checkout/pi-split-tender.js";

// ---------------------------------------------------------------------------
// Checkout — Micro Tab
// ---------------------------------------------------------------------------

export { MicroTabManager } from "./checkout/pi-micro-tab.js";
export type { MicroTabConfig } from "./checkout/pi-micro-tab.js";

// ---------------------------------------------------------------------------
// Checkout — Fiat Display
// ---------------------------------------------------------------------------

export { FiatDisplayEngine } from "./checkout/pi-fiat-display.js";
export type { FiatDisplayConfig } from "./checkout/pi-fiat-display.js";

// ---------------------------------------------------------------------------
// Checkout — Tax Calculator
// ---------------------------------------------------------------------------

export { PiTaxCalculator } from "./checkout/pi-tax-calc.js";

// ---------------------------------------------------------------------------
// Checkout — Tip Router
// ---------------------------------------------------------------------------

export { PiTipRouter } from "./checkout/pi-tip-router.js";

// ---------------------------------------------------------------------------
// Checkout — Invoice Airdrop
// ---------------------------------------------------------------------------

export { PiInvoiceAirdrop } from "./checkout/pi-invoice-airdrop.js";

// ---------------------------------------------------------------------------
// Checkout — Offline Checkout
// ---------------------------------------------------------------------------

export { PiOfflineCheckout } from "./checkout/pi-offline-checkout.js";
export type {
  OfflineKeyPair,
  OfflineCheckoutConfig,
} from "./checkout/pi-offline-checkout.js";

// ---------------------------------------------------------------------------
// React — Provider, Hooks, and Components
// ---------------------------------------------------------------------------

export {
  QrCheckoutProvider,
  useCheckoutContext,
  CheckoutContext,
} from "./react/QrCheckoutProvider.js";

export { useCheckout } from "./react/useCheckout.js";
export type { UseCheckoutReturn } from "./react/useCheckout.js";

export { DynamicQRCode } from "./react/DynamicQRCode.js";
