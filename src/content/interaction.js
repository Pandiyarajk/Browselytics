(function () {
  const PING_INTERVAL = 5000;
  let lastPing = 0;

  const sendPing = () => {
    const nowTs = Date.now();
    if (nowTs - lastPing < PING_INTERVAL) return;
    lastPing = nowTs;
    try {
      chrome.runtime.sendMessage({ type: 'interaction-ping' });
    } catch (err) {
      // Ignore messaging errors (e.g., service worker unavailable)
    }
  };

  ['mousemove', 'keydown', 'click', 'scroll'].forEach((eventName) => {
    window.addEventListener(eventName, sendPing, { passive: true });
  });
})();

