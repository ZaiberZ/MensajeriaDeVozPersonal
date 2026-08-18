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

set "DEPENDENCY_FILE=package-lock.json"
if not exist "%DEPENDENCY_FILE%" set "DEPENDENCY_FILE=package.json"
set "DEPENDENCY_MARKER=node_modules\.voice-messaging-dependencies.sha256"
set "CURRENT_DEPENDENCY_HASH="
set "INSTALLED_DEPENDENCY_HASH="

for /f "usebackq delims=" %%H in (`powershell.exe -NoProfile -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath '%DEPENDENCY_FILE%').Hash"`) do set "CURRENT_DEPENDENCY_HASH=%%H"
if exist "%DEPENDENCY_MARKER%" set /p INSTALLED_DEPENDENCY_HASH=<"%DEPENDENCY_MARKER%"

set "INSTALL_DEPENDENCIES=1"
if defined CURRENT_DEPENDENCY_HASH if exist "node_modules" if /I "%CURRENT_DEPENDENCY_HASH%"=="%INSTALLED_DEPENDENCY_HASH%" set "INSTALL_DEPENDENCIES=0"

if "%INSTALL_DEPENDENCIES%"=="0" (
    call :log "package-lock.json no cambio. Se omite npm install."
) else (
    call :install_dependencies
    if errorlevel 1 exit /b 1
)

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

:install_dependencies
call :log "INICIO: npm install"
echo.
echo [%DATE% %TIME%] npm install
echo ------------------------------------------------------------
cmd /C npm install 2>&1
set "RESULT=%ERRORLEVEL%"
call :log "FIN: npm install. Codigo: %RESULT%"
if not "%RESULT%"=="0" exit /b %RESULT%

if not exist "node_modules" mkdir "node_modules"
> "%DEPENDENCY_MARKER%" echo %CURRENT_DEPENDENCY_HASH%
exit /b 0

:log
echo [%DATE% %TIME%] %~1
>> "%LOG_FILE%" echo [%DATE% %TIME%] %~1
exit /b 0
