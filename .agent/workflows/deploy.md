---
description: Deployment instructions for My Dashboard
---

# Deployment Instructions

To deploy the "My Dashboard" application to a production or staging environment, follow these steps. This workflow focuses only on the core application files and ignores local utility scripts.

## 1. Required Files
Only the following files and directories are necessary for the application to run:

| File / Directory | Description |
| :--- | :--- |
| `aggregate_dashboard.html` | The main dashboard UI |
| `aggregate_script.js` | Core dashboard logic |
| `index.html` | Landing/Login page |
| `script.js` | Main application logic |
| `style.css` | Application styles |
| `server.js` | Backend server |
| `api.js` | Client-side API helpers |
| `package.json` | Node.js dependencies |
| `package-lock.json` | Dependency lockfile |
| `db.json` | Local data / configuration |
| `components/` | UI Components directory |
| `area_unit_testing/` | Validation & testing resources |

## 2. Excluded Files (Do NOT Push)
The following files are for local development/utility only and should be skipped:
- Any `.bat` files (`clean_start.bat`, `start_server.bat`, `stop_server.bat`)
- Utility binaries and scripts (`extract-zip`, `mkdirp`, `mime`, `browsers` + their `.cmd` or `.ps1` versions)
- `node_modules/` (Always run `npm install` on the destination server instead)

## 3. Recommended Deployment Command (Git)
If you are using Git, you can use the following `.gitignore` to prevent utility files from being tracked:

```
# Node modules
node_modules/

# Local utility scripts
*.bat
*.cmd
*.ps1
extract-zip
mkdirp
mime
browsers

# Logs
npm-debug.log*
```

## 4. Manual Deployment (Zip/FTP)
If deploying manually (e.g., via a Zip file), only include the files listed in the **Required Files** section above.

// turbo
## 5. Deployment Checklist
1. Copy required files to the server.
2. Run `npm install` to install dependencies.
3. Use a process manager like `pm2` to stay the server: `pm2 start server.js --name "my-dashboard"`.
