#ifndef InstallerOutputDir
  #define InstallerOutputDir "D:\Publish"
#endif

#ifndef InstallerSourceDir
  #ifdef InstallerSource
    ; Compatibilidad con scripts existentes que envían InstallerSource terminado en \*.
    #define InstallerSourceDir ExtractFileDir(InstallerSource)
  #else
    #define InstallerSourceDir "D:\Publish\VoiceMessaging"
  #endif
#endif

#ifndef EnvironmentFile
  #define EnvironmentFile "..\.env.local"
#endif

[Setup]
AppName=Voice Messaging
AppVersion=1.0
DefaultDirName={autopf}\VoiceMessaging
DefaultGroupName=Voice Messaging
OutputDir={#InstallerOutputDir}
OutputBaseFilename=VoiceMessagingInstaller
; La compresión no sólida permite saltar binarios iguales sin descomprimir
; todo el bloque anterior. El modo rápido prioriza reinstalaciones ágiles.
Compression=lzma2/fast
SolidCompression=no
PrivilegesRequired=admin

[Files]
; Los binarios versionados se conservan cuando versión y contenido coinciden.
; Se excluye el Gateway para no empaquetar accidentalmente node_modules o Chrome.
Source: "{#InstallerSourceDir}\*.dll"; DestDir: "{app}"; Excludes: "\WhatsAppGateway\*"; Flags: recursesubdirs replacesameversion
Source: "{#InstallerSourceDir}\*.exe"; DestDir: "{app}"; Excludes: "\WhatsAppGateway\*"; Flags: recursesubdirs replacesameversion

; Archivos .NET sin versión, como deps.json y runtimeconfig.json.
Source: "{#InstallerSourceDir}\*"; DestDir: "{app}"; Excludes: "*.dll,*.exe,\WhatsAppGateway\*"; Flags: recursesubdirs ignoreversion

; El código y los recursos del Gateway siempre se actualizan, pero sus
; dependencias y el navegador descargado se conservan entre reinstalaciones.
Source: "{#InstallerSourceDir}\WhatsAppGateway\*"; DestDir: "{app}\WhatsAppGateway"; Excludes: "\node_modules\*,\.cache\*,\.wwebjs_cache\*"; Flags: recursesubdirs ignoreversion
Source: "AlexaWhatsApp.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "Install Gateway Dependencies.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#EnvironmentFile}"; DestDir: "{commonappdata}\VoiceMessaging"; DestName: "environment.env"; Flags: ignoreversion

[Dirs]
Name: "{commonappdata}\VoiceMessaging"; Permissions: users-modify
Name: "{commonappdata}\VoiceMessaging\airbnb-auth"; Permissions: users-modify
Name: "{commonappdata}\VoiceMessaging\whatsapp-auth"; Permissions: users-modify

[Icons]
;Name: "{commondesktop}\Voice Messaging QR"; Filename: "http://localhost:3000/status"; IconFilename: "{app}\AlexaWhatsApp.ico"
Name: "{commondesktop}\WhatsApp Gateway"; Filename: "http://whatsappgateway:3000/app-status"; IconFilename: "{app}\AlexaWhatsApp.ico"
;Name: "{commondesktop}\Abrir Airbnb"; Filename: "{cmd}"; Parameters: "/C ""{app}\open-airbnb-login.cmd"""; WorkingDir: "{app}"; IconFilename: "{app}\AlexaWhatsApp.ico"
; Pausado por ahora: no abrir Airbnb automaticamente al iniciar Windows.
;Name: "{commonstartup}\Voice Messaging Airbnb"; Filename: "{cmd}"; Parameters: "/C ""{app}\open-airbnb-login.cmd"" voicemessaging-airbnb://startup"; WorkingDir: "{app}"; IconFilename: "{app}\AlexaWhatsApp.ico"

[Registry]
Root: HKCR; Subkey: "voicemessaging-airbnb"; ValueType: string; ValueData: "URL:Voice Messaging Airbnb Login"; Flags: uninsdeletekey
Root: HKCR; Subkey: "voicemessaging-airbnb"; ValueName: "URL Protocol"; ValueType: string; ValueData: ""
Root: HKCR; Subkey: "voicemessaging-airbnb\shell\open\command"; ValueType: string; ValueData: """{cmd}"" /C """"{app}\open-airbnb-login.cmd"" ""%1"""""

[Run]
Filename: "{cmd}"; Parameters: "/C """"{app}\Install Gateway Dependencies.bat"" ""{app}\WhatsAppGateway"""""; WorkingDir: "{app}\WhatsAppGateway"; StatusMsg: "Instalando dependencias del Gateway..."; Flags: waituntilterminated
;Filename: "{sys}\icacls.exe"; Parameters: """{commonappdata}\VoiceMessaging"" /grant *S-1-5-32-545:(OI)(CI)M /C"; Flags: runhidden waituntilterminated
Filename: "{sys}\icacls.exe"; Parameters: """{commonappdata}\VoiceMessaging\environment.env"" /inheritance:r /grant:r *S-1-5-18:F *S-1-5-32-544:F"; Flags: runhidden waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "create VoiceMessagingWorker binPath= ""{app}\VoiceMessaging.Worker.exe"" start= auto"; Flags: runhidden
Filename: "{sys}\sc.exe"; Parameters: "start VoiceMessagingWorker"; Flags: runhidden

; Pausado por ahora: no lanzar el Chrome separado de Airbnb durante la instalacion.
;Filename: "{cmd}"; Parameters: "/C ""{app}\open-airbnb-login.cmd"" voicemessaging-airbnb://startup"; WorkingDir: "{app}"; Flags: runhidden nowait
Filename: "http://whatsappgateway:3000/whatsapp/qr"; Description: "Abrir página de autenticación de WhatsApp"; Flags: shellexec postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\sc.exe"; Parameters: "stop VoiceMessagingWorker"; Flags: runhidden waituntilterminated
Filename: "{cmd}"; Parameters: "/C timeout /T 3 /NOBREAK"; Flags: runhidden waituntilterminated
Filename: "taskkill.exe"; Parameters: "/F /IM node.exe"; Flags: runhidden
Filename: "{sys}\sc.exe"; Parameters: "delete VoiceMessagingWorker"; Flags: runhidden waituntilterminated

[UninstallDelete]
; La autenticacion de WhatsApp, los datos del usuario y los logs se guardan en
; {commonappdata}\VoiceMessaging y se conservan intencionalmente al desinstalar.
; No se borra {app} completo para conservar dependencias y Chrome descargados
; durante la instalacion: {app}\WhatsAppGateway\node_modules y
; {app}\WhatsAppGateway\.cache. Inno Setup elimina automaticamente los archivos
; instalados desde [Files].
Type: dirifempty; Name: "{app}\WhatsAppGateway"
Type: dirifempty; Name: "{app}"

[Code]

const
  WhatsAppGatewayHostLine =
    '127.0.0.1 whatsappgateway # VoiceMessaging WhatsApp Gateway';

function IsWhatsAppGatewayHostLine(const Line: String): Boolean;
begin
  Result := CompareText(Trim(Line), WhatsAppGatewayHostLine) = 0;
end;

procedure RemoveWhatsAppGatewayHostAlias();
var
  HostsPath: String;
  Lines: TArrayOfString;
  FilteredLines: TArrayOfString;
  I: Integer;
  OutputIndex: Integer;
  Changed: Boolean;
begin
  HostsPath := ExpandConstant('{sys}\drivers\etc\hosts');

  if not LoadStringsFromFile(HostsPath, Lines) then
  begin
    Log('No fue posible leer el archivo hosts: ' + HostsPath);
    Exit;
  end;

  SetArrayLength(FilteredLines, GetArrayLength(Lines));
  OutputIndex := 0;
  Changed := False;

  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    if IsWhatsAppGatewayHostLine(Lines[I]) then
      Changed := True
    else
    begin
      FilteredLines[OutputIndex] := Lines[I];
      OutputIndex := OutputIndex + 1;
    end;
  end;

  if not Changed then
    Exit;

  SetArrayLength(FilteredLines, OutputIndex);
  if SaveStringsToFile(HostsPath, FilteredLines, False) then
    Log('Se elimino el alias local whatsappgateway.')
  else
    Log('No fue posible eliminar el alias local whatsappgateway.');
end;

procedure InstallWhatsAppGatewayHostAlias();
var
  HostsPath: String;
  Lines: TArrayOfString;
  I: Integer;
begin
  HostsPath := ExpandConstant('{sys}\drivers\etc\hosts');

  if not LoadStringsFromFile(HostsPath, Lines) then
  begin
    Log('No fue posible leer el archivo hosts: ' + HostsPath);
    Exit;
  end;

  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    if IsWhatsAppGatewayHostLine(Lines[I]) then
    begin
      Log('El alias local whatsappgateway ya estaba registrado.');
      Exit;
    end;
  end;

  SetArrayLength(Lines, GetArrayLength(Lines) + 1);
  Lines[GetArrayLength(Lines) - 1] := WhatsAppGatewayHostLine;

  if SaveStringsToFile(HostsPath, Lines, False) then
    Log('Se registro el alias local whatsappgateway.')
  else
    Log('No fue posible registrar el alias local whatsappgateway.');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    InstallWhatsAppGatewayHostAlias();
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    RemoveWhatsAppGatewayHostAlias();
end;

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
