import { Client as DeviceRegistryClient } from "device-registry";

export interface DeviceRecord {
  owner: string;
  deviceType: string;
  lat: number;
  lon: number;
  active: boolean;
}

/**
 * Reads a device's full record directly from device-registry — needed
 * because the "reg_dev" event only carries device_type (see parse.ts),
 * not owner/lat/lon. A read-only simulated call, no signing required.
 * Returns null if the device doesn't exist or the call fails; this is
 * best-effort enrichment, not something that should ever fail a poll.
 */
export async function fetchDeviceRecord(
  rpcUrl: string,
  networkPassphrase: string,
  registryContractId: string,
  address: string,
): Promise<DeviceRecord | null> {
  try {
    const client = new DeviceRegistryClient({
      contractId: registryContractId,
      networkPassphrase,
      rpcUrl,
    });
    const tx = await client.get_device({ device: address });
    if (tx.result.isErr()) return null;
    const device = tx.result.unwrap();
    return {
      owner: device.owner,
      deviceType: device.device_type,
      lat: device.lat,
      lon: device.lon,
      active: device.active,
    };
  } catch (err) {
    console.warn(`[registry] failed to enrich device ${address}:`, err);
    return null;
  }
}
