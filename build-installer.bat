@echo off
setlocal

echo ================================
echo  Generando instalador
echo ================================

set SOLUTION_DIR=%~dp0
set WORKER_PROJECT=%SOLUTION_DIR%VoiceMessaging.Worker\VoiceMessaging.Worker.csproj
set GATEWAY_DIR=%SOLUTION_DIR%WhatsAppGateway
set OUTPUT_DIR=D:\Publish
set PUBLISH_DIR=%OUTPUT_DIR%\VoiceMessaging
set INSTALLER_SCRIPT=%SOLUTION_DIR%Installer\VoiceMessagingInstaller.iss
set INNO_COMPILER=C:\Users\cator\AppData\Local\Programs\Inno Setup 6\ISCC.exe

echo.
echo Limpiando carpeta publish...
if exist "%PUBLISH_DIR%" rmdir /s /q "%PUBLISH_DIR%"
mkdir "%PUBLISH_DIR%"

echo.
echo Publicando Worker...
dotnet publish "%WORKER_PROJECT%" -c Release -r win-x64 --self-contained true -o "%PUBLISH_DIR%"

if errorlevel 1 (
    echo Error publicando Worker.
    pause
    exit /b 1
)

:: echo.
:: echo Copiando WhatsAppGateway...
::  xcopy "%GATEWAY_DIR%" "%PUBLISH_DIR%\WhatsAppGateway\" /Q /E /I /Y

echo.
echo Reemplazando appsettings.json por appsettings.Development.json...

copy /Y "%PUBLISH_DIR%\appsettings.Development.json" "%PUBLISH_DIR%\appsettings.json"

if errorlevel 1 (
    echo Error reemplazando appsettings.json.
    pause
    exit /b 1
)

echo.
echo Eliminando carpetas que no deben ir en instalador...
if exist "%PUBLISH_DIR%\WhatsAppGateway\data\auth" rmdir /s /q "%PUBLISH_DIR%\WhatsAppGateway\data\auth"
if exist "%PUBLISH_DIR%\WhatsAppGateway\.wwebjs_auth" rmdir /s /q "%PUBLISH_DIR%\WhatsAppGateway\.wwebjs_auth"
if exist "%PUBLISH_DIR%\WhatsAppGateway\.wwebjs_cache" rmdir /s /q "%PUBLISH_DIR%\WhatsAppGateway\.wwebjs_cache"
if exist "%PUBLISH_DIR%\WhatsAppGateway\node_modules" rmdir /S /Q "%PUBLISH_DIR%\WhatsAppGateway\node_modules"

echo.
echo Compilando instalador...
"%INNO_COMPILER%" "%INSTALLER_SCRIPT%"

if errorlevel 1 (
    echo Error compilando instalador.
    pause
    exit /b 1
)

echo.
echo Eliminando carpeta temporal de publicacion...
if exist "%PUBLISH_DIR%" rmdir /s /q "%PUBLISH_DIR%"

if exist "%PUBLISH_DIR%" (
    echo Advertencia: no fue posible eliminar "%PUBLISH_DIR%".
)

echo.
echo ================================
echo  Instalador generado correctamente
echo ================================
echo  Ubicacion: %OUTPUT_DIR%
echo.

start "" explorer.exe "%OUTPUT_DIR%"
endlocal
