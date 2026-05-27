/**
 * @fileoverview pi-payment-recovery — Blockchain ledger polling utility.
 *
 * Actively watches the Pi Network blockchain ledger to auto-resolve dangling
 * or unverified transactions. If the user's app crashes mid-payment, this
 * module can detect and complete the stuck payment on the next app launch.
 *
 * Integrates with the Pi Browser SDK's `authenticate` callback which fires
 * `onIncompletePaymentFound` for any pending transaction.
 */

import type { PiPayment } from "../types/payment.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback invoked when a dangling payment is successfully recovered. */
export type RecoverySuccessCallback = (payment: PiPayment) => void;

/** Callback invoked when recovery polling encounters an unrecoverable error. */
export type RecoveryErrorCallback = (
  error: Error,
  payment: PiPayment | null
) => void;

/**
 * Configuration for the PaymentRecovery poller.
 */
export interface PaymentRecoveryConfig {
  /** Your server-side approval endpoint URL (same as PaymentEngineConfig). */
  approvalUrl: string;
  /** Your server-side completion endpoint URL (same as PaymentEngineConfig). */
  completionUrl: string;
  /**
   * How frequently (ms) to poll the ledger when watching for a specific
   * payment ID. Default: 5000 (5 seconds).
   */
  pollIntervalMs?: number;
  /**
   * Maximum total time (ms) to poll before giving up. Default: 120000 (2 min).
   */
  timeoutMs?: number;
  /** Optional additional HTTP headers sent to backend endpoints. */
  headers?: Record<string, string>;
}

/** Internal poll state. */
interface PollState {
  paymentId: string;
  startedAt: number;
  intervalHandle: ReturnType<typeof setInterval> | null;
  resolved: boolean;
}

/** Minimal Pi SDK interface (duplicated to avoid circular import). */
interface PiSDKForRecovery {
  authenticate: (
    scopes: string[],
    onIncompletePaymentFound: (payment: PiPayment) => void
  ) => Promise<{ user: { uid: string }; accessToken: string }>;
}

function getPiSDK(): PiSDKForRecovery {
  const sdk = (globalThis as unknown as { Pi?: PiSDKForRecovery }).Pi;
  if (!sdk) {
    throw new Error(
      "[PaymentRecovery] Pi Browser SDK is not available."
    );
  }
  return sdk;
}

// ---------------------------------------------------------------------------
// PaymentRecovery
// ---------------------------------------------------------------------------

/**
 * PaymentRecovery — resolves dangling Pi transactions after an app crash.
 *
 * On each app launch call `registerSessionRecovery()` inside your
 * authentication flow. This hooks into `Pi.authenticate` which fires
 * `onIncompletePaymentFound` for any previously unfinished payment.
 *
 * For more fine-grained control, use `watchPayment()` to poll a specific
 * payment identifier until it resolves or times out.
 *
 * @example
 * ```ts
 * const recovery = new PaymentRecovery({
 *   approvalUrl: "/api/pi/approve",
 *   completionUrl: "/api/pi/complete",
 * });
 *
 * // Call once at app startup (inside Pi.authenticate flow):
 * await recovery.registerSessionRecovery(
 *   (payment) => console.log("Recovered:", payment),
 *   (err) => console.error("Recovery failed:", err),
 * );
 * ```
 */
export class PaymentRecovery {
  private readonly config: Required<PaymentRecoveryConfig>;
  private readonly _activePolls: Map<string, PollState> = new Map();

  constructor(config: PaymentRecoveryConfig) {
    this.config = {
      approvalUrl: config.approvalUrl,
      completionUrl: config.completionUrl,
      pollIntervalMs: config.pollIntervalMs ?? 5_000,
      timeoutMs: config.timeoutMs ?? 120_000,
      headers: config.headers ?? {},
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Register a session-level recovery hook by calling `Pi.authenticate`.
   *
   * The Pi SDK fires `onIncompletePaymentFound` for any payment that was
   * initiated but not completed in a prior session. This method intercepts
   * that callback and drives the payment to completion.
   *
   * @param onSuccess - Invoked when a dangling payment is resolved.
   * @param onError   - Invoked when recovery encounters an error.
   * @returns The Pi authenticate result (user + accessToken).
   */
  async registerSessionRecovery(
    onSuccess: RecoverySuccessCallback,
    onError: RecoveryErrorCallback
  ): Promise<{ user: { uid: string }; accessToken: string }> {
    const sdk = getPiSDK();

    return sdk.authenticate(
      ["username", "payments"],
      async (incompletePayment: PiPayment) => {
        try {
          const resolved = await this._resolveIncompletePayment(
            incompletePayment
          );
          onSuccess(resolved);
        } catch (err) {
          onError(
            err instanceof Error ? err : new Error(String(err)),
            incompletePayment
          );
        }
      }
    );
  }

  /**
   * Actively poll a specific payment until it resolves, the timeout expires,
   * or `stopWatching()` is called.
   *
   * @param paymentId - Pi payment identifier to poll.
   * @param onSuccess - Invoked when the payment transitions to COMPLETED.
   * @param onError   - Invoked when the poll times out or encounters an error.
   */
  watchPayment(
    paymentId: string,
    onSuccess: RecoverySuccessCallback,
    onError: RecoveryErrorCallback
  ): void {
    if (this._activePolls.has(paymentId)) {
      return; // Already watching this payment.
    }

    const pollState: PollState = {
      paymentId,
      startedAt: Date.now(),
      intervalHandle: null,
      resolved: false,
    };

    pollState.intervalHandle = setInterval(async () => {
      if (pollState.resolved) {
        this._clearPoll(paymentId);
        return;
      }

      const elapsed = Date.now() - pollState.startedAt;
      if (elapsed >= this.config.timeoutMs) {
        this._clearPoll(paymentId);
        onError(
          new Error(
            `[PaymentRecovery] Polling timed out after ${this.config.timeoutMs}ms ` +
              `for paymentId=${paymentId}.`
          ),
          null
        );
        return;
      }

      try {
        const payment = await this._fetchPaymentStatus(paymentId);
        if (payment !== null && payment.status.developer_completed) {
          pollState.resolved = true;
          this._clearPoll(paymentId);
          onSuccess(payment);
        } else if (payment !== null && !payment.status.developer_completed) {
          // Attempt to drive completion if approved but not yet completed.
          if (payment.status.developer_approved && payment.transaction) {
            await this._completeOnServer(
              paymentId,
              payment.transaction.txid
            );
            pollState.resolved = true;
            this._clearPoll(paymentId);
            onSuccess({ ...payment, status: { ...payment.status, developer_completed: true } });
          }
        }
      } catch (err) {
        // Do not stop polling on transient errors — log and continue.
        console.warn(
          `[PaymentRecovery] Transient poll error for ${paymentId}:`,
          err
        );
      }
    }, this.config.pollIntervalMs);

    this._activePolls.set(paymentId, pollState);
  }

  /**
   * Stop watching a specific payment ID.
   *
   * @param paymentId - Payment ID to stop polling.
   */
  stopWatching(paymentId: string): void {
    this._clearPoll(paymentId);
  }

  /**
   * Stop all active polls (e.g. on component unmount).
   */
  stopAll(): void {
    for (const paymentId of this._activePolls.keys()) {
      this._clearPoll(paymentId);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Drive an incomplete payment to completion using the server endpoints.
   */
  private async _resolveIncompletePayment(
    payment: PiPayment
  ): Promise<PiPayment> {
    // Step 1: Approve if not yet approved.
    if (!payment.status.developer_approved) {
      await this._approveOnServer(payment.identifier);
    }

    // Step 2: Complete if not yet completed.
    if (!payment.status.developer_completed && payment.transaction) {
      await this._completeOnServer(
        payment.identifier,
        payment.transaction.txid
      );
    }

    return {
      ...payment,
      status: {
        ...payment.status,
        developer_approved: true,
        developer_completed: true,
      },
    };
  }

  /** Fetch the current status of a payment from the Pi platform via backend. */
  private async _fetchPaymentStatus(
    paymentId: string
  ): Promise<PiPayment | null> {
    try {
      const url = `${this.config.approvalUrl.replace(/\/approve$/, "")}/status/${paymentId}`;
      const res = await fetch(url, {
        headers: { ...this.config.headers },
      });
      if (!res.ok) return null;
      return (await res.json()) as PiPayment;
    } catch {
      return null;
    }
  }

  /** POST to the approval endpoint. */
  private async _approveOnServer(paymentId: string): Promise<void> {
    const res = await fetch(this.config.approvalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.config.headers,
      },
      body: JSON.stringify({ paymentId }),
    });
    if (!res.ok) {
      throw new Error(
        `[PaymentRecovery] Approval failed with status ${res.status}`
      );
    }
  }

  /** POST to the completion endpoint. */
  private async _completeOnServer(
    paymentId: string,
    txid: string
  ): Promise<void> {
    const res = await fetch(this.config.completionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.config.headers,
      },
      body: JSON.stringify({ paymentId, txid }),
    });
    if (!res.ok) {
      throw new Error(
        `[PaymentRecovery] Completion failed with status ${res.status}`
      );
    }
  }

  /** Clear an active poll by payment ID. */
  private _clearPoll(paymentId: string): void {
    const poll = this._activePolls.get(paymentId);
    if (poll && poll.intervalHandle !== null) {
      clearInterval(poll.intervalHandle as ReturnType<typeof setInterval>);
    }
    this._activePolls.delete(paymentId);
  }
}
