# Browselytics

Browselytics is a Chrome (Manifest V3) extension that tracks how long each site is open, active in the foreground, or running in the background. It stores data locally in IndexedDB and provides a popup summary plus a full dashboard for analytics.

## Features
- Per-tab time tracking: open, active, background
- Optional interaction tracking (mouse/keyboard pings + idle API)
- Local storage via native IndexedDB (sessions + settings)
- Popup with daily summary, top domains, pause/reset controls
- Dashboard with charts, filters, exports (CSV/JSON)
- Ignore list, working hours, tracking toggle

## Project Structure
- `manifest.json` — MV3 manifest with background service worker and content script
- `src/background/background.js` — tracking logic and runtime message API
- `src/storage/db.js` — IndexedDB wrapper (native)
- `src/utils/timeUtils.js` — helpers for domains, dates, aggregation, CSV
- `src/content/interaction.js` — optional interaction pings
- `src/popup/` — popup UI (HTML/CSS/JS)
- `src/dashboard/` — options/dashboard page with charts and table
- `assets/` — extension icons

## Development Setup
1. Clone or open this folder in Cursor.
2. Load the extension in Chrome: `chrome://extensions` → enable Developer Mode → Load unpacked → select the `Browselytics` folder.
3. The popup is available via the toolbar icon; the dashboard is the options page.

## Usage Notes
- Pause/resume tracking from the popup; resetting clears sessions and restores default settings.
- Ignored domains are matched by suffix (e.g., `example.com` will ignore `www.example.com`).
- Charts are powered by a local copy of Chart.js (`src/dashboard/chart.umd.min.js`) to comply with MV3 CSP.

## Roadmap
- v1.0.0: MVP (current) — tracking, storage, popup, dashboard, exports
- v1.5: Charts expansion, ignore list UX, export polish, categories
- v2.0+: Interaction scoring, working-hours analytics, dark mode refinements

## License
MIT — see `LICENSE`.

