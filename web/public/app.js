const API_BASE = '';
let currentProcesses = [];
let currentSort = { column: 'cpu', direction: 'desc' };
let refreshInterval = null;
let currentChartTab = 'battery';
let chartHistoryData = [];
let chartTimeRange = 60;
let currentAnalysisData = null;
let currentAnalysisTitle = '';
let previousSnapshot = null;
let lastNetworkRates = { rx: 0, tx: 0 };

// ─── Main Tab Switching ───
function switchMainTab(tab) {
  document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`.main-tab[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`${tab}Tab`).classList.add('active');

  if (tab === 'analysis') {
    loadQuickStats();
  } else if (tab === 'sleep') {
    loadSleepWakeEvents(7);
  } else if (tab === 'devices') {
    loadDevices();
  }
}

// ─── Analysis: Preset Queries ───
const PRESET_QUERIES = {
  batteryTrend: {
    title: 'Battery Trend (Daily Average)',
    endpoint: '/api/analysis/battery-trend',
    description: 'Average battery drain rate per day'
  },
  topBatteryImpact: {
    title: 'Top Battery Impact Processes',
    endpoint: '/api/analysis/top-battery-impact',
    description: 'Processes with highest cumulative battery impact'
  },
  spikePatterns: {
    title: 'Spike Frequency by Process',
    endpoint: '/api/analysis/spike-patterns',
    description: 'CPU/memory spike count per process'
  },
  drainCorrelation: {
    title: 'Drain Event Correlation',
    endpoint: '/api/analysis/drain-correlation',
    description: 'Top processes during battery drain events'
  },
  diskTrend: {
    title: 'Disk Usage Trend',
    endpoint: '/api/analysis/disk-trend',
    description: 'Daily disk usage percentage'
  },
  networkTrend: {
    title: 'Network Activity Trend',
    endpoint: '/api/analysis/network-trend',
    description: 'Daily network RX/TX volume'
  },
  idleVsActive: {
    title: 'Idle vs Active Hours',
    endpoint: '/api/analysis/idle-active',
    description: 'System activity patterns by hour of day'
  },
  processConsistency: {
    title: 'Process CPU Consistency',
    endpoint: '/api/analysis/process-stats',
    description: 'Average, peak, and standard deviation per process'
  }
};

const analysisCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function runPresetQuery(queryKey) {
  const preset = PRESET_QUERIES[queryKey];
  if (!preset) return;

  // Check cache
  const cached = analysisCache.get(queryKey);
  if (cached && Date.now() - cached.time < CACHE_TTL_MS) {
    currentAnalysisData = cached.data;
    currentAnalysisTitle = preset.title;
    document.getElementById('analysisTitle').textContent = preset.title;
    renderAnalysisResults(cached.data, queryKey);
    return;
  }

  currentAnalysisTitle = preset.title;
  document.getElementById('analysisTitle').textContent = preset.title;
  document.getElementById('analysisContent').innerHTML = '<div class="analysis-loading">⏳ Running analysis...</div>';

  try {
    const res = await fetch(`${API_BASE}${preset.endpoint}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    currentAnalysisData = data;
    analysisCache.set(queryKey, { data, time: Date.now() });
    renderAnalysisResults(data, queryKey);
  } catch (err) {
    document.getElementById('analysisContent').innerHTML =
      `<div class="analysis-error">❌ Error: ${err.message}</div>`;
  }
}

function renderAnalysisResults(data, queryKey) {
  const container = document.getElementById('analysisContent');

  if (!data || (Array.isArray(data) && data.length === 0)) {
    container.innerHTML = '<div class="analysis-placeholder"><div class="placeholder-icon">📭</div><h3>No data found</h3><p>Try a different time range or check back later.</p></div>';
    return;
  }

  switch (queryKey) {
    case 'batteryTrend':
      renderBatteryTrend(data, container);
      break;
    case 'topBatteryImpact':
      renderTopBatteryImpact(data, container);
      break;
    case 'spikePatterns':
      renderSpikePatterns(data, container);
      break;
    case 'drainCorrelation':
      renderDrainCorrelation(data, container);
      break;
    case 'idleVsActive':
      renderIdleVsActive(data, container);
      break;
    case 'processConsistency':
      renderProcessConsistency(data, container);
      break;
    case 'diskTrend':
      renderDiskTrend(data, container);
      break;
    case 'networkTrend':
      renderNetworkTrend(data, container);
      break;
    default:
      renderGenericTable(data, container);
  }
}

function renderBatteryTrend(data, container) {
  const rows = data.map(d => `
    <tr>
      <td>${d.date}</td>
      <td>${d.avgBattery?.toFixed(1) || '--'}%</td>
      <td>${d.minBattery?.toFixed(1) || '--'}%</td>
      <td>${d.maxBattery?.toFixed(1) || '--'}%</td>
      <td>${d.samples || '--'}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="analysis-table-wrapper">
      <table class="analysis-table">
        <thead>
          <tr><th>Date</th><th>Avg Battery</th><th>Min Battery</th><th>Max Battery</th><th>Samples</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="analysis-summary">
      <p><strong>Insight:</strong> ${data.length} days of data. 
      ${data.length > 1 && data[0].avgBattery != null && data[data.length-1].avgBattery != null
        ? `Battery trend: ${data[0].avgBattery > data[data.length-1].avgBattery ? 'Declining' : 'Improving'} over recorded period.`
        : ''}
      </p>
    </div>
  `;
}

function renderTopBatteryImpact(data, container) {
  const rows = data.slice(0, 20).map((d, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${d.name}</strong></td>
      <td>${d.totalImpact?.toFixed(1) || '--'}</td>
      <td>${d.events || '--'}</td>
      <td>${d.avgImpact?.toFixed(2) || '--'}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="analysis-table-wrapper">
      <table class="analysis-table">
        <thead>
          <tr><th>#</th><th>Process</th><th>Total Impact</th><th>Events</th><th>Avg Impact</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="analysis-summary">
      <p><strong>Top culprit:</strong> ${data[0]?.name || 'N/A'} with ${data[0]?.totalImpact?.toFixed(1) || '--'} total impact score.</p>
    </div>
  `;
}

function renderSpikePatterns(data, container) {
  const rows = data.slice(0, 20).map((d, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${d.name}</strong></td>
      <td>${d.cpuSpikes || 0}</td>
      <td>${d.memSpikes || 0}</td>
      <td>${d.totalSpikes || 0}</td>
      <td>${d.avgCpu?.toFixed(1) || '--'}%</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="analysis-table-wrapper">
      <table class="analysis-table">
        <thead>
          <tr><th>#</th><th>Process</th><th>CPU Spikes</th><th>Mem Spikes</th><th>Total</th><th>Avg CPU</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderDrainCorrelation(data, container) {
  const rows = data.slice(0, 20).map((d, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${d.name}</strong></td>
      <td>${d.drainEvents || 0}</td>
      <td>${d.totalCpu?.toFixed(1) || '--'}</td>
      <td>${d.avgCpu?.toFixed(1) || '--'}%</td>
      <td>${d.frequency?.toFixed(1) || '--'}%</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="analysis-table-wrapper">
      <table class="analysis-table">
        <thead>
          <tr><th>#</th><th>Process</th><th>Drain Events</th><th>Total CPU</th><th>Avg CPU</th><th>Frequency</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderIdleVsActive(data, container) {
  const rows = data.map(d => `
    <tr>
      <td>${d.hour}:00</td>
      <td>${d.avgCpu?.toFixed(1) || '--'}%</td>
      <td>${d.avgBattery?.toFixed(1) || '--'}%</td>
      <td>${d.samples || 0}</td>
      <td><span class="activity-badge ${d.activityLevel}">${d.activityLevel}</span></td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="analysis-table-wrapper">
      <table class="analysis-table">
        <thead>
          <tr><th>Hour</th><th>Avg CPU</th><th>Avg Battery</th><th>Samples</th><th>Activity</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="analysis-summary">
      <p><strong>Peak activity:</strong> ${data.filter(d => d.activityLevel === 'high').map(d => d.hour + ':00').join(', ') || 'N/A'}</p>
    </div>
  `;
}

function renderProcessConsistency(data, container) {
  const rows = data.slice(0, 20).map((d, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${d.name}</strong></td>
      <td>${d.avgCpu?.toFixed(1) || '--'}%</td>
      <td>${d.peakCpu?.toFixed(1) || '--'}%</td>
      <td>${d.stdCpu?.toFixed(2) || '--'}</td>
      <td>${d.samples || 0}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="analysis-table-wrapper">
      <table class="analysis-table">
        <thead>
          <tr><th>#</th><th>Process</th><th>Avg CPU</th><th>Peak CPU</th><th>Std Dev</th><th>Samples</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderProcessConsistency(data, container) {
  const rows = data.slice(0, 20).map((d, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${d.name}</strong></td>
      <td>${d.avgCpu?.toFixed(1) || '--'}%</td>
      <td>${d.peakCpu?.toFixed(1) || '--'}%</td>
      <td>${d.stdCpu?.toFixed(2) || '--'}</td>
      <td>${d.samples || 0}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="analysis-table-wrapper">
      <table class="analysis-table">
        <thead>
          <tr><th>#</th><th>Process</th><th>Avg CPU</th><th>Peak CPU</th><th>Std Dev</th><th>Samples</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderDiskTrend(data, container) {
  const rows = data.map(d => `
    <tr>
      <td>${d.date}</td>
      <td>${d.avgDisk?.toFixed(1) || '--'}%</td>
      <td>${d.minDisk?.toFixed(1) || '--'}%</td>
      <td>${d.maxDisk?.toFixed(1) || '--'}%</td>
      <td>${d.samples || '--'}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="analysis-table-wrapper">
      <table class="analysis-table">
        <thead>
          <tr><th>Date</th><th>Avg Usage</th><th>Min Usage</th><th>Max Usage</th><th>Samples</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="analysis-summary">
      <p><strong>Highest usage:</strong> ${data.length > 0 ? Math.max(...data.map(d => d.maxDisk || 0)).toFixed(1) + '%' : 'N/A'}</p>
    </div>
  `;
}

function renderNetworkTrend(data, container) {
  const rows = data.map(d => `
    <tr>
      <td>${d.date}</td>
      <td>${d.rxMB?.toFixed(1) || '--'} MB</td>
      <td>${d.txMB?.toFixed(1) || '--'} MB</td>
      <td>${d.samples || '--'}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div class="analysis-table-wrapper">
      <table class="analysis-table">
        <thead>
          <tr><th>Date</th><th>RX (MB)</th><th>TX (MB)</th><th>Samples</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="analysis-summary">
      <p><strong>Most active day:</strong> ${data.length > 0 ? data.reduce((a, b) => ((b.rxMB || 0) + (b.txMB || 0) > (a.rxMB || 0) + (a.txMB || 0) ? b : a)).date : 'N/A'}</p>
    </div>
  `;
}

function renderGenericTable(data, container) {
  if (!Array.isArray(data) || !data.length) {
    container.innerHTML = '<div class="analysis-placeholder"><div class="placeholder-icon">📭</div><h3>No data</h3></div>';
    return;
  }
  const keys = Object.keys(data[0]);
  const headers = keys.map(k => `<th>${k}</th>`).join('');
  const rows = data.map(row => `<tr>${keys.map(k => `<td>${row[k] ?? '--'}</td>`).join('')}</tr>`).join('');

  container.innerHTML = `
    <div class="analysis-table-wrapper">
      <table class="analysis-table">
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function loadQuickStats() {
  try {
    const [dbStats, drainRes, spikeRes] = await Promise.all([
      fetch(`${API_BASE}/api/db-stats`).then(r => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/api/drain-events`).then(r => r.json()).catch(() => []),
      fetch(`${API_BASE}/api/analysis/spike-patterns`).then(r => r.json()).catch(() => [])
    ]);

    document.getElementById('qsTotalSamples').textContent = (dbStats.totalSnapshots || 0).toLocaleString();
    document.getElementById('qsTotalDrains').textContent = drainRes.length || 0;
    document.getElementById('qsTotalSpikes').textContent = spikeRes.reduce((sum, s) => sum + (s.totalSpikes || 0), 0);

    const days = dbStats.oldestSnapshot
      ? Math.round((Date.now() - new Date(dbStats.oldestSnapshot).getTime()) / 86400000)
      : 0;
    document.getElementById('qsUptime').textContent = days || '--';
  } catch (err) {
    console.error('Quick stats error:', err);
  }
}

function exportAnalysisJSON() {
  if (!currentAnalysisData) return alert('No analysis data to export');
  const blob = new Blob([JSON.stringify(currentAnalysisData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `analysis-${currentAnalysisTitle.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportAnalysisCSV() {
  if (!currentAnalysisData || !Array.isArray(currentAnalysisData) || !currentAnalysisData.length) {
    return alert('No analysis data to export');
  }
  const keys = Object.keys(currentAnalysisData[0]);
  const rows = currentAnalysisData.map(row => keys.map(k => JSON.stringify(row[k] ?? '')).join(','));
  const csv = [keys.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `analysis-${currentAnalysisTitle.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Sleep/Wake Event Functions ───

async function loadSleepWakeEvents(days = 7) {
  try {
    const since = Date.now() - days * 86400000;
    const res = await fetch(`${API_BASE}/api/sleep-wake-events?since=${since}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const events = await res.json();
    renderSleepWakeEvents(events);
  } catch (err) {
    console.error('Sleep/wake fetch error:', err);
    document.getElementById('sleepTimeline').innerHTML =
      `<div style="padding: 20px; color: var(--text-dim); text-align: center;">Error: ${err.message}</div>`;
  }
}

function renderSleepWakeEvents(events) {
  const container = document.getElementById('sleepTimeline');
  if (!events || events.length === 0) {
    container.innerHTML = `<div style="padding: 20px; color: var(--text-dim); text-align: center;">No sleep/wake events recorded</div>`;
    return;
  }

  // Pair sleep and wake events
  const pairs = [];
  let lastSleep = null;
  
  for (const e of events) {
    if (e.event_type === 'sleep') {
      lastSleep = e;
    } else if (e.event_type === 'wake' && lastSleep) {
      const sleepTime = new Date(lastSleep.timestamp);
      const wakeTime = new Date(e.timestamp);
      const durationMs = wakeTime - sleepTime;
      const durationHours = (durationMs / 3600000).toFixed(1);
      const drain = (lastSleep.battery_percent - e.battery_percent).toFixed(1);
      
      pairs.push({
        sleepTime,
        wakeTime,
        sleepBattery: lastSleep.battery_percent,
        wakeBattery: e.battery_percent,
        drain,
        durationHours,
        isCharging: e.is_charging
      });
      lastSleep = null;
    }
  }

  if (pairs.length === 0) {
    container.innerHTML = `<div style="padding: 20px; color: var(--text-dim); text-align: center;">No complete sleep/wake cycles found</div>`;
    return;
  }

  container.innerHTML = pairs.map(pair => {
    const sleepStr = pair.sleepTime.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const wakeStr = pair.wakeTime.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const drainColor = pair.drain > 20 ? 'var(--accent-drain)' : pair.drain > 10 ? 'var(--accent-cpu)' : 'var(--accent-ok)';
    
    return `
      <div class="sleep-cycle">
        <div class="sleep-cycle-header">
          <div class="sleep-cycle-date">${pair.sleepTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          <div class="sleep-cycle-drain" style="color: ${drainColor}">↓ ${pair.drain}% drain</div>
        </div>
        <div class="sleep-cycle-timeline">
          <div class="sleep-cycle-event">
            <div class="sleep-cycle-icon">🌙</div>
            <div class="sleep-cycle-info">
              <div class="sleep-cycle-label">Slept</div>
              <div class="sleep-cycle-time">${sleepStr}</div>
              <div class="sleep-cycle-battery">${pair.sleepBattery.toFixed(0)}%</div>
            </div>
          </div>
          <div class="sleep-cycle-duration">
            <div class="sleep-cycle-bar"></div>
            <div class="sleep-cycle-hours">${pair.durationHours}h</div>
          </div>
          <div class="sleep-cycle-event">
            <div class="sleep-cycle-icon">☀️</div>
            <div class="sleep-cycle-info">
              <div class="sleep-cycle-label">Woke</div>
              <div class="sleep-cycle-time">${wakeStr}</div>
              <div class="sleep-cycle-battery">${pair.wakeBattery.toFixed(0)}%</div>
            </div>
          </div>
        </div>
        <div class="sleep-cycle-summary">
          ${pair.isCharging ? '⚡ Charging' : '🔋 On battery'} • 
          ${pair.drain > 0 ? `${pair.drain}% lost during sleep` : 'No drain detected'}
        </div>
      </div>
    `;
  }).join('');
}

// ─── Device Functions ───

async function loadDevices() {
  try {
    const res = await fetch(`${API_BASE}/api/devices`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderDevices(data.devices || []);
  } catch (err) {
    console.error('Device fetch error:', err);
    document.getElementById('deviceGrid').innerHTML =
      `<div style="padding: 20px; color: var(--text-dim); text-align: center;">Error: ${err.message}</div>`;
  }
}

function renderDevices(devices) {
  const container = document.getElementById('deviceGrid');
  if (!devices || devices.length === 0) {
    container.innerHTML = `<div style="padding: 20px; color: var(--text-dim); text-align: center;">No devices registered yet</div>`;
    return;
  }

  container.innerHTML = devices.map(d => {
    const lastSeen = new Date(d.lastSeen).toLocaleString();
    const registered = new Date(d.registeredAt).toLocaleDateString();
    const statusColor = d.isOnline ? 'var(--accent-ok)' : 'var(--text-dim)';
    const statusIcon = d.isOnline ? '🟢' : '⚪';
    const platformIcon = d.platform === 'darwin' ? '🍎' : d.platform === 'linux' ? '🐧' : d.platform === 'win32' ? '🪟' : '🖥️';

    return `
      <div class="device-card" style="border-left: 3px solid ${statusColor};">
        <div class="device-card-header">
          <div class="device-card-icon">${platformIcon}</div>
          <div class="device-card-info">
            <div class="device-card-name">${d.name}</div>
            <div class="device-card-hostname">${d.hostname}</div>
          </div>
          <div class="device-card-status" style="color: ${statusColor};">${statusIcon} ${d.isOnline ? 'Online' : 'Offline'}</div>
        </div>
        <div class="device-card-meta">
          <span>${d.platform} • ${d.arch}</span>
          <span>v${d.version || '?'}</span>
        </div>
        <div class="device-card-footer">
          <span>Last seen: ${lastSeen}</span>
          <span>Registered: ${registered}</span>
        </div>
      </div>
    `;
  }).join('');
}

let currentProcessView = 'list';

function switchProcessView(view) {
  currentProcessView = view;
  document.getElementById('viewListBtn').classList.toggle('active', view === 'list');
  document.getElementById('viewTreeBtn').classList.toggle('active', view === 'tree');
  document.getElementById('processListWrapper').style.display = view === 'list' ? 'block' : 'none';
  document.getElementById('processTreeWrapper').style.display = view === 'tree' ? 'block' : 'none';
  if (view === 'tree') loadProcessTree();
  else renderProcesses();
}

async function loadProcessTree() {
  try {
    const res = await fetch(`${API_BASE}/api/process-tree`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderProcessTree(data.processes || []);
  } catch (err) {
    console.error('Process tree fetch error:', err);
    document.getElementById('processTree').innerHTML =
      `<div style="padding: 20px; color: var(--text-dim); text-align: center;">Error: ${err.message}</div>`;
  }
}

function renderProcessTree(nodes, level = 0) {
  const container = document.getElementById('processTree');
  if (level === 0) container.innerHTML = '';

  if (!nodes || nodes.length === 0) {
    if (level === 0) container.innerHTML = '<div style="padding: 20px; color: var(--text-dim); text-align: center;">No process data</div>';
    return;
  }

  const html = nodes.map(n => {
    const indent = level * 20;
    const hasChildren = n.children && n.children.length > 0;
    const toggleId = hasChildren ? `tree-toggle-${n.pid}` : null;
    const childrenId = hasChildren ? `tree-children-${n.pid}` : null;
    const rssMB = (n.rssKB / 1024).toFixed(1);
    const cpuClass = n.cpuPercent > 50 ? 'high' : '';

    return `
      <div class="tree-node" style="margin-left: ${indent}px;">
        <div class="tree-node-row">
          ${hasChildren ? `<button class="tree-toggle" id="${toggleId}" onclick="toggleTreeNode(${n.pid})">▼</button>` : '<span class="tree-spacer"></span>'}
          <span class="tree-name" title="PID ${n.pid}">${n.name}</span>
          <span class="tree-pid">${n.pid}</span>
          <span class="tree-cpu ${cpuClass}">${n.cpuPercent.toFixed(1)}%</span>
          <span class="tree-mem">${rssMB} MB</span>
        </div>
        ${hasChildren ? `<div class="tree-children" id="${childrenId}">${renderProcessTreeHtml(n.children, level + 1)}</div>` : ''}
      </div>
    `;
  }).join('');

  if (level === 0) {
    container.innerHTML = html;
  }
  return html;
}

function renderProcessTreeHtml(nodes, level) {
  return nodes.map(n => {
    const indent = level * 20;
    const hasChildren = n.children && n.children.length > 0;
    const toggleId = hasChildren ? `tree-toggle-${n.pid}` : null;
    const childrenId = hasChildren ? `tree-children-${n.pid}` : null;
    const rssMB = (n.rssKB / 1024).toFixed(1);
    const cpuClass = n.cpuPercent > 50 ? 'high' : '';

    return `
      <div class="tree-node" style="margin-left: ${indent}px;">
        <div class="tree-node-row">
          ${hasChildren ? `<button class="tree-toggle" id="${toggleId}" onclick="toggleTreeNode(${n.pid})">▼</button>` : '<span class="tree-spacer"></span>'}
          <span class="tree-name" title="PID ${n.pid}">${n.name}</span>
          <span class="tree-pid">${n.pid}</span>
          <span class="tree-cpu ${cpuClass}">${n.cpuPercent.toFixed(1)}%</span>
          <span class="tree-mem">${rssMB} MB</span>
        </div>
        ${hasChildren ? `<div class="tree-children" id="${childrenId}">${renderProcessTreeHtml(n.children, level + 1)}</div>` : ''}
      </div>
    `;
  }).join('');
}

function toggleTreeNode(pid) {
  const children = document.getElementById(`tree-children-${pid}`);
  const toggle = document.getElementById(`tree-toggle-${pid}`);
  if (!children || !toggle) return;
  const isHidden = children.style.display === 'none';
  children.style.display = isHidden ? 'block' : 'none';
  toggle.textContent = isHidden ? '▼' : '▶';
}

// ─── Overview Tab (existing functionality) ───
async function loadDbSize() {
  try {
    const res = await fetch(`${API_BASE}/api/db-size`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    document.getElementById('dbSizeBadge').textContent = `🗄 ${data.sizeMB} MB`;
  } catch (err) {
    console.error('DB size fetch error:', err);
    document.getElementById('dbSizeBadge').textContent = '🗄 --';
  }
}

async function loadServerInfo() {
  try {
    const res = await fetch(`${API_BASE}/api/server-info`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    document.getElementById('uptimeBadge').textContent = `⏱ ${data.uptimeStr}`;
  } catch (err) {
    console.error('Server info fetch error:', err);
    document.getElementById('uptimeBadge').textContent = '⏱ --';
  }
}

async function fetchData() {
  try {
    const res = await fetch(`${API_BASE}/api/snapshot`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    updateDashboard(data);
    document.getElementById('liveDot').style.background = 'var(--accent-ok)';
    document.getElementById('liveText').textContent = 'Live \u2022 Updated just now';
  } catch (err) {
    console.error('Fetch error:', err);
    document.getElementById('liveDot').style.background = 'var(--accent-drain)';
    document.getElementById('liveText').textContent = 'Offline \u2022 ' + err.message;
  }
}

function updateDashboard(data) {
  const battery = data.battery;
  document.getElementById('batteryValue').innerHTML = `${Math.round(battery.percent)}<span>%</span>`;
  document.getElementById('batteryFill').style.width = `${battery.percent}%`;

  let statusText = 'On battery';
  if (battery.isCharging) statusText = 'Charging';
  else if (battery.isPlugged) statusText = 'Plugged In';
  document.getElementById('batteryStatus').textContent = statusText;

  const cycles = battery.cycleCount != null ? battery.cycleCount : '--';
  let timeRem = '--';
  if (battery.isPlugged) timeRem = 'AC power';
  else if (battery.timeRemaining != null && battery.timeRemaining >= 0 && battery.timeRemaining < 10000) {
    timeRem = Math.round(battery.timeRemaining / 60) + 'h remaining';
  }
  document.getElementById('batteryDetail').textContent = `${cycles} cycles \u2022 ${timeRem}`;

  const cpuTotal = data.cpuTotal || 0;
  document.getElementById('cpuValue').innerHTML = `${cpuTotal.toFixed(1)}<span>%</span>`;

  const topCpu = data.processes[0];
  const cpuTrend = document.getElementById('cpuTrend');
  if (cpuTotal > 80) {
    cpuTrend.className = 'kpi-trend down';
    cpuTrend.innerHTML = `<span>\u25b2</span> <span id="cpuTrendText">${topCpu?.name || 'High'} spiking</span>`;
  } else {
    cpuTrend.className = 'kpi-trend up';
    cpuTrend.innerHTML = `<span>\u2713</span> <span id="cpuTrendText">Normal load</span>`;
  }
  document.getElementById('cpuDetail').textContent = `${data.processes.length} processes tracked`;

  const memGB = data.memoryTotal ? (data.memoryTotal / 100 * 8).toFixed(1) : '--';
  document.getElementById('memValue').innerHTML = `${memGB}<span>GB</span>`;
  document.getElementById('memPercent').textContent = data.memoryTotal ? `${data.memoryTotal.toFixed(1)}% used` : '--';
  document.getElementById('memDetail').textContent = 'of 8.2 GB total';

  const statusValue = document.getElementById('statusValue');
  const statusTrend = document.getElementById('statusTrend');

  if (battery.isCharging) {
    statusValue.textContent = 'Charging';
    statusTrend.className = 'kpi-trend up';
    statusTrend.innerHTML = '<span>\u26a1</span> <span id="statusTrendText">Power connected</span>';
  } else if (battery.isPlugged) {
    statusValue.textContent = 'Plugged In';
    statusTrend.className = 'kpi-trend up';
    statusTrend.innerHTML = '<span>\u2713</span> <span id="statusTrendText">AC power</span>';
  } else if (battery.percent < 20) {
    statusValue.textContent = 'Low Battery';
    statusTrend.className = 'kpi-trend down';
    statusTrend.innerHTML = '<span>!</span> <span id="statusTrendText">Charge soon</span>';
  } else {
    statusValue.textContent = 'Normal';
    statusTrend.className = 'kpi-trend up';
    statusTrend.innerHTML = '<span>\u2713</span> <span id="statusTrendText">No drain detected</span>';
  }
  document.getElementById('statusDetail').textContent = new Date(data.timestamp).toLocaleTimeString();

  // Disk KPI
  const diskPercent = data.fsUsedPercent ?? 0;
  document.getElementById('diskValue').innerHTML = `${diskPercent.toFixed(1)}<span>%</span>`;
  document.getElementById('diskDetail').textContent = diskPercent > 90 ? 'Critical usage' : diskPercent > 80 ? 'High usage' : 'Normal';

  // Network KPI — live rates computed from delta with previous snapshot
  let netRxRate = 0, netTxRate = 0;
  if (previousSnapshot && data.timestamp && previousSnapshot.timestamp) {
    const dt = (data.timestamp - previousSnapshot.timestamp) / 1000;
    if (dt > 0) {
      netRxRate = Math.max(0, ((data.netRxBytes ?? 0) - (previousSnapshot.netRxBytes ?? 0)) / dt / 1024);
      netTxRate = Math.max(0, ((data.netTxBytes ?? 0) - (previousSnapshot.netTxBytes ?? 0)) / dt / 1024);
    }
  }
  lastNetworkRates = { rx: netRxRate, tx: netTxRate };

  const fmtRate = v => {
    if (v >= 1024) return (v / 1024).toFixed(2) + ' MB/s';
    if (v < 1) return (v * 1024).toFixed(0) + ' B/s';
    return v.toFixed(1) + ' KB/s';
  };
  document.getElementById('netValue').textContent = fmtRate(netRxRate + netTxRate);
  document.getElementById('netDetail').textContent = `↓ ${fmtRate(netRxRate)} • ↑ ${fmtRate(netTxRate)}`;

  previousSnapshot = data;

  currentProcesses = data.processes || [];
  renderProcesses();
}

function sortByColumn(column) {
  if (currentSort.column === column) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.column = column;
    currentSort.direction = 'desc';
  }
  renderProcesses();
  updateSortIndicators();
}

function updateSortIndicators() {
  const headers = document.querySelectorAll('.process-table th');
  const colNames = ['Process', 'PID', 'CPU', 'Memory'];
  headers.forEach((th, idx) => {
    const colKey = ['process', 'pid', 'cpu', 'memory'][idx];
    const baseText = colNames[idx];
    if (colKey === currentSort.column) {
      th.textContent = baseText + (currentSort.direction === 'asc' ? ' \u2191' : ' \u2193');
    } else {
      th.textContent = baseText;
    }
  });
}

function renderProcesses() {
  const tbody = document.getElementById('processTable');
  let toRender = [...currentProcesses];

  if (activeProfileFilter) {
    toRender = toRender.filter(p =>
      activeProfileFilter.names.some(n => p.name.toLowerCase().includes(n))
    );
    if (!toRender.length) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-dim); padding: 20px;">No matching processes currently running</td></tr>`;
      updateSortIndicators();
      return;
    }
  }

  const sorted = toRender.sort((a, b) => {
    let valA, valB;
    switch (currentSort.column) {
      case 'process': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
      case 'pid': valA = a.pid; valB = b.pid; break;
      case 'cpu': valA = a.cpuPercent; valB = b.cpuPercent; break;
      case 'memory': valA = a.memoryPercent; valB = b.memoryPercent; break;
      default: valA = a.cpuPercent; valB = b.cpuPercent;
    }
    if (currentSort.direction === 'asc') return valA > valB ? 1 : -1;
    return valA < valB ? 1 : -1;
  }).slice(0, 10);

  tbody.innerHTML = sorted.map(p => `
    <tr onclick="showProcessModal('${p.name.replace(/'/g, "\\'")}')" style="cursor: pointer;">
      <td>
        <div class="process-name">
          <div class="process-icon">\u25c6</div>
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
  updateSortIndicators();
}

// ─── Chart Tabs ───
function switchChartTab(tab) {
  currentChartTab = tab;
  document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.chart-tab[data-tab="${tab}"]`).classList.add('active');
  renderLineChart(chartHistoryData);
}

async function loadHistory(minutes, clickedBtn) {
  chartTimeRange = minutes;
  try {
    const res = await fetch(`${API_BASE}/api/history?minutes=${minutes}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    chartHistoryData = data;
    renderLineChart(data);

    const buttons = document.querySelectorAll('.panel-actions .panel-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    if (clickedBtn) clickedBtn.classList.add('active');
  } catch (err) {
    console.error('History fetch error:', err);
    document.getElementById('historyChart').innerHTML =
      `<text x="50" y="50" fill="var(--text-dim)" font-size="3" text-anchor="middle">Error: ${err.message}</text>`;
  }
}

function renderLineChart(data) {
  const svg = document.getElementById('historyChart');
  const xAxis = document.getElementById('chartXAxis');
  const yAxis = document.getElementById('chartYAxis');

  if (!data.length) {
    svg.innerHTML = '<text x="50" y="50" fill="var(--text-dim)" font-size="3" text-anchor="middle">No data</text>';
    if (xAxis) xAxis.innerHTML = '';
    return;
  }

  // Precompute disk/network rates from cumulative counters
  const enrichedData = data.map((d, i) => {
    if (i === 0) return { ...d, disk_rate: 0, network_rate: 0 };
    const prev = data[i - 1];
    const dt = (d.timestamp - prev.timestamp) / 1000;
    if (dt <= 0) return { ...d, disk_rate: 0, network_rate: 0 };

    const diskDelta = Math.max(0, (d.disk_total_io ?? 0) - (prev.disk_total_io ?? 0));
    const netRxDelta = Math.max(0, (d.net_rx_bytes ?? 0) - (prev.net_rx_bytes ?? 0));
    const netTxDelta = Math.max(0, (d.net_tx_bytes ?? 0) - (prev.net_tx_bytes ?? 0));

    return {
      ...d,
      disk_rate: diskDelta / dt,
      network_rate: (netRxDelta + netTxDelta) / dt / 1024, // KB/s
    };
  });

  let metricKey, maxVal, yLabels, accentColor, accentVar, valueFormatter;
  switch (currentChartTab) {
    case 'cpu':
      metricKey = 'cpu_total';
      maxVal = 100;
      yLabels = ['100%', '75%', '50%', '25%', '0%'];
      accentColor = 'var(--accent-cpu)';
      accentVar = '--accent-cpu';
      valueFormatter = v => v.toFixed(1) + '%';
      break;
    case 'memory':
      metricKey = 'memory_total';
      maxVal = 100;
      yLabels = ['100%', '75%', '50%', '25%', '0%'];
      accentColor = 'var(--accent-mem)';
      accentVar = '--accent-mem';
      valueFormatter = v => v.toFixed(1) + '%';
      break;
    case 'disk':
      metricKey = 'disk_rate';
      maxVal = Math.max(1, ...enrichedData.map(d => d.disk_rate || 0));
      {
        const fmt = v => v < 10 ? v.toFixed(1) : v.toFixed(0);
        yLabels = [fmt(maxVal), fmt(maxVal * 0.75), fmt(maxVal * 0.5), fmt(maxVal * 0.25), '0'];
      }
      accentColor = 'var(--accent-disk)';
      accentVar = '--accent-disk';
      valueFormatter = v => v.toFixed(v < 10 ? 1 : 0) + ' IO/s';
      break;
    case 'network':
      metricKey = 'network_rate';
      maxVal = Math.max(1, ...enrichedData.map(d => d.network_rate || 0));
      {
        // network_rate is in KB/s; adapt unit label
        let unit = 'KB/s', scale = 1;
        if (maxVal >= 1024) { unit = 'MB/s'; scale = 1024; }
        else if (maxVal < 1) { unit = 'B/s'; scale = 1/1024; }
        const fmt = v => {
          const scaled = v / scale;
          return scaled < 10 ? scaled.toFixed(1) : scaled.toFixed(0);
        };
        yLabels = [fmt(maxVal) + unit, fmt(maxVal * 0.75) + unit, fmt(maxVal * 0.5) + unit, fmt(maxVal * 0.25) + unit, '0'];
      }
      accentColor = 'var(--accent-network)';
      accentVar = '--accent-network';
      valueFormatter = v => {
        if (v >= 1024) return (v / 1024).toFixed(2) + ' MB/s';
        if (v < 1) return (v * 1024).toFixed(0) + ' B/s';
        return v.toFixed(1) + ' KB/s';
      };
      break;
    default:
      metricKey = 'battery_percent';
      maxVal = 100;
      yLabels = ['100%', '75%', '50%', '25%', '0%'];
      accentColor = 'var(--accent-battery)';
      accentVar = '--accent-battery';
      valueFormatter = v => v.toFixed(1) + '%';
  }

  if (yAxis) yAxis.innerHTML = yLabels.map(l => `<span>${l}</span>`).join('');

  const n = enrichedData.length;
  const padding = { top: 2, bottom: 2, left: 0, right: 0 };
  const chartW = 100 - padding.left - padding.right;
  const chartH = 100 - padding.top - padding.bottom;

  const points = enrichedData.map((d, i) => {
    const val = d[metricKey] ?? 0;
    const x = padding.left + (i / (n - 1 || 1)) * chartW;
    const y = padding.top + chartH - ((val / maxVal) * chartH);
    return { x, y, val, ts: d.timestamp };
  });

  const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const areaD = `${lineD} L ${points[points.length - 1].x.toFixed(2)} ${padding.top + chartH} L ${points[0].x.toFixed(2)} ${padding.top + chartH} Z`;

  const maxDots = 15;
  const sampleStep = Math.max(1, Math.floor(points.length / maxDots));
  const sampledPoints = points.filter((_, i) => i % sampleStep === 0 || i === points.length - 1);
  const uniquePoints = sampledPoints.filter((p, i, arr) => i === 0 || p.x !== arr[i-1].x);

  const pointsHtml = uniquePoints.map(p => `
    <circle class="chart-point" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="0.8"
      fill="${accentColor}"
      data-value="${p.val.toFixed(1)}" data-time="${new Date(p.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}"/>
  `).join('');

  const gradientStops = svg.querySelectorAll('#lineGradient stop');
  if (gradientStops.length >= 2) {
    gradientStops[0].setAttribute('stop-color', `var(${accentVar})`);
    gradientStops[1].setAttribute('stop-color', `var(${accentVar})`);
  }

  const lineEl = document.getElementById('chartLine');
  const areaEl = document.getElementById('chartAreaFill');
  const pointsEl = document.getElementById('chartPoints');

  lineEl.setAttribute('d', lineD);
  lineEl.setAttribute('stroke', accentColor);
  lineEl.setAttribute('stroke-width', '1.2');
  areaEl.setAttribute('d', areaD);
  pointsEl.innerHTML = pointsHtml;

  pointsEl.querySelectorAll('.chart-point').forEach(pt => {
    pt.addEventListener('mouseenter', (e) => showChartTooltip(e, pt.dataset.value, pt.dataset.time));
    pt.addEventListener('mouseleave', hideChartTooltip);
  });

  if (xAxis) {
    const first = enrichedData[0];
    const last = enrichedData[enrichedData.length - 1];
    const mid = enrichedData[Math.floor(enrichedData.length / 2)];
    const fmt = (d) => new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    xAxis.innerHTML = `<span>${fmt(first)}</span><span>${fmt(mid)}</span><span>${fmt(last)}</span>`;
  }
}

let chartTooltipEl = null;
function showChartTooltip(e, value, time) {
  if (!chartTooltipEl) {
    chartTooltipEl = document.createElement('div');
    chartTooltipEl.className = 'chart-tooltip';
    document.body.appendChild(chartTooltipEl);
  }
  const labelMap = { battery: 'Battery', cpu: 'CPU', memory: 'Memory', disk: 'Disk', network: 'Network' };
  const label = labelMap[currentChartTab] || 'Value';
  const numVal = parseFloat(value);
  let formatted = value;
  if (currentChartTab === 'battery' || currentChartTab === 'cpu' || currentChartTab === 'memory') formatted = numVal.toFixed(1) + '%';
  else if (currentChartTab === 'disk') formatted = numVal.toFixed(0) + ' IO/s';
  else if (currentChartTab === 'network') formatted = numVal.toFixed(1) + ' KB/s';
  chartTooltipEl.innerHTML = `<strong>${formatted}</strong> ${label}<br><span style="color:var(--text-dim)">${time}</span>`;
  const rect = e.target.getBoundingClientRect();
  chartTooltipEl.style.left = (rect.left + rect.width / 2 - chartTooltipEl.offsetWidth / 2) + 'px';
  chartTooltipEl.style.top = (rect.top - chartTooltipEl.offsetHeight - 8) + 'px';
  chartTooltipEl.classList.add('visible');
}
function hideChartTooltip() {
  if (chartTooltipEl) chartTooltipEl.classList.remove('visible');
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
          <h4>\u26a1 Rapid Drain Detected</h4>
          <p>${start} \u2014 ${end}</p>
        </div>
        <div class="drain-meta">
          <div class="drain-rate">${e.drainRate.toFixed(1)}<span>%/min</span></div>
          <div class="drain-processes">${procs}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Process Detail Modal
let currentModalProcess = null;

function showProcessModal(processName) {
  currentModalProcess = processName;
  document.getElementById('modalTitle').textContent = processName;
  document.getElementById('processModal').style.display = 'flex';
  loadProcessHistory(30);
}

function closeProcessModal() {
  document.getElementById('processModal').style.display = 'none';
  currentModalProcess = null;
}

async function loadProcessHistory(minutes) {
  if (!currentModalProcess) return;

  const buttons = document.querySelectorAll('.modal-time-range .panel-btn');
  buttons.forEach(btn => btn.classList.remove('active'));
  const activeBtn = Array.from(buttons).find(b => b.textContent === (minutes < 60 ? minutes + 'm' : (minutes / 60) + 'h'));
  if (activeBtn) activeBtn.classList.add('active');

  try {
    const [historyRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/api/process-history?name=${encodeURIComponent(currentModalProcess)}&minutes=${minutes}`),
      fetch(`${API_BASE}/api/process-stats?name=${encodeURIComponent(currentModalProcess)}&minutes=${minutes}`)
    ]);

    const history = await historyRes.json();
    const stats = await statsRes.json();

    renderModalStats(stats);
    renderModalChart(history);
  } catch (err) {
    console.error('Process history error:', err);
    document.getElementById('modalStats').innerHTML = `<div style="color: var(--text-dim);">Error loading data</div>`;
  }
}

function renderModalStats(stats) {
  const s = stats.stats || {};
  const html = `
    <div class="modal-stat">
      <div class="modal-stat-value">${(s.avg_cpu || 0).toFixed(1)}%</div>
      <div class="modal-stat-label">Avg CPU</div>
    </div>
    <div class="modal-stat">
      <div class="modal-stat-value">${(s.peak_cpu || 0).toFixed(1)}%</div>
      <div class="modal-stat-label">Peak CPU</div>
    </div>
    <div class="modal-stat">
      <div class="modal-stat-value">${stats.sampleCount || 0}</div>
      <div class="modal-stat-label">Samples</div>
    </div>
  `;
  document.getElementById('modalStats').innerHTML = html;
}

function renderModalChart(history) {
  const container = document.getElementById('modalChart');
  if (!history.length) {
    container.innerHTML = '<div style="color: var(--text-dim); font-size: 13px;">No data</div>';
    return;
  }

  const maxCpu = Math.max(...history.map(h => h.cpu_percent), 1);
  const bars = history.map(h => {
    const height = (h.cpu_percent / maxCpu) * 100;
    const time = new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="modal-chart-bar" style="height: ${height}%;" title="${h.cpu_percent.toFixed(1)}% @ ${time}"></div>`;
  }).join('');

  container.innerHTML = bars;
}

// Monitoring Profiles
let profiles = [];
let editingProfileId = null;
let activeProfileFilter = null;

async function loadProfiles() {
  try {
    const res = await fetch(`${API_BASE}/api/profiles`);
    profiles = await res.json();
    renderProfiles();
  } catch (err) {
    console.error('Profile load error:', err);
    document.getElementById('profileList').innerHTML =
      `<div style="padding: 20px; color: var(--text-dim); text-align: center;">Failed to load profiles</div>`;
  }
}

function renderProfiles() {
  const container = document.getElementById('profileList');
  if (!profiles.length) {
    container.innerHTML = `<div style="padding: 20px; color: var(--text-dim); text-align: center;">No profiles yet. Click "+ New Profile" to create one.</div>`;
    return;
  }

  container.innerHTML = profiles.map(p => {
    const processTags = p.processes.map(proc =>
      `<span class="profile-process-tag">${proc.name}</span>`
    ).join('');

    return `
      <div class="profile-card" style="--profile-color: ${p.color}" onclick="viewProfile('${p.id}')">
        <div class="profile-card-header">
          <span class="profile-card-name">${p.name}</span>
          <span class="profile-card-status">${p.processes.length} processes</span>
        </div>
        <div class="profile-card-processes">${processTags}</div>
        <div class="profile-actions">
          <button class="panel-btn" onclick="event.stopPropagation(); editProfile('${p.id}')">Edit</button>
          <button class="panel-btn" onclick="event.stopPropagation(); deleteProfile('${p.id}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function showProfileModal(profileId = null) {
  editingProfileId = profileId;
  const profile = profileId ? profiles.find(p => p.id === profileId) : null;

  document.getElementById('profileModalTitle').textContent = profile ? 'Edit Profile' : 'New Profile';
  document.getElementById('profileName').value = profile?.name || '';
  document.getElementById('profileColor').value = profile?.color || '#3b82f6';

  const processesContainer = document.getElementById('profileProcesses');
  processesContainer.innerHTML = '';

  if (profile?.processes?.length) {
    profile.processes.forEach(proc => addProcessField(proc.name, proc.cpuThreshold, proc.memThreshold));
  } else {
    addProcessField();
  }

  document.getElementById('profileModal').style.display = 'flex';
}

function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
  editingProfileId = null;
}

function addProcessField(name = '', cpuThreshold = '', memThreshold = '') {
  const container = document.getElementById('profileProcesses');
  const div = document.createElement('div');
  div.className = 'process-field';
  const cpuVal = cpuThreshold != null ? cpuThreshold : '';
  const memVal = memThreshold != null ? memThreshold : '';
  div.innerHTML = `
    <input type="text" placeholder="Process name" value="${name}" class="proc-name">
    <input type="number" placeholder="CPU %" value="${cpuVal}" class="field-small proc-cpu" title="CPU threshold %">
    <input type="number" placeholder="Mem MB" value="${memVal}" class="field-small proc-mem" title="Memory threshold MB">
    <button onclick="this.parentElement.remove()">\u00d7</button>
  `;
  container.appendChild(div);
}

async function saveProfile() {
  const name = document.getElementById('profileName').value.trim();
  const color = document.getElementById('profileColor').value;

  if (!name) { alert('Please enter a profile name'); return; }

  const processFields = document.querySelectorAll('.process-field');
  const processes = Array.from(processFields).map(field => ({
    name: field.querySelector('.proc-name').value.trim(),
    cpuThreshold: parseFloat(field.querySelector('.proc-cpu').value) || null,
    memThreshold: parseFloat(field.querySelector('.proc-mem').value) || null,
  })).filter(p => p.name);

  if (!processes.length) { alert('Please add at least one process'); return; }

  const profile = {
    id: editingProfileId || 'profile_' + Date.now(),
    name, color, processes,
  };

  try {
    const res = await fetch(`${API_BASE}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });

    if (res.ok) { closeProfileModal(); loadProfiles(); }
    else { alert('Failed to save profile'); }
  } catch (err) {
    console.error('Save profile error:', err);
    alert('Failed to save profile: ' + err.message);
  }
}

async function deleteProfile(id) {
  if (!confirm('Delete this profile?')) return;
  try {
    const res = await fetch(`${API_BASE}/api/profiles?id=${id}`, { method: 'DELETE' });
    if (res.ok) loadProfiles();
  } catch (err) { console.error('Delete profile error:', err); }
}

function editProfile(id) { showProfileModal(id); }

function viewProfile(id) {
  const profile = profiles.find(p => p.id === id);
  if (!profile) return;

  const names = profile.processes.map(p => p.name.toLowerCase());
  activeProfileFilter = { id, names };
  renderProcesses();

  const actions = document.getElementById('processPanelActions');
  if (actions && !actions.querySelector('.show-all-btn')) {
    const btn = document.createElement('button');
    btn.className = 'panel-btn show-all-btn';
    btn.textContent = 'Show All';
    btn.onclick = () => {
      activeProfileFilter = null;
      const existingBtn = actions.querySelector('.show-all-btn');
      if (existingBtn) existingBtn.remove();
      renderProcesses();
    };
    actions.appendChild(btn);
  }
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
        e.startPercent, e.endPercent,
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

// Settings
async function loadSettings() {
  try {
    const res = await fetch(`${API_BASE}/api/db-stats`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    document.getElementById('settingsDbSize').textContent = `${data.dbSizeMB} MB`;
    document.getElementById('settingsSnapshots').textContent = data.totalSnapshots.toLocaleString();
    document.getElementById('settingsOldest').textContent = data.oldestSnapshot
      ? new Date(data.oldestSnapshot).toLocaleDateString()
      : 'N/A';
  } catch (err) { console.error('Settings load error:', err); }
}

function confirmCleanup() {
  const days = document.getElementById('retentionDays').value;
  if (!confirm(`Delete all data older than ${days} days? This cannot be undone.`)) return;
  runCleanup();
}

async function restartMonitor() {
  if (!confirm('Restart the monitor process? The dashboard will briefly lose connection.')) return;
  try {
    const res = await fetch(`${API_BASE}/api/restart`, { method: 'POST' });
    const data = await res.json();
    alert(data.message || 'Monitor restart initiated');
  } catch (err) {
    alert('Restart signal sent. Monitor should restart shortly.');
  }
}

async function runCleanup() {
  const btn = document.getElementById('cleanupBtn');
  const result = document.getElementById('cleanupResult');
  const days = parseInt(document.getElementById('retentionDays').value) || 30;

  btn.disabled = true; btn.textContent = 'Cleaning...'; result.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/api/cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays: days }),
    });
    const data = await res.json();
    if (data.success) {
      result.className = 'settings-result';
      result.textContent = `✅ Cleaned! Freed ${data.freedMB} MB. Remaining: ${data.remainingSnapshots} snapshots (${data.remainingMB} MB)`;
      loadSettings(); loadDbSize();
    } else { throw new Error(data.error || 'Cleanup failed'); }
  } catch (err) {
    result.className = 'settings-result error';
    result.textContent = `❌ Error: ${err.message}`;
  } finally {
    result.style.display = 'block';
    btn.disabled = false; btn.textContent = '🗑 Clean Old Data';
  }
}

function saveRefreshInterval() {
  const seconds = parseInt(document.getElementById('refreshIntervalInput').value) || 5;
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(() => {
    fetchData(); loadDrainEvents(); loadDbSize(); loadServerInfo();
  }, seconds * 1000);
  alert(`Refresh interval set to ${seconds} seconds`);
}

async function loadMonitorConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const config = await res.json();
    document.getElementById('retentionDays').value = config.retentionDays || 30;
    document.getElementById('retentionSizeMB').value = config.retentionSizeMB || 400;
    document.getElementById('sampleInterval').value = config.sampleIntervalSeconds || 30;
    document.getElementById('logBattery').checked = config.logBattery !== false;
    document.getElementById('logProcesses').checked = config.logProcesses !== false;
    document.getElementById('logSpikes').checked = config.logSpikes !== false;
    document.getElementById('logBatteryImpact').checked = config.logBatteryImpact !== false;
    document.getElementById('drainThreshold').value = config.alert?.drainThreshold ?? 0.5;
    document.getElementById('minDuration').value = config.alert?.minDuration ?? 1;
    document.getElementById('cooldownMinutes').value = config.alert?.cooldownMinutes ?? 5;
  } catch (err) { console.error('Config load error:', err); }
}

async function saveMonitorConfig(silent = false) {
  if (!silent) {
    const btn = document.querySelector('#settingsPanel .panel-btn.primary');
    if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }
  }

  try {
    const config = {
      retentionDays: parseInt(document.getElementById('retentionDays').value) || 30,
      retentionSizeMB: parseInt(document.getElementById('retentionSizeMB').value) || 400,
      sampleIntervalSeconds: parseInt(document.getElementById('sampleInterval').value) || 30,
      logBattery: document.getElementById('logBattery').checked,
      logProcesses: document.getElementById('logProcesses').checked,
      logSpikes: document.getElementById('logSpikes').checked,
      logBatteryImpact: document.getElementById('logBatteryImpact').checked,
      alert: {
        enabled: true,
        drainThreshold: parseFloat(document.getElementById('drainThreshold').value) || 0.5,
        minDuration: parseInt(document.getElementById('minDuration').value) || 1,
        cooldownMinutes: parseInt(document.getElementById('cooldownMinutes').value) || 5,
      }
    };

    const res = await fetch(`${API_BASE}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });

    const data = await res.json();
    if (data.success) {
      if (!silent) {
        document.getElementById('restartNotice').style.display = 'block';
        setTimeout(() => { document.getElementById('restartNotice').style.display = 'none'; }, 30000);
      }
      showAutoSaveIndicator();
    } else { throw new Error(data.error || 'Save failed'); }
  } catch (err) {
    if (!silent) alert('Failed to save config: ' + err.message);
    console.error('Auto-save error:', err);
  } finally {
    if (!silent) {
      const btn = document.querySelector('#settingsPanel .panel-btn.primary');
      if (btn) { btn.textContent = '💾 Save Config'; btn.disabled = false; }
    }
  }
}

let autoSaveTimeout = null;
let autoSaveIndicatorTimeout = null;
function showAutoSaveIndicator() {
  let indicator = document.getElementById('autoSaveIndicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'autoSaveIndicator';
    indicator.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--accent-ok);color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:500;opacity:0;transition:opacity 0.3s;pointer-events:none;z-index:1000;';
    indicator.textContent = '💾 Saved';
    document.body.appendChild(indicator);
  }
  indicator.style.opacity = '1';
  if (autoSaveIndicatorTimeout) clearTimeout(autoSaveIndicatorTimeout);
  autoSaveIndicatorTimeout = setTimeout(() => { indicator.style.opacity = '0'; }, 2000);
}

function debouncedAutoSave() {
  if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
  autoSaveTimeout = setTimeout(() => saveMonitorConfig(true), 500);
}

// ─── Reports Tab ───

async function loadReport() {
  const dateInput = document.getElementById('reportDate');
  let date = dateInput.value;
  if (!date) {
    date = 'today';
  }

  const container = document.getElementById('reportContent');
  container.innerHTML = '<div class="analysis-loading">⏳ Generating report...</div>';

  try {
    const res = await fetch(`${API_BASE}/api/report?date=${encodeURIComponent(date)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const markdown = await res.text();
    renderReport(markdown, container);
  } catch (err) {
    container.innerHTML = `<div class="analysis-error">❌ Error: ${err.message}</div>`;
  }
}

function renderReport(markdown, container) {
  // Simple markdown-to-HTML converter for report display
  let html = markdown
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\|.*\|/g, (line) => {
      // Table row
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        if (cells.every(c => /^[-:]+$/.test(c))) return ''; // separator row
        return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
      }
      return line;
    })
    .replace(/\n/g, '<br>');

  // Wrap table rows in table tags
  html = html.replace(/(<tr>.*?<\/tr>)+/g, '<table class="analysis-table">$&</table>');

  // Clean up empty paragraphs
  html = html.replace(/<br><br>/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>');
  html = html.replace(/<p><table/g, '<table').replace(/<\/table><\/p>/g, '</table>');
  html = html.replace(/<p><h/g, '<h').replace(/<\/h([12])><\/p>/g, '</h$1>');
  html = html.replace(/<p><br><\/p>/g, '');

  container.innerHTML = `<div class="report-body" style="padding:20px;font-size:14px;line-height:1.6;">${html}</div>`;
}

function initSettingsAutoSave() {
  const inputs = document.querySelectorAll('#settingsTab input[type="number"], #settingsTab input[type="checkbox"]');
  inputs.forEach(input => {
    input.addEventListener('change', debouncedAutoSave);
    if (input.type === 'number') {
      input.addEventListener('input', debouncedAutoSave);
    }
  });
}

// Initialize
function init() {
  fetchData();
  loadHistory(60, document.querySelector('.panel-actions .panel-btn.active'));
  loadDrainEvents();
  loadProfiles();
  loadDbSize();
  loadServerInfo();
  loadSettings();
  loadMonitorConfig();
  initSettingsAutoSave();

  // Set default report date to today
  const dateInput = document.getElementById('reportDate');
  if (dateInput) {
    const today = new Date().toISOString().slice(0, 10);
    dateInput.value = today;
  }

  refreshInterval = setInterval(() => {
    fetchData(); loadDrainEvents(); loadDbSize(); loadServerInfo();
  }, 5000);
}

init();
