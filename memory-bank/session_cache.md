# Session: 2026-06-13 02:34 IST

## Session Summary
- **User**: Deepak (D V)
- **Topic**: mac-process-monitor LaunchDaemon installation
- **Outcome**: Task T8 created — pending manual sudo execution

## What Was Done
1. Checked current battery level (75% — good, fixed crash loop)
2. Verified mac-process-monitor and web dashboard were not auto-running
3. Created LaunchDaemon plist files for both monitor and dashboard
4. Attempted to install as LaunchDaemons but blocked by sudo privileges
5. Cleaned up broken LaunchAgent files from `~/Library/LaunchAgents/`
6. Created **T8: LaunchDaemon Installation for Auto-Start** task file
7. Updated `memory-bank/tasks.md` with T8

## Pending Task T8 — LaunchDaemon Installation

**Status**: ⬜ PENDING (needs manual sudo from `deepak` user)

**Files ready**:
- `~/.openclaw/workspace/code/mac-process-monitor/ai.openclaw.procmon.monitor.plist`
- `~/.openclaw/workspace/code/mac-process-monitor/ai.openclaw.procmon.dashboard.plist`

**Commands to run** (as `deepak` with sudo password):
```bash
sudo mv ~/.openclaw/workspace/code/mac-process-monitor/ai.openclaw.procmon.monitor.plist /Library/LaunchDaemons/
sudo mv ~/.openclaw/workspace/code/mac-process-monitor/ai.openclaw.procmon.dashboard.plist /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/ai.openclaw.procmon.*
sudo chmod 644 /Library/LaunchDaemons/ai.openclaw.procmon.*
sudo launchctl bootstrap system /Library/LaunchDaemons/ai.openclaw.procmon.monitor.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/ai.openclaw.procmon.dashboard.plist
```

**Why blocked**: `sage` can `sudo -u deepak` (NOPASSWD) but cannot `sudo` to root. `/Library/LaunchDaemons/` requires root. `deepak` needs to run the commands with his password.

## Notes
- Dashboard will be at `http://192.168.1.221:3456` (local IP)
- Follows same pattern as `ai.openclaw.gateway.sage` (which works)
- Both plists validated with `plutil -lint` — OK
- User will run the commands later when at the Mac
