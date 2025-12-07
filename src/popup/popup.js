const formatDuration = (ms = 0) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const m = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
};

const el = (id) => document.getElementById(id);

const renderBars = (domains = []) => {
  const container = el('barContainer');
  container.innerHTML = '';

  const max = domains.length
    ? Math.max(...domains.map((d) => d.activeTime || 0))
    : 1;

  domains.forEach((domain) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.width = `${Math.max(10, (domain.activeTime / max) * 100)}%`;
    container.appendChild(bar);
  });
};

const renderTopDomains = (domains = []) => {
  const list = el('topDomains');
  list.innerHTML = '';

  domains.forEach((d) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'domain';
    name.textContent = d.domain;
    const time = document.createElement('span');
    time.textContent = formatDuration(d.activeTime);
    li.appendChild(name);
    li.appendChild(time);
    list.appendChild(li);
  });
};

const loadSummary = async () => {
  const summary = await chrome.runtime.sendMessage({ type: 'get-today-summary' });
  if (!summary) return;

  el('activeTime').textContent = formatDuration(summary.totals.activeTime);
  el('openTime').textContent = formatDuration(summary.totals.openTime);
  el('backgroundTime').textContent = formatDuration(summary.totals.backgroundTime);

  renderBars(summary.topDomains);
  renderTopDomains(summary.topDomains);
};

const syncTrackingState = async () => {
  const currentSettings = await chrome.runtime.sendMessage({ type: 'get-settings' });
  const button = el('toggleTracking');
  button.textContent = currentSettings.trackingEnabled ? 'Pause' : 'Resume';
  el('trackingStatus').textContent = currentSettings.trackingEnabled
    ? 'Tracking is active'
    : 'Tracking is paused';
};

const toggleTracking = async () => {
  const enabled = await chrome.runtime.sendMessage({ type: 'toggle-tracking' });
  el('toggleTracking').textContent = enabled ? 'Pause' : 'Resume';
  el('trackingStatus').textContent = enabled
    ? 'Tracking is active'
    : 'Tracking is paused';
  await loadSummary();
};

const resetData = async () => {
  await chrome.runtime.sendMessage({ type: 'reset-data' });
  await loadSummary();
};

const openDashboard = () => chrome.runtime.openOptionsPage();

document.addEventListener('DOMContentLoaded', async () => {
  await syncTrackingState();
  await loadSummary();

  el('toggleTracking').addEventListener('click', toggleTracking);
  el('resetData').addEventListener('click', resetData);
  el('openDashboard').addEventListener('click', openDashboard);
});

