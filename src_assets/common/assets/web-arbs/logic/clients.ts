// ARBS-H UI1b: paired device helpers (permissions = src/crypto.h PERM bits).

export const PERMISSIONS = [
  { key: 'list', bit: 0x01000000 },
  { key: 'view', bit: 0x02000000 },
  { key: 'launch', bit: 0x04000000 },
  { key: 'clipboard_set', bit: 0x00010000 },
  { key: 'clipboard_read', bit: 0x00020000 },
  { key: 'server_cmd', bit: 0x00100000 },
  { key: 'input_controller', bit: 0x00000100 },
  { key: 'input_touch', bit: 0x00000200 },
  { key: 'input_pen', bit: 0x00000400 },
  { key: 'input_mouse', bit: 0x00000800 },
  { key: 'input_kbd', bit: 0x00001000 },
] as const;

/** PERM::_all (inputs | operations incl. file transfer | actions). */
export const PERMISSION_ALL = 0x071f1f00;

export interface PairedDevice {
  uuid: string;
  name: string;
  connected: boolean;
  enabled: boolean;
  allow_sleep: boolean;
  perm: number;
  last_seen: number | string | null;
  raw: Record<string, unknown>;
}

export function normalizeDevice(raw: unknown, index: number): PairedDevice {
  const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const perm = Number(item.perm ?? 0);
  return {
    uuid: typeof item.uuid === 'string' && item.uuid ? item.uuid : `unknown-${index + 1}`,
    name: typeof item.name === 'string' ? item.name : '',
    connected: item.connected === true,
    enabled: item.enabled !== false,
    allow_sleep: item.allow_sleep === true,
    perm: Number.isFinite(perm) ? perm & PERMISSION_ALL : 0,
    last_seen: typeof item.last_seen === 'number' || typeof item.last_seen === 'string' ? item.last_seen : null,
    raw: item,
  };
}

export function hasPermission(mask: number, bit: number): boolean {
  return (mask & bit) !== 0;
}

export function togglePermission(mask: number, bit: number, on: boolean): number {
  return (on ? mask | bit : mask & ~bit) & PERMISSION_ALL;
}

export type DeviceStatus = 'streaming' | 'blocked' | 'active' | 'never_seen';

/** H-V2DEV-03 status words. */
export function deviceStatus(device: PairedDevice): DeviceStatus {
  if (!device.enabled || device.perm === 0) return 'blocked';
  if (device.connected) return 'streaming';
  if (device.last_seen === null || device.last_seen === 0 || device.last_seen === '') return 'never_seen';
  return 'active';
}

/**
 * POST /api/clients/update body for a name / permission / sleep change.
 * The server rewrites every per-device field when "name" or "perm" is present
 * (src/confighttp.cpp updateClient), so the fields this UI does not edit are sent
 * back unchanged from the latest list.
 */
export function updatePayload(
  device: PairedDevice,
  edit: { name: string; perm: number; allow_sleep: boolean },
): Record<string, unknown> {
  const raw = device.raw;
  const str = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
  const commands = (key: string) => (Array.isArray(raw[key]) ? raw[key] : []);
  return {
    uuid: device.uuid,
    name: edit.name.trim(),
    perm: edit.perm & PERMISSION_ALL,
    allow_sleep: edit.allow_sleep,
    enable_legacy_ordering: raw.enable_legacy_ordering !== false,
    allow_client_commands: raw.allow_client_commands !== false,
    always_use_virtual_display: raw.always_use_virtual_display === true,
    display_mode: str('display_mode'),
    output_name_override: str('output_name_override'),
    virtual_display_mode: str('virtual_display_mode'),
    virtual_display_layout: str('virtual_display_layout'),
    prefer_10bit_sdr: raw.prefer_10bit_sdr === true,
    do: commands('do'),
    undo: commands('undo'),
  };
}

/** PIN for POST /api/pin: digits only, max 4, zero-padded on the left (H-V2PAIR-03). */
export function cleanPin(input: string): string {
  return input.replace(/\D/g, '').slice(0, 4);
}
export function normalizedPin(pin: string): string {
  return cleanPin(pin).padStart(4, '0');
}
