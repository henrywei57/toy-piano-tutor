@echo off
rem Starts Toy Piano Tutor's YouTube helper. Leave the window open while you use the app.
cd /d "%~dp0.."
node tools\youtube-helper.mjs
pause
