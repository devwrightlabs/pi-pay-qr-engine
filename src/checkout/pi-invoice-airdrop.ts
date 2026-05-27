/**
 * @fileoverview pi-invoice-airdrop — Web Bluetooth LE invoice beaming.
 *
 * Silently beams the Pi invoice payload directly to a nearby customer's
 * phone via Bluetooth Low Energy (BLE), bypassing the need for a physical
 * camera scan. The merchant's POS device acts as a BLE peripheral that
 * broadcasts an invoice characteristic; the customer's device discovers and
 * reads it.
 *
 * Uses the Web Bluetooth API (navigator.bluetooth) which is available in
 * modern browsers and the Pi Browser webview.
 *
 * GATT Profile used:
 *   Service UUID  : 0000FEE0-0000-1000-8000-00805F9B34FB  (Pi Pay service)
 *   Characteristic: 0000FEE1-0000-1000-8000-00805F9B34FB  (Invoice payload)
 *   Permission    : Read + Notify
 */

import type { AirdropResult, QRPayload } from "../types/payment.js";

// ---------------------------------------------------------------------------
// BLE Constants
// ---------------------------------------------------------------------------

const PI_PAY_SERVICE_UUID = "0000fee0-0000-1000-8000-00805f9b34fb";
const PI_INVOICE_CHARACTERISTIC_UUID = "0000fee1-0000-1000-8000-00805f9b34fb";

/** Maximum BLE MTU for a single notification packet (bytes). */
const BLE_MTU = 512;

// ---------------------------------------------------------------------------
// PiInvoiceAirdrop
// ---------------------------------------------------------------------------

/**
 * PiInvoiceAirdrop — beams a Pi invoice payload to a nearby device via BLE.
 *
 * @example
 * ```ts
 * // On the merchant POS (sender):
 * const airdrop = new PiInvoiceAirdrop();
 * const result = await airdrop.send(qrPayload);
 *
 * if (result.success) {
 *   console.log(`Invoice sent to ${result.deviceName}`);
 * }
 * ```
 */
export class PiInvoiceAirdrop {
  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Beam a QR payload to the nearest BLE-enabled device.
   *
   * Initiates a BLE scan, connects to the first device advertising the
   * Pi Pay service UUID, and writes the serialised payload to the invoice
   * characteristic.
   *
   * @param payload       - The QR payload to transmit.
   * @param timeoutMs     - Discovery timeout in ms. Default: 15000.
   * @returns Promise resolving to an AirdropResult.
   */
  async send(
    payload: QRPayload,
    timeoutMs = 15_000
  ): Promise<AirdropResult> {
    if (!this._isBluetoothAvailable()) {
      return {
        success: false,
        deviceName: null,
        airdropAt: new Date().toISOString(),
        error:
          "Web Bluetooth API is not available in this browser / environment.",
      };
    }

    try {
      const device = await this._requestDevice(timeoutMs);
      const deviceName = device.name ?? null;

      await this._writePayload(device, payload);

      return {
        success: true,
        deviceName,
        airdropAt: new Date().toISOString(),
        error: null,
      };
    } catch (err) {
      return {
        success: false,
        deviceName: null,
        airdropAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Listen for incoming invoice airdrops on the customer side.
   *
   * Scans for a merchant BLE device broadcasting the Pi Pay service UUID
   * and subscribes to invoice notifications.
   *
   * @param onInvoiceReceived - Callback invoked when an invoice is received.
   * @param timeoutMs         - Discovery timeout in ms. Default: 30000.
   * @returns Promise resolving when the device is found and subscribed.
   */
  async receive(
    onInvoiceReceived: (payload: QRPayload) => void,
    timeoutMs = 30_000
  ): Promise<{ deviceName: string | null; stop: () => void }> {
    if (!this._isBluetoothAvailable()) {
      throw new Error(
        "Web Bluetooth API is not available in this browser / environment."
      );
    }

    const device = await this._requestDevice(timeoutMs);
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(PI_PAY_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(
      PI_INVOICE_CHARACTERISTIC_UUID
    );

    const handler = (event: Event) => {
      try {
        const target = event.target as BluetoothRemoteGATTCharacteristic;
        const value = target.value;
        if (!value) return;

        const text = new TextDecoder().decode(value.buffer);
        const parsed: QRPayload = JSON.parse(text);
        onInvoiceReceived(parsed);
      } catch {
        // Ignore malformed packets.
      }
    };

    characteristic.addEventListener(
      "characteristicvaluechanged",
      handler
    );
    await characteristic.startNotifications();

    return {
      deviceName: device.name ?? null,
      stop: () => {
        characteristic.removeEventListener(
          "characteristicvaluechanged",
          handler
        );
        device.gatt?.disconnect();
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Check that the Web Bluetooth API is available.
   */
  private _isBluetoothAvailable(): boolean {
    return (
      typeof navigator !== "undefined" &&
      "bluetooth" in navigator &&
      typeof navigator.bluetooth.requestDevice === "function"
    );
  }

  /**
   * Request a BLE device advertising the Pi Pay service.
   */
  private async _requestDevice(
    timeoutMs: number
  ): Promise<BluetoothDevice> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [PI_PAY_SERVICE_UUID] }],
        optionalServices: [PI_PAY_SERVICE_UUID],
      });
      clearTimeout(timer);
      return device;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  /**
   * Connect to a BLE device and write the payload to the invoice characteristic.
   * Chunks the payload if it exceeds the BLE MTU.
   */
  private async _writePayload(
    device: BluetoothDevice,
    payload: QRPayload
  ): Promise<void> {
    if (!device.gatt) {
      throw new Error("Device does not expose a GATT server.");
    }

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(PI_PAY_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(
      PI_INVOICE_CHARACTERISTIC_UUID
    );

    const data = JSON.stringify(payload);
    const encoded = new TextEncoder().encode(data);

    if (encoded.byteLength > BLE_MTU) {
      // Multi-chunk write: prefix each chunk with a 2-byte sequence number.
      const chunks = Math.ceil(encoded.byteLength / (BLE_MTU - 2));
      for (let i = 0; i < chunks; i++) {
        const chunk = new Uint8Array(Math.min(BLE_MTU, encoded.byteLength - i * (BLE_MTU - 2)) + 2);
        chunk[0] = i;        // chunk index
        chunk[1] = chunks;   // total chunks
        chunk.set(
          encoded.slice(i * (BLE_MTU - 2), (i + 1) * (BLE_MTU - 2)),
          2
        );
        await characteristic.writeValueWithResponse(chunk.buffer);
      }
    } else {
      await characteristic.writeValueWithResponse(encoded.buffer);
    }

    server.disconnect();
  }
}
