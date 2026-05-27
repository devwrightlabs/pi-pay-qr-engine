/**
 * @fileoverview pi-micro-tab — Aggregated micro-purchase checkout manager.
 *
 * Aggregates multiple small purchases (like bar drinks or snacks) into a
 * single master payment payload. The customer can keep ordering; each item
 * is appended to the open tab. When they're ready to leave, one final
 * checkout QR is generated covering the entire tab total.
 *
 * All tab state is maintained in-memory and can be persisted to any
 * storage backend via the optional `onTabUpdate` callback.
 */

import { randomUUID } from "../core/crypto-utils.js";
import type {
  MicroTab,
  MicroTabItem,
  PiPaymentDTO,
} from "../types/payment.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for a MicroTabManager instance.
 */
export interface MicroTabConfig {
  /** Optional callback invoked whenever the tab is mutated. */
  onTabUpdate?: (tab: MicroTab) => void;
  /** Currency label for display purposes. Default: "Pi". */
  currencyLabel?: string;
}

// ---------------------------------------------------------------------------
// MicroTabManager
// ---------------------------------------------------------------------------

/**
 * MicroTabManager — stateful in-memory accumulator for micro-purchase tabs.
 *
 * @example
 * ```ts
 * const manager = new MicroTabManager({ currencyLabel: "Pi" });
 * const tab = manager.openTab("customer-wallet-GA2C...");
 *
 * manager.addItem(tab.tabId, { name: "Mojito", unitPrice: 0.5, quantity: 2 });
 * manager.addItem(tab.tabId, { name: "Snack Pack", unitPrice: 0.3, quantity: 1 });
 *
 * const dto = manager.closeAndBuild(tab.tabId);
 * // Pass dto to PaymentEngine.initiatePayment(dto)
 * ```
 */
export class MicroTabManager {
  private readonly tabs: Map<string, MicroTab> = new Map();
  private readonly config: Required<MicroTabConfig>;

  constructor(config: MicroTabConfig = {}) {
    this.config = {
      onTabUpdate: config.onTabUpdate ?? (() => undefined),
      currencyLabel: config.currencyLabel ?? "Pi",
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Open a new empty tab for a customer.
   *
   * @param customerId - Wallet address or display identifier for the customer.
   * @returns The newly created MicroTab.
   */
  openTab(customerId: string): MicroTab {
    if (!customerId) {
      throw new Error("[MicroTabManager] customerId is required.");
    }

    const tab: MicroTab = {
      tabId: randomUUID(),
      customerId,
      items: [],
      totalAmount: 0,
      openedAt: new Date().toISOString(),
      closedAt: null,
      paid: false,
    };

    this.tabs.set(tab.tabId, tab);
    this.config.onTabUpdate(tab);
    return tab;
  }

  /**
   * Add a line item to an existing open tab.
   *
   * @param tabId - The tab to add the item to.
   * @param item  - Item details (name, unitPrice, quantity).
   * @returns The updated MicroTab.
   * @throws {Error} If the tab is not found, is closed, or already paid.
   */
  addItem(
    tabId: string,
    item: Omit<MicroTabItem, "itemId">
  ): MicroTab {
    const tab = this._requireOpenTab(tabId);

    const lineItem: MicroTabItem = {
      itemId: randomUUID(),
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      metadata: item.metadata,
    };

    tab.items.push(lineItem);
    tab.totalAmount = this._computeTotal(tab.items);

    this.config.onTabUpdate({ ...tab });
    return { ...tab };
  }

  /**
   * Remove a line item from an open tab by itemId.
   *
   * @param tabId  - The tab containing the item.
   * @param itemId - The item to remove.
   * @returns The updated MicroTab.
   */
  removeItem(tabId: string, itemId: string): MicroTab {
    const tab = this._requireOpenTab(tabId);

    const before = tab.items.length;
    tab.items = tab.items.filter((i) => i.itemId !== itemId);

    if (tab.items.length === before) {
      throw new Error(
        `[MicroTabManager] Item '${itemId}' not found in tab '${tabId}'.`
      );
    }

    tab.totalAmount = this._computeTotal(tab.items);
    this.config.onTabUpdate({ ...tab });
    return { ...tab };
  }

  /**
   * Retrieve the current state of a tab.
   *
   * @param tabId - The tab to fetch.
   * @returns A snapshot of the MicroTab.
   */
  getTab(tabId: string): MicroTab {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`[MicroTabManager] Tab '${tabId}' not found.`);
    }
    return { ...tab };
  }

  /**
   * Close a tab and build the master PiPaymentDTO for checkout.
   *
   * @param tabId - The tab to close.
   * @returns A PiPaymentDTO covering the full tab total.
   * @throws {Error} If the tab is already paid, closed, or has no items.
   */
  closeAndBuild(tabId: string): PiPaymentDTO {
    const tab = this._requireOpenTab(tabId);

    if (tab.items.length === 0) {
      throw new Error(
        `[MicroTabManager] Cannot close empty tab '${tabId}'.`
      );
    }

    // Close the tab.
    tab.closedAt = new Date().toISOString();
    this.config.onTabUpdate({ ...tab });

    // Build the memo from item names.
    const itemSummary = tab.items
      .map((i) => `${i.quantity}× ${i.name}`)
      .join(", ");

    const memo = itemSummary.length <= 255
      ? itemSummary
      : itemSummary.slice(0, 252) + "...";

    return {
      amount: tab.totalAmount,
      memo,
      metadata: {
        tabId: tab.tabId,
        customerId: tab.customerId,
        itemCount: tab.items.length,
        openedAt: tab.openedAt,
        closedAt: tab.closedAt,
        note: `Tab for ${tab.customerId} — ${tab.items.length} item(s)`,
      },
    };
  }

  /**
   * Mark a tab as paid after the Pi payment is confirmed.
   *
   * @param tabId - The tab to mark as paid.
   */
  markPaid(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`[MicroTabManager] Tab '${tabId}' not found.`);
    }
    tab.paid = true;
    this.config.onTabUpdate({ ...tab });
  }

  /**
   * Returns all active (open, unpaid) tabs.
   */
  getActiveTabs(): MicroTab[] {
    return Array.from(this.tabs.values())
      .filter((t) => !t.paid && t.closedAt === null)
      .map((t) => ({ ...t }));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Retrieve a tab that is open and unpaid, or throw. */
  private _requireOpenTab(tabId: string): MicroTab {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      throw new Error(`[MicroTabManager] Tab '${tabId}' not found.`);
    }
    if (tab.paid) {
      throw new Error(
        `[MicroTabManager] Tab '${tabId}' has already been paid.`
      );
    }
    return tab;
  }

  /** Compute the total Pi amount for a list of items. */
  private _computeTotal(items: MicroTabItem[]): number {
    return parseFloat(
      items
        .reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
        .toFixed(7)
    );
  }
}
