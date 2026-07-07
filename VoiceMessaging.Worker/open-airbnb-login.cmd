@echo off
setlocal

set "APP_DIR=%~dp0"
set "LOG_DIR=%ProgramData%\VoiceMessaging"
set "LOG_FILE=%LOG_DIR%\airbnb-launch.log"
set "AIRBNB_PROFILE=%ProgramData%\VoiceMessaging\airbnb-auth"
set "AIRBNB_URL=https://www.airbnb.com/login"
set "AIRBNB_ACTION=%~1"
set "CHROME_EXE="
set "CHROME_DIR="

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
call :log "Iniciando lanzador de Airbnb."
call :log "APP_DIR=%APP_DIR%"
call :log "AIRBNB_PROFILE=%AIRBNB_PROFILE%"
call :log "AIRBNB_ACTION=%AIRBNB_ACTION%"

echo "%AIRBNB_ACTION%" | find /I "messages" >nul
if not errorlevel 1 set "AIRBNB_URL=https://www.airbnb.com/hosting/messages/"

for /d %%D in ("%APP_DIR%WhatsAppGateway\.cache\chrome\*") do (
    if exist "%%D\chrome-win64\chrome.exe" (
        set "CHROME_EXE=%%D\chrome-win64\chrome.exe"
        call :log "Chrome empaquetado encontrado: %%D\chrome-win64\chrome.exe"
    )
)

if not defined CHROME_EXE if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME_EXE if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"

if not defined CHROME_EXE (
    call :log "No se encontro Chrome."
    echo No se encontro Chrome. Reinstala Voice Messaging o instala Google Chrome.
    pause
    exit /b 1
)

for %%I in ("%CHROME_EXE%") do set "CHROME_DIR=%%~dpI"
call :log "Usando Chrome: %CHROME_EXE%"
call :log "Directorio de Chrome: %CHROME_DIR%"

if not exist "%AIRBNB_PROFILE%" (
    mkdir "%AIRBNB_PROFILE%"
    call :log "Perfil de Airbnb creado."
)

call :log "Abriendo Airbnb con remote debugging en 127.0.0.1:9223."
call :log "Comando: start /D %CHROME_DIR% %CHROME_EXE% --remote-debugging-port=9223 --user-data-dir=%AIRBNB_PROFILE% %AIRBNB_URL%"

if /I "%AIRBNB_URL%"=="https://www.airbnb.com/hosting/messages/" (
    call :log "Buscando pestaña existente de mensajes de Airbnb."
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$targets = Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/list' -TimeoutSec 1; $target = @($targets | Where-Object { $_.url -like '*airbnb*hosting/messages*' } | Select-Object -First 1)[0]; if ($target) { Invoke-RestMethod -Uri ('http://127.0.0.1:9223/json/activate/' + $target.id) -TimeoutSec 1 | Out-Null; exit 0 }; exit 1"
    if "%ERRORLEVEL%"=="0" (
        call :log "Pestaña existente de mensajes activada."
        exit /b 0
    )
    call :log "No se encontro una pestaña existente de mensajes. Se abrira Chrome."
)

start "" /D "%CHROME_DIR%" "%CHROME_EXE%" "--remote-debugging-address=127.0.0.1" "--remote-debugging-port=9223" "--no-first-run" "--user-data-dir=%AIRBNB_PROFILE%" "%AIRBNB_URL%"
call :log "start devolvio ERRORLEVEL=%ERRORLEVEL%"
exit /b 0

:log
>> "%LOG_FILE%" echo [%date% %time%] %~1
exit /b 0
