; Mirrai — Windows installer
;
; Packages the self-contained bundle (Node.js, PostgreSQL, the server) and
; installs a small GUI launcher that shows progress while Mirrai starts.
; PrivilegesRequired=lowest keeps the install in the user profile, so no
; administrator rights are needed and PostgreSQL is never started elevated.

#define MyAppName "Mirrai"
; The version is the app's own — it is passed in by the build, out of
; package.json. The number here was a copy, and it went stale the moment
; the app was released: the installer said 1.3.0 whatever the app was.
; The fallback is only for a hand-run of the compiler.
#ifndef MyAppVersion
  #define MyAppVersion "1.3.0"
#endif
#define MyAppPublisher "Ch1rpy2613"
#define MyAppURL "https://github.com/Ch1rpy2613/Mirrai"
#define MyAppExeName "Mirrai.exe"
; The command script is always in the bundle. It is what starts the app
; when the GUI launcher could not be built — the build needs the .NET SDK
; for that, and says so when it is not there.
#define MyAppCmdName "Mirrai.cmd"

; The build passes these in as absolute paths. A relative path that climbs out
; of the script directory ends up in the middle of every file name the
; compiler touches, which Windows refuses to open once it gets long.
#ifndef MyAppBundle
  #define MyAppBundle "..\build-windows\Mirrai-Windows-x64"
#endif
#ifndef MyAppOutputDir
  #define MyAppOutputDir "..\build-windows"
#endif
#ifndef MyAppLicense
  #define MyAppLicense "..\LICENSE"
#endif

[Setup]
AppId={{A3F7C2E1-9B4D-4C6A-A1E3-5D8B7F2C9E04}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir={#MyAppOutputDir}
OutputBaseFilename=Mirrai-Setup-x64
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=110
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=mirrai.ico
LicenseFile={#MyAppLicense}
SetupLogging=yes
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "chinese"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
chinese.CreateDesktopIcon=创建桌面快捷方式
chinese.LaunchProgram=启动 {#MyAppName}
chinese.LaunchProgramAfter=启动 {#MyAppName}
chinese.WelcomeLabel2=这会安装 Mirrai 和它自带的运行环境（Node.js、PostgreSQL 与 Redis）。不需要管理员权限，也不需要另外下载什么。

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#MyAppBundle}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; The shortcut points at the GUI launcher when the bundle has one, and at
; the command script when it does not. It used to point at the launcher
; either way — and a shortcut to a file that is not there starts nothing
; at all, so an install built without the .NET SDK could not be started
; from the Start menu.
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Check: LauncherPresent
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppCmdName}"; Check: not LauncherPresent
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; Check: LauncherPresent
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppCmdName}"; Tasks: desktopicon; Check: not LauncherPresent

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent; Check: LauncherPresent
Filename: "{app}\{#MyAppCmdName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent; Check: not LauncherPresent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app\node_modules"

[Code]
{ Whether the bundle has the GUI launcher.
  The build needs the .NET SDK to make one, and skips it when the SDK is
  not there — so the installer cannot assume it is there. }
function LauncherPresent: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}') + '\' + '{#MyAppExeName}');
end;
