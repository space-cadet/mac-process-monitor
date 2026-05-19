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

  close(): void {
    this.db.close();
  }
}