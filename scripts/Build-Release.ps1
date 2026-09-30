[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist'), [string]$Tag)
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $package.version) { throw 'manifest.json and package.json versions must match.' }
if ($Tag -and $Tag -cne "v$($manifest.version)") { throw 'The release tag must match the manifest version.' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output = (Resolve-Path -LiteralPath $OutputDirectory).Path
$stage = Join-Path $output ('package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$files = @('manifest.json','background.js','rules.mjs','update-bridge.mjs','local-update.json','options.html','options.js','page-controls.js','popup-guard.js','youtube-block.js','popup.html','popup.js','styles.css')
try {
  foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $stage $file) }
  [IO.File]::WriteAllText((Join-Path $stage 'local-update.json'), (@{ managed = $false; version = $manifest.version } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  $archive = Join-Path $output 'quiet-block.zip'
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -Force
  $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS'), "$hash  quiet-block.zip`n", [Text.UTF8Encoding]::new($false))
  Write-Output "Built Quiet Block $($manifest.version): $archive"
} finally {
  $resolvedStage = [IO.Path]::GetFullPath($stage)
  if (!$resolvedStage.StartsWith($output.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging path.' }
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
