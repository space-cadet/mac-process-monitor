import { ProcessSnapshot, ProcessSpike, SpikeThresholds } from '../types/index.js';

interface ProcessBaseline {
  cpuSamples: number[];
  memorySamples: number[];
  maxSamples: number;
  lastSpikeTime: number;
}

/**
 * Detects resource usage spikes in individual processes.
 * Maintains per-process baselines and triggers when thresholds are exceeded.
 */
export class SpikeDetector {
  private baselines = new Map<string, ProcessBaseline>();
  private readonly thresholds: SpikeThresholds;
  private readonly watchedProcesses: string[];
  private readonly ignoredProcesses: string[];
  private readonly maxBaselineSamples: number;

  constructor(
    thresholds: SpikeThresholds,
    watchedProcesses: string[] = [],
    ignoredProcesses: string[] = [],
    maxBaselineSamples: number = 20
  ) {
    this.thresholds = thresholds;
    this.watchedProcesses = watchedProcesses.map(s => s.toLowerCase());
    this.ignoredProcesses = ignoredProcesses.map(s => s.toLowerCase());
    this.maxBaselineSamples = maxBaselineSamples;
  }

  /**
   * Analyze a snapshot's processes and return any detected spikes.
   */
  detectSpikes(processes: ProcessSnapshot[], snapshotId: number): ProcessSpike[] {
    const spikes: ProcessSpike[] = [];
    const now = Date.now();

    for (const proc of processes) {
      const nameLower = proc.name.toLowerCase();

      // Skip ignored processes
      if (this.ignoredProcesses.some(ign => nameLower.includes(ign))) continue;

      // If watchlist is specified, only watch those
      if (this.watchedProcesses.length > 0 && !this.watchedProcesses.some(w => nameLower.includes(w))) continue;

      const baseline = this.getOrCreateBaseline(proc.name);

      // Check cooldown
      if (now - baseline.lastSpikeTime < this.thresholds.cooldownSeconds * 1000) {
        this.updateBaseline(baseline, proc);
        continue;
      }

      // Compute baseline averages
      const avgCpu = baseline.cpuSamples.length > 0
        ? baseline.cpuSamples.reduce((a, b) => a + b, 0) / baseline.cpuSamples.length
        : 0;
      const avgMem = baseline.memorySamples.length > 0
        ? baseline.memorySamples.reduce((a, b) => a + b, 0) / baseline.memorySamples.length
        : 0;

      const hasEnoughBaseline = baseline.cpuSamples.length >= this.thresholds.minBaselineSamples;

      // Check CPU spike
      if (this.isSpike(proc.cpuPercent, avgCpu, this.thresholds.cpuPercent, this.thresholds.cpuMultiplier, hasEnoughBaseline)) {
        spikes.push({
          id: `${now}-${proc.pid}-${proc.name}-cpu`,
          timestamp: now,
          processName: proc.name,
          pid: proc.pid,
          metricType: 'cpu',
          value: proc.cpuPercent,
          baseline: Math.round(avgCpu * 100) / 100,
          threshold: hasEnoughBaseline
            ? Math.max(this.thresholds.cpuPercent, avgCpu * this.thresholds.cpuMultiplier)
            : this.thresholds.cpuPercent,
          snapshotId,
        });
        baseline.lastSpikeTime = now;
      }

      // Check memory spike
      if (this.isSpike(proc.memoryPercent, avgMem, this.thresholds.memoryPercent, this.thresholds.memoryMultiplier, hasEnoughBaseline)) {
        spikes.push({
          id: `${now}-${proc.pid}-${proc.name}-mem`,
          timestamp: now,
          processName: proc.name,
          pid: proc.pid,
          metricType: 'memory',
          value: proc.memoryPercent,
          baseline: Math.round(avgMem * 100) / 100,
          threshold: hasEnoughBaseline
            ? Math.max(this.thresholds.memoryPercent, avgMem * this.thresholds.memoryMultiplier)
            : this.thresholds.memoryPercent,
          snapshotId,
        });
        baseline.lastSpikeTime = now;
      }

      // Update baseline after checking (spike values are NOT added to baseline)
      this.updateBaseline(baseline, proc);
    }

    return spikes;
  }

  private getOrCreateBaseline(processName: string): ProcessBaseline {
    if (!this.baselines.has(processName)) {
      this.baselines.set(processName, {
        cpuSamples: [],
        memorySamples: [],
        maxSamples: this.maxBaselineSamples,
        lastSpikeTime: 0,
      });
    }
    return this.baselines.get(processName)!;
  }

  private updateBaseline(baseline: ProcessBaseline, proc: ProcessSnapshot): void {
    baseline.cpuSamples.push(proc.cpuPercent);
    baseline.memorySamples.push(proc.memoryPercent);
    if (baseline.cpuSamples.length > baseline.maxSamples) {
      baseline.cpuSamples.shift();
    }
    if (baseline.memorySamples.length > baseline.maxSamples) {
      baseline.memorySamples.shift();
    }
  }

  private isSpike(
    value: number,
    baseline: number,
    absoluteThreshold: number,
    multiplier: number,
    hasEnoughBaseline: boolean
  ): boolean {
    // Absolute threshold always applies
    if (value >= absoluteThreshold) return true;

    // Baseline multiplier only if we have enough baseline data
    if (hasEnoughBaseline && baseline > 0 && value >= baseline * multiplier) return true;

    return false;
  }

  getBaselineStats(): Map<string, { cpuAvg: number; memAvg: number; samples: number }> {
    const stats = new Map<string, { cpuAvg: number; memAvg: number; samples: number }>();
    for (const [name, baseline] of this.baselines.entries()) {
      const cpuAvg = baseline.cpuSamples.length > 0
        ? baseline.cpuSamples.reduce((a, b) => a + b, 0) / baseline.cpuSamples.length
        : 0;
      const memAvg = baseline.memorySamples.length > 0
        ? baseline.memorySamples.reduce((a, b) => a + b, 0) / baseline.memorySamples.length
        : 0;
      stats.set(name, { cpuAvg: Math.round(cpuAvg * 100) / 100, memAvg: Math.round(memAvg * 100) / 100, samples: baseline.cpuSamples.length });
    }
    return stats;
  }
}
