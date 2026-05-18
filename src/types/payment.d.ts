/**
 * @fileoverview Exhaustive TypeScript interfaces for @devright/pi-pay-qr-engine.
 *
 * Covers all Pi Network payment payloads, DTOs, and transaction states.
 * Zero `any` types — all structures are fully typed.
 */

// ---------------------------------------------------------------------------
// Primitive / shared
// ---------------------------------------------------------------------------

/** ISO 4217 currency code, extended with Pi-native tokens. */
export type CurrencyCode =
  | "PI"
  | "USD"
  | "EUR"
  | "GBP"
  | "BSD" // Bahamian Sand Dollar
  | "JPY"
  | "CAD"
  | "AUD"
  | string;

/** Unix epoch timestamp (seconds). */
export type UnixTimestamp = number;

/** Semver-style protocol version string, e.g. "v23". */
export type ProtocolVersion = string;

/** Base-64 encoded string. */
export type Base64String = string;

/** Hex-encoded SHA-256 or ECDSA signature string. */
export type HexString = string;

/** RFC 4122 UUID v4 string. */
export type UUIDv4 = string;

// ---------------------------------------------------------------------------
// Payment state machine
// ---------------------------------------------------------------------------

/**
 * Discrete states of the Pi payment lifecycle state machine.
 *
 * IDLE            – No active payment.
 * CREATING        – Payment DTO is being assembled and dispatched to Pi SDK.
 * PENDING_APPROVAL– Awaiting the user's in-app Pi wallet approval.
 * APPROVED        – User approved; server-side approval confirmed.
 * COMPLETING      – Server-side completion call in-flight.
 * COMPLETED       – Blockchain confirmation received; funds transferred.
 * CANCELLED       – User cancelled or timeout.
 * FAILED          – Unrecoverable error during payment lifecycle.
 * RECOVERING      – Payment recovery poller is actively attempting resolution.
 */
export type PaymentState =
  | "IDLE"
  | "CREATING"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "COMPLETING"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED"
  | "RECOVERING";

// ---------------------------------------------------------------------------
// Pi Network SDK types
// ---------------------------------------------------------------------------

/**
 * Metadata attached to a Pi payment – free-form developer data that is
 * persisted alongside the transaction on the Pi platform.
 */
export interface PiPaymentMetadata {
  /** Human-readable note displayed to the payer. */
  note?: string;
  /** Developer-defined order / invoice reference. */
  orderId?: string;
  /** Additional structured key-value pairs. */
  [key: string]: string | number | boolean | undefined;
}

/**
 * Core payment creation DTO sent to the Pi Network SDK.
 * Mirrors the Pi Browser SDK `PaymentData` shape.
 */
export interface PiPaymentDTO {
  /** Amount in Pi coin (up to 7 decimal places). */
  amount: number;
  /** Human-readable memo string shown in Pi wallet (max 255 chars). */
  memo: string;
  /** Developer metadata persisted with the transaction. */
  metadata: PiPaymentMetadata;
}

/**
 * Canonical transaction record returned by the Pi Network after approval.
 */
export interface PiTransaction {
  /** Pi-platform unique transaction identifier. */
  txid: string;
  /** Whether the transaction was verified on the blockchain ledger. */
  verified: boolean;
  /** Raw blockchain payload returned by Pi platform (opaque to developers). */
  _raw: Record<string, unknown>;
}

/**
 * Full payment object returned by the Pi Network SDK callbacks.
 */
export interface PiPayment {
  /** Pi-platform payment identifier. */
  identifier: string;
  /** The Pi user ID of the payer. */
  user_uid: string;
  /** Pi amount transferred. */
  amount: number;
  /** Memo string. */
  memo: string;
  /** Developer metadata. */
  metadata: PiPaymentMetadata;
  /** ISO timestamp when the payment was created. */
  created_at: string;
  /** Payment status flags. */
  status: PiPaymentStatusFlags;
  /** Linked blockchain transaction (present after completion). */
  transaction: PiTransaction | null;
  /** Network the payment was processed on. */
  network: "Pi Network" | "Pi Testnet";
}

/**
 * Payment status flag object returned as part of PiPayment.
 */
export interface PiPaymentStatusFlags {
  /** Payment intent has been created on the Pi platform. */
  developer_approved: boolean;
  /** Blockchain transaction has been submitted by the Pi platform. */
  transaction_verified: boolean;
  /** Developer back-end has confirmed completion. */
  developer_completed: boolean;
  /** Payment was cancelled. */
  cancelled: boolean;
  /** User has approved the payment from the wallet UI. */
  user_cancelled: boolean;
}

/**
 * Callbacks provided to the Pi SDK `createPayment` call.
 */
export interface PiPaymentCallbacks {
  /**
   * Invoked after the user approves the payment in the wallet UI.
   * Must call your server's `/approve` endpoint.
   */
  onReadyForServerApproval: (paymentId: string) => void;
  /**
   * Invoked after the Pi network submits the on-chain transaction.
   * Must call your server's `/complete` endpoint.
   */
  onReadyForServerCompletion: (paymentId: string, txid: string) => void;
  /** Invoked if the payment is cancelled by the user or times out. */
  onCancel: (paymentId: string) => void;
  /** Invoked if an unrecoverable SDK error occurs. */
  onError: (error: Error, payment: PiPayment | null) => void;
}

// ---------------------------------------------------------------------------
// Payment Engine
// ---------------------------------------------------------------------------

/**
 * Configuration object for initialising the PaymentEngine.
 */
export interface PaymentEngineConfig {
  /** Your server-side approval endpoint URL. */
  approvalUrl: string;
  /** Your server-side completion endpoint URL. */
  completionUrl: string;
  /** Maximum retry attempts before marking a transaction FAILED. Default: 3. */
  maxRetries?: number;
  /** Delay in milliseconds between retries. Default: 2000. */
  retryDelayMs?: number;
  /** Optional additional HTTP headers sent to your backend endpoints. */
  headers?: Record<string, string>;
}

/**
 * Snapshot of the payment engine's current state.
 */
export interface PaymentEngineState {
  /** Current state machine state. */
  state: PaymentState;
  /** Active payment object (null when IDLE). */
  payment: PiPayment | null;
  /** Number of retry attempts for the current operation. */
  retryCount: number;
  /** ISO timestamp when the payment was last updated. */
  lastUpdatedAt: string | null;
  /** Human-readable error description (set when state is FAILED). */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Subscription Engine
// ---------------------------------------------------------------------------

/**
 * Subscription interval definition.
 */
export type SubscriptionInterval = "daily" | "weekly" | "monthly" | "yearly";

/**
 * A recurring payment payload that can be scheduled via Protocol v23 WASM.
 */
export interface SubscriptionPayload {
  /** Unique subscription plan identifier. */
  planId: UUIDv4;
  /** Display name of the plan (e.g. "Premium Monthly"). */
  planName: string;
  /** Amount charged per interval in Pi. */
  amount: number;
  /** Billing interval. */
  interval: SubscriptionInterval;
  /** ISO date when the subscription becomes active. */
  startDate: string;
  /** ISO date when the subscription expires (null = indefinite). */
  endDate: string | null;
  /** Originating payment identifier from the first approval. */
  originPaymentId: string;
  /** Merchant wallet address that receives the recurring charge. */
  merchantWallet: string;
  /** WASM-encoded recurring authorisation token. */
  wasmAuthorisationToken: Base64String;
  /** Protocol version this payload targets. */
  protocolVersion: ProtocolVersion;
}

/**
 * Configuration for creating a new subscription via SubscriptionEngine.
 */
export interface SubscriptionConfig {
  /** Human-readable plan name. */
  planName: string;
  /** Amount per billing cycle (Pi). */
  amount: number;
  /** Billing interval. */
  interval: SubscriptionInterval;
  /** Merchant wallet address. */
  merchantWallet: string;
  /** Optional ISO end date. */
  endDate?: string;
}

// ---------------------------------------------------------------------------
// QR Engine types
// ---------------------------------------------------------------------------

/**
 * Supported QR error-correction levels.
 * L = ~7%, M = ~15%, Q = ~25%, H = ~30% data recovery.
 */
export type QRErrorCorrectionLevel = "L" | "M" | "Q" | "H";

/**
 * Raw QR payload encapsulating a Pi payment intent.
 */
export interface QRPayload {
  /** Unique identifier for this QR session. */
  sessionId: UUIDv4;
  /** Pi amount encoded in this QR. */
  amount: number;
  /** Recipient Pi wallet address. */
  walletAddress: string;
  /** Short memo visible after scan. */
  memo: string;
  /** Unix timestamp when the QR was generated. */
  createdAt: UnixTimestamp;
  /** Unix timestamp after which this QR is invalid (null = no expiry). */
  expiresAt: UnixTimestamp | null;
  /** Additional structured metadata. */
  metadata: PiPaymentMetadata;
}

/**
 * An expiry-wrapped QR payload with a strict TTL.
 */
export interface ExpiringQRPayload {
  /** Inner payment QR payload. */
  payload: QRPayload;
  /** Unix timestamp of QR creation. */
  issuedAt: UnixTimestamp;
  /** Unix timestamp after which the payload MUST be rejected. */
  expiresAt: UnixTimestamp;
  /** TTL in seconds. */
  ttlSeconds: number;
  /** HMAC-SHA256 integrity token for replay-attack prevention. */
  integrityToken: HexString;
}

/**
 * A holographic QR frame used in the dynamic rotation loop.
 */
export interface HologramFrame {
  /** Frame sequence number (0-indexed). */
  frameIndex: number;
  /** Base-64 PNG data URL of the rendered QR image. */
  dataUrl: Base64String;
  /** Cryptographic nonce for this frame. */
  nonce: HexString;
  /** Unix ms timestamp when this frame was rendered. */
  renderedAt: number;
}

/**
 * Configuration for the dynamic hologram rotator.
 */
export interface HologramConfig {
  /** How frequently (ms) the QR frame rotates. Default: 3000. */
  rotationIntervalMs?: number;
  /** Canvas width in pixels. Default: 300. */
  width?: number;
  /** Canvas height in pixels. Default: 300. */
  height?: number;
  /** Background colour (CSS hex). Default: "#0A0A0F". */
  backgroundColor?: string;
  /** Foreground / pixel colour (CSS hex). Default: "#F0C040". */
  foregroundColor?: string;
}

/**
 * Compressed QR options output by the auto-optimiser.
 */
export interface CompressedQROptions {
  /** Recommended error-correction level for the given payload size. */
  errorCorrectionLevel: QRErrorCorrectionLevel;
  /** Recommended QR version (1–40). */
  version: number;
  /** Whether the payload was compressed before encoding. */
  compressed: boolean;
  /** Final data string to encode into the QR. */
  encodedData: string;
  /** Original payload byte length. */
  originalByteLength: number;
  /** Final encoded payload byte length. */
  finalByteLength: number;
}

/**
 * A refund token representing a reverse-QR digital receipt.
 */
export interface RefundToken {
  /** Unique refund token ID. */
  tokenId: UUIDv4;
  /** The original payment identifier being refunded. */
  originalPaymentId: string;
  /** Refund amount in Pi. */
  refundAmount: number;
  /** Merchant wallet address initiating the refund. */
  merchantWallet: string;
  /** Customer wallet to receive the refund. */
  customerWallet: string;
  /** ISO timestamp of refund token creation. */
  issuedAt: string;
  /** ECDSA signature over tokenId + amounts + wallets. */
  signature: HexString;
  /** Base-64 QR data URL for display. */
  qrDataUrl: Base64String;
}

/**
 * A stealth QR payload where the amount is hidden until biometric auth.
 */
export interface StealthQRPayload {
  /** Session ID for this stealth QR. */
  sessionId: UUIDv4;
  /** Recipient wallet address (always visible). */
  walletAddress: string;
  /** AES-GCM encrypted amount blob (hidden until biometric unlock). */
  encryptedAmount: Base64String;
  /** IV used during AES-GCM encryption. */
  iv: Base64String;
  /** Publicly visible memo (does not reveal amount). */
  publicMemo: string;
  /** Unix timestamp of creation. */
  createdAt: UnixTimestamp;
  /** Biometric challenge nonce. */
  biometricChallenge: HexString;
}

// ---------------------------------------------------------------------------
// Checkout types
// ---------------------------------------------------------------------------

/**
 * A single tender line representing one currency split.
 */
export interface TenderLine {
  /** Currency code for this split. */
  currency: CurrencyCode;
  /** Amount to be charged in this currency. */
  amount: number;
  /** Optional API endpoint for non-Pi currency processing. */
  processorUrl?: string;
}

/**
 * A split-tender checkout request combining Pi and one fiat currency.
 */
export interface SplitTenderRequest {
  /** Total checkout amount in Pi. */
  totalPiAmount: number;
  /** Total checkout amount in fiat equivalent (for display). */
  totalFiatAmount: number;
  /** Fiat currency code. */
  fiatCurrency: CurrencyCode;
  /** Array of individual tender lines to process simultaneously. */
  tenderLines: TenderLine[];
  /** Order reference. */
  orderId: UUIDv4;
}

/**
 * Result of a split-tender checkout operation.
 */
export interface SplitTenderResult {
  /** Whether ALL tender lines settled successfully. */
  success: boolean;
  /** Settled tender results keyed by currency code. */
  results: Record<CurrencyCode, TenderSettlementResult>;
  /** Master order ID. */
  orderId: UUIDv4;
  /** ISO timestamp of completion. */
  completedAt: string;
}

/** Individual tender settlement result. */
export interface TenderSettlementResult {
  /** Currency processed. */
  currency: CurrencyCode;
  /** Amount settled. */
  amount: number;
  /** Whether this line settled. */
  success: boolean;
  /** Platform-specific transaction reference. */
  transactionRef: string | null;
  /** Error message if settlement failed. */
  error: string | null;
}

/**
 * A single micro-tab item (e.g. one drink order).
 */
export interface MicroTabItem {
  /** Unique line-item identifier. */
  itemId: UUIDv4;
  /** Display name of the item. */
  name: string;
  /** Per-unit price in Pi. */
  unitPrice: number;
  /** Quantity ordered. */
  quantity: number;
  /** Optional item-level metadata. */
  metadata?: Record<string, string>;
}

/**
 * A master micro-tab aggregating many small items for one final checkout.
 */
export interface MicroTab {
  /** Unique tab identifier. */
  tabId: UUIDv4;
  /** Customer identifier (wallet or display name). */
  customerId: string;
  /** Ordered list of line items. */
  items: MicroTabItem[];
  /** Computed total in Pi (sum of quantity × unitPrice). */
  totalAmount: number;
  /** ISO timestamp when the tab was opened. */
  openedAt: string;
  /** ISO timestamp when the tab was closed (null = still open). */
  closedAt: string | null;
  /** Whether the tab has been paid. */
  paid: boolean;
}

/**
 * Real-time fiat conversion rate fetched from a decentralized oracle.
 */
export interface FiatConversionRate {
  /** Source currency (typically "PI"). */
  from: CurrencyCode;
  /** Target fiat currency. */
  to: CurrencyCode;
  /** Exchange rate (1 PI = rate × fiat). */
  rate: number;
  /** ISO timestamp of the rate quote. */
  quotedAt: string;
  /** Oracle source identifier. */
  oracleSource: string;
  /** Rate validity window in seconds. */
  validForSeconds: number;
}

/**
 * Tax configuration for a jurisdiction.
 */
export interface TaxConfig {
  /** ISO 3166-1 alpha-2 country code. */
  countryCode: string;
  /** Optional sub-region/state code. */
  regionCode?: string;
  /** Combined tax rate as a decimal (e.g. 0.0825 = 8.25%). */
  taxRate: number;
  /** Display label (e.g. "VAT", "HST", "Sales Tax"). */
  taxLabel: string;
  /** Whether the rate is already included in the base price. */
  inclusive: boolean;
}

/**
 * A transaction payload with tax appended.
 */
export interface TaxAugmentedPayload {
  /** Base payment DTO before tax. */
  basePayment: PiPaymentDTO;
  /** Tax amount in Pi. */
  taxAmount: number;
  /** Final total (base + tax). */
  totalAmount: number;
  /** Tax configuration applied. */
  taxConfig: TaxConfig;
  /** ISO timestamp when tax was applied. */
  calculatedAt: string;
}

/**
 * Tip routing configuration.
 */
export interface TipRouteConfig {
  /** Service worker's Pi wallet address. */
  workerWallet: string;
  /** Tip amount in Pi. */
  tipAmount: number;
  /** Optional tip percentage for display (informational). */
  tipPercentage?: number;
}

/**
 * A split payment payload separating bill from gratuity.
 */
export interface TipRoutedPayload {
  /** Main bill payment DTO routed to the merchant. */
  billPayment: PiPaymentDTO;
  /** Tip payment DTO routed to the worker's wallet. */
  tipPayment: PiPaymentDTO;
  /** Breakdown summary. */
  summary: {
    subtotal: number;
    tipAmount: number;
    grandTotal: number;
    tipPercentage: number;
  };
}

/**
 * An offline-signed transaction ready for queue-and-upload.
 */
export interface OfflineSignedTransaction {
  /** Unique offline transaction ID. */
  txId: UUIDv4;
  /** The payment DTO being signed. */
  payload: PiPaymentDTO;
  /** ECDSA signature over the serialised payload. */
  signature: HexString;
  /** Public key corresponding to the signing key. */
  publicKey: HexString;
  /** Unix ms timestamp when signed. */
  signedAt: number;
  /** Whether this transaction has been uploaded to the blockchain. */
  uploaded: boolean;
  /** ISO timestamp of upload (null = not yet uploaded). */
  uploadedAt: string | null;
}

/**
 * Result of a Web Bluetooth LE invoice airdrop.
 */
export interface AirdropResult {
  /** Whether the airdrop was dispatched successfully. */
  success: boolean;
  /** Bluetooth device name that received the invoice (if available). */
  deviceName: string | null;
  /** ISO timestamp of the airdrop. */
  airdropAt: string;
  /** Error message if the airdrop failed. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// React integration types
// ---------------------------------------------------------------------------

/**
 * Context value exposed by QrCheckoutProvider.
 */
export interface CheckoutContextValue {
  /** Current engine state snapshot. */
  engineState: PaymentEngineState;
  /** Initiate a standard Pi payment. */
  initiatePayment: (dto: PiPaymentDTO) => Promise<PiPayment>;
  /** Reset the engine back to IDLE. */
  resetPayment: () => void;
  /** Whether the engine is in a terminal state (COMPLETED | FAILED | CANCELLED). */
  isTerminal: boolean;
}

/**
 * Props for the QrCheckoutProvider component.
 */
export interface QrCheckoutProviderProps {
  children: React.ReactNode;
  engineConfig: PaymentEngineConfig;
}

/**
 * Props for the DynamicQRCode component.
 */
export interface DynamicQRCodeProps {
  /** The QR payload to render. */
  payload: QRPayload;
  /** Width and height in pixels. Default: 300. */
  size?: number;
  /** Background colour. Default: "#0A0A0F". */
  backgroundColor?: string;
  /** Foreground colour. Default: "#F0C040". */
  foregroundColor?: string;
  /** Whether to enable dynamic hologram rotation. Default: true. */
  enableHologram?: boolean;
  /** Hologram rotation interval in ms. Default: 3000. */
  rotationIntervalMs?: number;
  /** Accessible label for the QR code image. */
  ariaLabel?: string;
  /** Optional CSS class name for the wrapping element. */
  className?: string;
}
