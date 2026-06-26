# Cross-Platform Implementation (T19)

*Created: 2026-06-24*
*Last Updated: 2026-06-26*
*Status: ✅ Complete*
*Task: T19*

## Overview

The process-monitor was originally built for macOS. This document covers the implementation of cross-platform support, allowing the monitor to run on Linux, Windows, and other platforms with graceful degradation for platform-specific features.

## Platform Detection Strategy

### Runtime Detection
The app uses `process.platform` (Node.js builtin) to branch at runtime:

```typescript
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const isWindows = process.platform === 'win32';
```

This is checked once at startup and cached. No compile-time flags or conditional imports are used — all platform branches are loaded but only the relevant one executes.

## Platform-Specific Implementations

### SleepWakeDetector (src/core/SleepWakeDetector.ts)

**macOS (darwin):**
- Sleep/wake detection via `ioreg -n IORootParent` (parsing `IOPowerManagement.CurrentPowerState`)
- Battery data via `pmset -g batt` (parsing voltage/percent/remaining)
- Full power event detection and logging

**Linux:**
- Battery from `/sys/class/power_supply/BAT*/capacity` and `status`
- Sleep detection: returns `"awake"` (servers don't sleep, and the monitor's tick-gap detection handles missed intervals)
- Three fallback paths tried: `BAT0`, `BAT1`, `battery`

**Windows/Other:**
- No-op: returns `state: "awake"`, `battery: 0`, `isPlugged: true`
- Logs a warning on startup: `Note: Sleep/wake detection is limited on <platform>.`

**Key Design Decision:** Rather than trying to detect sleep on every platform, the monitor's existing tick-gap detection ("no sample for 2+ minutes") already handles sleep on all platforms. Platform-specific sleep detection is an enhancement, not a requirement.

### AlertSender (src/core/AlertSender.ts)

**macOS:**
- Primary: `osascript -e 'display notification...'` for native macOS notifications
- Fallback: Telegram bot if configured
- Fallback: OpenClaw message tool

**Linux/Windows:**
- Primary: Telegram bot if configured
- Fallback: OpenClaw message tool
- Fallback: console.log

**Key Design Decision:** macOS gets native notifications because `osascript` is a built-in system tool. Linux/Windows use Telegram as the primary channel since there's no universal native notification API that works across all Linux distributions without extra dependencies.

### EnergyCollector (src/core/EnergyCollector.ts)

**macOS:**
- Runs `powermetrics` via `sudo` for per-process energy in millijoules
- Requires `sudo` to be useful; without it, energy field is `null`
- Stores `energy_mj` in `process_samples` table

**Linux/Windows/Other:**
- Not implemented. The `energy_mj` column in `process_samples` is always `null`.
- `systeminformation` has no per-process energy API on Linux.
- **Future:** Could potentially use `RAPL` (Running Average Power Limit) on Intel CPUs for system-wide energy, but not per-process.

**Key Design Decision:** Energy is a "nice to have" feature, not core monitoring. The dashboard gracefully handles `null` energy fields (hides the column if no data exists).

### ConfigManager (src/config/ConfigManager.ts)

**Platform-specific `ignoredProcesses`:**

```typescript
// macOS kernel + system processes
'kernel_task', 'WindowServer', 'mds', 'mdworker',

// Linux kernel threads
'kworker', 'ksoftirqd', 'rcu_preempt', 'migration',
'watchdogd', 'cpuhp', 'khugepaged', 'kcompactd0', 'oom_reaper'
```

**Why:** These processes spike in CPU regularly as part of normal OS operation. Without filtering them out, the spike detector would fire constantly on kernel threads doing their job. The filter is applied BEFORE spike detection and BEFORE process tree display.

### Dashboard Restart Endpoint (src/web/server.ts)

**Before (hardcoded):**
```typescript
cd /Users/sage/.openclaw/workspace/code/process-monitor && bash run.sh
env: { HOME: '/Users/sage' }
```

**After (dynamic):**
```typescript
cd "${process.cwd()}" && nohup npx tsx src/main.ts ...
env: { HOME: process.env.HOME || '/tmp' }
```

**Why:** The old path was hardcoded to Sage's Mac. This prevented the restart feature from working on the VPS (and would have failed for any other user/machine).

### Disk Usage (SystemCollector.ts)

**macOS Catalina+ (APFS split volumes):**
- **Before:** Code picked `/` as the primary mount, which is the small read-only **system volume** (~20% usage on a typical MacBook)
- **Problem:** User data lives on `/System/Volumes/Data`, not `/`. The old code showed the system volume usage, not the actual disk usage.
- **After:** On macOS, prefer `/System/Volumes/Data`, fall back to `/`, then to `fsSize[0]`:

```typescript
const primaryMount = process.platform === 'darwin'
  ? (fsSize.find(f => f.mount === '/System/Volumes/Data') 
      || fsSize.find(f => f.mount === '/') 
      || fsSize[0])
  : (fsSize.find(f => f.mount === '/' || f.mount === 'C:\\') || fsSize[0]);
```

**Why this happens:** macOS 10.15+ uses APFS with separate volumes — a read-only system volume (`/`) and a writable data volume (`/System/Volumes/Data`). The `df` command reports both, and the old code naively picked `/`.

**Linux/Windows/Other:**
- Linux: picks `/` (single root filesystem, no split volume issue)
- Windows: picks `C:\` or first drive
- No change needed — these platforms don't have the APFS split volume problem.

### Battery UI (web/public/app.js)
- Shows `— N/A` for percentage
- Shows `No battery` for status
- Shows `Desktop / Server` in identity panel

**Laptop (with battery):**
- Shows actual percentage
- Shows `Charging` / `Discharging` / `Full`
- Shows device name

**Detection logic:**
```javascript
const hasBattery = battery.percent > 0 || (!battery.isPlugged && battery.percent === 0);
// isPlugged: true + percent: 0 = desktop/server (no battery)
// isPlugged: false + percent: 0 = battery exists but at 0%
// percent > 0 = battery exists with charge
```

## Platform Support Matrix

| Feature | macOS | Linux | Windows | Other |
|---------|-------|-------|---------|-------|
| Core monitoring | ✅ | ✅ | ✅ | ✅ |
| Process spikes | ✅ | ✅ | ✅ | ✅ |
| Battery drain | ✅ | ✅* | ✅* | ✅* |
| Battery impact | ✅ | ✅* | ✅* | ✅* |
| Sleep/wake | ✅ | Limited | No-op | No-op |
| Energy (mJ) | ✅ (sudo) | ❌ | ❌ | ❌ |
| Native notifications | ✅ | ❌ | ❌ | ❌ |
| Telegram alerts | ✅ | ✅ | ✅ | ✅ |

*Battery features work on Linux/Windows only if the system has a battery and `systeminformation` can read it.

## Files Modified for Cross-Platform Support

| File | Change |
|------|--------|
| `src/core/SleepWakeDetector.ts` | Rewritten with `process.platform` branching |
| `src/core/AlertSender.ts` | Already had platform checks (no changes needed) |
| `src/core/EnergyCollector.ts` | Already macOS-only (no changes needed) |
| `src/config/ConfigManager.ts` | Added Linux kernel threads to `ignoredProcesses` |
| `src/web/server.ts` | Fixed `/api/restart` hardcoded path |
| `src/core/SystemCollector.ts` | Fixed disk usage: prefer `/System/Volumes/Data` on macOS |
| `web/public/app.js` | Added no-battery detection for battery UI |

## Testing Performed

- ✅ Monitor starts on Linux VPS without `pmset`/`ioreg` errors
- ✅ Battery UI shows `N/A` on server (no battery)
- ✅ Restart endpoint works on Linux VPS
- ✅ Spike detection does not fire on `kworker` threads
- ✅ Dashboard accessible at `http://localhost:3456` on Linux
- ✅ DB growing correctly (83+ snapshots after 40+ minutes)
- ✅ All API endpoints responding on Linux

## Known Limitations

1. **Linux sleep detection:** Always returns "awake". Servers rarely sleep, but laptops would miss sleep events. However, the tick-gap detection ("no data for 2+ minutes") catches this on all platforms.

2. **Linux energy:** No per-process energy data available. `systeminformation` doesn't expose it, and there's no standard API like `powermetrics` on Linux.

3. **Windows sleep/wake:** Not implemented. Would require Windows-specific APIs (e.g., Power Management API or WMI).

4. **Windows battery:** Would need `wmic` or Win32 API calls. Not implemented but could be added to `SleepWakeDetector.ts`.

5. **Native notifications:** Only macOS has built-in support without extra dependencies. Linux would need `notify-send` (Desktop Notifications spec) or D-Bus. Windows would need `node-notifier` or PowerShell.

## Future Improvements

- **Linux notifications:** Use `notify-send` if available (most desktop Linux distributions have it)
- **Windows sleep/wake:** Implement using WMI or Power Management API
- **Windows battery:** Implement using `wmic path Win32_Battery`
- **Linux energy:** Explore `RAPL` for system-wide power consumption (not per-process)

## Commit

- `1561ca2` — SleepWakeDetector cross-platform rewrite
- `18a7024` — ConfigManager, restart endpoint, battery UI fixes
- `2127ae6` — Fix disk usage on macOS Catalina+: prefer `/System/Volumes/Data` over `/`
