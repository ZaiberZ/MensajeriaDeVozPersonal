[Setup]
AppName=Voice Messaging
AppVersion=1.0
DefaultDirName={autopf}\VoiceMessaging
DefaultGroupName=Voice Messaging
OutputDir=D:\Publish
OutputBaseFilename=VoiceMessagingInstaller
Compression=lzma
SolidCompression=yes
PrivilegesRequired=admin

[Files]
Source: "D:\Publish\VoiceMessaging\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Run]
Filename: "cmd.exe"; Parameters: "/C npm install"; WorkingDir: "{app}\WhatsAppGateway"; StatusMsg: "Instalando dependencias de Node.js..."; Flags: waituntilterminated
Filename: "{sys}\sc.exe"; Parameters: "create VoiceMessagingWorker binPath= ""{app}\VoiceMessaging.Worker.exe"" start= auto"; Flags: runhidden
Filename: "{sys}\sc.exe"; Parameters: "start VoiceMessagingWorker"; Flags: runhidden

Filename: "{cmd}"; Parameters: "/C timeout /T 6 /NOBREAK"; Flags: runhidden waituntilterminated
Filename: "http://localhost:3000/qr"; Description: "Abrir página de autenticación de WhatsApp"; Flags: shellexec postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\sc.exe"; Parameters: "stop VoiceMessagingWorker"; Flags: runhidden
Filename: "{sys}\sc.exe"; Parameters: "delete VoiceMessagingWorker"; Flags: runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]

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