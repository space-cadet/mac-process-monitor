# Mac Process Monitor — Web Dashboard Implementation

*Project*: mac-process-monitor  
*Component*: Web Dashboard (T4)  
*Last Updated*: 2026-05-25  

## Overview

Real-time web dashboard for monitoring macOS system metrics. Serves from a lightweight Node HTTP server with vanilla JS frontend. No framework dependencies.

## Architecture

```
┌─────────────────────────────────────────┐
│           Browser (any device)            │
│  ┌─────────────────────────────────────┐ │
│  │  index.html + app.js + styles.css │ │
│  │  • Auto-refresh every 5s            │ │
│  │  • KPI cards (battery, CPU, mem)    │ │
│  │  • Process table (sortable columns) │ │
│  │  • Battery history line chart       │ │
│  │  • Drain events + CSV export        │ │
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

| Endpoint | Data Source | Returns |
|----------|-------------|---------|
| `GET /api/snapshot` | Live collection | Current battery, CPU, processes |
| `GET /api/history?minutes=60` | SQLite DB | Time-series: timestamp, battery_percent, cpu_total, memory_total |
| `GET /api/drain-events` | SQLite DB | Drain events with associated processes |

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
```

## Frontend (`web/public/app.js`)

### State Management

No framework — plain JS with module-level variables:

```javascript
let currentProcesses = [];  // Last fetched process list
let currentSort = { column: 'cpu', direction: 'desc' };  // Sort state
let refreshInterval = null; // 5s auto-refresh timer
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
  │           └── renderProcesses() ──→ sort + top 10
  ├── loadHistory(60) ──→ GET /api/history?minutes=60
  │     └── renderChart(data)
  └── loadDrainEvents() ──→ GET /api/drain-events
        └── renderDrainEvents(events)

Every 5s: fetchData() + loadDrainEvents()
```

### Chart Implementation

**SVG Line Chart** — No Chart.js or D3 dependency.

**Features**:
- Smooth line connecting data points
- Gradient area fill under the line
- Data points shown as circles (sampled to ~20 points)
- Hover tooltips showing exact battery % and time
- Responsive SVG with `preserveAspectRatio="none"`

**Code**:
```javascript
function renderChart(data) {
  const points = data.map((d, i) => {
    const percent = d.battery_percent ?? d.batteryPercent ?? 0;
    const x = padding.left + (i / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((percent / 100)) * chartHeight;
    return { x, y, percent };
  });

  const pathD = points.map((p, i) => 
    `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
  ).join(' ');

  // SVG with gradient fill and line stroke
}
```

### Process Table

| Column | Sortable | Display |
|--------|----------|---------|
| Process | **Yes** | Name + icon (truncated with ellipsis on mobile) |
| PID | **Yes** | Process ID |
| CPU | **Yes** (▼ default) | Percentage + visual bar |
| Memory | **Yes** | **MB value** + visual bar |

**Clickable Headers**: Click any column header to sort by that column. Click again to reverse order (asc/desc). Visual indicator shows ▼ (desc) or ▲ (asc).

**CPU bar**: 
- Track: 60px wide, 4px tall, dark background
- Fill: colored bar, width = percentage
- Color: default blue, `high` class = red if > 50%

**Memory bar**:
- Shows actual **MB consumed** (e.g., "404 MB") not percentage
- Visual bar still uses `memoryPercent` for relative scale
- More actionable than abstract percentage

### Sorting

```javascript
function sortByColumn(column) {
  if (currentSort.column === column) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.column = column;
    currentSort.direction = 'desc';
  }
  renderProcesses();
}

function renderProcesses() {
  const sorted = [...currentProcesses].sort((a, b) => {
    let valA, valB;
    switch (currentSort.column) {
      case 'name': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
      case 'pid': valA = a.pid; valB = b.pid; break;
      case 'cpu': valA = a.cpuPercent; valB = b.cpuPercent; break;
      case 'memory': valA = a.memoryPercent; valB = b.memoryPercent; break;
    }
    if (currentSort.direction === 'asc') return valA > valB ? 1 : -1;
    return valA < valB ? 1 : -1;
  }).slice(0, 10);
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
  --font-display: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

### Layout

- **Header**: Title + live indicator (pulsing green dot)
- **KPI Grid**: 4 cards in 2×2 grid (desktop), 2×2 (tablet), 1 column (mobile)
- **Main Grid**: Process table + Battery chart side by side (desktop), stacked (mobile)
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
// In renderChart()
const percent = d.battery_percent ?? d.batteryPercent ?? 0;

// In server.ts (if reconstructing from DB)
processes.map(p => ({
  cpuPercent: p.cpu_percent,      // DB → JS
  memoryPercent: p.memory_percent,
  rssMB: p.rss_mb,
}))
```

**Rule**: Frontend should always use `??` fallback for API fields that may change casing.

## Deployment

### Persistent Service (launchd)

Dashboard runs as a macOS LaunchAgent for continuous operation:

```xml
<!-- ~/Library/LaunchAgents/com.deepak.mac-process-monitor.dashboard.plist -->
<key>Label</key>
<string>com.deepak.mac-process-monitor.dashboard</string>
<key>RunAtLoad</key>
<true/>
<key>KeepAlive</key>
<dict>
  <key>SuccessfulExit</key>
  <false/>
</dict>
```

**Management**:
```bash
# Check status
launchctl list | grep mac-process-monitor

# Stop
launchctl unload ~/Library/LaunchAgents/com.deepak.mac-process-monitor.dashboard.plist

# Start
launchctl load ~/Library/LaunchAgents/com.deepak.mac-process-monitor.dashboard.plist
```

## Known Limitations

1. **CPU history**: No chart yet — only battery history exists
2. **No auth**: Dashboard is open on local network (acceptable for home use)
3. **No WebSocket**: Polling every 5s (simple but not real-time)
4. **Sampling**: Battery chart samples to ~60 points max for visibility

## Testing

### Manual Test Checklist

- [ ] Dashboard loads at `http://localhost:3456`
- [ ] Accessible from phone on `http://192.168.1.x:3456`
- [ ] KPI cards show live data (battery %, CPU %, memory GB)
- [ ] Process table shows top 10 by CPU
- [ ] Click "Memory" header sorts by memory
- [ ] Click "Memory" again reverses sort order
- [ ] Battery chart shows smooth line graph
- [ ] Hover over data points shows tooltip
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
fetch('/api/drain-events').then(r => r.json()).then(console.log)
```

## Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/web/server.ts` | HTTP server + API routes | ~111 |
| `web/public/index.html` | Dashboard markup | ~123 |
| `web/public/app.js` | Frontend logic | ~234 |
| `web/public/styles.css` | Dark theme styling | ~512 |
| `com.deepak.mac-process-monitor.dashboard.plist` | launchd service config | ~35 |

---

*See also*: `architecture.md` for overall system design, `memory-bank/tasks/T4.md` for task progress.
