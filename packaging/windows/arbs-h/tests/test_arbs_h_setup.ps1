<#
  ARBS-H R1a installer helper tests T4 (arbs-h-setup.ps1 dry-run) and T5 (rollback plan).
  Nothing real is executed: ARBS_H_TEST_NO_REAL_EXEC=1 makes any real process start throw, every case runs with
  -DryRun inside a scratch FakeRoot, and an injected fake system answers sc/netsh/robocopy/icacls/pnputil/netstat.
  The last check asserts that the real-execution counter is still 0.
  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File test_arbs_h_setup.ps1 [-Scratch <dir>]
#>
param([string]$Scratch = (Join-Path ([IO.Path]::GetTempPath()) ('arbs-h-setup-test-' + [guid]::NewGuid().ToString('N'))))
$ErrorActionPreference = 'Stop'
$env:ARBS_H_TEST_NO_REAL_EXEC = '1'
$TestDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Helper = Join-Path (Split-Path -Parent $TestDir) 'arbs-h-setup.ps1'
$RollbackPs1 = Join-Path (Split-Path -Parent $TestDir) 'arbs-h-rollback.ps1'
New-Item -ItemType Directory -Path $Scratch -Force | Out-Null
$global:T_Pass = 0; $global:T_Fail = 0; $global:T_RealExec = 0

function Ok([bool]$Cond, [string]$Msg) { if ($Cond) { $global:T_Pass++ } else { $global:T_Fail++; Write-Host "FAIL: $Msg" } }
function Eq($Actual, $Expected, [string]$Msg) {
  $a = ($Actual | ForEach-Object { "$_" }) -join "`n"; $e = ($Expected | ForEach-Object { "$_" }) -join "`n"
  if ($a -ceq $e) { $global:T_Pass++ } else { $global:T_Fail++; Write-Host "FAIL: $Msg`n--- expected`n$e`n--- actual`n$a" }
}
function Throws([scriptblock]$Block, [string]$Msg) { try { & $Block; Ok $false "$Msg (no exception)" } catch { Ok $true $Msg } }

# ---------------- fake system ----------------
function New-FakeState {
  @{
    Services = @{
      ApolloService = @{ Start = 2; Delayed = $false; State = 'RUNNING'; Bin = 'C:\Vibepollo\tools\sunshinesvc.exe --service'; StopWorks = $true }
      usbip2_ude    = @{ Start = 3; Delayed = $false; State = 'RUNNING'; Bin = 'System32\drivers\usbip2_ude.sys'; StopWorks = $true }
    }
    Usbip = $true; SudoVda = $true; Ports = @(); Exits = @{}
    # R1a-fix1: fake ACL model (icacls effects + Get-Acl answers). Keys are lower-case full paths.
    Acl = @{}; AclStuck = @{}; AclHard = @{}; AclUnreadable = @{}
  }
}
$script:SddlInherited = 'O:BAG:SYD:AI(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;0x1200a9;;;BU)'   # Program Files default
$script:SddlPrivateDir = 'O:BAG:SYD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'
$script:SddlPrivateFile = 'O:BAG:SYD:AI(A;ID;FA;;;SY)(A;ID;FA;;;BA)'
$script:SddlEmpty = 'O:BAG:SYD:PAI'   # what the 0.1.0 /T command left on every credentials file
function Get-AclKey([string]$Path) { return [IO.Path]::GetFullPath($Path).TrimEnd('\').ToLowerInvariant() }
# Rename keeps ACLs: config.migrating\... entries answer for config\... as well.
function Get-FakeSddl($S, [string]$Path) {
  $k = Get-AclKey $Path
  if ($S.AclUnreadable.ContainsKey($k)) { throw "fake Get-Acl: access denied $Path" }
  if ($S.Acl.ContainsKey($k)) { return $S.Acl[$k] }
  $m = $k -replace '\\config\\', '\config.migrating\'
  if ($m -ne $k -and $S.Acl.ContainsKey($m)) { return $S.Acl[$m] }
  if ($k.EndsWith('\config')) { $m = $k + '.migrating'; if ($S.Acl.ContainsKey($m)) { return $S.Acl[$m] } }
  return $script:SddlInherited
}
function Get-FakeChildren([string]$Dir) { @(Get-ChildItem -LiteralPath $Dir -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { Get-AclKey $_.FullName }) }
function Invoke-FakeIcacls($S, [string]$Arguments) {
  if ($Arguments -notmatch '^"([^"]+)"\s+(.*)$') { throw "fake icacls: bad args $Arguments" }
  $target = $matches[1]; $rest = $matches[2]
  if ($rest -match '^/inheritance:r /grant:r \*S-1-5-18:\(OI\)\(CI\)F \*S-1-5-32-544:\(OI\)\(CI\)F( /T)? /C /Q$') {
    $k = Get-AclKey $target
    if (-not ($S.AclStuck.ContainsKey($k) -or $S.AclHard.ContainsKey($k))) { $S.Acl[$k] = $script:SddlPrivateDir; $S.AclUnreadable.Remove($k) }
    if ($matches[1] -and (Test-Path -LiteralPath $target -PathType Container)) {
      # 0.1.0 behaviour: (OI)(CI) grants do not apply to files, inheritance removed -> protected empty DACL.
      foreach ($c in (Get-FakeChildren $target)) { if (-not ($S.AclStuck.ContainsKey($c) -or $S.AclHard.ContainsKey($c))) { $S.Acl[$c] = $(if (Test-Path -LiteralPath $c -PathType Container) { $script:SddlPrivateDir } else { $script:SddlEmpty }) } }
    }
    return @{ ExitCode = 0; Output = '' }
  }
  if ($rest -eq '/reset /T /C /Q' -and $target.EndsWith('\*')) {
    $dir = $target.Substring(0, $target.Length - 2)
    $parentPrivate = ((Get-FakeSddl $S $dir) -ceq $script:SddlPrivateDir)
    foreach ($c in (Get-FakeChildren $dir)) {
      if ($S.AclStuck.ContainsKey($c) -or $S.AclHard.ContainsKey($c)) { continue }   # /C: failure skipped, exit code still 0
      $S.Acl[$c] = $(if ($parentPrivate) { $script:SddlPrivateFile } else { $script:SddlInherited }); $S.AclUnreadable.Remove($c)
    }
    return @{ ExitCode = 0; Output = '' }
  }
  if ($rest -eq '/setowner *S-1-5-32-544 /C /Q') { $S.AclStuck.Remove((Get-AclKey $target)); return @{ ExitCode = 0; Output = '' } }
  throw "fake icacls: unknown $Arguments"
}
function Format-Qc($name, $svc) {
  $st = switch ($svc.Start) { 2 { if ($svc.Delayed) { '2   AUTO_START  (DELAYED)' } else { '2   AUTO_START' } } 3 { '3   DEMAND_START' } 4 { '4   DISABLED' } }
  "[SC] QueryServiceConfig SUCCESS`r`n`r`nSERVICE_NAME: $name`r`n        TYPE               : 10  WIN32_OWN_PROCESS`r`n        START_TYPE         : $st`r`n        BINARY_PATH_NAME   : $($svc.Bin)`r`n        SERVICE_START_NAME : LocalSystem`r`n"
}
function Format-Query($name, $svc) {
  $n = @{ STOPPED = 1; START_PENDING = 2; STOP_PENDING = 3; RUNNING = 4 }[$svc.State]
  # Localised label on purpose (Korean Windows prints the STATE label in the local language).
  "`r`nSERVICE_NAME: $name`r`n        TYPE               : 10  WIN32_OWN_PROCESS`r`n        STATUS-LOCAL       : $n  $($svc.State)`r`n"
}
function Invoke-FakeRobocopy([string]$Arguments, [string]$Root) {
  if ($Arguments -notmatch '^"([^"]+)"\s+"([^"]+)"\s*(.*)$') { throw "fake robocopy: bad args $Arguments" }
  $src = $matches[1]; $dst = $matches[2]; $rest = $matches[3]
  foreach ($p in @($src, $dst)) { if (-not ([IO.Path]::GetFullPath($p)).StartsWith([IO.Path]::GetFullPath($Root), 'OrdinalIgnoreCase')) { throw "fake robocopy outside scratch: $p" } }
  if ($rest -notmatch '/B\b') { throw 'robocopy without /B' }
  if (-not (Test-Path -LiteralPath $src)) { return @{ ExitCode = 16; Output = 'ERROR source' } }
  New-Item -ItemType Directory -Path $dst -Force | Out-Null
  if ($rest -match '/E\b') { Get-ChildItem -LiteralPath $src -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $dst -Recurse -Force } }
  else {
    foreach ($tok in ($rest -split '\s+')) { if ($tok -and -not $tok.StartsWith('/')) { $f = Join-Path $src $tok; if (Test-Path -LiteralPath $f) { Copy-Item -LiteralPath $f -Destination $dst -Force } } }
  }
  return @{ ExitCode = 1; Output = '' }
}
function Invoke-Fake($S, [string]$Root, [string]$Exe, [string]$Arguments) {
  $key = "$Exe $Arguments"
  foreach ($k in $S.Exits.Keys) { if ($key -match $k) { return @{ ExitCode = $S.Exits[$k]; Output = '' } } }
  switch ($Exe) {
    'sc.exe' {
      $parts = $Arguments -split ' ', 3
      $verb = $parts[0]; $name = $parts[1]
      $svc = $S.Services[$name]
      if ($verb -eq 'create') {
        if ($svc) { return @{ ExitCode = 1073; Output = 'exists' } }
        $bin = if ($Arguments -match 'binPath= "\\"(.+?)\\""') { '"' + $matches[1] + '"' } else { '?' }
        $S.Services[$name] = @{ Start = 3; Delayed = $false; State = 'STOPPED'; Bin = $bin; StopWorks = $true }
        return @{ ExitCode = 0; Output = '[SC] CreateService SUCCESS' }
      }
      if (-not $svc) { return @{ ExitCode = 1060; Output = "[SC] OpenService FAILED 1060:`r`n" } }
      switch ($verb) {
        'qc' { return @{ ExitCode = 0; Output = (Format-Qc $name $svc) } }
        'query' { return @{ ExitCode = 0; Output = (Format-Query $name $svc) } }
        'stop' { if ($svc.State -eq 'STOPPED') { return @{ ExitCode = 1062; Output = '' } }; if ($svc.StopWorks) { $svc.State = 'STOPPED' }; return @{ ExitCode = 0; Output = '' } }
        'start' { if ($svc.State -eq 'RUNNING') { return @{ ExitCode = 1056; Output = '' } }; $svc.State = 'RUNNING'; return @{ ExitCode = 0; Output = '' } }
        'delete' { $S.Services.Remove($name); return @{ ExitCode = 0; Output = '' } }
        'description' { return @{ ExitCode = 0; Output = '' } }
        'config' {
          if ($Arguments -match 'start= (auto|delayed-auto|demand|disabled)$') {
            $v = $matches[1]
            $svc.Start = @{ 'auto' = 2; 'delayed-auto' = 2; 'demand' = 3; 'disabled' = 4 }[$v]; $svc.Delayed = ($v -eq 'delayed-auto')
          }
          elseif ($Arguments -match 'binPath= "\\"(.+?)\\""') { $svc.Bin = '"' + $matches[1] + '"' }
          return @{ ExitCode = 0; Output = '' }
        }
      }
      throw "fake sc: unknown $Arguments"
    }
    'pnputil.exe' {
      $out = 'Microsoft PnP Utility' + $(if ($S.SudoVda) { "`r`nDevice Description: SudoMaker Virtual Display Adapter`r`n" } else { '' })
      return @{ ExitCode = 0; Output = $out }
    }
    'netstat.exe' {
      $lines = foreach ($p in $S.Ports) { "  TCP    0.0.0.0:$p          0.0.0.0:0              LISTENING       1234" }
      return @{ ExitCode = 0; Output = ("Active Connections`r`n  TCP    127.0.0.1:5000     127.0.0.1:47989       ESTABLISHED     1`r`n" + ($lines -join "`r`n")) }
    }
    'robocopy.exe' { return (Invoke-FakeRobocopy $Arguments $Root) }
    'icacls.exe' {
      if ($Arguments -match '\\ProgramData\\ARBS-H"') { return @{ ExitCode = 0; Output = '' } }   # data root (Initialize-DataRoot)
      return (Invoke-FakeIcacls $S $Arguments)
    }
    default { return @{ ExitCode = 0; Output = '' } }   # netsh, schtasks, powershell (driver installers)
  }
}

# Runs $Body with the helper dot-sourced in -DryRun mode inside a fresh FakeRoot.
function Invoke-Case([string]$Name, [scriptblock]$Body, [switch]$NoVibepolloDir) {
  $root = Join-Path $Scratch $Name
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  $app = Join-Path $root 'Program Files\ARBS-H'; $data = Join-Path $root 'ProgramData\ARBS-H'; $vib = Join-Path $root 'Vibepollo\config'
  New-Item -ItemType Directory -Path $app -Force | Out-Null
  try {
    & {
      . $Helper -Action lib -DryRun -FakeRoot $root -AppDir $app -DataRoot $data -VibepolloConfig $vib
      $S = New-FakeState
      $script:Runner = { param($Exe, $Arguments) Invoke-Fake $S $root $Exe $Arguments }
      $script:AclReader = { param($Path) Get-FakeSddl $S $Path }
      & $Body
      $global:T_RealExec += $script:RealExecCount
    }
  }
  catch { $global:T_Fail++; Write-Host "FAIL: case $Name threw: $($_.Exception.Message) at $($_.InvocationInfo.ScriptLineNumber)" }
}
function Mutations { @($script:Plan | Where-Object { $_ -notmatch '^(sc\.exe (qc|query) |netstat\.exe |pnputil\.exe )' }) }
function New-VibepolloConfig([string]$Dir, [string[]]$Skip = @()) {
  New-Item -ItemType Directory -Path (Join-Path $Dir 'credentials') -Force | Out-Null
  $conf = "locale = ko`r`ndd_use_sunshine_virtual_display_driver = enabled`r`nsunshine_name = HOST`r`ndd_use_sunshine_virtual_display_driver = enabled`r`nfile_apps = C:\Vibepollo\config\apps.json`r`n"
  $files = @{ 'sunshine.conf' = $conf; 'apps.json' = '{"apps":[]}'; 'sunshine_state.json' = '{"fake":1}'; 'vibeshine_state.json' = '{"fake":2}' }
  foreach ($k in $files.Keys) { if ($Skip -notcontains $k) { [IO.File]::WriteAllText((Join-Path $Dir $k), $files[$k]) } }
  if ($Skip -notcontains 'credentials') { [IO.File]::WriteAllText((Join-Path $Dir 'credentials\cacert.pem'), 'FAKE-TEST-CERT') }
  [IO.File]::WriteAllText((Join-Path $Dir 'sunshine.log'), 'log')
}
function Get-TreeHash([string]$Dir) {
  (Get-ChildItem -LiteralPath $Dir -Recurse -File -Force | Sort-Object FullName | ForEach-Object { $_.FullName.Substring($Dir.Length) + ' ' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash + ' ' + $_.LastWriteTimeUtc.Ticks }) -join "`n"
}

# ---------------- T4 ----------------
Invoke-Case 'plan' {
  New-VibepolloConfig $vib
  $S.Usbip = $true; $S.SudoVda = $false; $S.Ports = @(47989, 47990)
  $v = Invoke-Plan
  Eq $v.apollo_installed 1 'plan apollo_installed'
  Eq $v.apollo_start 'auto' 'plan apollo_start'
  Eq $v.apollo_state 'RUNNING' 'plan apollo_state'
  Eq $v.vibepollo_config $vib 'plan vibepollo_config'
  Eq $v.arbsh_installed 0 'plan arbsh_installed'
  Eq $v.usbip_present 1 'plan usbip'
  Eq $v.sudovda_present 0 'plan sudovda'
  Eq $v.ports_busy '47989,47990' 'plan ports'
  Eq @(Mutations).Count 0 'plan runs no mutating command'
  Ok (-not (Test-Path -LiteralPath $data)) 'plan creates nothing under DataRoot'
}
Invoke-Case 'plan-config-from-binpath' {
  $VibepolloConfig = ''
  $S.Services.ApolloService.Bin = '"D:\Games\Vibepollo X\tools\sunshinesvc.exe" --service'
  Eq (Get-VibepolloConfigDir (Get-ServiceInfo 'ApolloService')) 'D:\Games\Vibepollo X\config' 'quoted binPath -> config dir'
  $S.Services.ApolloService.Bin = 'C:\Vibepollo\tools\sunshinesvc.exe --service'
  Eq (Get-VibepolloConfigDir (Get-ServiceInfo 'ApolloService')) 'C:\Vibepollo\config' 'plain binPath -> config dir'
}
Invoke-Case 'dataroot' {
  Initialize-DataRoot
  Ok (Test-Path -LiteralPath $data) 'data root created'
  Eq (Mutations) @(
    "icacls.exe `"$data`" /setowner *S-1-5-32-544 /C /Q",
    "icacls.exe `"$data`" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /C /Q") 'data root ACL = SYSTEM + Administrators only (sunshinesvc trust rule)'
}
Invoke-Case 'guards' {
  $AppDir = 'C:\Program Files\ARBS-H'
  Throws { Initialize-Context } 'DryRun refuses a path outside FakeRoot'
  $DryRun = $false
  Throws { Invoke-Ext 'sc.exe' 'query ApolloService' } 'real command blocked by ARBS_H_TEST_NO_REAL_EXEC'
  Eq $script:RealExecCount 0 'blocked command not counted as executed'
}
foreach ($c in @(
    @{ N = 'stop-auto'; Start = 2; Delayed = $false; State = 'RUNNING'; Name = 'auto'; Muts = @('sc.exe stop ApolloService', 'sc.exe config ApolloService start= demand') },
    @{ N = 'stop-delayed'; Start = 2; Delayed = $true; State = 'RUNNING'; Name = 'delayed-auto'; Muts = @('sc.exe stop ApolloService', 'sc.exe config ApolloService start= demand') },
    @{ N = 'stop-demand-stopped'; Start = 3; Delayed = $false; State = 'STOPPED'; Name = 'demand'; Muts = @('sc.exe config ApolloService start= demand') })) {
  $global:C = $c
  Invoke-Case $c.N {
    $c = $global:C
    $S.Services.ApolloService.Start = $c.Start; $S.Services.ApolloService.Delayed = $c.Delayed; $S.Services.ApolloService.State = $c.State
    Eq (Invoke-StopVibepollo) 0 "$($c.N) rc"
    Eq (Mutations) $c.Muts "$($c.N) commands"
    $rec = Get-Content -LiteralPath (Join-Path $data 'rollback\apolloservice.json') -Raw | ConvertFrom-Json
    Eq $rec.StartName $c.Name "$($c.N) record start"
    Eq $rec.State $c.State "$($c.N) record state"
    Eq $rec.Delayed $c.Delayed "$($c.N) record delayed"
    Eq $S.Services.ApolloService.Start 3 "$($c.N) ApolloService now demand"
    Eq $S.Services.ApolloService.State 'STOPPED' "$($c.N) ApolloService now stopped"
  }
}
Invoke-Case 'stop-missing' {
  $S.Services.Remove('ApolloService')
  Eq (Invoke-StopVibepollo) 0 'missing ApolloService rc'
  Eq @(Mutations).Count 0 'missing ApolloService: no command'
  Ok (-not (Test-Path -LiteralPath (Join-Path $data 'rollback\apolloservice.json'))) 'missing ApolloService: no record'
}
Invoke-Case 'stop-record-kept' {
  New-Item -ItemType Directory -Path (Join-Path $data 'rollback') -Force | Out-Null
  $orig = '{"Service":"ApolloService","StartType":2,"Delayed":false,"StartName":"auto","State":"RUNNING","RecordedAt":"2026-01-01T00:00:00","ArbsHVersion":"0.1.0"}'
  [IO.File]::WriteAllText((Join-Path $data 'rollback\apolloservice.json'), $orig)
  $S.Services.ApolloService.Start = 3; $S.Services.ApolloService.State = 'STOPPED'
  Eq (Invoke-StopVibepollo) 0 'second run rc'
  Eq ([IO.File]::ReadAllText((Join-Path $data 'rollback\apolloservice.json'))) $orig 'existing record never overwritten'
}
Invoke-Case 'stop-timeout' {
  $S.Services.ApolloService.StopWorks = $false
  Eq (Invoke-StopVibepollo) 2 'stop timeout rc 2'
  Ok (-not ((Mutations) -contains 'sc.exe config ApolloService start= demand')) 'no start-type change after failed stop'
}
Invoke-Case 'migrate-ok' {
  New-VibepolloConfig $vib
  $S.Services.ApolloService.State = 'STOPPED'
  $before = Get-TreeHash (Split-Path -Parent $vib)
  Eq (Invoke-Migrate) 0 'migrate rc'
  $cfg = Join-Path $app 'config'
  foreach ($f in @('sunshine.conf', 'apps.json', 'sunshine_state.json', 'vibeshine_state.json', 'credentials\cacert.pem', 'sunshine.conf.from-vibepollo')) { Ok (Test-Path -LiteralPath (Join-Path $cfg $f)) "migrated $f" }
  Ok (-not (Test-Path -LiteralPath (Join-Path $cfg 'sunshine.log'))) 'logs not migrated'
  Ok (-not (Test-Path -LiteralPath (Join-Path $app 'config.migrating'))) 'temp folder gone'
  Eq ([IO.File]::ReadAllText((Join-Path $cfg 'sunshine.conf'))) ("locale = ko`r`nsunshine_name = HOST`r`n# arbs-h migrate (old Vibepollo path): file_apps = C:\Vibepollo\config\apps.json`r`ngamepad = usbip_ds5`r`ndd_use_sunshine_virtual_display_driver = disabled`r`nupdate_check_interval = 86400`r`nnotify_pre_releases = false`r`n") 'conf repaired, CRLF kept'
  Eq ([IO.File]::ReadAllText((Join-Path $cfg 'sunshine.conf.from-vibepollo'))) ([IO.File]::ReadAllText((Join-Path $vib 'sunshine.conf'))) 'original conf kept beside'
  Eq (Get-TreeHash (Split-Path -Parent $vib)) $before 'Vibepollo folder unchanged (content and time)'
  Eq (Mutations) @(
    "robocopy.exe `"$vib`" `"$app\config.migrating`" sunshine.conf apps.json sunshine_state.json vibeshine_state.json /B /COPY:DAT /R:0 /W:0 /NP /NJH /NJS",
    "robocopy.exe `"$vib\credentials`" `"$app\config.migrating\credentials`" /E /B /COPY:DAT /R:0 /W:0 /NP /NJH /NJS",
    "icacls.exe `"$app\config.migrating\credentials`" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /C /Q",
    "icacls.exe `"$app\config.migrating\credentials\*`" /reset /T /C /Q") 'migrate commands (R1a-fix1: folder grant without /T, then files /reset)'
  Eq (Get-CredentialsAclProblems (Join-Path $cfg 'credentials')).Count 0 'migrated credentials folder and files private (fake ACL)'
}
foreach ($missing in @('vibeshine_state.json', 'credentials')) {
  $global:M = $missing
  Invoke-Case "migrate-missing-$missing" {
    New-VibepolloConfig $vib -Skip @($global:M)
    $S.Services.ApolloService.State = 'STOPPED'
    Eq (Invoke-Migrate) 3 "missing $($global:M): rc 3"
    Ok (-not (Test-Path -LiteralPath (Join-Path $app 'config'))) "missing $($global:M): nothing migrated"
    Ok (-not (Test-Path -LiteralPath (Join-Path $app 'config.migrating'))) "missing $($global:M): temp removed"
    Eq $script:Result['migrate'] 'failed-all-discarded' "missing $($global:M): result"
  }
}
Invoke-Case 'migrate-refused-running' {
  New-VibepolloConfig $vib
  Eq (Invoke-Migrate) 3 'running Vibepollo: rc 3'
  Eq $script:Result['migrate'] 'refused-vibepollo-running' 'running Vibepollo: refused'
  Eq @(Mutations).Count 0 'running Vibepollo: no copy'
}
Invoke-Case 'migrate-existing-config' {
  New-VibepolloConfig $vib
  $S.Services.ApolloService.State = 'STOPPED'
  New-Item -ItemType Directory -Path (Join-Path $app 'config') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $app 'config\sunshine.conf'), 'mine')
  Eq (Invoke-Migrate) 0 'existing config rc'
  Eq ([IO.File]::ReadAllText((Join-Path $app 'config\sunshine.conf'))) 'mine' 'existing ARBS-H config kept'
  Eq @(Mutations).Count 0 'existing config: no copy'
}
Invoke-Case 'conf-repair' {
  Eq (Repair-ConfText "gamepad = ds4`nupdate_check_interval = 0`n# dd_use_sunshine_virtual_display_driver comment`n") "gamepad = usbip_ds5`nupdate_check_interval = 0`n# dd_use_sunshine_virtual_display_driver comment`ndd_use_sunshine_virtual_display_driver = disabled`nnotify_pre_releases = false`n" 'LF kept, gamepad fixed, user interval kept'
  Eq (Repair-ConfText '') "gamepad = usbip_ds5`ndd_use_sunshine_virtual_display_driver = disabled`nupdate_check_interval = 86400`nnotify_pre_releases = false`n" 'empty conf'
}
Invoke-Case 'ensure-config' {
  New-Item -ItemType Directory -Path (Join-Path $app 'config-template') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $app 'config-template\sunshine.conf'), 'template')
  Eq (Invoke-EnsureConfig) 0 'ensure rc'
  Eq ([IO.File]::ReadAllText((Join-Path $app 'config\sunshine.conf'))) 'template' 'new config from template'
  [IO.File]::WriteAllText((Join-Path $app 'config\sunshine.conf'), 'user')
  Eq (Invoke-EnsureConfig) 0 'ensure rc 2'
  Eq ([IO.File]::ReadAllText((Join-Path $app 'config\sunshine.conf'))) 'user' 'existing config kept'
}
Invoke-Case 'drivers-present' {
  Eq (Invoke-Drivers) 0 'drivers present rc'
  Eq @(Mutations).Count 0 'present drivers: nothing installed'
  Eq $script:Result['usbip'] 'present' 'usbip present'; Eq $script:Result['sudovda'] 'present' 'sudovda present'
}
Invoke-Case 'drivers-missing-unchecked' {
  $S.SudoVda = $false; $S.Services.Remove('ApolloService')
  $S.Exits['^sc\.exe query usbip2_ude'] = 1060
  Eq (Invoke-Drivers) 0 'missing unchecked rc'
  Eq @(Mutations).Count 0 'missing but not selected: nothing installed'
  Eq $script:Result['usbip'] 'missing' 'usbip missing'; Eq $script:Result['sudovda'] 'missing' 'sudovda missing'
}
Invoke-Case 'drivers-missing-checked' {
  $S.SudoVda = $false; $S.Exits['^sc\.exe query usbip2_ude'] = 1060
  $InstallUsbip = $true; $InstallSudoVda = $true
  Eq (Invoke-Drivers) 0 'install rc'
  Eq (Mutations) @(
    "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$app\drivers\usbip-win2\install.ps1`" -InstallerBestEffort",
    "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$app\drivers\sudovda\install.ps1`" -InstallerBestEffort") 'driver installer commands'
}
Invoke-Case 'service-create' {
  Eq (Invoke-Service) 0 'service create rc'
  Eq (Mutations) @(
    "sc.exe create ARBSHService binPath= `"\`"$app\tools\sunshinesvc.exe\`"`" start= demand obj= LocalSystem DisplayName= `"ARBS-H Service`"",
    'sc.exe description ARBSHService "ARBS-H streaming host (Vibepollo 2.18.9 fork)"') 'service create commands'
  Eq $S.Services.ARBSHService.Bin "`"$app\tools\sunshinesvc.exe`"" 'fake service binPath'
  Ok (-not ((Mutations) -match 'ApolloService')) 'service step never names ApolloService'
}
Invoke-Case 'service-existing' {
  $S.Services['ARBSHService'] = @{ Start = 2; Delayed = $false; State = 'STOPPED'; Bin = "`"$app\tools\sunshinesvc.exe`""; StopWorks = $true }
  Eq (Invoke-Service) 0 'service kept rc'
  Eq (Mutations) @('sc.exe description ARBSHService "ARBS-H streaming host (Vibepollo 2.18.9 fork)"') 'same binPath: only description'
  $S.Services.ARBSHService.Bin = '"C:\old\tools\sunshinesvc.exe"'; $script:Plan.Clear()
  Eq (Invoke-Service) 0 'service moved rc'
  Eq @(Mutations)[0] "sc.exe config ARBSHService binPath= `"\`"$app\tools\sunshinesvc.exe\`"`"" 'moved: binPath updated'
}
Invoke-Case 'firewall' {
  Eq (Invoke-Firewall) 0 'firewall rc'
  Eq (Mutations) @(
    'netsh.exe advfirewall firewall delete rule name="ARBS-H"',
    "netsh.exe advfirewall firewall add rule name=`"ARBS-H`" dir=in action=allow program=`"$app\sunshine.exe`" enable=yes profile=any",
    'netsh.exe advfirewall firewall delete rule name="ARBS-H Service"',
    "netsh.exe advfirewall firewall add rule name=`"ARBS-H Service`" dir=in action=allow program=`"$app\tools\sunshinesvc.exe`" enable=yes profile=any") 'firewall commands (own names only)'
}
Invoke-Case 'start-free' {
  $S.Services.ApolloService.Start = 3; $S.Services.ApolloService.State = 'STOPPED'
  $S.Services['ARBSHService'] = @{ Start = 3; Delayed = $false; State = 'STOPPED'; Bin = 'x'; StopWorks = $true }
  Eq (Invoke-Start) 0 'start rc'
  Eq (Mutations) @('sc.exe config ARBSHService start= auto', 'sc.exe start ARBSHService') 'start commands'
}
Invoke-Case 'start-conflict-auto' {
  $S.Services.ApolloService.State = 'STOPPED'
  $S.Services['ARBSHService'] = @{ Start = 3; Delayed = $false; State = 'STOPPED'; Bin = 'x'; StopWorks = $true }
  Eq (Invoke-Start) 10 'Vibepollo auto: deferred'
  Eq (Mutations) @('sc.exe config ARBSHService start= demand') 'deferred: ARBS-H manual, Vibepollo untouched'
}
Invoke-Case 'start-conflict-ports' {
  $S.Services.Remove('ApolloService'); $S.Ports = @(47990)
  $S.Services['ARBSHService'] = @{ Start = 3; Delayed = $false; State = 'STOPPED'; Bin = 'x'; StopWorks = $true }
  Eq (Invoke-Start) 10 'ports busy: deferred'
}
Invoke-Case 'prepare-upgrade' {
  $S.Services['ARBSHService'] = @{ Start = 2; Delayed = $false; State = 'RUNNING'; Bin = 'x'; StopWorks = $true }
  New-Item -ItemType Directory -Path (Join-Path $app 'config') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $app 'config\sunshine.conf'), 'cfg')
  [IO.File]::WriteAllText((Join-Path $app 'arbs-h-version.txt'), '0.0.9')
  foreach ($i in 1..4) { $d = New-Item -ItemType Directory -Path (Join-Path $data "backup\config-0.0.$i-2026010$i-000000") -Force; $d.CreationTimeUtc = [datetime]::new(2026, 1, $i) }
  Eq (Invoke-Prepare) 0 'prepare rc'
  Eq @(Mutations)[0] 'sc.exe stop ARBSHService' 'prepare stops ARBS-H only'
  Ok (@(Mutations)[1] -match '^robocopy\.exe ".+\\config" ".+\\backup\\config-0\.0\.9-\d{8}-\d{6}" /E /B ') 'prepare backs up config'
  Eq @(Get-ChildItem -LiteralPath (Join-Path $data 'backup') -Directory).Count 3 'only 3 newest backups kept'
  Ok (Test-Path -LiteralPath (Join-Path $data 'backup\config-0.0.4-20260104-000000')) 'newest old backup kept'
  Ok (-not ((Mutations) -match 'ApolloService')) 'prepare never touches ApolloService'
}
Invoke-Case 'uninstall-keep-restore' {
  $S.Services.ApolloService.Start = 3; $S.Services.ApolloService.State = 'STOPPED'
  $S.Services['ARBSHService'] = @{ Start = 2; Delayed = $false; State = 'RUNNING'; Bin = 'x'; StopWorks = $true }
  New-Item -ItemType Directory -Path (Join-Path $data 'rollback'), (Join-Path $app 'config') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $data 'rollback\apolloservice.json'), '{"Service":"ApolloService","StartType":2,"Delayed":false,"State":"RUNNING"}')
  [IO.File]::WriteAllText((Join-Path $app 'config\sunshine.conf'), 'cfg')
  $RestoreVibepollo = $true
  Eq (Invoke-Uninstall) 0 'uninstall rc'
  Eq (Mutations) @('sc.exe stop ARBSHService', 'sc.exe delete ARBSHService',
    'netsh.exe advfirewall firewall delete rule name="ARBS-H"', 'netsh.exe advfirewall firewall delete rule name="ARBS-H Service"',
    'schtasks.exe /Delete /TN "\ARBS-H-DisplayRestore" /F',
    'sc.exe config ApolloService start= auto', 'sc.exe start ApolloService') 'uninstall commands (no driver command)'
  Ok (Test-Path -LiteralPath (Join-Path $app 'config\sunshine.conf')) 'config kept'
  Ok (@(Get-ChildItem -LiteralPath (Join-Path $data 'rollback') -Filter 'apolloservice.json.restored-*').Count -eq 1) 'record renamed .restored-*'
  Eq $S.Services.ApolloService.Start 2 'ApolloService auto again'; Eq $S.Services.ApolloService.State 'RUNNING' 'ApolloService running again'
}
Invoke-Case 'uninstall-remove-norestore' {
  $S.Services['ARBSHService'] = @{ Start = 2; Delayed = $false; State = 'STOPPED'; Bin = 'x'; StopWorks = $true }
  New-Item -ItemType Directory -Path (Join-Path $data 'rollback'), (Join-Path $data 'Logs'), (Join-Path $app 'config') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $data 'rollback\apolloservice.json'), '{"Service":"ApolloService","StartType":2,"Delayed":false,"State":"RUNNING"}')
  $RemoveConfig = $true
  Eq (Invoke-Uninstall) 0 'uninstall remove rc'
  Ok (-not (Test-Path -LiteralPath (Join-Path $app 'config'))) 'config removed'
  Ok (-not (Test-Path -LiteralPath (Join-Path $data 'Logs'))) 'service logs removed'
  Ok (Test-Path -LiteralPath (Join-Path $data 'rollback\apolloservice.json')) 'record kept when not restored'
  Ok (-not ((Mutations) -match 'ApolloService')) 'no ApolloService command without restore'
}
Invoke-Case 'post-install-first' {
  New-VibepolloConfig $vib
  New-Item -ItemType Directory -Path (Join-Path $app 'config-template') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $app 'config-template\sunshine.conf'), 'template')
  $VibepolloStopApproved = $true
  Eq (Invoke-StopVibepollo) 0 'first install: stop'
  $Migrate = $true
  Eq (Invoke-PostInstall) 0 'first install: post-install rc'
  Eq $script:Result['migrate'] 'ok' 'first install: migrated'
  Eq $script:Result['config'] 'kept' 'first install: template not used over migrated config'
  Eq $script:Result['start'] 'auto-started' 'first install: started'
  Eq $script:Result['credentials-acl'] 'ok' 'first install: migrated credentials already private'
  Eq $S.Services.ARBSHService.Start 2 'ARBSHService auto'; Eq $S.Services.ARBSHService.State 'RUNNING' 'ARBSHService running'
  Eq ([IO.File]::ReadAllText((Join-Path $app 'arbs-h-version.txt'))) '0.1.1' 'version file'
  Ok (-not ((Mutations) -match '^sc\.exe (delete|start) ApolloService|delete rule name="Vibepollo|VibepolloDisplayRestore|^pnputil\.exe /(delete|remove)')) 'Vibepollo service/rules/task/drivers never deleted'
}

# ---------------- R1a-fix1: credentials ACL (F1-F3, F7) ----------------
Invoke-Case 'sddl-rules' {
  Ok (Test-PrivateSddl 'O:BAG:SYD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)') 'private folder SDDL'
  Ok (Test-PrivateSddl 'O:BAG:SYD:AI(A;ID;FA;;;SY)(A;ID;FA;;;BA)') 'private file SDDL (inherited)'
  Ok (Test-PrivateSddl 'O:BAG:DUD:PAI(A;;0x1f01ff;;;S-1-5-18)(A;;FA;;;BA)S:AI') 'hex full control, SID form, group DU, SACL part'
  Ok (-not (Test-PrivateSddl 'O:BAG:SYD:PAI')) '0.1.0 file SDDL (no ACE) is not private'
  Ok (-not (Test-PrivateSddl '')) 'unreadable (empty) is not private'
  Ok (-not (Test-PrivateSddl 'O:BAG:SYD:AI(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;0x1200a9;;;BU)')) 'Users read is not private'
  Ok (-not (Test-PrivateSddl 'O:BAG:SYD:PAI(A;;FA;;;SY)')) 'SYSTEM only (no Administrators) is not private'
  Ok (-not (Test-PrivateSddl 'O:BAG:SYD:PAI(D;;FA;;;SY)(A;;FA;;;SY)(A;;FA;;;BA)')) 'deny ACE is not private'
  Ok (-not (Test-PrivateSddl 'O:BAG:SYD:PAI(A;OICIIO;FA;;;SY)(A;;FA;;;BA)')) 'inherit-only SYSTEM ACE does not count'
  Ok (-not (Test-PrivateSddl 'O:BAG:SYD:PAI(A;;0x1200a9;;;SY)(A;;FA;;;BA)')) 'SYSTEM read only is not full control'
  Ok (Test-PrivateSddl 'O:BAG:SYD:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;S-1-5-21-1-2-3-1001)' -ExtraAllowed @('S-1-5-21-1-2-3-1001')) 'ExtraAllowed (scratch stand-in only)'
}
function New-ArbsCredentials([string]$App) {
  $c = Join-Path $App 'config\credentials'
  New-Item -ItemType Directory -Path $c -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $App 'config\sunshine.conf'), 'cfg')
  foreach ($f in @('cacert.pem', 'cakey.pem')) { [IO.File]::WriteAllText((Join-Path $c $f), 'FAKE-TEST') }
  return $c
}
function Set-FakeAcl($S, [string]$Path, [string]$Sddl) { $S.Acl[(Get-AclKey $Path)] = $Sddl }
$script:F1Folder = '"{0}" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /C /Q'
$script:F1Files = '"{0}\*" /reset /T /C /Q'
function F1Cmds([string]$Cred) { @(('icacls.exe ' + ($script:F1Folder -f $Cred)), ('icacls.exe ' + ($script:F1Files -f $Cred))) }
Invoke-Case 'credacl-old-command-detected' {
  $cred = New-ArbsCredentials $app
  [void](Invoke-Ext 'icacls.exe' ('{0} /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F /T /C /Q' -f (Quote $cred)))
  Eq (Get-FakeSddl $S (Join-Path $cred 'cacert.pem')) 'O:BAG:SYD:PAI' 'fake model: 0.1.0 command leaves files with no ACE'
  Eq (Get-CredentialsAclProblems $cred).Count 2 '0.1.0 result detected: both files not private'
}
Invoke-Case 'credacl-ok' {
  $cred = New-ArbsCredentials $app
  Set-FakeAcl $S $cred $script:SddlPrivateDir
  foreach ($f in @('cacert.pem', 'cakey.pem')) { Set-FakeAcl $S (Join-Path $cred $f) $script:SddlPrivateFile }
  Eq (Invoke-RepairCredentialsAcl) 0 'already private: rc 0'
  Eq $script:Result['credentials-acl'] 'ok' 'already private: ok'
  Eq @(Mutations).Count 0 'already private: no icacls'
}
Invoke-Case 'credacl-absent' {
  Eq (Invoke-RepairCredentialsAcl) 0 'no credentials folder: rc 0'
  Eq $script:Result['credentials-acl'] 'absent' 'no credentials folder: absent'
  Eq @(Mutations).Count 0 'no credentials folder: no icacls'
}
Invoke-Case 'credacl-broken-0.1.0' {
  $cred = New-ArbsCredentials $app
  Set-FakeAcl $S $cred $script:SddlPrivateDir
  foreach ($f in @('cacert.pem', 'cakey.pem')) { Set-FakeAcl $S (Join-Path $cred $f) $script:SddlEmpty }
  Eq (Invoke-RepairCredentialsAcl) 0 '0.1.0 install: rc 0'
  Eq $script:Result['credentials-acl'] 'repaired' '0.1.0 install: repaired'
  Eq (Mutations) (F1Cmds $cred) '0.1.0 install: folder grant first, then files /reset'
  Eq (Get-FakeSddl $S (Join-Path $cred 'cakey.pem')) $script:SddlPrivateFile '0.1.0 install: key file inherits SYSTEM + Administrators only'
}
Invoke-Case 'credacl-users-inherited' {
  $cred = New-ArbsCredentials $app   # unknown paths answer the Program Files default (Users read)
  Eq (Invoke-RepairCredentialsAcl) 0 'Users read: rc 0'
  Eq $script:Result['credentials-acl'] 'repaired' 'Users read: repaired'
  Eq (Get-CredentialsAclProblems $cred).Count 0 'Users read removed from folder and files'
}
Invoke-Case 'credacl-unreadable-then-fixed' {
  $cred = New-ArbsCredentials $app
  Set-FakeAcl $S $cred $script:SddlPrivateDir
  Set-FakeAcl $S (Join-Path $cred 'cacert.pem') $script:SddlPrivateFile
  $S.AclUnreadable[(Get-AclKey (Join-Path $cred 'cakey.pem'))] = $true
  Eq (Invoke-RepairCredentialsAcl) 0 'Get-Acl failure: rc 0'
  Eq $script:Result['credentials-acl'] 'repaired' 'Get-Acl failure counts as not private, then repaired'
}
Invoke-Case 'credacl-retry-owner' {
  $cred = New-ArbsCredentials $app
  Set-FakeAcl $S $cred $script:SddlPrivateDir
  $key = Join-Path $cred 'cakey.pem'
  Set-FakeAcl $S (Join-Path $cred 'cacert.pem') $script:SddlEmpty; Set-FakeAcl $S $key $script:SddlEmpty
  $S.AclStuck[(Get-AclKey $key)] = $true   # /reset skipped until the owner is Administrators
  Eq (Invoke-RepairCredentialsAcl) 0 'retry: rc 0'
  Eq $script:Result['credentials-acl'] 'repaired' 'retry: repaired'
  Eq (Mutations) (@(F1Cmds $cred) + @("icacls.exe `"$key`" /setowner *S-1-5-32-544 /C /Q") + @(F1Cmds $cred)) 'retry: F1, setowner on the failed file only, F1 again'
}
Invoke-Case 'credacl-failed' {
  $cred = New-ArbsCredentials $app
  $key = Join-Path $cred 'cakey.pem'
  Set-FakeAcl $S $key $script:SddlEmpty
  $S.AclHard[(Get-AclKey $key)] = $true   # never fixable (icacls /C /Q still exits 0)
  Eq (Invoke-RepairCredentialsAcl) 6 'unfixable: rc 6'
  Eq $script:Result['credentials-acl'] 'failed' 'unfixable: failed'
  Eq @(Mutations | Where-Object { $_ -match 'setowner' }).Count 1 'unfixable: exactly one retry'
}
Invoke-Case 'post-install-upgrade-repairs-0.1.0' {
  $S.Services.ApolloService.Start = 3; $S.Services.ApolloService.State = 'STOPPED'
  $S.Services['ARBSHService'] = @{ Start = 2; Delayed = $false; State = 'STOPPED'; Bin = "`"$app\tools\sunshinesvc.exe`""; StopWorks = $true }
  $cred = New-ArbsCredentials $app
  Set-FakeAcl $S $cred $script:SddlPrivateDir
  foreach ($f in @('cacert.pem', 'cakey.pem')) { Set-FakeAcl $S (Join-Path $cred $f) $script:SddlEmpty }
  Eq (Invoke-PostInstall) 0 'upgrade over 0.1.0: rc 0'
  Eq $script:Result['migrate'] 'not-selected' 'upgrade: no migration'
  Eq $script:Result['credentials-acl'] 'repaired' 'upgrade: credentials repaired'
  Eq $script:Result['start'] 'auto-started' 'upgrade: started after repair'
  $m = @(Mutations)
  $iReset = [array]::IndexOf($m, (F1Cmds $cred)[1]); $iStart = [array]::IndexOf($m, 'sc.exe start ARBSHService')
  Ok ($iReset -ge 0 -and $iReset -lt $iStart) 'upgrade: repair before service start'
}
Invoke-Case 'post-install-acl-failed-manual' {
  $S.Services.ApolloService.Start = 3; $S.Services.ApolloService.State = 'STOPPED'
  $S.Services['ARBSHService'] = @{ Start = 2; Delayed = $false; State = 'STOPPED'; Bin = "`"$app\tools\sunshinesvc.exe`""; StopWorks = $true }
  $cred = New-ArbsCredentials $app
  $S.AclHard[(Get-AclKey (Join-Path $cred 'cacert.pem'))] = $true; Set-FakeAcl $S (Join-Path $cred 'cacert.pem') $script:SddlEmpty
  Eq (Invoke-PostInstall) 6 'ACL failed: post-install rc 6'
  Eq $script:Result['credentials-acl'] 'failed' 'ACL failed: result'
  Eq $script:Result['start'] 'manual-credentials-acl-failed' 'ACL failed: start result'
  Ok ((Mutations) -contains 'sc.exe config ARBSHService start= demand') 'ACL failed: ARBS-H service set to manual'
  Ok (-not ((Mutations) -match '^sc\.exe (start ARBSHService|config ARBSHService start= auto)')) 'ACL failed: service not started, not auto'
  Eq $S.Services.ARBSHService.State 'STOPPED' 'ACL failed: service still stopped'
  Ok (-not ((Mutations) -match 'ApolloService')) 'ACL failed: Vibepollo untouched'
}

# ---------------- T5 rollback ----------------
foreach ($r in @(
    @{ N = 'auto-running'; Start = 2; Delayed = $false; State = 'RUNNING'; Cmd = 'auto'; Start2 = $true },
    @{ N = 'delayed-running'; Start = 2; Delayed = $true; State = 'RUNNING'; Cmd = 'delayed-auto'; Start2 = $true },
    @{ N = 'demand-stopped'; Start = 3; Delayed = $false; State = 'STOPPED'; Cmd = 'demand'; Start2 = $false },
    @{ N = 'disabled-stopped'; Start = 4; Delayed = $false; State = 'STOPPED'; Cmd = 'disabled'; Start2 = $false })) {
  $global:R = $r
  Invoke-Case "rollback-$($r.N)" {
    $r = $global:R
    $S.Services.ApolloService.Start = 3; $S.Services.ApolloService.State = 'STOPPED'
    $S.Services['ARBSHService'] = @{ Start = 2; Delayed = $false; State = 'RUNNING'; Bin = 'x'; StopWorks = $true }
    New-Item -ItemType Directory -Path (Join-Path $data 'rollback') -Force | Out-Null
    $rec = @{ Service = 'ApolloService'; StartType = $r.Start; Delayed = $r.Delayed; State = $r.State } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $data 'rollback\apolloservice.json'), $rec)
    Eq (Invoke-Rollback) 0 "rollback $($r.N) rc"
    $want = @('sc.exe stop ARBSHService', 'sc.exe config ARBSHService start= demand', "sc.exe config ApolloService start= $($r.Cmd)")
    if ($r.Start2) { $want += 'sc.exe start ApolloService' }
    Eq (Mutations) $want "rollback $($r.N) commands"
    Ok (@(Get-ChildItem -LiteralPath (Join-Path $data 'rollback') -Filter 'apolloservice.json.restored-*').Count -eq 1) "rollback $($r.N) record renamed"
    Eq (Invoke-Rollback) 0 "rollback $($r.N) second run (no record) rc"
    Eq $script:Result['vibepollo'] 'no-record' "rollback $($r.N) second run does nothing to Vibepollo"
  }
}
Invoke-Case 'rollback-bad-record' {
  New-Item -ItemType Directory -Path (Join-Path $data 'rollback') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $data 'rollback\apolloservice.json'), '{"Service":"OtherService","StartType":2,"Delayed":false,"State":"RUNNING"}')
  Throws { Restore-ApolloService } 'record for another service refused'
}

# ---------------- CLI paths (child processes, still no real system command) ----------------
$cli = Join-Path $Scratch 'cli'
New-Item -ItemType Directory -Path (Join-Path $cli 'ProgramData\ARBS-H\rollback') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $cli 'ProgramData\ARBS-H\rollback\apolloservice.json'), '{"Service":"ApolloService","StartType":2,"Delayed":true,"State":"RUNNING"}')
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$planOut = & $ps -NoProfile -ExecutionPolicy Bypass -File $RollbackPs1 -Plan -DataRoot (Join-Path $cli 'ProgramData\ARBS-H') 2>&1 | Out-String
Eq $LASTEXITCODE 0 'rollback -Plan exit 0'
foreach ($l in @('PLAN sc.exe stop ARBSHService', 'PLAN sc.exe config ARBSHService start= demand', 'PLAN sc.exe config ApolloService start= delayed-auto', 'PLAN sc.exe start ApolloService')) { Ok ($planOut -match [regex]::Escape($l)) "rollback -Plan prints '$l'" }
Ok (Test-Path -LiteralPath (Join-Path $cli 'ProgramData\ARBS-H\rollback\apolloservice.json')) 'rollback -Plan leaves the record'
Ok (-not (Test-Path -LiteralPath (Join-Path $cli 'ProgramData\ARBS-H\setup-logs'))) 'rollback -Plan writes no log'

$fake = @(
  @{ match = '^sc\.exe qc ApolloService'; exit = 0; output = "START_TYPE         : 2   AUTO_START`r`nBINARY_PATH_NAME   : C:\Vibepollo\tools\sunshinesvc.exe --service" },
  @{ match = '^sc\.exe query ApolloService'; exit = 0; output = 'STATE              : 4  RUNNING' },
  @{ match = '^sc\.exe (qc|query) ARBSHService'; exit = 1060; output = '1060' },
  @{ match = '^sc\.exe query usbip2_ude'; exit = 0; output = 'RUNNING' },
  @{ match = '^pnputil'; exit = 0; output = 'Device Description: SudoMaker Virtual Display Adapter' },
  @{ match = '^netstat'; exit = 0; output = '  TCP    0.0.0.0:47989          0.0.0.0:0              LISTENING       9' })
($fake | ConvertTo-Json) | Set-Content -LiteralPath (Join-Path $cli 'fake.json') -Encoding UTF8
$planFile = Join-Path $cli 'plan.txt'
& $ps -NoProfile -ExecutionPolicy Bypass -File $Helper -Action plan -DryRun -FakeRoot $cli -AppDir (Join-Path $cli 'app') -DataRoot (Join-Path $cli 'ProgramData\ARBS-H') -PlanOut $planFile | Out-Null
Eq $LASTEXITCODE 0 'CLI -DryRun plan exit 0'
Eq (Get-Content -LiteralPath $planFile) @('apollo_installed=1', 'apollo_start=auto', 'apollo_state=RUNNING', 'vibepollo_config=', 'arbsh_installed=0', 'arbsh_config=0', 'usbip_present=1', 'sudovda_present=1', 'ports_busy=47989', 'rollback_record=1') 'CLI -DryRun -FakeRoot plan output (fake.json)'
$ErrorActionPreference = 'Continue'
& $ps -NoProfile -ExecutionPolicy Bypass -File $Helper -Action plan -DryRun -FakeRoot $cli -AppDir 'C:\Program Files\ARBS-H' -PlanOut (Join-Path $cli 'x.txt') 2>$null | Out-Null
$refused = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Eq $refused 1 'CLI -DryRun with a real path is refused'
Ok (-not (Test-Path -LiteralPath (Join-Path $cli 'x.txt'))) 'refused run wrote nothing'

Eq $global:T_RealExec 0 'real process starts in all cases'
Write-Host ("arbs-h setup helper tests: {0} passed, {1} failed (scratch {2})" -f $global:T_Pass, $global:T_Fail, $Scratch)
if ($global:T_Fail -eq 0) { Remove-Item -LiteralPath $Scratch -Recurse -Force; exit 0 } else { exit 1 }
