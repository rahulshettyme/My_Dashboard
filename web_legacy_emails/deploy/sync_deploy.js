#!/usr/bin/env node
// Web Legacy Emails — one-way sync of ONLY this module's end-user files from the main dashboard
// project into the standalone deploy folder (its own git repo), modelled on Data Generate/sync_links.py.
//
//   node web_legacy_emails/deploy/sync_deploy.js                  push: main project → deploy folder
//   node web_legacy_emails/deploy/sync_deploy.js --dry-run        show what would change, change nothing
//   node web_legacy_emails/deploy/sync_deploy.js --pull-history   copy the deploy repo's history back into the main project
//   node web_legacy_emails/deploy/sync_deploy.js --overwrite-history   push: also replace the deploy repo's history
//   --dest <folder>   deploy folder (default: ../web_legacy_emails_deploy next to the main project)
//
// Never copies secrets (and deletes any found in the deploy folder), never touches the deploy
// folder's .git / node_modules or files it does not manage.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SRC = path.resolve(__dirname, '..', '..');                 // main dashboard project root
const MODULE = 'web_legacy_emails';
const TEMPLATES = __dirname;                                       // web_legacy_emails/deploy
const WORKFLOW = path.join('.github', 'workflows', 'web-legacy-emails-weekly.yml');
const HISTORY = 'jira_weekly_history.json';
// Files GitHub Actions commits into the deploy repo's module folder: never overwritten (except history
// with --overwrite-history) and never deleted as "stale"
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
const destIdx = args.indexOf('--dest');
const DST = destIdx >= 0 ? path.resolve(args[destIdx + 1]) : path.resolve(SRC, '..', 'web_legacy_emails_deploy');

const stats = { copied: 0, unchanged: 0, removed: 0, secrets: 0 };
const log = (tag, msg) => console.log(`${DRY ? '[DRY] ' : ''}[${tag}] ${msg}`);
const rel = (p) => path.relative(DST, p) || '.';

function sameContent(a, b) {
    if (!fs.existsSync(b)) return false;
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
            // History is owned by the deploy repo once it exists there (GitHub Actions commits to it)
            if (srcDir === path.join(SRC, MODULE) && entry.name === HISTORY && fs.existsSync(d) && !overwriteHistory) {
                if (!sameContent(s, d)) log('KEEP', `${rel(d)} (deploy repo owns history; use --pull-history / --overwrite-history)`);
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

function pullHistory() {
    const from = path.join(DST, MODULE, HISTORY);
    const to = path.join(SRC, MODULE, HISTORY);
    if (!fs.existsSync(from)) throw new Error(`No history in deploy folder: ${from}`);
    if (sameContent(from, to)) {
        console.log('History already identical — nothing to pull.');
        return;
    }
    const backup = path.join(os.tmpdir(), `${HISTORY}.${Date.now()}.bak`);
    log('BACKUP', `main history → ${backup}`);
    log('PULL', `${path.relative(SRC, to)} ← deploy repo`);
    if (!DRY) {
        fs.copyFileSync(to, backup);
        fs.copyFileSync(from, to);
    }
}

function main() {
    const mode = args.includes('--pull-history') ? 'PULL HISTORY (deploy → main)' : 'PUSH (main → deploy)';
    console.log('====================================================');
    console.log(`WEB LEGACY EMAILS DEPLOY SYNC — ${mode}${DRY ? ' — DRY RUN' : ''}`);
    console.log(`Source : ${SRC}`);
    console.log(`Deploy : ${DST}`);
    console.log(`Time   : ${new Date().toLocaleString()}`);
    console.log('====================================================\n');

    if (args.includes('--pull-history')) {
        pullHistory();
        console.log('\nDone.');
        return;
    }

    if (!DRY) fs.mkdirSync(DST, { recursive: true });

    // 1. Module folder (mirrored, secrets excluded)
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

    console.log('\n====================================================');
    console.log(`Copied/updated: ${stats.copied} · Unchanged: ${stats.unchanged} · Removed stale: ${stats.removed} · Secrets removed: ${stats.secrets}`);
    console.log(DRY ? 'Dry run — nothing was changed.' : 'Done. Review with "git status" in the deploy folder, then commit and push.');
    console.log('====================================================');
}

try {
    main();
} catch (e) {
    console.error(`\nFAILED: ${e.message}`);
    process.exit(1);
}
