<#
  ARBS-H R1a static checks T6 (analysis/R1a.md 1-3, 7): nothing is executed, files are only read.
   - built binaries carry no Vibepollo machine-wide identity (service, ProgramData log root, HKLM key, task, updater)
   - installer identity differs from Vibepollo's MSI UpgradeCode and from the product keys found on this PC
   - stage excludes Vibepollo-touching scripts/drivers and contains tools\sunshinesvc.exe
   - version resources are 0.1.0 / ARBS-H; setup.exe matches its .sha256
  Usage: powershell -NoProfile -ExecutionPolicy Bypass -File test_arbs_h_static.ps1 -StageDir <stage> -SetupExe <exe>
           [-UninstallKeysFile <evidence\R1a\k_uninstall_keys.txt>] [-Version 0.1.0]
#>
param(
  [Parameter(Mandatory = $true)][string]$StageDir,
  [Parameter(Mandatory = $true)][string]$SetupExe,
  [string]$UninstallKeysFile = '',
  [string]$Version = '0.3.0',
  # H013 S11: commit the changes of this release start from (NET2 0.3.0: v0.2.2 = db6b5136f; H022 used v0.2.1 = abcf16b44; H021 used v0.2.0 = 5472d513a; UI1b used v0.1.3 = 9bf60beb9; H013 used v0.1.2 = 8967d7c87).
  [string]$BaseCommit = 'db6b5136f2c26b3172454927d359e2c8d1f12072'
)
$ErrorActionPreference = 'Stop'
$pkg = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$pass = 0; $fail = 0
function Ok([bool]$Cond, [string]$Msg) { if ($Cond) { $script:pass++; Write-Host "ok   $Msg" } else { $script:fail++; Write-Host "FAIL $Msg" } }
function Count-String([byte[]]$Bytes, [string]$Text) {
  $n = 0
  foreach ($enc in @([Text.Encoding]::ASCII, [Text.Encoding]::Unicode)) {
    $hay = $enc.GetString($Bytes)
    $i = 0
    while (($i = $hay.IndexOf($Text, $i, [StringComparison]::Ordinal)) -ge 0) { $n++; $i += $Text.Length }
  }
  return $n
}

$forbidden = @('ApolloService', '\Vibepollo\Logs', 'Nonary\Vibepollo\DisplayHelper', 'VibepolloDisplayRestore',
  'VibepolloDisplayHelperLogonTrigger', 'api.github.com/repos/Nonary', 'VibepolloSetup',
  'Global\SunshineDisplayHelper', 'Local\SunshineDisplayHelper')
$binaries = @('sunshine.exe', 'tools\sunshinesvc.exe', 'tools\sunshine_display_helper.exe')
$bytes = @{}
foreach ($b in $binaries) {
  $path = Join-Path $StageDir $b
  Ok (Test-Path -LiteralPath $path) "stage has $b"
  $bytes[$b] = [IO.File]::ReadAllBytes($path)
  foreach ($s in $forbidden) { Ok ((Count-String $bytes[$b] $s) -eq 0) "$b contains no '$s'" }
}
Ok ((Count-String $bytes['tools\sunshinesvc.exe'] '\Vibepollo') -eq 0) 'sunshinesvc.exe has no \Vibepollo (ProgramData log root)'
Ok ((Count-String $bytes['tools\sunshinesvc.exe'] 'ARBSHService') -gt 0) 'sunshinesvc.exe registers as ARBSHService'
Ok ((Count-String $bytes['sunshine.exe'] 'ARBSHService') -gt 0) 'sunshine.exe controls ARBSHService'
Ok ((Count-String $bytes['tools\sunshinesvc.exe'] 'ARBS-H') -gt 0) 'sunshinesvc.exe uses %ProgramData%\ARBS-H'
Ok ((Count-String $bytes['sunshine.exe'] 'ARBS-H-DisplayRestore') -gt 0) 'sunshine.exe uses task ARBS-H-DisplayRestore'
Ok ((Count-String $bytes['tools\sunshine_display_helper.exe'] 'SOFTWARE\ARBS-H\DisplayHelper') -gt 0) 'display helper uses HKLM SOFTWARE\ARBS-H\DisplayHelper'
Ok ((Count-String $bytes['tools\sunshine_display_helper.exe'] 'ARBS-H-DisplayRestore') -gt 0) 'display helper uses task ARBS-H-DisplayRestore'
Ok ((Count-String $bytes['sunshine.exe'] 'api.github.com/repos/arbs-project/arbs-h') -gt 0) 'sunshine.exe update target arbs-project/arbs-h'
# R1b-fix1 G4: helper mutexes are ARBS-H only.
Ok ((Count-String $bytes['tools\sunshine_display_helper.exe'] 'Global\ARBS-H-DisplayHelper') -gt 0) 'display helper uses its own single-instance mutex'
Ok ((Count-String $bytes['tools\sunshine_display_helper.exe'] 'Local\ARBS-H-DisplayHelper') -gt 0) 'display helper uses its own local mutex'
Ok ((Count-String $bytes['tools\sunshine_display_helper.exe'] 'Global\ARBS-H-DisplayHelperMutationV1') -gt 0) 'display helper uses its own mutation mutex'
Ok ((Count-String $bytes['sunshine.exe'] 'Global\ARBS-H-DisplayHelperMutationV1') -gt 0) 'sunshine.exe uses the same mutation mutex'
Ok ((Count-String $bytes['sunshine.exe'] 'arbs-h-') -gt 0) 'sunshine.exe Windows asset rule arbs-h-<ver>-setup.exe'

# Both UIs: legacy at / and the new one at /v2. assets\changelog.json is excluded on purpose: it is the bundled
# upstream release-note history (data, not an update target).
$web = Get-ChildItem -LiteralPath (Join-Path $StageDir 'assets\web') -Recurse -File | Where-Object { @('.js', '.html') -contains $_.Extension.ToLowerInvariant() }
$webText = ($web | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join "`n"
foreach ($s in @('api.github.com/repos/Nonary', 'github.com/Nonary/Vibepollo/releases', 'vibepollo-dismissed-updates', 'VibepolloSetup')) { Ok (-not $webText.Contains($s)) "web UI bundle has no '$s'" }
foreach ($s in @('api.github.com/repos/', 'arbs-project', 'arbs-h-dismissed-updates', '<title>ARBS-H</title>')) { Ok ($webText.Contains($s)) "web UI bundle has '$s'" }
foreach ($ui in @('index.html', 'v2\index.html', 'arbs\index.html')) { Ok ([IO.File]::ReadAllText((Join-Path $StageDir "assets\web\$ui")).Contains('<title>ARBS-H</title>')) "$ui title ARBS-H" }

# UI1b (0.2.0): ARBS WebUI built into assets\web\arbs (base /arbs/), its sources and node_modules are not shipped,
# the installer template leaves arbs_webui_default unset (server default arbs).
$arbsIndex = [IO.File]::ReadAllText((Join-Path $StageDir 'assets\web\arbs\index.html'))
Ok ($arbsIndex.Contains('/arbs/assets/') -and $arbsIndex.Contains('/arbs/assets/theme-boot.js')) 'UI1b arbs\index.html loads its files from /arbs/assets/ (theme-boot.js external, CSP)'
Ok (Test-Path -LiteralPath (Join-Path $StageDir 'assets\web\arbs\assets\theme-boot.js')) 'UI1b stage has assets\web\arbs\assets\theme-boot.js'
Ok (@(Get-ChildItem -LiteralPath (Join-Path $StageDir 'assets\web\arbs\assets') -File -Filter '*.js').Count -ge 2) 'UI1b ARBS WebUI bundle present'
Ok (-not (Test-Path -LiteralPath (Join-Path $StageDir 'assets\web-arbs'))) 'UI1b stage has no assets\web-arbs source folder'
Ok (@(Get-ChildItem -LiteralPath $StageDir -Recurse -Directory -Filter 'node_modules' -ErrorAction SilentlyContinue).Count -eq 0) 'UI1b stage has no node_modules'
Ok (@(Get-ChildItem -LiteralPath (Join-Path $StageDir 'assets\web') -Recurse -File | Where-Object { $_.Name -like '*.vue' -or $_.Name -like 'package*.json' -or $_.Name -like '*.test.ts' }).Count -eq 0) 'UI1b stage web has no source files (.vue, package*.json, tests)'
Ok (-not ([IO.File]::ReadAllText((Join-Path $pkg 'sunshine.conf'))).Contains('arbs_webui_default')) 'UI1b installer template leaves arbs_webui_default unset'
# D-CI-8: every exe built by ARBS-H carries ProductName ARBS-H (the bundled nefconc.exe is third-party).
foreach ($t in @('dxgi-info', 'audio-info', 'sunshinesvc', 'playnite-launcher', 'sunshine_wgc_capture', 'sunshine_end_stream_hotkey', 'sunshine_display_helper')) {
  $tp = Join-Path $StageDir "tools\$t.exe"
  $tn = if (Test-Path -LiteralPath $tp) { [Diagnostics.FileVersionInfo]::GetVersionInfo($tp).ProductName } else { '(missing)' }
  Ok ($tn -eq 'ARBS-H') "D-CI-8 tools\$t.exe ProductName = ARBS-H ($tn)"
}

foreach ($x in @('scripts', 'drivers\sunshine', 'drivers\vhf-gamepad', 'config', 'README-portable.txt', 'start-portable.cmd')) {
  Ok (-not (Test-Path -LiteralPath (Join-Path $StageDir $x))) "stage excludes $x"
}
foreach ($x in @('drivers\usbip-win2\install.ps1', 'drivers\sudovda\install.ps1', 'tools\sunshinesvc.exe')) { Ok (Test-Path -LiteralPath (Join-Path $StageDir $x)) "stage includes $x" }

$svc = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $StageDir 'tools\sunshinesvc.exe'))
Ok ($svc.ProductVersion -eq $Version) "sunshinesvc.exe ProductVersion = $Version ($($svc.ProductVersion))"
$main = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $StageDir 'sunshine.exe'))
Ok ($main.ProductVersion -eq $Version) "sunshine.exe ProductVersion = $Version ($($main.ProductVersion))"
Ok ($main.ProductName -eq 'ARBS-H') "sunshine.exe ProductName = ARBS-H ($($main.ProductName))"
Ok ($main.CompanyName -eq 'ARBS project') "sunshine.exe CompanyName = ARBS project ($($main.CompanyName))"

$iss = [IO.File]::ReadAllText((Join-Path $pkg 'arbs-h.iss'))
Ok ($iss -match '#define AppGuid "\{([0-9A-F-]{36})\}"') 'iss defines AppGuid'
$guid = $matches[1]
Ok ($guid -ne 'E3FA501A-85F8-4187-85A7-D6E6BDC7EDA1') 'AppId differs from Vibepollo MSI UpgradeCode'
if ($UninstallKeysFile -and (Test-Path -LiteralPath $UninstallKeysFile)) {
  $keys = [regex]::Matches([IO.File]::ReadAllText($UninstallKeysFile), '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}') | ForEach-Object { $_.Value.ToUpperInvariant() }
  Ok (@($keys).Count -gt 0) "uninstall key evidence has product codes ($(@($keys).Count))"
  Ok (@($keys) -notcontains $guid) 'AppId differs from every installed product code in the evidence'
}
foreach ($s in @('ARBSHService', 'ApolloService')) { Ok ([IO.File]::ReadAllText((Join-Path $pkg 'arbs-h-setup.ps1')).Contains("'$s'")) "helper names $s explicitly" }
Ok ($iss -match 'DefaultDirName=\{autopf\}\\ARBS-H') 'install folder Program Files\ARBS-H'
Ok ($iss -notmatch '(?i)Vibepollo\\|C:\\Vibepollo') 'iss never addresses the Vibepollo folder'

# R1b (R-02): SudoVDA stays bundled, with its license texts in the installer.
Ok ($iss.Contains('Source: "licenses\*.txt"; DestDir: "{app}\licenses"')) 'installer carries licenses\'
Ok (Test-Path -LiteralPath (Join-Path $StageDir 'drivers\sudovda\SudoVDA.dll')) 'stage keeps the SudoVDA driver'
$svNotice = Join-Path $pkg 'licenses\SudoVDA-license-notice.txt'
$msPl = Join-Path $pkg 'licenses\MS-PL-Windows-driver-samples.txt'
Ok ((Test-Path -LiteralPath $svNotice) -and [IO.File]::ReadAllText($svNotice).Contains('MIT and CC0 or Public Domain (for changes I made, please consult Microsoft for their license), choose the least restrictive option.')) 'SudoVDA license sentence present'
Ok ((Test-Path -LiteralPath $msPl) -and (Get-FileHash -LiteralPath $msPl -Algorithm SHA256).Hash.ToLowerInvariant() -eq '07639618c7b94ab9953cc61715f6325877e1854dca611ed9b1bd54497cf5e93a') 'MS-PL text matches the fetched original'

# R1b (D-R1b-19, D-R1b-20): nefcon MIT text and version, SudoVDA binary origin in the notice.
$nefLic = Join-Path $pkg 'licenses\nefcon-LICENSE.txt'
Ok ((Test-Path -LiteralPath $nefLic) -and (Get-FileHash -LiteralPath $nefLic -Algorithm SHA256).Hash.ToLowerInvariant() -eq '19be8cb05e2604e7dad1c8970b2605288275abbe8519746bbc6421ed55a9df73') 'nefcon LICENSE matches the fetched original'
$nefExe = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $StageDir 'drivers\sudovda\nefconc.exe'))
Ok ($nefExe.ProductName -eq 'nefcon' -and $nefExe.FileVersion -eq '1.14.0.0') "bundled nefconc.exe is nefcon 1.14.0.0 ($($nefExe.ProductName) $($nefExe.FileVersion))"
$noticeText = [IO.File]::ReadAllText((Join-Path $pkg '..\..\..\NOTICE-ARBS.md'))
Ok ($noticeText.Contains('https://github.com/nefarius/nefcon') -and $noticeText.Contains('nefcon 1.14.0.0')) 'NOTICE names nefcon source and version'
Ok ($noticeText.Contains('Vibepollo 2.18.9') -and $noticeText.Contains('source commit of this binary is not confirmed')) 'NOTICE states the SudoVDA binary origin'
$svSigner = (Get-AuthenticodeSignature -LiteralPath (Join-Path $StageDir 'drivers\sudovda\SudoVDA.dll')).SignerCertificate
Ok ($null -ne $svSigner -and $svSigner.Thumbprint -eq '3C918FC73525AD8B1521B6DB26B71F694277CC49' -and $noticeText.Contains($svSigner.Thumbprint)) 'SudoVDA signer matches the NOTICE thumbprint'
# R1b-fix1 G4: helper cleanup chooses by full path, and no source keeps the shared mutex names.
$srcRoot = Join-Path $pkg '..\..\..'
$integration = [IO.File]::ReadAllText((Join-Path $srcRoot 'src\platform\windows\display_helper_integration.cpp'))
Ok ($integration.Contains('display_helper_process_match::should_terminate(pid, GetCurrentProcessId(), image_path, *own_helper)')) 'helper cleanup decides by image path'
$cleanup = $integration.Substring($integration.IndexOf('bool kill_all_helper_processes('), 3600)
Ok ($cleanup.IndexOf('should_terminate') -gt 0 -and $cleanup.IndexOf('should_terminate') -lt $cleanup.IndexOf('TerminateProcess(h, 1)')) 'path check comes before TerminateProcess'
foreach ($f in @('tools\display_helper_paths.h', 'tools\display_settings_helper.cpp', 'src\platform\windows\display_helper_borrow_native.h')) {
  Ok (-not ([IO.File]::ReadAllText((Join-Path $srcRoot $f)).Contains('SunshineDisplayHelper'))) "$f has no shared mutex name"
}

# R1b-fix1 G1 (H13): running ARBS-H processes are handled before any file changes; a stopped setup brings the service back.
$helperText = [IO.File]::ReadAllText((Join-Path $pkg 'arbs-h-setup.ps1'))
Ok (@([IO.File]::ReadAllBytes((Join-Path $pkg 'arbs-h-setup.ps1')) | Where-Object { $_ -gt 127 }).Count -eq 0) 'arbs-h-setup.ps1 is ASCII'
$prep = $helperText.Substring($helperText.IndexOf('function Invoke-Prepare {'))
Ok ($prep.IndexOf('Stop-AppProcesses') -gt 0 -and $prep.IndexOf('Stop-AppProcesses') -lt $prep.IndexOf('robocopy.exe')) 'prepare stops processes before the backup'
Ok ($helperText.Contains('/F /PID {0} /FI "IMAGENAME eq {1}"') -and $helperText -notmatch "taskkill\.exe'[^\r\n]*/T\b") 'taskkill by PID + image name, no /T'
Ok ($helperText.Contains('Test-UnderRoot $Path $AppDir')) 'process choice is by path under the install folder'
$prepIss = $iss.Substring($iss.IndexOf('function PrepareToInstall'), $iss.IndexOf('procedure CurStepChanged') - $iss.IndexOf('function PrepareToInstall'))
Ok ($prepIss.Contains("'-Action prepare ' + CommonArgs + ' -ResultOut")) 'iss: prepare writes a result file'
Ok ($prepIss -match 'Code = 7') 'iss: prepare handles rc 7'
Ok ($prepIss.Contains('StartServiceAgain') -and $prepIss.Contains("'service-before'")) 'iss: failed prepare brings the service back'
Ok ($iss -match '(?s)procedure DeinitializeSetup;.*?if not PostInstallRan then\s+StartServiceAgain') 'iss: cancel brings the service back'
Ok ($iss -match "(?s)CurStep <> ssPostInstall then\s+exit;.*?PostInstallRan := True") 'iss: post-install owns the service state'
Ok ($iss.Contains("ExpandConstant('{sys}\sc.exe')")) 'iss: service restart does not depend on {tmp}'
Ok ($iss -match 'CloseApplications=no') 'iss: Restart Manager stays off (path-based stop only)'

# ---------------- H013 O6: names that collided with Vibepollo / Apollo / Sunshine (analysis/H013.md 6) ----------------
function Known([string]$Item, [string]$Reason) { Write-Host "known exception, deferred (EA-H013-U-01): $Item - $Reason" }
# S1/S2 built binaries: old shared names gone, own names present.
$nameBinaries = @('sunshine.exe', 'tools\sunshine_display_helper.exe', 'tools\playnite-launcher.exe', 'tools\sunshine_wgc_capture.exe')
foreach ($b in $nameBinaries) {
  $path = Join-Path $StageDir $b
  Ok (Test-Path -LiteralPath $path) "S1 stage has $b"
  if (-not $bytes.ContainsKey($b)) { $bytes[$b] = [IO.File]::ReadAllBytes($path) }
  foreach ($s in @('SunshineVirtualHdrActive', 'VibepolloPlayniteWatchdogCache', 'VibepolloPlayniteCleanupLease', 'VibeshinePresentTiming', 'sunshine-ca-bundle.pem')) {
    Ok ((Count-String $bytes[$b] $s) -eq 0) "S1 $b contains no '$s'"
  }
}
foreach ($s in @('Global\ARBS-H-VirtualHdrActive', 'Local\ARBS-H-VirtualHdrActive', 'ARBS-H-PresentTiming', 'arbs-h-ca-bundle.pem')) {
  Ok ((Count-String $bytes['sunshine.exe'] $s) -gt 0) "S2 sunshine.exe uses '$s'"
}
foreach ($s in @('Local\ARBS-H-PlayniteWatchdogCache-v1', 'Local\ARBS-H-PlayniteCleanupLease-v1-')) {
  Ok ((Count-String $bytes['tools\playnite-launcher.exe'] $s) -gt 0) "S2 playnite-launcher.exe uses '$s'"
}
# S3 sources: no shared per-user / ProgramData folder literal left where the H013 folders are used.
$folderSources = @('src\platform\windows\nvprefs\nvprefs_interface.cpp', 'src\platform\windows\frame_limiter_nvcp.cpp',
  'src\platform\windows\rtss_integration.cpp', 'tools\display_helper_paths.h', 'tools\display_settings_helper.cpp',
  'tools\sunshine_wgc_capture.cpp', 'tools\playnite_launcher\launcher.cpp', 'tools\playnite_launcher\playnite_process.cpp',
  'src\confighttp.cpp', 'src\confighttp_playnite.cpp')
foreach ($f in $folderSources) {
  $t = [IO.File]::ReadAllText((Join-Path $srcRoot $f))
  Ok (-not ($t.Contains('L"Sunshine"') -or $t.Contains('"Sunshine"') -or $t.Contains('L"Vibepollo"'))) "S3 $f has no shared Sunshine/Vibepollo folder literal"
}
$names = [IO.File]::ReadAllText((Join-Path $srcRoot 'src\platform\windows\arbs_h_names.h'))
Ok ($names.Contains('#define ARBS_H_USER_DIR_W L"ARBS-H"')) 'S3 arbs_h_names.h: per-user folder ARBS-H'
Ok (-not $names.Contains('Every Windows-global identity')) 'S3 arbs_h_names.h: old "every identity is its own" comment corrected'
# S4 new shared names: every Global\ / Local\ literal and every pipe name in src\ and tools\ must be on this list.
$allowedKernel = @(
  @{ File = '*'; Name = '^(Global|Local)\\\\ARBS-H-'; Why = 'ARBS-H own name (arbs_h_names.h)' },
  @{ File = 'src\platform\windows\dualsense_haptics.cpp'; Name = '^Local\\\\Vibepollo\.Haptics\.$'; Why = 'K3: prefix of a per-session random GUID name with an ACL' },
  @{ File = 'tools\dualsense_haptics\*'; Name = '.'; Why = 'K23: test probes, not shipped (cmake/targets/windows.cmake)' })
$allowedPipes = @(
  @{ File = 'src\platform\windows\ipc\pipes.cpp'; Name = '^$'; Why = 'K6: prefix only, the name is a random GUID' },
  @{ File = 'src\platform\windows\end_stream_hotkey.cpp'; Name = '^vibepollo_end_stream_$'; Why = 'K4: prefix of a random GUID name, FIRST_PIPE_INSTANCE' })
$codeFiles = @(Get-ChildItem -LiteralPath (Join-Path $srcRoot 'src'), (Join-Path $srcRoot 'tools') -Recurse -File -Include '*.cpp', '*.h', '*.hpp', '*.c' -ErrorAction SilentlyContinue)
$srcFull = [IO.Path]::GetFullPath($srcRoot).TrimEnd('\') + '\'
$unknown = @()
$seenKernel = 0; $seenPipes = 0
foreach ($cf in $codeFiles) {
  $rel = $cf.FullName.Substring($srcFull.Length)
  $t = [IO.File]::ReadAllText($cf.FullName)
  foreach ($m in [regex]::Matches($t, '"((?:Global|Local)\\\\[^"]*)"')) {
    $seenKernel++
    $ok = @($allowedKernel | Where-Object { ($rel -like $_.File) -and ($m.Groups[1].Value -match $_.Name) }).Count -gt 0
    if (-not $ok) { $unknown += "$rel kernel object $($m.Groups[1].Value)" }
  }
  foreach ($m in [regex]::Matches($t, 'pipe\\{1,2}([A-Za-z0-9_.\-{}]*)\)?"')) {
    $seenPipes++
    $ok = @($allowedPipes | Where-Object { ($rel -like $_.File) -and ($m.Groups[1].Value -match $_.Name) }).Count -gt 0
    if (-not $ok) { $unknown += "$rel pipe $($m.Groups[1].Value)" }
  }
}
Ok ($seenKernel -ge 7 -and $seenPipes -ge 2) "S4 scan found the named objects ($seenKernel kernel, $seenPipes pipe literals)"
Ok ($unknown.Count -eq 0) ("S4 no new shared object name" + $(if ($unknown.Count) { ': ' + ($unknown -join '; ') } else { '' }))
foreach ($a in @($allowedKernel + $allowedPipes)) { Write-Host "allowed: $($a.File) $($a.Name) - $($a.Why)" }
# Playnite connector (N17): still shared with Vibepollo on purpose (H013 D1). Listed, not judged.
$ipc = [IO.File]::ReadAllText((Join-Path $srcRoot 'src\platform\windows\playnite_ipc.cpp'))
Known "pipe '$(if ($ipc -match 'kControlPipeName\[\] = "([^"]+)"') { $matches[1] } else { '?' })' (src\platform\windows\playnite_ipc.cpp)" 'the Playnite connector is one per Playnite; changing only the host side breaks the Vibepollo connector'
Known 'plugin Id Sunshine.Playnite.Integration, plugin GUID, Extensions\SunshinePlaynite, assembly VibepolloPlaynite' 'C# connector and migration change + real Playnite test needed (separate task)'
Known 'connector log %APPDATA%\Sunshine\logs\sunshine_playnite-* (ARBS_H_PLAYNITE_CONNECTOR_LOG_DIR_W)' 'written by the shared connector; ARBS-H only reads it'
Ok ($names.Contains('#define ARBS_H_PLAYNITE_CONNECTOR_LOG_DIR_W L"Sunshine"')) 'S4 connector log folder is a named exception in arbs_h_names.h'
# S5 Vulkan layer: only this install's own manifest paths are removed (N15).
$misc = [IO.File]::ReadAllText((Join-Path $srcRoot 'src\platform\windows\misc.cpp'))
$manifest = $misc.Substring($misc.IndexOf('bool value_name_is_our_manifest('), 600)
$manifest = $manifest.Substring(0, $manifest.IndexOf("`n    }") + 6)
Ok (-not $manifest.Contains('.filename()') -and $manifest.Contains('vulkan_hdr_layer_manifest_path(layer)')) 'S5 value_name_is_our_manifest compares full own paths (no .filename())'
# S6 display snapshot: the legacy %ProgramData%\Sunshine folder is never adopted (N10).
$paths = [IO.File]::ReadAllText((Join-Path $srcRoot 'tools\display_helper_paths.h'))
Ok (-not $paths.Contains('write_snapshot_locator(key, L"Sunshine")') -and -not $paths.Contains('name == L"Sunshine"')) 'S6 no legacy Sunshine snapshot folder adoption'
# S7 Restart Manager is query only.
Ok (-not ($helperText -match 'RmShutdown|RmRestart')) 'S7 arbs-h-setup.ps1 never calls RmShutdown/RmRestart'
Ok ($helperText.Contains('RmGetList') -and $helperText.Contains('RmEndSession')) 'S7 lock owners are queried (RmGetList, session ended)'
Ok ($helperText -match "elseif \(\`$DryRun -or \`$PlanOnly\) \{ Write-Log 'dry-run: lock owner query skipped'; return @\(\) \}") 'S7 DryRun never runs the Restart Manager (no Add-Type)'
# S8 uninstall: processes end before the restore task is deleted (O3).
$un = $helperText.Substring($helperText.IndexOf('function Invoke-Uninstall {'))
$un = $un.Substring(0, $un.IndexOf("`n}") + 2)
Ok ($un.IndexOf('Stop-AppProcesses') -gt 0 -and $un.IndexOf('Stop-AppProcesses') -lt $un.IndexOf("'schtasks.exe'") -and $un.IndexOf('Stop-AppProcesses') -lt $un.IndexOf("('delete {0}'")) 'S8 uninstall: Stop-AppProcesses before sc delete and the task delete'
Ok ($un.IndexOf('Restore-ApolloService') -gt $un.IndexOf('catch { Write-Log "not removed:')) 'S8 uninstall: Vibepollo restore after a failed config delete'
# S9 installer: rc 8 retry before any file copy, first service values kept, cause shown, uninstall leftovers shown.
$prepIss = $iss.Substring($iss.IndexOf('function PrepareToInstall'), $iss.IndexOf('procedure CurStepChanged') - $iss.IndexOf('function PrepareToInstall'))
Ok ($prepIss -match 'Code = 8' -and $prepIss.Contains('MB_RETRYCANCEL') -and $prepIss.Contains("ValueOf(RK, RV, 'locked-by')")) 'S9 iss: rc 8 asks to close the program and [Retry]'
Ok ($prepIss -match '(?s)if \(not ServiceBeforeKnown\) and \(Before <> ''''\) then.*?ServiceBeforeKnown := True') 'S9/V4 iss: the first prepare values are kept'
Ok ($iss.Contains("' -PrevStart `"' + ServiceStartBefore + '`" -PrevState `"' + ServiceStateBefore + '`"'")) 'S9 iss: post-install gets -PrevStart / -PrevState'
Ok ($iss.Contains("Reason := ValueOf(RK, RV, 'reason');") -and $iss -match "Msg := '[^']*' \+ Reason;") 'S9 iss: post-install error shows the one-line reason'
Ok ($iss -match '(?s)CurUninstallStep <> usPostUninstall.*?uninstall-left.*?locked-by.*?MsgBox') 'S9 iss: usPostUninstall tells what is left'
Ok ($iss.Contains("-ResultOut `"' + UninstallResultFile")) 'S9 iss: uninstall writes its result to setup-logs'
# S10 stage: the Vulkan HDR layer (old event names) is not shipped.
Ok (@(Get-ChildItem -LiteralPath $StageDir -Recurse -File -Filter 'VkLayer_sunshine_hdr*' -ErrorAction SilentlyContinue).Count -eq 0) 'S10 stage has no VkLayer_sunshine_hdr*'
# S11 commit range: no submodule, driver binary or generated token file.
$git = Get-Command git.exe -ErrorAction SilentlyContinue
if ($git) {
  $changed = @(& $git.Source -C $srcRoot diff --name-only "$BaseCommit..HEAD") + @(& $git.Source -C $srcRoot diff --cached --name-only)
  $bad = @($changed | Where-Object { $_ -match '^third-party/|^src_assets/windows/drivers/|tokens\.' })
  Ok ($bad.Count -eq 0) ("S11 commit range $($BaseCommit.Substring(0, 9))..HEAD + index: no third-party/, drivers/, tokens.* (" + $changed.Count + ' files)' + $(if ($bad.Count) { ': ' + ($bad -join ', ') } else { '' }))
}
else { Ok $false 'S11 git.exe not found' }
# S12 (H022): session_history_ttl_days default 30 is the same in the server and in the three web screens;
# the installer template does not write the key (an existing value in sunshine.conf is kept, missing = 30).
$s12 = @(
  @{ F = 'src\config.cpp'; P = '(?m)^\s*30,\s*// session_history_ttl_days' },
  @{ F = 'src\config.h'; P = 'int session_history_ttl_days \{30\};' },
  @{ F = 'src_assets\common\assets\web-arbs\logic\config.ts'; P = '(?m)^\s*session_history_ttl_days: 30,' },
  @{ F = 'src_assets\common\assets\web\configs\settingsSchema.ts'; P = '(?m)^\s*session_history_ttl_days: 30,' },
  @{ F = 'src_assets\common\assets\web-legacy\stores\config.ts'; P = '(?m)^\s*session_history_ttl_days: 30,' })
foreach ($e in $s12) {
  $t = [IO.File]::ReadAllText((Join-Path $srcRoot $e.F))
  Ok ($t -match $e.P) "S12 $($e.F): session_history_ttl_days default 30"
}
Ok (-not ([IO.File]::ReadAllText((Join-Path $pkg 'sunshine.conf'))).Contains('session_history_ttl_days')) 'S12 installer template leaves session_history_ttl_days unset (server default 30)'
$s12Help = [IO.File]::ReadAllText((Join-Path $srcRoot 'src_assets\common\assets\web-arbs\locales\ko.json'), [Text.Encoding]::UTF8)
Ok ($s12Help.Contains('0 = ' + [char]0xC9C0 + [char]0xC6B0 + [char]0xC9C0 + ' ' + [char]0xC54A + [char]0xC74C + '. ' + [char]0xAE30 + [char]0xBCF8 + ' 30' + [char]0xC77C + '.')) 'S12 ko help text "0 = (never). (default) 30 (days)."'

# S13 (NET2 0.3.0): the server and web default port stays 47989 (existing installs do not move); only the installer
# writes port = 45989 into a new configuration; UPnP never maps the web UI port; the diagnostics API signs in first,
# logs nothing and is not cached; the installer text names no fixed port range.
$s13 = @(
  @{ F = 'src\config.cpp'; P = '(?m)^\s*47989,\s*// Base port number'; N = 'server default port 47989' },
  @{ F = 'src_assets\common\assets\web\configs\settingsSchema.ts'; P = '(?m)^\s*port: 47989,'; N = 'v2 screen default 47989' },
  @{ F = 'src_assets\common\assets\web\config.html'; P = '(?m)^\s*port: 47989,'; N = 'v2 config.html default 47989' },
  @{ F = 'src_assets\common\assets\web-legacy\config.html'; P = '(?m)^\s*port: 47989,'; N = 'classic screen default 47989' },
  @{ F = 'src\arbs_network_policy.h'; P = 'arbs_recommended_port = 45989;'; N = 'ARBS port constant 45989' })
foreach ($e in $s13) {
  $t = [IO.File]::ReadAllText((Join-Path $srcRoot $e.F))
  Ok ($t -match $e.P) "S13 $($e.F): $($e.N)"
}
$upnpText = [IO.File]::ReadAllText((Join-Path $srcRoot 'src\upnp.cpp'))
Ok (-not $upnpText.Contains('Configuration API') -and -not $upnpText.Contains('origin_web_ui_allowed')) 'S13 upnp.cpp maps no web UI port (no "Configuration API", no origin check)'
Ok ($upnpText.Contains('arbs::netpolicy::upnp_mappings(config::sunshine.port)')) 'S13 upnp.cpp takes its list from upnp_mappings'
$chText = [IO.File]::ReadAllText((Join-Path $srcRoot 'src\confighttp.cpp'))
$diag = $chText.Substring($chText.IndexOf('void getNetworkDiagnostics('))
$diag = $diag.Substring(0, $diag.IndexOf("`n  }") + 4)
Ok ($diag.IndexOf('authenticate(response, request)') -gt 0 -and $diag.IndexOf('authenticate(response, request)') -lt $diag.IndexOf('arbs::netdiag::build')) 'S13 diagnostics handler signs in before building the reply'
Ok (-not $diag.Contains('print_req') -and -not $diag.Contains('BOOST_LOG')) 'S13 diagnostics handler logs nothing (no print_req, no BOOST_LOG)'
Ok ($diag.Contains('arbs::netdiag::cache_control')) 'S13 diagnostics reply sent with Cache-Control no-store'
Ok ($chText.Contains('register_api_route("^/api/network/diagnostics$", "GET", getNetworkDiagnostics);')) 'S13 diagnostics route is GET only'
Ok (-not $iss.Contains('47984~48010')) 'S13 iss names no fixed port range'
Ok ($helperText.Contains('$script:ArbsDefaultPort = 45989') -and -not $helperText.Contains('$script:StreamPorts')) 'S13 setup helper: new-install port 45989, no fixed port list'
Ok (-not (([IO.File]::ReadAllText((Join-Path $pkg 'sunshine.conf'))) -match '(?m)^\s*port\s*=')) 'S13 template sunshine.conf has no port line (only a new config gets one)'

Ok (Test-Path -LiteralPath $SetupExe) 'setup.exe exists'
$shaFile = "$SetupExe.sha256"
Ok (Test-Path -LiteralPath $shaFile) 'setup.exe.sha256 exists'
$hash = (Get-FileHash -LiteralPath $SetupExe -Algorithm SHA256).Hash.ToLowerInvariant()
Ok (([IO.File]::ReadAllText($shaFile)).StartsWith($hash)) "setup.exe SHA-256 matches .sha256 ($hash)"
$setup = [Diagnostics.FileVersionInfo]::GetVersionInfo($SetupExe)
Ok ($setup.ProductName.Trim() -eq 'ARBS-H') "setup.exe ProductName ARBS-H ($($setup.ProductName.Trim()))"
Ok ($setup.ProductVersion.Trim() -eq $Version) "setup.exe ProductVersion $Version ($($setup.ProductVersion.Trim()))"
Ok ([IO.Path]::GetFileName($SetupExe) -eq "arbs-h-$Version-setup.exe") 'setup.exe name = update asset rule arbs-h-<ver>-setup.exe'

Write-Host ("arbs-h static checks: {0} passed, {1} failed" -f $pass, $fail)
if ($fail -eq 0) { exit 0 } else { exit 1 }
