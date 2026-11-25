<#
.SYNOPSIS
  ARBS-H installer helper (R1a, D-R1a-1/6/8/9/10). Called by arbs-h.iss, the rollback tool and the log tool.

.DESCRIPTION
  Every external command (sc.exe, netsh.exe, robocopy.exe, icacls.exe, pnputil.exe, netstat.exe, schtasks.exe,
  powershell.exe for driver installers) goes through Invoke-Ext. With -DryRun nothing is executed: commands are
  only recorded, answers come from an injected runner (tests) or from <FakeRoot>\fake.json, and every path the
  helper may write to must be inside -FakeRoot. With ARBS_H_TEST_NO_REAL_EXEC=1 a real command throws.

  Vibepollo is never modified except the one approved change: ApolloService stop + start type "demand", whose
  original value is recorded once in <DataRoot>\rollback\apolloservice.json and restored by -Action rollback.
  Vibepollo files are only read (configuration migration copies with robocopy /B). Drivers are never removed.

.NOTES
  ASCII only on purpose (Windows PowerShell 5.1 reads BOM-less scripts in the ANSI code page).
#>
[CmdletBinding()]
param(
  [ValidateSet('lib', 'plan', 'prepare', 'stop-vibepollo', 'post-install', 'migrate', 'ensure-config', 'drivers',
    'service', 'firewall', 'start', 'uninstall', 'rollback', 'collect-logs', 'snapshot')]
  [string]$Action = 'lib',
  [string]$AppDir = (Join-Path $env:ProgramFiles 'ARBS-H'),
  [string]$DataRoot = (Join-Path $env:ProgramData 'ARBS-H'),
  [string]$VibepolloConfig = '',
  [string]$Version = '0.2.0',
  # H013 O4: ARBS-H service start type and state seen by the first prepare (auto|delayed-auto|demand|disabled|none and
  # an sc.exe state). Plain strings on purpose: an unexpected value must not stop post-install at parameter binding.
  [string]$PrevStart = '',
  [string]$PrevState = '',
  [string]$PlanOut = '',
  [string]$ResultOut = '',
  [string]$OutDir = '',
  [switch]$Migrate,
  [switch]$VibepolloStopApproved,
  [switch]$InstallUsbip,
  [switch]$InstallSudoVda,
  [switch]$RemoveConfig,
  [switch]$RestoreVibepollo,
  [switch]$DryRun,
  [string]$FakeRoot = '',
  [switch]$PlanOnly
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------------------------------------------
# Fixed names (must match src/platform/windows/arbs_h_names.h and arbs-h.iss)
# ---------------------------------------------------------------------------------------------------------------
$script:ServiceName = 'ARBSHService'
$script:ServiceDisplayName = 'ARBS-H Service'
$script:ServiceDescription = 'ARBS-H streaming host (Vibepollo 2.18.9 fork)'
$script:VibepolloService = 'ApolloService'
$script:FirewallRules = @(
  @{ Name = 'ARBS-H'; Program = 'sunshine.exe' },
  @{ Name = 'ARBS-H Service'; Program = 'tools\sunshinesvc.exe' }
)
$script:RestoreTask = '\ARBS-H-DisplayRestore'
$script:StreamPorts = @(47984, 47989, 47990, 48010)
$script:MigrateFiles = @('sunshine.conf', 'apps.json', 'sunshine_state.json', 'vibeshine_state.json')
$script:BackupKeep = 3

$script:Plan = New-Object System.Collections.Generic.List[string]
$script:Runner = $null
$script:AclReader = $null   # tests inject { param($Path) <SDDL> } (the fake runner does not model icacls)
$script:ProcessLister = $null   # tests inject a list of { Id; ParentId; Name; Path }
$script:FileBusyProbe = $null   # tests inject { param($Path) <$true when locked> }
$script:LockerProbe = $null   # H013 O5: tests inject { param([string[]]$Paths) list of { Id; Name } }
$script:HelperImage = 'sunshine_display_helper.exe'
$script:RestoreWaitSeconds = 20
$script:RunningWaitSeconds = 15   # H013 O4: sc start only confirms the request; RUNNING is checked this long
$script:StartAttempted = $false   # H013 O4: set right before sc start; a later failure is not undone by a restore
$script:SkipUninstallerFiles = $false   # H013 O3: the running uninstaller owns {app}\unins*.exe
$script:RealExecCount = 0
$script:LogFile = $null
$script:Result = [ordered]@{}

# ---------------------------------------------------------------------------------------------------------------
# Logging, paths, command execution
# ---------------------------------------------------------------------------------------------------------------
function Write-Log([string]$Message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  if ($script:LogFile) { Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8 }
  Write-Verbose $line
}

function Set-Result([string]$Key, [string]$Value) { $script:Result[$Key] = $Value; Write-Log "RESULT $Key=$Value" }

# H013 O4: the first cause only, one line (the installer shows it in the error window), at most 120 characters.
function Set-Reason([string]$Text) {
  if ($script:Result.Contains('reason')) { return }
  $t = (($Text -replace '[\r\n\t]+', ' ') -replace ' {2,}', ' ').Trim()
  if ($t.Length -gt 120) { $t = $t.Substring(0, 117) + '...' }
  if (-not $t) { $t = 'unknown' }
  Set-Result 'reason' $t
}

function Test-UnderRoot([string]$Path, [string]$Root) {
  if (-not $Path -or -not $Root) { return $false }
  $p = [IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
  $r = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  return $p.StartsWith($r, [StringComparison]::OrdinalIgnoreCase)
}

# %ProgramData%\ARBS-H is also the service log root. sunshinesvc.cpp (SecureServiceDirectory) trusts it only when
# owned by SYSTEM/Administrators with a protected DACL of exactly SYSTEM + Administrators full control (OI)(CI);
# otherwise it renames the folder to *.untrusted-*, which would move the rollback record away. Create it that way.
function Initialize-DataRoot {
  $created = $false
  if (-not (Test-Path -LiteralPath $DataRoot)) { New-Item -ItemType Directory -Path $DataRoot -Force | Out-Null; $created = $true }
  [void](Invoke-Ext 'icacls.exe' ('{0} /setowner *S-1-5-32-544 /C /Q' -f (Quote $DataRoot)))
  [void](Invoke-Ext 'icacls.exe' ('{0} /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /C /Q' -f (Quote $DataRoot)))
  Write-Log "data root secured (created=$created): $DataRoot"
}

function Initialize-Context {
  if (-not $VibepolloConfig) { $script:VibepolloConfig = '' }
  if ($DryRun) {
    if (-not $FakeRoot -or -not (Test-Path -LiteralPath $FakeRoot -PathType Container)) {
      throw 'DryRun requires an existing -FakeRoot directory.'
    }
    foreach ($p in @($AppDir, $DataRoot) + @($(if ($VibepolloConfig) { $VibepolloConfig })) + @($(if ($OutDir) { $OutDir }))) {
      if (-not (Test-UnderRoot $p $FakeRoot)) { throw "DryRun path outside FakeRoot: $p" }
    }
  }
  # Read-only steps (plan, snapshot, collect-logs, rollback -Plan) never create anything under DataRoot.
  if (-not $PlanOnly -and @('plan', 'snapshot', 'collect-logs', 'lib') -notcontains $Action) {
    Initialize-DataRoot
    $logDir = Join-Path $DataRoot 'setup-logs'
    if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $script:LogFile = Join-Path $logDir ('{0}-{1}.log' -f $Action, (Get-Date -Format 'yyyyMMdd-HHmmss'))
  }
  Write-Log "ARBS-H helper $Version action=$Action dryrun=$([bool]$DryRun) planonly=$([bool]$PlanOnly) app=$AppDir data=$DataRoot"
}

function Resolve-SystemExe([string]$Exe) {
  $sys = Join-Path $env:SystemRoot 'System32'
  switch ($Exe.ToLowerInvariant()) {
    'powershell.exe' { return (Join-Path $sys 'WindowsPowerShell\v1.0\powershell.exe') }
    default { return (Join-Path $sys $Exe) }
  }
}

function Get-FakeResult([string]$Exe, [string]$Arguments) {
  $file = Join-Path $FakeRoot 'fake.json'
  if (Test-Path -LiteralPath $file) {
    $rules = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    foreach ($rule in @($rules)) {
      if (("$Exe $Arguments") -match $rule.match) {
        return @{ ExitCode = [int]$rule.exit; Output = [string]$rule.output }
      }
    }
  }
  return @{ ExitCode = 0; Output = '' }
}

# The only place that may start a process.
function Invoke-Ext([string]$Exe, [string]$Arguments) {
  $line = "$Exe $Arguments"
  $script:Plan.Add($line)
  Write-Log "RUN $line"
  if ($PlanOnly) { Write-Output "PLAN $line" | Out-Host; return @{ ExitCode = 0; Output = '' } }
  if ($DryRun) {
    if ($script:Runner) { $r = & $script:Runner $Exe $Arguments } else { $r = Get-FakeResult $Exe $Arguments }
    Write-Log ("  exit={0}" -f $r.ExitCode)
    return $r
  }
  if ($env:ARBS_H_TEST_NO_REAL_EXEC -eq '1') { throw "Real command blocked (ARBS_H_TEST_NO_REAL_EXEC=1): $line" }
  $script:RealExecCount++
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Resolve-SystemExe $Exe
  $psi.Arguments = $Arguments
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync()
  $err = $p.StandardError.ReadToEndAsync()
  $p.WaitForExit()
  $text = $out.Result + $err.Result
  Write-Log ("  exit={0}" -f $p.ExitCode)
  return @{ ExitCode = $p.ExitCode; Output = $text }
}

function Wait-Short([int]$Milliseconds) { if (-not $DryRun -and -not $PlanOnly) { Start-Sleep -Milliseconds $Milliseconds } }

function Quote([string]$s) { return '"' + $s + '"' }

# ---------------------------------------------------------------------------------------------------------------
# Read-only queries (language independent: only English keys/values of sc.exe and numbers are parsed)
# ---------------------------------------------------------------------------------------------------------------
function Get-ServiceInfo([string]$Name) {
  $qc = Invoke-Ext 'sc.exe' "qc $Name"
  if ($qc.ExitCode -eq 1060 -or ($qc.ExitCode -ne 0 -and $qc.Output -match '\b1060\b')) {
    return @{ Installed = $false; StartType = 0; Delayed = $false; State = 'NONE'; BinaryPath = '' }
  }
  if ($qc.ExitCode -ne 0) { throw "sc qc $Name failed with exit code $($qc.ExitCode)" }
  if ($qc.Output -notmatch 'START_TYPE\s*:\s*(\d+)') { throw "sc qc ${Name}: START_TYPE not found" }
  $start = [int]$matches[1]
  $delayed = [bool]($qc.Output -match 'START_TYPE\s*:\s*\d+\s+AUTO_START\s+\(DELAYED\)')
  $bin = ''
  if ($qc.Output -match 'BINARY_PATH_NAME\s*:\s*([^\r\n]+)') { $bin = $matches[1].Trim() }
  $q = Invoke-Ext 'sc.exe' "query $Name"
  $state = 'UNKNOWN'
  if ($q.Output -match ':\s*\d+\s+(STOPPED|START_PENDING|STOP_PENDING|RUNNING|CONTINUE_PENDING|PAUSE_PENDING|PAUSED)\b') {
    $state = $matches[1]
  }
  return @{ Installed = $true; StartType = $start; Delayed = $delayed; State = $state; BinaryPath = $bin }
}

function ConvertTo-StartName([int]$StartType, [bool]$Delayed) {
  switch ($StartType) {
    2 { if ($Delayed) { return 'delayed-auto' } else { return 'auto' } }
    3 { return 'demand' }
    4 { return 'disabled' }
    default { return "type$StartType" }
  }
}

function Get-ExeFromBinaryPath([string]$BinaryPath) {
  if (-not $BinaryPath) { return '' }
  if ($BinaryPath.StartsWith('"')) { $end = $BinaryPath.IndexOf('"', 1); if ($end -gt 1) { return $BinaryPath.Substring(1, $end - 1) } }
  $i = $BinaryPath.ToLowerInvariant().IndexOf('.exe')
  if ($i -gt 0) { return $BinaryPath.Substring(0, $i + 4) }
  return $BinaryPath
}

# Vibepollo configuration folder from the ApolloService binary path (<root>\tools\sunshinesvc.exe -> <root>\config).
function Get-VibepolloConfigDir($ApolloInfo) {
  if ($VibepolloConfig) { return $VibepolloConfig }
  if ($ApolloInfo.Installed) {
    $exe = Get-ExeFromBinaryPath $ApolloInfo.BinaryPath
    if ($exe) {
      $root = Split-Path -Parent (Split-Path -Parent $exe)
      if ($root) { return (Join-Path $root 'config') }
    }
  }
  return 'C:\Vibepollo\config'
}

# DryRun never looks outside FakeRoot (the result must not depend on this PC's real Vibepollo folder).
function Test-PathInScope([string]$Path) {
  if ($DryRun -and -not (Test-UnderRoot $Path $FakeRoot)) { Write-Log "dry-run: outside FakeRoot treated as missing: $Path"; return $false }
  return (Test-Path -LiteralPath $Path)
}

function Test-UsbipPresent { return ((Invoke-Ext 'sc.exe' 'query usbip2_ude').ExitCode -eq 0) }

function Test-SudoVdaPresent {
  $r = Invoke-Ext 'pnputil.exe' '/enum-devices /class Display'
  return ($r.ExitCode -eq 0 -and $r.Output -match '(?i)SudoMaker Virtual Display|SUDOVDA')
}

function Get-BusyPorts {
  $r = Invoke-Ext 'netstat.exe' '-ano -p TCP'
  $busy = @()
  foreach ($line in ($r.Output -split "`r?`n")) {
    if ($line -match '^\s*TCP\s+\S+:(\d+)\s+\S+:0\s+') {
      $port = [int]$matches[1]
      if ($script:StreamPorts -contains $port -and $busy -notcontains $port) { $busy += $port }
    }
  }
  return , $busy
}

function Wait-ServiceState([string]$Name, [string]$Wanted, [int]$Seconds) {
  for ($i = 0; $i -le $Seconds; $i++) {
    $info = Get-ServiceInfo $Name
    if (-not $info.Installed -or $info.State -eq $Wanted) { return $true }
    Wait-Short 1000
  }
  return $false
}

# H013 O4: true only when the service really reaches RUNNING. STOPPED (or gone) after a start request means it ended.
function Wait-ServiceRunning([string]$Name, [int]$Seconds) {
  for ($i = 0; $i -le $Seconds; $i++) {
    $info = Get-ServiceInfo $Name
    if ($info.Installed -and $info.State -eq 'RUNNING') { return $true }
    if (-not $info.Installed -or $info.State -eq 'STOPPED') { Write-Log "$Name not running after start ($($info.State))"; return $false }
    Wait-Short 1000
  }
  Write-Log "$Name still not RUNNING after $Seconds s"
  return $false
}

# ---------------------------------------------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------------------------------------------
function Invoke-Plan {
  $apollo = Get-ServiceInfo $script:VibepolloService
  $own = Get-ServiceInfo $script:ServiceName
  $vcfg = Get-VibepolloConfigDir $apollo
  $values = [ordered]@{
    apollo_installed = [int]$apollo.Installed
    apollo_start     = $(if ($apollo.Installed) { ConvertTo-StartName $apollo.StartType $apollo.Delayed } else { '' })
    apollo_state     = $apollo.State
    vibepollo_config = $(if (Test-PathInScope (Join-Path $vcfg 'sunshine.conf')) { $vcfg } else { '' })
    arbsh_installed  = [int]$own.Installed
    arbsh_config     = [int](Test-Path -LiteralPath (Join-Path $AppDir 'config\sunshine.conf'))
    usbip_present    = [int](Test-UsbipPresent)
    sudovda_present  = [int](Test-SudoVdaPresent)
    ports_busy       = ((Get-BusyPorts) -join ',')
    rollback_record  = [int](Test-Path -LiteralPath (Join-Path $DataRoot 'rollback\apolloservice.json'))
  }
  $lines = foreach ($k in $values.Keys) { '{0}={1}' -f $k, $values[$k] }
  if ($PlanOut) { [IO.File]::WriteAllLines($PlanOut, [string[]]$lines, (New-Object Text.UTF8Encoding($false))) }
  $lines | ForEach-Object { Write-Log "PLAN $_" }
  return $values
}

function Save-ApolloRecord($Info) {
  $dir = Join-Path $DataRoot 'rollback'
  $path = Join-Path $dir 'apolloservice.json'
  if (Test-Path -LiteralPath $path) { Write-Log "record exists, kept as is: $path"; return $false }
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $record = [ordered]@{
    Service      = $script:VibepolloService
    StartType    = $Info.StartType
    Delayed      = [bool]$Info.Delayed
    StartName    = (ConvertTo-StartName $Info.StartType $Info.Delayed)
    State        = $Info.State
    RecordedAt   = (Get-Date).ToString('s')
    ArbsHVersion = $Version
  }
  [IO.File]::WriteAllText($path, ($record | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  Write-Log "record written: $path"
  return $true
}

function Invoke-StopVibepollo {
  $info = Get-ServiceInfo $script:VibepolloService
  if (-not $info.Installed) { Set-Result 'vibepollo' 'not-installed'; return 0 }
  [void](Save-ApolloRecord $info)
  if ($info.State -ne 'STOPPED') {
    [void](Invoke-Ext 'sc.exe' "stop $($script:VibepolloService)")
    if (-not (Wait-ServiceState $script:VibepolloService 'STOPPED' 60)) { Set-Result 'vibepollo' 'stop-timeout'; return 2 }
  }
  $r = Invoke-Ext 'sc.exe' "config $($script:VibepolloService) start= demand"
  if ($r.ExitCode -ne 0) { Set-Result 'vibepollo' 'config-failed'; return 2 }
  Set-Result 'vibepollo' 'stopped-demand'
  return 0
}

function Get-NewLine([string]$Text) { if ($Text -match "`r`n") { return "`r`n" } return "`n" }

# D-R1a-10: one disabled dd_use_sunshine_virtual_display_driver line, gamepad = usbip_ds5, update defaults if
# missing, lines pointing into the old Vibepollo folder commented out. Everything else is kept as is.
function Repair-ConfText([string]$Text) {
  $nl = Get-NewLine $Text
  $lines = @()
  if ($Text.Length -gt 0) { $lines = @($Text -split "`r?`n") }
  if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') { $lines = @($lines[0..($lines.Count - 2)]) }
  $out = New-Object System.Collections.Generic.List[string]
  $hasGamepad = $false; $hasInterval = $false; $hasPre = $false
  foreach ($line in $lines) {
    if ($line -match '^\s*dd_use_sunshine_virtual_display_driver\s*=') { continue }
    if ($line -match '^\s*gamepad\s*=') { $out.Add('gamepad = usbip_ds5'); $hasGamepad = $true; continue }
    if ($line -match '^\s*update_check_interval\s*=') { $hasInterval = $true }
    if ($line -match '^\s*notify_pre_releases\s*=') { $hasPre = $true }
    if ($line -notmatch '^\s*#' -and $line -match '(?i)[\\/]Vibepollo[\\/]') { $out.Add('# arbs-h migrate (old Vibepollo path): ' + $line); continue }
    $out.Add($line)
  }
  if (-not $hasGamepad) { $out.Add('gamepad = usbip_ds5') }
  $out.Add('dd_use_sunshine_virtual_display_driver = disabled')
  if (-not $hasInterval) { $out.Add('update_check_interval = 86400') }
  if (-not $hasPre) { $out.Add('notify_pre_releases = false') }
  return (($out -join $nl) + $nl)
}

# ---------------------------------------------------------------------------------------------------------------
# Credentials folder ACL (R1a-fix1). 0.1.0 ran "icacls <cred> /inheritance:r /grant:r ...(OI)(CI)F ... /T": the
# (OI)(CI) grants do not apply to files, so every file was left with a protected DACL and no ACE at all and even
# SYSTEM could not open cacert.pem (sunshine.exe terminated at start, system:5). icacls /C /Q also exits 0 when an
# item failed, so the result is always judged by reading the ACL back.
# ---------------------------------------------------------------------------------------------------------------
$script:PrivateSids = @('S-1-5-18', 'S-1-5-32-544')

function Get-PathSddl([string]$Path) {
  try {
    if ($script:AclReader) { return [string](& $script:AclReader $Path) }
    return [string](Get-Acl -LiteralPath $Path).Sddl
  }
  catch { Write-Log "ACL read failed: $Path ($($_.Exception.Message))"; return '' }
}

# True when the DACL grants full control to SYSTEM and Administrators (ACEs that apply to the object itself) and
# allows nobody else. Deny ACEs, other principals or an unreadable/empty DACL count as not private.
# -ExtraAllowed is only for the scratch reproduction (a non-administrator stand-in for SYSTEM).
function Test-PrivateSddl([string]$Sddl, [string[]]$ExtraAllowed = @()) {
  if (-not $Sddl) { return $false }
  $m = [regex]::Match($Sddl, 'D:[A-Z]*((?:\([^)]*\))*)')
  if (-not $m.Success) { return $false }
  $allowed = @($script:PrivateSids) + @($ExtraAllowed)
  $hasSystem = $false; $hasAdmins = $false
  foreach ($ace in [regex]::Matches($m.Groups[1].Value, '\(([^)]*)\)')) {
    $f = $ace.Groups[1].Value -split ';'
    if ($f.Count -lt 6) { return $false }
    $sid = switch ($f[5]) { 'SY' { 'S-1-5-18' } 'BA' { 'S-1-5-32-544' } default { $f[5] } }
    if ($f[0] -ne 'A' -or $allowed -notcontains $sid) { return $false }
    if ($f[1] -notmatch 'IO' -and @('FA', '0x1f01ff') -contains $f[2]) {
      if ($sid -eq 'S-1-5-18') { $hasSystem = $true }
      if ($sid -eq 'S-1-5-32-544') { $hasAdmins = $true }
    }
  }
  return ($hasSystem -and $hasAdmins)
}

# Folder and every file/folder below it whose ACL is not private (or cannot be read).
function Get-CredentialsAclProblems([string]$Dir) {
  $bad = @()
  if (-not (Test-PrivateSddl (Get-PathSddl $Dir))) { $bad += $Dir }
  foreach ($item in @(Get-ChildItem -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue)) {
    if (-not (Test-PrivateSddl (Get-PathSddl $item.FullName))) { $bad += $item.FullName }
  }
  return , $bad
}

# F1: protected SYSTEM + Administrators on the folder only (no /T), THEN the files reset to inherit from it. The order
# matters: resetting the files first would let them inherit Users:(RX) from Program Files for a moment.
function Set-CredentialsAcl([string]$Dir) {
  [void](Invoke-Ext 'icacls.exe' ('{0} /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /C /Q' -f (Quote $Dir)))
  [void](Invoke-Ext 'icacls.exe' ('{0} /reset /T /C /Q' -f (Quote (Join-Path $Dir '*'))))
}

# F2: every post-install (first install, upgrade, migrated or not). An existing 0.1.0 install is repaired here.
# Result credentials-acl = ok (already private) | repaired | failed | absent (no folder yet; sunshine creates it).
function Invoke-RepairCredentialsAcl {
  $cred = Join-Path (Join-Path $AppDir 'config') 'credentials'
  if (-not (Test-Path -LiteralPath $cred -PathType Container)) { Set-Result 'credentials-acl' 'absent'; return 0 }
  $bad = Get-CredentialsAclProblems $cred
  if ($bad.Count -eq 0) { Set-Result 'credentials-acl' 'ok'; return 0 }
  Write-Log ('credentials ACL not private: {0} item(s), repairing' -f $bad.Count)
  Set-CredentialsAcl $cred
  $bad = Get-CredentialsAclProblems $cred
  if ($bad.Count -gt 0) {
    # One retry: owner Administrators (owner keeps READ_CONTROL/WRITE_DAC), then the same two commands.
    Write-Log ('credentials ACL still not private: {0} item(s), retry with owner Administrators' -f $bad.Count)
    foreach ($p in $bad) { [void](Invoke-Ext 'icacls.exe' ('{0} /setowner *S-1-5-32-544 /C /Q' -f (Quote $p))) }
    Set-CredentialsAcl $cred
    $bad = Get-CredentialsAclProblems $cred
  }
  if ($bad.Count -gt 0) {
    foreach ($p in $bad) { Write-Log "credentials ACL not repaired: $p" }
    Write-Log ('manual repair (administrator): icacls {0} /reset /T  after  icacls {1} /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F' -f (Quote (Join-Path $cred '*')), (Quote $cred))
    Set-Result 'credentials-acl' 'failed'
    return 6
  }
  Set-Result 'credentials-acl' 'repaired'
  return 0
}

function Invoke-Migrate {
  $target = Join-Path $AppDir 'config'
  if (Test-Path -LiteralPath (Join-Path $target 'sunshine.conf')) { Set-Result 'migrate' 'skipped-existing-config'; return 0 }
  $apollo = Get-ServiceInfo $script:VibepolloService
  if ($apollo.Installed -and $apollo.State -ne 'STOPPED') { Set-Result 'migrate' 'refused-vibepollo-running'; return 3 }
  $source = Get-VibepolloConfigDir $apollo
  if (-not (Test-PathInScope (Join-Path $source 'sunshine.conf'))) { Set-Result 'migrate' 'no-source'; return 3 }
  $tmp = Join-Path $AppDir 'config.migrating'
  if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
  $ok = $true
  $files = ($script:MigrateFiles | ForEach-Object { $_ }) -join ' '
  $r = Invoke-Ext 'robocopy.exe' ('{0} {1} {2} /B /COPY:DAT /R:0 /W:0 /NP /NJH /NJS' -f (Quote $source), (Quote $tmp), $files)
  if ($r.ExitCode -ge 8) { $ok = $false }
  $r = Invoke-Ext 'robocopy.exe' ('{0} {1} /E /B /COPY:DAT /R:0 /W:0 /NP /NJH /NJS' -f (Quote (Join-Path $source 'credentials')), (Quote (Join-Path $tmp 'credentials')))
  if ($r.ExitCode -ge 8) { $ok = $false }
  foreach ($f in $script:MigrateFiles) { if (-not (Test-Path -LiteralPath (Join-Path $tmp $f) -PathType Leaf)) { $ok = $false; Write-Log "missing after copy: $f" } }
  $cred = Join-Path $tmp 'credentials'
  if (-not (Test-Path -LiteralPath $cred -PathType Container) -or -not (Get-ChildItem -LiteralPath $cred -Force | Select-Object -First 1)) {
    $ok = $false; Write-Log 'missing after copy: credentials\'
  }
  if (-not $ok) {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
    Set-Result 'migrate' 'failed-all-discarded'
    return 3
  }
  $conf = Join-Path $tmp 'sunshine.conf'
  Copy-Item -LiteralPath $conf -Destination (Join-Path $tmp 'sunshine.conf.from-vibepollo') -Force
  $text = [IO.File]::ReadAllText($conf)
  [IO.File]::WriteAllText($conf, (Repair-ConfText $text), (New-Object Text.UTF8Encoding($false)))
  # R1a-fix1 F1/F3: folder only, then the files inherit from it; judged by reading the ACL back (not the exit code).
  Set-CredentialsAcl $cred
  $bad = Get-CredentialsAclProblems $cred
  if ($bad.Count -gt 0) { Write-Log ('credentials ACL check after copy: {0} item(s) not private (post-install repair step retries)' -f $bad.Count) }
  else { Write-Log 'credentials ACL check after copy: ok' }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  Rename-Item -LiteralPath $tmp -NewName 'config'
  Set-Result 'migrate' 'ok'
  return 0
}

function Invoke-EnsureConfig {
  $target = Join-Path $AppDir 'config'
  $conf = Join-Path $target 'sunshine.conf'
  if (Test-Path -LiteralPath $conf) { Set-Result 'config' 'kept'; return 0 }
  $template = Join-Path $AppDir 'config-template\sunshine.conf'
  if (-not (Test-Path -LiteralPath $template)) { Set-Result 'config' 'template-missing'; return 1 }
  if (-not (Test-Path -LiteralPath $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null }
  Copy-Item -LiteralPath $template -Destination $conf
  Set-Result 'config' 'new-from-template'
  return 0
}

function Invoke-Drivers {
  $rc = 0
  if (Test-UsbipPresent) { Set-Result 'usbip' 'present' }
  elseif ($InstallUsbip) {
    $script = Join-Path $AppDir 'drivers\usbip-win2\install.ps1'
    $r = Invoke-Ext 'powershell.exe' ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File {0} -InstallerBestEffort' -f (Quote $script))
    if ($r.ExitCode -eq 0) { Set-Result 'usbip' 'installed' } else { Set-Result 'usbip' 'install-failed'; $rc = 4 }
  }
  else { Set-Result 'usbip' 'missing' }
  if (Test-SudoVdaPresent) { Set-Result 'sudovda' 'present' }
  elseif ($InstallSudoVda) {
    $script = Join-Path $AppDir 'drivers\sudovda\install.ps1'
    $r = Invoke-Ext 'powershell.exe' ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File {0} -InstallerBestEffort' -f (Quote $script))
    if ($r.ExitCode -eq 0) { Set-Result 'sudovda' 'installed' } else { Set-Result 'sudovda' 'install-failed'; $rc = 4 }
  }
  else { Set-Result 'sudovda' 'missing' }
  return $rc
}

function Get-ServiceBinPath { return (Quote (Join-Path $AppDir 'tools\sunshinesvc.exe')) }

function Invoke-Service {
  $own = Get-ServiceInfo $script:ServiceName
  $bin = Get-ServiceBinPath
  # sc.exe needs the embedded quotes escaped: binPath= "\"C:\Program Files\ARBS-H\tools\sunshinesvc.exe\""
  $binArg = '"' + $bin.Replace('"', '\"') + '"'
  if (-not $own.Installed) {
    $r = Invoke-Ext 'sc.exe' ('create {0} binPath= {1} start= demand obj= LocalSystem DisplayName= {2}' -f $script:ServiceName, $binArg, (Quote $script:ServiceDisplayName))
    if ($r.ExitCode -ne 0) { Set-Result 'service' 'create-failed'; return 1 }
    Set-Result 'service' 'created'
  }
  else {
    if ($own.BinaryPath -ne $bin) {
      $r = Invoke-Ext 'sc.exe' ('config {0} binPath= {1}' -f $script:ServiceName, $binArg)
      if ($r.ExitCode -ne 0) { Set-Result 'service' 'config-failed'; return 1 }
      Set-Result 'service' 'binpath-updated'
    }
    else { Set-Result 'service' 'kept' }
  }
  [void](Invoke-Ext 'sc.exe' ('description {0} {1}' -f $script:ServiceName, (Quote $script:ServiceDescription)))
  return 0
}

function Invoke-Firewall {
  $rc = 0
  foreach ($rule in $script:FirewallRules) {
    [void](Invoke-Ext 'netsh.exe' ('advfirewall firewall delete rule name={0}' -f (Quote $rule.Name)))
    $program = Join-Path $AppDir $rule.Program
    $r = Invoke-Ext 'netsh.exe' ('advfirewall firewall add rule name={0} dir=in action=allow program={1} enable=yes profile=any' -f (Quote $rule.Name), (Quote $program))
    if ($r.ExitCode -ne 0) { $rc = 1 }
  }
  Set-Result 'firewall' $(if ($rc -eq 0) { 'ok' } else { 'failed' })
  return $rc
}

# Start now and on every boot only when Vibepollo cannot take the same ports: either the user approved the stop
# (ApolloService now demand + stopped) or ApolloService is absent/manual/disabled and the ports are free.
# '' when ARBS-H may start, otherwise the conflict text (Vibepollo automatic/running or a stream port in use).
function Get-StartConflict {
  $apollo = Get-ServiceInfo $script:VibepolloService
  $apolloAuto = $apollo.Installed -and ($apollo.StartType -eq 2 -or $apollo.State -ne 'STOPPED')
  $busy = Get-BusyPorts
  if ($apolloAuto -or $busy.Count -gt 0) {
    return ('ports=' + ($busy -join ',') + ' apollo=' + $(if ($apollo.Installed) { ConvertTo-StartName $apollo.StartType $apollo.Delayed } else { 'none' }) + '/' + $apollo.State)
  }
  return ''
}

# sc start, then RUNNING confirmed (H013 O4: a service that ends right away is a failed start, not "auto-started").
function Start-OwnService {
  $script:StartAttempted = $true
  $r = Invoke-Ext 'sc.exe' ('start {0}' -f $script:ServiceName)
  if ($r.ExitCode -ne 0 -and $r.ExitCode -ne 1056) { Set-Reason ('service start failed (sc start exit {0})' -f $r.ExitCode); return $false }
  if (-not (Wait-ServiceRunning $script:ServiceName $script:RunningWaitSeconds)) { Set-Reason 'service did not reach RUNNING after start'; return $false }
  return $true
}

function Invoke-Start {
  $conflict = Get-StartConflict
  if ($conflict) {
    [void](Invoke-Ext 'sc.exe' ('config {0} start= demand' -f $script:ServiceName))
    Set-Result 'start' ('deferred-conflict ' + $conflict)
    return 10
  }
  [void](Invoke-Ext 'sc.exe' ('config {0} start= auto' -f $script:ServiceName))
  if (-not (Start-OwnService)) { Set-Result 'start' 'failed'; return 1 }
  Set-Result 'start' 'auto-started'
  return 0
}

# ---------------------------------------------------------------------------------------------------------------
# R1b-fix1 G1: ARBS-H processes that outlive the service. sunshine.exe starts the display helper outside the service
# job and does not end it, so stopping ARBSHService can leave tools\sunshine_display_helper.exe locked. Processes are
# chosen by full executable path under -AppDir, never by name: Vibepollo and Apollo ship the same file names.
# ---------------------------------------------------------------------------------------------------------------
function Get-RealProcessSnapshot {
  try {
    return @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name, ExecutablePath -ErrorAction Stop |
        ForEach-Object { [pscustomobject]@{ Id = [int]$_.ProcessId; ParentId = [int]$_.ParentProcessId; Name = [string]$_.Name; Path = [string]$_.ExecutablePath } })
  }
  catch { Write-Log "process list failed: $($_.Exception.Message)"; return @() }
}

# DryRun and plan never query this PC's processes unless a test injects a list.
function Get-ProcessSnapshot {
  if ($script:ProcessLister) { return @(& $script:ProcessLister) }
  if ($DryRun -or $PlanOnly) { return @() }
  return @(Get-RealProcessSnapshot)
}

# This helper and its parents (setup.tmp, setup.exe) are never stopped, even when setup.exe sits inside the folder.
function Get-SelfChainIds($All) {
  $byId = @{}
  foreach ($p in @($All)) { $byId[[int]$p.Id] = $p }
  $ids = @{}
  $cur = [int]$PID
  for ($i = 0; $i -lt 32; $i++) {
    if ($ids.ContainsKey($cur)) { break }
    $ids[$cur] = $true
    if (-not $byId.ContainsKey($cur)) { break }
    $cur = [int]$byId[$cur].ParentId
    if ($cur -le 0) { break }
  }
  return $ids
}

# System processes can report paths GetFullPath refuses (\??\C:\...): those are simply not inside the folder.
function Test-InAppDir([string]$Path) {
  if (-not $Path) { return $false }
  try { return (Test-UnderRoot $Path $AppDir) } catch { return $false }
}

function Get-AppProcesses {
  $all = @(Get-ProcessSnapshot)
  $self = Get-SelfChainIds $all
  return @($all | Where-Object { -not $self.ContainsKey([int]$_.Id) -and (Test-InAppDir $_.Path) })
}

# True when the file cannot be opened for exclusive write (a running image or loaded DLL). Content is not changed.
# A read-only file cannot be opened for write whether it is in use or not, so it is not reported.
function Test-FileBusy([string]$Path) {
  if ($script:FileBusyProbe) { return [bool](& $script:FileBusyProbe $Path) }
  try {
    if ((Get-Item -LiteralPath $Path -Force).IsReadOnly) { return $false }
    $s = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $s.Dispose()
    return $false
  }
  catch [IO.FileNotFoundException] { return $false }
  catch [Management.Automation.ItemNotFoundException] { return $false }
  catch { return $true }
}

# H013 O5: every exe/dll anywhere below {app} (drivers\sudovda\*.dll and other sub folders included), except the two
# configuration folders setup never replaces. Folders that are reparse points (junctions, symbolic links) are not
# entered: they can lead outside {app}. Own stack instead of Get-ChildItem -Recurse (5.1 follows such links).
$script:BusyScanSkipDirs = @('config', 'config.migrating')
function Get-AppBinaryFiles {
  $root = [IO.Path]::GetFullPath($AppDir).TrimEnd('\')
  if (-not (Test-Path -LiteralPath $root -PathType Container)) { return @() }
  $files = New-Object System.Collections.Generic.List[string]
  $stack = New-Object System.Collections.Generic.Stack[string]
  $stack.Push($root)
  while ($stack.Count -gt 0) {
    $dir = $stack.Pop()
    try { $entries = @((New-Object IO.DirectoryInfo($dir)).GetFileSystemInfos()) }
    catch { Write-Log "busy scan: cannot list $dir ($($_.Exception.Message))"; continue }
    foreach ($e in $entries) {
      if ($e -is [IO.DirectoryInfo]) {
        if (($e.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Write-Log "busy scan: reparse point not entered: $($e.FullName)"; continue }
        if (($dir -ieq $root) -and ($script:BusyScanSkipDirs -icontains $e.Name)) { continue }
        $stack.Push($e.FullName)
      }
      elseif (@('.exe', '.dll') -contains $e.Extension.ToLowerInvariant()) {
        if ($script:SkipUninstallerFiles -and ($dir -ieq $root) -and ($e.Name -like 'unins*.exe')) { continue }
        $files.Add($e.FullName)
      }
    }
  }
  return @($files | Sort-Object)
}

# Path relative to {app} (tools\x.dll); a path outside {app} stays full.
function Get-AppRelativePath([string]$Path) {
  $root = [IO.Path]::GetFullPath($AppDir).TrimEnd('\') + '\'
  try { $full = [IO.Path]::GetFullPath($Path) } catch { return $Path }
  if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { return $full.Substring($root.Length) }
  return $full
}

# Locked exe/dll below {app} as relative paths, without the files of this helper's own parent chain.
function Get-BusyAppFiles {
  $all = @(Get-ProcessSnapshot)
  $self = Get-SelfChainIds $all
  $own = @($all | Where-Object { $self.ContainsKey([int]$_.Id) -and $_.Path } | ForEach-Object { $_.Path })
  $busy = @()
  foreach ($f in @(Get-AppBinaryFiles)) {
    if ($own -icontains $f) { continue }
    if (Test-FileBusy $f) { $busy += (Get-AppRelativePath $f) }
  }
  return $busy
}

# H013 O5: Restart Manager, query only. RmStartSession/RmRegisterResources/RmGetList/RmEndSession; the session is
# always ended. Shutting down or restarting the found programs is never done here (installer CloseApplications=no).
$script:RmTypeSource = @'
using System; using System.Runtime.InteropServices; using System.Text;
namespace ArbsH {
  public static class RestartManagerQuery {
    [StructLayout(LayoutKind.Sequential)] public struct UP { public int Pid; public System.Runtime.InteropServices.ComTypes.FILETIME Start; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct PI {
      public UP Process;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string App;
      [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string Svc;
      public int Type; public int Status; public int Session; [MarshalAs(UnmanagedType.Bool)] public bool Restartable; }
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmStartSession(out uint h, int f, StringBuilder k);
    [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)] static extern int RmRegisterResources(uint h, uint n, string[] files, uint a, IntPtr b, uint c, string[] d);
    [DllImport("rstrtmgr.dll")] static extern int RmGetList(uint h, out uint need, ref uint cnt, [In, Out] PI[] info, out uint reasons);
    [DllImport("rstrtmgr.dll")] static extern int RmEndSession(uint h);
    public static PI[] List(string[] files) {
      uint h; var key = new StringBuilder(33);
      int r = RmStartSession(out h, 0, key);
      if (r != 0) throw new Exception("RmStartSession " + r);
      try {
        r = RmRegisterResources(h, (uint)files.Length, files, 0, IntPtr.Zero, 0, null);
        if (r != 0) throw new Exception("RmRegisterResources " + r);
        for (int attempt = 0; attempt < 4; attempt++) {
          uint need = 0, cnt = 0, why;
          r = RmGetList(h, out need, ref cnt, null, out why);
          if (r == 0) return new PI[0];
          if (r != 234) throw new Exception("RmGetList " + r);
          var a = new PI[need]; cnt = need;
          r = RmGetList(h, out need, ref cnt, a, out why);
          if (r == 0) { Array.Resize(ref a, (int)cnt); return a; }
          if (r != 234) throw new Exception("RmGetList " + r);
        }
        throw new Exception("RmGetList: list keeps growing");
      }
      finally { RmEndSession(h); }
    }
  }
}
'@

function Get-RealFileLockers([string[]]$Paths) {
  if (-not ('ArbsH.RestartManagerQuery' -as [type])) { Add-Type -TypeDefinition $script:RmTypeSource -ErrorAction Stop }
  return @([ArbsH.RestartManagerQuery]::List([string[]]$Paths) | ForEach-Object { [pscustomobject]@{ Id = [int]$_.Process.Pid; Name = [string]$_.App } })
}

# Programs holding the given full paths: { Id; Name; Path; Inside }. Inside = its executable is below {app} (those are
# ended by Stop-AppProcesses); a program whose path cannot be read counts as outside and is never ended.
# DryRun and plan never query this PC unless a test injects $script:LockerProbe (no Add-Type then either).
function Get-FileLockers([string[]]$Paths) {
  if ($script:LockerProbe) { $raw = @(& $script:LockerProbe $Paths) }
  elseif ($DryRun -or $PlanOnly) { Write-Log 'dry-run: lock owner query skipped'; return @() }
  else { $raw = @(Get-RealFileLockers $Paths) }
  $all = @(Get-ProcessSnapshot)
  $self = Get-SelfChainIds $all
  $byId = @{}
  foreach ($p in $all) { $byId[[int]$p.Id] = $p }
  $out = @()
  foreach ($l in $raw) {
    $id = [int]$l.Id
    if ($self.ContainsKey($id)) { continue }
    $path = ''; $name = [string]$l.Name
    if ($byId.ContainsKey($id)) { $path = [string]$byId[$id].Path; if (-not $name) { $name = [string]$byId[$id].Name } }
    if (-not $name) { $name = 'unknown' }
    $out += [pscustomobject]@{ Id = $id; Name = $name; Path = $path; Inside = (Test-InAppDir $path) }
  }
  return $out
}

# 'name (PID n), ...' of the programs outside {app} that hold busy files; 'unknown' when the query itself failed.
function Get-OutsideLockerText([string[]]$Busy) {
  $full = @($Busy | ForEach-Object { Join-Path $AppDir $_ })
  try { $lockers = @(Get-FileLockers $full) }
  catch { Write-Log "lock owner query failed: $($_.Exception.Message)"; return 'unknown' }
  $outside = @($lockers | Where-Object { -not $_.Inside })
  if ($outside.Count -eq 0) { return '' }
  return ((@($outside | ForEach-Object { '{0} (PID {1})' -f ($_.Name -replace '[,=\r\n]', ' '), $_.Id }) | Select-Object -Unique) -join ', ')
}

# Only a folder that really is an ARBS-H install: never a drive root, and only with our version file or our service.
function Test-AppFolderIsOurs($Own) {
  $full = [IO.Path]::GetFullPath($AppDir).TrimEnd('\')
  if ($full -ieq ([IO.Path]::GetPathRoot($full).TrimEnd('\'))) { return $false }
  if (Test-Path -LiteralPath (Join-Path $AppDir 'arbs-h-version.txt') -PathType Leaf) { return $true }
  return ($Own.Installed -and (Test-InAppDir (Get-ExeFromBinaryPath $Own.BinaryPath)))
}

function Stop-OneProcess($P) {
  # No /T: a child can be a game. /FI keeps a reused PID with another image name from being ended.
  [void](Invoke-Ext 'taskkill.exe' ('/F /PID {0} /FI "IMAGENAME eq {1}"' -f $P.Id, $P.Name))
}

# After the other ARBS-H processes are gone the helper may be restoring the display (its 5 s grace, then the restore).
function Wait-DisplayRestore {
  if (@(Get-AppProcesses | Where-Object { $_.Name -ieq $script:HelperImage }).Count -eq 0) { return }
  $task = Invoke-Ext 'schtasks.exe' ('/Query /TN {0}' -f (Quote $script:RestoreTask))
  if ($task.ExitCode -ne 0) { return }
  Write-Log 'display restore task present: waiting for the helper to finish'
  for ($i = 0; $i -lt $script:RestoreWaitSeconds; $i++) {
    if (@(Get-AppProcesses | Where-Object { $_.Name -ieq $script:HelperImage }).Count -eq 0) { Write-Log 'helper ended by itself'; return }
    Wait-Short 1000
  }
}

# 0 = nothing left that blocks the file copy, 2 = service will not stop, 7 = still running or locked (nothing changed),
# 8 = a program outside {app} holds a file below {app} (H013 O5: never ended; locked-by= names it for the user).
function Stop-AppProcesses($Own) {
  if (-not (Test-AppFolderIsOurs $Own)) { Set-Result 'app-processes' 'skipped-not-arbs-folder'; return 0 }
  $procs = @(Get-AppProcesses)
  $busy = @(Get-BusyAppFiles)
  if ($procs.Count -eq 0 -and $busy.Count -eq 0) { Set-Result 'app-processes' 'none'; return 0 }
  $apollo = Get-ServiceInfo $script:VibepolloService
  if ($apollo.Installed -and (Test-InAppDir (Get-ExeFromBinaryPath $apollo.BinaryPath))) {
    Set-Result 'app-processes' 'skipped-apollo-in-folder'
    return 0
  }
  $stopped = 0
  $waited = $false
  for ($try = 1; $try -le 3; $try++) {
    $svc = Get-ServiceInfo $script:ServiceName
    if ($svc.Installed -and $svc.State -ne 'STOPPED') {
      Write-Log "service came back ($($svc.State)): stopping it again"
      [void](Invoke-Ext 'sc.exe' ('stop {0}' -f $script:ServiceName))
      if (-not (Wait-ServiceState $script:ServiceName 'STOPPED' 60)) { Set-Result 'prepare' 'stop-timeout'; return 2 }
    }
    $procs = @(Get-AppProcesses)
    if ($procs.Count -eq 0) { break }
    # A surviving sunshine.exe would start the helper again, so it goes first.
    foreach ($p in @($procs | Where-Object { $_.Name -ine $script:HelperImage })) { Stop-OneProcess $p; $stopped++ }
    if (-not $waited) { $waited = $true; Wait-DisplayRestore }
    foreach ($p in @(Get-AppProcesses | Where-Object { $_.Name -ieq $script:HelperImage })) { Stop-OneProcess $p; $stopped++ }
    Wait-Short 1000
  }
  $left = @(Get-AppProcesses)
  $busy = @(Get-BusyAppFiles)
  for ($i = 0; $i -lt 4 -and $left.Count -eq 0 -and $busy.Count -gt 0; $i++) {
    Wait-Short 1000
    $left = @(Get-AppProcesses)
    $busy = @(Get-BusyAppFiles)
  }
  if ($left.Count -gt 0 -or $busy.Count -gt 0) {
    $names = @(@($left | ForEach-Object { Get-AppRelativePath $_.Path }) + @($busy) | Select-Object -Unique)
    Set-Result 'busy' ($names -join ',')
    if ($busy.Count -gt 0) {
      $lockedBy = Get-OutsideLockerText $busy
      if ($lockedBy) {
        Set-Result 'locked-by' $lockedBy
        Set-Result 'prepare' 'locked-by-other'
        return 8
      }
    }
    Set-Result 'prepare' 'app-busy'
    return 7
  }
  Set-Result 'app-processes' ("stopped $stopped")
  return 0
}

function Invoke-Prepare {
  $own = Get-ServiceInfo $script:ServiceName
  Set-Result 'service-before' $own.State
  # H013 O4: post-install puts the service back to this start type (and state) when it fails before the start step.
  Set-Result 'service-start-before' $(if ($own.Installed) { ConvertTo-StartName $own.StartType $own.Delayed } else { 'none' })
  if ($own.Installed -and $own.State -ne 'STOPPED') {
    [void](Invoke-Ext 'sc.exe' ('stop {0}' -f $script:ServiceName))
    if (-not (Wait-ServiceState $script:ServiceName 'STOPPED' 60)) { Set-Result 'prepare' 'stop-timeout'; return 2 }
  }
  $stop = Stop-AppProcesses $own
  if ($stop -ne 0) { return $stop }
  $config = Join-Path $AppDir 'config'
  if (Test-Path -LiteralPath (Join-Path $config 'sunshine.conf')) {
    $old = 'unknown'
    $vf = Join-Path $AppDir 'arbs-h-version.txt'
    if (Test-Path -LiteralPath $vf) { $old = ((Get-Content -LiteralPath $vf -TotalCount 1) -replace '[^0-9A-Za-z.\-+]', '') }
    $backupRoot = Join-Path $DataRoot 'backup'
    $dest = Join-Path $backupRoot ('config-{0}-{1}' -f $old, (Get-Date -Format 'yyyyMMdd-HHmmss'))
    $r = Invoke-Ext 'robocopy.exe' ('{0} {1} /E /B /COPY:DAT /R:0 /W:0 /NP /NJH /NJS' -f (Quote $config), (Quote $dest))
    if ($r.ExitCode -ge 8) { Set-Result 'prepare' 'backup-failed'; return 2 }
    $all = @(Get-ChildItem -LiteralPath $backupRoot -Directory -Filter 'config-*' -ErrorAction SilentlyContinue | Sort-Object CreationTimeUtc, Name -Descending)
    if ($all.Count -gt $script:BackupKeep) { $all[$script:BackupKeep..($all.Count - 1)] | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force } }
    Set-Result 'prepare' ('backup ' + (Split-Path -Leaf $dest))
  }
  else { Set-Result 'prepare' 'no-config' }
  return 0
}

function Invoke-PostInstallSteps {
  $rc = 0
  if ($Migrate) {
    if ((Invoke-Migrate) -ne 0) { $rc = 3 }
  }
  else { Set-Result 'migrate' 'not-selected' }
  if ((Invoke-EnsureConfig) -ne 0) { Set-Reason ('default configuration: ' + $script:Result['config']); return 1 }
  $acl = Invoke-RepairCredentialsAcl
  if ((Invoke-Drivers) -ne 0 -and $rc -eq 0) { $rc = 4 }
  if ((Invoke-Service) -ne 0) { Set-Reason ('service registration: ' + $script:Result['service']); return 1 }
  if ((Invoke-Firewall) -ne 0) { Set-Reason 'firewall rule failed'; return 1 }
  [IO.File]::WriteAllText((Join-Path $AppDir 'arbs-h-version.txt'), $Version, (New-Object Text.UTF8Encoding($false)))
  if ($acl -ne 0) {
    # sunshine.exe cannot read its TLS certificate with this ACL and would only restart in a loop: leave it manual.
    [void](Invoke-Ext 'sc.exe' ('config {0} start= demand' -f $script:ServiceName))
    Set-Result 'start' 'manual-credentials-acl-failed'
    return 6
  }
  $s = Invoke-Start
  if ($s -eq 1) { return 1 }
  if ($s -eq 10 -and $rc -eq 0) { $rc = 10 }
  return $rc
}

# H013 O4: post-install failed (rc 1) before the start step. Back to the start type prepare saw and, if the service was
# running, started again, unless Vibepollo or a port conflict would make it fail (same rule as Invoke-Start). rc 6
# (credentials ACL) and rc 10 (port conflict) never come here: they leave the service manual on purpose.
function Restore-ServiceAfterFailure {
  if (-not $PrevStart -or $PrevStart -eq 'none') { Set-Result 'service-restore' 'not-needed'; Set-Result 'start' 'not-started'; return }
  $own = Get-ServiceInfo $script:ServiceName
  if (-not $own.Installed) { Set-Result 'service-restore' 'not-needed'; Set-Result 'start' 'not-started'; return }
  if (@('auto', 'delayed-auto', 'demand', 'disabled') -notcontains $PrevStart) { Write-Log "service-restore: unexpected previous start type '$PrevStart', start type kept" }
  elseif ((ConvertTo-StartName $own.StartType $own.Delayed) -ne $PrevStart) {
    $r = Invoke-Ext 'sc.exe' ('config {0} start= {1}' -f $script:ServiceName, $PrevStart)
    if ($r.ExitCode -ne 0) { Write-Log "service-restore: start type not restored (exit $($r.ExitCode))" }
  }
  if (@('RUNNING', 'START_PENDING') -notcontains $PrevState) { Set-Result 'service-restore' 'stopped-as-before'; Set-Result 'start' 'not-started'; return }
  $conflict = Get-StartConflict
  if ($conflict) { Set-Result 'service-restore' 'deferred-conflict'; Set-Result 'start' ('deferred-conflict ' + $conflict); return }
  if (Start-OwnService) { Set-Result 'service-restore' 'restored-running'; Set-Result 'start' 'restored-running'; return }
  Set-Result 'service-restore' 'failed'
  Set-Result 'start' 'failed'
}

function Invoke-PostInstall {
  $script:StartAttempted = $false
  $rc = 1
  try { $rc = Invoke-PostInstallSteps }
  catch {
    Write-Log ("ERROR " + $_.Exception.Message)
    Set-Result 'error' $_.Exception.Message
    Set-Reason ('post-install: ' + $_.Exception.Message)
    $rc = 1
  }
  if ($rc -eq 1 -and -not $script:StartAttempted) {
    try { Restore-ServiceAfterFailure }
    catch { Set-Result 'service-restore' 'failed'; Write-Log "service restore failed: $($_.Exception.Message)" }
  }
  return $rc
}

function Restore-ApolloService {
  $path = Join-Path $DataRoot 'rollback\apolloservice.json'
  if (-not (Test-Path -LiteralPath $path)) { Set-Result 'vibepollo' 'no-record'; return 0 }
  $rec = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  if ($rec.Service -ne $script:VibepolloService) { throw "unexpected record service: $($rec.Service)" }
  $name = ConvertTo-StartName ([int]$rec.StartType) ([bool]$rec.Delayed)
  if (@('auto', 'delayed-auto', 'demand', 'disabled') -notcontains $name) { throw "unexpected start type in record: $name" }
  $r = Invoke-Ext 'sc.exe' ('config {0} start= {1}' -f $script:VibepolloService, $name)
  if ($r.ExitCode -ne 0) { Set-Result 'vibepollo' 'restore-config-failed'; return 5 }
  if ($rec.State -eq 'RUNNING') {
    $r = Invoke-Ext 'sc.exe' ('start {0}' -f $script:VibepolloService)
    if ($r.ExitCode -ne 0 -and $r.ExitCode -ne 1056) { Set-Result 'vibepollo' 'restore-start-failed'; return 5 }
  }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  if ($PlanOnly) { Write-Host "PLAN rename $path -> apolloservice.json.restored-$stamp" }
  else { Rename-Item -LiteralPath $path -NewName ('apolloservice.json.restored-' + $stamp) }
  Set-Result 'vibepollo' ('restored ' + $name + '/' + $rec.State)
  return 0
}

# Rollback tool: ARBS-H off (manual), then Vibepollo service back to its recorded values. No queries needed.
function Invoke-Rollback {
  [void](Invoke-Ext 'sc.exe' ('stop {0}' -f $script:ServiceName))
  [void](Invoke-Ext 'sc.exe' ('config {0} start= demand' -f $script:ServiceName))
  if (-not $PlanOnly) { [void](Wait-ServiceState $script:ServiceName 'STOPPED' 60) }
  return (Restore-ApolloService)
}

# H013 O3: the ARBS-H processes below {app} (helper, sunshine.exe with its tray) are ended with the same function as
# the install (by full path; Vibepollo/Apollo folders untouched) BEFORE the restore task is deleted, so a helper that
# is still restoring the display gets its wait. Nothing stops the uninstall; what is left is reported (uninstall-left,
# busy, locked-by, left-config) and the Vibepollo restore always runs.
function Invoke-Uninstall {
  $own = @{ Installed = $false; StartType = 0; Delayed = $false; State = 'NONE'; BinaryPath = '' }
  try { $own = Get-ServiceInfo $script:ServiceName } catch { Write-Log "uninstall: service query failed: $($_.Exception.Message)" }
  [void](Invoke-Ext 'sc.exe' ('stop {0}' -f $script:ServiceName))
  [void](Wait-ServiceState $script:ServiceName 'STOPPED' 60)
  $script:SkipUninstallerFiles = $true
  $stop = 0
  try { $stop = Stop-AppProcesses $own }
  catch { Write-Log "uninstall: process stop failed: $($_.Exception.Message)"; $stop = 1 }
  [void](Invoke-Ext 'sc.exe' ('delete {0}' -f $script:ServiceName))
  foreach ($rule in $script:FirewallRules) { [void](Invoke-Ext 'netsh.exe' ('advfirewall firewall delete rule name={0}' -f (Quote $rule.Name))) }
  [void](Invoke-Ext 'schtasks.exe' ('/Delete /TN {0} /F' -f (Quote $script:RestoreTask)))
  if ($RemoveConfig) {
    $notRemoved = @()
    foreach ($p in @((Join-Path $AppDir 'config'), (Join-Path $DataRoot 'Logs'), (Join-Path $DataRoot 'backup'))) {
      if (-not (Test-Path -LiteralPath $p)) { continue }
      try { Remove-Item -LiteralPath $p -Recurse -Force; Write-Log "removed $p" }
      catch { Write-Log "not removed: $p ($($_.Exception.Message))"; $notRemoved += $p }
    }
    if ($notRemoved.Count -gt 0) { Set-Result 'config' 'partly-removed'; Set-Result 'left-config' ($notRemoved -join ',') }
    else { Set-Result 'config' 'removed' }
  }
  else { Set-Result 'config' 'kept' }
  $rc = 0
  if ($RestoreVibepollo) {
    try { $rc = Restore-ApolloService }
    catch { Write-Log "uninstall: Vibepollo restore failed: $($_.Exception.Message)"; Set-Result 'vibepollo' 'restore-failed'; $rc = 5 }
  }
  else { Set-Result 'vibepollo' 'not-restored' }
  Set-Result 'drivers' 'kept'
  if ($stop -ne 0) {
    Set-Result 'uninstall-left' $(if ($script:Result.Contains('busy')) { $script:Result['busy'] } else { 'processes' })
    if ($rc -eq 0) { $rc = $stop }
  }
  return $rc
}

function Get-DesktopDir {
  if ($OutDir) { return $OutDir }
  return [Environment]::GetFolderPath('Desktop')
}

# Read-only state report (no administrator needed): services, rules, tasks, Vibepollo file list (no credentials).
function Invoke-Snapshot {
  $out = Join-Path (Get-DesktopDir) ('ARBS-H-snapshot-{0}.txt' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $sb = New-Object System.Text.StringBuilder
  foreach ($cmd in @(
      @('sc.exe', "qc $($script:VibepolloService)"), @('sc.exe', "query $($script:VibepolloService)"),
      @('sc.exe', "qc $($script:ServiceName)"), @('sc.exe', "query $($script:ServiceName)"),
      @('netsh.exe', 'advfirewall firewall show rule name="Vibepollo"'), @('netsh.exe', 'advfirewall firewall show rule name="Vibepollo Service"'),
      @('netsh.exe', 'advfirewall firewall show rule name="ARBS-H"'), @('netsh.exe', 'advfirewall firewall show rule name="ARBS-H Service"'),
      @('schtasks.exe', '/Query /TN "\VibepolloDisplayRestore"'), @('schtasks.exe', ('/Query /TN "{0}"' -f $script:RestoreTask)))) {
    $r = Invoke-Ext $cmd[0] $cmd[1]
    [void]$sb.AppendLine("### $($cmd[0]) $($cmd[1])  (exit $($r.ExitCode))")
    [void]$sb.AppendLine($r.Output)
  }
  $apollo = Get-ServiceInfo $script:VibepolloService
  $vroot = Split-Path -Parent (Get-VibepolloConfigDir $apollo)
  [void]$sb.AppendLine("### file list $vroot (name size lastwrite; config\credentials skipped)")
  if (Test-Path -LiteralPath $vroot) {
    Get-ChildItem -LiteralPath $vroot -Recurse -Force -File -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '(?i)\\config\\credentials(\\|$)' } |
      Sort-Object FullName | ForEach-Object {
        [void]$sb.AppendLine(('{0} {1} {2}' -f $_.FullName.Substring($vroot.Length).TrimStart('\'), $_.Length, $_.LastWriteTimeUtc.ToString('s')))
      }
  }
  [IO.File]::WriteAllText($out, $sb.ToString(), (New-Object Text.UTF8Encoding($false)))
  Set-Result 'snapshot' $out
  return 0
}

# Administrator log collection: ARBS-H logs only (no credentials, state or conf files).
function Invoke-CollectLogs {
  $dest = Join-Path (Get-DesktopDir) ('ARBS-H-logs-{0}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  $sources = @(
    @{ From = (Join-Path $AppDir 'config'); Filter = 'sunshine*.log*'; To = 'config' },
    @{ From = (Join-Path $AppDir 'config\logs'); Filter = '*'; To = 'config-logs' },
    @{ From = (Join-Path $DataRoot 'Logs'); Filter = '*'; To = 'service-logs' },
    @{ From = (Join-Path $DataRoot 'setup-logs'); Filter = '*'; To = 'setup-logs' }
  )
  $count = 0
  foreach ($s in $sources) {
    if (-not (Test-Path -LiteralPath $s.From)) { continue }
    $files = @(Get-ChildItem -LiteralPath $s.From -File -Filter $s.Filter -Force -ErrorAction SilentlyContinue)
    if ($files.Count -eq 0) { continue }
    $to = Join-Path $dest $s.To
    New-Item -ItemType Directory -Path $to -Force | Out-Null
    foreach ($f in $files) {
      if ($f.Name -match '(?i)\.(conf|json|pem|key|crt)$|credential|state') { continue }
      Copy-Item -LiteralPath $f.FullName -Destination $to -Force; $count++
    }
  }
  foreach ($cmd in @(@('sc.exe', "query $($script:ServiceName)"), @('sc.exe', "qc $($script:ServiceName)"), @('sc.exe', "query $($script:VibepolloService)"), @('sc.exe', "qc $($script:VibepolloService)"))) {
    $r = Invoke-Ext $cmd[0] $cmd[1]
    Add-Content -LiteralPath (Join-Path $dest 'services.txt') -Value ("### {0} {1} (exit {2})`r`n{3}" -f $cmd[0], $cmd[1], $r.ExitCode, $r.Output) -Encoding UTF8
  }
  Set-Result 'logs' ("$dest files=$count")
  return 0
}

function Write-ResultFile {
  if (-not $ResultOut) { return }
  $lines = foreach ($k in $script:Result.Keys) { '{0}={1}' -f $k, $script:Result[$k] }
  [IO.File]::WriteAllLines($ResultOut, [string[]]@($lines), (New-Object Text.UTF8Encoding($false)))
}

function Invoke-Main {
  Initialize-Context
  $rc = 0
  try {
    switch ($Action) {
      'plan' { [void](Invoke-Plan) }
      'prepare' { $rc = Invoke-Prepare }
      'stop-vibepollo' { if (-not $VibepolloStopApproved) { throw 'stop-vibepollo needs -VibepolloStopApproved (user approval).' }; $rc = Invoke-StopVibepollo }
      'post-install' { $rc = Invoke-PostInstall }
      'migrate' { $rc = Invoke-Migrate }
      'ensure-config' { $rc = Invoke-EnsureConfig }
      'drivers' { $rc = Invoke-Drivers }
      'service' { $rc = Invoke-Service }
      'firewall' { $rc = Invoke-Firewall }
      'start' { $rc = Invoke-Start }
      'uninstall' { $rc = Invoke-Uninstall }
      'rollback' { $rc = Invoke-Rollback }
      'collect-logs' { $rc = Invoke-CollectLogs }
      'snapshot' { $rc = Invoke-Snapshot }
    }
  }
  catch {
    Write-Log ("ERROR " + $_.Exception.Message)
    Set-Result 'error' $_.Exception.Message
    $rc = 1
  }
  Write-ResultFile
  Write-Log "exit $rc"
  return $rc
}

if ($Action -ne 'lib') {
  $code = Invoke-Main
  exit $code
}
