@echo off
setlocal
title Voice Messaging - Instalando dependencias del Gateway

set "GATEWAY_DIR=%~1"
if "%GATEWAY_DIR%"=="" set "GATEWAY_DIR=%CD%"

set "LOG_FILE=%GATEWAY_DIR%\install-gateway-dependencies.log"

call :log "Inicio de instalacion de dependencias del Gateway"
call :log "Directorio: %GATEWAY_DIR%"

cd /d "%GATEWAY_DIR%"
if errorlevel 1 (
    call :log "ERROR: No fue posible abrir el directorio del Gateway."
    exit /b 1
)

call :log "INICIO: npm install"
echo.
echo [%DATE% %TIME%] npm install
echo ------------------------------------------------------------
cmd /C npm install 2>&1
set "RESULT=%ERRORLEVEL%"
call :log "FIN: npm install. Codigo: %RESULT%"
if not "%RESULT%"=="0" exit /b %RESULT%

set "FOUND_CHROME="
for /f "delims=" %%F in ('where /r ".cache\chrome" chrome.exe 2^>nul') do (
    set "FOUND_CHROME=%%F"
    goto :chrome_found
)

:chrome_found
if defined FOUND_CHROME (
    call :log "Chrome ya existe en cache: %FOUND_CHROME%. Se omite descarga."
) else (
    call :log "Chrome no existe en cache. Instalando Chrome para Puppeteer..."
    set "PUPPETEER_CACHE_DIR=%GATEWAY_DIR%\.cache"
    call :log "INICIO: npx puppeteer browsers install chrome"
    echo.
    echo [%DATE% %TIME%] npx puppeteer browsers install chrome
    echo ------------------------------------------------------------
    cmd /C npx puppeteer browsers install chrome 2>&1
    set "RESULT=%ERRORLEVEL%"
    call :log "FIN: npx puppeteer browsers install chrome. Codigo: %RESULT%"
    if not "%RESULT%"=="0" exit /b %RESULT%
)

call :log "Dependencias del Gateway listas."
exit /b 0

:log
echo [%DATE% %TIME%] %~1
>> "%LOG_FILE%" echo [%DATE% %TIME%] %~1
exit /b 0
