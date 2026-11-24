# Our Addis - home server installer for Windows.
# Installs PocketBase (pinned + checksum-verified), the app, the server rules, a background task that starts
# with Windows and restarts itself, nightly backups (also copied to Documents), and the Tailscale HTTPS address.
# Safe to run again: it updates the app and rules and never touches your data.
#Requires -RunAsAdministrator
param([string]$InstallDir = "C:\OurAddis", [int]$Port = 8090)
$ErrorActionPreference = "Stop"
$Version = "0.40.6"
$Sha256  = "33a2a1d255cadded77346fc7f5de37dca21ba4bad0d9cae0235a50b3b703d6d9"
$Repo    = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$exe     = Join-Path $InstallDir "pocketbase.exe"
$data    = Join-Path $InstallDir "pb_data"

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Magenta }
function Plain($secure) { [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)) }

Step "Preparing $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir, $data, (Join-Path $InstallDir "secrets") | Out-Null
Stop-ScheduledTask -TaskName "OurAddis" -ErrorAction SilentlyContinue
Get-Process pocketbase -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
Start-Sleep -Seconds 2

Step "PocketBase $Version"
$have = if (Test-Path $exe) { (& $exe --version) -join "" } else { "" }
if ($have -notmatch [regex]::Escape($Version)) {
  $zip = Join-Path $env:TEMP "pocketbase_$Version.zip"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest "https://github.com/pocketbase/pocketbase/releases/download/v$Version/pocketbase_${Version}_windows_amd64.zip" -OutFile $zip -UseBasicParsing
  if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $Sha256) { throw "PocketBase download failed its checksum. Nothing was changed." }
  $tmp = Join-Path $env:TEMP "pocketbase_$Version"
  Expand-Archive $zip -DestinationPath $tmp -Force
  Copy-Item (Join-Path $tmp "pocketbase.exe") $exe -Force
}

Step "App and server rules"
foreach ($pair in @(@("app", "pb_public"), @("server\pb_hooks", "pb_hooks"), @("server\pb_migrations", "pb_migrations"))) {
  $dst = Join-Path $InstallDir $pair[1]
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  Copy-Item (Join-Path $Repo $pair[0]) $dst -Recurse
}

Step "Locking down the data and secrets folders (SYSTEM and Administrators only)"
foreach ($d in @($data, (Join-Path $InstallDir "secrets"))) {
  icacls $d /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
}

$keyFile = Join-Path $InstallDir "secrets\anthropic.key"
if (-not (Test-Path $keyFile)) {
  Step "Claude key for 'Where should we go next?'"
  $k = Plain (Read-Host "Paste your Anthropic API key (or press Enter to skip; you can rerun this later)" -AsSecureString)
  if ($k) { [IO.File]::WriteAllText($keyFile, $k.Trim()) ; Write-Host "Saved. It stays on this PC only." }
}

Step "Database"
& $exe migrate up --dir $data --migrationsDir (Join-Path $InstallDir "pb_migrations") | Out-Host
$marker = Join-Path $InstallDir "secrets\.admin-created"
if (-not (Test-Path $marker)) {
  Write-Host "Create the PC dashboard login (only used on this PC, at http://127.0.0.1:$Port/_/)."
  $email = Read-Host "Dashboard email"
  do { $pw = Plain (Read-Host "Dashboard password (10+ characters)" -AsSecureString) } while ($pw.Length -lt 10)
  & $exe superuser upsert $email $pw --dir $data | Out-Host
  New-Item -ItemType File -Path $marker -Force | Out-Null
}

Step "Background service (starts with Windows, restarts if it stops)"
$argsLine = "serve --http 127.0.0.1:$Port --dir `"$data`" --hooksDir `"$InstallDir\pb_hooks`" --migrationsDir `"$InstallDir\pb_migrations`" --publicDir `"$InstallDir\pb_public`""
$action    = New-ScheduledTaskAction -Execute $exe -Argument $argsLine -WorkingDirectory $InstallDir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
              -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "NT AUTHORITY\SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "OurAddis" -Description "Our Addis home server (PocketBase)" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName "OurAddis"
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) { Start-Sleep -Seconds 1; try { $ok = (Invoke-RestMethod "http://127.0.0.1:$Port/api/our/ping" -TimeoutSec 2).ok } catch {} }
if (-not $ok) { throw "The server didn't start. Check Task Scheduler > OurAddis." }
Write-Host "Server is running."

Step "Extra backup copy in your Documents folder (daily 03:30)"
$docs = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Our Addis backups"
New-Item -ItemType Directory -Force -Path $docs | Out-Null
$bAction  = New-ScheduledTaskAction -Execute "robocopy.exe" -Argument "`"$data\backups`" `"$docs`" *.zip /MIR /R:2 /W:5 /NP"
$bTrigger = New-ScheduledTaskTrigger -Daily -At 3:30am
Register-ScheduledTask -TaskName "OurAddis-Backup" -Description "Copies Our Addis nightly backups to Documents" -Action $bAction -Trigger $bTrigger `
  -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries) -Principal $principal -Force | Out-Null
Write-Host "Backups: $data\backups (14 nights) and $docs"

Step "Tailscale (private HTTPS address for the phones)"
$ts = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
if (-not (Test-Path $ts)) {
  Write-Host "Tailscale isn't installed. Install it from https://tailscale.com/download/windows, sign in, then run this installer again." -ForegroundColor Yellow
} else {
  & $ts serve --bg --https=443 "http://127.0.0.1:$Port" | Out-Host
  $dns = ((& $ts status --json) | ConvertFrom-Json).Self.DNSName.TrimEnd(".")
  Write-Host "`nAll set. On both phones (with Tailscale on), open:" -ForegroundColor Green
  Write-Host "    https://$dns/" -ForegroundColor Green
  Write-Host "Then Share > Add to Home Screen (iPhone) or Install app (Android)."
}
