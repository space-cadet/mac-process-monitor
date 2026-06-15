# Technical Context: mac-process-monitor

## Technology Stack

### Core Language and Runtime
- **TypeScript 5.x**: Type-safe Node.js with ESM modules
- **tsx**: TypeScript execution without pre-compilation
- **Node.js 18+**: LTS runtime for async/await and ESM

### System Interaction
- **systeminformation**: Cross-platform system stats (battery, processes, CPU, memory)
- **better-sqlite3**: Fast synchronous SQLite for time-series storage
- **Node.js built-ins**: `process` for signals, `path`/`fs` for DB path resolution

### Storage
- **SQLite**: Time-series DB with six tables — `snapshots`, `process_samples`, `drain_events`, `process_spikes`, `battery_impact`, `battery_impact_events`
- **better-sqlite3**: Chosen for synchronous, simple API (no async transaction overhead)
- **WAL mode**: Enabled for concurrent reads (dashboard queries while monitor writes)

### Configuration
- **Inline TypeScript config**: `MonitorConfig` interface passed to `Monitor` constructor
- **Default values** in `Monitor.ts` and `main.ts` entry point
- **Future**: JSON config file, CLI flags via `minimist` or `commander`

### Testing
- **tsx direct execution**: Test scripts are runnable TypeScript files (`test-basic.ts`, `test-collector.ts`, `test-analyzer.ts`)
- **No formal test framework yet** — validated via live systeminformation calls + fake data injection

### Alerting
- **Planned**: OpenClaw message tool integration (T2)
- **Planned**: Telegram bot via `node-telegram-bot-api` (fallback)

## Development Environment

### Required Tools
- Node.js 18+ with npm/pnpm
- TypeScript compiler (`tsc` for build, `tsx` for dev)
- macOS for battery/process APIs (systeminformation supports Linux/Windows too)

### Development Setup
```bash
pnpm install
npx tsx src/main.ts        # Run monitor
npx tsx src/show-data.ts   # Show current system data
npx tsx src/test-basic.ts  # Validate battery/process collection
```

## Technical Constraints

### System Compatibility
- **Primary target**: macOS 12+ (Monterey and newer)
- **Cross-platform**: systeminformation works on Linux/Windows, but battery % accuracy varies
- **Node.js**: Requires 18+ for modern ESM and top-level await

### Performance Requirements
- Sampling overhead: <1% CPU at 30s intervals
- DB writes: batched per sample (1 snapshot + up to 50 process rows)
- Memory footprint: analyzer keeps only last ~11 samples (5-min window at 30s)
- SQLite: WAL mode recommended for concurrent reads (dashboard T4)

### Permission Requirements
- User-level permissions sufficient for process listing (systeminformation)
- No elevated permissions needed for battery/process monitoring

## Dependencies

### Core Dependencies
- `systeminformation@^5.25.0` — Battery, processes, CPU, memory stats
- `better-sqlite3@^12.0.0` — SQLite time-series storage

### Dev Dependencies
- `typescript@^5.7.0` — Type checking
- `tsx@^4.19.0` — TypeScript execution
- `@types/node@^22.0.0` — Node.js type definitions

### Future Dependencies (T2-T4)
- `express` or native `http` module — Dashboard server (T4)
- `node-telegram-bot-api` or OpenClaw message tool — Alerts (T2)
- `chart.js` or lightweight canvas library — Dashboard charts (T4)

## Deployment Strategy

### Installation Methods
- Clone + `pnpm install` (current)
- `npm install -g` or local `npx` execution (future)
- Homebrew formula (future, after Swift menubar T5)

### Packaging
- `tsc` builds to `dist/` for distribution
- `tsx` for development and testing

## File Structure
```
mac-process-monitor/
├── src/
│   ├── types/
│   │   └── index.ts              # All TypeScript interfaces
│   ├── core/
│   │   ├── SystemCollector.ts    # Battery + process sampling
│   │   ├── DrainAnalyzer.ts      # Sliding window drain detection
│   │   └── Monitor.ts            # Orchestrator loop
│   ├── storage/
│   │   └── TimeSeriesDB.ts       # SQLite time-series storage
│   ├── main.ts                   # Entry point
│   ├── show-data.ts              # Live data display
│   ├── test-basic.ts             # Battery/process validation
│   ├── test-collector.ts         # Collector + DB integration
│   └── test-analyzer.ts          # Drain detection with fake data
├── memory-bank/                  # Project documentation
├── package.json
├── tsconfig.json
└── README.md
```

## ESM Import Conventions
- Source files use `.js` extensions in import paths (`import { Monitor } from './core/Monitor.js'`)
- This is required for Node.js ESM resolution; `tsx` handles the translation at runtime
- `tsc` compiles `.ts` → `.js`, so paths remain valid in `dist/`

## Database Schema

### snapshots
- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `timestamp INTEGER NOT NULL`
- `battery_percent REAL NOT NULL`
- `is_charging INTEGER NOT NULL`
- `cpu_total REAL`, `memory_total REAL`

### process_samples
- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `snapshot_id INTEGER NOT NULL` (FK → snapshots.id)
- `pid INTEGER NOT NULL`, `name TEXT NOT NULL`
- `cpu_percent REAL NOT NULL`, `memory_percent REAL NOT NULL`
- `rss_mb REAL NOT NULL`, `cmdline TEXT`

### drain_events
- `id TEXT PRIMARY KEY`
- `start_time`, `end_time INTEGER NOT NULL`
- `start_percent`, `end_percent`, `drain_rate`, `duration_minutes REAL NOT NULL`
- `was_charging INTEGER NOT NULL`, `top_processes_json TEXT NOT NULL`

## Drain Detection Algorithm
1. **Sample** battery + top-50 processes every `sampleIntervalSeconds` (default: 30s)
2. **Store** in SQLite (`snapshots` + `process_samples`)
3. **Analyze** sliding `windowMinutes` window (default: 5 min, ~11 samples)
4. **Trigger** if: not charging, drop rate > `drainThreshold` (default: 1%/min), sustained for `minDuration` (default: 2 min), and cooldown expired (default: 10 min)
5. **Correlate** — average CPU per PID across all samples in window, return top 5
6. **Store event** in `drain_events` + alert (T2)

## Known Quirks
- **memRss**: `systeminformation` returns KB, not bytes. `rssMB = memRss / 1024`.
- **currentLoad**: May return `undefined` on some systems. Fallback chain: `currentload` → `avgload` → `0`.
- **timeRemaining**: Negative values indicate "calculating" — mapped to `null`.
- **temperature**: Negative values indicate unavailable — mapped to `null`.

## Additional Notes

### Python Legacy
The project was originally planned in Python (psutil, PyYAML, Flask). T1 replaced this with TypeScript for:
- Single-language stack (TypeScript for both monitor and web dashboard T4)
- ESM module system
- Better type safety for time-series data contracts
- `systeminformation` provides richer battery data than `psutil`

### Language Migration Considerations
- Core data structures (`SystemSnapshot`, `DrainEvent`, `ProcessSnapshot`) are simple interfaces — easy to port to Swift (T5)
- SQLite DB format is language-agnostic — Swift version can read the same DB
- Algorithm logic (sliding window, process aggregation) is self-contained in `DrainAnalyzer.ts`

### Interface Implementation Strategy
- CLI test scripts first (current: `show-data.ts`, `test-*.ts`)
- OpenClaw/Telegram alerts next (T2)
- Per-process query CLI (T3)
- Web dashboard with Express + Chart.js (T4)
- Swift menubar app as final native integration (T5)