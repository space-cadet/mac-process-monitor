import Database from 'better-sqlite3';
import { SystemSnapshot, DrainEvent } from '../types/index.js';

/**
 * SQLite storage for time-series system snapshots and drain events.
 * Provides efficient querying for history and trend analysis.
 */
export class TimeSeriesDB {
  private db: Database.Database;

  constructor(dbPath: string = '~/.procmon/monitor.db') {
    const expandedPath = dbPath.replace(/^~/, process.env.HOME || '');
    const fs = require('fs');
    const path = require('path');
    const dir = path.dirname(expandedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(expandedPath);
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

    // Monitoring profiles - user-defined watchlists
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS monitoring_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#3b82f6',
        processes_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  insertSnapshot(snapshot: SystemSnapshot): number {
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

    // Insert processes
    const procStmt = this.db.prepare(`
      INSERT INTO process_samples (
        snapshot_id, pid, name, cpu_percent, cpu_user_percent, cpu_system_percent,
        memory_percent, rss_mb, nice, state, cmdline
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertProc = this.db.transaction((processes) => {
      for (const proc of processes) {
        procStmt.run(
          snapshotId, proc.pid, proc.name,
          proc.cpuPercent, proc.cpuUserPercent, proc.cpuSystemPercent,
          proc.memoryPercent, proc.rssMB, proc.nice, proc.state, proc.cmdline
        );
      }
    });
    insertProc(snapshot.processes);

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

  getRecentSnapshots(minutes: number = 60): SystemSnapshot[] {
    const cutoff = Date.now() - minutes * 60000;
    const stmt = this.db.prepare(`
      SELECT * FROM snapshots WHERE timestamp > ? ORDER BY timestamp DESC
    `);
    return stmt.all(cutoff) as SystemSnapshot[];
  }

  /**
   * Returns raw snapshot rows (newest first) for the dashboard API.
   * Includes all columns directly from the DB — no type reconstruction.
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

  getStats(): { totalSnapshots: number; totalEvents: number; oldestSnapshot: number | null } {
    const snapshots = this.db.prepare('SELECT COUNT(*) as count, MIN(timestamp) as oldest FROM snapshots').get() as any;
    const events = this.db.prepare('SELECT COUNT(*) as count FROM drain_events').get() as any;
    
    return {
      totalSnapshots: snapshots.count,
      totalEvents: events.count,
      oldestSnapshot: snapshots.oldest,
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
      },
      processes: processes.map(p => ({
        pid: p.pid,
        name: p.name,
        cpuPercent: p.cpu_percent,
        memoryPercent: p.memory_percent,
        rssMB: p.rss_mb,
        vmsMB: 0,
        cmdline: p.cmdline,
      })),
      cpuTotal: row.cpu_total,
      memoryTotal: row.memory_total,
    };
  }

  getSnapshotHistory(minutes: number = 60): { timestamp: number; batteryPercent: number; cpuTotal: number; memoryTotal: number }[] {
    const cutoff = Date.now() - minutes * 60000;
    const stmt = this.db.prepare(`
      SELECT timestamp, battery_percent, cpu_total, memory_total 
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

  close(): void {
    this.db.close();
  }
}