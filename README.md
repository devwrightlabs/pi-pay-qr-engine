# `@devright/pi-pay-qr-engine`

> **Advanced, strictly typed TypeScript payment engine and dynamic QR builder for the native Pi Network mobile webview container. Engineered for React and Next.js (App Router).**

[![npm version](https://badge.fury.io/js/%40devright%2Fpi-pay-qr-engine.svg)](https://www.npmjs.com/package/@devright/pi-pay-qr-engine)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Overview

`@devright/pi-pay-qr-engine` is a production-ready npm library that handles the **complete lifecycle** of Pi Network payments, fiat-bridging, and enterprise-grade physical checkout security. Built by Devright Labs, it ships with 16 specialised modules covering:

- **Core payment state machine** (Create → Approve → Complete with retry logic)
- **Recurring subscriptions** via Protocol v23 WASM
- **Dynamic holographic QR codes** with anti-screenshot rotation
- **Fiat bridging & oracle rates** for multi-currency checkouts
- **Offline cryptographic signing** for POS queue-and-upload
- **Full React / Next.js App Router integration** via context, hooks, and a premium UI component

---

## Installation

```bash
npm install @devright/pi-pay-qr-engine qrcode react react-dom
# or
yarn add @devright/pi-pay-qr-engine qrcode react react-dom
# or
pnpm add @devright/pi-pay-qr-engine qrcode react react-dom
```

> **Requirements**
> - Node.js 18+
> - React 18+
> - TypeScript 5+ (strict mode recommended)
> - Must execute inside the Pi Network mobile webview for SDK-dependent features

---

## Quick Start

### Next.js App Router (recommended)

```tsx
// app/layout.tsx
import { QrCheckoutProvider } from "@devright/pi-pay-qr-engine";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <QrCheckoutProvider
          engineConfig={{
            approvalUrl: "/api/pi/approve",
            completionUrl: "/api/pi/complete",
          }}
        >
          {children}
        </QrCheckoutProvider>
      </body>
    </html>
  );
}
```

```tsx
// app/checkout/page.tsx
"use client";

import { useCheckout, DynamicQRCode } from "@devright/pi-pay-qr-engine";
import type { QRPayload } from "@devright/pi-pay-qr-engine";

const DEMO_PAYLOAD: QRPayload = {
  sessionId: crypto.randomUUID(),
  amount: 3.14,
  walletAddress: "GA2CWNBUHX...",
  memo: "Coffee",
  createdAt: Math.floor(Date.now() / 1000),
  expiresAt: null,
  metadata: { orderId: "order_001" },
};

export default function CheckoutPage() {
  const { engineState, initiatePayment, resetPayment, taxCalculator } = useCheckout();

  const handlePay = async () => {
    const dto = taxCalculator.buildTaxInclusiveDTO(
      { amount: 3.14, memo: "Coffee", metadata: { orderId: "order_001" } },
      "US-TX"
    );
    await initiatePayment(dto);
  };

  return (
    <div>
      <DynamicQRCode payload={DEMO_PAYLOAD} size={320} enableHologram />
      <p>State: {engineState.state}</p>
      <button onClick={handlePay} disabled={engineState.state !== "IDLE"}>
        Pay with Pi
      </button>
      {engineState.state === "COMPLETED" && (
        <button onClick={resetPayment}>Reset</button>
      )}
    </div>
  );
}
```

---

## Payment Flow State Machine

The `PaymentEngine` implements the **strict Pi asynchronous payment flow**:

```
IDLE
  │
  │ initiatePayment(dto)
  ▼
CREATING ──────────────────────────────► FAILED
  │
  │ Pi SDK: createPayment()
  ▼
PENDING_APPROVAL ──────────────────────► CANCELLED (user cancels)
  │
  │ onReadyForServerApproval → POST /approve
  ▼
APPROVED ──────────────────────────────► FAILED (approval error)
  │
  │ onReadyForServerCompletion → POST /complete
  ▼
COMPLETING ─────────────────────────────► FAILED (completion error)
  │
  ▼
COMPLETED ✓
```

**Retry logic**: Each server call (approve + complete) uses exponential backoff with up to `maxRetries` attempts (default: 3) and `retryDelayMs × 2^attempt` delay.

**Recovery**: If the app crashes mid-payment, `PaymentRecovery.registerSessionRecovery()` hooks into `Pi.authenticate` to auto-resume any dangling transaction on next launch.

---

## Module Reference

### 1. `PaymentEngine` — Core state machine

```ts
import { PaymentEngine } from "@devright/pi-pay-qr-engine";

const engine = new PaymentEngine({
  approvalUrl: "/api/pi/approve",
  completionUrl: "/api/pi/complete",
  maxRetries: 3,
  retryDelayMs: 2000,
  headers: { Authorization: "Bearer <token>" },
});

// Subscribe to state changes
const unsub = engine.subscribe((state) => console.log(state));

// Initiate payment
const payment = await engine.initiatePayment({
  amount: 5.0,
  memo: "Dinner",
  metadata: { orderId: "order_42" },
});
```

### 2. `SubscriptionEngine` — Recurring payments (Protocol v23 WASM)

```ts
import { SubscriptionEngine, PaymentEngine } from "@devright/pi-pay-qr-engine";

const subEngine = new SubscriptionEngine();

// Build the first-cycle DTO and get user approval
const firstCycleDTO = subEngine.buildFirstCycleDTO({
  planName: "Gym Membership",
  amount: 10,
  interval: "monthly",
  merchantWallet: "GA2C...",
});
const payment = await paymentEngine.initiatePayment(firstCycleDTO);

// Create the recurring payload
const subscription = await subEngine.createSubscription(payment.identifier, {
  planName: "Gym Membership",
  amount: 10,
  interval: "monthly",
  merchantWallet: "GA2C...",
});
// Store subscription on your server — the WASM token enables future charges
```

### 3. `PaymentRecovery` — Blockchain polling utility

```ts
import { PaymentRecovery } from "@devright/pi-pay-qr-engine";

const recovery = new PaymentRecovery({
  approvalUrl: "/api/pi/approve",
  completionUrl: "/api/pi/complete",
  pollIntervalMs: 5000,
  timeoutMs: 120000,
});

// Call on every app launch:
await recovery.registerSessionRecovery(
  (payment) => console.log("Recovered:", payment.identifier),
  (err) => console.error("Recovery failed:", err)
);

// Watch a specific payment:
recovery.watchPayment(
  "payment_id_123",
  (payment) => console.log("Completed:", payment),
  (err) => console.error("Timed out:", err)
);
```

### 4. `PiDynamicHologram` — Anti-screenshot QR rotation

```ts
import { PiDynamicHologram } from "@devright/pi-pay-qr-engine";

const hologram = new PiDynamicHologram(qrPayload, {
  rotationIntervalMs: 3000,
  width: 300,
  height: 300,
  backgroundColor: "#0A0A0F",
  foregroundColor: "#F0C040",
});

hologram.start((frame) => {
  document.getElementById("qr-img")!.setAttribute("src", frame.dataUrl);
});

// Later, stop the loop:
hologram.stop();
```

### 5. `PiQRCompressor` — Auto-optimised QR density

```ts
import { PiQRCompressor } from "@devright/pi-pay-qr-engine";

const compressor = new PiQRCompressor({ minECLevel: "M" });
const options = compressor.compress(qrPayload);

// options.errorCorrectionLevel — recommended EC level
// options.version             — recommended QR version (1–40)
// options.encodedData         — compressed data string for QRCode.toDataURL()
// options.compressed          — whether field aliasing reduced the size

// Restore the original payload:
const restored = compressor.decompress(options.encodedData);
```

### 6. `PiRefundToken` — Reverse-QR digital receipt

```ts
import { PiRefundToken } from "@devright/pi-pay-qr-engine";

const generator = new PiRefundToken();
const token = await generator.generate({
  originalPaymentId: "payment_abc",
  refundAmount: 2.5,
  merchantWallet: "GA2C...",
  customerWallet: "GDKJ...",
});

// Render token.qrDataUrl as a digital receipt
// Customer scans it at the counter for instant refund
const isValid = await generator.verify(token); // true
```

### 7. `PiStealthQR` — Biometric-gated amount reveal

```ts
import { PiStealthQR } from "@devright/pi-pay-qr-engine";

const stealth = new PiStealthQR();
const bundle = await stealth.generate({
  amount: 99.99,
  walletAddress: "GA2C...",
  publicMemo: "Premium service",
});

// Render bundle.qrDataUrl — amount is hidden until biometric auth
// Deliver bundle.encryptionKeyBase64 to the customer's device via secure channel

// On customer's device after biometric success:
const amount = await stealth.revealAmount(bundle.payload, bundle.encryptionKeyBase64);
```

### 8. `PiQRExpiry` — 60-second TTL anti-replay

```ts
import { PiQRExpiry, wrapWithExpiry, validateExpiry } from "@devright/pi-pay-qr-engine";

const expiry = new PiQRExpiry({ ttlSeconds: 60 });
const wrapped = await expiry.wrap(qrPayload);

// On scan:
const isValid = await expiry.validate(wrapped);
const remaining = expiry.remainingSeconds(wrapped);

// Or use the standalone helpers:
const wrapped2 = await wrapWithExpiry(qrPayload, 60);
const valid2 = await validateExpiry(wrapped2);
```

### 9. `SplitTenderProcessor` — Multi-currency fiat bridge

```ts
import { SplitTenderProcessor } from "@devright/pi-pay-qr-engine";

const processor = new SplitTenderProcessor();

// Build a 60% Pi / 40% BSD split:
const request = processor.buildRequest(10, "BSD", 0.6, "/api/bsd/charge", 0.62);

const result = await processor.process(request);
// result.success         — all lines settled
// result.results["PI"]   — Pi settlement detail
// result.results["BSD"]  — Bahamian Sand Dollar settlement detail
```

### 10. `MicroTabManager` — Aggregated micro-purchase checkout

```ts
import { MicroTabManager } from "@devright/pi-pay-qr-engine";

const manager = new MicroTabManager({ currencyLabel: "Pi" });
const tab = manager.openTab("customer-wallet-GA2C...");

manager.addItem(tab.tabId, { name: "Mojito",      unitPrice: 0.5, quantity: 2 });
manager.addItem(tab.tabId, { name: "Nachos",       unitPrice: 0.8, quantity: 1 });
manager.addItem(tab.tabId, { name: "Pool access",  unitPrice: 2.0, quantity: 1 });

const dto = manager.closeAndBuild(tab.tabId);
// dto.amount = 3.8 Pi
await paymentEngine.initiatePayment(dto);
manager.markPaid(tab.tabId);
```

### 11. `FiatDisplayEngine` — Oracle-based fiat rates

```ts
import { FiatDisplayEngine } from "@devright/pi-pay-qr-engine";

const display = new FiatDisplayEngine({ cacheSeconds: 30 });

const rate = await display.getRate("USD");
// rate.rate = 0.62 (1 Pi = $0.62)

const fiatAmount = await display.convertPiToFiat(10, "EUR");

// Live polling:
display.startPolling(["USD", "EUR", "BSD"], (rates) => {
  setConversionRates(rates);
});
display.stopPolling();
```

### 12. `PiTaxCalculator` — VAT / Sales Tax middleware

```ts
import { PiTaxCalculator } from "@devright/pi-pay-qr-engine";

const calc = new PiTaxCalculator();

// Using built-in jurisdictions:
const augmented = calc.apply(baseDTO, "US-TX");
// augmented.taxAmount   = 0.42875 Pi
// augmented.totalAmount = 5.42875 Pi

// Build a tax-inclusive DTO for PaymentEngine:
const dto = calc.buildTaxInclusiveDTO(baseDTO, "GB");

// Register a custom jurisdiction:
calc.registerJurisdiction("PH", {
  countryCode: "PH", taxRate: 0.12, taxLabel: "VAT", inclusive: false
});
```

### 13. `PiTipRouter` — Gratuity separation and routing

```ts
import { PiTipRouter } from "@devright/pi-pay-qr-engine";

const router = new PiTipRouter();

// By percentage:
const split = router.splitByPercentage(billDTO, "worker-wallet-GA2C...", 18);
// split.billPayment — goes to merchant
// split.tipPayment  — goes to worker's wallet

// By explicit amount:
const split2 = router.splitByAmount({ workerWallet: "GA2C...", tipAmount: 1.5 }, billDTO);

// Tip suggestions:
const suggestions = router.suggestTips(20); // { "10%": { tipAmount: 2, total: 22 }, ... }
```

### 14. `PiInvoiceAirdrop` — Web Bluetooth LE invoice beaming

```ts
import { PiInvoiceAirdrop } from "@devright/pi-pay-qr-engine";

const airdrop = new PiInvoiceAirdrop();

// On the merchant POS (sender):
const result = await airdrop.send(qrPayload, 15000);
if (result.success) console.log(`Sent to ${result.deviceName}`);

// On the customer's device (receiver):
const sub = await airdrop.receive(
  (payload) => console.log("Received invoice:", payload),
  30000
);
// Later:
sub.stop();
```

### 15. `PiOfflineCheckout` — Cryptographic offline signing

```ts
import { PiOfflineCheckout } from "@devright/pi-pay-qr-engine";

const checkout = new PiOfflineCheckout({ maxQueueSize: 50 });

// Generate key pair once per device:
const keyPair = await checkout.generateKeyPair();
// Register keyPair.publicKeyBase64 with your server

// While offline:
const signed = await checkout.signTransaction(dto, keyPair.privateKey, keyPair.publicKeyBase64);
checkout.enqueue(signed);

// When connectivity returns:
const uploaded = await checkout.flushQueue("/api/pi/offline-upload", {
  Authorization: "Bearer <token>",
});
```

### 16. `DynamicQRCode` — React UI component

```tsx
"use client";

import { DynamicQRCode } from "@devright/pi-pay-qr-engine";

<DynamicQRCode
  payload={qrPayload}
  size={320}
  backgroundColor="#0A0A0F"   // Devright Labs design system
  foregroundColor="#F0C040"   // Gold
  enableHologram              // rotate every 3 s
  rotationIntervalMs={3000}
  ariaLabel="Pi payment QR code"
/>
```

---

## React Hooks

### `useCheckout(recoveryConfig?)`

Returns the complete checkout value including all 16 module instances:

```ts
const {
  // State machine
  engineState,      // PaymentEngineState
  initiatePayment,  // (dto: PiPaymentDTO) => Promise<PiPayment>
  resetPayment,     // () => void
  isTerminal,       // boolean

  // Core modules
  subscriptionEngine, paymentRecovery,

  // QR modules
  dynamicHologram, qrCompressor, refundToken, stealthQR, qrExpiry,

  // Checkout modules
  splitTender, microTab, fiatDisplay, taxCalculator, tipRouter,
  invoiceAirdrop, offlineCheckout,
} = useCheckout();
```

---

## Backend API Routes (Next.js App Router)

```ts
// app/api/pi/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import Pi from "@pinetwork-js/sdk"; // server-side Pi SDK

export async function POST(req: NextRequest) {
  const { paymentId } = await req.json();
  await Pi.approvePayment(paymentId);
  return NextResponse.json({ ok: true });
}

// app/api/pi/complete/route.ts
export async function POST(req: NextRequest) {
  const { paymentId, txid } = await req.json();
  await Pi.completePayment(paymentId, txid);
  return NextResponse.json({ ok: true });
}
```

---

## Configuration Reference

### `PaymentEngineConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `approvalUrl` | `string` | **required** | Server-side payment approval endpoint |
| `completionUrl` | `string` | **required** | Server-side payment completion endpoint |
| `maxRetries` | `number` | `3` | Max retry attempts for stuck transactions |
| `retryDelayMs` | `number` | `2000` | Base delay (ms) between retries |
| `headers` | `Record<string,string>` | `{}` | Additional HTTP headers for backend calls |

### `HologramConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `rotationIntervalMs` | `number` | `3000` | QR rotation interval in milliseconds |
| `width` | `number` | `300` | Canvas width (px) |
| `height` | `number` | `300` | Canvas height (px) |
| `backgroundColor` | `string` | `"#0A0A0F"` | Background colour |
| `foregroundColor` | `string` | `"#F0C040"` | QR pixel / accent colour |

---

## Security Notes

- **Replay prevention**: `PiQRExpiry` binds an HMAC-SHA256 integrity token to every QR session. Configure `PI_QR_INTEGRITY_SECRET` in your environment.
- **Stealth QR**: AES-GCM 256-bit encryption is used for amount concealment. Never embed the encryption key in the QR itself.
- **Offline signing**: ECDSA P-256 private keys should be stored in IndexedDB with the `nonExtractable` flag in production.
- **BLE airdrop**: Web Bluetooth requires HTTPS and explicit user gesture permission in the browser.

---

## License

MIT © Devright Labs
