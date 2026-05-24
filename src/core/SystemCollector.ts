import si from 'systeminformation';
import {
  BatterySample,
  ProcessSnapshot,
  SystemSnapshot,
} from '../types/index.js';

/**
 * Collects system information using systeminformation library.
 * Samples battery state and process list at regular intervals.
 */
export class SystemCollector {
  async getBattery(): Promise<BatterySample> {
    const battery = await si.battery();
    return {
      timestamp: Date.now(),
      percent: battery.percent,
      isCharging: battery.ischarging,
      isPlugged: battery.acconnected,
      timeRemaining: battery.timeremaining >= 0 ? battery.timeremaining : null,
      cycleCount: battery.cyclecount >= 0 ? battery.cyclecount : null,
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
      memoryPercent: p.memRss * 1024 / memTotal.total * 100,  // memRss is in KB
      rssMB: Math.round(p.memRss / 1024 * 100) / 100,  // KB to MB (memRss is in KB)
      vmsMB: Math.round(p.memVsz / 1024 / 1024 * 100) / 100,
      cmdline: p.command || p.name,
    }));
  }

  async getSystemSnapshot(): Promise<SystemSnapshot> {
    const [battery, processes, load, mem] = await Promise.all([
      this.getBattery(),
      this.getProcesses(),
      si.currentLoad(),
      si.mem(),
    ]);

    // currentLoad returns { currentload: number, ... } or sometimes undefined
    const cpuTotal = load?.currentload ?? load?.avgload ?? 0;

    return {
      timestamp: Date.now(),
      battery,
      processes: processes.sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 50),
      cpuTotal,
      memoryTotal: mem.used / mem.total * 100,
    };
  }
}