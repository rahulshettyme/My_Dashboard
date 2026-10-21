# Web Legacy Emails Module Standard Operating Procedure (SOP) & Logic Specification

This document is the single source of truth for the features, queries, data stores, and logic rules of the **Web Legacy Emails** module: a weekly Jira digest of open Highest/High priority Web bugs, rendered in the same card + trend-chart format as the manual weekly email.

---

## 0. Scope & Isolation (Read First)
This is an **independent project** that lives inside the dashboard repo. It shares no logic with the Health, Yield, Growth, Sisense, or Area Unit Testing features.

* **Working on this module** → read only this SOP and the files listed in Section 1. Do **not** read other SOPs (`HEALTH_MODULE_SOP.md`, `YIELD_MODULE_SOP.md`, `GROWTH_MODULE_SOP.md`), `Aggregate-Data-Testing/`, `aggregate_*` files, or the rest of `server.js`.
* **Working on any other feature** → do **not** read `web_legacy_emails/` or this SOP. The root suite (`node run_tests.js`) does not cover this module and must not be extended to cover it.
* **Tests** for this module live only in `web_legacy_emails/tests/` and run with:
  ```
  node web_legacy_emails/tests/run_tests.js
  ```
  The root `node run_tests.js` is **not** required for changes confined to this module (see `.agents/AGENTS.md`).
* **Shared touchpoints outside the folder** (the only places outside `web_legacy_emails/` that may be read/edited for this module):
  1. `server.js` → only **two lines**: `app.use(require('./web_legacy_emails/routes.js').blockPrivateFiles);` directly **before** `app.use(express.static(__dirname))`, and the `// --- Web Legacy Emails ---` block (`require('./web_legacy_emails/routes.js').register(app, { startScheduler: require.main === module })`) just before `if (require.main === module)`. All routes live in `web_legacy_emails/routes.js`. Find them by searching for `web_legacy_emails` rather than reading the whole file.
  2. Root `index.html` → the single dropdown option `<option value="web_legacy_emails/index.html">Web legacy emails</option>`.
  3. Root `package.json` → dependencies pinned exactly: `nodemailer` `10.0.9`, `chart.js` `4.5.1`, `chartjs-plugin-datalabels` `2.2.0`, `@napi-rs/canvas` `1.0.10` (server-side chart PNGs; prebuilt binaries, no compiler needed on Windows/Linux).
  4. Root `.gitignore` → the `jira_credentials.json` / `email_credentials.json` lines and the `web_legacy_emails/schedule_runs.json` / `last_scheduled_preview.html` lines.
  5. `.github/workflows/web-legacy-emails-weekly.yml` → the GitHub Actions workflow (Section 6d).
  6. Root `.gitignore` → `!web_legacy_emails/deploy/sync_push.bat` `!web_legacy_emails/deploy/sync_pull.bat` (re-include the launchers; the main repo ignores `*.bat`) and `web_legacy_emails/deploy/last_pull_snapshot.json` (ignored local sync state).
* **Deploy folder** `../web_legacy_emails_deploy` (standalone repo) is **generated** by `web_legacy_emails/deploy/sync_deploy.js` — never edit it directly (Section 6e).

---

## 1. File Map
| File | Purpose |
| :--- | :--- |
| `web_legacy_emails/index.html` | Standalone page: page CSS, toolbar, an empty `#emailDigest` container (filled by the template), off-screen `#chartRenderArea`, and the 2 modals (Edit / Trend Data, Jira Settings). Loads Chart.js + `chartjs-plugin-datalabels@2` from jsDelivr, then `email_template.js` (classic script), then `script.js` (module). |
| `web_legacy_emails/email_template.js` | **Shared digest builder** (browser global `WebLegacyEmail` / Node `module.exports`): `filterHistoryForChart()`, `previousWeek()`, `buildChartConfig()`, `buildEmailHtml()`, `COLORS`. The page preview and the future email sender both use it, so the preview is exactly the email. |
| `web_legacy_emails/script.js` | Page state and logic: loading config/history, `renderDigest()` (chart PNGs + template → preview), date helpers, modal handlers, schedule UI. |
| `web_legacy_emails/core.js` | **Node-side core** (no Express/browser): config/history/credential file I/O (env vars override credentials), Jira counts (`fetchCounts`), server-side chart PNGs (`renderChartPng`), Gmail sending (`sendDigestMail`), the unattended **`runWeeklyJob()`**, and the in-server **scheduler** (`startScheduler`). Errors are `JobError` with an HTTP `status`. |
| `web_legacy_emails/send_weekly.js` | **CLI** for Windows Task Scheduler / GitHub Actions: `node web_legacy_emails/send_weekly.js [--test] [--dry-run] [--no-save]`. Exit 0/1. |
| `web_legacy_emails/last_scheduled_send.json` | GitHub Actions "already sent today" marker `{ date, mode, at }` (Section 6d). Exists only in the deploy repo (committed by the workflow); never synced over. |
| `web_legacy_emails/schedule_runs.json` | Run log (newest first, last 50): `{ at, trigger, slot, test, dryRun, ok, date, counts, to, cc, subject, savedSnapshot, error }`. **Gitignored**. |
| `web_legacy_emails/last_scheduled_preview.html` | Written by `--dry-run`: the exact email with charts inlined. **Gitignored**. |
| `web_legacy_emails/jira_config.json` | Jira domain, email metadata (`recipients`, `cc`, `subject`) and the 6 JQL queries. No secrets. Read/written by the server. |
| `web_legacy_emails/email_credentials.json` | `{ gmailUser, gmailAppPassword }`. **Gitignored**, server-only, never returned to the browser (`hasAppPassword` flag instead). Created on first Email settings save. |
| `web_legacy_emails/jira_credentials.json` | `{ jiraEmail, jiraApiToken }`. **Gitignored** (`.gitignore` pattern `jira_credentials.json`, any folder), server-only, never returned to the browser. Created automatically. Never commit, paste or share it. |
| `web_legacy_emails/jira_weekly_history.json` | Ordered array of weekly snapshots (oldest → newest). Read/written by the server. |
| `web_legacy_emails/tests/run_tests.js` | Module-scoped regression suite. |
| `web_legacy_emails/GO_LIVE_GUIDE.html` | Human-readable, step-by-step GitHub go-live guide (10 steps with tick-boxes saved in the browser, copy buttons, everyday changes, cron/IST table, troubleshooting). Static, no data; synced to the deploy repo. Keep in line with Section 6d when the workflow or settings change. |
| `web_legacy_emails/apps_script/github_trigger.gs` | **Google Apps Script** that reliably starts the GitHub workflow (`workflow_dispatch`, mode `scheduled`). Not run by Node — pasted into script.google.com (Section 6d, guide Step 7b). Synced to the deploy repo. |
| `web_legacy_emails/routes.js` | **All HTTP routes** (`register(app, { startScheduler })`) for `/api/jira/*` and `/api/email/*`, plus `blockPrivateFiles` middleware. Shared by the main `server.js` and the deploy repo's standalone `server.js`. |
| `web_legacy_emails/deploy/` | Deploy tooling (not deployed itself): `sync_deploy.js` (sync script, push and `--pull`), `sync_pull.bat` / `sync_push.bat` (double-click launchers); local state `last_pull_snapshot.json` (gitignored), templates `server.js`, `index.html`, `README.md`, `gitignore.txt` for the standalone repo. |
| `server.js` (2 lines) | `blockPrivateFiles` before static serving; `routes.register(...)`. |
| Root `index.html` | Feature dropdown entry → navigates to `web_legacy_emails/index.html` on **Proceed**. |

**Access**: start the server (`npm start` / `node server.js`), open `http://localhost:3000`, pick **Web legacy emails**, click **Proceed** (or open `http://localhost:3000/web_legacy_emails/index.html` directly).

---

## 2. Jira Queries (`jira_config.json` → `queries`)
All six share the same base filter:
```
project = "SMFP" and issuetype in (Bug) and status NOT IN (Closed, "Ready For Testing")
AND (component = Web OR assignee in (<6 Web-team account IDs>))
```
| Key | Extra clause | Used for |
| :--- | :--- | :--- |
| `older_highest` | `created < -30d and priority = Highest order by created DESC` | Count + "Highest" card link (Older section) |
| `older_high` | `created < -30d and priority = High order by created DESC` | Count + "High" card link (Older section) |
| `recent_highest` | `created >= -30d and priority = Highest order by created DESC` | Count + "Highest" card link (Recent section) |
| `recent_high` | `created >= -30d and priority = High order by created DESC` | Count + "High" card link (Recent section) |
| `older_combined` | `priority in (High, Highest) and created < -30d order by priority DESC, created DESC` | **Links only**: "View in Jira →" button + TOTAL card (Older) |
| `recent_combined` | `priority in (High, Highest) and created >= -30d order by priority DESC, created DESC` | **Links only**: "View in Jira →" button + TOTAL card (Recent) |

* **Totals are computed, not queried**: `Total = Highest + High` for each section (both in `renderCardCounts()` and in the server response). The combined queries are never executed for counts.
* **Boundary**: "Older" = `created < -30d`, "Recent" = `created >= -30d` — mutually exclusive, together cover all open issues.
* **Editing queries**: via ⚙️ Jira Settings modal (persists to `jira_config.json`) or by editing the file directly.

---

## 3. Page Layout & UI Behaviour
The digest is generated by `buildEmailHtml()` in `email_template.js` and injected into `#emailDigest` by `renderDigest()`. Layout (top → bottom, **900px** max width — `LAYOUT.emailWidth`, fluid below that — light theme):
* **Header band** (dark blue `#1e3a8a`): "Web Bugs · Weekly Summary" left, "Week of <date>" right (date = on-screen `currentCounts.date`).
* **Intro**: "Hi Team," + blank line + "Please find below the summary of open Highest/High priority issues in Jira related to the Web application."
* **Section 1 — Issues Older Than 30 Days**: title + *View in Jira →* button (`older_combined`); 3 cards: TOTAL OPEN ISSUES (blue accent), ● HIGHEST PRIORITY (soft red), ● HIGH PRIORITY (soft amber). No card has sub-text (only label, number, ▲/▼ line); then chart "Older Than 30 Days — Trend" with an HTML legend.
* **Section 2 — Issues From Last 30 Days**: same structure, but no card in this section has sub-text; chart "Issues From Last 30 Days — Trend".
* **Sign-off**: "Thanks, <senderName>" — `state.config.senderName` (optional `jira_config.json` key), default `Rahul`.
* **▲/▼ vs last week** on every card (`deltaHtml()`): compared with `previousWeek(history, date)` = the latest stored week strictly **before** the shown date (so a saved week compares to the week before it; an unsaved fetched week compares to the latest saved week). Increase = red `▲ N vs last week`, decrease = green `▼ N vs last week`, equal = grey `– no change vs last week`. Totals compare Highest+High sums. No previous week → no line.
* **Every card and View in Jira button is a link** whose `href` is built by `buildJiraUrl(domain, jql)` in `script.js`:
  * Strips `http(s)://` and any path from the domain; default domain `cropin.atlassian.net`.
  * Result: `https://<domain>/issues?jql=<encodeURIComponent(jql)>`.
* **Email-safe rule**: template output uses only tables + inline styles (no classes, `<style>`, flex or grid), Arial font, charts as `<img>`. Enforced by a regression test. Keep it that way — Gmail strips everything else.
* **Charts** (`buildChartConfig(history, section)` → `renderChartImage()`): line charts rendered off-screen at **820×320** (`LAYOUT.chartWidth` × `LAYOUT.chartHeight`, devicePixelRatio 2) into PNG data URLs, shown as `<img width=820>` (max-width 820px, fluid). Sizes live only in `LAYOUT` in `email_template.js`; `renderChartImage()` reads them, so preview and email always match. **Both charts: Highest = red `#ef4444`, High = amber `#f59e0b`** (Recent High used to be blue). `tension: 0.1`, data labels on every point, Y axis `beginAtZero` with integer ticks, X labels rotated 45°, Chart.js legend/tooltip off, `animation: false`, `responsive: false`.

### Toolbar actions
**Toolbar badge** (`renderBadge()`, page only, not part of the email): green `Live from Jira · <time> · <date> (saved|not saved)` after a successful fetch; amber `⚠ Not live — showing saved week <date>` when Jira could not be reached / no token. "Saved" = a history row has the same date **and** all 4 counts (`isCurrentSaved()`).

| Button | Function | Behaviour |
| :--- | :--- | :--- |
| ⚡ Refresh from Jira | `fetchJiraCounts()` | `POST /api/jira/fetch-counts`; on success puts the counts + today's date on the cards and sets `state.lastFetchedAt`. **View only — nothing is stored.** On failure, offers to open Settings (not in `quiet` mode). Also runs **automatically on every page load** (when a token is saved) and **before every send**. |
| 📧 Email | `openEmailModal()` | One modal: **Send Method** (`compose` default / `auto`), To / CC (comma-separated), Subject (optional `{date}` placeholder, not used by default), Sender Name (email sign-off). Gmail Address + Google App Password and *Send Test to Me* are shown **only** for `auto` (`updateEmailModeUI()`). Buttons: *Cancel* · *Save Settings* · (*Send Test to Me*) · **📧 Send Email** (auto: "Send Email Now"). See Section 6b. |
| ✏️ Edit / Trend Data | One modal, two parts | **Top — week entry**: 4 counts + **calendar date picker** (`<input type="date">`), pre-filled from the on-screen counts/date (e.g. just-fetched numbers + today). Buttons: *Cancel* · **💾 Save Snapshot** (`saveCurrentSnapshot()`, the **only** way to store a week: `POST /api/jira/history` with the form values; server upserts by date and re-sorts; cards switch to the latest stored week; charts + table re-render; modal stays open). **Bottom — All Weeks table**: every stored week with calendar date pickers, editable counts, 🗑️ delete; *Save Table Changes* (`saveAllHistory()`) sends the whole array via `PUT /api/jira/history`. Edits/deletes are in-memory until that save. |

**Modals** (Edit / Trend Data, Jira Settings, Email) close **only** via their × or Cancel button — clicking outside does nothing, so typed input is not lost.

The toolbar has 4 buttons (⚡ Refresh from Jira · ✏️ Edit / Trend Data · ⚙️ Jira Settings · 📧 Email); each opens a section or refreshes — actions live inside their modal. Save Snapshot deliberately lives inside the Edit / Trend Data modal next to the week date/counts it stores, not as a toolbar button (a lone action button looked like a tab).
| ⚙️ Jira Settings | `openSettingsModal()` / `saveSettings()` | Domain, email, API token, and all 6 JQLs → `POST /api/jira/config`. |

### Weekly workflow
* **Any day (view)**: open the page → it pulls live counts automatically (badge *Live from Jira*). Nothing changes in history.
* **Send the email (default, compose)**: 📧 Email → (first time: fill To/CC) → 📧 Send Email → Gmail opens with To/CC/Subject filled and an instruction line in the body → click it → **Ctrl+A, Ctrl+V** → review → Send in Gmail. Uses the numbers currently on the dashboard (no re-query).
* **Reporting day (store)**: page open (live) → verify via the cards → ✏️ Edit / Trend Data (pre-filled) → 💾 Save Snapshot. No day is hard-coded; saving is always a manual choice.
* **Backfill a missed week**: ✏️ → pick the past date + counts → 💾 Save Snapshot. The server sorts it into place.

### Dates
* Clicking anywhere in a date field opens the calendar (delegated `showPicker()` in `setupEventListeners()`; Chrome otherwise opens it only from the icon). `input[type="date"]` uses `color-scheme: dark` so the icon/calendar are visible on the dark modal.
* The All Weeks table renders **latest week first**; `data-idx` still holds the chronological array index, so saving/deleting is unaffected.
* Stored format stays `Mon D, YYYY` (e.g. `Oct 5, 2026`). Calendar pickers use ISO `YYYY-MM-DD`; converted by `labelToIso()` / `isoToLabel()` (local time, no timezone shift). Pickers guarantee consistent labels, which removes the old `Oct 5` vs `Oct 05` duplicate risk for new entries.

---

## 4. Data Flow & State
* **On load** (`loadData()`): fetches `/api/jira/config` and `/api/jira/history` in parallel, then **live Jira data is the default view**: if `hasApiToken`, `fetchJiraCounts({ quiet: true })` runs first and the digest is rendered from live counts. **Only if there is no token or the fetch fails** does it fall back to the latest saved week (`setCurrentFromLatestHistory()`; the server keeps the file sorted).
* **Outdated-data banner** (`#staleBanner`, page only, not in the email): shown whenever `state.lastFetchedAt` is null (i.e. showing saved data): "⚠ Showing saved local data, not live Jira data. Last available data: <date> — it may be outdated." + `Reason: <state.liveError>` (Jira error text, HTML-escaped; or "Jira API token is not set") + a note that sending is blocked until live data loads. Hidden after any successful fetch. A failed manual refresh while live data is already shown keeps the live data (toast only).
* **Live data wins**: once `state.lastFetchedAt` is set, saving snapshots/history (`applySavedHistory()`) redraws charts but keeps the live counts on the cards.
* **Charts end at the shown week**: `withCurrentWeek(history, currentCounts)` adds (or replaces by date) the on-screen week before charting, so an unsaved live week still appears as the last chart point in the preview and email. History itself is not changed.
* **Without history**: `currentCounts` is all zeros with no date (the old hard-coded `Oct 16, 2026` defaults were removed).
* **History record shape**: `{ "date": "Oct 16, 2026", "olderHighest": n, "olderHigh": n, "recentHighest": n, "recentHigh": n }`. Dates are free-text strings in `Mon D, YYYY` format.
* **Ordering**: the server sorts history by date (`sortJiraHistory()`) on every `POST` and `PUT /api/jira/history`, so back-dated weeks land in place. Unparseable dates sort to the end.

---

## 5. Trend Chart Points (`filterHistoryForChart(history, chartOptions)`, in `email_template.js`)
Both charts show the same points. History (`jira_weekly_history.json`) is never changed — this only picks which weeks are drawn. Same code for the dashboard preview, button sends and scheduled/GitHub sends.

**Settings** (`normalizeChartOptions()`): `maxPoints` (default **19**, range 4–60) and `recentWeeks` (default **4**, range 1–12); whole numbers, out-of-range values clamped, invalid → default, and `maxPoints` is never below `recentWeeks`.
* Stored in `jira_config.json` → `"chart": { "maxPoints": 19, "recentWeeks": 4 }`; edited in the dashboard: **✏️ Edit / Trend Data → Trend Chart → Save Chart Settings** (`saveChartSettings()`, POST `/api/jira/config` with `{ chart }`, preview redraws).
* GitHub repository variables **`CHART_MAX_POINTS` / `CHART_RECENT_WEEKS`** override the config per setting for GitHub-sent emails (`core.readChartOptions()`; workflow passes them as env). The local dashboard preview uses the config only.

**Rules (strict)**
1. At most `maxPoints` points. If history has ≤ `maxPoints` weeks, **every week is shown**.
2. **Never hidden** ("protected"): the **last `recentWeeks` weeks** (including the newest/current week) and the **first week of every month** (month anchors).
3. Over the limit: hide the **oldest unprotected week** first, repeatedly. In steady state that is the previous month's week 2, then week 3, … as new weeks arrive.
4. If only protected weeks remain and it is still over the limit: hide the **oldest point overall** (the oldest month's first week, on the left edge).

Effect per month at steady state: the previous month's in-between weeks drop off one by one (once they leave the last-N window), and each further new week drops the oldest point on the left — the chart length stays exactly `maxPoints`.

**Verified**: with today's 66-week history the default shows 19 points (first weeks of Jul 2025 → Oct 2026 plus Sep 28, Oct 5, 9, 16); `maxPoints` 20 adds back Jun 20, 2025. 3 simulated years of weekly additions for {19,4}, {20,4}, {12,6}: always exactly `maxPoints` points, the last `recentWeeks` weeks always shown, every month's first week inside the window shown, left edge only moves forward (regression test).

> Superseded rules (for reference): the original "progressive monthly rollover" (older months → first week only; previous month weeks 2..N retire as the current month grows) and its fixed 19-point cap (2026-10-21) — the rollover could hide weeks inside the last 4 (e.g. Nov 13 when Dec 4 arrived) and hid weeks even when there was room.

## 6. Backend Endpoints (`server.js`, Jira block)
All logic is in `core.js` (`FILES` = module-folder paths); `routes.js` only translates HTTP. Read helpers return `[]` / `{}` on missing file or parse error (logged as `[WebLegacyEmails] ...`). Credential files are only modified via `read*CredentialsFile()` so environment-variable secrets are never written to disk.

| Method & Path | Behaviour |
| :--- | :--- |
| `GET /api/jira/config` | Returns `jira_config.json` + `jiraEmail` + `hasApiToken` (boolean). The token itself is never returned. |
| `POST /api/jira/config` | `jiraEmail` / `jiraApiToken` go to `jira_credentials.json` (a blank/absent token **keeps** the saved one). Everything else shallow-merges over `jira_config.json`; `queries` is replaced wholesale if sent. Returns `{ success, config }` (same shape as GET). |
| `GET /api/jira/history` | Returns the history array. |
| `POST /api/jira/history` | Upsert by `date`: **case-insensitive exact string match**. Match → replace; else add. Then sort by date. Numbers coerced with `Number(x) \|\| 0`. 400 if `date` missing. Returns `{ success, history }` (sorted). |
| `PUT /api/jira/history` | Replaces the entire file with the body array, sorted by date (400 if not an array). No other validation of entries. Returns the sorted array. |
| `POST /api/jira/fetch-counts` | Body ignored; uses saved config + credentials only. Order: (1) **400** if email or token missing; (2) **400** if any of the 4 queries missing; (3) `GET /rest/api/3/myself` — 401/403 → **401** "Jira rejected the email/API token"; (4) 4 counts concurrently (`Promise.all`, one failure fails all → 500). Response: `{ success, fetchedAt, fetchedAs, counts: { older: {total, highest, high}, recent: {total, highest, high} } }` (`fetchedAs` = Jira display name, shown in the success toast). |

### Jira count call (`fetchJiraCount()`)
* **Exact count** by paging `POST https://<domain>/rest/api/3/search/jql` with `{ jql, fields: ['id'], maxResults: 100, nextPageToken }` until `isLast`; count = number of issues returned. 15 s timeout per request (`jiraRequest()`).
* Why not other endpoints: legacy `GET /rest/api/3/search` returns **410 Gone** (verified 2026-10-19); `POST /rest/api/3/search/approximate-count` is approximate by design.
* **Auth**: `Basic base64(jiraEmail:jiraApiToken)` from `jira_credentials.json` only. Atlassian Cloud API tokens require email + token; there is no Bearer/cookie path.
* **Classic vs scoped tokens** (`resolveJiraBase()`): every fetch first calls `/rest/api/3/myself` on the site (`https://cropin.atlassian.net`). On 401/403 it reads the cloud ID from the public `https://<domain>/_edge/tenant_info` and retries via the gateway `https://api.atlassian.com/ex/jira/<cloudId>`, then uses whichever base worked for the 4 counts. Needed because tokens made with **"Create API token with scopes"** are rejected on the site URL (`x-seraph-loginreason: AUTHENTICATED_FAILED`) but work on the gateway. A scoped token needs at least `read:jira-user` (for `/myself`) and `read:jira-work` (for search). The user's current token is scoped (verified 2026-10-19).
* **Where to get a token**: id.atlassian.com → Security → API tokens (`https://id.atlassian.com/manage-profile/security/api-tokens`). Shown once; max 1-year expiry. Entered in ⚙️ Jira Settings with the Atlassian login email.
* **Why credentials are mandatory**: anonymous Jira searches return **200 with 0 results** (no error), which would silently report zeros.
* **Why not from the browser session**: Jira Cloud sends no CORS headers, so the localhost page cannot call Jira with the logged-in browser session; all Jira calls go through the server with an API token. The scheduled email (no browser open) needs the same token anyway.

---

## 6b. Email Sending (`server.js`, Gmail block; page `sendEmail()`)
| Method & Path | Behaviour |
| :--- | :--- |
| `GET /api/email/config` | `{ recipients, cc, subject, senderName, gmailUser, hasAppPassword }`. App password never returned. |
| `POST /api/email/config` | Validates every To/CC address and the Gmail address (400 lists the bad ones; nothing saved). `recipients`/`cc`/`subject`/`senderName` → `jira_config.json`; `gmailUser`/`gmailAppPassword` → `email_credentials.json` (spaces stripped; blank keeps saved). |
| `POST /api/email/send` | Content-Type **`application/vnd.web-legacy-email+json`** (route-level parser, 10 MB limit — the app-wide `bodyParser.json()` is 100 kb and only handles `application/json`, so it skips this). Body `{ html, date, charts: { older, recent }, test }`. 400 if no html / no Gmail credentials / no To. Sends via `smtp.gmail.com:465` (TLS) with nodemailer; From = `"senderName" <gmailUser>`. Subject = config subject with `{date}` replaced (default "Weekly Web Application Jira Issues Summary"); test → `[TEST] ` prefix, To = Gmail account only, no CC. Charts become inline attachments `cid:older-trend` / `cid:recent-trend` (only `data:image/png;base64,` accepted). Gmail auth failure → 401 "Use a Google App Password". Returns `{ success, to, cc, subject, messageId, accepted, rejected }`. |

**Send Method** (`emailMode` in `jira_config.json`, default `compose`; user rule 2026-10-19: *never send automatically for now*):
* `compose` — **`composeEmail()`** (default): require To → if the dashboard is not live (`!state.lastFetchedAt`), confirm sending saved data → save settings (quiet) → **no Jira re-query: uses exactly what the dashboard shows** (the page already loads live data on open) → `copyDigestToClipboard()` (before `window.open`, because clipboard writes need this tab focused) puts the digest on the clipboard as `text/html` (cards + charts as PNG data URLs, from `buildDigestHtml(state.chartImages)`) plus a `text/plain` summary (`buildDigestText()`); falls back to selecting `#emailDigest` + `execCommand(copy)` → opens `https://mail.google.com/mail/?view=cm&fs=1&to=…&cc=…&su=…&body=<COMPOSE_BODY_HINT>` (pattern from the sibling `sage` project). The compose URL can only carry a **plain-text** body, so the HTML digest cannot be pre-filled; the body instead contains the instruction "▶ The report is copied. Click here, press Ctrl+A then Ctrl+V to replace this line with it." (omitted if copying failed). Ctrl+A also selects a Gmail signature if one is configured. If the pop-up is blocked, the modal shows an "Open Gmail compose" link. Nothing is sent by the tool.
* `auto` — `sendEmail()` via the server (below). **Server-enforced**: `POST /api/email/send` returns **403** unless `emailMode === auto`, so a stray call cannot send in compose mode. `POST /api/email/config` rejects any other `emailMode` value (400).

**Auto send flow** (`sendEmail({ test })`, only when Send Method = auto): save Email settings (quiet) → (real send only) require a To address and confirm To/CC in a dialog → **`fetchJiraCounts({ quiet: true })`; if it fails, abort ("Not sent: could not get fresh counts")** → `renderDigest()` already re-rendered → post `buildDigestHtml({ older: 'cid:older-trend', recent: 'cid:recent-trend' })` + `state.chartImages` (PNG data URLs from the same render). The email therefore always has counts fetched seconds before sending, ▲/▼ vs the last saved week before today, and charts ending at today's live week. Sending does **not** save a snapshot.

**Subject**: `Legacy Highest/High Issues – Web Application Weekly Jira Summary` (user's mail header "Legacy Highest/High issues" + the previous tool subject; no week/date). Same string is the fallback in `server.js` (`DEFAULT_EMAIL_SUBJECT`) and `script.js`. `{date}` still works if typed into the subject, but is not used by default.

**How to get a Google App Password**: myaccount.google.com → Security → 2-Step Verification (must be on) → App passwords → create (name e.g. "Jira digest") → copy the 16 characters → paste in 📧 Email → Save Settings → Send Test to Me.

## 6c. Scheduled / Unattended Sending (`core.js`, `send_weekly.js`)
**The job** — `runWeeklyJob({ test, dryRun, saveSnapshot, trigger, slot })`: `fetchCounts()` (live Jira; **throws → nothing sent**) → date = today (`formatDateLabel`) → charts from `withCurrentWeek(history, today)` rendered by `renderChartPng()` (chart.js + datalabels on `@napi-rs/canvas`, 820×320 @2x) → `buildEmailHtml()` (same template as the page; ▲/▼ vs `previousWeek(history, today)`, links via `buildJiraLinks`) → `sendDigestMail()` with charts as `cid:older-trend` / `cid:recent-trend` → if `saveSnapshot && !test`, `upsertHistory(today)`. Every run (ok or failed) is appended to `schedule_runs.json`.
* `test`: To = Gmail account only, no CC, subject `[TEST] …`, never saves history.
* `dryRun`: writes `last_scheduled_preview.html` (charts inlined), sends nothing, saves nothing.
* Independent of Send Method: the schedule has its own `enabled` flag; the 403 guard only applies to the button route `/api/email/send`.

**Schedule config** (`jira_config.json` → `schedule`, default `{ enabled: false, days: [5], time: "10:00", saveSnapshot: true }`; days 0=Sun…6=Sat; time 24-hour local). `writeSchedule()` rejects a bad time (`HH:MM`) and enabling with no days (400) **before writing**.

**In-server scheduler** (`startScheduler()`, started only when `server.js` is the main process): checks every 30 s; when enabled and today/time match, runs the job once per slot (`"YYYY-MM-DD HH:MM"`), guarded in memory and by the run log (survives restarts within the minute); never overlaps runs. The job is injectable (`startScheduler({ job })`) for testing; returns `stopScheduler`. Console logs `[WebLegacyEmails] Scheduled send …`.

**Endpoints**: `GET /api/email/schedule` → `{ schedule, nextRun, runs (last 10) }`; `POST /api/email/schedule` (save, 400 on invalid); `POST /api/email/schedule/run-now` `{ test }` (default `test: true`) runs the full server-side job immediately.

**UI** (📧 Email → *📅 Scheduled Sending*): enable checkbox, Mon–Sun checkboxes, time, "save the week to trend history" checkbox, status (`● Enabled — next send: …` / `○ Off`), last 5 runs (✅/❌), *Save Schedule* (also saves the Email settings first), *Run Now (test to me)*. The Gmail Login section is always visible now (scheduled sending needs it in either Send Method).

**CLI** (`send_weekly.js`): same job without the server. Credentials from files or env vars `JIRA_EMAIL`, `JIRA_API_TOKEN`, `GMAIL_USER`, `GMAIL_APP_PASSWORD` (env wins). To/CC from `jira_config.json` unless `EMAIL_TO` / `EMAIL_CC` are set and non-empty (`readRecipients()`; prints `Recipients from: To = EMAIL_TO|config, …`). Recipients are validated before sending (400 on a bad address).

**GitHub Actions**: built — see Section 6d.

## 6d. GitHub Actions (`.github/workflows/web-legacy-emails-weekly.yml`)
Runs `send_weekly.js` on a fresh `ubuntu-latest` machine — **no dashboard server**. Steps: checkout → setup-node 24 (npm cache) → `npm ci` (lockfile includes `@napi-rs/canvas-linux-x64-gnu`) → send step → upload `last_scheduled_preview.html` as artifact `email-preview` (dry-run only, 14 days) → commit `jira_weekly_history.json` back if it changed (`github-actions[bot]`, message `chore(web-legacy-emails): weekly snapshot YYYY-MM-DD`; `permissions: contents: write`). `TZ: Asia/Kolkata` so dates match the dashboard. `concurrency` prevents overlapping runs; 15-minute timeout.

**Primary trigger — Google Apps Script** (`apps_script/github_trigger.gs`, added 2026-10-21 after GitHub's timer fired only once in ~20 slots, and not at all from 15:30–17:20 on Wed Oct 21):
* A time-driven trigger runs `checkAndDispatch()` every **10 minutes** (`CONFIG.checkEveryMinutes`). With `CONFIG.schedule = 'github'` it reads the repository variables `WEEKLY_EMAIL_ENABLED`, `SEND_DAYS`, `SEND_TIME` (comma-separated times allowed) and `SCHEDULE_MODE` through the GitHub API (single source of truth). Disabled → no slots.
* A slot is due when today (`Asia/Kolkata`) is one of its days, the time is at/after the slot time, and it hasn't been dispatched yet (Script property `dispatched:<yyyy-MM-dd> <HH:MM> <mode>`, kept 14 days). A changed `SCHEDULE_MODE` is a new slot the same day. Missed checks catch up later the same day.
* Dispatch = `POST /repos/{owner}/{repo}/actions/workflows/web-legacy-emails-weekly.yml/dispatches` with `{ ref: 'main', inputs: { mode: 'scheduled' } }` (expects 204). The workflow then runs its own due check, so the marker still guarantees one send per day.
* Token: Script property `GITHUB_TOKEN` = **fine-grained** PAT, only this repo, **Actions: Read and write** + **Variables: Read-only**. Expires (≤ 1 year typically) → replace the property.
* Helpers: `setup` (create trigger), `remove` (delete trigger), `testCheckNow` (log decision, no dispatch), `testDispatchNow` (dispatch mode `test`).
* Generic for other projects: `CONFIG.schedule` can be a list, e.g. `[{ days: 'Mon-Fri', times: '10:00, 13:00, 17:00' }]` (days: names, `Mon,Fri`, ranges `Mon-Fri`/`Fri-Mon`, `*`); `owner` / `repo` / `workflowFile` / `inputs` configurable. Alternative for a few fixed times: separate `atHour()` triggers (max 20 per script, Google picks a time within ~±15 min). Quotas: trigger runtime 90 min/day (consumer) or 6 h/day (Workspace); URL fetch 20k / 100k per day — a 10-minute check uses ~2–3 min/day.
* Covered by a regression test that runs the real `.gs` in Node with stubbed `Utilities` / `PropertiesService` / `UrlFetchApp`.

**Triggers (workflow side)**
* `schedule`: cron `0,30 10-18 * * *` = every 30 min **15:30–00:00 IST** — a **wake-up window, not the send time** (GitHub cron is UTC, fixed — it cannot read variables — and often starts 5–20 min late). Each wake-up first runs **`send_weekly.js --check-due`** (no `npm ci`, a few seconds; `core.isSendDue()`): **due** when today (IST, `TZ=Asia/Kolkata`) is in `SEND_DAYS`, the time is at/after `SEND_TIME`, and `last_scheduled_send.json` doesn't already say today **for the same mode**. Not due → remaining steps skipped. Due → setup-node, `npm ci`, send with `--mark-sent` (mode from `SCHEDULE_MODE`, default `send`; `test` sends `[TEST]` to `GMAIL_USER` only and keeps history unchanged). The first wake-up after SEND_TIME sends; later ones say "Already sent today". SEND_TIME before 15:30 sends at the first wake-up (~15:30). Whole job **skipped (no cost) unless `WEEKLY_EMAIL_ENABLED` = `true`**.
* **Day/time are variables only — never edit the cron line for them.** Changing the cron makes GitHub re-register the schedule, which is slow and unreliable (observed 2026-10-20). Quick scheduled test: `SCHEDULE_MODE=test`, `SEND_DAYS` = today, `SEND_TIME` = `00:00` → **Run workflow → `scheduled`** (immediate); or wait for the next wake-up.
* **`WEEKLY_EMAIL_ENABLED` gates the whole scheduled path** (GitHub timer, Apps Script dispatch and manual `scheduled`): the due step answers `due=false` with "Scheduled sending is off" unless it is `true`.
* `workflow_dispatch` (Actions tab → *Run workflow*): input `mode` = `test` (default; only to the Gmail account, nothing committed) / `dry-run` (build only; preview artifact) / `send` (real send + save history + marker) — these always run, no due check — or **`scheduled`**: runs the **exact timer path now** (job env `SCHEDULED_PATH=true` → due check with SEND_DAYS/SEND_TIME, mode from `SCHEDULE_MODE`, `--mark-sent --scheduled`, commit). Use it to test the scheduled logic at any time of day.
* **Late runs**: GitHub started a 00:00 IST slot at 01:48 (2026-10-21) → "Not a send day (Wed …)". Now any scheduled-path run before **06:00 IST** (`LATE_RUN_CUTOFF_HOUR`) is evaluated **and dated** as the previous evening 23:59 (`core.scheduledEvening()`; due check, email "Week of", history date and marker all use it; `send_weekly.js --scheduled`). The reason line says `— late run at Wed 01:48, counted as previous evening`.
* Checkout uses `ref: github.ref_name` (latest branch tip, not the triggering commit) so a queued run sees a marker committed minutes earlier.
* Marker `web_legacy_emails/last_scheduled_send.json` = `{ date: "Oct 23, 2026", mode: "send"|"test", at: ISO }`; written by `--mark-sent`, committed with the history (`chore(web-legacy-emails): weekly summary sent YYYY-MM-DD`). A `test` marker does not block a real `send` the same day. To re-test the same day, delete the file in the repo. The deploy sync never overwrites or deletes it (`DEPLOY_OWNED`).
* Cost (private repo): ~18 wake-ups/day, each billed ≥ 1 min ≈ 540 Actions minutes/month (free plan: 2,000).
* History of this design: variable-driven (B) → briefly a single fixed cron edited on GitHub (A) → **back to B** the same evening because cron edits need GitHub to re-register the schedule and could not be tested quickly.

**Repository settings** (Settings → Secrets and variables → Actions)
| Name | Kind | Purpose |
| :--- | :--- | :--- |
| `JIRA_API_TOKEN` | **Secret only** | Jira token (encrypted, masked in logs) |
| `GMAIL_APP_PASSWORD` | **Secret only** | Google App Password |
| `JIRA_EMAIL` | Variable (or Secret) | Atlassian login email — workflow uses `vars.X \|\| secrets.X` |
| `GMAIL_USER` | Variable (or Secret) | Gmail sender address — `vars.X \|\| secrets.X` |
| `EMAIL_TO` | Variable | To list (comma/semicolon separated); overrides `jira_config.json` `recipients` when non-empty |
| `EMAIL_CC` | Variable | CC list; overrides `jira_config.json` `cc` when non-empty |
| `WEEKLY_EMAIL_ENABLED` | Variable | `true` = scheduled send on; anything else / missing = off |
| `SEND_DAYS` | Variable | Days, e.g. `Fri`, `Mon,Fri`, `monday; friday`, or numbers 0–6 (0 = Sun). Default `Fri`. Unknown names fail the check step |
| `SEND_TIME` | Variable | IST `HH:MM` 24-hour (`9:05` accepted). Default `17:30`. Effective range 15:30–23:59 |
| `SCHEDULE_MODE` | Variable | `send` (default) or `test` for scheduled runs (safe test of the scheduled path) |
| `CHART_MAX_POINTS` / `CHART_RECENT_WEEKS` | Variables (optional) | Trend chart length for GitHub-sent emails; override `jira_config.json` "chart" (Section 5) |
Token/password are deliberately **not** read from Variables: Variables are plain text, readable by anyone with repo access and not masked in logs (user asked for variables "if possible"; decision 2026-10-20).

**Changing To/CC**: edit `EMAIL_TO` / `EMAIL_CC` on GitHub (no commit needed; next run uses them). If unset, the committed `jira_config.json` values (edited via the local dashboard + push) are used. The dashboard UI cannot run on GitHub.

**History on GitHub**: each real send commits the updated history. Run `git pull` locally to see it in the dashboard. Once GitHub is live, treat it as the owner of history (local edits + push can conflict). Run results live in the Actions tab (logs kept ~90 days); `schedule_runs.json` is not kept on GitHub.

**Go-live checklist** (detailed version: `GO_LIVE_GUIDE.html` — step 8 tests one scheduled send with `SCHEDULE_MODE=test`, `SEND_DAYS` = today, `SEND_TIME` = now or earlier; step 9 sets real To/CC/day/time): repo on GitHub (**private**: config holds recipients, JQL holds Jira account IDs) → add secrets/variables → *Run workflow* `test` → `dry-run` (check artifact) → set `WEEKLY_EMAIL_ENABLED=true` → **turn off the local schedule** (otherwise recipients get two emails).

**Verified locally 2026-10-20**: YAML parses (triggers, cron, modes, `if:`); CLI with env-only credentials — wrong `JIRA_API_TOKEN` env fails (exit 1) despite a valid file (env wins), real values + `TZ=Asia/Kolkata` dry-run OK, history unchanged. Not yet run on GitHub itself.

## 6e. Standalone Deploy (`web_legacy_emails/deploy/sync_deploy.js`)
Copies **only this module's end-user files** from the main project into the separate deploy repo folder `C:\Users\rahul.shetty\Documents\Important\AntiGravity\web_legacy_emails_deploy` (default: `../web_legacy_emails_deploy` next to the main project; `--dest <folder>` to override). Modelled on `Data Generate/sync_links.py` (one-way push, secrets excluded and deleted).

**Run — one flow for everything**: `sync_pull.bat` → (delete/correct a week in base, optional) → (code/config/docs changes in base, optional; any order) → `sync_push.bat` → `git status` / `git add .` / `git commit` / `git push` in the deploy folder root. Options: `--dry-run`, `--no-git`, `--dest <folder>`, `--overwrite-history` (emergency only, not part of the flow), `--pull-history` (= `--pull`).

**Deploy repo layout** (same relative paths as the main project, so the workflow and `../style.css` work unchanged):
| Deploy path | From |
| :--- | :--- |
| `web_legacy_emails/**` | module folder, **mirrored** (stale files deleted) — excluding `deploy/`, `node_modules`, `*.log/*.bak/*.tmp` and **private files** |
| `.github/workflows/web-legacy-emails-weekly.yml` | main project workflow |
| `style.css` | main project root (the page links `../style.css`) |
| `server.js`, `index.html` (redirect), `README.md`, `.gitignore` | templates in `web_legacy_emails/deploy/` (`gitignore.txt` → `.gitignore`) |
| `package.json` | generated: only `express`, `body-parser`, `nodemailer`, `chart.js`, `chartjs-plugin-datalabels`, `@napi-rs/canvas` at the main project's pinned versions; scripts `start` / `send` / `test` |
| `package-lock.json` | `npm install --package-lock-only` in the deploy folder whenever `package.json` changes (needed for `npm ci` on GitHub; includes the Linux canvas binary) |

**Rules**
* **Secrets never deployed**: `jira_credentials.json`, `email_credentials.json`, `schedule_runs.json`, `last_scheduled_preview.html` are skipped, and **deleted** from the deploy folder if found (`[SECURITY]`).
* **History: three-way merge** (`threeWayMerge(snapshot, base, deploy)`, per date, case-insensitive). The reference is `deploy/last_pull_snapshot.json`: saved by **pull** as GitHub's history at that moment, and by **push** as base's history at that moment (so GitHub weeks base hasn't seen stay "new"). Rules: base deleted a week and GitHub's copy equals the snapshot → **removed**; base changed the numbers and GitHub's copy equals the snapshot → **base wins**; GitHub added/changed a week since the snapshot → **GitHub kept**; both changed → GitHub wins + `[WARN]`; only in base → added. No snapshot (never pulled on this PC) → plain union, nothing deleted (`[INFO] no pull snapshot yet`). Both pull and push use the same rule (a week deleted before pulling is not re-added). **Push** starts with `git pull --ff-only` (warns and continues on failure), writes the merged history to the deploy copy (`[HISTORY] deploy: …`), reports GitHub-only weeks (`[INFO] … kept`). **Pull** runs `git pull --ff-only` (stops on failure), writes the merged history to base (`[HISTORY] base: …`), saves the snapshot, lists managed files whose deploy copy differs (`[DIFF]`, not copied). Every history write backs the old file up to the OS temp folder. The `last_scheduled_send.json` marker stays deploy-only.
* Never touches the deploy folder's `.git`, `node_modules` or files outside the managed paths. Re-running with no changes reports 0 copied.
* Standalone `server.js`: binds **127.0.0.1** only (the page can change settings and send email), redirects `/` to the page, blocks private files and dotfiles, starts the scheduler only as the main process.

**Verified 2026-10-20**: first sync → 18 files, no secrets; in the deploy folder `npm ci` OK, tests 14/14, CLI `--dry-run` with env-only credentials OK (no credential files present), standalone server serves the page/API and 404s private files and `.github`; planted secret → deleted, stale file → removed, deploy-side history → kept; second run → 0 changes.

## 6f. Private-file protection
The main server shares the **whole project folder** (`express.static(__dirname)`, listening on `0.0.0.0`). Until 2026-10-20 this exposed `jira_credentials.json` and `email_credentials.json` to anyone on the network (verified HTTP 200 with token/app password). Now `routes.blockPrivateFiles` (→ `core.isPrivatePath`) runs **before** static serving and returns 404 for `PRIVATE_FILES` (`jira_credentials.json`, `email_credentials.json`, `schedule_runs.json`, `last_scheduled_preview.html`). It URL-decodes and normalises like Windows does (case-insensitive, trailing dots/spaces and `:stream` suffixes ignored) and refuses malformed encodings. Covered by a regression test. Other features' files served by the main server were not reviewed (out of this module's scope).

## 7. Historical Data Provenance
* `jira_weekly_history.json` holds **real** weekly counts transcribed from the manually-sent weekly email / its trend charts. It is not test data.
* Initial seed was 18 points read off the email screenshot; it was then replaced with the full **66-week** dataset (Jun 20, 2025 → Oct 16, 2026) supplied by the user.
* Treat the file as production data: do not overwrite or regenerate it for testing. Tests read it but never write to it.

---

## 8. Known Caveats / Risks
* **Live fetch verified** 2026-10-19 with the user's scoped token: Older 44 (Highest 1, High 43), Recent 1 (Highest 0, High 1), matching the Oct 16, 2026 manual numbers.
* **Token expiry**: Atlassian tokens expire (≤ 1 year). Expired token → "Jira rejected the email/API token"; create a new one and paste it in Settings.
* **Secret storage**: token is plaintext in `jira_credentials.json` (gitignored, never sent to the browser). Anyone with access to the PC/folder can read it.
* **Date-string dedupe**: upsert matches on the date string. All UI paths now produce `Mon D, YYYY` via the calendar picker, but a hand-edited JSON file could still introduce `Oct 05, 2026`-style duplicates.
* **Fetch ≠ Save (by design)**: fetched counts are lost on reload unless 💾 Save Snapshot is clicked. The badge shows *(not saved)* as a reminder.
* **Compose paste untested in Gmail** (as of 2026-10-19): pasting the copied HTML with data-URL chart images into Gmail compose has not yet been confirmed by the user. If charts don't paste, fall back to dragging the chart images or use Send Method = auto.
* **Gmail app passwords** (auto mode only) need 2-Step Verification on the Google account and the Workspace admin allowing app passwords. If the option is missing, IT has disabled it; the alternative is OAuth (not built).
* **Button sends** (compose/auto) use browser-rendered charts; **scheduled/CLI sends** render charts server-side with the same `buildChartConfig()` (visually identical; fonts may differ slightly by OS).
* **Time only applies on ticked days**: a time set for "today" does nothing unless today's weekday is ticked (default is Fri only). The save toast and status line show the real next send.
* **Credentials were reachable over HTTP before 2026-10-20** (Section 6f). If the dashboard ran on a shared network before then, consider rotating the Jira API token and Google App Password.
* **Deploy folder is generated**: edits made directly there are overwritten on the next sync (except history).
* **GitHub Actions workflow not yet run on GitHub** (as of 2026-10-20) — only validated locally (Section 6d).
* **Double sends**: if both the local schedule and `WEEKLY_EMAIL_ENABLED=true` are on, recipients get two emails.
* **In-server scheduler needs the PC on and the dashboard server running** at the scheduled minute; a missed slot is **not** caught up later. Times use the PC's local clock.
* **nodemailer pinned to 10.0.9**: versions ≤ 10.0.5 have high-severity advisories (header/SMTP injection, unintended-domain delivery). 10.1.x was days old when added (2026-10-19), so the newest patched release older than 5 weeks was chosen. Upgrade deliberately, re-run `npm audit`.
* **CDN scripts unpinned**: `chart.js` is loaded without a version.

---

## 9. Change Log (Feature & Logic Audit Trail)
* **2026-10-19**: Created the module. Added "Web legacy emails" to the root Feature dropdown. Built the card + trend-chart UI, 4 count queries + 2 combined link queries, toolbar (Fetch / Edit / Save Snapshot / Trend Data / Settings), and the `/api/jira/*` endpoints. Seeded 18 historical weekly snapshots from the email screenshot.
* **2026-10-19**: Moved all module files into the dedicated `web_legacy_emails/` folder (`index.html`, `script.js`, `jira_config.json`, `jira_weekly_history.json`), matching the `area_unit_testing/` pattern. Dropdown value → `web_legacy_emails/index.html`; server paths → `web_legacy_emails/`. Removed loose root files.
* **2026-10-19**: Replaced the seed with the full 66-week real dataset (Jun 20, 2025 → Oct 16, 2026) and added the progressive monthly rollover chart filter (`filterHistoryForChart()`).
* **2026-10-19**: Added this SOP, the module-scoped test suite `web_legacy_emails/tests/run_tests.js` (6 tests: rollover filter + `buildJiraUrl`), and the isolation rules in `.agents/AGENTS.md`. Documented the 19-vs-18 chart-point discrepancy and the caveats in Section 8. No application code changed.
* **2026-10-19**: Rebuild started (goal: automated weekly Gmail digest from the user's PC; count fetching first, email later). Fixed ⚡ Fetch: legacy `/rest/api/3/search` returned 410 Gone → exact count via paged `POST /rest/api/3/search/jql`. Credentials moved from `jira_config.json` to gitignored `jira_credentials.json` (auto-migrated on server start), never returned by `GET /api/jira/config` (`hasApiToken` flag instead), blank token on save keeps the stored one. Fetch now refuses to run without credentials and validates them via `/rest/api/3/myself` first. Removed Bearer/cookie auth paths and request-body overrides.
* **2026-10-19**: Simplified the toolbar to ⚡ Fetch · 💾 Save Snapshot · ✏️ Edit / Trend Data · ⚙️ Jira Settings. Merged *Edit Counts* and *Trend Data* into one modal (week entry on top, All Weeks table below; *Add Week Entry* dropped). Fetch and *Apply to Dashboard* are view-only; 💾 Save Snapshot is the only way to store on-screen counts (user's choice of day, nothing hard-coded). Week dates are now calendar pickers (`labelToIso()` / `isoToLabel()`). Server sorts history by date on every save (`sortJiraHistory()`). Badge shows *(saved)* / *(not saved)*. Removed hard-coded `Oct 16, 2026` defaults. Test added for the date conversion (7 total).
* **2026-10-19**: Moved 💾 Save Snapshot from the toolbar into the Edit / Trend Data modal (next to *Apply to Dashboard*); it now saves the form's date + counts instead of `currentCounts`, and keeps the modal open so the saved row is visible in the table. Toolbar is now ⚡ Fetch · ✏️ Edit / Trend Data · ⚙️ Jira Settings.
* **2026-10-19**: Date fields open the calendar on any click (`showPicker()`), dark `color-scheme` for date inputs; All Weeks table shows latest week on top.
* **2026-10-19**: Removed *Apply to Dashboard* (`applyManualEdit()`): it only previewed numbers on the cards without storing, which duplicated Save Snapshot and confused users. Week form buttons are now *Cancel* · *💾 Save Snapshot*.
* **2026-10-19**: Fixed "Jira rejected the email/API token" with a valid **scoped** token: added `resolveJiraBase()`. The site URL is tried first, then the `api.atlassian.com/ex/jira/<cloudId>` gateway; `jiraRequest()` / `fetchJiraCount()` now take a `{ host, prefix }` base instead of a domain. Live fetch verified (44/1/43, 1/0/1).
* **2026-10-19**: Email redesign (user picked: cards + change, header band, consistent colours). New shared `email_template.js` builds the digest as **email-safe HTML** (tables + inline styles, charts as `<img>`), used by the page preview now and by the email sender later. Added header band "Web Bugs · Weekly Digest · Week of <date>", ▲/▼ vs last week on all 6 cards (`previousWeek()`), Recent High chart colour blue → amber, chart titles drop "(Last 6 Months)" (data spans longer via rollover). `filterHistoryForChart()` moved from `script.js` to `email_template.js`; `renderCardCounts()` + `renderCharts()` replaced by `renderDigest()` + `renderChartImage()` (off-screen canvas → PNG). Hand-built digest markup/CSS removed from `index.html`. Optional `senderName` config key (default Rahul). 3 tests added (10 total).
* **2026-10-19**: Removed card sub-texts "Immediate attention required", "Target for sprint resolution" and "Opened in the last 30 days"; blank line after "Hi Team,". Then also removed "Older than 30 days" from the Older total card (redundant with the section title), so no card has sub-text. Test assertions added to the existing `buildEmailHtml` test.
* **2026-10-19**: **Email sending + always-live data.** New 📧 Email toolbar section (To/CC/Subject with `{date}`/sender name/Gmail + app password; Save · Send Test to Me · Send Email). New `/api/email/config` + `/api/email/send` (nodemailer 10.0.9 pinned, Gmail SMTP 465, charts as cid inline images, custom content type to bypass the 100 kb app-wide JSON limit without changing it). New gitignored `email_credentials.json`. Page now auto-fetches Jira on load and before every send (send aborts if the fetch fails); badge shows *Live from Jira* vs *⚠ Not live*. ⚡ button renamed "Refresh from Jira". Charts include the live week via `withCurrentWeek()`; saving history keeps live counts on the cards. Config subject set to "Weekly Web Application Jira Issues Summary – Week of {date}". 1 test added (11 total). Then: page load now tries Jira **before** rendering anything and only falls back to saved history on failure/no token, with an amber outdated-data banner showing the last available date and the failure reason (`state.liveError`).
* **2026-10-19**: **No automatic sending by default.** Added Send Method (`emailMode`: `compose` default / `auto`). Send Email now opens Gmail compose (To/CC/Subject prefilled, pattern from `sage`) and copies the rich digest to the clipboard for Ctrl+V; auto SMTP sending is kept but only when Send Method = auto, enforced by the server (403 otherwise). Gmail login fields / Send Test only shown in auto mode. Subject changed to "Legacy Highest/High Issues – Web Application Weekly Jira Summary" (no week/date); config set to `emailMode: compose`.
* **2026-10-19**: Compose no longer re-queries Jira (user: send what the dashboard shows); confirms first if the dashboard is on saved data. Gmail body now pre-filled with a plain-text paste instruction (Ctrl+A, Ctrl+V) because compose URLs cannot carry HTML and the dashboard-tab toast was not visible after Gmail opened. Clipboard copy now happens before opening Gmail.
* **2026-10-19**: Intro sentence changed (page, email HTML and plain-text clipboard fallback) to "Please find below the summary of open Highest/High priority issues in Jira related to the Web application." (user's wording, lightly polished).
* **2026-10-19**: Renamed "Weekly Digest" → "Weekly Summary" (email header band, page title, auto-send confirm text).
* **2026-10-19**: Email widened 680px → 900px and charts 616×280 → 820×320 to use empty space; sizes centralised in `LAYOUT` (exported from `email_template.js`).
* **2026-10-19**: Removed outside-click close from all three modals; they close only via × or Cancel.
* **2026-10-20**: **Scheduled / unattended sending** (step 1 toward GitHub Actions). New `core.js` (all Node logic moved out of `server.js`; routes are now thin) and `send_weekly.js` CLI. Charts rendered server-side (pinned `chart.js@4.5.1`, `chartjs-plugin-datalabels@2.2.0`, `@napi-rs/canvas@1.0.10`). In-server scheduler with UI (days/time/save-to-history, Run Now test, run log). `formatDateLabel`/`buildJiraUrl`/`buildJiraLinks` moved into `email_template.js` (removed from `script.js`). Env-var credential overrides for CI. Verified: live fetch through the refactored routes, CLI `--dry-run` end-to-end (history unchanged), scheduler fires exactly once per slot (stub job). 2 tests added (13 total).
* **2026-10-20**: Save Schedule toast now states the exact next send (weekday, date, time). Reason: a 17:04 test on a Tuesday did not send because only Fri (the default) was ticked — the time applies only on ticked days.
* **2026-10-20**: **GitHub Actions workflow** `.github/workflows/web-legacy-emails-weekly.yml` (Fri 10:00 IST cron gated by `WEEKLY_EMAIL_ENABLED`, manual run with test/dry-run/send, preview artifact, history commit-back). To/CC overridable by repository variables `EMAIL_TO` / `EMAIL_CC` (`core.readRecipients()`), recipients validated before sending; `JIRA_EMAIL` / `GMAIL_USER` accepted as variables or secrets, token/password secrets only. Email modal notes the override. 1 test added (14 total).
* **2026-10-20**: **Security fix** — credential files were downloadable from the main server (static root = project folder, bound to 0.0.0.0); now blocked by `routes.blockPrivateFiles` / `core.isPrivatePath` before static serving. **Routes moved** from `server.js` into `web_legacy_emails/routes.js` (`server.js` now has 2 lines for this module). **Standalone deploy**: `web_legacy_emails/deploy/` with `sync_deploy.js` (+ `sync_push.bat`) and templates; first sync to `web_legacy_emails_deploy` verified end-to-end (Section 6e). 1 test added (15 total).
* **2026-10-20**: Added `GO_LIVE_GUIDE.html` (step-by-step GitHub go-live: repo, push, secrets, variables, Actions permissions, test → dry-run, real To/CC, `WEEKLY_EMAIL_ENABLED`, local schedule off, after-Friday checks, troubleshooting). Documentation only.
* **2026-10-20**: **GitHub schedule now variable-driven** (user: test one scheduled send; day/time should be variables; sends are usually after 17:00 IST). Workflow wakes every 30 min 15:30–00:00 IST (`0,30 10-18 * * *`) and runs `send_weekly.js --check-due` (`core.isSendDue`) against `SEND_DAYS` / `SEND_TIME` (defaults Fri / 17:30) before installing anything; sends once per day per mode via the `last_scheduled_send.json` marker (`--mark-sent`); `SCHEDULE_MODE=test` for safe scheduled tests. Checkout uses the branch tip. Sync keeps the marker (`DEPLOY_OWNED`). Guide steps 8/9 rewritten (test one scheduled send → go real), everyday table now variable-based. 1 test added (16 total).
* **2026-10-20**: **Back to a single fixed cron (Option A)** at the user's request — simpler than wake-ups. Default `0 12 * * 5` (Fri 17:30 IST). Day/time changed by editing the cron line on GitHub; `sync_deploy.js` preserves GitHub's cron lines (`--reset-schedule` to override). Removed `--check-due` / `--mark-sent`, `core.isSendDue` & helpers, the `last_scheduled_send.json` marker and the `SEND_DAYS` / `SEND_TIME` variables; kept `SCHEDULE_MODE`. Guide: new "Change the schedule (cron)" section (field diagram, examples for single/multiple days, single/multiple times, odd minutes like 9:18, before-05:30 IST, rules) with an **IST → cron converter** (11 conversion cases verified) and step-by-step edit/commit on github.com or via git; steps 8/9 rewritten. isSendDue test removed (15 total).
* **2026-10-20**: **Rolled back to the variable-driven schedule (Option B)** at the user's request: with a fixed cron, every day/time change (including tests) needs GitHub to re-register the schedule — a 21:35 IST test cron committed shortly before did not fire. Restored `--check-due` / `--mark-sent`, `core.isSendDue` & helpers, the `last_scheduled_send.json` marker (`DEPLOY_OWNED`) and the `SEND_DAYS` / `SEND_TIME` variables; workflow cron back to `0,30 10-18 * * *` (wake-up window). Removed Option A's cron preservation / `--reset-schedule` from the sync (it would have kept a hand-edited GitHub cron) and the guide's cron section / IST converter. Guide steps 8/9 now test with `SEND_TIME` = now or earlier (next wake-up sends). isSendDue test restored (16 total).
* **2026-10-21**: First timer wake-up observed: the 00:00 IST slot started at **01:48** and was rejected as "Not a send day (Wed)". Added late-run handling (before 06:00 IST = previous evening, for both the due check and the email/history/marker date; `scheduledEvening()`, `--scheduled`) and a manual **`scheduled`** mode that runs the exact timer path immediately, so the scheduled logic can be tested without waiting for the evening window. Guide step 8 now leads with Run workflow → `scheduled`. 1 test added (17 total).
* **2026-10-21**: **Fixed chart length** at the user's request: after the rollover rule, `filterHistoryForChart()` keeps only the newest `CHART_MAX_POINTS` (19 — today's count) points, dropping the oldest when the previous month has no week left to retire. History file unchanged; applies to the dashboard preview and every email. Real-history test no longer assumes the first history week is the first chart point; 1 test added (18 total).
* **2026-10-21**: **Chart rule rewritten + configurable** (user: chart length configurable; never hide the last 4 weeks incl. the newest, nor the first week of a month; otherwise hide the oldest). New `filterHistoryForChart(history, { maxPoints, recentWeeks })` with protected weeks (Section 5), `normalizeChartOptions`, `CHART_DEFAULTS` / `CHART_LIMITS`; settings in `jira_config.json` "chart" (dashboard Edit / Trend Data → Trend Chart) and GitHub variables `CHART_MAX_POINTS` / `CHART_RECENT_WEEKS` (`core.readChartOptions`). Found while checking: the previous rollover kept the last 4 weeks in only 22 of 40 simulated weeks. Chart tests rewritten for the new rules (old "older months keep only first week" / "previous month retires weeks 2..N" expectations removed); 1 test added for the env override (19 total).
* **2026-10-21**: GitHub's `schedule` trigger skipped every slot from 15:30 to after 17:00 (only one scheduled run ever, at 01:48). Added the **Google Apps Script trigger** `apps_script/github_trigger.gs` (every 10 min; reads SEND_DAYS / SEND_TIME / SCHEDULE_MODE / WEEKLY_EMAIL_ENABLED from GitHub; dispatches mode `scheduled` once per slot; generic multi-day / multi-time schedules for other projects). Workflow: the scheduled path now also requires `WEEKLY_EMAIL_ENABLED=true` (covers dispatches). Guide: new Step 7b with token + Apps Script setup, everyday + troubleshooting rows. GitHub timer kept as backup. 1 test added (20 total).
* **2026-10-21**: **`sync_pull.bat`** (user: bring GitHub updates back so future deployments never drop historical data; modelled on `Data Generate/sync_pull.bat` → `--back`). `sync_deploy.js --pull` = git pull in the deploy folder + merge GitHub's weeks into base + `[DIFF]` report. History now **merges both ways** (push also merges base-only weeks into the deploy repo instead of skipping); push starts with `git pull`. Verified end-to-end in a sandbox with a bare git remote: GitHub-added week reached base, base-only week reached deploy, both ended with all 68 weeks, re-runs changed nothing. `.gitignore` re-includes `sync_pull.bat`. 1 test added (21 total).
* **2026-10-21**: Guide: step 7b-3 now explains Google's permission checkboxes (tick both: external service + run when not present) and warns that `setup` on a send day after SEND_TIME sends that day's real email. New final section **"Very important: keeping history safe — pull, edit, push"**: regular routine (sync_pull.bat → sync_push.bat → git add/commit/push) and the exact order to remove or correct a week (pull → delete in base via dashboard table or `jira_weekly_history.json` → `sync_deploy.js --overwrite-history` → commit/push deploy), because merge-both-ways would otherwise bring a deleted week back. Documentation only.
* **2026-10-21**: Added `deploy/sync_push_overwrite_history.bat` (Y/N confirmation → `sync_deploy.js --overwrite-history`) so removing/correcting a week needs no typed command. Guide history section: case B uses the new launcher (command kept as alternative); new **case C** "changes already made in the main project, emails sent since the last pull" (order doesn't matter: pull → push → commit; exception for history edits made before the pull → use B) and a "which launcher when" table. Documentation + launcher only.
* **2026-10-21**: **Single sync flow** at the user's request (no separate overwrite launcher): `sync_pull.bat` → delete/correct weeks and/or change code (any order) → `sync_push.bat` → commit. History now merges **three-way** against a snapshot saved by each pull/push (`last_pull_snapshot.json`, gitignored), so base deletions/corrections propagate while GitHub weeks sent in between are never lost. Removed `sync_push_overwrite_history.bat` (flag kept for emergencies). Sandbox E2E (bare git remote): delete + correct + code change with a GitHub send between pull and push → applied / kept correctly; week deleted before pulling stays deleted; later GitHub weeks flow to base; re-runs change nothing. The first sandbox run caught a bug (push saved the merged copy as snapshot → an unseen GitHub week looked "deleted"); fixed by saving base as the push snapshot and covered by a regression test. Guide history section rewritten as one flow. `threeWayMerge` test replaces the union test (21 total).
