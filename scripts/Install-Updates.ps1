[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')][string]$Repository,
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'QuietBlock'),
  [string]$GhPath = 'gh',
  [switch]$SkipTask
)
$ErrorActionPreference = 'Stop'
$gh = (Get-Command $GhPath -ErrorAction Stop).Source
& $gh auth status --hostname github.com
if ($LASTEXITCODE -ne 0) { throw 'Sign in first with: gh auth login --hostname github.com --git-protocol https --web --scopes repo' }
$repo = & $gh repo view $Repository --json nameWithOwner,isPrivate | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'The repository could not be accessed.' }
if (!$repo.isPrivate) { throw 'This installer expects the private Quiet Block repository.' }
$root = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
if (Test-Path -LiteralPath $root) {
  if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Install directory must not be a link.' }
  $existing = Join-Path $root 'quiet-block-updater.json'
  if (!(Test-Path -LiteralPath $existing) -and @(Get-ChildItem -LiteralPath $root -Force).Count) { throw 'Choose an empty directory or an existing Quiet Block installation.' }
  if (Test-Path -LiteralPath $existing) {
    $old = Get-Content -LiteralPath $existing -Raw | ConvertFrom-Json
    if ($old.application -cne 'quiet-block' -or $old.repository -ine $Repository) { throw 'This directory belongs to a different installation.' }
  }
}
New-Item -ItemType Directory -Path $root -Force | Out-Null
$toolsDirectory = Join-Path $root 'tools'
New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null
$installedGh = Join-Path $toolsDirectory 'gh.exe'
if ($gh -ine $installedGh) { Copy-Item -LiteralPath $gh -Destination $installedGh -Force }
$runner = Join-Path $root 'Update-QuietBlock.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Update-QuietBlock.ps1') -Destination $runner -Force
$configuration = @{ application = 'quiet-block'; repository = $repo.nameWithOwner; ghPath = $installedGh } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $root 'quiet-block-updater.json'), $configuration, [Text.UTF8Encoding]::new($false))
& $runner -InstallDirectory $root
if (!$SkipTask) {
  $taskName = 'Quiet Block Updates'
  $executable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '" -InstallDirectory "' + $root + '"'
  $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($existingTask -and $existingTask.Actions.Arguments -ne $arguments) { throw 'A different Quiet Block update task already exists; no task was overwritten.' }
  $action = New-ScheduledTaskAction -Execute $executable -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Download stable Quiet Block releases from your private GitHub repository.' -Force | Out-Null
}
Write-Output "Load this folder once in opera://extensions: $(Join-Path $root 'extension')"
Write-Output 'Disable the old development copy to avoid running two copies. Existing site tabs need a reload after extension updates.'
