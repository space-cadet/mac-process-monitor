const API_BASE = '';
let currentProcesses = [];
let currentSort = { column: 'cpu', direction: 'desc' };
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
    let valA, valB;
    switch (currentSort.column) {
      case 'name': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
      case 'pid': valA = a.pid; valB = b.pid; break;
      case 'cpu': valA = a.cpuPercent; valB = b.cpuPercent; break;
      case 'memory': valA = a.memoryPercent; valB = b.memoryPercent; break;
      default: valA = a.cpuPercent; valB = b.cpuPercent;
    }
    if (currentSort.direction === 'asc') return valA > valB ? 1 : -1;
    return valA < valB ? 1 : -1;
  }).slice(0, 10);

  tbody.innerHTML = sorted.map(p => {
    return `
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
        <td>
          <div class="cpu-bar">
            <span>${p.rssMB.toFixed(0)} MB</span>
            <div class="cpu-bar-track">
              <div class="cpu-bar-fill ${p.memoryPercent > 50 ? 'high' : ''}" style="width: ${Math.min(p.memoryPercent, 100)}%;"></div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  
  updateSortHeaders();
}

function updateSortHeaders() {
  const headers = document.querySelectorAll('.process-table th');
  const sortIndicator = (column) => {
    if (currentSort.column !== column) return '';
    return currentSort.direction === 'asc' ? ' ▲' : ' ▼';
  };
  
  headers[0].innerHTML = `Process${sortIndicator('name')}`;
  headers[1].innerHTML = `PID${sortIndicator('pid')}`;
  headers[2].innerHTML = `CPU${sortIndicator('cpu')}`;
  headers[3].innerHTML = `Memory${sortIndicator('memory')}`;
}

function sortByColumn(column) {
  if (currentSort.column === column) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.column = column;
    currentSort.direction = 'desc';
  }
  renderProcesses();
}

function sortProcesses(by, clickedBtn) {
  currentSort = { column: by, direction: 'desc' };
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
  const xAxis = document.getElementById('batteryXAxis');
  if (!data.length) {
    container.innerHTML = '<div style="color: var(--text-dim); font-size: 13px;">No data available</div>';
    if (xAxis) xAxis.innerHTML = '';
    return;
  }

  // SVG line chart
  const width = 800;
  const height = 200;
  const padding = { top: 10, right: 10, bottom: 10, left: 10 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxVal = 100;
  const minVal = 0;

  // Create points
  const points = data.map((d, i) => {
    const percent = d.battery_percent ?? d.batteryPercent ?? 0;
    const x = padding.left + (i / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((percent - minVal) / (maxVal - minVal)) * chartHeight;
    return { x, y, percent, timestamp: d.timestamp };
  });

  // Build path
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // Area path (for gradient fill)
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${padding.top + chartHeight} L ${points[0].x.toFixed(1)} ${padding.top + chartHeight} Z`;

  const svg = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="width: 100%; height: 100%;">
      <defs>
        <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent-battery)" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="var(--accent-battery)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaD}" fill="url(#areaGradient)" stroke="none"/>
      <path d="${pathD}" fill="none" stroke="var(--accent-battery)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${points.map((p, i) => i % Math.ceil(points.length / 20) === 0 ? 
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--accent-battery)" stroke="var(--surface)" stroke-width="1"/>
        <title>${p.percent}% @ ${new Date(p.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</title>` : '').join('')}
    </svg>
  `;

  container.innerHTML = svg;

  // X-axis labels: show first, middle, last timestamps
  if (xAxis) {
    const first = data[0];
    const last = data[data.length - 1];
    const mid = data[Math.floor(data.length / 2)];
    const fmt = (d) => new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    xAxis.innerHTML = `
      <span>${fmt(first)}</span>
      <span>${fmt(mid)}</span>
      <span>${fmt(last)}</span>
    `;
  }
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
