import si from 'systeminformation';
import {
  BatterySample,
  ProcessSnapshot,
  SystemSnapshot,
} from '../types/index.js';

/**
 * Collects system information using systeminformation library.
 * Samples battery state, process list, CPU load, memory, disk I/O,
 * network I/O, disk usage, and CPU temperature at regular intervals.
 */
export class SystemCollector {
  async getBattery(): Promise<BatterySample> {
    const battery = await si.battery();
    return {
      timestamp: Date.now(),
      percent: battery.percent,
      isCharging: battery.isCharging,
      isPlugged: battery.acConnected,
      timeRemaining: battery.timeRemaining >= 0 ? battery.timeRemaining : null,
      cycleCount: battery.cycleCount >= 0 ? battery.cycleCount : null,
      temperature: battery.temperature >= 0 ? battery.temperature : null,
    };
  }

  async getProcesses(): Promise<ProcessSnapshot[]> {
    const [procs, memTotal] = await Promise.all([
      si.processes(),
      si.mem(),
    ]);
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
    }));
  }

  async getSystemSnapshot(): Promise<SystemSnapshot> {
    const [battery, processes, load, mem, diskIO, netStats, fsSize, cpuTemp] = await Promise.all([
      this.getBattery(),
      this.getProcesses(),
      si.currentLoad(),
      si.mem(),
      si.disksIO().catch(() => null),
      si.networkStats().catch(() => []),
      si.fsSize().catch(() => []),
      si.cpuTemperature().catch(() => ({ main: null, max: null })),
    ]);

    // currentLoad returns { currentLoad: number, avgLoad: number, ... }
    const cpuTotal = load?.currentLoad ?? load?.avgLoad ?? 0;
    const cpuUser = load?.currentLoadUser ?? 0;
    const cpuSystem = load?.currentLoadSystem ?? 0;
    const cpuIdle = load?.currentLoadIdle ?? 0;

    // Find primary mount (usually / or C:\)
    const primaryMount = fsSize.find(f => f.mount === '/' || f.mount === 'C:\\') || fsSize[0];

    // Find first active network interface with data
    const primaryNet = netStats.find(n => n.operstate === 'up' && (n.rx_bytes > 0 || n.tx_bytes > 0)) || netStats[0];

    return {
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
      // Network
      netRxBytes: primaryNet?.rx_bytes ?? null,
      netTxBytes: primaryNet?.tx_bytes ?? null,
      // Disk usage
      fsUsedPercent: primaryMount?.use ?? null,
      // Thermal
      cpuTemp: cpuTemp?.main ?? cpuTemp?.max ?? null,
    };
  }
}