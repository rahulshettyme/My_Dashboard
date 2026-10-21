#!/usr/bin/env node
// Web Legacy Emails - unattended weekly send (no browser, no dashboard server needed).
// For Windows Task Scheduler and GitHub Actions.
//
//   node web_legacy_emails/send_weekly.js             real send to configured To/CC, saves the week to history
//   node web_legacy_emails/send_weekly.js --test      send only to the Gmail account itself, history untouched
//   node web_legacy_emails/send_weekly.js --dry-run   build everything, write last_scheduled_preview.html, send nothing
//   node web_legacy_emails/send_weekly.js --no-save   real send without saving the week to history
//   --mark-sent      after a successful send, write last_scheduled_send.json ("already sent today" marker)
//   --scheduled      GitHub scheduled-style run: a late run before 06:00 is dated the previous evening
//   --check-due      only decide whether a scheduled send is due now (SEND_DAYS / SEND_TIME / SCHEDULE_MODE env, local time);
//                    prints the reason, writes due=true|false to $GITHUB_OUTPUT when set, sends nothing.
//                    Needs no npm packages, so the workflow can run it before installing anything.
//
// Credentials come from jira_credentials.json / email_credentials.json, or the environment
// (JIRA_EMAIL, JIRA_API_TOKEN, GMAIL_USER, GMAIL_APP_PASSWORD — environment wins).
// To/CC come from jira_config.json unless EMAIL_TO / EMAIL_CC are set (GitHub repository variables).
// Exit code 0 = success (or not due), 1 = failed (nothing is sent if the Jira fetch fails).
const fs = require('fs');
const core = require('./core.js');

const args = process.argv.slice(2);
const test = args.includes('--test');
const dryRun = args.includes('--dry-run');
const saveSnapshot = !args.includes('--no-save');

function checkDue() {
    const result = core.isSendDue({ days: process.env.SEND_DAYS, time: process.env.SEND_TIME, mode: process.env.SCHEDULE_MODE || 'send' });
    console.log(result.reason);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `due=${result.due}\n`);
}

function send() {
    return core.runWeeklyJob({ test, dryRun, saveSnapshot, trigger: 'cli', scheduledRun: args.includes('--scheduled') })
        .then(result => {
            const c = result.counts;
            console.log(`OK ${result.date}: Older ${c.olderHighest + c.olderHigh} (Highest ${c.olderHighest}, High ${c.olderHigh}), ` +
                `Recent ${c.recentHighest + c.recentHigh} (Highest ${c.recentHighest}, High ${c.recentHigh})`);
            if (dryRun) {
                console.log(`Dry run — nothing sent. Preview: ${result.previewFile}`);
                return;
            }
            const source = core.readRecipients().source;
            console.log(`Sent "${result.subject}" to ${result.to.join(', ')}${result.cc.length ? ` (cc ${result.cc.join(', ')})` : ''}`);
            if (!test) console.log(`Recipients from: To = ${source.to}, CC = ${source.cc}`);
            console.log(result.savedSnapshot ? 'Week saved to history.' : 'History not changed.');
            if (args.includes('--mark-sent')) {
                core.writeLastSent({ date: result.date, mode: test ? 'test' : 'send', at: new Date().toISOString() });
                console.log('Marked as sent today (last_scheduled_send.json).');
            }
        });
}

Promise.resolve()
    .then(() => (args.includes('--check-due') ? checkDue() : send()))
    .then(() => process.exit(0))
    .catch(e => {
        console.error(`FAILED: ${e.message}`);
        process.exit(1);
    });
