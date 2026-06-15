import { SystemCollector } from './SystemCollector.js';
import { DrainAnalyzer } from './DrainAnalyzer.js';
import { SpikeDetector } from './SpikeDetector.js';
import { BatteryImpactAnalyzer } from './BatteryImpactAnalyzer.js';
import { TimeSeriesDB } from '../storage/TimeSeriesDB.js';
import { MonitorConfig, AlertConfig, DrainEvent, ProcessSpike, BatteryImpactEvent } from '../types/index.js';

/**
 * Main monitor orchestrator.
 * Runs the sampling loop, coordinates collector → analyzer → storage → alerts.
 */
export class Monitor {
  private collector: SystemCollector;
  private analyzer: DrainAnalyzer;
  private spikeDetector: SpikeDetector;
  private batteryImpactAnalyzer: BatteryImpactAnalyzer;
  private db: TimeSeriesDB;
  private config: MonitorConfig;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(config: Partial<MonitorConfig> = {}) {
    this.config = {
      sampleIntervalSeconds: 30,
      dbPath: '~/.procmon/monitor.db',
      retentionDays: 30,
      alert: {
        enabled: true,
        drainThreshold: 1.0,    // % per minute
        minDuration: 2,           // minutes
        cooldownMinutes: 10,
      },
      spike: {
        enabled: true,
        thresholds: {
          cpuPercent: 50,          // Absolute threshold: 50% CPU
          memoryPercent: 20,       // Absolute threshold: 20% memory
          cpuMultiplier: 3,        // 3x above baseline
          memoryMultiplier: 3,     // 3x above baseline
          minBaselineSamples: 5,   // Need 5 samples before multiplier kicks in
          cooldownSeconds: 60,     // 1 minute between spikes for same process
        },
        watchedProcesses: [],
        ignoredProcesses: ['kernel_task', 'WindowServer', 'mds', 'mdworker'],
      },
      batteryImpact: {
        enabled: true,
        analysisWindowMinutes: 5,
        minBatteryDropPercent: 2.0,
        minDurationMinutes: 2,
        scoreDecayHours: 168,      // 7 days (optional, not yet implemented)
      },
      ...config,
    };

    this.collector = new SystemCollector();
    this.analyzer = new DrainAnalyzer(
      5,  // 5-minute analysis window
      this.config.sampleIntervalSeconds
    );
    this.spikeDetector = new SpikeDetector(
      this.config.spike.thresholds,
      this.config.spike.watchedProcesses,
      this.config.spike.ignoredProcesses
    );
    this.batteryImpactAnalyzer = new BatteryImpactAnalyzer(
      this.config.batteryImpact.minBatteryDropPercent,
      this.config.batteryImpact.minDurationMinutes
    );
    this.db = new TimeSeriesDB(this.config.dbPath);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(`[Monitor] Starting — sampling every ${this.config.sampleIntervalSeconds}s`);
    console.log(`[Monitor] DB: ${this.config.dbPath}`);
    console.log(`[Monitor] Alert threshold: ${this.config.alert.drainThreshold}%/min`);
    console.log(`[Monitor] Spike detection: ${this.config.spike.enabled ? 'ON' : 'OFF'}`);
    console.log(`[Monitor] Battery impact tracking: ${this.config.batteryImpact.enabled ? 'ON' : 'OFF'}`);

    // Initial sample
    await this.tick();

    // Schedule recurring samples
    this.timer = setInterval(
      () => this.tick(),
      this.config.sampleIntervalSeconds * 1000
    );
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.db.close();
    console.log('[Monitor] Stopped');
  }

  private async tick(): Promise<void> {
    try {
      console.log(`[Monitor] Tick at ${new Date().toISOString()}`);
      const snapshot = await this.collector.getSystemSnapshot();
      
      // Store in DB
      const snapshotId = this.db.insertSnapshot(snapshot);
      
      // Feed to analyzer
      this.analyzer.addSample(snapshot);
      
      // Check for drain
      const event = this.analyzer.analyze(
        this.config.alert.drainThreshold,
        this.config.alert.minDuration,
        this.config.alert.cooldownMinutes
      );
      
      if (event) {
        this.handleDrainEvent(event);
      }

      // Spike detection
      if (this.config.spike.enabled) {
        const spikes = this.spikeDetector.detectSpikes(snapshot.processes, snapshotId);
        for (const spike of spikes) {
          this.handleSpike(spike);
        }
      }

      // Battery impact analysis
      if (this.config.batteryImpact.enabled) {
        const impactEvent = this.batteryImpactAnalyzer.addSample(snapshot);
        if (impactEvent) {
          this.handleBatteryImpactEvent(impactEvent);
        }
      }
      
      // Periodic cleanup
      if (Math.random() < 0.01) {  // ~1% chance per tick
        this.db.cleanupOldSamples(this.config.retentionDays);
      }
      
    } catch (err) {
      console.error('[Monitor] Tick error:', err);
    }
  }

  private handleDrainEvent(event: DrainEvent): void {
    console.log(`\n⚠️  RAPID DRAIN DETECTED`);
    console.log(`   Battery: ${event.startPercent}% → ${event.endPercent}% (${event.drainRate.toFixed(2)}%/min)`);
    console.log(`   Duration: ${event.durationMinutes.toFixed(1)} minutes`);
    console.log(`   Top CPU processes:`);
    for (const proc of event.topProcesses) {
      console.log(`     • ${proc.name} (PID ${proc.pid}): ${proc.cpuPercent.toFixed(1)}% CPU`);
    }
    console.log();

    // Store event
    this.db.insertDrainEvent(event);

    // TODO: Send Telegram/OpenClaw alert
    if (this.config.alert.enabled) {
      this.sendAlert(event);
    }
  }

  private handleSpike(spike: ProcessSpike): void {
    console.log(`\n🔥 PROCESS SPIKE: ${spike.processName} (PID ${spike.pid})`);
    console.log(`   Metric: ${spike.metricType.toUpperCase()}`);
    console.log(`   Value: ${spike.value.toFixed(1)}% (baseline: ${spike.baseline.toFixed(1)}%, threshold: ${spike.threshold.toFixed(1)}%)`);
    console.log();

    this.db.insertProcessSpike(spike);
  }

  private handleBatteryImpactEvent(event: BatteryImpactEvent): void {
    console.log(`\n🔋 BATTERY IMPACT PERIOD DETECTED`);
    console.log(`   Battery: ${event.batteryDropPercent.toFixed(1)}% drop over ${event.durationMinutes.toFixed(1)} minutes`);
    console.log(`   Top process impacts:`);
    for (const proc of event.processImpacts.slice(0, 5)) {
      console.log(`     • ${proc.processName}: ${proc.impactScore.toFixed(2)} score (${proc.cpuSeconds.toFixed(1)} CPU-seconds, ${proc.avgCpuPercent.toFixed(1)}% avg CPU)`);
    }
    console.log();

    this.db.insertBatteryImpactEvent(event);
  }

  private async sendAlert(event: DrainEvent): Promise<void> {
    const message = this.formatAlertMessage(event);
    console.log('[Alert] Drain event detected:');
    console.log(message);

    // TODO: Implement actual Telegram/OpenClaw dispatch
    // For now, log to console. Override this method or pass a handler
    // to Monitor constructor for real alerting.
  }

  private formatAlertMessage(event: DrainEvent): string {
    const lines = [
      `⚠️ RAPID BATTERY DRAIN DETECTED`,
      ``,
      `Battery: ${event.startPercent}% → ${event.endPercent}%`,
      `Rate: ${event.drainRate.toFixed(2)}% per minute`,
      `Duration: ${event.durationMinutes.toFixed(1)} minutes`,
      ``,
      `Top CPU processes during drain:`,
      ...event.topProcesses.map(p => `  • ${p.name} (PID ${p.pid}): ${p.cpuPercent.toFixed(1)}% CPU`),
    ];
    return lines.join('\n');
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      sampleCount: this.analyzer.getSampleCount(),
      windowMinutes: this.analyzer.getWindowDurationMinutes(),
      db: this.db.getStats(),
      spikeBaselines: this.spikeDetector.getBaselineStats().size,
      batteryDrainActive: this.batteryImpactAnalyzer.getCurrentDrain() !== null,
    };
  }
}
