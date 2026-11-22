<#
.SYNOPSIS
  ARBS-H rollback tool (R1a, D-R1a-8): ARBS-H service -> manual, Vibepollo service (ApolloService) -> the start
  type and state recorded once by the installer (%ProgramData%\ARBS-H\rollback\apolloservice.json).
  -Plan only prints the commands. Vibepollo files, firewall rules, tasks and drivers are not touched.
#>
param([switch]$Plan, [string]$DataRoot = (Join-Path $env:ProgramData 'ARBS-H'))
$helper = Join-Path $PSScriptRoot 'arbs-h-setup.ps1'
if ($Plan) { & $helper -Action rollback -DataRoot $DataRoot -PlanOnly } else { & $helper -Action rollback -DataRoot $DataRoot }
exit $LASTEXITCODE
