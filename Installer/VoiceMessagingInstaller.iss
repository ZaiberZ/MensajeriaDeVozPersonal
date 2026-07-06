#ifndef InstallerOutputDir
  #define InstallerOutputDir "D:\Publish"
#endif

#ifndef InstallerSource
  #define InstallerSource "D:\Publish\VoiceMessaging\*"
#endif

[Setup]
AppName=Voice Messaging
AppVersion=1.0
DefaultDirName={autopf}\VoiceMessaging
DefaultGroupName=Voice Messaging
OutputDir={#InstallerOutputDir}
OutputBaseFilename=VoiceMessagingInstaller
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin

[Files]
Source: "{#InstallerSource}"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "AlexaWhatsApp.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{commondesktop}\Voice Messaging QR"; Filename: "http://localhost:3000/status"; IconFilename: "{app}\AlexaWhatsApp.ico"
Name: "{commondesktop}\Estado de Voice Messaging"; Filename: "http://localhost:3000/app-status"; IconFilename: "{app}\AlexaWhatsApp.ico"
Name: "{commondesktop}\Abrir Airbnb"; Filename: "http://localhost:3000/airbnb/login"; IconFilename: "{app}\AlexaWhatsApp.ico"

[Run]
Filename: "cmd.exe"; Parameters: "/C npm install"; WorkingDir: "{app}\WhatsAppGateway"; StatusMsg: "Instalando dependencias de Node.js..."; Flags: waituntilterminated
Filename: "cmd.exe"; Parameters: "/C if exist ""{app}\WhatsAppGateway\.cache\chrome"" rmdir /S /Q ""{app}\WhatsAppGateway\.cache\chrome"""; StatusMsg: "Preparando instalación de Chrome..."; Flags: runhidden waituntilterminated
Filename: "cmd.exe"; Parameters: "/C ""set PUPPETEER_CACHE_DIR={app}\WhatsAppGateway\.cache&& npx puppeteer browsers install chrome > chrome-install.log 2>&1"""; WorkingDir: "{app}\WhatsAppGateway"; Flags: waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "create VoiceMessagingWorker binPath= ""{app}\VoiceMessaging.Worker.exe"" start= auto"; Flags: runhidden
Filename: "{sys}\sc.exe"; Parameters: "start VoiceMessagingWorker"; Flags: runhidden

Filename: "{cmd}"; Parameters: "/C timeout /T 6 /NOBREAK"; Flags: runhidden waituntilterminated
Filename: "http://localhost:3000/whatsapp/qr"; Description: "Abrir página de autenticación de WhatsApp"; Flags: shellexec postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\sc.exe"; Parameters: "stop VoiceMessagingWorker"; Flags: runhidden waituntilterminated
Filename: "{cmd}"; Parameters: "/C timeout /T 3 /NOBREAK"; Flags: runhidden waituntilterminated
Filename: "taskkill.exe"; Parameters: "/F /IM node.exe"; Flags: runhidden
Filename: "{sys}\sc.exe"; Parameters: "delete VoiceMessagingWorker"; Flags: runhidden waituntilterminated

[UninstallDelete]
; La autenticacion de WhatsApp, los datos del usuario y los logs se guardan en
; {commonappdata}\VoiceMessaging y se conservan intencionalmente al desinstalar.
Type: filesandordirs; Name: "{app}"

[Code]

const
  ServiceName = 'VoiceMessagingWorker';

function ServiceExists(): Boolean;
begin
  Result := RegKeyExists(HKEY_LOCAL_MACHINE,
    'SYSTEM\CurrentControlSet\Services\' + ServiceName);
end;

function StopNodeProcesses(): Boolean;
var
  ResultCode: Integer;
begin
  { El gateway se ejecuta con Node.js. En este equipo de un solo usuario es
    seguro cerrar todas las instancias antes de reemplazar sus archivos. }
  Result := Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM node.exe', '',
    SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { taskkill devuelve 128 cuando no hay ningun node.exe en ejecucion. }
  Result := Result and ((ResultCode = 0) or (ResultCode = 128));
end;

function WaitUntilServiceStops(): Boolean;
var
  I: Integer;
  ResultCode: Integer;
begin
  Result := False;

  for I := 1 to 30 do
  begin
    if Exec(ExpandConstant('{cmd}'),
      '/C sc.exe query ' + ServiceName + ' | find "STOPPED" >nul', '',
      SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0) then
    begin
      Result := True;
      Exit;
    end;

    Sleep(1000);
  end;
end;

function WaitUntilServiceIsRemoved(): Boolean;
var
  I: Integer;
begin
  Result := False;

  for I := 1 to 30 do
  begin
    if not ServiceExists() then
    begin
      Result := True;
      Exit;
    end;

    Sleep(1000);
  end;
end;

function RemoveExistingService(): String;
var
  ResultCode: Integer;
begin
  Result := '';

  if not ServiceExists() then
    Exit;

  { Se detiene primero WhatsAppGateway y enseguida el Worker para impedir que
    queden procesos usando los archivos que el instalador va a reemplazar. }
  if not StopNodeProcesses() then
  begin
    Result := 'No fue posible detener WhatsAppGateway.';
    Exit;
  end;

  if not Exec(ExpandConstant('{sys}\sc.exe'), 'stop ' + ServiceName, '',
    SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Result := 'No fue posible solicitar la detencion del servicio existente.';
    Exit;
  end;

  { 1062 significa que el servicio ya estaba detenido. }
  if (ResultCode <> 0) and (ResultCode <> 1062) then
  begin
    Result := 'No fue posible detener el servicio existente. Codigo: ' +
      IntToStr(ResultCode) + '.';
    Exit;
  end;

  if (ResultCode = 0) and not WaitUntilServiceStops() then
  begin
    Result := 'El servicio existente no se detuvo dentro del tiempo esperado.';
    Exit;
  end;

  { El Worker podria haber intentado reabrir el gateway durante la detencion. }
  if not StopNodeProcesses() then
  begin
    Result := 'No fue posible confirmar el cierre de WhatsAppGateway.';
    Exit;
  end;

  if not Exec(ExpandConstant('{sys}\sc.exe'), 'delete ' + ServiceName, '',
    SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    Result := 'No fue posible eliminar el servicio existente. Codigo: ' +
      IntToStr(ResultCode) + '.';
    Exit;
  end;

  if not WaitUntilServiceIsRemoved() then
  begin
    Result := 'El servicio existente quedo pendiente de eliminacion.';
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := RemoveExistingService();
end;

function IsNodeInstalled(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec('cmd.exe','/C node -v','',SW_HIDE,ewWaitUntilTerminated,ResultCode);

  Result := Result and (ResultCode = 0);
end;

function InitializeSetup(): Boolean;
begin
  if not IsNodeInstalled() then
  begin
    MsgBox(
      'Node.js no está instalado.' + #13#10#13#10 +
      'Instale Node.js 20 LTS o superior antes de continuar.',
      mbError, MB_OK);

    Result := False;
    Exit;
  end;

  Result := True;
end;
