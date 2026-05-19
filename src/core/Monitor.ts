import { SystemCollector } from './SystemCollector.js';
import { DrainAnalyzer } from './DrainAnalyzer.js';
import { TimeSeriesDB } from '../storage/TimeSeriesDB.js';
import { MonitorConfig, AlertConfig, DrainEvent } from '../types/index.js';

/**
 * Main monitor orchestrator.
 * Runs the sampling loop, coordinates collector → analyzer → storage → alerts.
 */
export class Monitor {
  private collector: SystemCollector;
  private analyzer: DrainAnalyzer;
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
      ...config,
    };

    this.collector = new SystemCollector();
    this.analyzer = new DrainAnalyzer(
      5,  // 5-minute analysis window
      this.config.sampleIntervalSeconds
    );
    this.db = new TimeSeriesDB(this.config.dbPath);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log(`[Monitor] Starting — sampling every ${this.config.sampleIntervalSeconds}s`);
    console.log(`[Monitor] DB: ${this.config.dbPath}`);
    console.log(`[Monitor] Alert threshold: ${this.config.alert.drainThreshold}%/min`);

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
      this.db.insertSnapshot(snapshot);
      
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
    };
  }
}
