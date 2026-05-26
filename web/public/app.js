const API_BASE = '';
let currentProcesses = [];
let currentSort = { column: 'cpu', direction: 'desc' };
let refreshInterval = null;
let currentChartTab = 'battery';
let chartHistoryData = [];
let chartTimeRange = 60;

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
  // Battery
  const battery = data.battery;
  document.getElementById('batteryValue').innerHTML = `${Math.round(battery.percent)}<span>%</span>`;
  document.getElementById('batteryFill').style.width = `${battery.percent}%`;

  // Status text: show "Plugged In" when AC connected but not charging
  let statusText = 'On battery';
  if (battery.isCharging) {
    statusText = 'Charging';
  } else if (battery.isPlugged) {
    statusText = 'Plugged In';
  }
  document.getElementById('batteryStatus').textContent = statusText;

  // Cycle count and time remaining
  const cycles = battery.cycleCount != null ? battery.cycleCount : '--';
  let timeRem = '--';
  if (battery.isPlugged) {
    timeRem = 'AC power';
  } else if (battery.timeRemaining != null && battery.timeRemaining >= 0 && battery.timeRemaining < 10000) {
    timeRem = Math.round(battery.timeRemaining / 60) + 'h remaining';
  }
  document.getElementById('batteryDetail').textContent = `${cycles} cycles \u2022 ${timeRem}`;

  // CPU
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

  // Processes
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

function sortProcesses(by, clickedBtn) {
  currentSort = { column: by, direction: 'desc' };
  renderProcesses();
  const buttons = document.querySelectorAll('.panel-actions .panel-btn');
  buttons.forEach(btn => btn.classList.remove('active'));
  if (clickedBtn) clickedBtn.classList.add('active');
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

  // Determine metric based on active tab
  let metricKey, maxVal, yLabels, accentColor, accentVar;
  switch (currentChartTab) {
    case 'cpu':
      metricKey = 'cpu_total';
      maxVal = 100;
      yLabels = ['100%', '75%', '50%', '25%', '0%'];
      accentColor = 'var(--accent-cpu)';
      accentVar = '--accent-cpu';
      break;
    case 'memory':
      metricKey = 'memory_total';
      maxVal = 100;
      yLabels = ['100%', '75%', '50%', '25%', '0%'];
      accentColor = 'var(--accent-mem)';
      accentVar = '--accent-mem';
      break;
    default: // battery
      metricKey = 'battery_percent';
      maxVal = 100;
      yLabels = ['100%', '75%', '50%', '25%', '0%'];
      accentColor = 'var(--accent-battery)';
      accentVar = '--accent-battery';
  }

  // Update Y-axis labels
  if (yAxis) {
    yAxis.innerHTML = yLabels.map(l => `<span>${l}</span>`).join('');
  }

  // Build points
  const n = data.length;
  const padding = { top: 2, bottom: 2, left: 0, right: 0 };
  const chartW = 100 - padding.left - padding.right;
  const chartH = 100 - padding.top - padding.bottom;

  const points = data.map((d, i) => {
    const val = d[metricKey] ?? d[metricKey.replace('_', '')] ?? 0;
    const x = padding.left + (i / (n - 1 || 1)) * chartW;
    const y = padding.top + chartH - ((val / maxVal) * chartH);
    return { x, y, val, ts: d.timestamp };
  });

  // Line path
  const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

  // Area fill path (close the bottom)
  const areaD = `${lineD} L ${points[points.length - 1].x.toFixed(2)} ${padding.top + chartH} L ${points[0].x.toFixed(2)} ${padding.top + chartH} Z`;

  // Sample points for dots (max ~15, evenly spaced)
  const maxDots = 15;
  const sampleStep = Math.max(1, Math.floor(points.length / maxDots));
  const sampledPoints = points.filter((_, i) => i % sampleStep === 0 || i === points.length - 1);
  // De-duplicate if last point got sampled twice
  const uniquePoints = sampledPoints.filter((p, i, arr) => i === 0 || p.x !== arr[i-1].x);

  const pointsHtml = uniquePoints.map(p => `
    <circle class="chart-point" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="0.8"
      fill="${accentColor}"
      data-value="${p.val.toFixed(1)}" data-time="${new Date(p.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}"/>
  `).join('');

  // Update gradient color
  const gradientStops = svg.querySelectorAll('#lineGradient stop');
  if (gradientStops.length >= 2) {
    gradientStops[0].setAttribute('stop-color', `var(${accentVar})`);
    gradientStops[1].setAttribute('stop-color', `var(${accentVar})`);
  }

  // Update SVG content
  const lineEl = document.getElementById('chartLine');
  const areaEl = document.getElementById('chartAreaFill');
  const pointsEl = document.getElementById('chartPoints');

  lineEl.setAttribute('d', lineD);
  lineEl.setAttribute('stroke', accentColor);
  lineEl.setAttribute('stroke-width', '1.2');
  areaEl.setAttribute('d', areaD);
  pointsEl.innerHTML = pointsHtml;

  // Tooltip on hover
  pointsEl.querySelectorAll('.chart-point').forEach(pt => {
    pt.addEventListener('mouseenter', (e) => showChartTooltip(e, pt.dataset.value, pt.dataset.time));
    pt.addEventListener('mouseleave', hideChartTooltip);
  });

  // X-axis labels
  if (xAxis) {
    const first = data[0];
    const last = data[data.length - 1];
    const mid = data[Math.floor(data.length / 2)];
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
  const label = currentChartTab === 'battery' ? 'Battery' : currentChartTab === 'cpu' ? 'CPU' : 'Memory';
  chartTooltipEl.innerHTML = `<strong>${value}%</strong> ${label}<br><span style="color:var(--text-dim)">${time}</span>`;
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

  if (!name) {
    alert('Please enter a profile name');
    return;
  }

  const processFields = document.querySelectorAll('.process-field');
  const processes = Array.from(processFields).map(field => ({
    name: field.querySelector('.proc-name').value.trim(),
    cpuThreshold: parseFloat(field.querySelector('.proc-cpu').value) || null,
    memThreshold: parseFloat(field.querySelector('.proc-mem').value) || null,
  })).filter(p => p.name);

  if (!processes.length) {
    alert('Please add at least one process');
    return;
  }

  const profile = {
    id: editingProfileId || 'profile_' + Date.now(),
    name,
    color,
    processes,
  };

  try {
    const res = await fetch(`${API_BASE}/api/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });

    if (res.ok) {
      closeProfileModal();
      loadProfiles();
    } else {
      alert('Failed to save profile');
    }
  } catch (err) {
    console.error('Save profile error:', err);
    alert('Failed to save profile: ' + err.message);
  }
}

async function deleteProfile(id) {
  if (!confirm('Delete this profile?')) return;

  try {
    const res = await fetch(`${API_BASE}/api/profiles?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      loadProfiles();
    }
  } catch (err) {
    console.error('Delete profile error:', err);
  }
}

function editProfile(id) {
  showProfileModal(id);
}

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
  loadProfiles();
  loadDbSize();
  loadServerInfo();

  refreshInterval = setInterval(() => {
    fetchData();
    loadDrainEvents();
    loadDbSize();
    loadServerInfo();
  }, 5000);
}

init();
