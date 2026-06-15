/**
 * Table rendering, sortable columns, process modal, spike panel, battery panel.
 */

let currentProcesses = [];
let currentSpikes = [];
let currentBattery = [];

// ─── Process Table ────────────────────────────────────────────────

function renderProcessTable(processes, tableBody, onProcessClick) {
  currentProcesses = processes;
  clearEl(tableBody);

  for (const p of processes) {
    const tr = createEl('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => onProcessClick(p.name));

    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${p.pid}</td>
      <td class="num">${fmtNum(p.cpu_percent, 1)}</td>
      <td class="num">${fmtNum(p.cpu_user_percent, 1)}</td>
      <td class="num">${fmtNum(p.cpu_system_percent, 1)}</td>
      <td class="num">${fmtNum(p.memory_percent, 1)}</td>
      <td class="num">${fmtNum(p.rss_mb, 0)}</td>
      <td>${p.state || '\u2014'}</td>
      <td>${p.nice ?? '\u2014'}</td>
    `;
    tableBody.appendChild(tr);
  }
}

function initSortableProcessTable(table, tableBody, onProcessClick) {
  makeSortable(table, currentProcesses, (key, direction) => {
    const sorted = sortRows(currentProcesses, key, direction);
    renderProcessTable(sorted, tableBody, onProcessClick);
  });
}

// ─── Process Detail Modal ─────────────────────────────────────────

function showProcessModal(processName) {
  const modal = document.getElementById('process-modal');
  const title = document.getElementById('modal-title');
  const statsBody = document.getElementById('modal-stats');
  const historyBody = document.getElementById('modal-history');

  title.textContent = processName;
  clearEl(statsBody);
  clearEl(historyBody);
  modal.classList.add('active');

  // Fetch stats and history
  apiGet('/process-stats', { process: processName, minutes: 60 })
    .then(stats => {
      if (stats.error) {
        statsBody.innerHTML = `<tr><td colspan="2">${stats.error}</td></tr>`;
        return;
      }
      statsBody.innerHTML = `
        <tr><td>Samples</td><td>${stats.samples}</td></tr>
        <tr><td>Avg CPU</td><td>${fmtNum(stats.avgCpu, 1)}%</td></tr>
        <tr><td>Peak CPU</td><td>${fmtNum(stats.peakCpu, 1)}%</td></tr>
        <tr><td>Avg Memory</td><td>${fmtNum(stats.avgMem, 1)}%</td></tr>
        <tr><td>Peak Memory</td><td>${fmtNum(stats.peakMem, 1)}%</td></tr>
        <tr><td>First Seen</td><td>${fmtDate(stats.firstSeen)}</td></tr>
        <tr><td>Last Seen</td><td>${fmtDate(stats.lastSeen)}</td></tr>
      `;
    })
    .catch(err => {
      statsBody.innerHTML = `<tr><td colspan="2">Error: ${err.message}</td></tr>`;
    });

  apiGet('/process-history', { process: processName, minutes: 60 })
    .then(history => {
      if (history.length === 0) {
        historyBody.innerHTML = '<tr><td colspan="3">No history data</td></tr>';
        return;
      }
      historyBody.innerHTML = history.map(h => `
        <tr>
          <td>${fmtTime(h.timestamp)}</td>
          <td class="num">${fmtNum(h.cpu_percent, 1)}</td>
          <td class="num">${fmtNum(h.memory_percent, 1)}</td>
        </tr>
      `).join('');
      updateProcessHistoryChart(history);
    })
    .catch(err => {
      historyBody.innerHTML = `<tr><td colspan="3">Error: ${err.message}</td></tr>`;
    });
}

function hideProcessModal() {
  document.getElementById('process-modal').classList.remove('active');
}

// ─── Drain Events Table ───────────────────────────────────────────

function renderDrainTable(drains, tbody, emptyMsg) {
  clearEl(tbody);
  if (drains.length === 0) {
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';

  for (const d of drains) {
    const top = d.top_processes?.[0];
    const tr = createEl('tr');
    tr.innerHTML = `
      <td>${fmtDate(d.start_time)}</td>
      <td>${d.start_percent}% \u2192 ${d.end_percent}%</td>
      <td class="num">${fmtNum(d.drain_rate, 2)}%/min</td>
      <td class="num">${fmtNum(d.duration_minutes, 1)} min</td>
      <td>${top ? top.name + ' (' + fmtNum(top.cpu_percent, 1) + '%)' : '\u2014'}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ─── Spike Alert Panel ────────────────────────────────────────────

function renderSpikePanel(spikes, container) {
  currentSpikes = spikes;
  clearEl(container);

  if (spikes.length === 0) {
    container.innerHTML = '<div class="empty">No recent spikes</div>';
    return;
  }

  const recent = spikes.slice(0, 10);
  for (const s of recent) {
    const card = createEl('div', 'spike-card');
    const isCpu = s.metric_type === 'cpu';
    const color = isCpu ? '#f87171' : '#fbbf24';
    card.innerHTML = `
      <div class="spike-icon" style="color:${color}">${isCpu ? '\u26A1' : '\u{1F4CA}'}</div>
      <div class="spike-info">
        <div class="spike-name">${s.process_name} <span class="spike-pid">(PID ${s.pid})</span></div>
        <div class="spike-detail">
          ${s.metric_type.toUpperCase()} spike: <strong>${fmtNum(s.value, 1)}%</strong>
          (baseline: ${fmtNum(s.baseline, 1)}%, threshold: ${fmtNum(s.threshold, 1)}%)
        </div>
        <div class="spike-time">${fmtTime(s.timestamp)}</div>
      </div>
    `;
    card.addEventListener('click', () => showProcessModal(s.process_name));
    container.appendChild(card);
  }
}

// ─── Battery Impact Panel ─────────────────────────────────────────

function renderBatteryPanel(impacts, container) {
  currentBattery = impacts;
  clearEl(container);

  if (impacts.length === 0) {
    container.innerHTML = '<div class="empty">No battery impact data yet. Needs longer runtime.</div>';
    return;
  }

  const maxScore = Math.max(...impacts.map(i => i.total_impact_score || 0), 1);

  for (const imp of impacts) {
    const bar = createEl('div', 'impact-bar');
    const pct = (imp.total_impact_score / maxScore) * 100;
    bar.innerHTML = `
      <div class="impact-label">
        <span class="impact-name">${imp.process_name}</span>
        <span class="impact-score">${fmtNum(imp.total_impact_score, 2)}</span>
      </div>
      <div class="impact-track">
        <div class="impact-fill" style="width:${pct}%"></div>
      </div>
      <div class="impact-meta">
        ${fmtNum(imp.drain_time_minutes, 1)} min drain \u00B7 ${imp.samples_during_drain} samples \u00B7 avg CPU ${fmtNum(imp.avg_cpu_during_drain, 1)}%
      </div>
    `;
    bar.addEventListener('click', () => showProcessModal(imp.process_name));
    container.appendChild(bar);
  }
}

// ─── Stats Bar ────────────────────────────────────────────────────

function updateStatsBar(stats) {
  document.getElementById('db-snapshots').textContent = stats.totalSnapshots ?? '--';
  document.getElementById('db-size').textContent = fmtBytes(stats.dbSizeBytes) ?? '--';
  document.getElementById('db-events').textContent = stats.totalEvents ?? '--';
}
