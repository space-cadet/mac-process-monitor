# mac-process-monitor

A macOS system monitor that tracks battery drain, CPU/memory spikes, and correlates them with running processes. Built in TypeScript with SQLite time-series storage and a real-time web dashboard.

**GitHub**: https://github.com/space-cadet/mac-process-monitor (public)

## What It Does

- **Monitors system metrics** in real-time (battery, CPU, memory, disk, network, temperature via `systeminformation`)
- **Detects battery drain** — identifies periods where battery drops while not charging, and correlates with process activity
- **Tracks process spikes** — per-process baseline tracking with dual-threshold detection (absolute + relative)
- **Correlates battery impact** — accumulates per-process impact scores over time to find the worst battery drainers
- **Web dashboard** — live charts, sortable process table, spike alerts, battery impact rankings, monitoring profiles
- **CLI queries** — inspect history, stats, spikes, and battery impact from the terminal
- **SQLite time-series storage** — all data persisted locally with WAL mode for concurrent reads

## Quick Start

```bash
# Install dependencies
pnpm install

# Run the monitor (samples every 30s, logs to ~/.procmon/monitor.db)
npx tsx src/main.ts

# Start the dashboard (in another terminal)
npx tsx src/dashboard.ts 3456

# Open dashboard
open http://localhost:3456

# Show current system data
npx tsx src/show-data.ts

# Run diagnostic tests
npx tsx src/test-basic.ts      # Battery + process validation
npx tsx src/test-collector.ts  # Collector + DB integration
npx tsx src/test-analyzer.ts   # Drain detection with fake data
```

## Architecture

```
src/
  types/
    index.ts              # All TypeScript interfaces
  core/
    SystemCollector.ts    # Battery + process + system metric sampling
    DrainAnalyzer.ts      # Sliding window battery drain detection
    SpikeDetector.ts      # Per-process baseline tracking + spike detection
    BatteryImpactAnalyzer.ts # Drain period correlation + impact scoring
    Monitor.ts            # Orchestrator loop (all analyzers)
  storage/
    TimeSeriesDB.ts       # SQLite time-series storage (6 tables)
  dashboard/
    server.ts             # Native Node.js HTTP API server (12 endpoints)
    public/               # 7-file modular frontend
      index.html          # Layout: side-by-side (desktop), stacked (mobile)
      style.css           # Dark theme, responsive, cards, modals
      utils.js            # Formatting, sorting, DOM helpers, API wrappers
      charts.js           # Chart.js setup: 5 chart instances
      tables.js           # Sortable table, process modal, spike/battery panels
      profiles.js         # Profile CRUD: create/edit/delete groups
      app.js              # Orchestration: data fetch, refresh loop, events
  query.ts                # CLI query tool (--spikes, --battery, --top, --process)
  main.ts                 # Monitor entry point
```

## How It Works

### Battery Drain Detection (T1)
1. **Sample** battery + top processes every 30 seconds
2. **Store** in SQLite (`snapshots` + `process_samples` tables)
3. **Analyze** sliding 5-minute window for battery drop
4. **Trigger** if drop rate exceeds threshold (default: 1%/min for 2+ minutes)
5. **Correlate** — find processes with highest average CPU during the drain window

### Spike Detection (T6)
1. **Baseline** — maintains rolling average of CPU/memory per process
2. **Detect** — triggers when process exceeds absolute threshold (CPU >50%, memory >20%) OR relative multiplier (3x above baseline)
3. **Cooldown** — 60-second per-process cooldown to avoid spam
4. **Store** — spike events logged to `process_spikes` table

### Battery Impact Scoring (T7)
1. **Drain period** — battery not charging and dropping ≥2% over ≥2 minutes
2. **Accumulate** — per-process CPU-seconds during drain period
3. **Score** — process share of total CPU-seconds × battery drop percentage
4. **Rank** — accumulated scores in `battery_impact` table, updated via `INSERT ... ON CONFLICT DO UPDATE`

## Dashboard Features

### Live Charts (Right Column)
- **CPU & Memory** — CPU total, user, system + memory percentage
- **Battery** — Battery level over time with fill
- **Load, Swap, Temperature** — System load average, swap usage, CPU temperature
- **Disk & Network I/O** — Disk read/write, network rx/tx

### Tables (Left Column)
- **Sortable Process Table** — Click any column to sort. Click a row → process detail modal
- **Spike Alerts** — Recent CPU/memory spikes with color-coded cards. Click → modal
- **Drain Events** — Historical battery drain incidents with top process

### Process Detail Modal
- **Statistics** — Avg/peak CPU & memory, sample count, first/last seen
- **History Chart** — 60-minute CPU + memory trend line
- **Recent Samples** — Timestamped data points

### Battery Impact Rankings (Right Column)
- Bar chart of accumulated impact scores per process
- Shows drain time, sample count, avg CPU during drain
- Click any bar → process detail modal

### Monitoring Profiles (Bottom)
- Create named process groups (e.g., "Browsers" = Chrome + Safari + Firefox)
- Color-coded cards with process count
- Click a profile → filters process table to matching processes
- Edit/delete profiles inline

### Responsive Design
- **Desktop** (`>900px`): Side-by-side layout (tables left, charts right)
- **Mobile** (`<900px`): Stacked single column
- **Narrow** (`<600px`): Compact header, smaller charts, full-width cards

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/snapshots` | GET | Historical system snapshots |
| `/api/processes` | GET | Latest process list (top N by CPU) |
| `/api/drain-events` | GET | Battery drain events |
| `/api/stats` | GET | DB snapshot count, event count, **file size** |
| `/api/spikes` | GET | Recent resource usage spikes |
| `/api/spike-stats` | GET | Aggregated spike statistics |
| `/api/battery-impact` | GET | Ranked battery impact scores |
| `/api/battery-events` | GET | Individual drain period details |
| `/api/process-history` | GET | Per-process timeline (CPU + memory) |
| `/api/process-stats` | GET | Per-process statistics (avg/peak/min/max) |
| `/api/top-processes` | GET | Top N processes by CPU or memory |
| `/api/profiles` | GET/POST | Monitoring profile list / create |
| `/api/profiles/:id` | PUT/DELETE | Update / delete profile |

## CLI Queries

```bash
# Show recent spikes
npx tsx src/query.ts --spikes --since 1h

# Show battery impact rankings
npx tsx src/query.ts --battery --limit 10

# Show top processes by CPU
npx tsx src/query.ts --top --metric cpu --limit 10

# Show per-process history
npx tsx src/query.ts --process openclaw-gateway --since 1h

# Show general stats
npx tsx src/query.ts --stats
```

## Database Schema

**snapshots** — system-wide metrics per sample
- `timestamp`, `battery_percent`, `is_charging`, `cpu_total`, `cpu_user`, `cpu_system`, `memory_total`, `load_avg`, `swap_used_mb`, `cpu_temp`, `disk_read_io`, `disk_write_io`, `net_rx_bytes`, `net_tx_bytes`

**process_samples** — per-process metrics per sample
- `snapshot_id`, `pid`, `name`, `cpu_percent`, `cpu_user_percent`, `cpu_system_percent`, `memory_percent`, `rss_mb`, `nice`, `state`, `cmdline`

**drain_events** — detected rapid drain incidents
- `id`, `start_time`, `end_time`, `start_percent`, `end_percent`, `drain_rate`, `duration_minutes`, `top_processes_json`

**process_spikes** — resource usage spikes
- `id`, `timestamp`, `process_name`, `pid`, `metric_type` (cpu/memory), `value`, `baseline`, `threshold`, `snapshot_id`

**battery_impact** — accumulated per-process impact scores
- `process_name`, `total_impact_score`, `drain_time_minutes`, `samples_during_drain`, `avg_cpu_during_drain`, `last_seen_timestamp`, `first_seen_timestamp`

**battery_impact_events** — individual drain period details
- `id`, `start_time`, `end_time`, `duration_minutes`, `battery_drop_percent`, `process_impacts_json`

## Configuration

Edit `src/main.ts` or pass a config object to `Monitor`:

```typescript
const monitor = new Monitor({
  sampleIntervalSeconds: 30,
  dbPath: '~/.procmon/monitor.db',
  retentionDays: 30,
  drain: {
    drainThreshold: 1.0,    // % per minute
    minDuration: 2,         // minutes
    cooldownMinutes: 10,    // between alerts
  },
  spike: {
    cpuThreshold: 50,       // absolute %
    memoryThreshold: 20,    // absolute %
    multiplier: 3,          // relative to baseline
    baselineSamples: 5,       // samples to establish baseline
    cooldownSeconds: 60,     // per-process cooldown
  },
  batteryImpact: {
    minBatteryDrop: 2,      // % to trigger drain period
    minDuration: 2,         // minutes
  },
});
```

## Project Roadmap

| Task | Status | Description |
|------|--------|-------------|
| T1 | ✅ | TypeScript rewrite with core monitoring |
| T2 | ⬜ | Telegram/OpenClaw alert integration |
| T3 | ✅ | Per-process history query interface (CLI + API) |
| T4 | ✅ | Web dashboard for live monitoring (7-file modular frontend) |
| T5 | ⬜ | Swift menubar app (future) |
| T6 | ✅ | Process resource usage spike detection |
| T7 | ✅ | Battery impact correlation analysis |

## Tech Stack

- **TypeScript 5.x** — Type-safe Node.js with ESM modules
- **systeminformation** — Cross-platform system stats
- **better-sqlite3** — Fast synchronous SQLite with WAL mode
- **tsx** — TypeScript execution without compilation
- **Chart.js** — Dashboard charts (via CDN, no npm dependency)
- **Native Node.js http** — Dashboard server (no Express)

## License

MIT

## Screenshots

> **Note:** Screenshots should be captured and placed in `docs/screenshots/`:
> - `dashboard-overview.png` — Full dashboard view showing side-by-side layout
> - `process-modal.png` — Process detail modal with history chart
> - `spike-panel.png` — Spike alert panel with color-coded cards
> - `battery-impact.png` — Battery impact ranking bars
> - `profiles.png` — Monitoring profiles section
> - `mobile-responsive.png` — Dashboard on narrow viewport (stacked layout)
