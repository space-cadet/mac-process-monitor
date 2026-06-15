/**
 * Main orchestration: data fetching, refresh loop, event wiring.
 */

const REFRESH_MS = 5000;

// DOM refs
const processTable = document.getElementById('process-table');
const processBody = processTable.querySelector('tbody');
const drainTable = document.getElementById('drain-table');
const drainBody = drainTable.querySelector('tbody');
const drainEmpty = document.getElementById('no-drains');
const spikePanel = document.getElementById('spike-panel');
const batteryPanel = document.getElementById('battery-panel');
const profilesContainer = document.getElementById('profiles-container');

// ─── Data Fetch ────────────────────────────────────────────────────

async function loadData() {
  try {
    const [snapshots, processes, drains, stats, spikes, battery] = await Promise.all([
      apiGet('/snapshots', { minutes: 60 }),
      apiGet('/processes', { limit: 30 }),
      apiGet('/drain-events'),
      apiGet('/stats'),
      apiGet('/spikes', { minutes: 60 }),
      apiGet('/battery-impact', { limit: 10 }),
    ]);

    updateMainCharts(snapshots);
    renderProcessTable(processes, processBody, showProcessModal);
    renderDrainTable(drains, drainBody, drainEmpty);
    renderSpikePanel(spikes, spikePanel);
    renderBatteryPanel(battery, batteryPanel);
    updateStatsBar(stats);

    document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error('Dashboard refresh failed:', err);
  }
}

// ─── Process table sorting ───────────────────────────────────────

initSortableProcessTable(processTable, processBody, showProcessModal);

// ─── Profile events ────────────────────────────────────────────────

document.getElementById('btn-new-profile').addEventListener('click', () => showProfileForm());

document.getElementById('profile-form').addEventListener('submit', (e) => {
  e.preventDefault();
  saveProfileFromForm(profilesContainer, (prof) => {
    // Click profile: filter process table to show only profile processes
    const filtered = currentProcesses.filter(p =>
      prof.processes.some(name => p.name.toLowerCase().includes(name.toLowerCase()))
    );
    renderProcessTable(filtered, processBody, showProcessModal);
  });
});

// Load profiles on init
loadProfiles(profilesContainer, (prof) => {
  const filtered = currentProcesses.filter(p =>
    prof.processes.some(name => p.name.toLowerCase().includes(name.toLowerCase()))
  );
  renderProcessTable(filtered, processBody, showProcessModal);
});

// ─── Modal close on backdrop click ─────────────────────────────────

document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
});

// ─── Boot ─────────────────────────────────────────────────────────

initCharts();
loadData();
setInterval(loadData, REFRESH_MS);
