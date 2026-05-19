# Memory Bank — Mac Process Monitor

*Created: 2026-05-18 18:37 IST*
*Last Updated: 2026-05-19 15:20 IST*

## Overview

A cross-platform system monitor that tracks battery level, CPU, memory, disk I/O, network activity, and per-process resource usage. Stores time-series data in SQLite and detects rapid battery drain correlated with CPU-intensive processes. Built in TypeScript with `systeminformation` + `better-sqlite3`.

Originally planned as a macOS-only Python tool; rewritten in TypeScript during T1 when cross-platform potential became clear. Expanded monitoring added 15+ new metrics on 2026-05-19. Web dashboard built on 2026-05-19.

## Active Tasks

| ID | Title | Status | Priority | Started | Dependencies | Details |
|----|-------|--------|----------|---------|--------------|---------|
| T2 | Telegram/OpenClaw Alert Integration | ⬜ | HIGH | 2026-05-18 | T1 | [Details](tasks/T2.md) |
| T3 | Per-Process History Query Interface | ⬜ | MEDIUM | 2026-05-18 | T1 | [Details](tasks/T3.md) |
| T5 | Swift Menubar App (Future) | ⬜ | LOW | 2026-05-18 | T1-T4 | [Details](tasks/T5.md) |

## Completed Tasks

| ID | Title | Status | Priority | Started | Completed | Dependencies | Details |
|----|-------|--------|----------|---------|-----------|--------------|---------|
| T1 | TypeScript Rewrite — Core Monitor | ✅ | HIGH | 2026-05-18 | 2026-05-19 | - | [Details](tasks/T1.md) |
| T4 | Web Dashboard for Live Monitoring | ✅ | MEDIUM | 2026-05-19 | 2026-05-19 | T1 | [Details](tasks/T4.md) |

## Status Summary

- **Active**: 0
- **Completed**: 2
- **Paused**: 0
- **Total**: 5
