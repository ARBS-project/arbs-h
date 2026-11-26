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
    # R1b-fix1: fake process table and restore task.
    Procs = (New-Object System.Collections.ArrayList); Locked = @(); KillWorks = $true; ReviveOnce = $false; StopFailsAfterRevive = $false
    TaskPresent = $false; HelperGoneAfter = 0; ListCalls = 0; LockCalls = 0
    # H013 O5: programs that hold files (Restart Manager answers). A holder counts while its Id is in Procs.
    Holders = (New-Object System.Collections.ArrayList); LockerCalls = 0; LockerThrows = $false
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
    'schtasks.exe' {
      if ($Arguments -like '/Query*' -and -not $S.TaskPresent) { return @{ ExitCode = 1; Output = '' } }
      return @{ ExitCode = 0; Output = '' }
    }
    'taskkill.exe' {
      if ($Arguments -notmatch '^/F /PID (\d+) /FI "IMAGENAME eq ([^"]+)"$') { throw "fake taskkill: bad args $Arguments" }
      $id = [int]$matches[1]; $image = $matches[2]
      $hit = @($S.Procs | Where-Object { $_.Id -eq $id -and $_.Name -ieq $image })
      if ($S.KillWorks) { foreach ($p in $hit) { [void]$S.Procs.Remove($p) } }
      if ($S.ReviveOnce) {
        $S.ReviveOnce = $false
        $S.Services.ARBSHService.State = 'RUNNING'
        if ($S.StopFailsAfterRevive) { $S.Services.ARBSHService.StopWorks = $false }
        [void]$S.Procs.Add([pscustomobject]@{ Id = $id + 1000; ParentId = 4; Name = 'sunshine.exe'; Path = ($hit[0].Path) })
      }
      return @{ ExitCode = 0; Output = '' }
    }
    'icacls.exe' {
      if ($Arguments -match '\\ProgramData\\ARBS-H"') { return @{ ExitCode = 0; Output = '' } }   # data root (Initialize-DataRoot)
      return (Invoke-FakeIcacls $S $Arguments)
    }
    default { return @{ ExitCode = 0; Output = '' } }   # netsh, powershell (driver installers)
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
function Mutations { @($script:Plan | Where-Object { $_ -notmatch '^(sc\.exe (qc|query) |netstat\.exe |pnputil\.exe |schtasks\.exe /Query )' }) }
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
  Eq ([IO.File]::ReadAllText((Join-Path $app 'arbs-h-version.txt'))) '0.2.2' 'version file'
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

# ---------------- R1b-fix1 G1: ARBS-H processes left after the service stop (H1-H12) ----------------
$script:HelperExe = 'sunshine_display_helper.exe'
function New-FakeProc([int]$Id, [string]$Name, [string]$Path, [int]$ParentId = 4) { [pscustomobject]@{ Id = $Id; ParentId = $ParentId; Name = $Name; Path = $Path } }
function Get-FakeProcs($S) {
  $S.ListCalls++
  if ($S.HelperGoneAfter -gt 0 -and $S.ListCalls -ge $S.HelperGoneAfter) {
    foreach ($p in @($S.Procs | Where-Object { $_.Name -ieq $script:HelperExe })) { [void]$S.Procs.Remove($p) }
  }
  return @($S.Procs)
}
# Installed ARBS-H: version file, running service, config to back up, process list and lock answers from the fake.
function Initialize-FakeInstall {
  [IO.File]::WriteAllText((Join-Path $app 'arbs-h-version.txt'), '0.1.2')
  New-Item -ItemType Directory -Path (Join-Path $app 'tools'), (Join-Path $app 'config') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $app 'config\sunshine.conf'), 'cfg')
  $S.Services['ARBSHService'] = @{ Start = 2; Delayed = $false; State = 'RUNNING'; Bin = "`"$app\tools\sunshinesvc.exe`""; StopWorks = $true }
  $S.Services.ApolloService.Start = 3; $S.Services.ApolloService.State = 'STOPPED'
  $script:ProcessLister = { Get-FakeProcs $S }
  $script:FileBusyProbe = { param($Path) $S.Locked -contains (Split-Path -Leaf $Path) }
}
function Kills { @($script:Plan | Where-Object { $_ -match '^taskkill\.exe ' }) }
function KillCmd([int]$Id, [string]$Name) { "taskkill.exe /F /PID $Id /FI `"IMAGENAME eq $Name`"" }
function Test-NoBackup { Ok (-not (Test-Path -LiteralPath (Join-Path $data 'backup'))) 'no backup folder'; Ok (@($script:Plan | Where-Object { $_ -match '^robocopy' }).Count -eq 0) 'no robocopy' }

Invoke-Case 'h1-other-path-same-name' {
  Initialize-FakeInstall
  [void]$S.Procs.Add((New-FakeProc 101 $script:HelperExe "$app\tools\$($script:HelperExe)"))
  [void]$S.Procs.Add((New-FakeProc 102 $script:HelperExe "C:\Vibepollo\tools\$($script:HelperExe)"))
  [void]$S.Procs.Add((New-FakeProc 103 'sunshine.exe' 'C:\Apollo\sunshine.exe'))
  Eq (Invoke-Prepare) 0 'H1 rc'
  Eq (Kills) @(KillCmd 101 $script:HelperExe) 'H1 only the process under {app} is ended'
  Eq @($S.Procs | ForEach-Object { $_.Id }) @(102, 103) 'H1 Vibepollo and Apollo processes still there'
}
Invoke-Case 'h2-prefix-path' {
  Initialize-FakeInstall
  [void]$S.Procs.Add((New-FakeProc 201 'sunshine.exe' ($app + '2\sunshine.exe')))
  [void]$S.Procs.Add((New-FakeProc 202 'sunshine.exe' ($app + ' Backup\tools\sunshine.exe')))
  Eq (Invoke-Prepare) 0 'H2 rc'
  Eq @(Kills).Count 0 'H2 a folder that only starts with the same text is not {app}'
}
Invoke-Case 'h3-order-no-tree' {
  Initialize-FakeInstall
  [void]$S.Procs.Add((New-FakeProc 301 $script:HelperExe "$app\tools\$($script:HelperExe)"))
  [void]$S.Procs.Add((New-FakeProc 302 'sunshine.exe' "$app\sunshine.exe"))
  Eq (Invoke-Prepare) 0 'H3 rc'
  Eq (Kills) @((KillCmd 302 'sunshine.exe'), (KillCmd 301 $script:HelperExe)) 'H3 sunshine first, helper after'
  Ok (-not ((Kills) -match '/T\b')) 'H3 no /T'
  $m = @(Mutations)
  $iKill = [array]::IndexOf($m, (KillCmd 301 $script:HelperExe))
  $iCopy = -1; for ($i = 0; $i -lt $m.Count; $i++) { if ($m[$i] -match '^robocopy') { $iCopy = $i; break } }
  Ok ($m[0] -eq 'sc.exe stop ARBSHService' -and $iKill -gt 0 -and $iCopy -gt $iKill) 'H3 service stop -> process stop -> backup'
}
Invoke-Case 'h4-no-process' {
  Initialize-FakeInstall
  Eq (Invoke-Prepare) 0 'H4 rc'
  $m = @(Mutations)
  Eq $m.Count 2 'H4 only service stop + backup'
  Eq $m[0] 'sc.exe stop ARBSHService' 'H4 first command'
  Ok ($m[1] -match '^robocopy\.exe ') 'H4 second command'
  Eq @($script:Plan | Where-Object { $_ -match 'schtasks|taskkill|qc ApolloService' }).Count 0 'H4 no extra query or kill'
  Eq $script:Result['app-processes'] 'none' 'H4 result'
  Eq $script:Result['service-before'] 'RUNNING' 'H4 service-before'
}
Invoke-Case 'h5-still-running' {
  Initialize-FakeInstall
  $S.KillWorks = $false
  [void]$S.Procs.Add((New-FakeProc 501 $script:HelperExe "$app\tools\$($script:HelperExe)"))
  Eq (Invoke-Prepare) 7 'H5 process survives: rc 7'
  Eq $script:Result['busy'] "tools\$($script:HelperExe)" 'H5 busy names the file (relative to {app}, H013)'
  Eq $script:Result['prepare'] 'app-busy' 'H5 result'
  Eq @(Kills).Count 3 'H5 three attempts'
  Test-NoBackup
}
Invoke-Case 'h5-file-locked' {
  Initialize-FakeInstall
  [IO.File]::WriteAllText((Join-Path $app 'tools\locked.dll'), 'x')
  [IO.File]::WriteAllText((Join-Path $app 'tools\free.dll'), 'x')
  [IO.File]::WriteAllText((Join-Path $app 'tools\notes.txt'), 'x')
  $S.Locked = @('locked.dll', 'notes.txt')
  Eq (Invoke-Prepare) 7 'H5 locked file: rc 7'
  Eq $script:Result['busy'] 'tools\locked.dll' 'H5 only exe/dll are judged (relative path, H013)'
  Eq @(Kills).Count 0 'H5 nothing to end'
  Test-NoBackup
}
Invoke-Case 'h5-lock-clears' {
  Initialize-FakeInstall
  [IO.File]::WriteAllText((Join-Path $app 'tools\late.dll'), 'x')
  $S.LockCalls = 0
  $script:FileBusyProbe = { param($Path) $S.LockCalls++; $S.LockCalls -le 2 }
  Eq (Invoke-Prepare) 0 'H5 short lock (scanner) clears: rc 0'
  Ok (Test-Path -LiteralPath (Join-Path $data 'backup')) 'H5 short lock: backup runs'
}
Invoke-Case 'h6-service-returns' {
  Initialize-FakeInstall
  $S.ReviveOnce = $true
  [void]$S.Procs.Add((New-FakeProc 601 'sunshine.exe' "$app\sunshine.exe"))
  Eq (Invoke-Prepare) 0 'H6 rc'
  Eq @($script:Plan | Where-Object { $_ -eq 'sc.exe stop ARBSHService' }).Count 2 'H6 service stopped again'
  Eq $S.Services.ARBSHService.State 'STOPPED' 'H6 service stays stopped'
  Eq @($S.Procs).Count 0 'H6 revived process ended'
}
Invoke-Case 'h6-service-will-not-stop' {
  Initialize-FakeInstall
  $S.ReviveOnce = $true
  [void]$S.Procs.Add((New-FakeProc 611 'sunshine.exe' "$app\sunshine.exe"))
  $S.StopFailsAfterRevive = $true
  Eq (Invoke-Prepare) 2 'H6 service cannot be stopped again: rc 2'
  Test-NoBackup
}
Invoke-Case 'h7-drive-root' {
  Initialize-FakeInstall
  [void]$S.Procs.Add((New-FakeProc 701 'sunshine.exe' 'D:\sunshine.exe'))
  $AppDir = 'D:\'
  Eq (Stop-AppProcesses (Get-ServiceInfo 'ARBSHService')) 0 'H7 drive root rc'
  Eq @(Kills).Count 0 'H7 drive root: no kill'
  Eq $script:Result['app-processes'] 'skipped-not-arbs-folder' 'H7 drive root result'
}
Invoke-Case 'h7-apollo-in-folder' {
  Initialize-FakeInstall
  $S.Services.ApolloService.Bin = "`"$app\tools\sunshinesvc.exe`" --service"
  [void]$S.Procs.Add((New-FakeProc 711 'sunshine.exe' "$app\sunshine.exe"))
  Eq (Stop-AppProcesses (Get-ServiceInfo 'ARBSHService')) 0 'H7 Apollo in folder rc'
  Eq @(Kills).Count 0 'H7 Apollo in folder: no kill'
  Eq $script:Result['app-processes'] 'skipped-apollo-in-folder' 'H7 Apollo in folder result'
}
Invoke-Case 'h7-unmarked-folder' {
  $script:ProcessLister = { Get-FakeProcs $S }
  [void]$S.Procs.Add((New-FakeProc 721 'other.exe' "$app\other.exe"))
  Eq (Invoke-Prepare) 0 'H7 folder without marker rc'
  Eq @(Kills).Count 0 'H7 folder without marker: no kill'
  Eq $script:Result['app-processes'] 'skipped-not-arbs-folder' 'H7 folder without marker result'
}
Invoke-Case 'h7-service-path-marks-folder' {
  Initialize-FakeInstall
  Remove-Item -LiteralPath (Join-Path $app 'arbs-h-version.txt')
  [void]$S.Procs.Add((New-FakeProc 731 'sunshine.exe' "$app\sunshine.exe"))
  Eq (Invoke-Prepare) 0 'H7 service path under {app} rc'
  Eq (Kills) @(KillCmd 731 'sunshine.exe') 'H7 ARBSHService under {app} counts as ours'
}
Invoke-Case 'h8-task-helper-ends' {
  Initialize-FakeInstall
  $S.TaskPresent = $true; $S.HelperGoneAfter = 8
  [void]$S.Procs.Add((New-FakeProc 801 'sunshine.exe' "$app\sunshine.exe"))
  [void]$S.Procs.Add((New-FakeProc 802 $script:HelperExe "$app\tools\$($script:HelperExe)"))
  Eq (Invoke-Prepare) 0 'H8 rc'
  Eq (Kills) @(KillCmd 801 'sunshine.exe') 'H8 helper finished its restore by itself and was not ended'
  Eq @($script:Plan | Where-Object { $_ -eq 'schtasks.exe /Query /TN "\ARBS-H-DisplayRestore"' }).Count 1 'H8 task checked once'
}
Invoke-Case 'h8-task-wait-limit' {
  Initialize-FakeInstall
  $S.TaskPresent = $true
  [void]$S.Procs.Add((New-FakeProc 811 $script:HelperExe "$app\tools\$($script:HelperExe)"))
  Eq (Invoke-Prepare) 0 'H8 limit rc'
  Eq (Kills) @(KillCmd 811 $script:HelperExe) 'H8 helper ended after the wait'
  Ok ($S.ListCalls -ge 20) "H8 waited (polls $($S.ListCalls))"
}
Invoke-Case 'h8-no-task' {
  Initialize-FakeInstall
  [void]$S.Procs.Add((New-FakeProc 821 $script:HelperExe "$app\tools\$($script:HelperExe)"))
  Eq (Invoke-Prepare) 0 'H8 no task rc'
  Eq (Kills) @(KillCmd 821 $script:HelperExe) 'H8 no task: helper ended'
  Ok ($S.ListCalls -lt 15) "H8 no task: no wait (polls $($S.ListCalls))"
}
Invoke-Case 'h9-same-version-reinstall' {
  Initialize-FakeInstall
  [void]$S.Procs.Add((New-FakeProc 901 'sunshine.exe' "$app\sunshine.exe"))
  [void]$S.Procs.Add((New-FakeProc 902 $script:HelperExe "$app\tools\$($script:HelperExe)"))
  Eq (Invoke-Prepare) 0 'H9 prepare rc'
  Ok ($script:Result['prepare'] -match '^backup config-0\.1\.2-') 'H9 config backed up'
  Eq $script:Result['app-processes'] 'stopped 2' 'H9 both ended'
  Eq (Invoke-PostInstall) 0 'H9 post-install rc'
  Eq $script:Result['start'] 'auto-started' 'H9 start = auto-started'
  Eq $S.Services.ARBSHService.State 'RUNNING' 'H9 service running again'
  Eq $S.Services.ARBSHService.Start 2 'H9 service auto'
}
Invoke-Case 'h9-upgrade-from-0.1.1' {
  Initialize-FakeInstall
  [IO.File]::WriteAllText((Join-Path $app 'arbs-h-version.txt'), '0.1.1')
  [void]$S.Procs.Add((New-FakeProc 911 $script:HelperExe "$app\tools\$($script:HelperExe)"))
  Eq (Invoke-Prepare) 0 'H9 upgrade prepare rc'
  Ok ($script:Result['prepare'] -match '^backup config-0\.1\.1-') 'H9 upgrade backup names the old version'
  Eq (Invoke-PostInstall) 0 'H9 upgrade post-install rc'
  Eq ([IO.File]::ReadAllText((Join-Path $app 'arbs-h-version.txt'))) '0.2.2' 'H9 upgrade version file'
}
Invoke-Case 'h10-unreadable-path' {
  Initialize-FakeInstall
  [void]$S.Procs.Add((New-FakeProc 1001 $script:HelperExe ''))
  [void]$S.Procs.Add((New-FakeProc 1002 'csrss.exe' '\??\C:\WINDOWS\system32\csrss.exe'))
  Eq (Invoke-Prepare) 0 'H10 rc'
  Eq @(Kills).Count 0 'H10 a process without a readable path is not ended'
}
Invoke-Case 'h10-unreadable-path-locked' {
  Initialize-FakeInstall
  [IO.File]::WriteAllText((Join-Path $app "tools\$($script:HelperExe)"), 'x')
  $S.Locked = @($script:HelperExe)
  [void]$S.Procs.Add((New-FakeProc 1011 $script:HelperExe ''))
  Eq (Invoke-Prepare) 7 'H10 the lock check decides: rc 7'
  Eq @(Kills).Count 0 'H10 still not ended'
  Test-NoBackup
}
Invoke-Case 'self-chain-kept' {
  Initialize-FakeInstall
  $parent = 999001
  [void]$S.Procs.Add((New-FakeProc $PID 'powershell.exe' "$app\powershell.exe" $parent))
  [void]$S.Procs.Add((New-FakeProc $parent 'arbs-h-0.1.2-setup.exe' "$app\arbs-h-0.1.2-setup.exe" 4))
  [IO.File]::WriteAllText((Join-Path $app 'arbs-h-0.1.2-setup.exe'), 'x')
  $S.Locked = @('arbs-h-0.1.2-setup.exe')
  Eq (Invoke-Prepare) 0 'setup.exe inside {app}: rc 0'
  Eq @(Kills).Count 0 'this helper and its parents are never ended'
}
Invoke-Case 'dryrun-no-real-process-query' {
  Eq @(Get-ProcessSnapshot).Count 0 'DryRun without an injected list sees no process'
}
Invoke-Case 'h11-real-query-by-path' {
  # Neutral copies of ping.exe that end by themselves: this test never ends a process.
  $name = 'arbs-fix1-probe.exe'
  $mine = Join-Path $app 'tools'; $other = Join-Path $root 'Other\tools'
  New-Item -ItemType Directory -Path $mine, $other -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\PING.EXE') -Destination (Join-Path $mine $name)
  Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\PING.EXE') -Destination (Join-Path $other $name)
  $pa = Start-Process -FilePath (Join-Path $mine $name) -ArgumentList '-n', '6', '127.0.0.1' -WindowStyle Hidden -PassThru
  $pb = Start-Process -FilePath (Join-Path $other $name) -ArgumentList '-n', '6', '127.0.0.1' -WindowStyle Hidden -PassThru
  try {
    Start-Sleep -Milliseconds 900
    $script:ProcessLister = { Get-RealProcessSnapshot }
    $found = @(Get-AppProcesses)
    Eq $found.Count 1 'H11 real query: one process under {app}'
    Ok ($found.Count -eq 1 -and $found[0].Id -eq $pa.Id) 'H11 real query: the copy in {app}, not the one elsewhere'
    Ok (@(Get-RealProcessSnapshot | Where-Object { $_.Id -eq $pb.Id }).Count -eq 1) 'H11 the other copy is visible but not selected'
    Ok (@(Get-BusyAppFiles) -contains "tools\$name") 'H11 real running exe reads as locked'
  }
  finally { [void]$pa.WaitForExit(20000); [void]$pb.WaitForExit(20000) }
  Ok ($pa.HasExited -and $pb.HasExited) 'H11 both copies ended by themselves'
  Start-Sleep -Milliseconds 300
  Eq @(Get-BusyAppFiles).Count 0 'H11 not locked after exit'
}
Invoke-Case 'h12-taskkill-filter' {
  # Name filter that does not match: taskkill must leave the process alone. The matching case is not run (no real kill).
  $exe = Join-Path $root 'arbs-fix1-filter.exe'
  Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\PING.EXE') -Destination $exe
  $p = Start-Process -FilePath $exe -ArgumentList '-n', '6', '127.0.0.1' -WindowStyle Hidden -PassThru
  try {
    Start-Sleep -Milliseconds 700
    $tk = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\taskkill.exe') -ArgumentList '/F', '/PID', "$($p.Id)", '/FI', '"IMAGENAME eq arbs-fix1-other.exe"' -NoNewWindow -Wait -PassThru `
      -RedirectStandardOutput (Join-Path $root 'tk.out') -RedirectStandardError (Join-Path $root 'tk.err')
    Start-Sleep -Milliseconds 400
    Ok (-not $p.HasExited) "H12 /PID + /FI with another image name does not end it (taskkill exit $($tk.ExitCode))"
  }
  finally { [void]$p.WaitForExit(20000) }
  Ok $p.HasExited 'H12 probe ended by itself'
}
Invoke-Case 'h13-helper-ascii' {
  Eq @([IO.File]::ReadAllBytes($Helper) | Where-Object { $_ -gt 127 }).Count 0 'H13 arbs-h-setup.ps1 stays ASCII'
}

# ---------------- H013 O5: locks in sub folders, programs outside {app} (L1-L9) ----------------
# Lock model: a file is busy while a holder in $S.Holders is still in $S.Procs; the fake Restart Manager answers with
# those holders. Ending a process (taskkill fake) releases its locks.
function Initialize-FakeLocks {
  $script:FileBusyProbe = { param($Path)
    $leaf = Split-Path -Leaf $Path; $ids = @($S.Procs | ForEach-Object { $_.Id })
    @($S.Holders | Where-Object { ($ids -contains $_.Id) -and ($_.Files -contains $leaf) }).Count -gt 0 }
  $script:LockerProbe = { param($Paths)
    $S.LockerCalls++
    if ($S.LockerThrows) { throw 'fake Restart Manager failure' }
    $leaves = @($Paths | ForEach-Object { Split-Path -Leaf $_ }); $ids = @($S.Procs | ForEach-Object { $_.Id })
    @($S.Holders | Where-Object { $h = $_; ($ids -contains $h.Id) -and @($h.Files | Where-Object { $leaves -contains $_ }).Count -gt 0 } |
      ForEach-Object { [pscustomobject]@{ Id = $_.Id; Name = $_.App } }) }
}
function Add-AppFile([string]$Rel) { $p = Join-Path $app $Rel; New-Item -ItemType Directory -Path (Split-Path -Parent $p) -Force | Out-Null; [IO.File]::WriteAllText($p, 'x') }

Invoke-Case 'l1-subfolder-locked-outside' {
  Initialize-FakeInstall; Initialize-FakeLocks
  Add-AppFile 'drivers\sudovda\x.dll'
  [void]$S.Procs.Add((New-FakeProc 1101 'explorer.exe' 'C:\Windows\explorer.exe'))
  [void]$S.Holders.Add(@{ Id = 1101; App = 'Windows Explorer'; Files = @('x.dll') })
  Eq (Invoke-Prepare) 8 'L1 file in a sub folder held by a program outside {app}: rc 8'
  Eq @(Kills).Count 0 'L1 the outside program is never ended'
  Eq $script:Result['busy'] 'drivers\sudovda\x.dll' 'L1 busy is the path relative to {app}'
  Eq $script:Result['locked-by'] 'Windows Explorer (PID 1101)' 'L1 locked-by names the program'
  Eq $script:Result['prepare'] 'locked-by-other' 'L1 prepare result'
  Test-NoBackup   # L7: rc 8 comes before the backup
}
Invoke-Case 'l2-inside-process-lock' {
  Initialize-FakeInstall; Initialize-FakeLocks
  Add-AppFile 'drivers\sudovda\x.dll'
  [void]$S.Procs.Add((New-FakeProc 1201 'sunshine.exe' "$app\sunshine.exe"))
  [void]$S.Holders.Add(@{ Id = 1201; App = 'ARBS-H'; Files = @('x.dll') })
  Eq (Invoke-Prepare) 0 'L2 lock by a process under {app}: rc 0'
  Eq (Kills) @(KillCmd 1201 'sunshine.exe') 'L2 that process is ended as before'
  Eq $S.LockerCalls 0 'L2 no lock owner query needed'
}
Invoke-Case 'l3-inside-and-outside' {
  Initialize-FakeInstall; Initialize-FakeLocks
  Add-AppFile 'tools\x.dll'
  [void]$S.Procs.Add((New-FakeProc 1301 'sunshine.exe' "$app\sunshine.exe"))
  [void]$S.Procs.Add((New-FakeProc 1302 'editor.exe' 'C:\Tools\Editor\editor.exe'))
  [void]$S.Holders.Add(@{ Id = 1301; App = 'ARBS-H'; Files = @('x.dll') })
  [void]$S.Holders.Add(@{ Id = 1302; App = 'Editor'; Files = @('x.dll') })
  Eq (Invoke-Prepare) 8 'L3 rc 8'
  Eq (Kills) @(KillCmd 1301 'sunshine.exe') 'L3 only the {app} process is ended'
  Ok (@($S.Procs | Where-Object { $_.Id -eq 1302 }).Count -eq 1) 'L3 the outside program keeps running'
  Eq $script:Result['locked-by'] 'Editor (PID 1302)' 'L3 locked-by names only the outside program'
}
Invoke-Case 'l4-config-ignored' {
  Initialize-FakeInstall; Initialize-FakeLocks
  Add-AppFile 'config\x.dll'; Add-AppFile 'config\sub\y.dll'; Add-AppFile 'config.migrating\z.dll'
  [void]$S.Procs.Add((New-FakeProc 1401 'editor.exe' 'C:\Tools\editor.exe'))
  [void]$S.Holders.Add(@{ Id = 1401; App = 'Editor'; Files = @('x.dll', 'y.dll', 'z.dll') })
  Eq (Invoke-Prepare) 0 'L4 locked files in config folders (never replaced) do not block: rc 0'
  Ok (-not $script:Result.Contains('busy')) 'L4 no busy'
  Eq $S.LockerCalls 0 'L4 no lock owner query'
}
Invoke-Case 'l5-junction-not-entered' {
  Initialize-FakeInstall; Initialize-FakeLocks
  $target = Join-Path $root 'outside-target'
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $target 'z.dll'), 'x')
  $link = Join-Path $app 'linked'
  New-Item -ItemType Junction -Path $link -Target $target | Out-Null
  try {
    [void]$S.Procs.Add((New-FakeProc 1501 'other.exe' 'C:\Other\other.exe'))
    [void]$S.Holders.Add(@{ Id = 1501; App = 'Other'; Files = @('z.dll') })
    Ok (((Get-Item -LiteralPath $link -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) 'L5 fixture is a junction'
    Eq @(Get-AppBinaryFiles | Where-Object { $_ -like "$link*" }).Count 0 'L5 scan does not enter the junction'
    Eq (Invoke-Prepare) 0 'L5 file behind the junction is not judged: rc 0'
  }
  finally { [IO.Directory]::Delete($link) }
  Ok (Test-Path -LiteralPath (Join-Path $target 'z.dll')) 'L5 junction target untouched'
}
Invoke-Case 'l6-locker-query-fails' {
  Initialize-FakeInstall; Initialize-FakeLocks
  Add-AppFile 'tools\x.dll'
  [void]$S.Procs.Add((New-FakeProc 1601 'editor.exe' 'C:\Tools\editor.exe'))
  [void]$S.Holders.Add(@{ Id = 1601; App = 'Editor'; Files = @('x.dll') })
  $S.LockerThrows = $true
  Eq (Invoke-Prepare) 8 'L6 Restart Manager failure: rc 8 (file name still reported)'
  Eq $script:Result['locked-by'] 'unknown' 'L6 locked-by=unknown'
  Eq $script:Result['busy'] 'tools\x.dll' 'L6 busy kept'
  Eq @(Kills).Count 0 'L6 nothing ended'
}
Invoke-Case 'l6b-holder-path-unknown' {
  Initialize-FakeInstall; Initialize-FakeLocks
  Add-AppFile 'tools\x.dll'
  [void]$S.Procs.Add((New-FakeProc 1611 'sunshine.exe' ''))
  [void]$S.Holders.Add(@{ Id = 1611; App = 'sunshine'; Files = @('x.dll') })
  Eq (Invoke-Prepare) 8 'L6b holder whose path cannot be read counts as outside: rc 8'
  Eq @(Kills).Count 0 'L6b and is not ended'
}
Invoke-Case 'l8-retry-after-close' {
  Initialize-FakeInstall; Initialize-FakeLocks
  Add-AppFile 'tools\x.dll'
  $other = New-FakeProc 1801 'editor.exe' 'C:\Tools\editor.exe'
  [void]$S.Procs.Add($other)
  [void]$S.Holders.Add(@{ Id = 1801; App = 'Editor'; Files = @('x.dll') })
  Eq (Invoke-Prepare) 8 'L8 first prepare: rc 8'
  Eq $script:Result['service-before'] 'RUNNING' 'L8/V4 first prepare sees the service running'
  Test-NoBackup
  [void]$S.Procs.Remove($other)   # the user closes the program and presses [Retry]: the installer runs prepare again
  $script:Result.Clear()
  Eq (Invoke-Prepare) 0 'L8 retry: rc 0'
  Eq $script:Result['service-before'] 'STOPPED' 'V4 the retry sees it stopped (the installer keeps the first value, T6)'
  Eq @($script:Plan | Where-Object { $_ -match '^robocopy' }).Count 1 'L8 one backup'
  Eq @(Get-ChildItem -LiteralPath (Join-Path $data 'backup') -Directory).Count 1 'L8 one backup folder'
  Eq @(Kills).Count 0 'L8 nothing ended'
}
Invoke-Case 'l0-dryrun-no-restart-manager' {
  Add-AppFile 'tools\x.dll'
  Eq @(Get-FileLockers @((Join-Path $app 'tools\x.dll'))).Count 0 'DryRun without a probe asks nobody'
  Ok ($null -eq ('ArbsH.RestartManagerQuery' -as [type])) 'DryRun did not load the Restart Manager type (no Add-Type)'
}
Invoke-Case 'l9-real-restart-manager' {
  # Real Restart Manager query on a scratch file this test holds itself. Query only: nothing is shut down or ended.
  $f = Join-Path $app 'tools\rm-probe.dll'
  New-Item -ItemType Directory -Path (Split-Path -Parent $f) -Force | Out-Null
  [IO.File]::WriteAllBytes($f, [byte[]](1, 2, 3))
  Eq @(Get-RealFileLockers @($f)).Count 0 'L9 real query: free file has no holder'
  $h = [IO.File]::Open($f, 'Open', 'ReadWrite', 'None')
  try { $l = @(Get-RealFileLockers @($f)) } finally { $h.Dispose() }
  Eq $l.Count 1 'L9 real query: one holder'
  Ok ($l.Count -eq 1 -and $l[0].Id -eq $PID) 'L9 real query: the holder is this test process'
  Eq @(Get-RealFileLockers @($f)).Count 0 'L9 real query: free again after close'
  Eq @(Kills).Count 0 'L9 nothing ended'
}

# ---------------- H013 O3: uninstall ends the ARBS-H processes first (U1-U7) ----------------
function Initialize-FakeUninstall {
  Initialize-FakeInstall
  New-Item -ItemType Directory -Path (Join-Path $data 'rollback') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $data 'rollback\apolloservice.json'), '{"Service":"ApolloService","StartType":2,"Delayed":false,"State":"RUNNING"}')
}
Invoke-Case 'u1-uninstall-order' {
  Initialize-FakeUninstall
  [void]$S.Procs.Add((New-FakeProc 2101 $script:HelperExe "$app\tools\$($script:HelperExe)"))
  [void]$S.Procs.Add((New-FakeProc 2102 'sunshine.exe' "$app\sunshine.exe"))
  [IO.File]::WriteAllText((Join-Path $app 'unins000.exe'), 'x'); $S.Locked = @('unins000.exe')
  $RestoreVibepollo = $true
  Eq (Invoke-Uninstall) 0 'U1 rc'
  Eq (Mutations) @('sc.exe stop ARBSHService', (KillCmd 2102 'sunshine.exe'), (KillCmd 2101 $script:HelperExe), 'sc.exe delete ARBSHService',
    'netsh.exe advfirewall firewall delete rule name="ARBS-H"', 'netsh.exe advfirewall firewall delete rule name="ARBS-H Service"',
    'schtasks.exe /Delete /TN "\ARBS-H-DisplayRestore" /F',
    'sc.exe config ApolloService start= auto', 'sc.exe start ApolloService') 'U1 service stop -> taskkill -> service delete -> firewall -> task -> Vibepollo restore'
  Eq $script:Result['app-processes'] 'stopped 2' 'U1 both ended'
  Ok (-not $script:Result.Contains('uninstall-left')) 'U1 nothing left (the running uninstaller unins000.exe is not judged)'
  Ok (-not ((Mutations) -match 'pnputil|\\drivers\\')) 'U1/V3 no driver command'
}
Invoke-Case 'u2-other-path-same-name' {
  Initialize-FakeUninstall
  [void]$S.Procs.Add((New-FakeProc 2111 $script:HelperExe "C:\Vibepollo\tools\$($script:HelperExe)"))
  [void]$S.Procs.Add((New-FakeProc 2112 'sunshine.exe' 'C:\Vibepollo\sunshine.exe'))
  [void]$S.Procs.Add((New-FakeProc 2113 'sunshine.exe' 'C:\Apollo\sunshine.exe'))
  Eq (Invoke-Uninstall) 0 'U2 rc'
  Eq @(Kills).Count 0 'U2 Vibepollo/Apollo processes with the same names are not ended'
  Eq @($S.Procs).Count 3 'U2 all still running'
}
Invoke-Case 'u3-restore-wait-before-task-delete' {
  Initialize-FakeUninstall
  $S.TaskPresent = $true; $S.HelperGoneAfter = 8
  [void]$S.Procs.Add((New-FakeProc 2121 'sunshine.exe' "$app\sunshine.exe"))
  [void]$S.Procs.Add((New-FakeProc 2122 $script:HelperExe "$app\tools\$($script:HelperExe)"))
  Eq (Invoke-Uninstall) 0 'U3 rc'
  $plan = @($script:Plan)
  $iQuery = [array]::IndexOf($plan, 'schtasks.exe /Query /TN "\ARBS-H-DisplayRestore"')
  $iDelete = [array]::IndexOf($plan, 'schtasks.exe /Delete /TN "\ARBS-H-DisplayRestore" /F')
  Ok ($iQuery -ge 0 -and $iDelete -gt $iQuery) "U3 restore task checked ($iQuery) before it is deleted ($iDelete)"
  Eq (Kills) @(KillCmd 2121 'sunshine.exe') 'U3 the helper finished its restore by itself'
}
Invoke-Case 'u4-process-will-not-end' {
  Initialize-FakeUninstall
  $S.KillWorks = $false
  [void]$S.Procs.Add((New-FakeProc 2131 $script:HelperExe "$app\tools\$($script:HelperExe)"))
  $RestoreVibepollo = $true
  Eq (Invoke-Uninstall) 7 'U4 rc reports what is left'
  Eq $script:Result['uninstall-left'] "tools\$($script:HelperExe)" 'U4 uninstall-left names the file'
  Ok ((Mutations) -contains 'sc.exe delete ARBSHService') 'U4 uninstall continues (service deleted)'
  Ok ((Mutations) -contains 'sc.exe config ApolloService start= auto') 'U4 Vibepollo restore still runs'
  Ok ("$($script:Result['vibepollo'])" -like 'restored *') 'U4 vibepollo restored'
}
Invoke-Case 'u5-config-delete-fails' {
  Initialize-FakeUninstall
  $logs = Join-Path $app 'config\logs'
  New-Item -ItemType Directory -Path $logs -Force | Out-Null
  $held = Join-Path $logs 'sunshine.log'
  [IO.File]::WriteAllText($held, 'log')
  $RemoveConfig = $true; $RestoreVibepollo = $true
  $h = [IO.File]::Open($held, 'Open', 'ReadWrite', 'None')
  try { $rc = Invoke-Uninstall } finally { $h.Dispose() }
  Eq $rc 0 'U5 rc (what is left is reported, not an error)'
  Eq $script:Result['config'] 'partly-removed' 'U5 config result'
  Eq $script:Result['left-config'] (Join-Path $app 'config') 'U5 left-config names the folder'
  Ok ((Mutations) -contains 'sc.exe start ApolloService') 'U5 Vibepollo restore runs after a failed delete'
}
Invoke-Case 'u6-not-arbs-folder' {
  Initialize-FakeUninstall
  Remove-Item -LiteralPath (Join-Path $app 'arbs-h-version.txt')
  $S.Services.ARBSHService.Bin = '"C:\Elsewhere\tools\sunshinesvc.exe"'
  [void]$S.Procs.Add((New-FakeProc 2141 'sunshine.exe' "$app\sunshine.exe"))
  Eq (Invoke-Uninstall) 0 'U6 rc'
  Eq @(Kills).Count 0 'U6 not an ARBS-H folder: no taskkill'
  Eq $script:Result['app-processes'] 'skipped-not-arbs-folder' 'U6 result'
}

# ---------------- H013 O4: post-install failure puts the service back (P1-P11) ----------------
# Upgrade after prepare: ARBS-H 0.1.2 installed, automatic, stopped by prepare (it was running).
function Initialize-FakeAfterPrepare {
  Initialize-FakeInstall
  $S.Services.ARBSHService.State = 'STOPPED'
}
function StartCount { @(Mutations | Where-Object { $_ -eq 'sc.exe start ARBSHService' }).Count }
Invoke-Case 'p1-firewall-fails-restore' {
  Initialize-FakeAfterPrepare
  $PrevStart = 'auto'; $PrevState = 'RUNNING'
  $S.Exits['^netsh\.exe advfirewall firewall add rule name="ARBS-H"'] = 1
  Eq (Invoke-PostInstall) 1 'P1 rc 1'
  Eq $script:Result['reason'] 'firewall rule failed' 'P1 reason in one line'
  Eq $script:Result['service-restore'] 'restored-running' 'P1 service back'
  Eq $script:Result['start'] 'restored-running' 'P1 start result'
  Eq (StartCount) 1 'P1 one start'
  Eq $S.Services.ARBSHService.State 'RUNNING' 'P1 running again'
  Eq $S.Services.ARBSHService.Start 2 'P1 still automatic'
  Ok (-not ((Mutations) -match 'ApolloService')) 'P1 Vibepollo untouched'
}
Invoke-Case 'p2-service-registration-fails' {
  Initialize-FakeAfterPrepare
  $S.Services.ARBSHService.Bin = '"C:\old\tools\sunshinesvc.exe"'
  $S.Exits['^sc\.exe config ARBSHService binPath='] = 5
  $PrevStart = 'auto'; $PrevState = 'RUNNING'
  Eq (Invoke-PostInstall) 1 'P2 rc 1'
  Eq $script:Result['reason'] 'service registration: config-failed' 'P2 reason'
  Eq $script:Result['service-restore'] 'restored-running' 'P2 service back'
  Eq $S.Services.ARBSHService.State 'RUNNING' 'P2 running again'
}
Invoke-Case 'p3-template-missing-stopped-before' {
  Initialize-FakeAfterPrepare
  Remove-Item -LiteralPath (Join-Path $app 'config') -Recurse -Force
  $S.Services.ARBSHService.Start = 3
  $PrevStart = 'demand'; $PrevState = 'STOPPED'
  Eq (Invoke-PostInstall) 1 'P3 rc 1'
  Eq $script:Result['reason'] 'default configuration: template-missing' 'P3 reason'
  Eq $script:Result['service-restore'] 'stopped-as-before' 'P3 stays stopped as before'
  Eq $script:Result['start'] 'not-started' 'P3 start result'
  Eq (StartCount) 0 'P3 no start'
  Ok (-not ((Mutations) -match '^sc\.exe config ARBSHService start=')) 'P3 start type already as before'
}
Invoke-Case 'p3b-start-type-restored' {
  Initialize-FakeAfterPrepare
  Remove-Item -LiteralPath (Join-Path $app 'config') -Recurse -Force
  $S.Services.ARBSHService.Start = 3
  $PrevStart = 'delayed-auto'; $PrevState = 'STOPPED'
  Eq (Invoke-PostInstall) 1 'P3b rc 1'
  Ok ((Mutations) -contains 'sc.exe config ARBSHService start= delayed-auto') 'P3b start type put back'
  Eq $S.Services.ARBSHService.Delayed $true 'P3b delayed automatic again'
  Eq (StartCount) 0 'P3b not started (it was stopped)'
}
Invoke-Case 'p4-exception-in-step' {
  Initialize-FakeAfterPrepare
  $PrevStart = 'auto'; $PrevState = 'RUNNING'
  $script:Runner = { param($Exe, $Arguments) if ($Exe -eq 'pnputil.exe') { throw "fake pnputil crash`r`nsecond line" }; Invoke-Fake $S $root $Exe $Arguments }
  Eq (Invoke-PostInstall) 1 'P4 exception: rc 1'
  Ok ("$($script:Result['error'])" -like 'fake pnputil crash*') 'P4 error recorded'
  Eq $script:Result['reason'] 'post-install: fake pnputil crash second line' 'P4/P11 reason is one line'
  Eq $script:Result['service-restore'] 'restored-running' 'P4 service back'
}
Invoke-Case 'p5-acl-failure-stays-manual' {
  Initialize-FakeAfterPrepare
  $PrevStart = 'auto'; $PrevState = 'RUNNING'
  $cred = New-ArbsCredentials $app
  $S.AclHard[(Get-AclKey (Join-Path $cred 'cacert.pem'))] = $true; Set-FakeAcl $S (Join-Path $cred 'cacert.pem') $script:SddlEmpty
  Eq (Invoke-PostInstall) 6 'P5 rc 6'
  Ok (-not $script:Result.Contains('service-restore')) 'P5 no restore over the intended manual state'
  Eq (StartCount) 0 'P5 no start'
  Eq $S.Services.ARBSHService.Start 3 'P5 manual'
}
Invoke-Case 'p6-port-conflict-stays-manual' {
  Initialize-FakeAfterPrepare
  $PrevStart = 'auto'; $PrevState = 'RUNNING'
  $S.Ports = @(47990)
  Eq (Invoke-PostInstall) 10 'P6 rc 10'
  Ok (-not $script:Result.Contains('service-restore')) 'P6 no restore'
  Eq (StartCount) 0 'P6 no start'
}
Invoke-Case 'p7-failure-with-vibepollo-running' {
  Initialize-FakeAfterPrepare
  $PrevStart = 'auto'; $PrevState = 'RUNNING'
  $S.Services.ApolloService.Start = 2; $S.Services.ApolloService.State = 'RUNNING'
  $S.Exits['^netsh\.exe advfirewall firewall add rule name="ARBS-H"'] = 1
  Eq (Invoke-PostInstall) 1 'P7 rc 1'
  Eq $script:Result['service-restore'] 'deferred-conflict' 'P7 not started while Vibepollo takes the ports'
  Ok ("$($script:Result['start'])" -like 'deferred-conflict *') 'P7 start result'
  Eq (StartCount) 0 'P7 no sc start'
  Ok (-not ((Mutations) -match 'ApolloService')) 'P7 Vibepollo untouched'
}
Invoke-Case 'p7b-failure-with-port-in-use' {
  Initialize-FakeAfterPrepare
  $PrevStart = 'auto'; $PrevState = 'RUNNING'
  $S.Ports = @(47989)
  $S.Exits['^netsh\.exe advfirewall firewall add rule name="ARBS-H"'] = 1
  Eq (Invoke-PostInstall) 1 'P7b rc 1'
  Eq $script:Result['service-restore'] 'deferred-conflict' 'P7b port in use: not started'
  Eq (StartCount) 0 'P7b no sc start'
}
Invoke-Case 'p8-start-fails' {
  Initialize-FakeAfterPrepare
  $PrevStart = 'auto'; $PrevState = 'RUNNING'
  $S.Exits['^sc\.exe start ARBSHService'] = 1053
  Eq (Invoke-PostInstall) 1 'P8 rc 1'
  Eq $script:Result['start'] 'failed' 'P8 start = failed'
  Eq $script:Result['reason'] 'service start failed (sc start exit 1053)' 'P8 reason'
  Eq (StartCount) 1 'P8 no second start by the restore'
  Ok (-not $script:Result.Contains('service-restore')) 'P8 no restore after the start step'
}
Invoke-Case 'p9-start-not-running' {
  Initialize-FakeAfterPrepare
  $PrevStart = 'auto'; $PrevState = 'RUNNING'
  $S.Exits['^sc\.exe start ARBSHService'] = 0   # request accepted, service never reaches RUNNING
  Eq (Invoke-PostInstall) 1 'P9 rc 1'
  Eq $script:Result['start'] 'failed' 'P9 start = failed (not auto-started)'
  Eq $script:Result['reason'] 'service did not reach RUNNING after start' 'P9 reason'
}
Invoke-Case 'p10-first-install-fails' {
  New-Item -ItemType Directory -Path (Join-Path $app 'config-template') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $app 'config-template\sunshine.conf'), 'template')
  $PrevStart = 'none'; $PrevState = 'NONE'
  $S.Exits['^netsh\.exe advfirewall firewall add rule name="ARBS-H"'] = 1
  Eq (Invoke-PostInstall) 1 'P10 rc 1'
  Eq $script:Result['service-restore'] 'not-needed' 'P10 nothing to restore'
  Eq (StartCount) 0 'P10 no start'
}
Invoke-Case 'p11-reason-one-line' {
  Set-Reason ("first`r`nsecond`tthird " + ('x' * 200))
  $r = "$($script:Result['reason'])"
  Ok ($r -notmatch "[`r`n`t]") 'P11 no line break'
  Ok ($r.Length -le 120) "P11 at most 120 characters ($($r.Length))"
  Ok ($r.StartsWith('first second third ')) 'P11 text kept'
  Set-Reason 'later cause'
  Ok ($script:Result['reason'].StartsWith('first')) 'P11 the first cause stays'
}

# ---------------- H013: update, reinstall and uninstall of 0.1.3 (V1-V3; V4 is in l8 + T6) ----------------
Invoke-Case 'v1-update-0.1.2-to-0.2.2' {
  Initialize-FakeInstall
  [void]$S.Procs.Add((New-FakeProc 2201 'sunshine.exe' "$app\sunshine.exe"))
  Eq (Invoke-Prepare) 0 'V1 prepare rc'
  Eq $script:Result['service-before'] 'RUNNING' 'V1 service-before'
  Eq $script:Result['service-start-before'] 'auto' 'V1 service-start-before'
  Ok ($script:Result['prepare'] -match '^backup config-0\.1\.2-') 'V1 backup names 0.1.2'
  $PrevStart = $script:Result['service-start-before']; $PrevState = $script:Result['service-before']
  Eq (Invoke-PostInstall) 0 'V1 post-install rc'
  Eq ([IO.File]::ReadAllText((Join-Path $app 'arbs-h-version.txt'))) '0.2.2' 'V1 version file 0.2.2'
  Eq $script:Result['start'] 'auto-started' 'V1 auto-started'
  Ok (-not $script:Result.Contains('service-restore')) 'V1 no restore on success'
}
Invoke-Case 'v2-reinstall-0.1.3' {
  Initialize-FakeInstall
  [IO.File]::WriteAllText((Join-Path $app 'arbs-h-version.txt'), '0.1.3')
  Eq (Invoke-Prepare) 0 'V2 prepare rc'
  Ok ($script:Result['prepare'] -match '^backup config-0\.1\.3-') 'V2 config backed up'
  $PrevStart = $script:Result['service-start-before']; $PrevState = $script:Result['service-before']
  Eq (Invoke-PostInstall) 0 'V2 post-install rc'
  Eq $script:Result['service'] 'kept' 'V2 service kept'
  Eq $script:Result['start'] 'auto-started' 'V2 started'
}
Invoke-Case 'v3-uninstall-0.1.3-remove' {
  Initialize-FakeInstall
  [IO.File]::WriteAllText((Join-Path $app 'arbs-h-version.txt'), '0.1.3')
  [void]$S.Procs.Add((New-FakeProc 2301 'sunshine.exe' "$app\sunshine.exe"))
  $RemoveConfig = $true
  Eq (Invoke-Uninstall) 0 'V3 rc'
  Eq (Mutations) @('sc.exe stop ARBSHService', (KillCmd 2301 'sunshine.exe'), 'sc.exe delete ARBSHService',
    'netsh.exe advfirewall firewall delete rule name="ARBS-H"', 'netsh.exe advfirewall firewall delete rule name="ARBS-H Service"',
    'schtasks.exe /Delete /TN "\ARBS-H-DisplayRestore" /F') 'V3 commands (no driver or Vibepollo command)'
  Eq $script:Result['config'] 'removed' 'V3 config removed'
  Eq $script:Result['drivers'] 'kept' 'V3 drivers kept'
}

# ---------------- UI1b: update 0.1.3 -> 0.2.x keeps the configuration (ARBS WebUI default screen) ----------------
# The default web screen is the server setting arbs_webui_default (arbs/classic/v2). The installer never writes it:
# an existing sunshine.conf is kept byte for byte, a missing key means the server default (arbs).
$script:ConfUi1b = "locale = ko`r`ngamepad = usbip_ds5`r`nupdate_check_interval = 86400`r`nnotify_pre_releases = false`r`n"
Invoke-Case 'w1-update-0.1.3-to-0.2.2' {
  Initialize-FakeInstall
  [IO.File]::WriteAllText((Join-Path $app 'arbs-h-version.txt'), '0.1.3')
  $conf = Join-Path $app 'config\sunshine.conf'
  [IO.File]::WriteAllText($conf, $script:ConfUi1b)
  $before = (Get-FileHash -LiteralPath $conf -Algorithm SHA256).Hash
  [void]$S.Procs.Add((New-FakeProc 2401 'sunshine.exe' "$app\sunshine.exe"))
  Eq (Invoke-Prepare) 0 'W1 prepare rc'
  Ok ($script:Result['prepare'] -match '^backup config-0\.1\.3-') 'W1 backup names 0.1.3'
  $PrevStart = $script:Result['service-start-before']; $PrevState = $script:Result['service-before']
  Eq (Invoke-PostInstall) 0 'W1 post-install rc'
  Eq $script:Result['config'] 'kept' 'W1 config kept'
  Eq ([IO.File]::ReadAllText((Join-Path $app 'arbs-h-version.txt'))) '0.2.2' 'W1 version file 0.2.2'
  Eq (Get-FileHash -LiteralPath $conf -Algorithm SHA256).Hash $before 'W1 sunshine.conf bytes unchanged'
  Ok (-not ([IO.File]::ReadAllText($conf)).Contains('arbs_webui_default')) 'W1 no arbs_webui_default written (server default arbs)'
  Eq $script:Result['start'] 'auto-started' 'W1 auto-started'
}
foreach ($w in @('classic', 'v2', 'arbs')) {
  $global:W = $w
  Invoke-Case "w2-keep-webui-default-$w" {
    $w = $global:W
    Initialize-FakeInstall
    [IO.File]::WriteAllText((Join-Path $app 'arbs-h-version.txt'), '0.1.3')
    $conf = Join-Path $app 'config\sunshine.conf'
    [IO.File]::WriteAllText($conf, $script:ConfUi1b + "arbs_webui_default = $w`r`n")
    $before = (Get-FileHash -LiteralPath $conf -Algorithm SHA256).Hash
    Eq (Invoke-Prepare) 0 "W2 $w prepare rc"
    $PrevStart = $script:Result['service-start-before']; $PrevState = $script:Result['service-before']
    Eq (Invoke-PostInstall) 0 "W2 $w post-install rc"
    Eq $script:Result['config'] 'kept' "W2 $w config kept"
    Eq (Get-FileHash -LiteralPath $conf -Algorithm SHA256).Hash $before "W2 $w sunshine.conf bytes unchanged"
    Ok (@([IO.File]::ReadAllLines($conf) | Where-Object { $_ -ceq "arbs_webui_default = $w" }).Count -eq 1) "W2 $w arbs_webui_default kept"
  }
}
Invoke-Case 'w3-new-install-template-no-webui-key' {
  $tpl = Join-Path (Split-Path -Parent $TestDir) 'sunshine.conf'
  New-Item -ItemType Directory -Path (Join-Path $app 'config-template') -Force | Out-Null
  Copy-Item -LiteralPath $tpl -Destination (Join-Path $app 'config-template\sunshine.conf')
  Eq (Invoke-EnsureConfig) 0 'W3 ensure-config rc'
  Eq $script:Result['config'] 'new-from-template' 'W3 config from template'
  $text = [IO.File]::ReadAllText((Join-Path $app 'config\sunshine.conf'))
  Ok (-not $text.Contains('arbs_webui_default')) 'W3 template has no arbs_webui_default (server default arbs)'
  Eq (Get-FileHash -LiteralPath (Join-Path $app 'config\sunshine.conf') -Algorithm SHA256).Hash (Get-FileHash -LiteralPath $tpl -Algorithm SHA256).Hash 'W3 config = template bytes'
}

# ---------------- H021: update 0.2.0 -> 0.2.1 (web assets and version only) keeps the configuration ----------------
# The ARBS WebUI 0.2.1 hides some gamepad types and the "enabled" trigger status in its lists, but values that are
# already set stay as they are: the installer keeps sunshine.conf byte for byte and writes no key.
Invoke-Case 'w4-update-0.2.0-to-0.2.2' {
  Initialize-FakeInstall
  [IO.File]::WriteAllText((Join-Path $app 'arbs-h-version.txt'), '0.2.0')
  $conf = Join-Path $app 'config\sunshine.conf'
  $text = "locale = ko`r`ngamepad = vhf_xbox`r`narbs_trigger_status = enabled`r`narbs_webui_default = arbs`r`nsession_history_enabled = disabled`r`n"
  [IO.File]::WriteAllText($conf, $text)
  $before = (Get-FileHash -LiteralPath $conf -Algorithm SHA256).Hash
  [void]$S.Procs.Add((New-FakeProc 2501 'sunshine.exe' "$app\sunshine.exe"))
  Eq (Invoke-Prepare) 0 'W4 prepare rc'
  Ok ($script:Result['prepare'] -match '^backup config-0\.2\.0-') 'W4 backup names 0.2.0'
  $PrevStart = $script:Result['service-start-before']; $PrevState = $script:Result['service-before']
  Eq (Invoke-PostInstall) 0 'W4 post-install rc'
  Eq $script:Result['config'] 'kept' 'W4 config kept'
  Eq ([IO.File]::ReadAllText((Join-Path $app 'arbs-h-version.txt'))) '0.2.2' 'W4 version file 0.2.2'
  Eq (Get-FileHash -LiteralPath $conf -Algorithm SHA256).Hash $before 'W4 sunshine.conf bytes unchanged (hidden values kept)'
  Eq $script:Result['start'] 'auto-started' 'W4 auto-started'
}

# ---------------- H022: update 0.2.1 -> 0.2.2 (history days default 30 on the server) keeps the configuration ----------------
# The server default of session_history_ttl_days becomes 30. The installer writes no key: a value already in
# sunshine.conf (here 0 = never delete) stays as is, a missing key means the server default 30.
$script:ConfH022 = "locale = ko`r`ngamepad = usbip_ds5`r`narbs_trigger_status = h2b`r`nsession_history_enabled = enabled`r`n"
foreach ($c in @(
    @{ N = 'ttl-set'; Extra = "session_history_ttl_days = 0`r`n"; Pid = 2601 },
    @{ N = 'ttl-missing'; Extra = ''; Pid = 2602 })) {
  $global:W5 = $c
  Invoke-Case "w5-update-0.2.1-to-0.2.2-$($c.N)" {
    $c = $global:W5
    Initialize-FakeInstall
    [IO.File]::WriteAllText((Join-Path $app 'arbs-h-version.txt'), '0.2.1')
    $conf = Join-Path $app 'config\sunshine.conf'
    [IO.File]::WriteAllText($conf, $script:ConfH022 + $c.Extra)
    $before = (Get-FileHash -LiteralPath $conf -Algorithm SHA256).Hash
    [void]$S.Procs.Add((New-FakeProc $c.Pid 'sunshine.exe' "$app\sunshine.exe"))
    Eq (Invoke-Prepare) 0 "W5 $($c.N) prepare rc"
    Ok ($script:Result['prepare'] -match '^backup config-0\.2\.1-') "W5 $($c.N) backup names 0.2.1"
    $PrevStart = $script:Result['service-start-before']; $PrevState = $script:Result['service-before']
    Eq (Invoke-PostInstall) 0 "W5 $($c.N) post-install rc"
    Eq $script:Result['config'] 'kept' "W5 $($c.N) config kept"
    Eq ([IO.File]::ReadAllText((Join-Path $app 'arbs-h-version.txt'))) '0.2.2' "W5 $($c.N) version file 0.2.2"
    Eq (Get-FileHash -LiteralPath $conf -Algorithm SHA256).Hash $before "W5 $($c.N) sunshine.conf bytes unchanged"
    $ttl = @([IO.File]::ReadAllLines($conf) | Where-Object { $_ -match '^\s*session_history_ttl_days\s*=' })
    if ($c.Extra) {
      Ok ($ttl.Count -eq 1 -and $ttl[0] -ceq 'session_history_ttl_days = 0') "W5 $($c.N) existing value 0 kept (one line)"
    } else {
      Eq $ttl.Count 0 "W5 $($c.N) no session_history_ttl_days written (server default 30)"
    }
    Eq $script:Result['start'] 'auto-started' "W5 $($c.N) auto-started"
  }
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

# R1b-fix1 G1: the installer reads rc 7 and busy= from this exact CLI path. The lock is a ping copy that ends by itself.
$cli2 = Join-Path $Scratch 'cli-prepare'
$cli2App = Join-Path $cli2 'app'; $cli2Data = Join-Path $cli2 'ProgramData\ARBS-H'
New-Item -ItemType Directory -Path (Join-Path $cli2App 'tools'), (Join-Path $cli2App 'config') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $cli2App 'arbs-h-version.txt'), '0.1.2')
[IO.File]::WriteAllText((Join-Path $cli2App 'config\sunshine.conf'), 'cfg')
$fake2 = @(
  @{ match = '^sc\.exe qc ARBSHService'; exit = 0; output = "START_TYPE         : 2   AUTO_START`r`nBINARY_PATH_NAME   : `"$($cli2App.Replace('\', '\\'))\\tools\\sunshinesvc.exe`"" },
  @{ match = '^sc\.exe query ARBSHService'; exit = 0; output = 'STATE              : 1  STOPPED' },
  @{ match = '^sc\.exe (qc|query) ApolloService'; exit = 1060; output = '1060' })
($fake2 | ConvertTo-Json) | Set-Content -LiteralPath (Join-Path $cli2 'fake.json') -Encoding UTF8
$lockExe = Join-Path $cli2App 'tools\arbs-fix1-cli.exe'
Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\PING.EXE') -Destination $lockExe
$resFile = Join-Path $cli2 'prepare.txt'
$pLock = Start-Process -FilePath $lockExe -ArgumentList '-n', '8', '127.0.0.1' -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Milliseconds 700
  & $ps -NoProfile -ExecutionPolicy Bypass -File $Helper -Action prepare -DryRun -FakeRoot $cli2 -AppDir $cli2App -DataRoot $cli2Data -ResultOut $resFile | Out-Null
  $prepRc = $LASTEXITCODE
  $stillRunning = -not $pLock.HasExited
}
finally { [void]$pLock.WaitForExit(20000) }
Eq $prepRc 7 'CLI prepare with a locked exe exits 7'
Ok $stillRunning 'CLI prepare ended no process (DryRun)'
$resLines = @(Get-Content -LiteralPath $resFile)
Ok ($resLines -contains 'service-before=STOPPED') 'CLI result has service-before'
Ok ($resLines -contains 'busy=tools\arbs-fix1-cli.exe') 'CLI result has busy=<relative file name>'
Ok ($resLines -contains 'prepare=app-busy') 'CLI result has prepare=app-busy'
Ok (-not (Test-Path -LiteralPath (Join-Path $cli2Data 'backup'))) 'CLI rc 7: no backup'

# H013 O4: the installer's post-install call with -PrevStart/-PrevState. An unexpected value must not stop parameter
# binding; the result file carries reason= and service-restore=.
$cli3 = Join-Path $Scratch 'cli-post'
$cli3App = Join-Path $cli3 'app'; $cli3Data = Join-Path $cli3 'ProgramData\ARBS-H'
New-Item -ItemType Directory -Path (Join-Path $cli3App 'config-template') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $cli3App 'config-template\sunshine.conf'), 'template')
$fake3 = @(
  @{ match = '^sc\.exe (qc|query) (ARBSHService|ApolloService)'; exit = 1060; output = '1060' },
  @{ match = '^netsh\.exe advfirewall firewall add rule'; exit = 1; output = '' })
($fake3 | ConvertTo-Json) | Set-Content -LiteralPath (Join-Path $cli3 'fake.json') -Encoding UTF8
$res3 = Join-Path $cli3 'post.txt'
& $ps -NoProfile -ExecutionPolicy Bypass -File $Helper -Action post-install -DryRun -FakeRoot $cli3 -AppDir $cli3App -DataRoot $cli3Data -PrevStart 'type1' -PrevState 'RUNNING' -ResultOut $res3 | Out-Null
Eq $LASTEXITCODE 1 'CLI post-install with a failed firewall step exits 1'
$res3Lines = @(Get-Content -LiteralPath $res3)
Ok ($res3Lines -contains 'reason=firewall rule failed') 'CLI result has reason=<one line>'
Ok ($res3Lines -contains 'service-restore=not-needed') 'CLI result has service-restore= (odd -PrevStart accepted)'
Ok (-not (Test-Path -LiteralPath (Join-Path $cli3App 'arbs-h-version.txt'))) 'CLI failed post-install writes no version file'

Eq $global:T_RealExec 0 'real process starts in all cases'
Write-Host ("arbs-h setup helper tests: {0} passed, {1} failed (scratch {2})" -f $global:T_Pass, $global:T_Fail, $Scratch)
if ($global:T_Fail -eq 0) { Remove-Item -LiteralPath $Scratch -Recurse -Force; exit 0 } else { exit 1 }
