import { Monitor } from './core/Monitor.js';
import { TimeSeriesDB } from './storage/TimeSeriesDB.js';
import { SystemCollector } from './core/SystemCollector.js';
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Shared Resources ───
const dbPath = join(process.env.HOME || '', '.procmon', 'monitor.db');
const db = new TimeSeriesDB(dbPath);
const collector = new SystemCollector();

// ─── Monitor ───
const monitor = new Monitor({
  sampleIntervalSeconds: 30,
  dbPath,
  retentionDays: 30,
  alert: {
    enabled: true,
    drainThreshold: 1.0,
    minDuration: 2,
    cooldownMinutes: 10,
  },
});

// ─── Server Start Time ───
const serverStartTime = Date.now();

// ─── MIME Types ───
const mimeTypes: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// ─── HTTP Server ───
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = url.pathname;

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

  if (pathname === '/api/db-size') {
    try {
      const stats = statSync(dbPath);
      const size = stats.size;
      const sizeMB = (size / (1024 * 1024)).toFixed(2);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ size, sizeMB, path: dbPath }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
    return;
  }

  if (pathname === '/api/server-info') {
    const uptimeMs = Date.now() - serverStartTime;
    const uptimeSec = Math.floor(uptimeMs / 1000);
    const uptimeMin = Math.floor(uptimeSec / 60);
    const uptimeHr = Math.floor(uptimeMin / 60);
    let uptimeStr;
    if (uptimeHr > 0) {
      uptimeStr = `${uptimeHr}h ${uptimeMin % 60}m ${uptimeSec % 60}s`;
    } else if (uptimeMin > 0) {
      uptimeStr = `${uptimeMin}m ${uptimeSec % 60}s`;
    } else {
      uptimeStr = `${uptimeSec}s`;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      startTime: serverStartTime,
      uptimeMs,
      uptimeSec,
      uptimeStr,
      port: PORT,
      host: HOST,
    }));
    return;
  }

  // Static files
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = join(__dirname, '../web/public', filePath);

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

const PORT = process.env.PORT || 3456;
const HOST = '0.0.0.0';

// ─── Start Everything ───
async function start() {
  await monitor.start();

  server.listen(PORT, HOST, () => {
    console.log(`[Dashboard] Server running on http://${HOST}:${PORT}`);
    console.log(`[Dashboard] API endpoints:`);
    console.log(`  GET http://<your-ip>:${PORT}/api/snapshot`);
    console.log(`  GET http://<your-ip>:${PORT}/api/history?minutes=60`);
    console.log(`  GET http://<your-ip>:${PORT}/api/drain-events`);
  });
}

// ─── Graceful Shutdown ───
process.on('SIGINT', () => {
  console.log('\n[Combined] SIGINT received, shutting down...');
  monitor.stop();
  db.close();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  console.log('\n[Combined] SIGTERM received, shutting down...');
  monitor.stop();
  db.close();
  server.close(() => process.exit(0));
});

start().catch((err) => {
  console.error('[Combined] Fatal error:', err);
  process.exit(1);
});
