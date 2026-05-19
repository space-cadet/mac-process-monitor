import { SystemCollector } from './core/SystemCollector.js';

async function showData() {
  const c = new SystemCollector();
  const s = await c.getSystemSnapshot();
  
  console.log('=== SYSTEM SNAPSHOT ===');
  console.log('Time:', new Date(s.timestamp).toLocaleString());
  console.log('Battery:', s.battery.percent + '%', s.battery.isCharging ? '(charging)' : '(on battery)');
  console.log('Time remaining:', s.battery.timeRemaining, 'min');
  console.log('Cycle count:', s.battery.cycleCount);
  console.log('CPU total:', s.cpuTotal.toFixed(1) + '%', `(usr ${s.cpuUser.toFixed(1)}% / sys ${s.cpuSystem.toFixed(1)}% / idle ${s.cpuIdle.toFixed(1)}%)`);
  console.log('Memory:', s.memoryTotal.toFixed(1) + '%', `(${s.memoryUsedMB.toFixed(0)}MB used / ${s.memoryFreeMB.toFixed(0)}MB free)`);
  console.log('Swap:', `${s.swapUsedMB.toFixed(0)}MB / ${s.swapTotalMB.toFixed(0)}MB`);
  console.log('Load avg:', s.loadAvg.toFixed(2));
  console.log('Disk I/O:', `read=${s.diskReadIO ?? 'N/A'} write=${s.diskWriteIO ?? 'N/A'} total=${s.diskTotalIO ?? 'N/A'}`);
  console.log('Network:', `rx=${s.netRxBytes ?? 'N/A'} tx=${s.netTxBytes ?? 'N/A'}`);
  console.log('Disk usage:', s.fsUsedPercent?.toFixed(1) ?? 'N/A', '%');
  console.log('CPU temp:', s.cpuTemp ?? 'N/A', '°C');
  console.log();
  console.log('=== TOP 10 PROCESSES BY CPU ===');
  for (const p of s.processes.slice(0, 10)) {
    console.log(
      `${p.name.padEnd(20)} PID:${p.pid.toString().padStart(6)}  ` +
      `CPU:${p.cpuPercent.toFixed(1).padStart(6)}% ` +
      `(usr:${p.cpuUserPercent.toFixed(1).padStart(5)}% sys:${p.cpuSystemPercent.toFixed(1).padStart(5)}%) ` +
      `MEM:${p.memoryPercent.toFixed(1).padStart(5)}%  ` +
      `RSS:${p.rssMB.toFixed(0).padStart(4)}MB  ` +
      `nice:${p.nice.toString().padStart(3)}  ` +
      `state:${p.state.padStart(8)}`
    );
  }
}

showData().catch(console.error);
