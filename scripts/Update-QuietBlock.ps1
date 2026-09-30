[CmdletBinding()]
param([Parameter(Mandatory)][string]$InstallDirectory, [string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$configPath = Join-Path $root 'quiet-block-updater.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.application -cne 'quiet-block' -or $config.repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid updater configuration.' }
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installation root must not be a link.' }

function Assert-Child([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if (!$full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Path is outside the installation: $full" }
  if ((Test-Path -LiteralPath $full) -and ((Get-Item -LiteralPath $full).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Managed paths must not be links.' }
  return $full
}
function Remove-Managed([string]$Path) {
  $safe = Assert-Child $Path
  if (Test-Path -LiteralPath $safe) { Remove-Item -LiteralPath $safe -Recurse -Force }
}
function Write-Status([string]$State, [string]$Message) {
  $json = @{ state = $State; message = $Message; checkedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $root 'update-status.json'), $json, [Text.UTF8Encoding]::new($false))
}
function Run-Gh([string[]]$Arguments) {
  $result = & $config.ghPath @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ('GitHub request failed. Run gh auth status/login and check repository access. ' + ($result -join ' ')) }
  return $result -join "`n"
}

# Exclusive file lock prevents an hourly check and a manual check from overlapping.
try { $lock = [IO.File]::Open((Join-Path $root 'update.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch [IO.IOException] { Write-Output 'Another update is already running.'; return }
$stage = Join-Path $root ('stage-' + [guid]::NewGuid().ToString('N'))
$extension = Join-Path $root 'extension'
$previous = Join-Path $root 'previous'
try {
  # Recover if a previous process stopped between the two directory renames.
  if (!(Test-Path -LiteralPath $extension) -and (Test-Path -LiteralPath $previous)) {
    [void](Assert-Child $previous); [void](Assert-Child $extension)
    Move-Item -LiteralPath $previous -Destination $extension
  }
  New-Item -ItemType Directory -Path $stage | Out-Null
  if ($PackageDirectory) {
    foreach ($file in @('quiet-block.zip','SHA256SUMS')) { Copy-Item -LiteralPath (Join-Path $PackageDirectory $file) -Destination (Join-Path $stage $file) }
    $tag = $null
  } else {
    $release = Run-Gh @('release','view','--repo',$config.repository,'--json','tagName,isDraft,isPrerelease') | ConvertFrom-Json
    if ($release.isDraft -or $release.isPrerelease) { throw 'Only stable, published releases are supported.' }
    $tag = $release.tagName
    [void](Run-Gh @('release','download',$tag,'--repo',$config.repository,'--pattern','quiet-block.zip','--pattern','SHA256SUMS','--dir',$stage))
  }
  $checksum = Get-Content -LiteralPath (Join-Path $stage 'SHA256SUMS') | Where-Object { $_ -match '^[a-fA-F0-9]{64}\s+\*?quiet-block\.zip$' }
  if (@($checksum).Count -ne 1) { throw 'The release checksum is missing or ambiguous.' }
  $archive = Join-Path $stage 'quiet-block.zip'
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine ($checksum -split '\s+')[0]) { throw 'Release checksum verification failed.' }
  $unpacked = Join-Path $stage 'extension'
  New-Item -ItemType Directory -Path $unpacked | Out-Null
  $required = @('manifest.json','background.js','rules.mjs','update-bridge.mjs','local-update.json','options.html','options.js','page-controls.js','popup-guard.js','popup.html','popup.js','styles.css')
  $optional = @('youtube-block.js') # Allows an upgraded helper to read older 1.1 packages.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  try {
    if ($zip.Entries.Count -lt $required.Count -or $zip.Entries.Count -gt ($required.Count + $optional.Count)) { throw 'Unexpected release archive contents.' }
    $seen = @{}
    foreach ($entry in $zip.Entries) {
      if ($entry.FullName -cnotin ($required + $optional) -or $seen.ContainsKey($entry.FullName) -or $entry.Length -gt 5MB) { throw 'Invalid or oversized release archive entry.' }
      $seen[$entry.FullName] = $true
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $unpacked $entry.FullName))
    }
    foreach ($file in $required) { if (!$seen.ContainsKey($file)) { throw 'Missing required release file.' } }
  } finally { $zip.Dispose() }
  $manifest = Get-Content -LiteralPath (Join-Path $unpacked 'manifest.json') -Raw | ConvertFrom-Json
  if ($manifest.name -cne 'Quiet Block' -or $manifest.manifest_version -ne 3 -or $manifest.version -notmatch '^\d+\.\d+\.\d+(?:\.\d+)?$') { throw 'Invalid Quiet Block release manifest.' }
  if ([version]$manifest.version -ge [version]'1.2.0' -and !(Test-Path -LiteralPath (Join-Path $unpacked 'youtube-block.js'))) { throw 'Missing YouTube filter.' }
  if ($tag -and $tag -cne "v$($manifest.version)") { throw 'Release tag and package version do not match.' }
  $currentManifest = Join-Path $extension 'manifest.json'
  if (Test-Path -LiteralPath $currentManifest) {
    $current = Get-Content -LiteralPath $currentManifest -Raw | ConvertFrom-Json
    if ([version]$manifest.version -le [version]$current.version) {
      Write-Status 'current' "Version $($current.version) is current; no downgrade or same-version replacement performed."
      Write-Output "Quiet Block $($current.version) is current."
      return
    }
  }
  $marker = @{ managed = $true; version = $manifest.version; installedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $unpacked 'local-update.json'), $marker, [Text.UTF8Encoding]::new($false))
  Remove-Managed $previous
  [void](Assert-Child $extension); [void](Assert-Child $unpacked)
  if (Test-Path -LiteralPath $extension) { Move-Item -LiteralPath $extension -Destination $previous }
  try { Move-Item -LiteralPath $unpacked -Destination $extension }
  catch {
    if (!(Test-Path -LiteralPath $extension) -and (Test-Path -LiteralPath $previous)) { Move-Item -LiteralPath $previous -Destination $extension }
    throw
  }
  Write-Status 'updated' "Installed version $($manifest.version). Opera will reload within approximately one minute while running."
  Write-Output "Installed Quiet Block $($manifest.version) at $extension"
} catch {
  Write-Status 'error' $_.Exception.Message
  throw
} finally {
  Remove-Managed $stage
  $lock.Dispose()
}
