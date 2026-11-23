; ARBS-H installer (R1a, D-R1a-1): Inno Setup 6 + arbs-h-setup.ps1 helper.
; Build: host/scripts/r1a_package.sh -> ISCC /DAppVer=0.1.0 /DStageDir=<staged portable tree> /DOutDir=<out>
; The stage is the package_portable tree minus scripts\, drivers\sunshine\, drivers\vhf-gamepad\, portable launcher
; and README, plus tools\sunshinesvc.exe (D-R1a-6/7).
; Source of truth for names: src/platform/windows/arbs_h_names.h (service ARBSHService, %ProgramData%\ARBS-H).

#define AppName "ARBS-H"
#ifndef AppVer
  #error AppVer is required, e.g. /DAppVer=0.1.0
#endif
#ifndef StageDir
  #error StageDir is required (staged application tree)
#endif
#ifndef OutDir
  #define OutDir "."
#endif
#ifndef SrcRoot
  #define SrcRoot "..\..\.."
#endif
; Icon slot (R1a decision 3): apollo.ico for 0.1.0; pass /DAppIcon=<path to ARBS-H logo .ico> when a logo exists.
#ifndef AppIcon
  #define AppIcon SrcRoot + "\apollo.ico"
#endif
; Installer identity. NEVER change it (upgrades find the installed copy by it) and never reuse Vibepollo's
; MSI UpgradeCode {E3FA501A-85F8-4187-85A7-D6E6BDC7EDA1}.
#define AppGuid "{C4BAEB21-8867-402E-8101-C7272730F13A}"

[Setup]
AppId={{#AppGuid}
AppName={#AppName}
AppVersion={#AppVer}
AppVerName={#AppName} {#AppVer}
AppPublisher=ARBS project
AppPublisherURL=https://github.com/arbs-project/arbs-h
AppSupportURL=https://github.com/arbs-project/arbs-h/issues
AppUpdatesURL=https://github.com/arbs-project/arbs-h/releases
AppComments=Based on Vibepollo 2.18.9 (Nonary), GPL-3.0
DefaultDirName={autopf}\ARBS-H
DefaultGroupName=ARBS-H
DisableProgramGroupPage=yes
UsePreviousAppDir=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupMutex=ARBS-H-Setup
OutputDir={#OutDir}
OutputBaseFilename=arbs-h-{#AppVer}-setup
Compression=lzma2/max
SolidCompression=yes
SetupIconFile={#AppIcon}
UninstallDisplayIcon={app}\sunshine.exe
UninstallDisplayName=ARBS-H
VersionInfoVersion={#AppVer}.0
VersionInfoProductName=ARBS-H
VersionInfoProductVersion={#AppVer}
VersionInfoCompany=ARBS project
VersionInfoDescription=ARBS-H {#AppVer} Setup
VersionInfoCopyright=GPL-3.0 (Vibepollo 2.18.9 by Nonary, Apollo, Sunshine)
InfoBeforeFile=info-before-ko.txt
CloseApplications=no
RestartApplications=no
WizardStyle=modern
ShowLanguageDialog=no

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; GPL-3.0 and origin notices (CLAUDE.md rule 5): the portable tree does not carry them.
Source: "{#SrcRoot}\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "{#SrcRoot}\NOTICE"; DestDir: "{app}"; DestName: "NOTICE.txt"; Flags: ignoreversion
Source: "{#SrcRoot}\NOTICE-ARBS.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SrcRoot}\README.upstream.md"; DestDir: "{app}"; Flags: ignoreversion
; R1b (R-02): license texts for the bundled SudoVDA driver.
Source: "licenses\*.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "sunshine.conf"; DestDir: "{app}\config-template"; Flags: ignoreversion
Source: "arbs-h-setup.ps1"; DestDir: "{app}\tools\arbs-h"; Flags: ignoreversion
Source: "arbs-h-rollback.ps1"; DestDir: "{app}\tools\arbs-h"; Flags: ignoreversion
Source: "arbs-h-rollback.cmd"; DestDir: "{app}\tools\arbs-h"; Flags: ignoreversion
Source: "arbs-h-collect-logs.cmd"; DestDir: "{app}\tools\arbs-h"; Flags: ignoreversion
Source: "arbs-h-snapshot.cmd"; DestDir: "{app}\tools\arbs-h"; Flags: ignoreversion
; The rollback tool stays after uninstall (Vibepollo can still be restored from here).
Source: "arbs-h-setup.ps1"; DestDir: "{commonappdata}\ARBS-H\rollback"; Flags: ignoreversion uninsneveruninstall
Source: "arbs-h-rollback.ps1"; DestDir: "{commonappdata}\ARBS-H\rollback"; Flags: ignoreversion uninsneveruninstall
Source: "arbs-h-rollback.cmd"; DestDir: "{commonappdata}\ARBS-H\rollback"; Flags: ignoreversion uninsneveruninstall

[Icons]
Name: "{group}\ARBS-H 웹 UI 열기"; Filename: "{app}\sunshine.exe"; Parameters: "--shortcut"; WorkingDir: "{app}"
Name: "{group}\ARBS-H 되돌리기 (Vibepollo 서비스 원래대로)"; Filename: "{app}\tools\arbs-h\arbs-h-rollback.cmd"; WorkingDir: "{app}\tools\arbs-h"
Name: "{group}\ARBS-H 로그 모으기"; Filename: "{app}\tools\arbs-h\arbs-h-collect-logs.cmd"; WorkingDir: "{app}\tools\arbs-h"
Name: "{group}\ARBS-H 상태 기록 (읽기만)"; Filename: "{app}\tools\arbs-h\arbs-h-snapshot.cmd"; WorkingDir: "{app}\tools\arbs-h"
Name: "{group}\ARBS-H 제거"; Filename: "{uninstallexe}"

[UninstallDelete]
Type: files; Name: "{app}\arbs-h-version.txt"
Type: filesandordirs; Name: "{app}\config.migrating"

[Code]
const
  HelperName = 'arbs-h-setup.ps1';

var
  OptPage: TInputOptionWizardPage;
  IdxStop, IdxMigrate, IdxUsbip, IdxSudo: Integer;
  PlanKeys, PlanVals: TArrayOfString;
  PlanOk, IsUpgrade, KeepConfig, RestoreVibe: Boolean;

procedure LoadKeyValues(const FileName: String; var Keys, Vals: TArrayOfString);
var
  Lines: TArrayOfString;
  I, P, N: Integer;
begin
  SetArrayLength(Keys, 0);
  SetArrayLength(Vals, 0);
  if not LoadStringsFromFile(FileName, Lines) then
    exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    P := Pos('=', Lines[I]);
    if P > 1 then
    begin
      N := GetArrayLength(Keys);
      SetArrayLength(Keys, N + 1);
      SetArrayLength(Vals, N + 1);
      Keys[N] := Copy(Lines[I], 1, P - 1);
      Vals[N] := Copy(Lines[I], P + 1, Length(Lines[I]) - P);
    end;
  end;
end;

function ValueOf(const Keys, Vals: TArrayOfString; const Key: String): String;
var
  I: Integer;
begin
  Result := '';
  for I := 0 to GetArrayLength(Keys) - 1 do
    if Keys[I] = Key then
    begin
      Result := Vals[I];
      exit;
    end;
end;

function PlanValue(const Key: String): String;
begin
  Result := ValueOf(PlanKeys, PlanVals, Key);
end;

function RunHelper(const Script, Args: String): Integer;
var
  Code: Integer;
begin
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + Script + '" ' + Args,
      '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Code := -1;
  Log('ARBS-H helper: ' + Args + ' -> ' + IntToStr(Code));
  Result := Code;
end;

function CommonArgs: String;
begin
  Result := '-AppDir "' + ExpandConstant('{app}') + '" -Version "{#AppVer}"';
end;

function OptChecked(Idx: Integer): Boolean;
begin
  Result := (Idx >= 0) and OptPage.Values[Idx];
end;

function LogDir: String;
begin
  Result := ExpandConstant('{commonappdata}\ARBS-H\setup-logs');
end;

function IsUpgradeInstall: Boolean;
begin
  Result := RegKeyExists(HKLM, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppGuid}_is1');
end;

procedure InitializeWizard;
var
  PlanFile, ApolloStart, ApolloState: String;
begin
  IsUpgrade := IsUpgradeInstall;
  IdxStop := -1;
  IdxMigrate := -1;
  IdxUsbip := -1;
  IdxSudo := -1;
  ExtractTemporaryFile(HelperName);
  PlanFile := ExpandConstant('{tmp}\arbs-h-plan.txt');
  RunHelper(ExpandConstant('{tmp}\') + HelperName, '-Action plan -PlanOut "' + PlanFile + '"');
  LoadKeyValues(PlanFile, PlanKeys, PlanVals);
  PlanOk := PlanValue('usbip_present') <> '';

  OptPage := CreateInputOptionPage(wpSelectDir,
    'Vibepollo와 함께 쓰기',
    '처음 설치할 때 한 번 고릅니다. 체크하지 않은 항목은 아무것도 바꾸지 않습니다.',
    'Vibepollo와 ARBS-H는 같은 포트(47984~48010)를 씁니다. 둘이 동시에 켜지면 ARBS-H가 시작하지 못합니다.',
    False, False);

  if not PlanOk then
  begin
    Log('ARBS-H: plan step failed, no options offered');
    exit;
  end;

  ApolloStart := PlanValue('apollo_start');
  ApolloState := PlanValue('apollo_state');
  // Offered on upgrades too, but only while Vibepollo would take the ports (e.g. after the rollback tool);
  // otherwise ARBS-H could only be left on manual start. The original value is recorded only if no record exists.
  if (PlanValue('apollo_installed') = '1') and
     not (((ApolloStart = 'demand') or (ApolloStart = 'disabled')) and (ApolloState = 'STOPPED')) then
    IdxStop := OptPage.Add('Vibepollo 서비스(ApolloService) 멈춤 + 시작 유형 "수동" (지금: ' + ApolloStart + ' / ' + ApolloState +
      ') - 원래 값은 기록되고 "ARBS-H 되돌리기"로 복원');
  if (not IsUpgrade) and (PlanValue('vibepollo_config') <> '') and (PlanValue('arbsh_config') <> '1') then
    IdxMigrate := OptPage.Add('Vibepollo 설정·페어링 복사 (' + PlanValue('vibepollo_config') + ', 원본은 읽기만 / 다시 페어링 불필요)');
  if PlanValue('usbip_present') <> '1' then
    IdxUsbip := OptPage.Add('빠진 드라이버 설치: usbip-win2 (가상 DualSense)');
  if PlanValue('sudovda_present') <> '1' then
    IdxSudo := OptPage.Add('빠진 드라이버 설치: SudoVDA (가상 디스플레이 - 인증서를 컴퓨터 신뢰 저장소에 추가함)');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = OptPage.ID) and (OptPage.CheckListBox.Items.Count = 0);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = OptPage.ID) and OptChecked(IdxMigrate) and (PlanValue('apollo_state') <> 'STOPPED') and
     not OptChecked(IdxStop) then
  begin
    MsgBox('설정 복사는 Vibepollo 서비스를 멈춘 뒤에만 할 수 있습니다. 첫 항목(멈춤 + 수동)도 체크하거나, 설정 복사를 해제하세요.',
      mbError, MB_OK);
    Result := False;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Script: String;
  Code: Integer;
begin
  Result := '';
  Script := ExpandConstant('{tmp}\') + HelperName;
  Code := RunHelper(Script, '-Action prepare ' + CommonArgs);
  if Code <> 0 then
  begin
    Result := 'ARBS-H 서비스 정지 또는 기존 설정 백업에 실패했습니다(코드 ' + IntToStr(Code) + '). 로그: ' + LogDir;
    exit;
  end;
  if OptChecked(IdxStop) then
  begin
    Code := RunHelper(Script, '-Action stop-vibepollo -VibepolloStopApproved ' + CommonArgs);
    if Code <> 0 then
      Result := 'Vibepollo 서비스를 멈추지 못했습니다(코드 ' + IntToStr(Code) + '). 아무 파일도 설치하지 않았습니다. 로그: ' + LogDir;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Args, ResFile, Msg: String;
  Code, I: Integer;
  RK, RV: TArrayOfString;
begin
  if CurStep <> ssPostInstall then
    exit;
  ResFile := ExpandConstant('{tmp}\arbs-h-result.txt');
  Args := '-Action post-install ' + CommonArgs + ' -ResultOut "' + ResFile + '"';
  if OptChecked(IdxMigrate) then
    Args := Args + ' -Migrate';
  if OptChecked(IdxUsbip) then
    Args := Args + ' -InstallUsbip';
  if OptChecked(IdxSudo) then
    Args := Args + ' -InstallSudoVda';
  Code := RunHelper(ExpandConstant('{app}\tools\arbs-h\') + HelperName, Args);
  LoadKeyValues(ResFile, RK, RV);
  case Code of
    0: Msg := '설치가 끝났습니다. ARBS-H 서비스가 시작되었고, 재부팅 후에도 자동으로 시작합니다.';
    10: Msg := 'ARBS-H 서비스는 "수동"으로 두고 시작하지 않았습니다: Vibepollo가 같은 포트를 쓰고 있거나 자동 시작으로 설정돼 있습니다.' + #13#10 +
               'Vibepollo 서비스를 멈춘 뒤 이 설치 파일을 다시 실행하면(같은 자리 업그레이드) 자동 시작으로 바뀝니다.';
    3: Msg := 'Vibepollo 설정 복사가 실패해 새 설정으로 시작합니다(다시 페어링 필요). Vibepollo 원본은 그대로입니다.';
    4: Msg := '드라이버 설치가 실패했습니다. 나머지 설치는 끝났습니다.';
  else
    Msg := '설치 후 설정 단계가 실패했습니다(코드 ' + IntToStr(Code) + ').';
  end;
  Msg := Msg + #13#10#13#10 + '로그: ' + LogDir;
  for I := 0 to GetArrayLength(RK) - 1 do
    Msg := Msg + #13#10 + RK[I] + ' = ' + RV[I];
  if Code = 0 then
    SuppressibleMsgBox(Msg, mbInformation, MB_OK, IDOK)
  else
    SuppressibleMsgBox(Msg, mbError, MB_OK, IDOK);
end;

function InitializeUninstall(): Boolean;
begin
  KeepConfig := True;
  RestoreVibe := True;
  if not UninstallSilent then
  begin
    KeepConfig := MsgBox('ARBS-H 설정(페어링·로그인·앱 목록)을 남길까요?' + #13#10 +
      '예 = 남김(다시 설치하면 그대로 사용) / 아니요 = 설정·로그·백업 삭제', mbConfirmation, MB_YESNO) = IDYES;
    if FileExists(ExpandConstant('{commonappdata}\ARBS-H\rollback\apolloservice.json')) then
      RestoreVibe := MsgBox('Vibepollo 서비스(ApolloService)를 ARBS-H 설치 전 상태로 되돌릴까요? (권장: 예)',
        mbConfirmation, MB_YESNO) = IDYES;
  end;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Args: String;
begin
  if CurUninstallStep <> usUninstall then
    exit;
  Args := '-Action uninstall -AppDir "' + ExpandConstant('{app}') + '"';
  if not KeepConfig then
    Args := Args + ' -RemoveConfig';
  if RestoreVibe then
    Args := Args + ' -RestoreVibepollo';
  RunHelper(ExpandConstant('{app}\tools\arbs-h\') + HelperName, Args);
end;
