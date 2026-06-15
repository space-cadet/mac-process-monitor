/**
 * CLI query tool for per-process resource history.
 * Usage: npx tsx src/query.ts --process <name> --since <duration> [options]
 */

import { TimeSeriesDB } from './storage/TimeSeriesDB.js';

interface QueryOptions {
  process?: string;
  since: number; // minutes
  stats: boolean;
  top?: string; // 'cpu' | 'mem'
  limit: number;
  csv: boolean;
  drainEvent?: string;
  spikes?: boolean;
  battery?: boolean;
}

function parseArgs(): QueryOptions {
  const args = process.argv.slice(2);
  const opts: QueryOptions = { since: 30, stats: false, limit: 10, csv: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--process':
      case '-p':
        opts.process = args[++i];
        break;
      case '--since':
      case '-s':
        opts.since = parseDuration(args[++i]);
        break;
      case '--stats':
        opts.stats = true;
        break;
      case '--top':
        opts.top = args[++i];
        break;
      case '--limit':
      case '-n':
        opts.limit = parseInt(args[++i], 10);
        break;
      case '--csv':
        opts.csv = true;
        break;
      case '--spikes':
        opts.spikes = true;
        break;
      case '--battery':
        opts.battery = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return opts;
}

function parseDuration(input: string): number {
  const match = input.match(/^(\d+)([mhd])?$/);
  if (!match) throw new Error(`Invalid duration: ${input}. Use e.g. 5m, 2h, 1d`);
  const num = parseInt(match[1], 10);
  const unit = match[2] || 'm';
  switch (unit) {
    case 'm': return num;
    case 'h': return num * 60;
    case 'd': return num * 1440;
    default: return num;
  }
}

function printHelp(): void {
  console.log(`
Process History Query Tool

Usage: npx tsx src/query.ts [options]

Options:
  -p, --process <name>    Process name (fuzzy match)
  -s, --since <duration>  Time window: 5m, 10m, 30m, 1h, 6h, 24h (default: 30m)
      --stats             Show aggregated statistics instead of timeline
      --top <metric>      Show top processes by cpu or mem
  -n, --limit <n>         Limit results (default: 10)
      --csv               Output CSV format
      --drain-event <id>  Show processes during a specific drain event
      --spikes            Show recent process spikes
      --battery           Show battery impact rankings
  -h, --help              Show this help

Examples:
  npx tsx src/query.ts --process Chrome --since 10m
  npx tsx src/query.ts --process node --since 2h --stats
  npx tsx src/query.ts --top cpu --limit 5 --since 5m
  npx tsx src/query.ts --spikes --since 1h
  npx tsx src/query.ts --battery --limit 10
  npx tsx src/query.ts --process Chrome --since 1h --csv > chrome.csv
`);
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toTimeString().slice(0, 8);
}

function sparkline(values: number[], max: number, width: number = 10): string {
  if (values.length === 0) return '';
  const blocks = ['░', '▒', '▓', '█'];
  const step = Math.max(max / (blocks.length - 1), 0.001);
  return values.slice(-width).map(v => {
    const idx = Math.min(Math.floor(v / step), blocks.length - 1);
    return blocks[idx];
  }).join('');
}

function trendArrow(values: number[]): string {
  if (values.length < 4) return '→';
  const recent = values.slice(-2).reduce((a, b) => a + b, 0) / 2;
  const previous = values.slice(-4, -2).reduce((a, b) => a + b, 0) / 2;
  const diff = recent - previous;
  if (diff > values[values.length - 1] * 0.1) return '↑';
  if (diff < -values[values.length - 1] * 0.1) return '↓';
  return '→';
}

function printTimeline(rows: any[], processName: string): void {
  if (rows.length === 0) {
    console.log(`No data found for "${processName}" in the specified time window.`);
    return;
  }

  console.log(`\nProcess: ${processName} | Samples: ${rows.length} | Window: ${formatTime(rows[0].timestamp)} – ${formatTime(rows[rows.length - 1].timestamp)}\n`);

  // Header
  console.log('Time       PID      CPU%   Mem%   RSS(MB)  Cmdline');
  console.log('─────────  ───────  ─────  ─────  ────────  ──────────────────────────');

  const cpuValues = rows.map(r => r.cpu_percent);
  const maxCpu = Math.max(...cpuValues, 1);

  for (const row of rows) {
    const spark = sparkline([row.cpu_percent], maxCpu, 5);
    const cmd = (row.cmdline || row.name).slice(0, 30);
    console.log(
      `${formatTime(row.timestamp)}  ${String(row.pid).padEnd(7)}  ${String(row.cpu_percent.toFixed(1)).padStart(5)}  ${String(row.memory_percent.toFixed(1)).padStart(5)}  ${String(Math.round(row.rss_mb)).padStart(8)}  ${spark}  ${cmd}`
    );
  }

  // Summary footer
  const avgCpu = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length;
  const peakCpu = Math.max(...cpuValues);
  const peakIdx = cpuValues.indexOf(peakCpu);
  const avgMem = rows.reduce((a, r) => a + r.memory_percent, 0) / rows.length;

  console.log(`\nAvg CPU: ${avgCpu.toFixed(1)}% | Peak CPU: ${peakCpu.toFixed(1)}% @ ${formatTime(rows[peakIdx].timestamp)} | Avg Mem: ${avgMem.toFixed(1)}%`);
}

function printStats(rows: any[], processName: string): void {
  if (rows.length === 0) {
    console.log(`No data found for "${processName}" in the specified time window.`);
    return;
  }

  const cpuValues = rows.map(r => r.cpu_percent);
  const memValues = rows.map(r => r.memory_percent);
  const rssValues = rows.map(r => r.rss_mb);

  const avgCpu = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length;
  const peakCpu = Math.max(...cpuValues);
  const peakCpuTime = rows[cpuValues.indexOf(peakCpu)].timestamp;
  const highCpuSamples = cpuValues.filter(v => v > 30).length;

  const avgMem = memValues.reduce((a, b) => a + b, 0) / memValues.length;
  const peakMem = Math.max(...memValues);
  const peakMemTime = rows[memValues.indexOf(peakMem)].timestamp;

  const avgRss = rssValues.reduce((a, b) => a + b, 0) / rssValues.length;
  const peakRss = Math.max(...rssValues);

  const pids = [...new Set(rows.map(r => r.pid))];

  console.log(`\nProcess: ${processName}`);
  console.log(`Samples: ${rows.length} (${formatTime(rows[0].timestamp)} – ${formatTime(rows[rows.length - 1].timestamp)})`);
  console.log(`PIDs seen: ${pids.join(', ')}`);
  console.log('');
  console.log('CPU:');
  console.log(`  Average: ${avgCpu.toFixed(1)}%`);
  console.log(`  Peak:    ${peakCpu.toFixed(1)}% @ ${formatTime(peakCpuTime)}`);
  console.log(`  >30%:    ${highCpuSamples} samples (${(highCpuSamples / rows.length * 100).toFixed(0)}%)`);
  console.log('');
  console.log('Memory:');
  console.log(`  Average: ${avgMem.toFixed(1)}% | RSS ${Math.round(avgRss)}MB`);
  console.log(`  Peak:    ${peakMem.toFixed(1)}% @ ${formatTime(peakMemTime)} | RSS ${Math.round(peakRss)}MB`);
}

function printTop(db: TimeSeriesDB, metric: string, limit: number, sinceMinutes: number): void {
  const cutoff = Date.now() - sinceMinutes * 60000;
  const rows = db.getTopProcesses(metric, limit, cutoff);

  if (rows.length === 0) {
    console.log('No process data found in the specified time window.');
    return;
  }

  console.log(`\nTop ${limit} processes by ${metric.toUpperCase()} — last ${sinceMinutes}m\n`);
  console.log('Rank  Process              Avg     Peak    Samples  Trend');
  console.log('────  ───────────────────  ──────  ──────  ───────  ─────');

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const trend = trendArrow(r.values || []);
    const avg = metric === 'cpu' ? r.avg_cpu : r.avg_mem;
    const peak = metric === 'cpu' ? r.peak_cpu : r.peak_mem;
    console.log(
      `${String(i + 1).padStart(4)}  ${r.name.slice(0, 20).padEnd(20)}  ${String(avg.toFixed(1)).padStart(6)}  ${String(peak.toFixed(1)).padStart(6)}  ${String(r.samples).padStart(7)}  ${trend}`
    );
  }
}

function printCSV(rows: any[]): void {
  console.log('timestamp,pid,name,cpu_percent,memory_percent,rss_mb,cmdline');
  for (const row of rows) {
    const cmd = (row.cmdline || row.name).replace(/"/g, '""');
    console.log(`${row.timestamp},${row.pid},${row.name},${row.cpu_percent},${row.memory_percent},${row.rss_mb},"${cmd}"`);
  }
}

function printSpikes(db: TimeSeriesDB, processName: string | undefined, sinceMinutes: number): void {
  const rows = db.getRecentSpikes(processName, sinceMinutes);
  if (rows.length === 0) {
    console.log('No spikes found in the specified time window.');
    return;
  }

  console.log(`\nProcess Spikes — last ${sinceMinutes}m\n`);
  console.log('Time       Process              PID      Metric  Value   Baseline  Threshold');
  console.log('─────────  ───────────────────  ───────  ──────  ──────  ────────  ─────────');

  for (const r of rows) {
    const time = formatTime(r.timestamp);
    const proc = r.process_name.slice(0, 20).padEnd(20);
    const metric = r.metric_type.toUpperCase().padEnd(6);
    console.log(
      `${time}  ${proc}  ${String(r.pid).padEnd(7)}  ${metric}  ${String(r.value.toFixed(1)).padStart(6)}  ${String(r.baseline.toFixed(1)).padStart(8)}  ${String(r.threshold.toFixed(1)).padStart(9)}`
    );
  }

  console.log(`\nTotal spikes: ${rows.length}`);
}

function printSpikeStats(db: TimeSeriesDB, sinceMinutes: number): void {
  const cutoff = Date.now() - sinceMinutes * 60000;
  const rows = db.getSpikeStats(cutoff);
  if (rows.length === 0) {
    console.log('No spike statistics available.');
    return;
  }

  console.log(`\nSpike Statistics — last ${sinceMinutes}m\n`);
  console.log('Process              Metric  Count  AvgValue  PeakValue  AvgThreshold');
  console.log('───────────────────  ──────  ─────  ────────  ─────────  ────────────');

  for (const r of rows) {
    const proc = r.process_name.slice(0, 20).padEnd(20);
    const metric = r.metric_type.toUpperCase().padEnd(6);
    console.log(
      `${proc}  ${metric}  ${String(r.spike_count).padStart(5)}  ${String(r.avg_value.toFixed(1)).padStart(8)}  ${String(r.peak_value.toFixed(1)).padStart(9)}  ${String(r.avg_threshold.toFixed(1)).padStart(12)}`
    );
  }
}

function printBatteryRankings(db: TimeSeriesDB, limit: number): void {
  const rows = db.getBatteryImpactRankings(limit);
  if (rows.length === 0) {
    console.log('No battery impact data available yet.');
    return;
  }

  console.log(`\nBattery Impact Rankings (Top ${limit})\n`);
  console.log('Rank  Process              Impact  Drain(min)  Samples  AvgCPU%  FirstSeen        LastSeen');
  console.log('────  ───────────────────  ──────  ──────────  ───────  ───────  ───────────────  ───────────────');

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const proc = r.process_name.slice(0, 20).padEnd(20);
    const first = new Date(r.first_seen_timestamp).toLocaleString().slice(0, 15);
    const last = new Date(r.last_seen_timestamp).toLocaleString().slice(0, 15);
    console.log(
      `${String(i + 1).padStart(4)}  ${proc}  ${String(r.total_impact_score.toFixed(2)).padStart(6)}  ${String(r.drain_time_minutes.toFixed(1)).padStart(10)}  ${String(r.samples_during_drain).padStart(7)}  ${String(r.avg_cpu_during_drain.toFixed(1)).padStart(7)}  ${first.padEnd(15)}  ${last}`
    );
  }
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const db = new TimeSeriesDB();

  try {
    if (opts.top) {
      printTop(db, opts.top, opts.limit, opts.since);
    } else if (opts.spikes) {
      if (opts.stats) {
        printSpikeStats(db, opts.since);
      } else {
        printSpikes(db, opts.process, opts.since);
      }
    } else if (opts.battery) {
      printBatteryRankings(db, opts.limit);
    } else if (opts.process) {
      const cutoff = Date.now() - opts.since * 60000;
      const rows = db.getProcessHistory(opts.process, cutoff);

      if (opts.csv) {
        printCSV(rows);
      } else if (opts.stats) {
        printStats(rows, opts.process);
      } else {
        printTimeline(rows, opts.process);
      }
    } else if (opts.drainEvent) {
      // TODO: implement drain event correlation
      console.log('Drain event correlation not yet implemented.');
    } else {
      console.log('No query specified. Use --process <name> or --top <metric> or --spikes or --battery');
      console.log('Run with --help for usage.');
    }
  } finally {
    db.close();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
