import {
  aggregateSessions,
  extractDomain,
  now,
  toDateKey,
  topDomains,
} from '../utils/timeUtils.js';
import {
  addSession,
  getSessions,
  getSettings,
  initDB,
  resetAll,
  saveSettings,
  deleteSessionsInRange,
  deleteSessionsByDate,
  deleteSessionsByDomains,
} from '../storage/db.js';

const tabStates = new Map();
let settings = {
  ignoredSites: ['unknown', 'newtab', 'extensions'],
  categories: {},
  trackingEnabled: true,
  workingHours: { start: '09:00', end: '18:00' },
  interactionTracking: true,
};

let activeTabId = null;
let idleState = 'active';
let trackingReady = false;
const INTERACTION_WINDOW_MS = 5000;

const normalizeRuleDomain = (rule = '') => {
  if (!rule) return '';
  if (rule.includes('://')) return extractDomain(rule);
  return rule.replace(/^\*\./, '').trim().toLowerCase();
};

const isIgnored = (url = '') => {
  const domain = extractDomain(url).toLowerCase();
  return (settings.ignoredSites || []).some((rule) => {
    const normalized = normalizeRuleDomain(rule);
    return normalized && domain.endsWith(normalized);
  });
};

const accumulateTime = (state, nextState, timestamp) => {
  const nowTs = timestamp ?? now();
  const delta = nowTs - state.lastChanged;

  if (state.state === 'active') {
    state.activeTime += delta;
  } else {
    state.backgroundTime += delta;
  }

  state.state = nextState;
  state.lastChanged = nowTs;
};

const finalizeSession = async (tabId, reason = 'closed') => {
  const state = tabStates.get(tabId);
  if (!state) return;

  accumulateTime(state, state.state, now());

  const session = {
    url: state.url,
    domain: state.domain,
    date: toDateKey(state.startTime),
    openTime: now() - state.startTime,
    activeTime: state.activeTime,
    backgroundTime: state.backgroundTime,
    interactionTime: state.interactionTime,
    reason,
  };

  tabStates.delete(tabId);
  await addSession(session);
};

const finalizeAllSessions = async (reason = 'flush') => {
  const tasks = [];
  for (const tabId of tabStates.keys()) {
    tasks.push(finalizeSession(tabId, reason));
  }
  await Promise.all(tasks);
  activeTabId = null;
};

const createState = (tab, isActive) => {
  const timestamp = now();
  tabStates.set(tab.id, {
    tabId: tab.id,
    url: tab.url || '',
    domain: extractDomain(tab.url || ''),
    startTime: timestamp,
    lastChanged: timestamp,
    state: isActive ? 'active' : 'background',
    activeTime: 0,
    backgroundTime: 0,
    interactionTime: 0,
  });
};

const ensureState = (tab, isActive) => {
  if (tabStates.has(tab.id)) return tabStates.get(tab.id);
  if (isIgnored(tab.url)) return null;
  createState(tab, isActive);
  return tabStates.get(tab.id);
};

const setActiveTab = async (tabId) => {
  if (!settings.trackingEnabled) return;

  if (activeTabId && activeTabId !== tabId) {
    const prev = tabStates.get(activeTabId);
    if (prev) {
      accumulateTime(prev, 'background', now());
    }
  }

  activeTabId = tabId;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || isIgnored(tab.url)) {
    activeTabId = null;
    return;
  }

  const state = ensureState(tab, true);
  if (state) {
    accumulateTime(state, 'active', now());
  }
};

const handleTabCreated = (tab) => {
  if (!settings.trackingEnabled || isIgnored(tab.url)) return;
  ensureState(tab, tab.active);
};

const handleTabActivated = (activeInfo) =>
  setActiveTab(activeInfo.tabId).catch((err) =>
    console.error('Activation failed', err)
  );

const handleTabUpdated = async (tabId, changeInfo, tab) => {
  if (!settings.trackingEnabled) return;
  if (!changeInfo.url) return;

  const previous = tabStates.get(tabId);
  if (previous) {
    await finalizeSession(tabId, 'navigation');
  }

  if (isIgnored(changeInfo.url)) {
    return;
  }

  createState({ ...tab, url: changeInfo.url }, tab.active);
  if (tab.active) {
    activeTabId = tabId;
  }
};

const handleTabRemoved = async (tabId) => {
  if (!settings.trackingEnabled) {
    tabStates.delete(tabId);
    return;
  }
  await finalizeSession(tabId, 'removed');
  if (activeTabId === tabId) {
    activeTabId = null;
  }
};

const handleWindowFocusChanged = async (windowId) => {
  if (!settings.trackingEnabled) return;

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (activeTabId && tabStates.has(activeTabId)) {
      const prev = tabStates.get(activeTabId);
      accumulateTime(prev, 'background', now());
    }
    activeTabId = null;
    return;
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId,
  });

  if (activeTab) {
    setActiveTab(activeTab.id);
  }
};

const handleIdleStateChanged = (state) => {
  idleState = state;
  if (state === 'active') {
    if (activeTabId) {
      const activeState = tabStates.get(activeTabId);
      if (activeState) accumulateTime(activeState, 'active', now());
    }
    return;
  }

  if (activeTabId) {
    const activeState = tabStates.get(activeTabId);
    if (activeState) accumulateTime(activeState, 'background', now());
    activeTabId = null;
  }
};

const handleInteractionPing = (tabId) => {
  if (!settings.interactionTracking) return;
  const state = tabStates.get(tabId);
  if (!state) return;

  const increment = Math.min(INTERACTION_WINDOW_MS, now() - state.lastChanged);
  state.interactionTime += Math.max(0, increment);
};

const bootstrapState = async () => {
  await initDB();
  settings = await getSettings();

  const tabs = await chrome.tabs.query({});
  const activeTabs = tabs.filter((t) => t.active);

  tabs.forEach((tab) => {
    if (!settings.trackingEnabled || isIgnored(tab.url)) return;
    createState(tab, tab.active);
  });

  if (activeTabs.length > 0) {
    activeTabId = activeTabs[0].id;
  }

  trackingReady = true;
};

const handleMessage = (message, sender, sendResponse) => {
  const respondAsync = async () => {
    switch (message.type) {
      case 'get-today-summary': {
        const dateKey = toDateKey(now());
        const sessions = await getSessions({ startDate: dateKey, endDate: dateKey });
        const agg = aggregateSessions(sessions);
        return {
          totals: agg.totals,
          topDomains: topDomains(agg.byDomain),
          date: dateKey,
        };
      }
      case 'get-sessions': {
        const sessions = await getSessions({
          startDate: message.startDate,
          endDate: message.endDate,
        });
        return sessions;
      }
      case 'export-data': {
        const sessions = await getSessions({});
        return sessions;
      }
      case 'toggle-tracking': {
        settings = await saveSettings({
          trackingEnabled: !settings.trackingEnabled,
        });

        if (!settings.trackingEnabled) {
          await finalizeAllSessions('paused');
        } else {
          await bootstrapState();
        }

        return settings.trackingEnabled;
      }
      case 'save-settings': {
        const incomingIgnored = message.settings?.ignoredSites || null;
        settings = await saveSettings(message.settings || {});

        if (incomingIgnored && Array.isArray(incomingIgnored)) {
          const normalized = incomingIgnored
            .map((v) => v && v.toLowerCase().trim())
            .filter(Boolean);
          if (normalized.length) {
            await deleteSessionsByDomains(normalized);
          }
        }
        return settings;
      }
      case 'get-settings': {
        return settings;
      }
      case 'reset-data': {
        await finalizeAllSessions('reset');
        await resetAll();
        settings = await getSettings();
        await bootstrapState();
        return { ok: true };
      }
      case 'ping': {
        return { ok: true };
      }
      case 'delete-range': {
        await finalizeAllSessions('range-delete');
        const start = message.startMs ?? null;
        const end = message.endMs ?? null;
        await deleteSessionsInRange(start, end);
        return { ok: true };
      }
      case 'delete-day': {
        await finalizeAllSessions('day-delete');
        if (message.dateKey) {
          await deleteSessionsByDate(message.dateKey);
        }
        return { ok: true };
      }
      case 'interaction-ping': {
        if (sender.tab?.id) {
          handleInteractionPing(sender.tab.id);
        }
        return { ok: true };
      }
      default:
        return null;
    }
  };

  respondAsync()
    .then((result) => sendResponse(result))
    .catch((err) => {
      console.error('Message handling failed', err);
      sendResponse({ error: err.message });
    });

  return true;
};

const registerListeners = () => {
  chrome.tabs.onCreated.addListener(handleTabCreated);
  chrome.tabs.onActivated.addListener(handleTabActivated);
  chrome.tabs.onUpdated.addListener(handleTabUpdated);
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
  chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
  chrome.runtime.onMessage.addListener(handleMessage);
  chrome.idle.onStateChanged.addListener(handleIdleStateChanged);
};

bootstrapState().then(registerListeners);

