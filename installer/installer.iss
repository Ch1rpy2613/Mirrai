; Mirrai — Windows installer
;
; Packages the self-contained bundle (Node.js, PostgreSQL, the server) and
; installs a small GUI launcher that shows progress while Mirrai starts.
; PrivilegesRequired=lowest keeps the install in the user profile, so no
; administrator rights are needed and PostgreSQL is never started elevated.

#define MyAppName "Mirrai"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "Ch1rpy2613"
#define MyAppURL "https://github.com/Ch1rpy2613/Mirrai"
#define MyAppExeName "Mirrai.exe"
#define MyAppBundle "..\build-windows\Mirrai-Windows-x64"

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
OutputDir=..\build-windows
OutputBaseFilename=Mirrai-Setup-x64
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=110
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\{#MyAppExeName}
LicenseFile=..\LICENSE
SetupLogging=yes
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "chinese"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
chinese.CreateDesktopIcon=创建桌面快捷方式
chinese.LaunchProgram=启动 {#MyAppName}
chinese.LaunchProgramAfter=启动 {#MyAppName}
chinese.WelcomeLabel2=这会安装 Mirrai 和它自带的运行环境（Node.js 与 PostgreSQL）。不需要管理员权限。

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#MyAppBundle}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\app\node_modules"
