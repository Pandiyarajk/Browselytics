const DAY_MS = 24 * 60 * 60 * 1000;

export const now = () => Date.now();

export const toDateKey = (input) => {
  const d = input instanceof Date ? input : new Date(input);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const extractDomain = (urlString = '') => {
  try {
    const host = new URL(urlString).hostname;
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch (_) {
    return 'unknown';
  }
};

export const formatDuration = (ms = 0) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

export const sumDurations = (sessions = []) =>
  sessions.reduce(
    (acc, s) => {
      acc.openTime += s.openTime || 0;
      acc.activeTime += s.activeTime || 0;
      acc.backgroundTime += s.backgroundTime || 0;
      acc.interactionTime += s.interactionTime || 0;
      return acc;
    },
    { openTime: 0, activeTime: 0, backgroundTime: 0, interactionTime: 0 }
  );

export const aggregateSessions = (sessions = []) => {
  const totals = sumDurations(sessions);
  const byDomain = {};
  const byDate = {};

  sessions.forEach((s) => {
    const domain = s.domain || extractDomain(s.url);
    const dateKey = s.date || toDateKey(s.startTime || now());

    if (!byDomain[domain]) {
      byDomain[domain] = {
        domain,
        openTime: 0,
        activeTime: 0,
        backgroundTime: 0,
        interactionTime: 0,
        visits: 0,
      };
    }
    const domainBucket = byDomain[domain];
    domainBucket.openTime += s.openTime || 0;
    domainBucket.activeTime += s.activeTime || 0;
    domainBucket.backgroundTime += s.backgroundTime || 0;
    domainBucket.interactionTime += s.interactionTime || 0;
    domainBucket.visits += 1;

    if (!byDate[dateKey]) {
      byDate[dateKey] = {
        date: dateKey,
        openTime: 0,
        activeTime: 0,
        backgroundTime: 0,
        interactionTime: 0,
        visits: 0,
      };
    }
    const dateBucket = byDate[dateKey];
    dateBucket.openTime += s.openTime || 0;
    dateBucket.activeTime += s.activeTime || 0;
    dateBucket.backgroundTime += s.backgroundTime || 0;
    dateBucket.interactionTime += s.interactionTime || 0;
    dateBucket.visits += 1;
  });

  return { totals, byDomain, byDate };
};

export const topDomains = (byDomain = {}, limit = 5) =>
  Object.values(byDomain)
    .sort((a, b) => b.activeTime - a.activeTime)
    .slice(0, limit);

export const filterSessionsByDate = (sessions = [], startDate, endDate) => {
  const start = startDate ? toDateKey(startDate) : null;
  const end = endDate ? toDateKey(endDate) : null;
  return sessions.filter((s) => {
    const dateKey = s.date || toDateKey(s.startTime || now());
    if (start && dateKey < start) return false;
    if (end && dateKey > end) return false;
    return true;
  });
};

export const serializeSessionsToCSV = (sessions = []) => {
  const header = [
    'url',
    'domain',
    'date',
    'openTime',
    'activeTime',
    'backgroundTime',
    'interactionTime',
  ].join(',');

  const rows = sessions.map((s) =>
    [
      JSON.stringify(s.url || ''),
      JSON.stringify(s.domain || extractDomain(s.url || '')),
      s.date || toDateKey(s.startTime || now()),
      s.openTime || 0,
      s.activeTime || 0,
      s.backgroundTime || 0,
      s.interactionTime || 0,
    ].join(',')
  );

  return [header, ...rows].join('\n');
};

export const defaultWorkingHours = { start: '09:00', end: '18:00' };
export const defaultIgnoredDomains = ['unknown', 'newtab', 'extensions'];

