@echo off
echo [PULL] Bringing GitHub updates (weekly history) back into the main project...
node "%~dp0sync_deploy.js" --pull %*
pause
