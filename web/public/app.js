const API_BASE = '';
let currentProcesses = [];
let currentSort = 'cpu';
let refreshInterval = null;

async function fetchData() {
  try {
    const res = await fetch(`${API_BASE}/api/snapshot`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    updateDashboard(data);
    document.getElementById('liveDot').style.background = 'var(--accent-ok)';
    document.getElementById('liveText').textContent = 'Live • Updated just now';
  } catch (err) {
    console.error('Fetch error:', err);
    document.getElementById('liveDot').style.background = 'var(--accent-drain)';
    document.getElementById('liveText').textContent = 'Offline • ' + err.message;
  }
}

function updateDashboard(data) {
  // Battery
  const battery = data.battery;
  document.getElementById('batteryValue').innerHTML = `${Math.round(battery.percent)}<span>%</span>`;
  document.getElementById('batteryFill').style.width = `${battery.percent}%`;
  document.getElementById('batteryStatus').textContent = battery.isCharging ? 'Charging' : 'On battery';
  document.getElementById('batteryDetail').textContent = 
    `${battery.cycleCount || '--'} cycles • ${battery.timeRemaining ? Math.round(battery.timeRemaining / 60) + 'h remaining' : '--'}`;

  // CPU
  const cpuTotal = data.cpuTotal || 0;
  document.getElementById('cpuValue').innerHTML = `${cpuTotal.toFixed(1)}<span>%</span>`;
  
  const topCpu = data.processes[0];
  const cpuTrend = document.getElementById('cpuTrend');
  if (cpuTotal > 80) {
    cpuTrend.className = 'kpi-trend down';
    cpuTrend.innerHTML = `<span>▲</span> <span id="cpuTrendText">${topCpu?.name || 'High'} spiking</span>`;
  } else {
    cpuTrend.className = 'kpi-trend up';
    cpuTrend.innerHTML = `<span>✓</span> <span id="cpuTrendText">Normal load</span>`;
  }
  document.getElementById('cpuDetail').textContent = `${data.processes.length} processes tracked`;

  // Memory
  const memGB = data.memoryTotal ? (data.memoryTotal / 100 * 8).toFixed(1) : '--';
  document.getElementById('memValue').innerHTML = `${memGB}<span>GB</span>`;
  document.getElementById('memPercent').textContent = data.memoryTotal ? `${data.memoryTotal.toFixed(1)}% used` : '--';
  document.getElementById('memDetail').textContent = 'of 8.2 GB total';

  // Status
  const statusValue = document.getElementById('statusValue');
  const statusTrend = document.getElementById('statusTrend');
  
  if (battery.isCharging) {
    statusValue.textContent = 'Charging';
    statusTrend.className = 'kpi-trend up';
    statusTrend.innerHTML = '<span>⚡</span> <span id="statusTrendText">Power connected</span>';
  } else if (battery.percent < 20) {
    statusValue.textContent = 'Low Battery';
    statusTrend.className = 'kpi-trend down';
    statusTrend.innerHTML = '<span>!</span> <span id="statusTrendText">Charge soon</span>';
  } else {
    statusValue.textContent = 'Normal';
    statusTrend.className = 'kpi-trend up';
    statusTrend.innerHTML = '<span>✓</span> <span id="statusTrendText">No drain detected</span>';
  }
  document.getElementById('statusDetail').textContent = new Date(data.timestamp).toLocaleTimeString();

  // Processes
  currentProcesses = data.processes || [];
  renderProcesses();
}

function renderProcesses() {
  const tbody = document.getElementById('processTable');
  const sorted = [...currentProcesses].sort((a, b) => {
    if (currentSort === 'cpu') return b.cpuPercent - a.cpuPercent;
    return b.memoryPercent - a.memoryPercent;
  }).slice(0, 10);

  tbody.innerHTML = sorted.map(p => `
    <tr>
      <td>
        <div class="process-name">
          <div class="process-icon">◆</div>
          <span>${p.name}</span>
        </div>
      </td>
      <td>${p.pid}</td>
      <td>
        <div class="cpu-bar">
          <span>${p.cpuPercent.toFixed(1)}%</span>
          <div class="cpu-bar-track">
            <div class="cpu-bar-fill ${p.cpuPercent > 50 ? 'high' : ''}" style="width: ${Math.min(p.cpuPercent, 100)}%;"></div>
          </div>
        </div>
      </td>
      <td>${p.rssMB.toFixed(0)} MB</td>
    </tr>
  `).join('');
}

function sortProcesses(by, clickedBtn) {
  currentSort = by;
  renderProcesses();
  
  // Update button states
  const buttons = document.querySelectorAll('.panel-actions .panel-btn');
  buttons.forEach(btn => btn.classList.remove('active'));
  if (clickedBtn) clickedBtn.classList.add('active');
}

async function loadHistory(minutes, clickedBtn) {
  try {
    const res = await fetch(`${API_BASE}/api/history?minutes=${minutes}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderChart(data);
    
    // Update button states
    const buttons = document.querySelectorAll('.panel-actions .panel-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    if (clickedBtn) clickedBtn.classList.add('active');
  } catch (err) {
    console.error('History fetch error:', err);
    document.getElementById('batteryChart').innerHTML = 
      `<div style="color: var(--text-dim); font-size: 13px;">Error loading chart: ${err.message}</div>`;
  }
}

function renderChart(data) {
  const container = document.getElementById('batteryChart');
  if (!data.length) {
    container.innerHTML = '<div style="color: var(--text-dim); font-size: 13px;">No data available</div>';
    return;
  }

  const maxVal = 100;
  const bars = data.map(d => {
    const percent = d.battery_percent ?? d.batteryPercent ?? 0;
    const height = (percent / maxVal) * 100;
    const time = new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="chart-bar" style="height: ${height}%;" data-value="${percent.toFixed(0)}% @ ${time}">
      </div>
    `;
  }).join('');

  container.innerHTML = bars;
}

async function loadDrainEvents() {
  try {
    const res = await fetch(`${API_BASE}/api/drain-events`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = await res.json();
    renderDrainEvents(events);
  } catch (err) {
    console.error('Drain events fetch error:', err);
    document.getElementById('drainList').innerHTML = 
      `<div style="padding: 20px; color: var(--text-dim); text-align: center;">Error: ${err.message}</div>`;
  }
}

function renderDrainEvents(events) {
  const container = document.getElementById('drainList');
  if (!events.length) {
    container.innerHTML = '<div style="padding: 20px; color: var(--text-dim); text-align: center;">No drain events recorded</div>';
    return;
  }

  container.innerHTML = events.map(e => {
    const start = new Date(e.startTime).toLocaleString();
    const end = new Date(e.endTime).toLocaleString();
    const procs = e.topProcesses?.map(p => `${p.name} (${p.cpuPercent.toFixed(0)}%)`).join(', ') || 'N/A';
    
    return `
      <div class="drain-item">
        <div class="drain-info">
          <h4>⚡ Rapid Drain Detected</h4>
          <p>${start} — ${end}</p>
        </div>
        <div class="drain-meta">
          <div class="drain-rate">${e.drainRate.toFixed(1)}<span>%/min</span></div>
          <div class="drain-processes">${procs}</div>
        </div>
      </div>
    `;
  }).join('');
}

function exportCSV() {
  fetch(`${API_BASE}/api/drain-events`)
    .then(r => r.json())
    .then(events => {
      if (!events.length) return alert('No drain events to export');
      
      const headers = ['Start Time', 'End Time', 'Start %', 'End %', 'Drain Rate (%/min)', 'Duration (min)', 'Top Processes'];
      const rows = events.map(e => [
        new Date(e.startTime).toISOString(),
        new Date(e.endTime).toISOString(),
        e.startPercent,
        e.endPercent,
        e.drainRate.toFixed(2),
        e.durationMinutes.toFixed(1),
        e.topProcesses?.map(p => `${p.name}:${p.cpuPercent.toFixed(1)}%`).join('; ') || ''
      ]);
      
      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `drain-events-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    })
    .catch(err => alert('Export failed: ' + err.message));
}

// Initialize
function init() {
  fetchData();
  loadHistory(60, document.querySelector('.panel-actions .panel-btn.active'));
  loadDrainEvents();
  
  refreshInterval = setInterval(() => {
    fetchData();
    loadDrainEvents();
  }, 5000);
}

init();
