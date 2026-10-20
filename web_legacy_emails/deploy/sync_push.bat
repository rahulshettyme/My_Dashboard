@echo off
echo [PUSH] Copying Web Legacy Emails files to the deploy folder...
node "%~dp0sync_deploy.js" %*
pause
