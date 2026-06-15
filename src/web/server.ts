import { TimeSeriesDB } from '../storage/TimeSeriesDB.js';
import { SystemCollector } from '../core/SystemCollector.js';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve DB path to canonical location (same as monitor)
const dbPath = join(process.env.HOME || '', '.procmon', 'monitor.db');
const db = new TimeSeriesDB(dbPath);
const collector = new SystemCollector();

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

const PORT = process.env.PORT || 3456;
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
