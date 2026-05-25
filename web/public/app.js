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

function sortByColumn(column) {
  // Toggle direction if clicking same column
  if (currentSort.column === column) {
    currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.column = column;
    currentSort.direction = 'desc'; // Default to descending for new column
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
      th.textContent = baseText + (currentSort.direction === 'asc' ? ' ↑' : ' ↓');
    } else {
      th.textContent = baseText;
    }
  });
}

function renderProcesses() {
  const tbody = document.getElementById('processTable');
  const sorted = [...currentProcesses].sort((a, b) => {
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
  updateSortIndicators();
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
  div.innerHTML = `
    <input type="text" placeholder="Process name" value="${name}" class="proc-name">
    <input type="number" placeholder="CPU %" value="${cpuThreshold}" class="field-small proc-cpu" title="CPU threshold %">
    <input type="number" placeholder="Mem MB" value="${memThreshold}" class="field-small proc-mem" title="Memory threshold MB">
    <button onclick="this.parentElement.remove()">×</button>
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
  const filtered = currentProcesses.filter(p =>
    names.some(n => p.name.toLowerCase().includes(n))
  );

  if (filtered.length) {
    currentProcesses = filtered;
    renderProcesses();
    setTimeout(() => {
      const actions = document.querySelector('.panel-actions');
      if (!actions.querySelector('.show-all-btn')) {
        const btn = document.createElement('button');
        btn.className = 'panel-btn show-all-btn';
        btn.textContent = 'Show All';
        btn.onclick = () => { fetchData(); };
        actions.appendChild(btn);
      }
    }, 100);
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

// ─── Process Detail Modal ───
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
  
  // Update button states
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

// ─── Monitoring Profiles ───
let profiles = [];
let editingProfileId = null;

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
  div.innerHTML = `
    <input type="text" placeholder="Process name" value="${name}" class="proc-name">
    <input type="number" placeholder="CPU %" value="${cpuThreshold}" class="field-small proc-cpu" title="CPU threshold %">
    <input type="number" placeholder="Mem MB" value="${memThreshold}" class="field-small proc-mem" title="Memory threshold MB">
    <button onclick="this.parentElement.remove()">×</button>
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
  
  // Filter process table to show only profile processes
  const names = profile.processes.map(p => p.name.toLowerCase());
  const filtered = currentProcesses.filter(p => 
    names.some(n => p.name.toLowerCase().includes(n))
  );
  
  if (filtered.length) {
    currentProcesses = filtered;
    renderProcesses();
    // Add a "show all" button
    setTimeout(() => {
      const actions = document.querySelector('.panel-actions');
      if (!actions.querySelector('.show-all-btn')) {
        const btn = document.createElement('button');
        btn.className = 'panel-btn show-all-btn';
        btn.textContent = 'Show All';
        btn.onclick = () => { fetchData(); };
        actions.appendChild(btn);
      }
    }, 100);
  }
}

// Initialize
function init() {
  fetchData();
  loadHistory(60, document.querySelector('.panel-actions .panel-btn.active'));
  loadDrainEvents();
  loadProfiles();
  
  refreshInterval = setInterval(() => {
    fetchData();
    loadDrainEvents();
  }, 5000);
}

init();