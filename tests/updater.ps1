$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspace = Join-Path $repository ('work\updater-test-' + [guid]::NewGuid().ToString('N'))
$packages = Join-Path $workspace 'packages'
$installation = Join-Path $workspace 'install'
New-Item -ItemType Directory -Path $packages,$installation -Force | Out-Null
$configuration = @{ application = 'quiet-block'; repository = 'test/quiet-block'; ghPath = 'unused' } | ConvertTo-Json
Set-Content -LiteralPath (Join-Path $installation 'quiet-block-updater.json') -Value $configuration
$builder = Join-Path $repository 'scripts\Build-Release.ps1'
$updater = Join-Path $repository 'scripts\Update-QuietBlock.ps1'
& $builder -OutputDirectory $packages
& $updater -InstallDirectory $installation -PackageDirectory $packages
$marker = Get-Content -LiteralPath (Join-Path $installation 'extension\local-update.json') -Raw | ConvertFrom-Json
if (!$marker.managed) { throw 'Managed marker was not installed.' }
$firstInstall = $marker.installedAt
& $updater -InstallDirectory $installation -PackageDirectory $packages
$marker = Get-Content -LiteralPath (Join-Path $installation 'extension\local-update.json') -Raw | ConvertFrom-Json
if ($marker.installedAt -ne $firstInstall) { throw 'Same version was unnecessarily replaced.' }
# Simulate an old installed version to exercise directory replacement and backup.
$manifestPath = Join-Path $installation 'extension\manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$manifest.version = '1.0.0'
Set-Content -LiteralPath $manifestPath -Value ($manifest | ConvertTo-Json -Depth 20)
& $updater -InstallDirectory $installation -PackageDirectory $packages
if (!(Test-Path -LiteralPath (Join-Path $installation 'previous\manifest.json'))) { throw 'Previous installation was not preserved.' }
# Corruption must leave the installed version intact.
Add-Content -LiteralPath (Join-Path $packages 'quiet-block.zip') -Value 'corrupted'
$rejected = $false
try { & $updater -InstallDirectory $installation -PackageDirectory $packages } catch { $rejected = $_.Exception.Message -match 'checksum' }
if (!$rejected) { throw 'A corrupted release was not rejected.' }
if (!(Test-Path -LiteralPath $manifestPath)) { throw 'Valid installation was lost after a rejected update.' }
Write-Output 'PASS package build, first install, same-version no-op, version upgrade, previous-version backup, and corrupt-download rejection.'
