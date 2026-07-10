@echo off
chcp 65001 >nul
title Radio Pessoal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado.
  echo Instale o Node.js e tente novamente.
  pause
  exit /b 1
)

:loop
node servidor.js
if %errorlevel%==42 (
  goto loop
)

echo.
echo Servidor encerrado. Pressione qualquer tecla para fechar...
pause >nul
