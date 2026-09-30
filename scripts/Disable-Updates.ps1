[CmdletBinding()]
param([string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'QuietBlock'))
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$config = Get-Content -LiteralPath (Join-Path $root 'quiet-block-updater.json') -Raw | ConvertFrom-Json
if ($config.application -cne 'quiet-block') { throw 'Not a Quiet Block installation.' }
$task = Get-ScheduledTask -TaskName 'Quiet Block Updates' -ErrorAction SilentlyContinue
if ($task) {
  $expected = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $root 'Update-QuietBlock.ps1') + '" -InstallDirectory "' + $root + '"'
  if ($task.Actions.Arguments -ne $expected) { throw 'The task belongs to a different installation.' }
  Unregister-ScheduledTask -TaskName 'Quiet Block Updates' -Confirm:$false
}
Write-Output 'Automatic downloading is disabled. The installed extension and saved preferences remain.'
