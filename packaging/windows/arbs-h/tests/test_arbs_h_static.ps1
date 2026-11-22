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
  'VibepolloDisplayHelperLogonTrigger', 'api.github.com/repos/Nonary', 'VibepolloSetup')
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
