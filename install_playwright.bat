@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d C:\Users\Cyril\Desktop\tradingview-analyzer
echo Installing Playwright Chromium...
npx playwright install chromium
echo Done.
pause
