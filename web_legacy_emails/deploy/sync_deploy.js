#!/usr/bin/env node
// Web Legacy Emails — sync ONLY this module's end-user files between the main dashboard project (base)
// and the standalone deploy folder (its own git repo), modelled on Data Generate/sync_links.py.
//
// One flow for everything:  sync_pull.bat → (delete/fix a week or not) → (change code or not) →
//                           sync_push.bat → git add / commit / push in the deploy folder
//
//   node web_legacy_emails/deploy/sync_deploy.js            PUSH: base → deploy (sync_push.bat)
//   node web_legacy_emails/deploy/sync_deploy.js --pull     PULL: GitHub → deploy → base (sync_pull.bat)
//   --dry-run              show what would change, change nothing (no git pull either)
//   --no-git               skip the automatic "git pull" in the deploy folder
//   --overwrite-history    emergency only: push replaces the deploy history with base's, no merge
//   --dest <folder>        deploy folder (default: ../web_legacy_emails_deploy next to the main project)
//   --pull-history         old name for --pull
//
// History (jira_weekly_history.json) is merged three-way per date, using a snapshot of the deploy
// history saved at the last pull (deploy/last_pull_snapshot.json, local only):
//   - week deleted/changed in base since that pull, deploy copy unchanged → base's edit is applied
//   - week added or changed in the deploy repo since that pull (GitHub sent it) → deploy's copy is kept
//   - both changed the same week → deploy wins (that is what was emailed)
//   - no snapshot yet → plain union (nothing is deleted)
// So deleting a week is just: pull, delete it in base, push. A GitHub week sent in between is never lost.
// Push never copies secrets (and deletes any found in the deploy folder), never touches the deploy
// folder's .git / node_modules or files it does not manage. Pull only brings data back (history) and
// lists other files that differ — base stays the source of truth for code and docs.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SRC = path.resolve(__dirname, '..', '..');                 // main dashboard project root (base)
const MODULE = 'web_legacy_emails';
const TEMPLATES = __dirname;                                       // web_legacy_emails/deploy
const WORKFLOW = path.join('.github', 'workflows', 'web-legacy-emails-weekly.yml');
const HISTORY = 'jira_weekly_history.json';
const SNAPSHOT = path.join(__dirname, 'last_pull_snapshot.json'); // gitignored local state
// Files GitHub Actions commits into the deploy repo's module folder: never deleted as "stale"
const DEPLOY_OWNED = new Set([HISTORY, 'last_scheduled_send.json']);

// Never deployed (credentials, local run outputs); removed from the deploy folder if found
const PRIVATE_FILES = new Set(['jira_credentials.json', 'email_credentials.json', 'schedule_runs.json', 'last_scheduled_preview.html']);
// Not part of the deployed module (deploy templates themselves, editor/OS noise)
const SKIP_DIRS = new Set(['deploy', 'node_modules', '.git', '.vscode', '__pycache__']);
const SKIP_FILES = /\.(log|bak|tmp)$|^(Thumbs\.db|\.DS_Store)$/i;

// Runtime dependencies of the module (versions taken from the main package.json)
const DEPENDENCIES = ['express', 'body-parser', 'nodemailer', 'chart.js', 'chartjs-plugin-datalabels', '@napi-rs/canvas'];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const PULL = args.includes('--pull') || args.includes('--pull-history');
const NO_GIT = args.includes('--no-git');
const destIdx = args.indexOf('--dest');
const DST = destIdx >= 0 ? path.resolve(args[destIdx + 1]) : path.resolve(SRC, '..', 'web_legacy_emails_deploy');

const stats = { copied: 0, unchanged: 0, removed: 0, secrets: 0 };
const log = (tag, msg) => console.log(`${DRY ? '[DRY] ' : ''}[${tag}] ${msg}`);
const rel = (p) => path.relative(DST, p) || '.';

function sameContent(a, b) {
    if (!fs.existsSync(a) || !fs.existsSync(b)) return false;
    const sa = fs.statSync(a), sb = fs.statSync(b);
    return sa.size === sb.size && fs.readFileSync(a).equals(fs.readFileSync(b));
}

function copyFile(src, dst) {
    if (sameContent(src, dst)) {
        stats.unchanged++;
        return;
    }
    log('COPY', rel(dst));
    stats.copied++;
    if (DRY) return;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
}

function writeFile(dst, content) {
    if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') === content) {
        stats.unchanged++;
        return false;
    }
    log('WRITE', rel(dst));
    stats.copied++;
    if (!DRY) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, content, 'utf8');
    }
    return true;
}

function remove(p, tag = 'REMOVE') {
    log(tag, rel(p));
    if (tag === 'SECURITY') stats.secrets++; else stats.removed++;
    if (!DRY) fs.rmSync(p, { recursive: true, force: true });
}

// ---------- History: three-way merge (base, deploy, snapshot of deploy at last pull) ----------
const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const readHistoryFile = (file) => readJson(file, []);
const historyKey = (h) => String(h.date).trim().toLowerCase();
const weekValue = (h) => JSON.stringify([h.olderHighest, h.olderHigh, h.recentHighest, h.recentHigh].map(Number));
const sortByDate = (list) => {
    const time = (h) => {
        const t = new Date(h.date).getTime();
        return isNaN(t) ? Infinity : t;
    };
    return [...list].sort((a, b) => time(a) - time(b));
};

// ancestor = deploy history as seen at the last pull (null = never pulled → plain union).
// Returns { merged, deleted, edited, fromDeploy, fromBase, conflicts } (date lists for reporting).
function threeWayMerge(ancestor, base, deploy) {
    const toMap = (list) => new Map((list || []).map(h => [historyKey(h), h]));
    const A = ancestor ? toMap(ancestor) : null, B = toMap(base), D = toMap(deploy);
    const report = { merged: [], deleted: [], edited: [], fromDeploy: [], fromBase: [], conflicts: [] };
    for (const key of new Set([...B.keys(), ...D.keys()])) {
        const b = B.get(key), d = D.get(key), a = A && A.get(key);
        if (b && d) {
            if (weekValue(b) === weekValue(d)) report.merged.push(d);
            else if (A && a && weekValue(a) === weekValue(d)) { report.merged.push(b); report.edited.push(b.date); }        // base corrected it
            else if (A && a && weekValue(a) === weekValue(b)) report.merged.push(d);                                         // GitHub updated it
            else { report.merged.push(d); if (A) report.conflicts.push(d.date); }                                            // both / unknown → deploy
        } else if (d) {
            if (A && a && weekValue(a) === weekValue(d)) report.deleted.push(d.date);                                       // deleted in base since the pull
            else { report.merged.push(d); report.fromDeploy.push(d.date); }                                                  // new from GitHub (or no snapshot)
        } else {
            report.merged.push(b); report.fromBase.push(b.date);                                                             // only in base → keep
        }
    }
    report.merged = sortByDate(report.merged);
    return report;
}

// Old two-way merge (kept for tests / emergency use): union by date, primary wins
function mergeHistories(primary, secondary) {
    return threeWayMerge(null, secondary, primary).merged;
}

const sameHistory = (a, b) => JSON.stringify(sortByDate(a).map(h => [historyKey(h), weekValue(h)])) ===
    JSON.stringify(sortByDate(b).map(h => [historyKey(h), weekValue(h)]));

// Writes `merged` to `target` when it differs; backs the old file up to the temp folder first
function writeHistory(target, merged, label, r) {
    if (sameHistory(readHistoryFile(target), merged)) {
        stats.unchanged++;
        return false;
    }
    const backup = path.join(os.tmpdir(), `${HISTORY}.${label}.${Date.now()}.bak`);
    const parts = [];
    if (r.fromDeploy.length && label === 'base') parts.push(`+${r.fromDeploy.length} week(s) from GitHub: ${r.fromDeploy.join(', ')}`);
    if (r.fromBase.length && label === 'deploy') parts.push(`+${r.fromBase.length} week(s) from base: ${r.fromBase.join(', ')}`);
    if (r.deleted.length) parts.push(`−${r.deleted.length} deleted in base: ${r.deleted.join(', ')}`);
    if (r.edited.length) parts.push(`${r.edited.length} corrected in base: ${r.edited.join(', ')}`);
    log('HISTORY', `${label}: ${parts.join(' · ') || 'values updated'} · backup ${backup}`);
    stats.copied++;
    if (DRY) return true;
    if (fs.existsSync(target)) fs.copyFileSync(target, backup);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(merged, null, 2), 'utf8');
    return true;
}

function saveSnapshot(history) {
    if (!DRY) fs.writeFileSync(SNAPSHOT, JSON.stringify(sortByDate(history), null, 2), 'utf8');
}

function reportMerge(r, label) {
    if (r.conflicts.length) log('WARN', `changed in both base and GitHub since the last pull — kept GitHub's: ${r.conflicts.join(', ')}`);
    if (label === 'deploy' && r.fromDeploy.length) {
        log('INFO', `GitHub has ${r.fromDeploy.length} week(s) base doesn't (${r.fromDeploy.join(', ')}) — kept; run sync_pull.bat to bring them to base`);
    }
}

// ---------- git (deploy folder only) ----------
// strict: pull mode stops on failure; push mode warns and continues
function gitPullDeploy(strict) {
    if (NO_GIT) return;
    if (!fs.existsSync(path.join(DST, '.git'))) {
        log('GIT', 'deploy folder is not a git repo — skipping git pull');
        return;
    }
    if (DRY) {
        log('GIT', 'would run "git pull --ff-only" in the deploy folder');
        return;
    }
    try {
        const out = execSync('git pull --ff-only', { cwd: DST, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        log('GIT', `git pull: ${out.split('\n').slice(-1)[0]}`);
    } catch (e) {
        const msg = `git pull failed in the deploy folder: ${(e.stderr || e.message).trim().split('\n').slice(-1)[0]}`;
        if (strict) throw new Error(`${msg}\nResolve it in the deploy folder (e.g. commit or stash local changes, then "git pull"), then run the pull again.`);
        log('WARN', `${msg} — continuing; run "git pull" in the deploy folder before you push`);
    }
}

// ---------- Push ----------
// Mirror the module folder: copy wanted files, delete stale ones, never deploy secrets
function mirrorModule(srcDir, dstDir, overwriteHistory) {
    const wanted = new Set();
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const s = path.join(srcDir, entry.name);
        const d = path.join(dstDir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            wanted.add(entry.name);
            mirrorModule(s, d, overwriteHistory);
        } else {
            if (PRIVATE_FILES.has(entry.name.toLowerCase()) || SKIP_FILES.test(entry.name)) continue;
            wanted.add(entry.name);
            // History: three-way merge into the deploy copy (base deletions/corrections since the last pull applied,
            // GitHub weeks sent since then kept)
            if (srcDir === path.join(SRC, MODULE) && entry.name === HISTORY && fs.existsSync(d) && !overwriteHistory) {
                const snapshot = readJson(SNAPSHOT, null);
                if (!snapshot) log('INFO', 'no pull snapshot yet — history merged without deletions (run sync_pull.bat first to delete/correct weeks)');
                const base = readHistoryFile(s);
                const r = threeWayMerge(snapshot, base, readHistoryFile(d));
                reportMerge(r, 'deploy');
                writeHistory(d, r.merged, 'deploy', r);
                // Reference for the next sync = what base has now. GitHub weeks base hasn't seen yet stay
                // out of it, so the next pull treats them as new (not as "deleted in base").
                saveSnapshot(base);
                continue;
            }
            copyFile(s, d);
        }
    }
    if (!fs.existsSync(dstDir)) return;
    const isModuleRoot = dstDir === path.join(DST, MODULE);
    for (const entry of fs.readdirSync(dstDir, { withFileTypes: true })) {
        const d = path.join(dstDir, entry.name);
        if (PRIVATE_FILES.has(entry.name.toLowerCase())) remove(d, 'SECURITY');
        else if (isModuleRoot && DEPLOY_OWNED.has(entry.name)) continue;
        else if (!wanted.has(entry.name) && entry.name !== 'node_modules') remove(d);
    }
}

function buildPackageJson() {
    const main = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'));
    const dependencies = {};
    for (const name of DEPENDENCIES) {
        const version = (main.dependencies || {})[name];
        if (!version) throw new Error(`Main package.json has no dependency "${name}"`);
        dependencies[name] = version;
    }
    return JSON.stringify({
        name: 'web-legacy-emails',
        version: '1.0.0',
        private: true,
        description: 'Weekly Jira Highest/High Web bugs summary email (generated from the main dashboard project)',
        scripts: {
            start: 'node server.js',
            send: 'node web_legacy_emails/send_weekly.js',
            test: 'node web_legacy_emails/tests/run_tests.js'
        },
        engines: { node: '>=20' },
        dependencies
    }, null, 2) + '\n';
}

function push() {
    gitPullDeploy(false);
    if (!DRY) fs.mkdirSync(DST, { recursive: true });

    // 1. Module folder (mirrored, secrets excluded, history merged)
    mirrorModule(path.join(SRC, MODULE), path.join(DST, MODULE), args.includes('--overwrite-history'));

    // 2. Workflow + shared stylesheet the page links as ../style.css
    copyFile(path.join(SRC, WORKFLOW), path.join(DST, WORKFLOW));
    copyFile(path.join(SRC, 'style.css'), path.join(DST, 'style.css'));

    // 3. Standalone repo files from the templates
    copyFile(path.join(TEMPLATES, 'server.js'), path.join(DST, 'server.js'));
    copyFile(path.join(TEMPLATES, 'index.html'), path.join(DST, 'index.html'));
    copyFile(path.join(TEMPLATES, 'README.md'), path.join(DST, 'README.md'));
    copyFile(path.join(TEMPLATES, 'gitignore.txt'), path.join(DST, '.gitignore'));

    // 4. package.json with only the module's dependencies; refresh the lockfile when it changes
    const pkgChanged = writeFile(path.join(DST, 'package.json'), buildPackageJson());
    const lockPath = path.join(DST, 'package-lock.json');
    if (pkgChanged || !fs.existsSync(lockPath)) {
        log('NPM', 'npm install --package-lock-only (generates package-lock.json for npm ci on GitHub)');
        if (!DRY) execSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund', { cwd: DST, stdio: 'inherit' });
    }
}

// ---------- Pull ----------
// Lists managed files whose deploy copy differs from base (e.g. edited on github.com). Nothing is copied.
function reportDifferences() {
    const pairs = [];
    const walk = (srcDir, dstDir) => {
        if (!fs.existsSync(dstDir)) return;
        for (const entry of fs.readdirSync(dstDir, { withFileTypes: true })) {
            const s = path.join(srcDir, entry.name), d = path.join(dstDir, entry.name);
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)) walk(s, d);
            } else if (!DEPLOY_OWNED.has(entry.name) && !PRIVATE_FILES.has(entry.name.toLowerCase())) {
                pairs.push([s, d]);
            }
        }
    };
    walk(path.join(SRC, MODULE), path.join(DST, MODULE));
    pairs.push([path.join(SRC, WORKFLOW), path.join(DST, WORKFLOW)], [path.join(SRC, 'style.css'), path.join(DST, 'style.css')],
        [path.join(TEMPLATES, 'server.js'), path.join(DST, 'server.js')], [path.join(TEMPLATES, 'index.html'), path.join(DST, 'index.html')],
        [path.join(TEMPLATES, 'README.md'), path.join(DST, 'README.md')], [path.join(TEMPLATES, 'gitignore.txt'), path.join(DST, '.gitignore')]);
    const differ = pairs.filter(([s, d]) => fs.existsSync(d) && !sameContent(s, d)).map(([, d]) => rel(d));
    if (differ.length) {
        differ.forEach(f => log('DIFF', `${f} differs from base — not pulled (base is the source of truth; the next push updates it)`));
    } else {
        log('OK', 'code, docs and workflow in the deploy folder match base');
    }
}

function pull() {
    gitPullDeploy(true);
    const deployFile = path.join(DST, MODULE, HISTORY);
    const baseFile = path.join(SRC, MODULE, HISTORY);
    if (!fs.existsSync(deployFile)) throw new Error(`No history in deploy folder: ${deployFile}`);
    const deploy = readHistoryFile(deployFile);
    const r = threeWayMerge(readJson(SNAPSHOT, null), readHistoryFile(baseFile), deploy);
    reportMerge(r, 'base');
    writeHistory(baseFile, r.merged, 'base', r);
    if (r.deleted.length) log('INFO', `${r.deleted.join(', ')} deleted in base — the next sync_push.bat removes them from GitHub too`);
    if (r.fromBase.length) log('INFO', `base has ${r.fromBase.length} week(s) GitHub doesn't (${r.fromBase.join(', ')}) — the next sync_push.bat adds them`);
    saveSnapshot(deploy); // what GitHub had at this pull: the reference for the next push
    reportDifferences();
}

function main() {
    const mode = PULL ? 'PULL (GitHub → deploy → base)' : 'PUSH (base → deploy)';
    console.log('====================================================');
    console.log(`WEB LEGACY EMAILS DEPLOY SYNC — ${mode}${DRY ? ' — DRY RUN' : ''}`);
    console.log(`Base   : ${SRC}`);
    console.log(`Deploy : ${DST}`);
    console.log(`Time   : ${new Date().toLocaleString()}`);
    console.log('====================================================\n');

    if (PULL) pull(); else push();

    console.log('\n====================================================');
    console.log(`Copied/updated: ${stats.copied} · Unchanged: ${stats.unchanged} · Removed stale: ${stats.removed} · Secrets removed: ${stats.secrets}`);
    console.log(DRY ? 'Dry run — nothing was changed.'
        : PULL ? 'Done. Base now has GitHub\'s weeks. Next: delete/fix weeks or change code if needed, then sync_push.bat.'
            : 'Done. Now commit and push in the deploy folder: git status → git add . → git commit -m "…" → git push');
    console.log('====================================================');
}

module.exports = { threeWayMerge, mergeHistories };

if (require.main === module) {
    try {
        main();
    } catch (e) {
        console.error(`\nFAILED: ${e.message}`);
        process.exit(1);
    }
}
