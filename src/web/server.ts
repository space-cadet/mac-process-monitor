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
