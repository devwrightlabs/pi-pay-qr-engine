/**
 * @fileoverview PaymentEngine — Pi Network payment lifecycle state machine.
 *
 * Implements the strict Pi asynchronous payment flow:
 *   IDLE → CREATING → PENDING_APPROVAL → APPROVED → COMPLETING → COMPLETED
 *
 * Includes automatic retry logic for stuck transactions and delegates
 * server-side approval / completion calls to the configured backend URLs.
 */

import type {
  PaymentEngineConfig,
  PaymentEngineState,
  PaymentState,
  PiPayment,
  PiPaymentCallbacks,
  PiPaymentDTO,
} from "../types/payment.js";

/** Minimal interface describing the Pi Browser SDK exposed on `window.Pi`. */
interface PiSDK {
  createPayment: (
    dto: PiPaymentDTO,
    callbacks: PiPaymentCallbacks
  ) => void;
  authenticate: (
    scopes: string[],
    onIncompletePaymentFound: (payment: PiPayment) => void
  ) => Promise<{ user: { uid: string }; accessToken: string }>;
}

/** Retrieve the Pi SDK from the global scope (injected by the Pi Browser). */
function getPiSDK(): PiSDK {
  const sdk = (globalThis as unknown as { Pi?: PiSDK }).Pi;
  if (!sdk) {
    throw new Error(
      "[PaymentEngine] Pi Browser SDK is not available. " +
        "Ensure this code runs inside the Pi Network mobile webview."
    );
  }
  return sdk;
}

/**
 * Utility: pause execution for `ms` milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * PaymentEngine — robust state machine for the Pi payment lifecycle.
 *
 * @example
 * ```ts
 * const engine = new PaymentEngine({
 *   approvalUrl: "/api/pi/approve",
 *   completionUrl: "/api/pi/complete",
 * });
 *
 * const payment = await engine.initiatePayment({
 *   amount: 3.14,
 *   memo: "Coffee",
 *   metadata: { orderId: "order_123" },
 * });
 * ```
 */
export class PaymentEngine {
  private readonly config: Required<PaymentEngineConfig>;
  private _state: PaymentEngineState;
  private readonly _listeners: Set<(state: PaymentEngineState) => void> =
    new Set();

  constructor(config: PaymentEngineConfig) {
    this.config = {
      approvalUrl: config.approvalUrl,
      completionUrl: config.completionUrl,
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 2000,
      headers: config.headers ?? {},
    };

    this._state = {
      state: "IDLE",
      payment: null,
      retryCount: 0,
      lastUpdatedAt: null,
      error: null,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Returns a snapshot of the current engine state.
   */
  get state(): PaymentEngineState {
    return { ...this._state };
  }

  /**
   * Subscribe to state change events.
   *
   * @param listener - Callback invoked with every new state snapshot.
   * @returns Unsubscribe function.
   */
  subscribe(listener: (state: PaymentEngineState) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Initiate a full Pi payment lifecycle.
   *
   * Opens the Pi wallet UI, handles server-side approval and completion,
   * and resolves with the final PiPayment object on success.
   *
   * @param dto - Payment DTO describing amount, memo, and metadata.
   * @returns Promise resolving to the completed PiPayment.
   * @throws {Error} If the SDK is unavailable or the payment fails.
   */
  async initiatePayment(dto: PiPaymentDTO): Promise<PiPayment> {
    this._assertState("IDLE", "initiatePayment");
    this._transition("CREATING", null);

    return new Promise<PiPayment>((resolve, reject) => {
      let sdk: PiSDK;
      try {
        sdk = getPiSDK();
      } catch (err) {
        this._transition("FAILED", null, this._errorMessage(err));
        reject(err);
        return;
      }

      const callbacks: PiPaymentCallbacks = {
        onReadyForServerApproval: (paymentId: string) => {
          this._transition("PENDING_APPROVAL", this._state.payment);
          this._retryWithBackoff(() => this._approveOnServer(paymentId))
            .then(() => {
              this._transition("APPROVED", this._state.payment);
            })
            .catch((err: unknown) => {
              const msg = this._errorMessage(err);
              this._transition("FAILED", this._state.payment, msg);
              reject(new Error(`Server approval failed: ${msg}`));
            });
        },

        onReadyForServerCompletion: (paymentId: string, txid: string) => {
          this._transition("COMPLETING", this._state.payment);
          this._retryWithBackoff(() =>
            this._completeOnServer(paymentId, txid)
          )
            .then(() => {
              this._transition("COMPLETED", this._state.payment);
              resolve(this._state.payment as PiPayment);
            })
            .catch((err: unknown) => {
              const msg = this._errorMessage(err);
              this._transition("FAILED", this._state.payment, msg);
              reject(new Error(`Server completion failed: ${msg}`));
            });
        },

        onCancel: (paymentId: string) => {
          this._transition("CANCELLED", this._state.payment);
          reject(new Error(`Payment cancelled by user. id=${paymentId}`));
        },

        onError: (error: Error, payment: PiPayment | null) => {
          this._transition("FAILED", payment, error.message);
          reject(error);
        },
      };

      try {
        sdk.createPayment(dto, callbacks);
      } catch (err) {
        this._transition("FAILED", null, this._errorMessage(err));
        reject(err);
      }
    });
  }

  /**
   * Reset the engine to the IDLE state, clearing any active payment.
   * Safe to call from any state.
   */
  reset(): void {
    this._setState({
      state: "IDLE",
      payment: null,
      retryCount: 0,
      lastUpdatedAt: new Date().toISOString(),
      error: null,
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Call the developer's server-side approval endpoint.
   */
  private async _approveOnServer(paymentId: string): Promise<void> {
    const response = await fetch(this.config.approvalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.config.headers,
      },
      body: JSON.stringify({ paymentId }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Approval endpoint returned ${response.status}: ${body}`
      );
    }
  }

  /**
   * Call the developer's server-side completion endpoint.
   */
  private async _completeOnServer(
    paymentId: string,
    txid: string
  ): Promise<void> {
    const response = await fetch(this.config.completionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.config.headers,
      },
      body: JSON.stringify({ paymentId, txid }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Completion endpoint returned ${response.status}: ${body}`
      );
    }
  }

  /**
   * Wrap an async operation with exponential-backoff retry logic.
   */
  private async _retryWithBackoff<T>(
    fn: () => Promise<T>
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await fn();
        this._setState({ ...this._state, retryCount: 0 });
        return result;
      } catch (err) {
        lastError = err;
        this._setState({ ...this._state, retryCount: attempt + 1 });
        if (attempt < this.config.maxRetries) {
          const backoff = this.config.retryDelayMs * Math.pow(2, attempt);
          await delay(backoff);
        }
      }
    }
    throw lastError;
  }

  /**
   * Transition to a new state, updating lastUpdatedAt.
   */
  private _transition(
    newState: PaymentState,
    payment: PiPayment | null,
    error: string | null = null
  ): void {
    this._setState({
      state: newState,
      payment: payment ?? this._state.payment,
      retryCount: this._state.retryCount,
      lastUpdatedAt: new Date().toISOString(),
      error,
    });
  }

  /**
   * Set state and notify all listeners.
   */
  private _setState(newState: PaymentEngineState): void {
    this._state = newState;
    const snapshot = { ...newState };
    for (const listener of this._listeners) {
      try {
        listener(snapshot);
      } catch {
        // Never allow a listener to crash the engine.
      }
    }
  }

  /**
   * Assert the engine is in an expected state before proceeding.
   */
  private _assertState(
    expected: PaymentState,
    operation: string
  ): void {
    if (this._state.state !== expected) {
      throw new Error(
        `[PaymentEngine] Cannot call '${operation}' in state '${this._state.state}'. ` +
          `Expected '${expected}'.`
      );
    }
  }

  /**
   * Extract a string error message from an unknown thrown value.
   */
  private _errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
