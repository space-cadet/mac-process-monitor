# Mac Process Monitor — Web Dashboard Implementation

*Project*: mac-process-monitor  
*Component*: Web Dashboard (T4)  
*Last Updated*: 2026-06-22

## Overview

Real-time web dashboard for monitoring macOS system metrics. Serves from a lightweight Node HTTP server with vanilla JS frontend. No framework dependencies.

**Current Version**: v4 — 5 KPI cards, 5 chart tabs, Analysis tab with 8 preset SQL queries, Settings tab with auto-save, disk/network monitoring.

## Architecture

```
┌─────────────────────────────────────────┐
│           Browser (any device)            │
│  ┌─────────────────────────────────────┐ │
│  │  index.html + app.js + styles.css   │ │
│  │  • Auto-refresh every 5s            │ │
│  │  • 5 KPI cards (battery, CPU, mem,  │ │
│  │    disk, network)                   │ │
│  │  • Process table (sortable columns) │ │
│  │  • 5 Chart tabs (battery, CPU, mem, │ │
│  │    disk, network)                   │ │
│  │  • Analysis tab: 8 preset queries   │ │
│  │  • Settings tab: auto-save config   │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
                    │
                    ▼ HTTP (port 3456)
┌─────────────────────────────────────────┐
│       src/web/server.ts (Node HTTP)     │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ │
│  │/api/    │ │/api/     │ │/api/     │ │
│  │snapshot │ │history   │ │drain-    │ │
│  │ (LIVE)  │ │ (DB)     │ │events   │ │
│  └─────────┘ └──────────┘ └──────────┘ │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ │
│  │/api/    │ │/api/     │ │/api/     │ │
│  │config   │ │analysis/*│ │restart  │ │
│  │(R/W)    │ │(8 presets│ │(POST)   │ │
│  └─────────┘ └──────────┘ └──────────┘ │
│  ┌─────────────────────────────────────┐ │
│  │ Static files: web/public/*          │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## Server (`src/web/server.ts`)

### Design Decisions

- **Native Node `createServer`** — No Express dependency, lighter weight
- **Live data for snapshot** — `/api/snapshot` calls `SystemCollector.getSystemSnapshot()` directly, not DB cache. Ensures current data even if monitor isn't running.
- **DB for history** — `/api/history` and `/api/drain-events` read from SQLite
- **CORS enabled** — Allows access from Android/other devices on local network
- **0.0.0.0 binding** — Accessible from any device on LAN

### API Endpoints

| Endpoint | Method | Data Source | Returns |
|----------|--------|-------------|---------|
| `GET /api/snapshot` | GET | Live collection | Current battery, CPU, memory, disk, network, processes |
| `GET /api/history?minutes=60` | GET | SQLite DB | Time-series: timestamp, battery_percent, cpu_total, memory_total, **disk_total_io, net_rx_bytes, net_tx_bytes, fs_used_percent** |
| `GET /api/drain-events` | GET | SQLite DB | Drain events with associated processes |
| `GET /api/config` | GET | `~/.procmon/config.json` | Full monitor configuration |
| `POST /api/config` | POST | `~/.procmon/config.json` | Save configuration |
| `POST /api/restart` | POST | Process spawn | Restarts monitor process |
| `GET /api/db-size` | GET | SQLite `PRAGMA page_count` | DB size in MB, table counts |
| `GET /api/server-info` | GET | Runtime | Version, uptime, node version, platform |

#### Analysis Endpoints (8 presets)

| Endpoint | Returns |
|----------|---------|
| `GET /api/analysis/battery-trend` | Daily min/avg/max battery % |
| `GET /api/analysis/top-battery-impact` | Processes ranked by accumulated impact score |
| `GET /api/analysis/spike-patterns` | Per-process spike frequency and thresholds |
| `GET /api/analysis/drain-correlation` | Top processes during drain events |
| `GET /api/analysis/idle-active` | Hourly activity pattern (low/medium/high) |
| `GET /api/analysis/process-stats` | Avg/peak/stddev CPU per process (7-day) |
| `GET /api/analysis/disk-trend` | Daily min/avg/max disk usage % |
| `GET /api/analysis/network-trend` | Daily RX/TX cumulative volume in MB |

### Key Code Pattern

```typescript
// /api/snapshot — ALWAYS live, never stale DB
if (pathname === '/api/snapshot') {
  const snapshot = await collector.getSystemSnapshot();  // Live!
  res.end(JSON.stringify(snapshot));
}

// /api/history — DB time-series (includes disk/network since v4)
if (pathname === '/api/history') {
  const history = db.getSnapshotHistory(minutes);
  res.end(JSON.stringify(history));
}

// /api/analysis/* — SQL aggregation queries
if (pathname.startsWith('/api/analysis/')) {
  const result = db.runAnalysisQuery(presetName);
  res.end(JSON.stringify(result));
}
```

## Frontend (`web/public/app.js`)

### State Management

No framework — plain JS with module-level variables:

```javascript
let currentProcesses = [];      // Last fetched process list
let currentSort = { column: 'cpu', direction: 'desc' };
let refreshInterval = null;     // 5s auto-refresh timer
let chartHistoryData = [];      // Cached history for chart re-rendering
let currentChartTab = 'battery'; // Active chart tab
let analysisCache = new Map();  // 5-minute TTL cache for preset queries
let previousSnapshot = null;    // For computing network rates from deltas
```

### Data Flow

```
init()
  ├── fetchData() ──→ GET /api/snapshot
  │     └── updateDashboard(data)
  │           ├── updateBatteryCard()
  │           ├── updateCpuCard()
  │           ├── updateMemCard()
  │           ├── updateDiskCard()       // NEW v4
  │           ├── updateNetworkCard()    // NEW v4 (live rates)
  │           ├── updateStatusCard()
  │           └── renderProcesses()
  ├── loadHistory(60) ──→ GET /api/history?minutes=60
  │     └── renderChart(data, tab)       // Tab-aware rendering
  ├── loadDrainEvents() ──→ GET /api/drain-events
  │     └── renderDrainEvents(events)
  ├── initSettingsAutoSave()            // NEW v4
  │     └── debouncedAutoSave()
  └── initChartTabs()                   // NEW v4

Every 5s: fetchData() + loadDrainEvents()
```

### Chart Implementation

**SVG Line Chart** — No Chart.js or D3 dependency. Supports 5 chart types via tab switching.

**Features**:
- Smooth line connecting data points
- Gradient area fill under the line
- Data points shown as circles (sampled to ~20 points)
- Hover tooltips showing exact values and time
- Responsive SVG with `preserveAspectRatio="none"`
- **Dynamic Y-axis scaling** — auto-computes max from visible data
- **Adaptive unit labels** — B/s → KB/s → MB/s for network; IO/s for disk

**Tab Switching**:
```javascript
function renderLineChart(data, type) {
  switch(type) {
    case 'battery': yValue = d => d.battery_percent; max = 100; label = '%';
    case 'cpu':     yValue = d => d.cpu_total;       max = auto; label = '%';
    case 'memory':  yValue = d => d.memory_total;    max = auto; label = '%';
    case 'disk':    yValue = d => d.disk_rate;       max = auto; label = 'IO/s';
    case 'network': yValue = d => d.network_rate;    max = auto; label = 'KB/s';
  }
}
```

**Rate Computation (v4)**:
Disk and network counters are cumulative since boot. The frontend computes rates from deltas:
```javascript
// For each data point after the first:
const diskDelta = d.disk_total_io - prev.disk_total_io;
const diskRate = diskDelta / (deltaMs / 1000);  // IO per second

const netRxDelta = Math.max(0, d.net_rx_bytes - prev.net_rx_bytes);
const netRate = netRxDelta / 1024 / (deltaMs / 1000);  // KB/s
```

### Process Table

| Column | Sortable | Display |
|--------|----------|---------|
| Process | **Yes** | Name + icon (truncated with ellipsis on mobile) |
| PID | **Yes** | Process ID |
| CPU | **Yes** (▼ default) | Percentage + visual bar |
| Memory | **Yes** | **MB value** + visual bar |

**Clickable Headers**: Click any column header to sort by that column. Click again to reverse order (asc/desc). Visual indicator shows ▼ (desc) or ▲ (asc).

### Auto-Save Settings (v4)

```javascript
function initSettingsAutoSave() {
  const inputs = document.querySelectorAll('#settingsTab input, #settingsTab select');
  inputs.forEach(input => {
    input.addEventListener('change', debouncedAutoSave);
    if (input.type === 'number') {
      input.addEventListener('input', debouncedAutoSave);  // Real-time for sliders
    }
  });
}

function debouncedAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveMonitorConfig(true), 500);  // silent=true
}

function showAutoSaveIndicator() {
  // Transient "💾 Saved" toast bottom-right, fades after 2s
}
```

### Analysis Query Caching (v4)

```javascript
const analysisCache = new Map();  // key -> { data, timestamp }
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes

function runPresetQuery(preset) {
  const cached = analysisCache.get(preset);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    renderAnalysisResults(cached.data, preset);
    return;
  }
  fetch(`/api/analysis/${preset}`)
    .then(r => r.json())
    .then(data => {
      analysisCache.set(preset, { data, timestamp: Date.now() });
      renderAnalysisResults(data, preset);
    });
}
```

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
  --accent-cpu: #a78bfa;      /* Purple */
  --accent-mem: #34d399;      /* Green */
  --accent-drain: #f87171;    /* Red */
  --accent-disk: #8b5cf6;     /* Violet — NEW v4 */
  --accent-network: #06b6d4;  /* Cyan-blue — NEW v4 */
  --font-display: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

### Layout

- **Header**: Title + live indicator (pulsing green dot)
- **KPI Grid**: 5 cards in auto-fit grid (2×2 desktop, wraps on smaller screens)
- **Main Grid**: Process table + Chart side by side (desktop), stacked (mobile)
- **Chart Tabs**: Battery | CPU | Memory | Disk | Network
- **Analysis Tab**: Sidebar (preset buttons) + results area
- **Settings Tab**: Form inputs with auto-save

### Responsive Breakpoints

```css
@media (max-width: 768px) {
  .main-grid { grid-template-columns: 1fr; }
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .process-table th, .process-table td { padding: 8px 12px; font-size: 12px; }
}

@media (max-width: 640px) {
  .chart-tabs {
    flex-wrap: nowrap;
    overflow-x: auto;        /* Horizontal scroll for tabs */
    -webkit-overflow-scrolling: touch;
  }
}
```

**Mobile Optimizations**:
- Table wrapped in `.table-wrapper` with `overflow-x: auto`
- Chart tabs scroll horizontally on narrow screens
- Process names truncate with ellipsis if too long
- Reduced padding and font sizes
- Smaller CPU/memory bar tracks

## Data Format Handling

### Snake Case vs Camel Case

The DB uses `snake_case` column names. The API returns them directly (no transformation). Frontend uses `??` fallback for compatibility:

```javascript
// In renderChart()
const percent = d.battery_percent ?? d.batteryPercent ?? 0;
const diskIO = d.disk_total_io ?? d.diskTotalIO ?? 0;
const netRx = d.net_rx_bytes ?? d.netRxBytes ?? 0;
```

**Rule**: Frontend should always use `??` fallback for API fields that may change casing.

## Deployment

### Persistent Service (launchd)

Dashboard runs as a macOS LaunchDaemon for continuous operation:

```xml
<!-- /Library/LaunchDaemons/ai.openclaw.procmon.dashboard.plist -->
<key>Label</key>
<string>ai.openclaw.procmon.dashboard</string>
<key>RunAtLoad</key>
<true/>
<key>KeepAlive</key>
<dict>
  <key>SuccessfulExit</key>
  <false/>
</dict>
<key>UserName</key>
<string>sage</string>
```

**Management**:
```bash
# Check status
sudo launchctl list | grep procmon

# Stop
sudo launchctl unload /Library/LaunchDaemons/ai.openclaw.procmon.dashboard.plist

# Start
sudo launchctl load /Library/LaunchDaemons/ai.openclaw.procmon.dashboard.plist
```

## Known Limitations

1. **No auth**: Dashboard is open on local network (acceptable for home use)
2. **No WebSocket**: Polling every 5s (simple but not real-time)
3. **Sampling**: Battery chart samples to ~60 points max for visibility
4. **Disk/Network counter resets**: Cumulative counters reset on reboot; frontend clamps negative deltas to 0

## Testing

### Manual Test Checklist

- [ ] Dashboard loads at `http://localhost:3456`
- [ ] Accessible from phone on `http://192.168.1.x:3456`
- [ ] 5 KPI cards show live data (battery, CPU, mem, disk %, network throughput)
- [ ] Process table shows top 10 by CPU
- [ ] Click chart tabs switches between battery/CPU/memory/disk/network
- [ ] Disk chart shows I/O rate (not cumulative counters)
- [ ] Network chart shows KB/s rate (not cumulative bytes)
- [ ] Hover over chart points shows tooltip with value + time
- [ ] Analysis tab: all 8 preset queries run and return results
- [ ] Clicking same preset twice uses cache (instant, no loading state)
- [ ] Settings tab: change a value, wait 500ms, "Saved" toast appears
- [ ] Restart monitor button works (with confirmation)
- [ ] Table scrolls horizontally on mobile
- [ ] Chart tabs scroll horizontally on mobile (<640px)

### Debug

```javascript
// In browser console:
fetch('/api/snapshot').then(r => r.json()).then(console.log)
fetch('/api/history?minutes=60').then(r => r.json()).then(d => console.log(d.length, d[0]))
fetch('/api/analysis/disk-trend').then(r => r.json()).then(console.log)
fetch('/api/analysis/network-trend').then(r => r.json()).then(console.log)
```

## Files

| File | Purpose | Lines (approx) |
|------|---------|---------------|
| `src/web/server.ts` | HTTP server + API routes | ~300+ |
| `web/public/index.html` | Dashboard markup (3 tabs) | ~200+ |
| `web/public/app.js` | Frontend logic | ~600+ |
| `web/public/styles.css` | Dark theme styling | ~600+ |
| `check-and-start.sh` | Cron health check + auto-restart | ~40 |

---

*See also*: `architecture.md` for overall system design, `core-pipeline.md` for collector/analyzer/DB details, `memory-bank/tasks/T4.md` for task progress.
