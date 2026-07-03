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
Filename: "{sys}\sc.exe"; Parameters: "create VoiceMessagingWorker binPath= ""{app}\VoiceMessaging.Worker.exe"" start= auto"; Flags: runhidden
Filename: "{sys}\sc.exe"; Parameters: "start VoiceMessagingWorker"; Flags: runhidden

[UninstallRun]
Filename: "{sys}\sc.exe"; Parameters: "stop VoiceMessagingWorker"; Flags: runhidden
Filename: "{sys}\sc.exe"; Parameters: "delete VoiceMessagingWorker"; Flags: runhidden