// Standalone Web Legacy Emails server (deploy repo only).
// Generated from the main dashboard project by web_legacy_emails/deploy/sync_deploy.js — edit there, not here.
// Serves the page at http://localhost:3000 and the module's /api/jira/* and /api/email/* routes.
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const routes = require('./web_legacy_emails/routes.js');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(bodyParser.json());
app.get('/', (req, res) => res.redirect('/web_legacy_emails/index.html'));
app.use(routes.blockPrivateFiles);
app.use(express.static(__dirname, { dotfiles: 'deny' }));

routes.register(app, { startScheduler: require.main === module });

if (require.main === module) {
    // Bound to localhost only: the page can change settings and send email
    app.listen(PORT, '127.0.0.1', () => {
        console.log(`Web Legacy Emails running on http://localhost:${PORT}`);
    });
}

module.exports = { app };
