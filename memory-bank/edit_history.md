# Edit History

*Last Updated: 2026-06-10 01:15 IST*

---

## 2026-06-10

#### 01:15 IST - T6 + T7 + T4: Spike Detection, Battery Impact, Dashboard Rebuild

**T6: Process Spike Detection**
- Created `src/core/SpikeDetector.ts` - Per-process baseline tracking, dual-threshold detection, cooldown logic
- Modified `src/types/index.ts` - Added `SpikeThresholds`, `ProcessSpike`, `SpikeConfig` interfaces
- Modified `src/storage/TimeSeriesDB.ts` - Added `process_spikes` table with `insertProcessSpike()`, `getRecentSpikes()`, `getSpikeStats()`
- Modified `src/core/Monitor.ts` - Integrated `SpikeDetector` into tick loop with default config (CPU 50%, memory 20%, 3x multiplier, 60s cooldown)
- Modified `src/query.ts` - Added `--spikes` query option with stats and timeline views

**T7: Battery Impact Correlation**
- Created `src/core/BatteryImpactAnalyzer.ts` - Drain period detection, per-process impact scoring, accumulation logic
- Modified `src/types/index.ts` - Added `BatteryImpactEntry`, `BatteryImpactEvent`, `ProcessImpact`, `BatteryImpactConfig` interfaces
- Modified `src/storage/TimeSeriesDB.ts` - Added `battery_impact` and `battery_impact_events` tables with ranking queries
- Modified `src/core/Monitor.ts` - Integrated `BatteryImpactAnalyzer` into tick loop (min 2% drop, 2+ min duration)
- Modified `src/query.ts` - Added `--battery` and `--battery-events` query options

**T4: Web Dashboard Rebuild**
- Identified regression: advanced dashboard features (sortable columns, side-by-side layout, profiles, modal) were overwritten by minimal version in commit cb86bdb (Jun 8)
- Rebuilt 7-file modular frontend:
  - `dashboard/public/index.html` - Side-by-side layout, responsive, process modal, profile modal
  - `dashboard/public/style.css` - Dark theme, cards, spike cards, battery bars, profile cards, responsive breakpoints
  - `dashboard/public/utils.js` - Formatting helpers, sort utilities, DOM helpers, API wrappers (GET/POST/PUT/DELETE)
  - `dashboard/public/charts.js` - Chart.js initialization, 5 chart instances (CPU, battery, extras, IO, process history)
  - `dashboard/public/tables.js` - Sortable table rendering, process detail modal, spike panel, battery impact panel, drain table
  - `dashboard/public/profiles.js` - Profile CRUD UI, color picker, form modal
  - `dashboard/public/app.js` - Orchestration: data fetch loop, refresh every 5s, event wiring
- Modified `src/dashboard/server.ts` - Added 8 new API endpoints: `/api/spikes`, `/api/spike-stats`, `/api/battery-impact`, `/api/battery-events`, `/api/process-history`, `/api/process-stats`, `/api/top-processes`, `/api/profiles` (CRUD)
- Added `dbSizeBytes` to `/api/stats` endpoint via `fs.statSync()` on DB file
- Fixed process modal `[object Object]` bug: click handler passed object instead of `p.name`

**Memory Bank Updates**
- Updated `tasks.md` - Marked T3, T4, T6, T7 as completed
- Updated `tasks/T4.md` - Complete dashboard rebuild documentation with 7-file architecture and API endpoints
- Updated `tasks/T3.md` - Per-process query interface with CLI and API documentation
- Updated `tasks/T6.md` - Spike detection with baseline tracking and dual thresholds
- Updated `tasks/T7.md` - Battery impact with drain detection and scoring
- Updated `activeContext.md` - Current status with all completed tasks
- Updated `progress.md` - Full project status with timeline
- Updated `session_cache.md` - Session completion notes
- Updated `techContext.md` - 6-table DB schema, WAL mode
- Updated `systemPatterns.md` - Architecture diagram including SpikeDetector, BatteryImpactAnalyzer, Query Tool, DashboardServer
- Updated `edit_history.md` - This edit chunk

**GitHub**
- Repo made public: https://github.com/space-cadet/mac-process-monitor

---

## 2026-05-25

#### 10:34:39 IST - T4: Web Dashboard for Live Monitoring - mobile responsive, clickable column sorting, SVG line graph
- Modified `web/public/app.js` - Clickable column headers for sorting, sort direction toggle, SVG line chart for battery history
- Modified `web/public/styles.css` - Mobile-responsive process table, horizontal scroll, chart styling
- Modified `web/public/index.html` - Removed separate sort buttons, added table wrapper for horizontal scroll
- Modified `src/web/server.ts` - Dashboard server with API endpoints
- Created `com.deepak.mac-process-monitor.dashboard.plist` - launchd service for persistent background running

#### 01:37:33 IST - T4: DB-native memory bank setup + verified dashboard/monitor running
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API
- Created `memory-bank/database/lib/inserts.js` - DB insert operations
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper
- Created `memory-bank/database/schema.sql` - Phase A schema

#### 01:18:08 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:17:57 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:17:43 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:17:36 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:17:29 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:17:22 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:17:15 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:17:05 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:16:53 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:16:41 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:16:34 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:16:24 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:16:16 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:16:08 IST - T4: DB-native memory bank setup — initialized schema, imported existing data, ran workflow
- Created `memory-bank/database/memory_bank.db` - SQLite DB with Phase A schema
- Created `memory-bank/database/init-db.js` - Database initialization script
- Created `memory-bank/database/import-existing-data.js` - Import script for existing markdown data
- Created `memory-bank/database/lib/workflow.js` - recordSessionWork() API — from mb-core
- Created `memory-bank/database/lib/inserts.js` - DB insert operations — from mb-core
- Created `memory-bank/database/lib/regenerate.js` - Markdown regeneration — from mb-core
- Created `memory-bank/database/lib/sqlite.js` - sql.js wrapper — from mb-core
- Created `memory-bank/database/schema.sql` - Phase A schema — from mb-core

#### 01:15:58 IST - T4: Dashboard chart axes and implementation docs
- Modified `web/public/index.html` - Added chart axes HTML structure
- Modified `web/public/styles.css` - Chart Y-axis % labels, X-axis time labels, gridlines
- Modified `web/public/app.js` - renderChart populates X-axis with time labels
- Created `memory-bank/implementation-details/architecture.md` - System architecture documentation
- Created `memory-bank/implementation-details/web-dashboard.md` - Dashboard implementation docs

#### 01:15:51 IST - T4: Dashboard chart axes and implementation docs
- Modified `web/public/index.html` - Added chart axes HTML structure
- Modified `web/public/styles.css` - Chart Y-axis % labels, X-axis time labels, gridlines
- Modified `web/public/app.js` - renderChart populates X-axis with time labels
- Created `memory-bank/implementation-details/architecture.md` - System architecture documentation
- Created `memory-bank/implementation-details/web-dashboard.md` - Dashboard implementation docs

