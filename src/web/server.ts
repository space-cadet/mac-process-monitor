import { TimeSeriesDB } from '../storage/TimeSeriesDB.js';
import { SystemCollector } from '../core/SystemCollector.js';
import { DeviceRegistry } from '../core/DeviceRegistry.js';
import { getIdentity, getDid, getName } from '../core/DeviceIdentity.js';
import { loadConfig, saveConfig } from '../config/ConfigManager.js';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import QRCode from 'qrcode';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Detect Tailscale IP (100.x.x.x)
function getTailscaleIP(): string | null {
  try {
    const ifaces = execSync('ifconfig 2>/dev/null || ip addr 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
    const match = ifaces.match(/inet (100\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getBestHostIP(reqHost?: string): string {
  const tailscale = getTailscaleIP();
  if (tailscale) return tailscale;
  if (reqHost) return reqHost.split(':')[0];
  return 'localhost';
}

// Resolve DB path to canonical location (same as monitor)
const dbPath = join(process.env.HOME || '', '.procmon', 'monitor.db');
const db = new TimeSeriesDB(dbPath);
const collector = new SystemCollector();
const deviceRegistry = new DeviceRegistry();

// MIME types
const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API routes
  if (pathname === '/api/snapshot') {
    try {
      // Always use live collection for current snapshot
      const snapshot = await collector.getSystemSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snapshot));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/history') {
    try {
      const minutes = parseInt(url.searchParams.get('minutes') || '60');
      const history = db.getSnapshotHistory(minutes);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(history));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/report') {
    try {
      const date = url.searchParams.get('date') || 'today';
      const { ReportGenerator } = await import('../core/ReportGenerator.js');
      const generator = new ReportGenerator(db);
      const report = generator.generateReport(date);
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(report);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/drain-events') {
    try {
      const events = db.getDrainEvents();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(events));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/process-history') {
    try {
      const name = url.searchParams.get('name') || '';
      const minutes = parseInt(url.searchParams.get('minutes') || '30');
      const cutoff = Date.now() - minutes * 60000;
      const history = db.getProcessHistory(name, cutoff);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(history));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/process-stats') {
    try {
      const name = url.searchParams.get('name') || '';
      const minutes = parseInt(url.searchParams.get('minutes') || '60');
      const cutoff = Date.now() - minutes * 60000;
      const stats = db.getProcessStats(name, cutoff);
      const history = db.getProcessHistory(name, cutoff);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name,
        minutes,
        stats,
        sampleCount: history.length,
        pids: [...new Set(history.map(h => h.pid))],
        firstSeen: history[0]?.timestamp || null,
        lastSeen: history[history.length - 1]?.timestamp || null,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/top-processes') {
    try {
      const metric = (url.searchParams.get('metric') || 'cpu') as 'cpu' | 'mem';
      const limit = parseInt(url.searchParams.get('limit') || '10');
      const minutes = parseInt(url.searchParams.get('minutes') || '5');
      const cutoff = Date.now() - minutes * 60000;
      const top = db.getTopProcesses(metric, limit, cutoff);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ metric, limit, minutes, processes: top }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/profiles') {
    try {
      if (req.method === 'GET') {
        const profiles = db.getProfiles?.() || [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(profiles));
      } else if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const profile = JSON.parse(body);
            db.saveProfile?.(profile);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      } else if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (id) db.deleteProfile?.(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/db-stats') {
    try {
      const stats = db.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        totalSnapshots: stats.totalSnapshots,
        totalEvents: stats.totalEvents,
        oldestSnapshot: stats.oldestSnapshot,
        dbSizeBytes: stats.dbSizeBytes,
        dbSizeMB: (stats.dbSizeBytes / (1024 * 1024)).toFixed(2),
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/cleanup' && req.method === 'POST') {
    try {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { retentionDays = 30 } = JSON.parse(body || '{}');
          const days = typeof retentionDays === 'number' ? retentionDays : parseInt(retentionDays) || 30;
          const beforeBytes = db.getStats().dbSizeBytes;
          db.cleanupOldSamples(days);
          const afterStats = db.getStats();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            retentionDays,
            freedMB: ((beforeBytes - afterStats.dbSizeBytes) / (1024 * 1024)).toFixed(2),
            remainingSnapshots: afterStats.totalSnapshots,
            remainingMB: (afterStats.dbSizeBytes / (1024 * 1024)).toFixed(2),
          }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/config' && req.method === 'GET') {
    try {
      const config = loadConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/config' && req.method === 'POST') {
    try {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const updates = JSON.parse(body);
          saveConfig(updates);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Config saved. Restart monitor to apply changes.' }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  // ─── Analysis Endpoints ───
  if (pathname === '/api/analysis/battery-trend') {
    try {
      const rows = db.db.prepare(`
        SELECT 
          date(timestamp/1000, 'unixepoch') as date,
          ROUND(AVG(battery_percent), 1) as avgBattery,
          MIN(battery_percent) as minBattery,
          MAX(battery_percent) as maxBattery,
          COUNT(*) as samples
        FROM snapshots
        WHERE timestamp > (strftime('%s', 'now') - 2592000) * 1000
        GROUP BY date
        ORDER BY date DESC
        LIMIT 30
      `).all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows.map((r: any) => ({
        date: r.date,
        avgDrainRate: null,
        avgBattery: r.avgBattery,
        minBattery: r.minBattery,
        maxBattery: r.maxBattery,
        samples: r.samples
      }))));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/analysis/top-battery-impact') {
    try {
      const rows = db.db.prepare(`
        SELECT 
          process_name as name,
          total_impact_score as totalImpact,
          samples_during_drain as events,
          ROUND(avg_cpu_during_drain, 2) as avgImpact
        FROM battery_impact
        ORDER BY total_impact_score DESC
        LIMIT 20
      `).all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/analysis/spike-patterns') {
    try {
      const rows = db.db.prepare(`
        SELECT 
          process_name as name,
          SUM(CASE WHEN metric_type = 'cpu' THEN 1 ELSE 0 END) as cpuSpikes,
          SUM(CASE WHEN metric_type = 'memory' THEN 1 ELSE 0 END) as memSpikes,
          COUNT(*) as totalSpikes,
          ROUND(AVG(value), 1) as avgCpu
        FROM process_spikes
        GROUP BY process_name
        ORDER BY totalSpikes DESC
        LIMIT 20
      `).all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows.map((r: any) => ({
        name: r.name,
        cpuSpikes: r.cpuSpikes,
        memSpikes: r.memSpikes,
        totalSpikes: r.totalSpikes,
        avgCpu: r.avgCpu
      }))));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/analysis/drain-correlation') {
    try {
      const rows = db.db.prepare(`
        SELECT 
          ps.name,
          COUNT(DISTINCT de.id) as drainEvents,
          ROUND(SUM(ps.cpu_percent), 1) as totalCpu,
          ROUND(AVG(ps.cpu_percent), 1) as avgCpu,
          ROUND(COUNT(DISTINCT de.id) * 100.0 / NULLIF((SELECT COUNT(*) FROM drain_events), 0), 1) as frequency
        FROM process_samples ps
        JOIN snapshots s ON ps.snapshot_id = s.id
        JOIN drain_events de ON s.timestamp BETWEEN de.start_time AND de.end_time
        GROUP BY ps.name
        ORDER BY drainEvents DESC, totalCpu DESC
        LIMIT 20
      `).all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/analysis/idle-active') {
    try {
      const rows = db.db.prepare(`
        SELECT 
          CAST(strftime('%H', timestamp/1000, 'unixepoch') AS INTEGER) as hour,
          ROUND(AVG(cpu_total), 1) as avgCpu,
          ROUND(AVG(battery_percent), 1) as avgBattery,
          COUNT(*) as samples,
          CASE 
            WHEN AVG(cpu_total) > 30 THEN 'high'
            WHEN AVG(cpu_total) > 10 THEN 'medium'
            ELSE 'low'
          END as activityLevel
        FROM snapshots
        WHERE timestamp > (strftime('%s', 'now') - 604800) * 1000
        GROUP BY hour
        ORDER BY hour
      `).all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows.map((r: any) => ({
        hour: r.hour,
        avgCpu: r.avgCpu,
        avgBattery: r.avgBattery,
        samples: r.samples,
        activityLevel: r.activityLevel
      }))));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/analysis/process-stats') {
    try {
      const rows = db.db.prepare(`
        SELECT 
          ps.name,
          ROUND(AVG(ps.cpu_percent), 1) as avgCpu,
          ROUND(MAX(ps.cpu_percent), 1) as peakCpu,
          CASE 
            WHEN COUNT(*) > 1 THEN 
              ROUND(SQRT((SUM(ps.cpu_percent * ps.cpu_percent) - SUM(ps.cpu_percent)*SUM(ps.cpu_percent)/COUNT(*)) / (COUNT(*) - 1)), 2)
            ELSE 0 
          END as stdCpu,
          COUNT(*) as samples
        FROM process_samples ps
        JOIN snapshots s ON ps.snapshot_id = s.id
        WHERE s.timestamp > (strftime('%s', 'now') - 604800) * 1000
        GROUP BY ps.name
        HAVING COUNT(*) > 5
        ORDER BY avgCpu DESC
        LIMIT 20
      `).all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows.map((r: any) => ({
        name: r.name,
        avgCpu: r.avgCpu,
        peakCpu: r.peakCpu,
        stdCpu: r.stdCpu,
        samples: r.samples
      }))));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/analysis/disk-trend') {
    try {
      const rows = db.db.prepare(`
        SELECT 
          date(timestamp/1000, 'unixepoch') as date,
          ROUND(AVG(fs_used_percent), 1) as avgDisk,
          MIN(fs_used_percent) as minDisk,
          MAX(fs_used_percent) as maxDisk,
          COUNT(*) as samples
        FROM snapshots
        WHERE timestamp > (strftime('%s', 'now') - 2592000) * 1000
        GROUP BY date
        ORDER BY date DESC
        LIMIT 30
      `).all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows.map((r: any) => ({
        date: r.date,
        avgDisk: r.avgDisk,
        minDisk: r.minDisk,
        maxDisk: r.maxDisk,
        samples: r.samples
      }))));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/analysis/network-trend') {
    try {
      const rows = db.db.prepare(`
        SELECT 
          date(timestamp/1000, 'unixepoch') as date,
          ROUND(MAX(net_rx_bytes)/1024/1024, 1) as rxMB,
          ROUND(MAX(net_tx_bytes)/1024/1024, 1) as txMB,
          COUNT(*) as samples
        FROM snapshots
        WHERE timestamp > (strftime('%s', 'now') - 2592000) * 1000
          AND net_rx_bytes IS NOT NULL
        GROUP BY date
        ORDER BY date DESC
        LIMIT 30
      `).all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows.map((r: any) => ({
        date: r.date,
        rxMB: r.rxMB,
        txMB: r.txMB,
        samples: r.samples
      }))));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/export/csv') {
    try {
      const fromISO = url.searchParams.get('from') || '';
      const toISO = url.searchParams.get('to') || '';
      const fromMs = fromISO ? new Date(fromISO).getTime() : 0;
      const toMs = toISO ? new Date(toISO).getTime() : Date.now();
      if (isNaN(fromMs) || isNaN(toMs)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid from/to date' }));
        return;
      }
      const rows = db.db.prepare(`
        SELECT
          s.id AS snapshot_id,
          s.timestamp,
          s.battery_percent,
          s.cpu_total,
          s.memory_used_mb,
          ps.name AS process_name,
          ps.pid AS process_pid,
          ps.cpu_percent AS process_cpu,
          ps.memory_percent AS process_mem
        FROM snapshots s
        LEFT JOIN process_samples ps ON ps.snapshot_id = s.id
        WHERE s.timestamp >= ? AND s.timestamp <= ?
        ORDER BY s.timestamp DESC, ps.cpu_percent DESC
      `).all(fromMs, toMs);
      const csvHeader = 'snapshot_id,timestamp,battery_percent,cpu_total,memory_used_mb,process_name,process_pid,process_cpu,process_mem';
      const csvRows = rows.map((r: any) => [
        r.snapshot_id,
        new Date(r.timestamp).toISOString(),
        r.battery_percent ?? '',
        r.cpu_total ?? '',
        r.memory_used_mb ?? '',
        r.process_name ?? '',
        r.process_pid ?? '',
        r.process_cpu ?? '',
        r.process_mem ?? ''
      ].map(v => {
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }).join(','));
      const csv = [csvHeader, ...csvRows].join('\n');
      const filename = `procmon-export-${new Date(fromMs).toISOString().slice(0,10)}_to_${new Date(toMs).toISOString().slice(0,10)}.csv`;
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      res.end(csv);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/export/json') {
    try {
      const fromISO = url.searchParams.get('from') || '';
      const toISO = url.searchParams.get('to') || '';
      const fromMs = fromISO ? new Date(fromISO).getTime() : 0;
      const toMs = toISO ? new Date(toISO).getTime() : Date.now();
      if (isNaN(fromMs) || isNaN(toMs)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid from/to date' }));
        return;
      }
      const rows = db.db.prepare(`
        SELECT
          s.id AS snapshot_id,
          s.timestamp,
          s.battery_percent,
          s.cpu_total,
          s.memory_used_mb,
          ps.name AS process_name,
          ps.pid AS process_pid,
          ps.cpu_percent AS process_cpu,
          ps.memory_percent AS process_mem
        FROM snapshots s
        LEFT JOIN process_samples ps ON ps.snapshot_id = s.id
        WHERE s.timestamp >= ? AND s.timestamp <= ?
        ORDER BY s.timestamp DESC, ps.cpu_percent DESC
      `).all(fromMs, toMs);
      const result = {
        exportedAt: new Date().toISOString(),
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
        count: rows.length,
        data: rows,
      };
      const filename = `procmon-export-${new Date(fromMs).toISOString().slice(0,10)}_to_${new Date(toMs).toISOString().slice(0,10)}.json`;
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      res.end(JSON.stringify(result, null, 2));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/db-size') {
    try {
      const stats = db.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sizeMB: (stats.dbSizeBytes / (1024 * 1024)).toFixed(2) }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/server-info') {
    try {
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const uptimeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ uptime, uptimeStr }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  // ─── Device Identity ───
  if (pathname === '/api/identity') {
    try {
      const identity = getIdentity();
      const host = getBestHostIP(req.headers.host);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        did: identity.did,
        name: identity.name,
        version: identity.version,
        platform: identity.platform,
        host: `${host}:${PORT}`,
        endpoints: {
          metrics: `http://${host}:${PORT}/api/metrics`,
          register: `http://${host}:${PORT}/api/devices/register`,
        },
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/metrics') {
    try {
      const since = url.searchParams.get('since') || '';
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      const identity = getIdentity();
      const sinceMs = since ? new Date(since).getTime() : 0;

      const snapshots = db.db.prepare(`
        SELECT * FROM snapshots
        WHERE timestamp >= ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(sinceMs, limit);

      const battery = db.db.prepare(`
        SELECT timestamp, battery_percent, is_charging
        FROM snapshots
        WHERE timestamp >= ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(sinceMs, limit);

      const processes = db.db.prepare(`
        SELECT ps.name, ps.pid, ps.cpu_percent, ps.memory_percent, ps.rss_mb, s.timestamp
        FROM process_samples ps
        JOIN snapshots s ON ps.snapshot_id = s.id
        WHERE s.timestamp >= ?
        ORDER BY s.timestamp DESC, ps.cpu_percent DESC
        LIMIT ?
      `).all(sinceMs, limit);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        device: { did: identity.did, name: identity.name },
        snapshots,
        battery,
        processes,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/qr') {
    try {
      const identity = getIdentity();
      const host = getBestHostIP(req.headers.host);
      const payload = JSON.stringify({
        did: identity.did,
        name: identity.name,
        version: identity.version,
        platform: identity.platform,
        host: `${host}:${PORT}`,
        endpoints: {
          metrics: `http://${host}:${PORT}/api/metrics`,
          register: `http://${host}:${PORT}/api/devices/register`,
        },
      });
      const svg = await QRCode.toString(payload, { type: 'svg', margin: 2, width: 256 });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(svg);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/restart' && req.method === 'POST') {
    try {
      // Spawn monitor restart in background
      const { exec } = require('child_process');
      exec('pkill -f "tsx.*src/main.ts" && sleep 2 && cd /Users/sage/.openclaw/workspace/code/process-monitor && bash run.sh > logs/monitor.log 2> logs/monitor-error.log &', {
        env: { ...process.env, HOME: '/Users/sage' }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Monitor restart initiated. It will be back online in ~5 seconds.' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  // ─── Device Registry Endpoints ───
  if (pathname === '/api/devices/register' && req.method === 'POST') {
    try {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);
          const remoteIp = req.socket.remoteAddress?.replace(/^::ffff:/, '') || payload.ip || 'unknown';
          const metricsPort = payload.port || PORT;
          const device = deviceRegistry.register({
            id: payload.id || payload.did || `device_${Date.now()}`,
            name: payload.name || 'Unknown Device',
            hostname: payload.hostname || 'unknown',
            platform: payload.platform || process.platform,
            arch: payload.arch || process.arch,
            ip: remoteIp,
            version: payload.version,
            endpoint: payload.endpoint || {
              metrics: `http://${remoteIp}:${metricsPort}/api/metrics`,
            },
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, device }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/devices/heartbeat' && req.method === 'POST') {
    try {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { id } = JSON.parse(body);
          const device = deviceRegistry.heartbeat(id);
          if (device) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, device }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Device not found' }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/devices' && req.method === 'GET') {
    try {
      const devices = deviceRegistry.list().map(d => ({
        ...d,
        isOnline: Date.now() - d.lastSeen < 5 * 60 * 1000, // 5 min threshold
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ devices }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/devices' && req.method === 'DELETE') {
    try {
      const id = url.searchParams.get('id');
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing id' }));
        return;
      }
      const removed = deviceRegistry.remove(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: removed }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  // ─── Process Tree Endpoint ───
  if (pathname === '/api/process-tree') {
    try {
      const { execSync } = require('child_process');
      const output = execSync('ps -eo pid,ppid,comm,pcpu,pmem,rss', { encoding: 'utf8', timeout: 5000 });
      const lines = output.trim().split('\n');
      const headers = lines[0].trim().split(/\s+/);
      const processes: any[] = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        // Parse: PID PPID COMM %CPU %MEM RSS — COMM may contain spaces but is right-aligned
        // Strategy: extract leading numbers, then the rest
        const match = line.match(/^(\d+)\s+(\d+)\s+(.+?)\s+([\d.]+)\s+([\d.]+)\s+(\d+)$/);
        if (!match) continue;
        processes.push({
          pid: parseInt(match[1], 10),
          ppid: parseInt(match[2], 10),
          name: match[3].trim(),
          cpuPercent: parseFloat(match[4]),
          memoryPercent: parseFloat(match[5]),
          rssKB: parseInt(match[6], 10),
          children: [] as any[],
        });
      }

      // Build tree
      const pidMap = new Map<number, any>();
      for (const p of processes) pidMap.set(p.pid, p);

      const roots: any[] = [];
      for (const p of processes) {
        if (p.ppid === 0 || !pidMap.has(p.ppid)) {
          roots.push(p);
        } else {
          const parent = pidMap.get(p.ppid);
          if (parent) parent.children.push(p);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ processes: roots, total: processes.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  // ─── Sleep/Wake Events Endpoint ───
  if (pathname === '/api/sleep-wake-events') {
    try {
      const since = url.searchParams.get('since') || '24h';
      const sinceMs = since === '7d' ? 7 * 24 * 3600 * 1000 : 24 * 3600 * 1000;
      const cutoff = Date.now() - sinceMs;
      const stmt = db.db.prepare(`
        SELECT * FROM sleep_wake_events
        WHERE timestamp > ?
        ORDER BY timestamp ASC
      `);
      const rows = stmt.all(cutoff);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  // Static files
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = join(__dirname, '../../web/public', filePath);

  if (existsSync(fullPath)) {
    const ext = fullPath.slice(fullPath.lastIndexOf('.'));
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const content = readFileSync(fullPath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

const PORT = parseInt(process.env.PORT || '3456', 10);
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`[Dashboard] Server running on http://${HOST}:${PORT}`);
  console.log(`[Dashboard] API endpoints:`);
  console.log(`  GET http://<your-ip>:${PORT}/api/snapshot`);
  console.log(`  GET http://<your-ip>:${PORT}/api/history?minutes=60`);
  console.log(`  GET http://<your-ip>:${PORT}/api/drain-events`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Dashboard] Shutting down...');
  db.close();
  server.close(() => process.exit(0));
});
