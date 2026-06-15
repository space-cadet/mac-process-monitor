import { SystemSnapshot, ProcessImpact, BatteryImpactEvent } from '../types/index.js';

interface DrainPeriod {
  startTime: number;
  endTime: number;
  startPercent: number;
  endPercent: number;
  samples: SystemSnapshot[];
}

/**
 * Analyzes battery drain periods and correlates them with process activity.
 * Computes per-process battery impact scores over time.
 */
export class BatteryImpactAnalyzer {
  private currentDrain: DrainPeriod | null = null;
  private readonly minBatteryDropPercent: number;
  private readonly minDurationMinutes: number;

  constructor(
    minBatteryDropPercent: number = 1.0,
    minDurationMinutes: number = 2.0
  ) {
    this.minBatteryDropPercent = minBatteryDropPercent;
    this.minDurationMinutes = minDurationMinutes;
  }

  /**
   * Feed a new snapshot. Returns a completed drain event when a drain period ends.
   */
  addSample(snapshot: SystemSnapshot): BatteryImpactEvent | null {
    const battery = snapshot.battery;

    // If charging or plugged, end any active drain period
    if (battery.isCharging || battery.isPlugged) {
      if (this.currentDrain) {
        return this.finalizeDrain();
      }
      return null;
    }

    // If not draining (battery stable or rising), end drain period
    if (this.currentDrain && battery.percent >= this.currentDrain.startPercent) {
      return this.finalizeDrain();
    }

    // Start new drain period if battery is dropping and no active drain
    if (!this.currentDrain && this.isBatteryDropping(snapshot)) {
      this.currentDrain = {
        startTime: snapshot.timestamp,
        endTime: snapshot.timestamp,
        startPercent: battery.percent,
        endPercent: battery.percent,
        samples: [snapshot],
      };
      return null;
    }

    // Continue active drain period
    if (this.currentDrain) {
      this.currentDrain.endTime = snapshot.timestamp;
      this.currentDrain.endPercent = battery.percent;
      this.currentDrain.samples.push(snapshot);

      // Check if we should finalize (e.g., drain amount met)
      const drop = this.currentDrain.startPercent - this.currentDrain.endPercent;
      const duration = (this.currentDrain.endTime - this.currentDrain.startTime) / 60000;
      if (drop >= this.minBatteryDropPercent && duration >= this.minDurationMinutes) {
        return this.finalizeDrain();
      }
    }

    return null;
  }

  private isBatteryDropping(snapshot: SystemSnapshot): boolean {
    // Heuristic: battery < 100 and not charging
    return snapshot.battery.percent < 100 && !snapshot.battery.isCharging;
  }

  private finalizeDrain(): BatteryImpactEvent | null {
    if (!this.currentDrain) return null;

    const drain = this.currentDrain;
    this.currentDrain = null;

    const drop = drain.startPercent - drain.endPercent;
    const duration = (drain.endTime - drain.startTime) / 60000;

    if (drop < this.minBatteryDropPercent || duration < this.minDurationMinutes) {
      return null; // Too small to count
    }

    // Aggregate per-process CPU usage across all samples in drain period
    const processMap = new Map<string, { pids: Set<number>; cpuSum: number; memSum: number; samples: number; cpuSeconds: number }>();

    // Calculate total duration in seconds for cpu-seconds calculation
    const totalDurationSeconds = duration * 60;
    const sampleIntervalSeconds = totalDurationSeconds / Math.max(drain.samples.length - 1, 1);

    for (const sample of drain.samples) {
      for (const proc of sample.processes) {
        const key = proc.name;
        const existing = processMap.get(key);
        if (existing) {
          existing.pids.add(proc.pid);
          existing.cpuSum += proc.cpuPercent;
          existing.memSum += proc.memoryPercent;
          existing.samples++;
          // CPU-seconds = CPU% × time (simplified, as if CPU% were fraction of 1 core)
          existing.cpuSeconds += (proc.cpuPercent / 100) * sampleIntervalSeconds;
        } else {
          processMap.set(key, {
            pids: new Set([proc.pid]),
            cpuSum: proc.cpuPercent,
            memSum: proc.memoryPercent,
            samples: 1,
            cpuSeconds: (proc.cpuPercent / 100) * sampleIntervalSeconds,
          });
        }
      }
    }

    // Compute total cpu-seconds across all processes to normalize scores
    const totalCpuSeconds = Array.from(processMap.values()).reduce((sum, p) => sum + p.cpuSeconds, 0);

    const processImpacts: ProcessImpact[] = Array.from(processMap.entries())
      .map(([name, data]) => {
        const avgCpu = data.cpuSum / data.samples;
        const avgMem = data.memSum / data.samples;
        // Impact score = this process's share of total cpu-seconds during drain
        const impactScore = totalCpuSeconds > 0 ? (data.cpuSeconds / totalCpuSeconds) * drop : 0;
        return {
          processName: name,
          pid: Array.from(data.pids)[0], // Use first PID
          cpuSeconds: Math.round(data.cpuSeconds * 100) / 100,
          avgCpuPercent: Math.round(avgCpu * 100) / 100,
          avgMemoryPercent: Math.round(avgMem * 100) / 100,
          samples: data.samples,
          impactScore: Math.round(impactScore * 100) / 100,
        };
      })
      .sort((a, b) => b.impactScore - a.impactScore);

    const event: BatteryImpactEvent = {
      id: `${drain.startTime}-${drain.endTime}`,
      startTime: drain.startTime,
      endTime: drain.endTime,
      durationMinutes: Math.round(duration * 100) / 100,
      batteryDropPercent: Math.round(drop * 100) / 100,
      processImpacts: processImpacts.slice(0, 20), // Top 20
    };

    return event;
  }

  getCurrentDrain(): DrainPeriod | null {
    return this.currentDrain;
  }
}
