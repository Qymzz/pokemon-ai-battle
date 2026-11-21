@echo off
cd /d "%~dp0"
node scripts\open-latest.mjs
if errorlevel 1 pause
