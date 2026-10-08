param(
  [string]$OutputName
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$nsisDir = Join-Path $projectRoot "src-tauri\target\release\nsis\x64"
$installerScript = Join-Path $nsisDir "installer.nsi"
$outputExe = Join-Path $nsisDir "nsis-output.exe"
$bundleDir = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis"
$pandocExe = Join-Path $projectRoot "src-tauri\resources\pandoc\windows\pandoc.exe"
$pandocVersionFile = Join-Path $nsisDir "pandoc.version"

if (!(Test-Path $installerScript)) {
  throw "Missing generated NSIS script. Run tauri build first: $installerScript"
}
if (!(Test-Path $pandocExe)) {
  throw "Missing bundled Pandoc executable: $pandocExe"
}

$pandocVersionLine = (& $pandocExe --version | Select-Object -First 1).Trim()
if ($pandocVersionLine -notmatch '^pandoc\.exe\s+(?<version>\S+)$') {
  throw "Could not determine the bundled Pandoc version."
}
$pandocVersion = $Matches.version
Set-Content -LiteralPath $pandocVersionFile -Value $pandocVersion -NoNewline -Encoding ascii

$content = Get-Content -LiteralPath $installerScript -Raw

# Solid compression forces NSIS to walk one shared stream even when the installed Pandoc is reused.
$solidCompressorPattern = '(?m)^(?<indent>[ \t]*)SetCompressor /SOLID "lzma"\r?$'
if ($content -match $solidCompressorPattern) {
  $content = [regex]::Replace($content, $solidCompressorPattern, '${indent}SetCompressor "lzma"')
} elseif ($content -notmatch '(?m)^[ \t]*SetCompressor "lzma"\r?$') {
  throw "Could not find the expected NSIS LZMA compressor directive."
}

# Preserve the existing installation during upgrades so large unchanged resources remain available.
$defaultSelectionPattern = '(?ms)    ; Check the first radio button if this the first time\r?\n    ; we enter this page or if the second button wasn''t\r?\n    ; selected the last time we were on this page\r?\n    \$\{If\} \$ReinstallPageCheck <> 2\r?\n      SendMessage \$R2 \$\{BM_SETCHECK\} \$\{BST_CHECKED\} 0\r?\n    \$\{Else\}\r?\n      SendMessage \$R3 \$\{BM_SETCHECK\} \$\{BST_CHECKED\} 0\r?\n    \$\{EndIf\}\r?\n'
$replacement = @'
    ; For upgrades, keep the current installation and update files in place.
    ${If} $WixMode = 1
      SendMessage $R2 ${BM_SETCHECK} ${BST_CHECKED} 0
      StrCpy $ReinstallPageCheck 1
    ${ElseIf} $ReinstallPageCheck = 2
      SendMessage $R3 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${ElseIf} $R0 = 1
      SendMessage $R3 ${BM_SETCHECK} ${BST_CHECKED} 0
      StrCpy $ReinstallPageCheck 2
    ${Else}
      SendMessage $R2 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${EndIf}
'@
if ($content -notlike "*For upgrades, keep the current installation*") {
  if ($content -notmatch $defaultSelectionPattern) {
    throw "Could not find the NSIS upgrade selection block."
  }
  $content = [regex]::Replace($content, $defaultSelectionPattern, $replacement)
}

$pandocFilePattern = '(?m)^    File /a "/oname=pandoc\\windows\\pandoc\.exe" "(?<source>[^"]+)"\r?$'
$pandocFileMatch = [regex]::Match($content, $pandocFilePattern)
if (!$pandocFileMatch.Success) {
  throw "Could not find the bundled Pandoc copy instruction."
}

$pandocDirectory = '    CreateDirectory "$INSTDIR\pandoc\windows"'
if (!$content.Contains($pandocDirectory)) {
  throw "Could not find the Pandoc destination directory instruction."
}

$pandocCacheBlock = @'
    CreateDirectory "$INSTDIR\pandoc\windows"
    IfFileExists "$INSTDIR\pandoc\windows\pandoc.exe" 0 pandoc_install
    IfFileExists "$INSTDIR\pandoc\windows\pandoc.version" pandoc_version_check pandoc_install
  pandoc_version_check:
    StrCpy $R1 ""
    ClearErrors
    FileOpen $R0 "$INSTDIR\pandoc\windows\pandoc.version" r
    IfErrors pandoc_install
    FileRead $R0 $R1
    FileClose $R0
    StrCmp $R1 "__PANDOC_VERSION__" pandoc_keep pandoc_install
  pandoc_install:
    File /a "/oname=pandoc\windows\pandoc.exe" "__PANDOC_SOURCE__"
    File /a "/oname=pandoc\windows\pandoc.version" "__PANDOC_VERSION_FILE__"
    Goto pandoc_ready
  pandoc_keep:
    DetailPrint "Pandoc __PANDOC_VERSION__ unchanged; reusing installed binary."
  pandoc_ready:
'@
$pandocCacheBlock = $pandocCacheBlock.Replace('__PANDOC_VERSION__', $pandocVersion).Replace('__PANDOC_SOURCE__', $pandocFileMatch.Groups['source'].Value).Replace('__PANDOC_VERSION_FILE__', $pandocVersionFile)
if (!$content.Contains("pandoc_version_check:")) {
  $content = $content.Replace($pandocDirectory, $pandocCacheBlock).Replace($pandocFileMatch.Value, "")
}

$pandocDelete = '    Delete "$INSTDIR\pandoc\windows\pandoc.exe"'
$pandocVersionDelete = '    Delete "$INSTDIR\pandoc\windows\pandoc.version"'
if (!$content.Contains($pandocVersionDelete)) {
  if (!$content.Contains($pandocDelete)) {
    throw "Could not find the Pandoc uninstall instruction."
  }
  $content = $content.Replace($pandocDelete, "$pandocDelete`r`n$pandocVersionDelete")
}

Set-Content -LiteralPath $installerScript -Value $content -NoNewline -Encoding utf8

$makensis = Join-Path $env:LOCALAPPDATA "tauri\NSIS\makensis.exe"
if (!(Test-Path $makensis)) {
  throw "Could not find makensis.exe under $env:LOCALAPPDATA\tauri\NSIS."
}

Push-Location $nsisDir
try {
  & $makensis "installer.nsi"
  if ($LASTEXITCODE -ne 0) { throw "NSIS compiler failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

if (!(Test-Path $outputExe)) {
  throw "NSIS did not produce $outputExe"
}

if (!$OutputName) {
  $packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
  $OutputName = "md-king_$($packageJson.version)_x64-setup.exe"
}

$installerExe = Join-Path $bundleDir $OutputName
Copy-Item -LiteralPath $outputExe -Destination $installerExe -Force
Write-Host "NSIS installer written to:"
Write-Host $installerExe
