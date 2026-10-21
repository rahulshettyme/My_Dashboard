/**
 * Web Legacy Emails — reliable trigger for the GitHub Actions workflow (Google Apps Script).
 *
 * GitHub's own `schedule:` timer is best-effort and skipped most slots for this repo, so this script
 * starts the workflow through GitHub's API (the same as Actions → Run workflow) at the configured times.
 * It is generic: point CONFIG at any repo/workflow and give it any days/times (e.g. sanity tests at
 * 10:00, 13:00 and 17:00 on weekdays).
 *
 * Setup (details: web_legacy_emails/GO_LIVE_GUIDE.html → "Reliable trigger: Google Apps Script"):
 *   1. script.google.com → New project → paste this file → Save.
 *   2. Project Settings → Script properties → add GITHUB_TOKEN = a fine-grained GitHub token limited to
 *      this repository with "Actions: Read and write" and "Variables: Read-only".
 *   3. Run `testCheckNow` (authorise when asked) → View → Executions / Logs shows the decision.
 *   4. Run `setup` once → creates the "every N minutes" trigger. `remove` deletes it again.
 *   Optional: `testDispatchNow` starts the workflow immediately in mode "test" ([TEST] email to GMAIL_USER).
 */

const CONFIG = {
  owner: 'rahulshettycropin',
  repo: 'web_legacy_emails',
  workflowFile: 'web-legacy-emails-weekly.yml',
  ref: 'main',
  inputs: { mode: 'scheduled' },   // workflow_dispatch inputs sent with every dispatch
  timeZone: 'Asia/Kolkata',
  checkEveryMinutes: 10,           // 1, 5, 10, 15 or 30 — the most a send can be late
  // 'github' = read the schedule from the repository variables SEND_DAYS / SEND_TIME / SCHEDULE_MODE /
  //            WEEKLY_EMAIL_ENABLED, so day/time are changed on GitHub only (this project).
  // Or a fixed list for other projects, e.g.
  //   schedule: [{ days: 'Mon-Fri', times: '10:00, 13:00, 17:00' }, { days: 'Sat', times: '09:30' }],
  schedule: 'github',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DISPATCHED_PREFIX = 'dispatched:';

// ---------- Trigger entry point ----------

/** Runs every CONFIG.checkEveryMinutes minutes (created by `setup`). */
function checkAndDispatch() {
  const decision = decide_(new Date());
  console.log(decision.summary);
  decision.due.forEach(slot => {
    dispatchWorkflow_(CONFIG.inputs);
    markDispatched_(slot.key);
    console.log(`Dispatched ${CONFIG.workflowFile} (${JSON.stringify(CONFIG.inputs)}) for slot ${slot.key}`);
  });
  cleanupDispatched_();
}

// ---------- Setup / manual helpers ----------

/** Creates the single time-driven trigger (removes old ones first). Run once. */
function setup() {
  remove();
  ScriptApp.newTrigger('checkAndDispatch').timeBased().everyMinutes(CONFIG.checkEveryMinutes).create();
  console.log(`Trigger created: checkAndDispatch every ${CONFIG.checkEveryMinutes} minutes`);
}

/** Deletes this script's checkAndDispatch triggers (stops all automatic dispatching). */
function remove() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'checkAndDispatch')
    .forEach(t => ScriptApp.deleteTrigger(t));
  console.log('checkAndDispatch triggers removed');
}

/** Shows what would happen right now, without dispatching anything. */
function testCheckNow() {
  const decision = decide_(new Date());
  console.log(decision.summary);
  console.log(decision.due.length ? `Would dispatch: ${decision.due.map(s => s.key).join(', ')}` : 'Nothing due right now.');
}

/** Starts the workflow immediately in mode "test" (only the Gmail account gets a [TEST] email). */
function testDispatchNow() {
  dispatchWorkflow_({ mode: 'test' });
  console.log('Dispatched mode "test" — check the repository Actions tab.');
}

// ---------- Decision logic ----------

function decide_(date) {
  const now = nowParts_(date);
  const slots = loadSlots_();
  const dispatched = PropertiesService.getScriptProperties().getProperties();
  const due = dueSlots_(slots, now, key => Boolean(dispatched[DISPATCHED_PREFIX + key]));
  const list = slots.map(s => `${s.days.map(d => DAY_NAMES[d]).join(',')} ${s.time}${s.tag ? ' [' + s.tag + ']' : ''}`).join(' | ');
  return {
    due,
    summary: `${now.dayName} ${now.time} (${CONFIG.timeZone}) · slots: ${list || 'none (disabled)'} · due: ${due.length}`
  };
}

/**
 * Pure: slots due now. A slot is due when today is one of its days, the time is at/after the slot time,
 * and it hasn't been dispatched today (key = date + time + tag). Missed slots catch up later the same day.
 */
function dueSlots_(slots, now, isDispatched) {
  return slots
    .filter(s => s.days.indexOf(now.day) >= 0 && now.minutes >= s.minutes)
    .map(s => Object.assign({}, s, { key: `${now.date} ${s.time}${s.tag ? ' ' + s.tag : ''}` }))
    .filter(s => !isDispatched(s.key));
}

/** Slots from CONFIG.schedule: [{ days: [0-6], time: 'HH:MM', minutes, tag }]. */
function loadSlots_() {
  if (CONFIG.schedule !== 'github') {
    return [].concat(...CONFIG.schedule.map(s => parseTimes_(s.times).map(t => Object.assign({ days: parseDays_(s.days), tag: s.tag || '' }, t))));
  }
  if (githubVariable_('WEEKLY_EMAIL_ENABLED') !== 'true') return [];
  const days = parseDays_(githubVariable_('SEND_DAYS') || 'Fri');
  const mode = githubVariable_('SCHEDULE_MODE') || 'send';
  // The tag makes a changed mode (e.g. test → send) a new slot on the same day
  return parseTimes_(githubVariable_('SEND_TIME') || '17:30').map(t => Object.assign({ days, tag: mode }, t));
}

/** "Fri" | "Mon,Fri" | "Mon-Fri" | "monday; thursday" | "*" | "5" → sorted day numbers (0 = Sun). */
function parseDays_(value) {
  const text = String(value || '').trim();
  if (text === '*' || /^every\s*day$/i.test(text)) return [0, 1, 2, 3, 4, 5, 6];
  const out = [];
  text.split(/[,;\s]+/).filter(Boolean).forEach(part => {
    const range = part.split('-');
    const idx = range.map(p => {
      if (/^[0-6]$/.test(p)) return Number(p);
      const i = DAY_NAMES.findIndex(d => d.toLowerCase() === p.slice(0, 3).toLowerCase());
      if (i < 0) throw new Error(`Unknown day "${p}" (use Mon, Tue, Wed, Thu, Fri, Sat, Sun)`);
      return i;
    });
    if (idx.length === 2) {
      for (let d = idx[0]; ; d = (d + 1) % 7) { out.push(d); if (d === idx[1]) break; }
    } else {
      out.push(idx[0]);
    }
  });
  return out.filter((d, i) => out.indexOf(d) === i).sort((a, b) => a - b);
}

/** "17:30" | "10:00, 13:00, 9:05" → [{ time: 'HH:MM', minutes }] (24-hour, CONFIG.timeZone). */
function parseTimes_(value) {
  return String(value || '').split(/[,;\s]+/).filter(Boolean).map(t => {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t);
    if (!m) throw new Error(`Time must be HH:MM in 24-hour format, e.g. 17:30 (got "${t}")`);
    return { time: `${m[1].padStart(2, '0')}:${m[2]}`, minutes: Number(m[1]) * 60 + Number(m[2]) };
  });
}

/** Date → { date: 'yyyy-MM-dd', day: 0-6, dayName, time: 'HH:mm', minutes } in CONFIG.timeZone. */
function nowParts_(date) {
  const f = fmt => Utilities.formatDate(date, CONFIG.timeZone, fmt);
  const day = Number(f('u')) % 7; // 'u': 1 = Monday … 7 = Sunday
  const hh = Number(f('H')), mm = Number(f('m'));
  return { date: f('yyyy-MM-dd'), day, dayName: DAY_NAMES[day], time: f('HH:mm'), minutes: hh * 60 + mm };
}

// ---------- GitHub API ----------

function githubToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Script property GITHUB_TOKEN is not set (Project Settings → Script properties).');
  return token;
}

function githubRequest_(method, path, body) {
  const res = UrlFetchApp.fetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}${path}`, {
    method,
    contentType: 'application/json',
    payload: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: `Bearer ${githubToken_()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    muteHttpExceptions: true
  });
  return { code: res.getResponseCode(), text: res.getContentText() };
}

/** Repository variable value, or '' when it doesn't exist. */
function githubVariable_(name) {
  const r = githubRequest_('get', `/actions/variables/${name}`);
  if (r.code === 404) return '';
  if (r.code !== 200) throw new Error(`Reading variable ${name} failed: HTTP ${r.code} ${r.text.slice(0, 200)}`);
  return String(JSON.parse(r.text).value || '').trim();
}

/** Same as Actions → Run workflow. GitHub answers 204 No Content on success. */
function dispatchWorkflow_(inputs) {
  const r = githubRequest_('post', `/actions/workflows/${CONFIG.workflowFile}/dispatches`, { ref: CONFIG.ref, inputs });
  if (r.code !== 204) throw new Error(`Run workflow failed: HTTP ${r.code} ${r.text.slice(0, 300)}`);
}

// ---------- "Already dispatched" memory (script properties) ----------

function markDispatched_(key) {
  PropertiesService.getScriptProperties().setProperty(DISPATCHED_PREFIX + key, new Date().toISOString());
}

/** Keeps the last 14 days of dispatch records. */
function cleanupDispatched_() {
  const props = PropertiesService.getScriptProperties();
  const cutoff = Utilities.formatDate(new Date(Date.now() - 14 * 864e5), CONFIG.timeZone, 'yyyy-MM-dd');
  Object.keys(props.getProperties())
    .filter(k => k.indexOf(DISPATCHED_PREFIX) === 0 && k.slice(DISPATCHED_PREFIX.length, DISPATCHED_PREFIX.length + 10) < cutoff)
    .forEach(k => props.deleteProperty(k));
}
