/**
 * Utility helpers for the dashboard.
 */

function fmtTime(ts) {
  if (!ts) return '\u2014';
  return new Date(ts).toLocaleTimeString();
}

function fmtDate(ts) {
  if (!ts) return '\u2014';
  return new Date(ts).toLocaleString();
}

function fmtNum(n, digits = 1) {
  if (n === null || n === undefined || isNaN(n)) return '\u2014';
  return Number(n).toFixed(digits);
}

function fmtDuration(ms) {
  if (!ms) return '\u2014';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtBytes(bytes) {
  if (!bytes) return '\u2014';
  const kb = bytes / 1024;
  if (kb < 1024) return `${fmtNum(kb, 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${fmtNum(mb, 1)} MB`;
  const gb = mb / 1024;
  return `${fmtNum(gb, 2)} GB`;
}

// ─── Sort utilities ────────────────────────────────────────────────

function sortRows(rows, key, direction) {
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null || av === undefined) return direction === 'asc' ? -1 : 1;
    if (bv === null || bv === undefined) return direction === 'asc' ? 1 : -1;
    if (typeof av === 'string' && typeof bv === 'string') {
      return direction === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return direction === 'asc' ? av - bv : bv - av;
  });
}

function makeSortable(table, rows, onSort) {
  const headers = table.querySelectorAll('th[data-sort]');
  let currentSort = { key: null, direction: 'desc' };

  headers.forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      let direction = 'desc';
      if (currentSort.key === key && currentSort.direction === 'desc') {
        direction = 'asc';
      }
      currentSort = { key, direction };

      // Update arrow indicators
      headers.forEach(h => {
        h.textContent = h.textContent.replace(/ [\u2191\u2193]/g, '');
      });
      th.textContent += direction === 'asc' ? ' \u2191' : ' \u2193';

      onSort(key, direction);
    });
  });

  return currentSort;
}

// ─── DOM helpers ───────────────────────────────────────────────────

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function clearEl(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// ─── API wrapper ───────────────────────────────────────────────────

async function apiGet(path, params = {}) {
  const q = new URLSearchParams(params).toString();
  const url = `/api${path}${q ? '?' + q : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(`/api${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`/api${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}
