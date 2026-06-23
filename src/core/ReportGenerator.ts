import { TimeSeriesDB } from '../storage/TimeSeriesDB.js';

/**
 * Generates daily battery reports from TimeSeriesDB.
 * Provides battery health summary, drain event analysis, top CPU culprits, and insights.
 */
export class ReportGenerator {
  private db: TimeSeriesDB;

  constructor(db: TimeSeriesDB) {
    this.db = db;
  }

  /**
   * Generate a daily battery report for the given date.
   * @param date - Date string in YYYY-MM-DD format, or 'today' for the current day
   * @returns Markdown-formatted report string
   */
  generateReport(date: string | 'today'): string {
    const dayRange = this.resolveDateRange(date);
    const snapshots = this.db.getSnapshotsForDateRange(dayRange.start, dayRange.end);
    const drainEvents = this.db.getDrainEventsForDateRange(dayRange.start, dayRange.end);
    const topCpu = this.db.getTopProcessesForDateRange(dayRange.start, dayRange.end, 'cpu', 10);
    const topMem = this.db.getTopProcessesForDateRange(dayRange.start, dayRange.end, 'mem', 10);

    const lines: string[] = [];
    const dayLabel = date === 'today' ? 'Today' : date;

    lines.push(`# 🔋 Battery Report — ${dayLabel}`);
    lines.push('');
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // ── Battery Health Summary ──
    lines.push('## 📊 Battery Health Summary');
    lines.push('');
    if (snapshots.length === 0) {
      lines.push('*No snapshot data available for this day.*');
    } else {
      const batteryLevels = snapshots.map(s => s.battery_percent);
      const minBattery = Math.min(...batteryLevels);
      const maxBattery = Math.max(...batteryLevels);
      const avgBattery = batteryLevels.reduce((a, b) => a + b, 0) / batteryLevels.length;
      const chargingTime = this.computeChargingTime(snapshots);
      const dischargingTime = this.computeDischargingTime(snapshots);
      const sampleInterval = snapshots.length > 1
        ? Math.round((snapshots[snapshots.length - 1].timestamp - snapshots[0].timestamp) / (snapshots.length - 1) / 60000)
        : 0;

      lines.push(`| Metric | Value |`);
      lines.push(`|--------|-------|`);
      lines.push(`| Snapshots | ${snapshots.length} |`);
      lines.push(`| Min Battery | ${minBattery.toFixed(1)}% |`);
      lines.push(`| Max Battery | ${maxBattery.toFixed(1)}% |`);
      lines.push(`| Avg Battery | ${avgBattery.toFixed(1)}% |`);
      lines.push(`| Charging Time | ${chargingTime} min |`);
      lines.push(`| Discharging Time | ${dischargingTime} min |`);
      lines.push(`| Avg Sample Interval | ~${sampleInterval} min |`);
      lines.push('');

      // Battery trend
      const startPct = batteryLevels[0];
      const endPct = batteryLevels[batteryLevels.length - 1];
      const trend = endPct - startPct;
      const trendIcon = trend > 0 ? '↗' : trend < 0 ? '↘' : '→';
      lines.push(`**Battery Trend:** ${startPct.toFixed(1)}% → ${endPct.toFixed(1)}% (${trend > 0 ? '+' : ''}${trend.toFixed(1)}% ${trendIcon})`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');

    // ── Drain Events ──
    lines.push(`## ⚡ Drain Events (${drainEvents.length})`);
    lines.push('');
    if (drainEvents.length === 0) {
      lines.push('*No drain events detected today.*');
      lines.push('');
    } else {
      const totalDrain = drainEvents.reduce((sum, e) => sum + (e.startPercent - e.endPercent), 0);
      const avgRate = drainEvents.reduce((sum, e) => sum + e.drainRate, 0) / drainEvents.length;
      const totalDuration = drainEvents.reduce((sum, e) => sum + e.durationMinutes, 0);

      lines.push(`| Stat | Value |`);
      lines.push(`|------|-------|`);
      lines.push(`| Total Events | ${drainEvents.length} |`);
      lines.push(`| Total Battery Drop | ${totalDrain.toFixed(1)}% |`);
      lines.push(`| Avg Drain Rate | ${avgRate.toFixed(2)}%/min |`);
      lines.push(`| Total Drain Duration | ${totalDuration.toFixed(1)} min |`);
      lines.push('');

      lines.push('### Drain Event Details');
      lines.push('');
      lines.push(`| Time | Duration | Drop | Rate | Top Process |`);
      lines.push(`|------|----------|------|------|-------------|`);
      for (const evt of drainEvents) {
        const time = new Date(evt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const topProc = evt.topProcesses?.[0]?.name ?? 'N/A';
        lines.push(`| ${time} | ${evt.durationMinutes.toFixed(1)} min | ${(evt.startPercent - evt.endPercent).toFixed(1)}% | ${evt.drainRate.toFixed(2)}%/min | ${topProc} |`);
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('');

    // ── Top CPU Culprits ──
    lines.push('## 🔥 Top CPU Culprits');
    lines.push('');
    if (topCpu.length === 0) {
      lines.push('*No process data available for this day.*');
    } else {
      lines.push(`| Rank | Process | Avg CPU | Peak CPU | Samples |`);
      lines.push(`|------|---------|---------|----------|---------|`);
      for (let i = 0; i < topCpu.length; i++) {
        const p = topCpu[i];
        lines.push(`| ${i + 1} | ${p.name} | ${p.avg_cpu.toFixed(1)}% | ${p.peak_cpu.toFixed(1)}% | ${p.samples} |`);
      }
      lines.push('');
    }
    lines.push('');

    // ── Top Memory Culprits ──
    lines.push('## 💾 Top Memory Culprits');
    lines.push('');
    if (topMem.length === 0) {
      lines.push('*No process data available for this day.*');
    } else {
      lines.push(`| Rank | Process | Avg Mem | Peak Mem | Samples |`);
      lines.push(`|------|---------|---------|----------|---------|`);
      for (let i = 0; i < topMem.length; i++) {
        const p = topMem[i];
        lines.push(`| ${i + 1} | ${p.name} | ${p.avg_mem.toFixed(1)}% | ${p.peak_mem.toFixed(1)}% | ${p.samples} |`);
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('');

    // ── Insights ──
    lines.push('## 💡 Insights');
    lines.push('');
    const insights = this.generateInsights(snapshots, drainEvents, topCpu, topMem);
    if (insights.length === 0) {
      lines.push('*No insights generated for this day.*');
    } else {
      for (const insight of insights) {
        lines.push(`- ${insight}`);
      }
    }
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('*End of report*');

    return lines.join('\n');
  }

  /**
   * Resolve a date string to a start/end timestamp pair (inclusive start, exclusive end).
   */
  private resolveDateRange(date: string | 'today'): { start: number; end: number } {
    let d: Date;
    if (date === 'today') {
      d = new Date();
    } else {
      d = new Date(date + 'T00:00:00');
      if (isNaN(d.getTime())) {
        throw new Error(`Invalid date format: ${date}. Use YYYY-MM-DD.`);
      }
    }

    // Start of day in local time
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return { start, end };
  }

  /**
   * Estimate total charging time in minutes based on consecutive charging snapshots.
   */
  private computeChargingTime(snapshots: any[]): number {
    let total = 0;
    let chunkStart: number | null = null;

    for (let i = 0; i < snapshots.length; i++) {
      const s = snapshots[i];
      const next = snapshots[i + 1];
      if (s.is_charging) {
        if (chunkStart === null) chunkStart = s.timestamp;
      } else if (chunkStart !== null) {
        const end = next ? next.timestamp : s.timestamp;
        total += (end - chunkStart) / 60000;
        chunkStart = null;
      }
    }
    if (chunkStart !== null) {
      total += (snapshots[snapshots.length - 1].timestamp - chunkStart) / 60000;
    }
    return Math.round(total);
  }

  /**
   * Estimate total discharging time in minutes based on consecutive non-charging snapshots.
   */
  private computeDischargingTime(snapshots: any[]): number {
    let total = 0;
    let chunkStart: number | null = null;

    for (let i = 0; i < snapshots.length; i++) {
      const s = snapshots[i];
      const next = snapshots[i + 1];
      if (!s.is_charging) {
        if (chunkStart === null) chunkStart = s.timestamp;
      } else if (chunkStart !== null) {
        const end = next ? next.timestamp : s.timestamp;
        total += (end - chunkStart) / 60000;
        chunkStart = null;
      }
    }
    if (chunkStart !== null) {
      total += (snapshots[snapshots.length - 1].timestamp - chunkStart) / 60000;
    }
    return Math.round(total);
  }

  /**
   * Generate human-readable insights from the day's data.
   */
  private generateInsights(
    snapshots: any[],
    drainEvents: any[],
    topCpu: any[],
    topMem: any[]
  ): string[] {
    const insights: string[] = [];

    if (snapshots.length < 2) {
      return insights;
    }

    const batteryLevels = snapshots.map(s => s.battery_percent);
    const netDrain = batteryLevels[0] - batteryLevels[batteryLevels.length - 1];

    // Overall battery insight
    if (netDrain > 0) {
      insights.push(`Battery dropped by **${netDrain.toFixed(1)}%** over the day.`);
    } else if (netDrain < 0) {
      insights.push(`Battery gained **${Math.abs(netDrain).toFixed(1)}%** — net charging.`);
    } else {
      insights.push(`Battery level stayed flat at **${batteryLevels[0].toFixed(0)}%** throughout the day.`);
    }

    // Drain event insights
    if (drainEvents.length > 0) {
      const worstDrain = drainEvents.reduce((a, b) => (a.drainRate > b.drainRate ? a : b));
      const worstDrop = drainEvents.reduce((a, b) => (a.startPercent - a.endPercent > b.startPercent - b.endPercent ? a : b));
      insights.push(`Fastest drain event: **${worstDrain.drainRate.toFixed(2)}%/min** at ${new Date(worstDrain.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`);
      insights.push(`Largest single drop: **${(worstDrop.startPercent - worstDrop.endPercent).toFixed(1)}%** over ${worstDrop.durationMinutes.toFixed(1)} min.`);
    }

    // Top CPU insight
    if (topCpu.length > 0) {
      const top = topCpu[0];
      insights.push(`**${top.name}** was the top CPU consumer, averaging **${top.avg_cpu.toFixed(1)}%** across ${top.samples} samples.`);
      if (topCpu.length > 1) {
        const second = topCpu[1];
        const ratio = top.avg_cpu / (second.avg_cpu || 1);
        if (ratio > 2) {
          insights.push(`${top.name} used **${ratio.toFixed(1)}x** more CPU than the next process (${second.name}).`);
        }
      }
    }

    // Top memory insight
    if (topMem.length > 0) {
      const top = topMem[0];
      insights.push(`**${top.name}** was the top memory consumer, averaging **${top.avg_mem.toFixed(1)}%** RAM.`);
    }

    // Charging insight
    const chargingCount = snapshots.filter(s => s.is_charging).length;
    const chargingRatio = chargingCount / snapshots.length;
    if (chargingRatio > 0.5) {
      insights.push(`Device was plugged in for **${(chargingRatio * 100).toFixed(0)}%** of monitored samples.`);
    } else if (chargingRatio < 0.1) {
      insights.push(`Device was mostly unplugged — only **${(chargingRatio * 100).toFixed(0)}%** of samples showed charging.`);
    }

    return insights;
  }
}
