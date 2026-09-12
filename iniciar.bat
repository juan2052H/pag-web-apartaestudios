@echo off
title Apartaestudios
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No se encontro Node.js en este equipo.
  echo   Descargalo en https://nodejs.org e intenta de nuevo.
  echo.
  pause
  exit /b 1
)
start "" http://localhost:3000
node server.js
pause
