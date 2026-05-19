import { SystemCollector } from './core/SystemCollector.js';
import { TimeSeriesDB } from './storage/TimeSeriesDB.js';

async function test() {
  console.log('[Test] Creating collector...');
  const collector = new SystemCollector();

  console.log('[Test] Getting snapshot...');
  const snapshot = await collector.getSystemSnapshot();

  console.log('[Test] Snapshot timestamp:', new Date(snapshot.timestamp).toISOString());
  console.log('[Test] Battery percent:', snapshot.battery.percent);
  console.log('[Test] CPU total:', snapshot.cpuTotal.toFixed(1), '%');
  console.log('[Test] CPU user:', snapshot.cpuUser.toFixed(1), '%');
  console.log('[Test] CPU system:', snapshot.cpuSystem.toFixed(1), '%');
  console.log('[Test] Memory total:', snapshot.memoryTotal.toFixed(1), '%');
  console.log('[Test] Memory used:', snapshot.memoryUsedMB.toFixed(0), 'MB');
  console.log('[Test] Memory free:', snapshot.memoryFreeMB.toFixed(0), 'MB');
  console.log('[Test] Swap used:', snapshot.swapUsedMB.toFixed(0), 'MB');
  console.log('[Test] Load avg:', snapshot.loadAvg.toFixed(2));
  console.log('[Test] Disk I/O:', snapshot.diskTotalIO ?? 'N/A');
  console.log('[Test] Net RX:', snapshot.netRxBytes ?? 'N/A');
  console.log('[Test] Net TX:', snapshot.netTxBytes ?? 'N/A');
  console.log('[Test] FS used:', snapshot.fsUsedPercent?.toFixed(1) ?? 'N/A', '%');
  console.log('[Test] CPU temp:', snapshot.cpuTemp ?? 'N/A');
  console.log('[Test] Top 3 processes:', snapshot.processes.slice(0, 3).map(p => `${p.name}(${p.pid}): ${p.cpuPercent.toFixed(1)}% usr=${p.cpuUserPercent.toFixed(1)} sys=${p.cpuSystemPercent.toFixed(1)} state=${p.state}`));

  console.log('[Test] Creating DB...');
  const db = new TimeSeriesDB('~/.procmon/test.db');

  console.log('[Test] Inserting snapshot...');
  const id = db.insertSnapshot(snapshot);
  console.log('[Test] Inserted snapshot ID:', id);

  console.log('[Test] DB stats:', db.getStats());

  db.close();
  console.log('[Test] All checks passed!');
}

test().catch(err => {
  console.error('[Test] Error:', err);
  process.exit(1);
});
