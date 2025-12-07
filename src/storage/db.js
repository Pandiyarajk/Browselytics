import {
  toDateKey,
  defaultWorkingHours,
  defaultIgnoredDomains,
} from '../utils/timeUtils.js';

const DB_NAME = 'browselytics';
const DB_VERSION = 2;
const SETTINGS_KEY = 'settings';

const defaultSettings = {
  ignoredSites: [...defaultIgnoredDomains],
  categories: {},
  trackingEnabled: true,
  workingHours: defaultWorkingHours,
  interactionTracking: true,
};

let dbPromise;

const openDatabase = () => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains('sessions')) {
        const sessionStore = db.createObjectStore('sessions', {
          keyPath: 'id',
          autoIncrement: true,
        });
        sessionStore.createIndex('domain', 'domain', { unique: false });
        sessionStore.createIndex('date', 'date', { unique: false });
        sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
      } else if (event.oldVersion < 2) {
        const sessionStore = event.target.transaction.objectStore('sessions');
        if (!sessionStore.indexNames.contains('createdAt')) {
          sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error(request.error?.message || 'Failed to open DB'));
  });

  return dbPromise;
};

const withStore = async (storeName, mode, handler) => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = handler(store);

    tx.oncomplete = () => resolve(result);
    tx.onerror = () =>
      reject(new Error(tx.error?.message || 'Transaction failed'));
  });
};

export const initDB = () => openDatabase();

export const addSession = async (session) => {
  const payload = {
    url: session.url,
    domain: session.domain,
    date: session.date || toDateKey(session.startTime || Date.now()),
    openTime: session.openTime || 0,
    activeTime: session.activeTime || 0,
    backgroundTime: session.backgroundTime || 0,
    interactionTime: session.interactionTime || 0,
    createdAt: Date.now(),
  };

  return withStore('sessions', 'readwrite', (store) => store.add(payload));
};

export const getSessions = async ({ startDate, endDate } = {}) => {
  return withStore('sessions', 'readonly', (store) => {
    const index = store.index('date');
    const range =
      startDate || endDate
        ? IDBKeyRange.bound(
            startDate ? toDateKey(startDate) : '0000-00-00',
            endDate ? toDateKey(endDate) : '9999-12-31'
          )
        : null;

    const request = range ? index.getAll(range) : index.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Failed to read sessions'));
    });
  });
};

export const clearSessions = async () =>
  withStore('sessions', 'readwrite', (store) => store.clear());

export const deleteSessionsInRange = async (startMs, endMs) => {
  const start = startMs ?? 0;
  const end = endMs ?? Date.now();
  return withStore('sessions', 'readwrite', (store) => {
    const index = store.index('createdAt');
    const range = IDBKeyRange.bound(start, end);
    const request = index.openCursor(range);
    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve(true);
        }
      };
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Failed to delete range'));
    });
  });
};

export const deleteSessionsByDate = async (dateKey) => {
  if (!dateKey) return false;
  return withStore('sessions', 'readwrite', (store) => {
    const index = store.index('date');
    const range = IDBKeyRange.only(dateKey);
    const request = index.openCursor(range);
    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve(true);
        }
      };
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Failed to delete day'));
    });
  });
};

export const deleteSessionsByDomains = async (domains = []) => {
  const targets = new Set(
    domains
      .map((d) => (d || '').toLowerCase().trim())
      .filter(Boolean)
  );
  if (!targets.size) return false;

  return withStore('sessions', 'readwrite', (store) => {
    const index = store.index('domain');
    const request = index.openCursor();
    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const domain = (cursor.value.domain || '').toLowerCase();
          if (targets.has(domain)) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve(true);
        }
      };
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Failed to delete domains'));
    });
  });
};

export const exportSessions = async () => getSessions();

const readSettingsRecord = () =>
  withStore('settings', 'readonly', (store) => store.get(SETTINGS_KEY));

export const getSettings = async () => {
  const record = await readSettingsRecord();
  return { ...defaultSettings, ...(record?.value || {}) };
};

export const saveSettings = async (settingsPatch) => {
  const current = await getSettings();
  const next = { ...current, ...settingsPatch };

  return withStore('settings', 'readwrite', (store) =>
    store.put({ key: SETTINGS_KEY, value: next })
  ).then(() => next);
};

export const resetAll = async () => {
  const db = await openDatabase();
  const sessionClear = new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  const settingsReset = saveSettings(defaultSettings);

  await Promise.all([sessionClear, settingsReset]);
  return true;
};

export const deleteDatabase = async () => {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve(true);
    request.onerror = () =>
      reject(new Error(request.error?.message || 'Failed to delete DB'));
  });
};

