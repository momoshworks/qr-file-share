@echo off
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
title QR Drop Pro - File Transfer
cd /d "%~dp0"
echo ========================================================
echo   Starting QR Drop Pro...
echo ========================================================

python app.py
if %ERRORLEVEL% NEQ 0 (
    echo Python command failed, trying py...
    py app.py
)
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] An error occurred while running app.py
    pause
)
