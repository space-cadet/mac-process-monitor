import Database from 'better-sqlite3';
import fs from 'fs';
import {
  BatterySample,
  ProcessSnapshot,
  SystemSnapshot,
  ProcessSpike,
  BatteryImpactEvent,
  DrainEvent,
} from '../types/index.js';

/**
 * SQLite storage for time-series system snapshots and drain events.
 * Provides efficient querying for history and trend analysis.
 */
export class TimeSeriesDB {
  public db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string = '~/.procmon/monitor.db') {
    this.dbPath = dbPath.replace(/^~/, process.env.HOME || '');
    const fs = require('fs');
    const path = require('path');
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initTables();
    this.migrateSchema();
  }

  private tableHasColumn(table: string, column: string): boolean {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return cols.some(c => c.name === column);
  }

  private migrateSchema(): void {
    // Migrate snapshots table: add new columns if missing
    const snapshotCols = [
      { name: 'cpu_user', type: 'REAL' },
      { name: 'cpu_system', type: 'REAL' },
      { name: 'cpu_idle', type: 'REAL' },
      { name: 'memory_used_mb', type: 'REAL' },
      { name: 'memory_free_mb', type: 'REAL' },
      { name: 'swap_used_mb', type: 'REAL' },
      { name: 'swap_total_mb', type: 'REAL' },
      { name: 'load_avg', type: 'REAL' },
      { name: 'disk_read_io', type: 'REAL' },
      { name: 'disk_write_io', type: 'REAL' },
      { name: 'disk_total_io', type: 'REAL' },
      { name: 'net_rx_bytes', type: 'REAL' },
      { name: 'net_tx_bytes', type: 'REAL' },
      { name: 'fs_used_percent', type: 'REAL' },
      { name: 'cpu_temp', type: 'REAL' },
    ];
    for (const col of snapshotCols) {
      if (!this.tableHasColumn('snapshots', col.name)) {
        this.db.exec(`ALTER TABLE snapshots ADD COLUMN ${col.name} ${col.type}`);
      }
    }

    // Migrate process_samples table: add new columns if missing
    const processCols = [
      { name: 'cpu_user_percent', type: 'REAL' },
      { name: 'cpu_system_percent', type: 'REAL' },
      { name: 'nice', type: 'INTEGER' },
      { name: 'state', type: 'TEXT' },
      { name: 'energy_mj', type: 'REAL' },
    ];
    for (const col of processCols) {
      if (!this.tableHasColumn('process_samples', col.name)) {
        this.db.exec(`ALTER TABLE process_samples ADD COLUMN ${col.name} ${col.type}`);
      }
    }
  }

  private initTables(): void {
    // System snapshots - time series data
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        battery_percent REAL NOT NULL,
        is_charging INTEGER NOT NULL,
        cpu_total REAL,
        cpu_user REAL,
        cpu_system REAL,
        cpu_idle REAL,
        memory_total REAL,
        memory_used_mb REAL,
        memory_free_mb REAL,
        swap_used_mb REAL,
        swap_total_mb REAL,
        load_avg REAL,
        disk_read_io REAL,
        disk_write_io REAL,
        disk_total_io REAL,
        net_rx_bytes REAL,
        net_tx_bytes REAL,
        fs_used_percent REAL,
        cpu_temp REAL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(timestamp);
    `);

    // Process data per snapshot (denormalized for query speed)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS process_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL,
        pid INTEGER NOT NULL,
        name TEXT NOT NULL,
        cpu_percent REAL NOT NULL,
        cpu_user_percent REAL,
        cpu_system_percent REAL,
        memory_percent REAL NOT NULL,
        rss_mb REAL NOT NULL,
        nice INTEGER,
        state TEXT,
        cmdline TEXT,
        energy_mj REAL,
        FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
      );
      CREATE INDEX IF NOT EXISTS idx_processes_snapshot ON process_samples(snapshot_id);
      CREATE INDEX IF NOT EXISTS idx_processes_name ON process_samples(name);
    `);

    // Drain events - detected incidents
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS drain_events (
        id TEXT PRIMARY KEY,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        start_percent REAL NOT NULL,
        end_percent REAL NOT NULL,
        drain_rate REAL NOT NULL,
        duration_minutes REAL NOT NULL,
        was_charging INTEGER NOT NULL,
        top_processes_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_drain_time ON drain_events(start_time);
    `);

    // Sleep/wake events - power state transitions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sleep_wake_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL CHECK(event_type IN ('sleep', 'wake')),
        timestamp INTEGER NOT NULL,
        battery_percent REAL NOT NULL,
        is_charging INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sleep_wake_time ON sleep_wake_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_sleep_wake_type ON sleep_wake_events(event_type);
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS monitoring_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#3b82f6',
        processes_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    // Process spikes - detected resource usage spikes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS process_spikes (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        process_name TEXT NOT NULL,
        pid INTEGER NOT NULL,
        metric_type TEXT NOT NULL,
        value REAL NOT NULL,
        baseline REAL NOT NULL,
        threshold REAL NOT NULL,
        snapshot_id INTEGER,
        FOREIGN KEY (snapshot_id) REFERENCES snapshots(id)
      );
      CREATE INDEX IF NOT EXISTS idx_spikes_time ON process_spikes(timestamp);
      CREATE INDEX IF NOT EXISTS idx_spikes_process ON process_spikes(process_name);
    `);

    // Battery impact - accumulated per-process battery drain scores
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS battery_impact (
        process_name TEXT PRIMARY KEY,
        total_impact_score REAL NOT NULL DEFAULT 0,
        drain_time_minutes REAL NOT NULL DEFAULT 0,
        samples_during_drain INTEGER NOT NULL DEFAULT 0,
        avg_cpu_during_drain REAL NOT NULL DEFAULT 0,
        last_seen_timestamp INTEGER NOT NULL,
        first_seen_timestamp INTEGER NOT NULL
      );
    `);

    // Battery impact events - individual drain period details
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS battery_impact_events (
        id TEXT PRIMARY KEY,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        duration_minutes REAL NOT NULL,
        battery_drop_percent REAL NOT NULL,
        process_impacts_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_impact_events_time ON battery_impact_events(start_time);
    `);
  }

  insertSnapshot(snapshot: SystemSnapshot, includeProcesses: boolean = true): number {
    const snapStmt = this.db.prepare(`
      INSERT INTO snapshots (
        timestamp, battery_percent, is_charging,
        cpu_total, cpu_user, cpu_system, cpu_idle,
        memory_total, memory_used_mb, memory_free_mb,
        swap_used_mb, swap_total_mb, load_avg,
        disk_read_io, disk_write_io, disk_total_io,
        net_rx_bytes, net_tx_bytes,
        fs_used_percent, cpu_temp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = snapStmt.run(
      snapshot.timestamp,
      snapshot.battery.percent,
      snapshot.battery.isCharging ? 1 : 0,
      snapshot.cpuTotal,
      snapshot.cpuUser,
      snapshot.cpuSystem,
      snapshot.cpuIdle,
      snapshot.memoryTotal,
      snapshot.memoryUsedMB,
      snapshot.memoryFreeMB,
      snapshot.swapUsedMB,
      snapshot.swapTotalMB,
      snapshot.loadAvg,
      snapshot.diskReadIO,
      snapshot.diskWriteIO,
      snapshot.diskTotalIO,
      snapshot.netRxBytes,
      snapshot.netTxBytes,
      snapshot.fsUsedPercent,
      snapshot.cpuTemp
    );
    const snapshotId = result.lastInsertRowid as number;

    if (includeProcesses) {
      // Insert processes
      const procStmt = this.db.prepare(`
        INSERT INTO process_samples (
          snapshot_id, pid, name, cpu_percent, cpu_user_percent, cpu_system_percent,
          memory_percent, rss_mb, nice, state, cmdline, energy_mj
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertProc = this.db.transaction((processes: ProcessSnapshot[]) => {
        for (const proc of processes) {
          procStmt.run(
            snapshotId, proc.pid, proc.name,
            proc.cpuPercent, proc.cpuUserPercent, proc.cpuSystemPercent,
            proc.memoryPercent, proc.rssMB, proc.nice, proc.state, proc.cmdline,
            proc.energyMJ ?? null
          );
        }
      });
      insertProc(snapshot.processes);
    }

    return snapshotId;
  }

  insertDrainEvent(event: DrainEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO drain_events (id, start_time, end_time, start_percent, end_percent, drain_rate, duration_minutes, was_charging, top_processes_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.startTime,
      event.endTime,
      event.startPercent,
      event.endPercent,
      event.drainRate,
      event.durationMinutes,
      event.wasCharging ? 1 : 0,
      JSON.stringify(event.topProcesses)
    );
  }

  getRecentSnapshots(minutes: number = 60): any[] {
    const cutoff = Date.now() - minutes * 60000;
    const stmt = this.db.prepare(`
      SELECT * FROM snapshots WHERE timestamp > ? ORDER BY timestamp DESC
    `);
    return stmt.all(cutoff);
  }

  /**
   * Returns raw snapshot rows (newest first) for the dashboard API.
   * Includes all columns directly from the DB - no type reconstruction.
   */
  getRecentSnapshotsRaw(minutes: number = 60): any[] {
    const cutoff = Date.now() - minutes * 60000;
    const stmt = this.db.prepare(`
      SELECT * FROM snapshots WHERE timestamp > ? ORDER BY timestamp DESC
    `);
    return stmt.all(cutoff);
  }

  /**
   * Returns the most recent process samples from the latest snapshot.
   */
  getLatestProcesses(limit: number = 20): any[] {
    const latest = this.db.prepare(`
      SELECT id FROM snapshots ORDER BY timestamp DESC LIMIT 1
    `).get() as { id: number } | undefined;
    if (!latest) return [];

    const stmt = this.db.prepare(`
      SELECT * FROM process_samples
      WHERE snapshot_id = ?
      ORDER BY cpu_percent DESC
      LIMIT ?
    `);
    return stmt.all(latest.id, limit);
  }

  getDrainEvents(since?: number): DrainEvent[] {
    let sql = 'SELECT * FROM drain_events';
    const params: any[] = [];
    if (since) {
      sql += ' WHERE start_time > ?';
      params.push(since);
    }
    sql += ' ORDER BY start_time DESC';

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(r => ({
      ...r,
      wasCharging: !!r.was_charging,
      topProcesses: JSON.parse(r.top_processes_json),
    }));
  }

  cleanupOldSamples(retentionDays: number): void {
    const cutoff = Date.now() - retentionDays * 86400000;

    // Delete old process samples first (foreign key)
    this.db.prepare(`
      DELETE FROM process_samples WHERE snapshot_id IN (
        SELECT id FROM snapshots WHERE timestamp < ?
      )
    `).run(cutoff);

    // Delete old snapshots
    this.db.prepare('DELETE FROM snapshots WHERE timestamp < ?').run(cutoff);
  }

  getStats(): { totalSnapshots: number; totalEvents: number; oldestSnapshot: number | null; dbSizeBytes: number } {
    const snapshots = this.db.prepare('SELECT COUNT(*) as count, MIN(timestamp) as oldest FROM snapshots').get() as any;
    const events = this.db.prepare('SELECT COUNT(*) as count FROM drain_events').get() as any;

    // Get DB file size
    let dbSizeBytes = 0;
    try {
      const stat = fs.statSync(this.dbPath);
      dbSizeBytes = stat.size;
    } catch {
      // Ignore if file not accessible
    }

    return {
      totalSnapshots: snapshots.count,
      totalEvents: events.count,
      oldestSnapshot: snapshots.oldest,
      dbSizeBytes,
    };
  }

  getLatestSnapshot(): SystemSnapshot | null {
    const stmt = this.db.prepare(`
      SELECT * FROM snapshots ORDER BY timestamp DESC LIMIT 1
    `);
    const row = stmt.get() as any;
    if (!row) return null;

    // Get processes for this snapshot
    const procStmt = this.db.prepare(`
      SELECT * FROM process_samples WHERE snapshot_id = ? ORDER BY cpu_percent DESC
    `);
    const processes = procStmt.all(row.id) as any[];

    return {
      timestamp: row.timestamp,
      battery: {
        timestamp: row.timestamp,
        percent: row.battery_percent,
        isCharging: !!row.is_charging,
        isPlugged: !!row.is_charging,
        timeRemaining: null,
        cycleCount: null,
        temperature: null,
        health: null,
      },
      processes: processes.map(p => ({
        pid: p.pid,
        name: p.name,
        cpuPercent: p.cpu_percent,
        cpuUserPercent: p.cpu_user_percent ?? 0,
        cpuSystemPercent: p.cpu_system_percent ?? 0,
        memoryPercent: p.memory_percent,
        rssMB: p.rss_mb,
        vmsMB: 0,
        nice: p.nice ?? 0,
        state: p.state ?? 'unknown',
        cmdline: p.cmdline,
        energyMJ: p.energy_mj ?? null,
      })),
      cpuTotal: row.cpu_total,
      cpuUser: row.cpu_user ?? 0,
      cpuSystem: row.cpu_system ?? 0,
      cpuIdle: row.cpu_idle ?? 0,
      memoryTotal: row.memory_total,
      memoryUsedMB: row.memory_used_mb ?? 0,
      memoryFreeMB: row.memory_free_mb ?? 0,
      swapUsedMB: row.swap_used_mb ?? 0,
      swapTotalMB: row.swap_total_mb ?? 0,
      loadAvg: row.load_avg ?? 0,
      diskReadIO: row.disk_read_io ?? null,
      diskWriteIO: row.disk_write_io ?? null,
      diskTotalIO: row.disk_total_io ?? null,
      netRxBytes: row.net_rx_bytes ?? null,
      netTxBytes: row.net_tx_bytes ?? null,
      fsUsedPercent: row.fs_used_percent ?? null,
      cpuTemp: row.cpu_temp ?? null,
      diskReadRate: null,
      diskWriteRate: null,
      networkInterfaces: [],
      diskVolumes: [],
      systemInfo: {
        platform: 'unknown',
        distro: 'unknown',
        release: 'unknown',
        arch: 'unknown',
        hostname: 'unknown',
        uptime: 0,
        bootTime: 0,
        cpuModel: 'unknown',
        cpuCores: 0,
        cpuThreads: 0,
      },
    };
  }

  getSnapshotHistory(minutes: number = 60): { timestamp: number; batteryPercent: number; cpuTotal: number; memoryTotal: number; diskTotalIO: number; netRxBytes: number; netTxBytes: number; fsUsedPercent: number }[] {
    const cutoff = Date.now() - minutes * 60000;
    const stmt = this.db.prepare(`
      SELECT timestamp, battery_percent, cpu_total, memory_total,
             disk_total_io, net_rx_bytes, net_tx_bytes, fs_used_percent
      FROM snapshots
      WHERE timestamp > ?
      ORDER BY timestamp ASC
    `);
    return stmt.all(cutoff) as any[];
  }

  // ─── Process-centric queries (T3) ───

  getProcessHistory(name: string, sinceTimestamp: number): any[] {
    const stmt = this.db.prepare(`
      SELECT ps.*, s.timestamp
      FROM process_samples ps
      JOIN snapshots s ON ps.snapshot_id = s.id
      WHERE ps.name LIKE ? AND s.timestamp > ?
      ORDER BY s.timestamp ASC
    `);
    return stmt.all(`%${name}%`, sinceTimestamp) as any[];
  }

  getProcessStats(name: string, sinceTimestamp: number): { avgCpu: number; peakCpu: number; avgMem: number; peakMem: number; samples: number } | null {
    const stmt = this.db.prepare(`
      SELECT
        AVG(ps.cpu_percent) as avg_cpu,
        MAX(ps.cpu_percent) as peak_cpu,
        AVG(ps.memory_percent) as avg_mem,
        MAX(ps.memory_percent) as peak_mem,
        COUNT(*) as samples
      FROM process_samples ps
      JOIN snapshots s ON ps.snapshot_id = s.id
      WHERE ps.name LIKE ? AND s.timestamp > ?
    `);
    return stmt.get(`%${name}%`, sinceTimestamp) as any || null;
  }

  getTopProcesses(metric: 'cpu' | 'mem', limit: number, sinceTimestamp: number): any[] {
    const avgCol = metric === 'cpu' ? 'AVG(cpu_percent)' : 'AVG(memory_percent)';
    const peakCol = metric === 'cpu' ? 'MAX(cpu_percent)' : 'MAX(memory_percent)';

    const stmt = this.db.prepare(`
      SELECT
        name,
        ${avgCol} as avg_${metric},
        ${peakCol} as peak_${metric},
        COUNT(*) as samples,
        GROUP_CONCAT(cpu_percent) as cpu_values
      FROM process_samples ps
      JOIN snapshots s ON ps.snapshot_id = s.id
      WHERE s.timestamp > ?
      GROUP BY name
      ORDER BY avg_${metric} DESC
      LIMIT ?
    `);
    const rows = stmt.all(sinceTimestamp, limit) as any[];
    return rows.map(r => ({
      ...r,
      values: r.cpu_values ? r.cpu_values.split(',').map(Number) : [],
    }));
  }

  // ─── Process Spike Methods ───

  insertProcessSpike(spike: ProcessSpike): void {
    const stmt = this.db.prepare(`
      INSERT INTO process_spikes (id, timestamp, process_name, pid, metric_type, value, baseline, threshold, snapshot_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      spike.id,
      spike.timestamp,
      spike.processName,
      spike.pid,
      spike.metricType,
      spike.value,
      spike.baseline,
      spike.threshold,
      spike.snapshotId
    );
  }

  getRecentSpikes(processName?: string, minutes: number = 60): any[] {
    const cutoff = Date.now() - minutes * 60000;
    let sql = 'SELECT * FROM process_spikes WHERE timestamp > ?';
    const params: any[] = [cutoff];
    if (processName) {
      sql += ' AND process_name LIKE ?';
      params.push(`%${processName}%`);
    }
    sql += ' ORDER BY timestamp DESC';
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as any[];
  }

  getSpikeStats(sinceTimestamp: number): any[] {
    const stmt = this.db.prepare(`
      SELECT
        process_name,
        metric_type,
        COUNT(*) as spike_count,
        AVG(value) as avg_value,
        MAX(value) as peak_value,
        AVG(threshold) as avg_threshold
      FROM process_spikes
      WHERE timestamp > ?
      GROUP BY process_name, metric_type
      ORDER BY spike_count DESC
    `);
    return stmt.all(sinceTimestamp) as any[];
  }

  // ─── Battery Impact Methods ───

  insertBatteryImpactEvent(event: BatteryImpactEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO battery_impact_events (id, start_time, end_time, duration_minutes, battery_drop_percent, process_impacts_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.startTime,
      event.endTime,
      event.durationMinutes,
      event.batteryDropPercent,
      JSON.stringify(event.processImpacts)
    );

    // Also update accumulated impact scores
    const updateStmt = this.db.prepare(`
      INSERT INTO battery_impact (process_name, total_impact_score, drain_time_minutes, samples_during_drain, avg_cpu_during_drain, last_seen_timestamp, first_seen_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(process_name) DO UPDATE SET
        total_impact_score = total_impact_score + excluded.total_impact_score,
        drain_time_minutes = drain_time_minutes + excluded.drain_time_minutes,
        samples_during_drain = samples_during_drain + excluded.samples_during_drain,
        avg_cpu_during_drain = (avg_cpu_during_drain * samples_during_drain + excluded.avg_cpu_during_drain * excluded.samples_during_drain) / (samples_during_drain + excluded.samples_during_drain),
        last_seen_timestamp = excluded.last_seen_timestamp
    `);

    for (const proc of event.processImpacts) {
      updateStmt.run(
        proc.processName,
        proc.impactScore,
        event.durationMinutes,
        proc.samples,
        proc.avgCpuPercent,
        event.endTime,
        event.startTime
      );
    }
  }

  getBatteryImpactRankings(limit: number = 20): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM battery_impact
      ORDER BY total_impact_score DESC
      LIMIT ?
    `);
    return stmt.all(limit) as any[];
  }

  getBatteryImpactEvents(sinceTimestamp?: number): any[] {
    let sql = 'SELECT * FROM battery_impact_events';
    const params: any[] = [];
    if (sinceTimestamp) {
      sql += ' WHERE start_time > ?';
      params.push(sinceTimestamp);
    }
    sql += ' ORDER BY start_time DESC';
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as any[];
  }

  getBatteryImpactForProcess(processName: string): any {
    const stmt = this.db.prepare('SELECT * FROM battery_impact WHERE process_name = ?');
    return stmt.get(processName) as any || null;
  }

  // ─── Sleep/Wake Event Methods ───

  insertSleepWakeEvent(event: { eventType: 'sleep' | 'wake'; timestamp: number; batteryPercent: number; isCharging: boolean }): void {
    const stmt = this.db.prepare(`
      INSERT INTO sleep_wake_events (event_type, timestamp, battery_percent, is_charging)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(
      event.eventType,
      event.timestamp,
      event.batteryPercent,
      event.isCharging ? 1 : 0
    );
  }

  getSleepWakeEvents(since?: number, until?: number): any[] {
    let sql = 'SELECT * FROM sleep_wake_events WHERE 1=1';
    const params: any[] = [];
    if (since) {
      sql += ' AND timestamp >= ?';
      params.push(since);
    }
    if (until) {
      sql += ' AND timestamp <= ?';
      params.push(until);
    }
    sql += ' ORDER BY timestamp DESC';
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as any[];
  }

  getRecentSleepWakeEvents(days: number = 7): any[] {
    const since = Date.now() - days * 86400000;
    return this.getSleepWakeEvents(since);
  }

  // ─── Monitoring Profiles ───

  getProfiles(): any[] {
    const stmt = this.db.prepare('SELECT * FROM monitoring_profiles ORDER BY created_at DESC');
    const rows = stmt.all() as any[];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      color: r.color,
      processes: JSON.parse(r.processes_json),
      createdAt: r.created_at,
    }));
  }

  saveProfile(profile: { id: string; name: string; color?: string; processes: any[] }): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO monitoring_profiles (id, name, color, processes_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      profile.id,
      profile.name,
      profile.color || '#3b82f6',
      JSON.stringify(profile.processes),
      Date.now()
    );
  }

  deleteProfile(id: string): void {
    const stmt = this.db.prepare('DELETE FROM monitoring_profiles WHERE id = ?');
    stmt.run(id);
  }

  // ─── Date-Range Queries (for ReportGenerator) ───

  getSnapshotsForDateRange(start: number, end: number): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM snapshots
      WHERE timestamp >= ? AND timestamp < ?
      ORDER BY timestamp ASC
    `);
    return stmt.all(start, end) as any[];
  }

  getDrainEventsForDateRange(start: number, end: number): DrainEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM drain_events
      WHERE start_time >= ? AND start_time < ?
      ORDER BY start_time DESC
    `);
    const rows = stmt.all(start, end) as any[];
    return rows.map(r => ({
      ...r,
      wasCharging: !!r.was_charging,
      topProcesses: JSON.parse(r.top_processes_json),
    }));
  }

  getProcessSamplesForSnapshotIds(snapshotIds: number[]): any[] {
    if (snapshotIds.length === 0) return [];
    const placeholders = snapshotIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT s.timestamp, ps.pid, ps.name, ps.cpu_percent, ps.memory_percent, ps.rss_mb, ps.energy_mj
      FROM process_samples ps
      JOIN snapshots s ON ps.snapshot_id = s.id
      WHERE s.id IN (${placeholders})
      ORDER BY s.timestamp ASC, ps.cpu_percent DESC
    `);
    return stmt.all(...snapshotIds);
  }

  getTopProcessesForDateRange(start: number, end: number, metric: 'cpu' | 'mem', limit: number): any[] {
    const avgCol = metric === 'cpu' ? 'AVG(cpu_percent)' : 'AVG(memory_percent)';
    const peakCol = metric === 'cpu' ? 'MAX(cpu_percent)' : 'MAX(memory_percent)';

    const stmt = this.db.prepare(`
      SELECT
        name,
        ${avgCol} as avg_${metric},
        ${peakCol} as peak_${metric},
        COUNT(*) as samples,
        GROUP_CONCAT(cpu_percent) as cpu_values
      FROM process_samples ps
      JOIN snapshots s ON ps.snapshot_id = s.id
      WHERE s.timestamp >= ? AND s.timestamp < ?
      GROUP BY name
      ORDER BY avg_${metric} DESC
      LIMIT ?
    `);
    const rows = stmt.all(start, end, limit) as any[];
    return rows.map(r => ({
      ...r,
      values: r.cpu_values ? r.cpu_values.split(',').map(Number) : [],
    }));
  }

  getBatteryImpactEventsForDateRange(start: number, end: number): any[] {
    const stmt = this.db.prepare(`
      SELECT * FROM battery_impact_events
      WHERE start_time >= ? AND start_time < ?
      ORDER BY start_time DESC
    `);
    return stmt.all(start, end) as any[];
  }

  close(): void {
    this.db.close();
  }
}