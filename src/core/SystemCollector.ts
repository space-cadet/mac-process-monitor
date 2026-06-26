import si from 'systeminformation';
import { execSync } from 'child_process';
import {
  BatterySample,
  DiskVolume,
  NetworkInterface,
  ProcessSnapshot,
  SystemInfo,
  SystemSnapshot,
} from '../types/index.js';

/**
 * Collects system information using systeminformation library.
 * Samples battery state, process list, CPU load, memory, disk I/O,
 * network I/O, disk usage, and CPU temperature at regular intervals.
 * On macOS, also captures per-process energy impact via `top`.
 */
export class SystemCollector {
  private prevDiskIO: { rIO: number; wIO: number; timestamp: number } | null = null;
  private sampleIntervalSeconds = 30;
  private latestSnapshot: SystemSnapshot | null = null;

  getLatestSnapshot(): SystemSnapshot | null {
    return this.latestSnapshot;
  }
  /**
   * Parse macOS `top -l 1` output to extract energy impact (POWER column) per PID.
   * Returns a Map of pid -> energy impact score.
   */
  private getMacOSEnergyMap(): Map<number, number> {
    const energyMap = new Map<number, number>();
    try {
      // macOS top with all stats so we get the POWER column
      const output = execSync('top -l 1 -n 0', { encoding: 'utf8', timeout: 3000 });
      const lines = output.split('\n');
      let inProcesses = false;
      for (const line of lines) {
        // Header line ends with 'POWER' or similar; processes start after blank line
        if (line.trim().startsWith('PID') && line.includes('POWER')) {
          inProcesses = true;
          continue;
        }
        if (!inProcesses) continue;
        if (line.trim() === '') continue;
        const parts = line.trim().split(/\s+/);
        // POWER is typically near the end. On macOS top output the columns are:
        // PID COMMAND %CPU TIME #TH #WQ #PORTS MEM PURG CMPRS PGRP PPID STATE BOOSTS %CPU_ME %CPU_OTHRS UID FAULTS COW MSGSENT MSGRECV SYSBSD SYSMACH CSW PAGEINS IDLEW POWER INSTRS CYCLES JETPRI USER ...
        // We need to find POWER by position. The columns before POWER are fixed-ish.
        // A robust approach: find the index of 'POWER' in the header, then read that column.
        // Since we don't have the header index here, we'll use a regex heuristic.
        if (parts.length < 27) continue;
        const pid = parseInt(parts[0], 10);
        if (isNaN(pid)) continue;
        // POWER is typically around column 27 (0-indexed varies). Use last numeric before user name.
        // Heuristic: scan from the right, find the first numeric that could be POWER.
        // On macOS the tail is: ... PAGEINS IDLEW POWER INSTRS CYCLES JETPRI USER
        // So POWER is 4th from the right before USER.
        const userIdx = parts.findIndex((p, i) => i > 20 && /^[a-zA-Z_]/.test(p));
        if (userIdx > 0) {
          const powerIdx = userIdx - 4; // JETPRI, CYCLES, INSTRS, POWER
          if (powerIdx >= 0) {
            const power = parseFloat(parts[powerIdx]);
            if (!isNaN(power)) {
              energyMap.set(pid, power);
            }
          }
        }
      }
    } catch {
      // top may fail or be unavailable; silently ignore
    }
    return energyMap;
  }

  async getBattery(): Promise<BatterySample> {
    const battery = await si.battery();
    return {
      timestamp: Date.now(),
      percent: battery.percent,
      isCharging: battery.isCharging,
      isPlugged: battery.acConnected,
      timeRemaining: battery.timeRemaining >= 0 ? battery.timeRemaining : null,
      cycleCount: battery.cycleCount >= 0 ? battery.cycleCount : null,
      temperature: (battery as any).temperature >= 0 ? (battery as any).temperature : null,
      health: (battery as any).maxCapacity && (battery as any).designedCapacity
        ? Math.round((battery as any).maxCapacity / (battery as any).designedCapacity * 100)
        : null,
    };
  }

  async getProcesses(): Promise<ProcessSnapshot[]> {
    const [procs, memTotal] = await Promise.all([
      si.processes(),
      si.mem(),
    ]);

    // On macOS, fetch energy impact data from top
    const energyMap = process.platform === 'darwin' ? this.getMacOSEnergyMap() : new Map<number, number>();

    return procs.list.map((p) => ({
      pid: p.pid,
      name: p.name,
      cpuPercent: p.cpu,
      cpuUserPercent: p.cpuu ?? 0,
      cpuSystemPercent: p.cpus ?? 0,
      memoryPercent: p.memRss * 1024 / memTotal.total * 100,  // memRss is in KB
      rssMB: Math.round(p.memRss / 1024 * 100) / 100,  // KB to MB (memRss is in KB)
      vmsMB: Math.round(p.memVsz / 1024 / 1024 * 100) / 100,
      nice: p.nice ?? 0,
      state: p.state ?? 'unknown',
      cmdline: p.command || p.name,
      energyMJ: energyMap.get(p.pid) ?? null,
    }));
  }

  async getSystemSnapshot(): Promise<SystemSnapshot> {
    const [
      battery, processes, load, mem, diskIO, netStats, fsSize, cpuTemp,
      netInterfaces, osInfo, cpuInfo
    ] = await Promise.all([
      this.getBattery(),
      this.getProcesses(),
      si.currentLoad(),
      si.mem(),
      si.disksIO().catch(() => null),
      si.networkStats().catch(() => []),
      si.fsSize().catch(() => []),
      si.cpuTemperature().catch(() => ({ main: null, max: null })),
      si.networkInterfaces().catch(() => []),
      si.osInfo().catch(() => ({ platform: 'unknown', distro: 'unknown', release: 'unknown', arch: 'unknown', hostname: 'unknown' })),
      si.cpu().catch(() => ({ manufacturer: 'unknown', brand: 'unknown', cores: 0, threads: 0 })),
    ]);

    // time() is synchronous
    let timeInfo: any = { uptime: 0, bootTime: 0 };
    try { timeInfo = si.time(); } catch {}

    // currentLoad returns { currentLoad: number, avgLoad: number, ... }
    const cpuTotal = load?.currentLoad ?? load?.avgLoad ?? 0;
    const cpuUser = load?.currentLoadUser ?? 0;
    const cpuSystem = load?.currentLoadSystem ?? 0;
    const cpuIdle = load?.currentLoadIdle ?? 0;

    // Find primary mount (usually / or C:\)
    // On macOS Catalina+, user data is on /System/Volumes/Data, not /
    const primaryMount = process.platform === 'darwin'
      ? (fsSize.find((f: any) => f.mount === '/System/Volumes/Data') || fsSize.find((f: any) => f.mount === '/') || fsSize[0])
      : (fsSize.find((f: any) => f.mount === '/' || f.mount === 'C:\\') || fsSize[0]);

    // Find first active network interface with data
    const primaryNet = netStats.find(n => n.operstate === 'up' && (n.rx_bytes > 0 || n.tx_bytes > 0)) || netStats[0];

    // Calculate disk I/O rates (bytes/sec) from deltas
    let diskReadRate: number | null = null;
    let diskWriteRate: number | null = null;
    if (diskIO && this.prevDiskIO) {
      const dtSeconds = (Date.now() - this.prevDiskIO.timestamp) / 1000;
      if (dtSeconds > 0) {
        const rDelta = (diskIO.rIO || 0) - this.prevDiskIO.rIO;
        const wDelta = (diskIO.wIO || 0) - this.prevDiskIO.wIO;
        diskReadRate = Math.max(0, rDelta) / dtSeconds;
        diskWriteRate = Math.max(0, wDelta) / dtSeconds;
      }
    }
    if (diskIO) {
      this.prevDiskIO = { rIO: diskIO.rIO || 0, wIO: diskIO.wIO || 0, timestamp: Date.now() };
    }

    // Build network interfaces list
    const networkInterfaces: NetworkInterface[] = netInterfaces
      .filter((iface: any) => !iface.internal)
      .map((iface: any) => {
        const stats = netStats.find((n: any) => n.iface === iface.iface);
        return {
          iface: iface.iface,
          ip4: iface.ip4,
          ip6: iface.ip6,
          mac: iface.mac,
          operstate: stats?.operstate || iface.operstate || 'unknown',
          rx_bytes: stats?.rx_bytes || 0,
          tx_bytes: stats?.tx_bytes || 0,
          rx_dropped: stats?.rx_dropped || 0,
          tx_dropped: stats?.tx_dropped || 0,
          rx_errors: stats?.rx_errors || 0,
          tx_errors: stats?.tx_errors || 0,
          speed: (stats as any)?.speed || (iface as any)?.speed,
          duplex: (stats as any)?.duplex || (iface as any)?.duplex,
        };
      });

    // Build disk volumes list
    const diskVolumes: DiskVolume[] = fsSize.map((fs: any) => ({
      fs: fs.fs,
      type: fs.type,
      size: fs.size,
      used: fs.used,
      available: fs.available,
      use: fs.use,
      mount: fs.mount,
      rw: fs.rw,
    }));

    // System info
    const systemInfo: SystemInfo = {
      platform: osInfo.platform || 'unknown',
      distro: osInfo.distro || 'unknown',
      release: osInfo.release || 'unknown',
      arch: osInfo.arch || 'unknown',
      hostname: osInfo.hostname || 'unknown',
      uptime: timeInfo.uptime || 0,
      bootTime: timeInfo.bootTime || 0,
      cpuModel: (cpuInfo as any).brand || 'unknown',
      cpuCores: (cpuInfo as any).cores || 0,
      cpuThreads: (cpuInfo as any).threads || (cpuInfo as any).cores || 0,
    };

    const result = {
      timestamp: Date.now(),
      battery,
      processes: processes.sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 50),
      // CPU
      cpuTotal,
      cpuUser,
      cpuSystem,
      cpuIdle,
      // Memory
      memoryTotal: mem.used / mem.total * 100,
      memoryUsedMB: Math.round(mem.used / 1024 / 1024 * 100) / 100,
      memoryFreeMB: Math.round(mem.free / 1024 / 1024 * 100) / 100,
      swapUsedMB: Math.round(mem.swapused / 1024 / 1024 * 100) / 100,
      swapTotalMB: Math.round(mem.swaptotal / 1024 / 1024 * 100) / 100,
      // Load
      loadAvg: load?.avgLoad ?? 0,
      // Disk I/O
      diskReadIO: diskIO?.rIO ?? null,
      diskWriteIO: diskIO?.wIO ?? null,
      diskTotalIO: diskIO?.tIO ?? null,
      diskReadRate,
      diskWriteRate,
      // Network
      netRxBytes: primaryNet?.rx_bytes ?? null,
      netTxBytes: primaryNet?.tx_bytes ?? null,
      networkInterfaces,
      // Disk usage
      fsUsedPercent: primaryMount?.use ?? null,
      diskVolumes,
      // Thermal
      cpuTemp: cpuTemp?.main ?? cpuTemp?.max ?? null,
      // System info
      systemInfo,
    };

    this.latestSnapshot = result;
    return result;
  }
}