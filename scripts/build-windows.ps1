param([switch]$SkipFrontendBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path ([IO.Path]::GetTempPath()) ('md-king-build-' + [guid]::NewGuid() + '.json')
# Tauri generates its NSIS script while creating a temporary uncompressed installer.
# Apply all our installer patches before doing the only LZMA compression pass.
$config = @{ bundle = @{ windows = @{ nsis = @{ compression = 'none' } } } }
if ($SkipFrontendBuild) {
  if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'dist/index.html'))) { throw 'Validated frontend build is missing.' }
  $config.build = @{ beforeBuildCommand = '' }
}
Push-Location $projectRoot
try {
  [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
  & pnpm tauri build --config $configPath
  if ($LASTEXITCODE -ne 0) { throw "Tauri build failed: $LASTEXITCODE" }
  & (Join-Path $PSScriptRoot 'patch-nsis-update-resources.ps1')
  & (Join-Path $PSScriptRoot 'patch-nsis-installer.ps1')
} finally {
  Remove-Item -LiteralPath $configPath -ErrorAction SilentlyContinue
  Pop-Location
}
