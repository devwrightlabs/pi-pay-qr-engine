"use client";

/**
 * @fileoverview QrCheckoutProvider — React context provider for Pi checkout.
 *
 * Initialises the PaymentEngine and exposes the global checkout state to
 * the entire React subtree via the CheckoutContext. Wrap your checkout page
 * (or the full app) with this provider to gain access to `useCheckout`.
 *
 * @example
 * ```tsx
 * // app/layout.tsx (Next.js App Router)
 * import { QrCheckoutProvider } from "@devright/pi-pay-qr-engine/react";
 *
 * export default function RootLayout({ children }: { children: React.ReactNode }) {
 *   return (
 *     <QrCheckoutProvider
 *       engineConfig={{
 *         approvalUrl: "/api/pi/approve",
 *         completionUrl: "/api/pi/complete",
 *       }}
 *     >
 *       {children}
 *     </QrCheckoutProvider>
 *   );
 * }
 * ```
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PaymentEngine } from "../core/PaymentEngine.js";
import type {
  CheckoutContextValue,
  PaymentEngineConfig,
  PaymentEngineState,
  PiPayment,
  PiPaymentDTO,
  QrCheckoutProviderProps,
} from "../types/payment.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const CheckoutContext = createContext<CheckoutContextValue | null>(null);
CheckoutContext.displayName = "CheckoutContext";

// ---------------------------------------------------------------------------
// Terminal state check helper
// ---------------------------------------------------------------------------

function isTerminalState(state: PaymentEngineState["state"]): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED";
}

// ---------------------------------------------------------------------------
// QrCheckoutProvider
// ---------------------------------------------------------------------------

/**
 * QrCheckoutProvider — initialises the PaymentEngine and provides global
 * checkout state to all descendant components via React context.
 *
 * @param props.engineConfig - Configuration for the PaymentEngine instance.
 * @param props.children     - React subtree to wrap.
 */
export function QrCheckoutProvider({
  children,
  engineConfig,
}: QrCheckoutProviderProps): React.ReactElement {
  // Stable engine reference — recreate only if the config identity changes.
  const configRef = useRef<PaymentEngineConfig>(engineConfig);
  const engineRef = useRef<PaymentEngine | null>(null);

  if (!engineRef.current) {
    engineRef.current = new PaymentEngine(configRef.current);
  }

  const [engineState, setEngineState] = useState<PaymentEngineState>(
    () => engineRef.current!.state
  );

  // Subscribe to engine state changes.
  useEffect(() => {
    const unsubscribe = engineRef.current!.subscribe((newState) => {
      setEngineState(newState);
    });
    return unsubscribe;
  }, []);

  /**
   * Initiate a Pi payment via the engine.
   */
  const initiatePayment = useCallback(
    (dto: PiPaymentDTO): Promise<PiPayment> => {
      return engineRef.current!.initiatePayment(dto);
    },
    []
  );

  /**
   * Reset the engine to the IDLE state.
   */
  const resetPayment = useCallback(() => {
    engineRef.current!.reset();
  }, []);

  const isTerminal = useMemo(
    () => isTerminalState(engineState.state),
    [engineState.state]
  );

  const contextValue: CheckoutContextValue = useMemo(
    () => ({
      engineState,
      initiatePayment,
      resetPayment,
      isTerminal,
    }),
    [engineState, initiatePayment, resetPayment, isTerminal]
  );

  return (
    <CheckoutContext.Provider value={contextValue}>
      {children}
    </CheckoutContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Internal context accessor (used by useCheckout)
// ---------------------------------------------------------------------------

/**
 * Returns the raw CheckoutContext value.
 * Throws a helpful error if called outside a QrCheckoutProvider.
 *
 * @internal
 */
export function useCheckoutContext(): CheckoutContextValue {
  const ctx = useContext(CheckoutContext);
  if (!ctx) {
    throw new Error(
      "[QrCheckoutProvider] useCheckoutContext must be used inside a <QrCheckoutProvider>. " +
        "Wrap your checkout component with <QrCheckoutProvider engineConfig={...}>."
    );
  }
  return ctx;
}

export { CheckoutContext };
