@echo off
setlocal

set "APP_DIR=%~dp0"
set "LOG_DIR=%ProgramData%\VoiceMessaging"
set "LOG_FILE=%LOG_DIR%\airbnb-launch.log"
set "AIRBNB_PROFILE=%ProgramData%\VoiceMessaging\airbnb-auth"
set "AIRBNB_URL=https://www.airbnb.com/login"
set "CHROME_EXE="
set "CHROME_DIR="

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
call :log "Iniciando lanzador de Airbnb."
call :log "APP_DIR=%APP_DIR%"
call :log "AIRBNB_PROFILE=%AIRBNB_PROFILE%"

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

start "" /D "%CHROME_DIR%" "%CHROME_EXE%" "--remote-debugging-address=127.0.0.1" "--remote-debugging-port=9223" "--no-first-run" "--user-data-dir=%AIRBNB_PROFILE%" "%AIRBNB_URL%"
call :log "start devolvio ERRORLEVEL=%ERRORLEVEL%"
exit /b 0

:log
>> "%LOG_FILE%" echo [%date% %time%] %~1
exit /b 0
