import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const DEVICE_CONFIG_DIR = join(homedir(), '.procmon', 'config');
const DEVICE_CONFIG_PATH = join(DEVICE_CONFIG_DIR, 'device.json');

export interface DeviceIdentity {
  did: string;
  name: string;
  version: string;
  platform: string;
  arch: string;
}

let identityCache: DeviceIdentity | null = null;

function generateUUIDv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getPackageVersion(): string {
  try {
    const pkgPath = join(process.cwd(), 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '2.0.0';
    }
  } catch {
    // ignore
  }
  return '2.0.0';
}

function getDefaultName(): string {
  const hostname = require('os').hostname();
  return hostname || 'procmon-device';
}

function loadOrCreateIdentity(): DeviceIdentity {
  try {
    if (existsSync(DEVICE_CONFIG_PATH)) {
      const raw = readFileSync(DEVICE_CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.did) {
        return {
          did: parsed.did,
          name: parsed.name || getDefaultName(),
          version: parsed.version || getPackageVersion(),
          platform: parsed.platform || process.platform,
          arch: parsed.arch || process.arch,
        };
      }
    }
  } catch {
    // ignore parse errors, create new
  }

  const identity: DeviceIdentity = {
    did: generateUUIDv4(),
    name: getDefaultName(),
    version: getPackageVersion(),
    platform: process.platform,
    arch: process.arch,
  };

  try {
    if (!existsSync(DEVICE_CONFIG_DIR)) {
      mkdirSync(DEVICE_CONFIG_DIR, { recursive: true });
    }
    writeFileSync(DEVICE_CONFIG_PATH, JSON.stringify(identity, null, 2));
  } catch (err) {
    console.error('[DeviceIdentity] Failed to persist identity:', (err as Error).message);
  }

  return identity;
}

export function getIdentity(): DeviceIdentity {
  if (!identityCache) {
    identityCache = loadOrCreateIdentity();
  }
  return identityCache;
}

export function getDid(): string {
  return getIdentity().did;
}

export function getName(): string {
  return getIdentity().name;
}

export function setName(newName: string): void {
  const identity = getIdentity();
  identity.name = newName;
  identityCache = identity;
  try {
    if (!existsSync(DEVICE_CONFIG_DIR)) {
      mkdirSync(DEVICE_CONFIG_DIR, { recursive: true });
    }
    writeFileSync(DEVICE_CONFIG_PATH, JSON.stringify(identity, null, 2));
  } catch (err) {
    console.error('[DeviceIdentity] Failed to update name:', (err as Error).message);
  }
}
