# Removes the Our Addis background tasks and the Tailscale address. Your data in C:\OurAddis\pb_data and the
# backups in Documents are kept; delete them yourself only if you really want to.
#Requires -RunAsAdministrator
param([string]$InstallDir = "C:\OurAddis")
foreach ($t in "OurAddis", "OurAddis-Backup") { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue }
$ts = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
if (Test-Path $ts) { & $ts serve --https=443 off }
Write-Host "Stopped. Your data is still in $InstallDir\pb_data."
