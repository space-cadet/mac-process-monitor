/**
 * Chart.js setup and update helpers.
 */

let charts = {};

function createLineChart(ctx, label, color, fill = false) {
  return new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{
      label, data: [],
      borderColor: color,
      backgroundColor: fill ? color + '20' : 'transparent',
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
      fill, tension: 0.3,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: true, labels: { color: '#94a3b8', font: { size: 11 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { display: false },
        y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
      },
    },
  });
}

function createMultiLineChart(ctx, datasets) {
  return new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { display: false },
        y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
      },
    },
  });
}

function initCharts() {
  charts.cpu = createMultiLineChart(
    document.getElementById('cpu-chart').getContext('2d'), [
      { label: 'CPU total', data: [], borderColor: '#38bdf8', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0, tension: 0.3 },
      { label: 'CPU user', data: [], borderColor: '#34d399', backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
      { label: 'CPU system', data: [], borderColor: '#fbbf24', backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
      { label: 'Memory %', data: [], borderColor: '#a78bfa', backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
    ]
  );

  charts.battery = createLineChart(
    document.getElementById('battery-chart').getContext('2d'),
    'Battery %', '#f87171', true
  );

  charts.extras = createMultiLineChart(
    document.getElementById('extras-chart').getContext('2d'), [
      { label: 'Load avg', data: [], borderColor: '#38bdf8', borderWidth: 2, pointRadius: 0, tension: 0.3 },
      { label: 'Swap used MB', data: [], borderColor: '#fbbf24', borderWidth: 1.5, pointRadius: 0, tension: 0.3, yAxisID: 'y1' },
      { label: 'CPU temp \u00B0C', data: [], borderColor: '#f87171', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
    ]
  );
  charts.extras.options.scales.y1 = {
    position: 'right', grid: { display: false },
    ticks: { color: '#94a3b8', font: { size: 11 } },
  };

  charts.io = createMultiLineChart(
    document.getElementById('io-chart').getContext('2d'), [
      { label: 'Disk read', data: [], borderColor: '#38bdf8', borderWidth: 2, pointRadius: 0, tension: 0.3 },
      { label: 'Disk write', data: [], borderColor: '#fbbf24', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
      { label: 'Net rx MB', data: [], borderColor: '#34d399', borderWidth: 1.5, pointRadius: 0, tension: 0.3, yAxisID: 'y1' },
      { label: 'Net tx MB', data: [], borderColor: '#a78bfa', borderWidth: 1.5, pointRadius: 0, tension: 0.3, yAxisID: 'y1' },
    ]
  );
  charts.io.options.scales.y1 = {
    position: 'right', grid: { display: false },
    ticks: { color: '#94a3b8', font: { size: 11 } },
  };

  charts.processHistory = createMultiLineChart(
    document.getElementById('process-history-chart').getContext('2d'), [
      { label: 'CPU %', data: [], borderColor: '#38bdf8', borderWidth: 2, pointRadius: 0, tension: 0.3 },
      { label: 'Memory %', data: [], borderColor: '#a78bfa', borderWidth: 1.5, pointRadius: 0, tension: 0.3 },
    ]
  );
}

function updateMainCharts(snapshots) {
  const ordered = [...snapshots].reverse();
  const labels = ordered.map(s => fmtTime(s.timestamp));

  // CPU
  charts.cpu.data.labels = labels;
  charts.cpu.data.datasets[0].data = ordered.map(s => s.cpu_total ?? 0);
  charts.cpu.data.datasets[1].data = ordered.map(s => s.cpu_user ?? 0);
  charts.cpu.data.datasets[2].data = ordered.map(s => s.cpu_system ?? 0);
  charts.cpu.data.datasets[3].data = ordered.map(s => s.memory_total ?? 0);
  charts.cpu.update('none');

  // Battery
  charts.battery.data.labels = labels;
  charts.battery.data.datasets[0].data = ordered.map(s => s.battery_percent ?? 0);
  charts.battery.update('none');

  // Extras
  charts.extras.data.labels = labels;
  charts.extras.data.datasets[0].data = ordered.map(s => s.load_avg ?? 0);
  charts.extras.data.datasets[1].data = ordered.map(s => s.swap_used_mb ?? 0);
  charts.extras.data.datasets[2].data = ordered.map(s => s.cpu_temp ?? 0);
  charts.extras.update('none');

  // IO
  charts.io.data.labels = labels;
  charts.io.data.datasets[0].data = ordered.map(s => s.disk_read_io ?? 0);
  charts.io.data.datasets[1].data = ordered.map(s => s.disk_write_io ?? 0);
  charts.io.data.datasets[2].data = ordered.map(s => (s.net_rx_bytes ?? 0) / 1e6);
  charts.io.data.datasets[3].data = ordered.map(s => (s.net_tx_bytes ?? 0) / 1e6);
  charts.io.update('none');
}

function updateProcessHistoryChart(history) {
  const labels = history.map(h => fmtTime(h.timestamp));
  charts.processHistory.data.labels = labels;
  charts.processHistory.data.datasets[0].data = history.map(h => h.cpu_percent ?? 0);
  charts.processHistory.data.datasets[1].data = history.map(h => h.memory_percent ?? 0);
  charts.processHistory.update('none');
}
