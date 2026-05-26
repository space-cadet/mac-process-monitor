---
kind: edit_chunk
id: mac-process-monitor-2026-05-26-T4-dashboard-enhancements
created_at: 2026-05-26 13:19 IST
task_ids: [T4]
source_branch: main
source_commit: -
---

#### 13:19 IST - T4: Unified monitor+dashboard, chart tabs, badges, profile filtering
- Created `src/combined.ts` - Unified monitor + dashboard in single process
- Modified `src/web/server.ts` - Added `/api/db-size` and `/api/server-info` endpoints
- Modified `src/core/SystemCollector.ts` - Fixed battery property casing (camelCase)
- Modified `web/public/app.js` - Chart tabs (Battery/CPU/Memory), DB size badge, uptime badge, profile filtering, SVG line chart
- Modified `web/public/index.html` - Header badges, chart tabs, SVG chart structure
- Modified `web/public/styles.css` - Badge styles, chart tab styles, SVG chart styles
- Modified `.gitignore` - Added `.playwright-mcp/`
- Modified `memory-bank/database/import-existing-data.js` - Fixed paths for memory-bank subdir
- Deleted `dashboard-screenshot.png` - Moved to `.playwright-mcp/`
