# Web Legacy Emails

Weekly email summary of open **Highest / High** priority Web bugs in Jira (Older than 30 days and Last 30 days), with week-over-week change and trend charts.

> This repository is **generated** from the main dashboard project by `web_legacy_emails/deploy/sync_deploy.js`.
> Make changes in the main project and re-sync; edits made here are overwritten (except `jira_weekly_history.json`, see below).

## How it runs

| Where | How |
|---|---|
| **GitHub Actions** (main use) | `.github/workflows/web-legacy-emails-weekly.yml` — sends on `SEND_DAYS` at/after `SEND_TIME` (IST; default Fri 17:30) once `WEEKLY_EMAIL_ENABLED` is `true`. Wakes every 30 min between 15:30 and 00:00 IST; a quick check decides whether to send (once per day). Day/time are repository variables — never edit the workflow for them. Manual runs: **Actions → Web Legacy Emails – Weekly Summary → Run workflow** (`test` / `dry-run` / `send`, or `scheduled` = run the timer's exact logic now). |
| **Google Apps Script** (reliable trigger) | `web_legacy_emails/apps_script/github_trigger.gs` in script.google.com starts the workflow (mode `scheduled`) every `SEND_DAYS` at `SEND_TIME`, checking every 10 min — GitHub's own timer is best-effort and kept only as a backup. Setup: guide Step 7b. |
| **Command line** | `npm ci` then `node web_legacy_emails/send_weekly.js [--test] [--dry-run] [--no-save]` |
| **Local dashboard** (optional) | `npm ci` then `npm start` → <http://localhost:3000> |

## GitHub settings (Settings → Secrets and variables → Actions)

| Name | Kind |
|---|---|
| `JIRA_API_TOKEN`, `GMAIL_APP_PASSWORD` | **Secrets** |
| `JIRA_EMAIL`, `GMAIL_USER` | Variables (or Secrets) |
| `EMAIL_TO`, `EMAIL_CC` | Variables — override To/CC in `web_legacy_emails/jira_config.json` |
| `WEEKLY_EMAIL_ENABLED` | Variable — `true` turns scheduled sending on |
| `SEND_DAYS` | Variable — e.g. `Fri` or `Mon,Fri` (default `Fri`) |
| `SEND_TIME` | Variable — IST 24-hour, e.g. `17:30` (default `17:30`; effective 15:30–23:59) |
| `SCHEDULE_MODE` | Variable — `send` (default) or `test` (scheduled runs send `[TEST]` only to `GMAIL_USER`, no history) |
| `CHART_MAX_POINTS`, `CHART_RECENT_WEEKS` | Variables (optional) — trend chart length (default 19 points, last 4 weeks always shown) |

## Data

* `web_legacy_emails/jira_weekly_history.json` — weekly counts. Each real send commits the new week back to this repo. In the main project the one flow is `sync_pull.bat` → (delete/correct weeks, change code) → `sync_push.bat` → commit here. History is merged three-way against the last pull, so deletions/corrections made in the main project propagate and weeks GitHub sent in between are never lost.
* `web_legacy_emails/last_scheduled_send.json` — "already sent today" marker committed by the workflow (also never overwritten by the sync).
* Credentials are never committed (`.gitignore`). Locally they live in `web_legacy_emails/jira_credentials.json` / `email_credentials.json` (created by the dashboard's settings), on GitHub in Secrets.

## Docs

Step-by-step go-live: `web_legacy_emails/GO_LIVE_GUIDE.html`. Full behaviour, rules and change log: `web_legacy_emails/WEB_LEGACY_EMAILS_SOP.md`.
