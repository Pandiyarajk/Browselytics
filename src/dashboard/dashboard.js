import {
  aggregateSessions,
  formatDuration,
  serializeSessionsToCSV,
  toDateKey,
  topDomains,
} from '../utils/timeUtils.js';

let domainChart;
let distributionChart;
let currentSessions = [];
let swWarningEl = null;
let ignoredDomains = [];

const $ = (id) => document.getElementById(id);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const showServiceWorkerWarning = (visible) => {
  if (!swWarningEl) return;
  swWarningEl.classList.toggle('hidden', !visible);
};

const sendMessage = async (payload, { retries = 2, delayMs = 200 } = {}) => {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await chrome.runtime.sendMessage(payload);
      showServiceWorkerWarning(false);
      return response;
    } catch (err) {
      console.warn('Service worker unreachable', err);
      if (attempt < retries) {
        await delay(delayMs);
        continue;
      }
      showServiceWorkerWarning(true);
      return null;
    }
  }
  return null;
};

const todayKey = () => toDateKey(Date.now());

const setTodayRange = () => {
  const today = todayKey();
  $('startDate').value = today;
  $('endDate').value = today;
};

const formatLocalDateTime = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
};

const setDefaultDeleteRange = () => {
  const startInput = $('deleteStart');
  const endInput = $('deleteEnd');
  if (!startInput || !endInput) return;

  const nowDate = new Date();
  const startOfHour = new Date(nowDate);
  startOfHour.setMinutes(0, 0, 0);

  startInput.value = formatLocalDateTime(startOfHour);
  endInput.value = formatLocalDateTime(nowDate);
};

const renderDomainChart = (domains) => {
  const labels = domains.map((d) => d.domain);
  const values = domains.map((d) => Math.round(d.activeTime / 1000 / 60));

  if (domainChart) domainChart.destroy();
  domainChart = new Chart(document.getElementById('domainChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Active minutes',
          data: values,
          backgroundColor: '#22d3ee',
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: { beginAtZero: true },
      },
    },
  });
};

const renderDistribution = (totals) => {
  if (distributionChart) distributionChart.destroy();
  distributionChart = new Chart(document.getElementById('distributionChart'), {
    type: 'doughnut',
    data: {
      labels: ['Active', 'Background'],
      datasets: [
        {
          data: [totals.activeTime, totals.backgroundTime],
          backgroundColor: ['#22d3ee', '#a855f7'],
        },
      ],
    },
    options: {
      plugins: {
        legend: { position: 'bottom' },
      },
    },
  });
};

const renderTable = (sessions) => {
  const tbody = $('sessionsTable').querySelector('tbody');
  tbody.innerHTML = '';

  sessions.forEach((s) => {
    const tr = document.createElement('tr');
    const dateCell = document.createElement('td');
    dateCell.textContent = s.date || '';
    const domainCell = document.createElement('td');
    domainCell.textContent = s.domain || '';
    const activeCell = document.createElement('td');
    activeCell.textContent = formatDuration(s.activeTime);
    const openCell = document.createElement('td');
    openCell.textContent = formatDuration(s.openTime);
    const backgroundCell = document.createElement('td');
    backgroundCell.textContent = formatDuration(s.backgroundTime);
    const interactionCell = document.createElement('td');
    interactionCell.textContent = formatDuration(s.interactionTime);

    tr.appendChild(dateCell);
    tr.appendChild(domainCell);
    tr.appendChild(activeCell);
    tr.appendChild(openCell);
    tr.appendChild(backgroundCell);
    tr.appendChild(interactionCell);
    tbody.appendChild(tr);
  });
};

const renderSummary = (totals) => {
  $('summaryActive').textContent = formatDuration(totals.activeTime);
  $('summaryOpen').textContent = formatDuration(totals.openTime);
  $('summaryBackground').textContent = formatDuration(totals.backgroundTime);
  $('summaryInteraction').textContent = formatDuration(totals.interactionTime);
};

const normalizeDomain = (v) => {
  if (!v) return '';
  const trimmed = v.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).hostname.replace(/^www\./, '').toLowerCase();
  } catch (_) {
    return trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase();
  }
};

const filterIgnored = (sessions) => {
  if (!ignoredDomains.length) return sessions;
  return sessions.filter((s) => {
    const domain = (s.domain || '').toLowerCase();
    if (!domain) return true;
    return !ignoredDomains.some((rule) => domain.endsWith(rule));
  });
};

const loadSessions = async () => {
  const startDate = $('startDate').value || null;
  const endDate = $('endDate').value || null;
  currentSessions = (await sendMessage({
    type: 'get-sessions',
    startDate,
    endDate,
  })) || [];

  currentSessions = filterIgnored(currentSessions);

  const agg = aggregateSessions(currentSessions);
  const domains = topDomains(agg.byDomain, 10);

  renderSummary(agg.totals);
  renderDomainChart(domains);
  renderDistribution(agg.totals);
  renderTable(currentSessions);
};

const exportCsv = () => {
  const csv = serializeSessionsToCSV(currentSessions);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'browselytics.csv';
  link.click();
  URL.revokeObjectURL(url);
};

const exportJson = () => {
  const blob = new Blob([JSON.stringify(currentSessions, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'browselytics.json';
  link.click();
  URL.revokeObjectURL(url);
};

const loadSettings = async () => {
  const settings = await sendMessage({ type: 'get-settings' });
  if (!settings) {
    setSaveStatus('Service worker unreachable; reload extension.', true);
    return;
  }
  ignoredDomains =
    (settings.ignoredSites || []).map((v) => normalizeDomain(v)).filter(Boolean);
  $('ignoredSites').value = (settings.ignoredSites || []).join(', ');
  $('trackingEnabled').checked = settings.trackingEnabled;
  $('interactionTracking').checked = settings.interactionTracking;
  $('hoursStart').value = settings.workingHours?.start || '09:00';
  $('hoursEnd').value = settings.workingHours?.end || '18:00';
};

const setSaveStatus = (text, isError = false) => {
  const el = $('saveStatus');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('status-error', Boolean(isError));
  el.classList.toggle('status-success', Boolean(text) && !isError);
};

const saveSettings = async () => {
  const ignored = $('ignoredSites')
    .value.split(',')
    .map((v) => normalizeDomain(v))
    .filter(Boolean);

  const result = await sendMessage({
    type: 'save-settings',
    settings: {
      ignoredSites: ignored,
      trackingEnabled: $('trackingEnabled').checked,
      interactionTracking: $('interactionTracking').checked,
      workingHours: {
        start: $('hoursStart').value || '09:00',
        end: $('hoursEnd').value || '18:00',
      },
    },
  });
  if (!result) {
    setSaveStatus('Service worker unreachable; reload extension.', true);
    return;
  }
  ignoredDomains = ignored;
  setSaveStatus('Saved', false);
  await loadSessions();
};

const parseDateTime = (inputId) => {
  const value = $(inputId).value;
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
};

const deleteRange = async () => {
  const startMs = parseDateTime('deleteStart');
  const endMs = parseDateTime('deleteEnd');
  await sendMessage({
    type: 'delete-range',
    startMs,
    endMs,
  });
  await loadSessions();
};

const clearToday = async () => {
  const today = todayKey();
  await sendMessage({ type: 'delete-day', dateKey: today });
  await loadSessions();
};

const wirePickers = () => {
  document.querySelectorAll('.picker-trigger').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;
      if (typeof input.showPicker === 'function') {
        input.showPicker();
      } else {
        input.focus();
      }
    });
  });
};

document.addEventListener('DOMContentLoaded', async () => {
  setTodayRange();
  swWarningEl = $('swWarning');
  // Attempt to wake the service worker early
  await sendMessage({ type: 'ping' });
  await loadSettings();
  setDefaultDeleteRange();
  await loadSessions();
  wirePickers();

  $('applyFilters').addEventListener('click', loadSessions);
  $('resetFilters').addEventListener('click', () => {
    setTodayRange();
    loadSessions();
  });
  $('exportCsv').addEventListener('click', exportCsv);
  $('exportJson').addEventListener('click', exportJson);
  $('saveSettings').addEventListener('click', saveSettings);
  $('deleteRange').addEventListener('click', deleteRange);
  $('clearToday').addEventListener('click', clearToday);
});

