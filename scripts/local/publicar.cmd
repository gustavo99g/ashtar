@echo off
rem Atalho para o publicar.ps1: roda sem precisar mexer na politica de execucao do PowerShell.
rem Os argumentos passam direto, por exemplo: publicar.cmd -SemCompilar
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0publicar.ps1" %*
echo.
pause
