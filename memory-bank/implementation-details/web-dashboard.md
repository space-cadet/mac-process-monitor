# Mac Process Monitor — Web Dashboard Implementation

*Project*: mac-process-monitor
*Component*: Web Dashboard (T4)
*Last Updated*: 2026-05-26

## Overview

Real-time web dashboard for monitoring macOS system metrics. Serves from a lightweight Node HTTP server with vanilla JS frontend. No framework dependencies.

Two deployment modes:
1. **Standalone** (`src/web/server.ts`): Dashboard only, queries existing DB
2. **Unified** (`src/combined.ts`): Monitor + dashboard in one process — recommended

## Architecture

```
┌─────────────────────────────────────────┐
│           Browser (any device)            │
│  ┌─────────────────────────────────────┐ │
│  │  index.html + app.js + styles.css │ │
│  │  • Auto-refresh every 5s            │ │
│  │  • KPI cards (battery, CPU, mem)    │ │
│  │  • Process table (sortable columns) │ │
│  │  • Chart tabs (Battery/CPU/Memory)  │ │
│  │  • DB size + uptime badges          │ │
│  │  • Profile filtering                │ │
│  │  • Drain events + CSV export        │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
                    │
                    ▼ HTTP (port 3456)
┌─────────────────────────────────────────┐
│       src/combined.ts (Unified)         │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Monitor │ │ HTTP     │ │ Static   │ │
│  │ (loop)  │ │ Server   │ │ Files    │ │
│  │ 30s     │ │ (API)    │ │ (public) │ │
│  └─────────┘ └──────────┘ └──────────┘ │
│         │              │                │
│         └──────┬───────┘                │
│                ▼                        │
│         TimeSeriesDB (SQLite)           │
└─────────────────────────────────────────┘
```

## Server

### Deployment Modes

#### Unified Mode (`src/combined.ts`) — Recommended

```typescript
import { Monitor } from './core/Monitor.js';
import { TimeSeriesDB } from './storage/TimeSeriesDB.js';
import { SystemCollector } from './core/SystemCollector.js';

const db = new TimeSeriesDB(dbPath);
const collector = new SystemCollector();
const monitor = new Monitor({ sampleIntervalSeconds: 30, dbPath, ... });

// HTTP server shares the same DB and collector instances
const server = createServer(async (req, res) => { ... });

await monitor.start();
server.listen(PORT, HOST);
```

**Benefits**:
- Single process to manage
- Shared DB connection (no WAL contention)
- Live `/api/snapshot` uses same `SystemCollector` instance
- Graceful shutdown stops both monitor and server

#### Standalone Mode (`src/web/server.ts`)

Use when monitor is already running separately (e.g., as a background daemon).

### API Endpoints

| Endpoint | Data Source | Returns |
|----------|-------------|---------|
| `GET /api/snapshot` | Live collection | Current battery, CPU, processes |
| `GET /api/history?minutes=60` | SQLite DB | Time-series: timestamp, battery_percent, cpu_total, memory_total |
| `GET /api/drain-events` | SQLite DB | Drain events with associated processes |
| `GET /api/process-history?name=X&minutes=30` | SQLite DB | Per-process CPU/memory history |
| `GET /api/process-stats?name=X&minutes=60` | SQLite DB | Process stats + PID history |
| `GET /api/top-processes?metric=cpu&limit=10` | SQLite DB | Top N processes by metric |
| `GET /api/profiles` | SQLite DB | Process profile management (GET/POST/DELETE) |
| `GET /api/db-size` | File system | DB size in bytes and MB |
| `GET /api/server-info` | Runtime | Uptime, port, host, start time |

### Key Code Pattern

```typescript
// /api/snapshot — ALWAYS live, never stale DB
if (pathname === '/api/snapshot') {
  const snapshot = await collector.getSystemSnapshot();  // Live!
  res.end(JSON.stringify(snapshot));
}

// /api/history — DB time-series
if (pathname === '/api/history') {
  const history = db.getSnapshotHistory(minutes);
  res.end(JSON.stringify(history));
}

// /api/db-size — File system stats
if (pathname === '/api/db-size') {
  const stats = statSync(dbPath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  res.end(JSON.stringify({ size, sizeMB, path: dbPath }));
}

// /api/server-info — Runtime uptime
if (pathname === '/api/server-info') {
  const uptimeMs = Date.now() - serverStartTime;
  // ... format human-readable uptime string
  res.end(JSON.stringify({ startTime, uptimeMs, uptimeSec, uptimeStr, port, host }));
}
```

## Frontend (`web/public/app.js`)

### State Management

No framework — plain JS with module-level variables:

```javascript
let currentProcesses = [];      // Last fetched process list
let currentSort = { column: 'cpu', direction: 'desc' };  // Sort state
let refreshInterval = null;     // 5s auto-refresh timer
let currentChartTab = 'battery'; // Active chart tab
let chartHistoryData = [];      // Cached history for tab switching
let chartTimeRange = 60;        // Current history range in minutes
let activeProfileFilter = null; // Current profile filter
```

### Data Flow

```
init()
  ├── fetchData() ──→ GET /api/snapshot
  │     └── updateDashboard(data)
  │           ├── updateBatteryCard()
  │           ├── updateCpuCard()
  │           ├── updateMemCard()
  │           ├── updateStatusCard()
  │           └── renderProcesses() ──→ sort + filter + render
  ├── loadHistory(60) ──→ GET /api/history?minutes=60
  │     └── renderLineChart(data)
  ├── loadDbSize() ──→ GET /api/db-size
  ├── loadServerInfo() ──→ GET /api/server-info
  └── loadDrainEvents() ──→ GET /api/drain-events
        └── renderDrainEvents(events)

Every 5s: fetchData() + loadDbSize() + loadServerInfo() + loadDrainEvents()
```

### Chart Implementation

**SVG Line Chart** — No Chart.js or D3 dependency.

**Features**:
- Tab switching between Battery, CPU, Memory metrics
- Smooth line connecting data points
- Gradient area fill under the line
- Data points shown as circles (sampled to ~15 points)
- Hover tooltips showing exact value and time
- Responsive SVG with `preserveAspectRatio="none"`
- Dynamic Y-axis labels and stroke color per metric

**Code**:
```javascript
function renderLineChart(data) {
  // Determine metric based on active tab
  let metricKey, accentColor;
  switch (currentChartTab) {
    case 'cpu':    metricKey = 'cpu_total';    accentColor = 'var(--accent-cpu)'; break;
    case 'memory': metricKey = 'memory_total'; accentColor = 'var(--accent-mem)'; break;
    default:       metricKey = 'battery_percent'; accentColor = 'var(--accent-battery)';
  }

  // Build points
  const points = data.map((d, i) => {
    const val = d[metricKey] ?? d[metricKey.replace('_', '')] ?? 0;
    const x = padding.left + (i / (n - 1 || 1)) * chartW;
    const y = padding.top + chartH - ((val / maxVal) * chartH);
    return { x, y, val, ts: d.timestamp };
  });

  // Line path + area fill path
  const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const areaD = `${lineD} L ... Z`; // close the bottom
}
```

### Chart Tabs

```javascript
function switchChartTab(tab) {
  currentChartTab = tab;
  // Update active class on buttons
  document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.chart-tab[data-tab="${tab}"]`).classList.add('active');
  // Re-render with cached data
  renderLineChart(chartHistoryData);
}
```

Tab styling uses CSS custom properties for color per metric:
- Battery: cyan (`--accent-battery`)
- CPU: amber (`--accent-cpu`)
- Memory: purple (`--accent-mem`)

### Process Table

| Column | Sortable | Display |
|--------|----------|---------|
| Process | **Yes** | Name + icon (truncated with ellipsis on mobile) |
| PID | **Yes** | Process ID |
| CPU | **Yes** (▼ default) | Percentage + visual bar |
| Memory | **Yes** | **MB value** + visual bar |

**Clickable Headers**: Click any column header to sort by that column. Click again to reverse order (asc/desc). Visual indicator shows ▼ (desc) or ▲ (asc).

**Profile Filtering**: When a profile is active, only processes matching the profile names are shown. Sorting works within the filtered set. "Show All" clears the filter.

**CPU bar**:
- Track: 60px wide, 4px tall, dark background
- Fill: colored bar, width = percentage
- Color: default blue, `high` class = red if > 50%

**Memory bar**:
- Shows actual **MB consumed** (e.g., "404 MB") not percentage
- Visual bar still uses `memoryPercent` for relative scale
- More actionable than abstract percentage

### Badges

**DB Size Badge** (`🗄`):
- Fetches `/api/db-size` every 5 seconds
- Displays `🗄 15.91 MB` format
- Falls back to `🗄 --` on error

**Uptime Badge** (`⏱`):
- Fetches `/api/server-info` every 5 seconds
- Displays `⏱ 3h 42m 15s` format
- Falls back to `⏱ --` on error

### Battery Status

Three states:
1. **Charging** — `isCharging = true`
2. **Plugged In** — `isPlugged = true`, `isCharging = false`
3. **On battery** — `isPlugged = false`

Time remaining:
- When plugged in: shows "AC power"
- When on battery: shows "Xh remaining" (if valid)
- Otherwise: "--"

## Styling (`web/public/styles.css`)

### Design System

```css
:root {
  --bg: #0f1115;           /* Deep charcoal background */
  --surface: #181b21;      /* Card background */
  --surface-raised: #1e2128; /* Elevated elements */
  --text: #e2e8f0;         /* Primary text */
  --text-dim: #94a3b8;     /* Secondary text */
  --border: rgba(255,255,255,0.06);
  --accent-battery: #22d3ee;  /* Cyan */
  --accent-cpu: #f59e0b;      /* Amber */
  --accent-mem: #a78bfa;      /* Purple */
  --accent-drain: #f87171;    /* Red */
  --font-display: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

### Layout

- **Header**: Title + uptime badge + DB size badge + live indicator (pulsing green dot)
- **KPI Grid**: 4 cards in 2×2 grid (desktop), 2×2 (tablet), 1 column (mobile)
- **Main Grid**: Process table + Chart panel side by side (desktop), stacked (mobile)
- **Drain Events**: Full-width panel below

### Responsive Breakpoints

```css
@media (max-width: 768px) {
  .main-grid { grid-template-columns: 1fr; }  /* Stack panels */
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }  /* 2×2 KPIs */

  /* Process table: horizontal scroll, reduced padding */
  .process-table th, .process-table td { padding: 8px 12px; font-size: 12px; }
  .process-name span { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
}
```

**Mobile Optimizations**:
- Table wrapped in `.table-wrapper` with `overflow-x: auto`
- All 4 columns visible via horizontal scroll (no column hiding)
- Process names truncate with ellipsis if too long
- Reduced padding and font sizes
- Smaller CPU/memory bar tracks

## Data Format Handling

### Snake Case vs Camel Case

The DB uses `snake_case` column names, but the original code expected `camelCase`. Fixed with fallback:

```javascript
// In renderLineChart()
const val = d[metricKey] ?? d[metricKey.replace('_', '')] ?? 0;

// In server.ts (if reconstructing from DB)
processes.map(p => ({
  cpuPercent: p.cpu_percent,      // DB → JS
  memoryPercent: p.memory_percent,
  rssMB: p.rss_mb,
}))
```

**Rule**: Frontend should always use `??` fallback for API fields that may change casing.

## Deployment

### Recommended: Unified Process

```bash
npx tsx src/combined.ts
```

This runs both the monitor (30s sampling loop) and the dashboard server (port 3456) in a single process.

### Alternative: Separate Processes

```bash
# Terminal 1: Monitor
npx tsx src/main.ts

# Terminal 2: Dashboard
npx tsx src/web/server.ts
```

### Persistent Service (launchd)

⚠️ **Note**: A previous LaunchAgent (`com.deepak.mac-process-monitor.dashboard.plist`) was removed after 4,427 crash loops due to wrong WorkingDirectory. If re-creating, ensure `WorkingDirectory` points to the project root.

## Known Limitations

1. **No auth**: Dashboard is open on local network (acceptable for home use)
2. **No WebSocket**: Polling every 5s (simple but not real-time)
3. **Sampling**: Chart samples to ~15 points max for visibility

## Testing

### Manual Test Checklist

- [ ] Dashboard loads at `http://localhost:3456`
- [ ] Accessible from phone on `http://192.168.1.x:3456`
- [ ] KPI cards show live data (battery %, CPU %, memory GB)
- [ ] Process table shows top processes by CPU
- [ ] Click "Memory" header sorts by memory
- [ ] Click "Memory" again reverses sort order
- [ ] Battery chart shows smooth line graph
- [ ] CPU chart tab shows CPU history line graph
- [ ] Memory chart tab shows memory history line graph
- [ ] Hover over data points shows tooltip
- [ ] DB size badge shows current DB size
- [ ] Uptime badge shows server uptime
- [ ] Profile filter works and persists
- [ ] Auto-refresh updates every 5s (check timestamp)
- [ ] Drain events panel shows "No drain events" (or real events)
- [ ] Export CSV button works (when events exist)
- [ ] Table scrolls horizontally on mobile
- [ ] Process names truncate with ellipsis on narrow screens

### Debug

```javascript
// In browser console:
fetch('/api/snapshot').then(r => r.json()).then(console.log)
fetch('/api/history?minutes=60').then(r => r.json()).then(d => console.log(d.length, d[0]))
fetch('/api/db-size').then(r => r.json()).then(console.log)
fetch('/api/server-info').then(r => r.json()).then(console.log)
fetch('/api/drain-events').then(r => r.json()).then(console.log)
```

## Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/combined.ts` | Unified monitor + dashboard process | ~274 |
| `src/web/server.ts` | Standalone HTTP server + API routes | ~260 |
| `web/public/index.html` | Dashboard markup | ~140 |
| `web/public/app.js` | Frontend logic | ~400 |
| `web/public/styles.css` | Dark theme styling | ~700 |

---

*See also*: `architecture.md` for overall system design, `memory-bank/tasks/T4.md` for task progress.
