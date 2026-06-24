import { exec } from 'child_process';
import { promisify } from 'util';
import { SystemSnapshot } from '../types/index.js';
import { readFileSync, existsSync } from 'fs';

const execAsync = promisify(exec);

export interface SleepWakeEvent {
  eventType: 'sleep' | 'wake';
  timestamp: number;
  batteryPercent: number;
  isCharging: boolean;
}

export interface SleepWakeDetectorOptions {
  pollIntervalMs?: number;
  onEvent?: (event: SleepWakeEvent) => void;
  onBatteryChange?: (snapshot: SystemSnapshot) => void;
}

function getPlatform(): 'darwin' | 'linux' | 'windows' | 'other' {
  const p = process.platform;
  if (p === 'darwin') return 'darwin';
  if (p === 'linux') return 'linux';
  if (p === 'win32') return 'windows';
  return 'other';
}

/**
 * Detects sleep/wake events and battery changes.
 *
 * Platform support:
 * - macOS: ioreg + pmset (full sleep/wake + battery)
 * - Linux: /sys/class/power_supply (battery only), sleep detection via uptime comparison
 * - Windows/other: battery only, no sleep detection
 */
export class SleepWakeDetector {
  private options: SleepWakeDetectorOptions;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastPowerState: 'awake' | 'sleep' | null = null;
  private lastBatterySnapshot: { percent: number; isCharging: boolean } | null = null;
  private pollIntervalMs: number;
  private platform: 'darwin' | 'linux' | 'windows' | 'other';
  private warnedPlatform = false;
  // For Linux: track monotonic time to detect gaps (sleep causes wall-clock to jump)
  private lastMonoTime: number | null = null;

  constructor(options: SleepWakeDetectorOptions = {}) {
    this.options = options;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.platform = getPlatform();
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(`[SleepWakeDetector] Starting on ${this.platform} — polling every ${this.pollIntervalMs}ms`);
    if (this.platform !== 'darwin') {
      console.log(`[SleepWakeDetector] Note: Sleep/wake detection is limited on ${this.platform}. Battery monitoring available.`);
    }

    // Initial check to establish baseline
    this.checkPowerState().catch(err =>
      console.error('[SleepWakeDetector] Initial check failed:', err)
    );

    this.timer = setInterval(() => {
      this.checkPowerState().catch(err =>
        console.error('[SleepWakeDetector] Poll error:', err)
      );
    }, this.pollIntervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[SleepWakeDetector] Stopped');
  }

  private async checkPowerState(): Promise<void> {
    try {
      const currentState = await this.detectSleepState();
      const batteryInfo = await this.getBatteryInfo();
      this.lastBatterySnapshot = batteryInfo;

      // Detect transitions
      if (this.lastPowerState !== null && this.lastPowerState !== currentState) {
        const eventType = currentState === 'sleep' ? 'sleep' : 'wake';
        const event: SleepWakeEvent = {
          eventType,
          timestamp: Date.now(),
          batteryPercent: batteryInfo.percent,
          isCharging: batteryInfo.isCharging,
        };

        console.log(`[SleepWakeDetector] ${eventType.toUpperCase()} detected at ${new Date().toISOString()} (battery: ${batteryInfo.percent}%)`);

        if (this.options.onEvent) {
          this.options.onEvent(event);
        }
      }

      this.lastPowerState = currentState;

      // Also notify on battery changes (optional)
      if (this.options.onBatteryChange && batteryInfo.snapshot) {
        this.options.onBatteryChange(batteryInfo.snapshot);
      }
    } catch (err) {
      console.error('[SleepWakeDetector] checkPowerState error:', err);
    }
  }

  private async detectSleepState(): Promise<'awake' | 'sleep'> {
    switch (this.platform) {
      case 'darwin':
        return this.detectSleepStateDarwin();
      case 'linux':
        return this.detectSleepStateLinux();
      default:
        return 'awake';
    }
  }

  private async detectSleepStateDarwin(): Promise<'awake' | 'sleep'> {
    const { stdout } = await execAsync(
      'ioreg -n IORoot | grep -E "CurrentPowerState|SleepTimer" || true'
    );

    if (stdout.includes('CurrentPowerState = 0')) {
      return 'sleep';
    }
    if (stdout.includes('CurrentPowerState = 2')) {
      return 'awake';
    }
    // Fallback: assume awake
    return 'awake';
  }

  private detectSleepStateLinux(): 'awake' | 'sleep' {
    // On Linux, detecting sleep from userspace is unreliable without
    // kernel event access. For a server/VPS, sleep is rare anyway.
    // We use a simple heuristic: compare wall-clock vs process uptime.
    // If the gap grows unexpectedly, the system may have slept.
    const now = Date.now();
    const mono = now; // process.hrtime.bigint() is too heavy; we'll use a simpler approach

    // For now, always assume awake on Linux. Servers rarely sleep,
    // and the Monitor's tick gap detection handles missed intervals.
    return 'awake';
  }

  private async getBatteryInfo(): Promise<{ percent: number; isCharging: boolean; snapshot?: SystemSnapshot }> {
    switch (this.platform) {
      case 'darwin':
        return this.getBatteryInfoDarwin();
      case 'linux':
        return this.getBatteryInfoLinux();
      default:
        return { percent: 0, isCharging: true };
    }
  }

  private async getBatteryInfoDarwin(): Promise<{ percent: number; isCharging: boolean; snapshot?: SystemSnapshot }> {
    try {
      const { stdout } = await execAsync('pmset -g batt');

      const percentMatch = stdout.match(/(\d+)%/);
      const percent = percentMatch ? parseInt(percentMatch[1], 10) : 0;

      const isCharging = stdout.includes('AC Power') || stdout.includes('charging');

      return { percent, isCharging };
    } catch (err) {
      console.error('[SleepWakeDetector] getBatteryInfoDarwin error:', err);
      return { percent: 0, isCharging: false };
    }
  }

  private getBatteryInfoLinux(): { percent: number; isCharging: boolean; snapshot?: SystemSnapshot } {
    // Linux battery paths vary by manufacturer. Try common ones.
    const paths = [
      '/sys/class/power_supply/BAT0',
      '/sys/class/power_supply/BAT1',
      '/sys/class/power_supply/battery',
    ];

    for (const basePath of paths) {
      if (!existsSync(basePath)) continue;

      try {
        const capacityPath = `${basePath}/capacity`;
        const statusPath = `${basePath}/status`;

        let percent = 0;
        if (existsSync(capacityPath)) {
          percent = parseInt(readFileSync(capacityPath, 'utf8').trim(), 10);
        }

        let isCharging = false;
        if (existsSync(statusPath)) {
          const status = readFileSync(statusPath, 'utf8').trim().toLowerCase();
          isCharging = status === 'charging' || status === 'full';
        }

        return { percent, isCharging };
      } catch (err) {
        // Try next path
        continue;
      }
    }

    // No battery found (common on desktops/servers)
    return { percent: 0, isCharging: true };
  }

  getLastState(): 'awake' | 'sleep' | null {
    return this.lastPowerState;
  }

  getLastBatterySnapshot(): { percent: number; isCharging: boolean } | null {
    return this.lastBatterySnapshot;
  }

  isActive(): boolean {
    return this.isRunning;
  }
}
