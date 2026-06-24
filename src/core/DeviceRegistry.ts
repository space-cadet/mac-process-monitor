import fs from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Device {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  arch: string;
  lastSeen: number;
  registeredAt: number;
  ip?: string;
  version?: string;
  endpoint?: { metrics: string };
  lastMetricsPoll?: number;
}

const DEVICES_PATH = join(homedir(), '.procmon', 'devices.json');

function loadDevices(): Device[] {
  try {
    if (fs.existsSync(DEVICES_PATH)) {
      return JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf8'));
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

function saveDevices(devices: Device[]): void {
  const dir = join(homedir(), '.procmon');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DEVICES_PATH, JSON.stringify(devices, null, 2));
}

export class DeviceRegistry {
  private devices: Device[];

  constructor() {
    this.devices = loadDevices();
  }

  register(device: Omit<Device, 'registeredAt' | 'lastSeen'>): Device {
    const existing = this.devices.find(d => d.id === device.id);
    const now = Date.now();
    if (existing) {
      existing.name = device.name;
      existing.hostname = device.hostname;
      existing.platform = device.platform;
      existing.arch = device.arch;
      existing.ip = device.ip;
      existing.version = device.version;
      if (device.endpoint) existing.endpoint = device.endpoint;
      existing.lastSeen = now;
      saveDevices(this.devices);
      return existing;
    }
    const newDevice: Device = {
      ...device,
      registeredAt: now,
      lastSeen: now,
    };
    this.devices.push(newDevice);
    saveDevices(this.devices);
    return newDevice;
  }

  heartbeat(id: string): Device | null {
    const device = this.devices.find(d => d.id === id);
    if (device) {
      device.lastSeen = Date.now();
      saveDevices(this.devices);
    }
    return device || null;
  }

  list(): Device[] {
    return this.devices.slice().sort((a, b) => b.lastSeen - a.lastSeen);
  }

  remove(id: string): boolean {
    const before = this.devices.length;
    this.devices = this.devices.filter(d => d.id !== id);
    if (this.devices.length !== before) {
      saveDevices(this.devices);
      return true;
    }
    return false;
  }
}
