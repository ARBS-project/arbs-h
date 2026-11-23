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
  [string]$Version = '0.1.0'
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
foreach ($ui in @('index.html', 'v2\index.html')) { Ok ([IO.File]::ReadAllText((Join-Path $StageDir "assets\web\$ui")).Contains('<title>ARBS-H</title>')) "$ui title ARBS-H" }

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
