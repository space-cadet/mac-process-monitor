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
    this.initTables();
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
        memory_total REAL
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
        memory_percent REAL NOT NULL,
        rss_mb REAL NOT NULL,
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
      INSERT INTO snapshots (timestamp, battery_percent, is_charging, cpu_total, memory_total)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = snapStmt.run(
      snapshot.timestamp,
      snapshot.battery.percent,
      snapshot.battery.isCharging ? 1 : 0,
      snapshot.cpuTotal,
      snapshot.memoryTotal
    );
    const snapshotId = result.lastInsertRowid as number;

    // Insert processes
    const procStmt = this.db.prepare(`
      INSERT INTO process_samples (snapshot_id, pid, name, cpu_percent, memory_percent, rss_mb, cmdline)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertProc = this.db.transaction((processes) => {
      for (const proc of processes) {
        procStmt.run(snapshotId, proc.pid, proc.name, proc.cpuPercent, proc.memoryPercent, proc.rssMB, proc.cmdline);
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

  close(): void {
    this.db.close();
  }
}