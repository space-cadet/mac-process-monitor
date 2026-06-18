# Memory Bank - mac-process-monitor Tasks

*Created: 2026-05-25*
*Last Updated: 2026-06-19*

## Overview

Task tracking for the mac-process-monitor project. Tasks are ordered by priority (HIGH → LOW).

## Task Legend
- ✅ Complete
- 🔄 In Progress
- ⬜ Pending

---

## Completed Tasks

| ID | Title | Completed | Details |
|----|-------|-----------|---------|
| T1 | TypeScript Rewrite — Core Monitor | 2026-05-18 | [Details](tasks/T1.md) |
| T3 | Per-Process History Query Interface | 2026-06-10 | [Details](tasks/T3.md) |
| T4 | Web Dashboard for Live Monitoring | 2026-06-10 | Extended 2026-06-19 with Analysis + Settings tabs, 6 preset SQL queries, export features | [Details](tasks/T4.md) |
| T6 | Process Spike Detection | 2026-06-09 | [Details](tasks/T6.md) |
| T7 | Battery Impact Correlation | 2026-06-09 | [Details](tasks/T7.md) |
| T8 | LaunchDaemon Installation for Auto-Start | 2026-06-15 | [Details](tasks/T8.md) |
| T2 | Telegram/OpenClaw Alert Integration | 2026-06-18 | [Details](tasks/T2.md) |

---

## Pending Tasks (Prioritized)

### 🔥 HIGH Priority

| ID | Title | Why | Est. Effort | Dependencies |
|----|-------|-----|-------------|--------------|
| T9 | Sleep/Wake Correlation Tracking | Catch drain during sleep — biggest blind spot | 2-3h | None |
| T10 | "What Drained My Battery?" Automated Report | Synthesize raw data into actionable insights | 3-4h | T7 |

### ⚡ MEDIUM Priority

| ID | Title | Why | Est. Effort | Dependencies |
|----|-------|-----|-------------|--------------|
| T16 | Native macOS Notifications (UNUserNotificationCenter) | Better than osascript: actions, grouping, richer UI | 2h | T2 (done) |
| T13 | Process Tree View (Hierarchical) | Flat lists are misleading — show parent/child | 2-3h | None |
| T11 | Natural Language Search / Query Box | "Show me Chrome yesterday >30% CPU" | 4-5h | None |
| T12 | Data Export (CSV / Parquet / Grafana) | Free data from SQLite lock-in | 2-3h | None |
| T15 | macOS Energy API Integration | Real energy impact, not just CPU% | 3-5h | None |

### 🔮 LOW Priority / Future

| ID | Title | Why | Est. Effort | Dependencies |
|----|-------|-----|-------------|--------------|
| T14 | Anomaly Detection with ML | Statistical outliers beyond simple thresholds | 6-8h | T6 |
| T5 | Swift Menubar App | Native macOS experience | 8-12h | None |

---

## Task Relationships

```
T1: Core Monitor (done)
├── T2: Alerts (done) ──┬── T9: Sleep/Wake (next)
│                       ├── T10: Reports (next)
│                       └── T16: Native Notifications
├── T3: Query Interface ──┬── T11: NL Search
│                         └── T12: Export
├── T4: Dashboard ──┬── T13: Process Tree
│                   └── T15: Energy API
├── T6: Spike Detection ──→ T14: Anomaly Detection
├── T7: Battery Impact ──→ T10: Reports
└── T8: LaunchDaemon (done)
```

## Recommended Implementation Order

1. **T9** — Sleep/Wake tracking (high insight, medium effort)
2. **T10** — Daily battery report (builds on all existing data)
3. **T16** — Native notifications (quick win, replaces osascript)
4. **T13** — Process tree view (UI improvement, users will love it)
5. **T11** — Natural language search (power user feature)
6. **T12** — Export functionality (data liberation)
7. **T15** — Energy API (macOS-specific, requires investigation)
8. **T14** — Anomaly detection (advanced, after baseline data accumulates)
9. **T5** — Swift menubar app (big project, nice-to-have)

## Status Summary

- **Completed**: 7 (T1, T2, T3, T4, T6, T7, T8)
- **Pending**: 8 (T5, T9, T10, T11, T12, T13, T14, T15, T16)
- **Total**: 15

---

*Note: T16 was not originally planned — emerged from T2 implementation as an enhancement opportunity (replace osascript with UNUserNotificationCenter).*
