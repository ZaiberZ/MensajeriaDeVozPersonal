@echo off
setlocal

set "APP_DIR=%~dp0"
set "LOG_DIR=%ProgramData%\VoiceMessaging"
set "LOG_FILE=%LOG_DIR%\airbnb-launch.log"
set "LOCK_DIR=%LOG_DIR%\airbnb-launch.lock"
set "AIRBNB_PROFILE=%ProgramData%\VoiceMessaging\airbnb-auth"
set "AIRBNB_URL=https://www.airbnb.com/hosting/messages/"
set "AIRBNB_ACTION=%~1"
set "CHROME_EXE="
set "CHROME_DIR="
set "PACKAGED_CHROME_EXE="

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul
if not exist "%LOG_DIR%" (
    echo No se pudo crear %LOG_DIR%. Ejecuta el instalador actualizado para corregir permisos.
    pause
    exit /b 1
)

copy /Y NUL "%LOG_DIR%\airbnb-permission-test.tmp" >nul 2>nul
if errorlevel 1 (
    echo No hay permisos para escribir en %LOG_DIR%.
    echo Ejecuta el instalador actualizado para corregir permisos de ProgramData.
    pause
    exit /b 1
)
del "%LOG_DIR%\airbnb-permission-test.tmp" >nul 2>nul

call :log "Iniciando lanzador de Airbnb."

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '%LOCK_DIR%') { $item = Get-Item '%LOCK_DIR%'; if ($item.LastWriteTime -lt (Get-Date).AddMinutes(-5)) { Remove-Item '%LOCK_DIR%' -Recurse -Force } }" 2>nul
mkdir "%LOCK_DIR%" 2>nul
if errorlevel 1 (
    call :log "Ya hay otro lanzador de Airbnb en ejecucion. Se omite este intento."
    exit /b 0
)

call :log "APP_DIR=%APP_DIR%"
call :log "AIRBNB_PROFILE=%AIRBNB_PROFILE%"
call :log "AIRBNB_ACTION=%AIRBNB_ACTION%"

echo "%AIRBNB_ACTION%" | find /I "login" >nul
if not errorlevel 1 (
    set "AIRBNB_URL=https://www.airbnb.com/login"
)

echo "%AIRBNB_ACTION%" | find /I "startup" >nul
if not errorlevel 1 (
    call :log "Arranque automatico detectado. Esperando 60 segundos para no interferir con WhatsApp."
    timeout /T 60 /NOBREAK >nul
)

for /d %%D in ("%APP_DIR%WhatsAppGateway\.cache\chrome\*") do (
    if exist "%%D\chrome-win64\chrome.exe" (
        set "PACKAGED_CHROME_EXE=%%D\chrome-win64\chrome.exe"
        call :log "Chrome empaquetado encontrado: %%D\chrome-win64\chrome.exe"
    )
)

if defined PACKAGED_CHROME_EXE call :tryChrome "%PACKAGED_CHROME_EXE%" "Chrome empaquetado"
if not defined CHROME_EXE if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" call :tryChrome "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "Chrome de Program Files"
if not defined CHROME_EXE if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" call :tryChrome "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "Chrome de Program Files x86"
if not defined CHROME_EXE if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" call :tryChrome "%LocalAppData%\Google\Chrome\Application\chrome.exe" "Chrome de LocalAppData"

if not defined CHROME_EXE (
    call :log "No se encontro Chrome."
    echo No se encontro Chrome. Reinstala Voice Messaging o instala Google Chrome.
    pause
    rd "%LOCK_DIR%" 2>nul
    exit /b 1
)

for %%I in ("%CHROME_EXE%") do set "CHROME_DIR=%%~dpI"
call :log "Usando Chrome: %CHROME_EXE%"
call :log "Directorio de Chrome: %CHROME_DIR%"
call :log "URL de Airbnb: %AIRBNB_URL%"

if not exist "%AIRBNB_PROFILE%" (
    mkdir "%AIRBNB_PROFILE%" 2>nul
    if not exist "%AIRBNB_PROFILE%" (
        call :log "No se pudo crear el perfil de Airbnb por permisos."
        echo No se pudo crear %AIRBNB_PROFILE%.
        echo Ejecuta el instalador actualizado para corregir permisos de ProgramData.
        pause
        rd "%LOCK_DIR%" 2>nul
        exit /b 1
    )
    call :log "Perfil de Airbnb creado."
)

call :log "Abriendo Airbnb con remote debugging en 127.0.0.1:9223."
call :log "Comando: start /D %CHROME_DIR% %CHROME_EXE% --remote-debugging-port=9223 --user-data-dir=%AIRBNB_PROFILE% %AIRBNB_URL%"

if /I "%AIRBNB_URL%"=="https://www.airbnb.com/hosting/messages/" (
    call :log "Buscando pestaña existente de mensajes de Airbnb."
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$targets = Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/list' -TimeoutSec 1; $target = @($targets | Where-Object { $_.url -like '*airbnb*hosting/messages*' } | Select-Object -First 1)[0]; if ($target) { Invoke-RestMethod -Uri ('http://127.0.0.1:9223/json/activate/' + $target.id) -TimeoutSec 1 | Out-Null; exit 0 }; exit 1" 2>nul
    if "%ERRORLEVEL%"=="0" (
        call :log "Pestaña existente de mensajes activada."
        rd "%LOCK_DIR%" 2>nul
        exit /b 0
    ) else (
        call :log "No se encontro una pestaña existente de mensajes. Se abrira Chrome."
    )
)

start "" /D "%CHROME_DIR%" "%CHROME_EXE%" "--remote-debugging-address=127.0.0.1" "--remote-debugging-port=9223" "--no-first-run" "--user-data-dir=%AIRBNB_PROFILE%" "%AIRBNB_URL%"
call :log "start devolvio ERRORLEVEL=%ERRORLEVEL%"
rd "%LOCK_DIR%" 2>nul
exit /b 0

:log
>> "%LOG_FILE%" echo [%date% %time%] %~1
exit /b 0

:tryChrome
"%~1" --version >nul 2>nul
if "%ERRORLEVEL%"=="0" (
    set "CHROME_EXE=%~1"
    call :log "%~2 validado: %~1"
) else (
    call :log "%~2 no pudo ejecutarse. ERRORLEVEL=%ERRORLEVEL%. Se probara otro Chrome si existe."
)
exit /b 0
