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
  1. `server.js` → only the two consecutive blocks starting at the comments `// --- Web Legacy Emails / Jira Metrics API ---` (Jira helpers + `/api/jira/*`) and `// --- Web Legacy Emails / Gmail sending ---` (`/api/email/*`), both ending before `if (require.main === module)`. Locate them by searching for those comments rather than reading the whole file.
  2. Root `index.html` → the single dropdown option `<option value="web_legacy_emails/index.html">Web legacy emails</option>`.
  3. Root `package.json` → the `nodemailer` dependency (pinned exactly to `10.0.9`).
  4. Root `.gitignore` → the `jira_credentials.json` / `email_credentials.json` lines.

---

## 1. File Map
| File | Purpose |
| :--- | :--- |
| `web_legacy_emails/index.html` | Standalone page: page CSS, toolbar, an empty `#emailDigest` container (filled by the template), off-screen `#chartRenderArea`, and the 2 modals (Edit / Trend Data, Jira Settings). Loads Chart.js + `chartjs-plugin-datalabels@2` from jsDelivr, then `email_template.js` (classic script), then `script.js` (module). |
| `web_legacy_emails/email_template.js` | **Shared digest builder** (browser global `WebLegacyEmail` / Node `module.exports`): `filterHistoryForChart()`, `previousWeek()`, `buildChartConfig()`, `buildEmailHtml()`, `COLORS`. The page preview and the future email sender both use it, so the preview is exactly the email. |
| `web_legacy_emails/script.js` | Page state and logic: loading config/history, `renderDigest()` (chart PNGs + template → preview), Jira URL building, date helpers, modal handlers. |
| `web_legacy_emails/jira_config.json` | Jira domain, email metadata (`recipients`, `cc`, `subject`) and the 6 JQL queries. No secrets. Read/written by the server. |
| `web_legacy_emails/email_credentials.json` | `{ gmailUser, gmailAppPassword }`. **Gitignored**, server-only, never returned to the browser (`hasAppPassword` flag instead). Created on first Email settings save. |
| `web_legacy_emails/jira_credentials.json` | `{ jiraEmail, jiraApiToken }`. **Gitignored** (`.gitignore` pattern `jira_credentials.json`, any folder), server-only, never returned to the browser. Created automatically. Never commit, paste or share it. |
| `web_legacy_emails/jira_weekly_history.json` | Ordered array of weekly snapshots (oldest → newest). Read/written by the server. |
| `web_legacy_emails/tests/run_tests.js` | Module-scoped regression suite. |
| `server.js` (Jira block only) | `/api/jira/*` endpoints; file paths resolve to `web_legacy_emails/`. |
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

## 5. Trend Chart Progressive Monthly Rollover (`filterHistoryForChart()`, in `email_template.js`)
Both charts show the same filtered set of history points.

1. Group entries into months by `new Date(item.date)` → `YYYY-MM` (fallback: first 8 chars of the string if unparseable). Months are ordered by **first appearance in the array**.
2. ≤ 1 entry, or only one month → return everything unchanged.
3. **Older months** (everything before the previous month): keep **only the first entry** of each month (the monthly anchor).
4. **Previous month**: let `N` = number of entries in the current month.
   * Entry index 0 (week 1) is always kept.
   * Entry index `i ≥ 1` is kept only if `i > N`. So week 2 retires when the current month gets 1 entry, week 3 at 2 entries, etc.
5. **Current month** (last month group): all entries shown.

**Worked example (current data, 66 records Jun 20, 2025 → Oct 16, 2026)** gives **19 points**: one anchor per month Jun 2025 → Aug 2026 (15), Sep 4, 2026 (Sep's other 3 weeks retired because Oct has 3 entries), then Oct 5, Oct 9, Oct 16, 2026.
> Note: the original build notes claimed this produced exactly 18 points matching the email screenshot. The code actually produces 19 (verified 2026-10-19). Not changed. Confirm against the email before treating either number as the target.

---

## 6. Backend Endpoints (`server.js`, Jira block)
Constants: `JIRA_DIR = web_legacy_emails/`, `JIRA_HISTORY_FILE`, `JIRA_CONFIG_FILE`. Read helpers return `[]` / `{}` on missing file or parse error (logged as `[Jira] ...`).

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
* **Sending needs the page open**: chart PNGs are rendered in the browser (Chart.js) and posted with the email. A future unattended/scheduled send (Task Scheduler) must render charts server-side (e.g. headless browser via the existing `puppeteer-core`, or `chartjs-node-canvas`).
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
