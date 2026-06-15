import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TimeSeriesDB } from '../storage/TimeSeriesDB.js';

/**
 * Lightweight HTTP dashboard server.
 * Serves static files from public/ and JSON API endpoints.
 * Uses native Node.js http — no Express dependency.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export interface DashboardConfig {
  port: number;
  dbPath: string;
}

export class DashboardServer {
  private server: http.Server | null = null;
  private db: TimeSeriesDB;
  private config: DashboardConfig;

  constructor(config: Partial<DashboardConfig> = {}) {
    this.config = {
      port: config.port ?? 3456,
      dbPath: config.dbPath ?? '~/.procmon/monitor.db',
    };
    this.db = new TimeSeriesDB(this.config.dbPath);
  }

  start(): void {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(this.config.port, () => {
      console.log(`🌐 Dashboard running at http://localhost:${this.config.port}`);
    });
  }

  stop(): void {
    this.server?.close();
    this.db.close();
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://localhost:${this.config.port}`);
    const pathname = url.pathname;

    // API routes
    if (pathname.startsWith('/api/')) {
      this.handleApi(req, res, pathname, url.searchParams);
      return;
    }

    // Static files
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(PUBLIC_DIR, filePath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(data);
    });
  }

  private handleApi(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    params: URLSearchParams
  ): void {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      // ── Snapshots ──
      if (pathname === '/api/snapshots') {
        const minutes = parseInt(params.get('minutes') ?? '60', 10);
        const rows = this.db.getRecentSnapshotsRaw(minutes);
        res.writeHead(200).end(JSON.stringify(rows));
        return;
      }

      // ── Latest processes ──
      if (pathname === '/api/processes') {
        const limit = parseInt(params.get('limit') ?? '20', 10);
        const rows = this.db.getLatestProcesses(limit);
        res.writeHead(200).end(JSON.stringify(rows));
        return;
      }

      // ── Drain events ──
      if (pathname === '/api/drain-events') {
        const events = this.db.getDrainEvents();
        res.writeHead(200).end(JSON.stringify(events));
        return;
      }

      // ── Stats ──
      if (pathname === '/api/stats') {
        const stats = this.db.getStats();
        res.writeHead(200).end(JSON.stringify(stats));
        return;
      }

      // ── Process history ──
      if (pathname === '/api/process-history') {
        const processName = params.get('process');
        const minutes = parseInt(params.get('minutes') ?? '60', 10);
        if (!processName) {
          res.writeHead(400).end(JSON.stringify({ error: 'Missing process parameter' }));
          return;
        }
        const cutoff = Date.now() - minutes * 60000;
        const rows = this.db.getProcessHistory(processName, cutoff);
        res.writeHead(200).end(JSON.stringify(rows));
        return;
      }

      // ── Process stats ──
      if (pathname === '/api/process-stats') {
        const processName = params.get('process');
        const minutes = parseInt(params.get('minutes') ?? '60', 10);
        if (!processName) {
          res.writeHead(400).end(JSON.stringify({ error: 'Missing process parameter' }));
          return;
        }
        const cutoff = Date.now() - minutes * 60000;
        const rows = this.db.getProcessHistory(processName, cutoff);
        if (rows.length === 0) {
          res.writeHead(200).end(JSON.stringify({ error: 'No data found' }));
          return;
        }
        const avgCpu = rows.reduce((sum, r) => sum + (r.cpu_percent ?? 0), 0) / rows.length;
        const avgMem = rows.reduce((sum, r) => sum + (r.memory_percent ?? 0), 0) / rows.length;
        const peakCpu = Math.max(...rows.map(r => r.cpu_percent ?? 0));
        const peakMem = Math.max(...rows.map(r => r.memory_percent ?? 0));
        res.writeHead(200).end(JSON.stringify({
          processName,
          samples: rows.length,
          avgCpu: Math.round(avgCpu * 100) / 100,
          avgMem: Math.round(avgMem * 100) / 100,
          peakCpu: Math.round(peakCpu * 100) / 100,
          peakMem: Math.round(peakMem * 100) / 100,
          firstSeen: rows[rows.length - 1]?.timestamp,
          lastSeen: rows[0]?.timestamp,
        }));
        return;
      }

      // ── Top processes ──
      if (pathname === '/api/top-processes') {
        const metric = params.get('metric') ?? 'cpu'; // 'cpu' | 'mem'
        const limit = parseInt(params.get('limit') ?? '10', 10);
        const minutes = parseInt(params.get('minutes') ?? '5', 10);
        const cutoff = Date.now() - minutes * 60000;
        const rows = this.db.getTopProcesses(metric, limit, cutoff);
        res.writeHead(200).end(JSON.stringify(rows));
        return;
      }

      // ── Spikes ──
      if (pathname === '/api/spikes') {
        const processName = params.get('process') || undefined;
        const minutes = parseInt(params.get('minutes') ?? '60', 10);
        const rows = this.db.getRecentSpikes(processName, minutes);
        res.writeHead(200).end(JSON.stringify(rows));
        return;
      }

      // ── Spike stats ──
      if (pathname === '/api/spike-stats') {
        const minutes = parseInt(params.get('minutes') ?? '60', 10);
        const cutoff = Date.now() - minutes * 60000;
        const rows = this.db.getSpikeStats(cutoff);
        res.writeHead(200).end(JSON.stringify(rows));
        return;
      }

      // ── Battery impact rankings ──
      if (pathname === '/api/battery-impact') {
        const limit = parseInt(params.get('limit') ?? '20', 10);
        const rows = this.db.getBatteryImpactRankings(limit);
        res.writeHead(200).end(JSON.stringify(rows));
        return;
      }

      // ── Battery impact events ──
      if (pathname === '/api/battery-events') {
        const since = params.get('since');
        const sinceTimestamp = since ? Date.now() - parseInt(since) * 60000 : undefined;
        const rows = this.db.getBatteryImpactEvents(sinceTimestamp);
        res.writeHead(200).end(JSON.stringify(rows));
        return;
      }

      // ── Profiles ──
      if (pathname === '/api/profiles') {
        if (req.method === 'GET') {
          const rows = this.db.getProfiles();
          res.writeHead(200).end(JSON.stringify(rows));
          return;
        }
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              this.db.saveProfile({ id: data.id, name: data.name, color: data.color, processes: data.processes });
              res.writeHead(201).end(JSON.stringify({ success: true }));
            } catch (err) {
              res.writeHead(400).end(JSON.stringify({ error: String(err) }));
            }
          });
          return;
        }
      }

      if (pathname.startsWith('/api/profiles/')) {
        const id = pathname.replace('/api/profiles/', '');
        if (req.method === 'PUT') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              this.db.saveProfile({ id, name: data.name, color: data.color, processes: data.processes });
              res.writeHead(200).end(JSON.stringify({ success: true }));
            } catch (err) {
              res.writeHead(400).end(JSON.stringify({ error: String(err) }));
            }
          });
          return;
        }
        if (req.method === 'DELETE') {
          this.db.deleteProfile(id);
          res.writeHead(200).end(JSON.stringify({ success: true }));
          return;
        }
      }

      res.writeHead(404).end(JSON.stringify({ error: 'Unknown endpoint' }));
    } catch (err) {
      console.error('API error:', err);
      res.writeHead(500).end(JSON.stringify({ error: String(err) }));
    }
  }
}
