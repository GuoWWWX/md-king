$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$nsisDir = Join-Path $projectRoot "src-tauri\target\release\nsis\x64"
$installerScript = Join-Path $nsisDir "installer.nsi"
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

# Replace Tauri's temporary uncompressed block before the only final compression pass.
# Removing the whole block also removes SetCompress off; keep non-solid LZMA for Pandoc reuse.
$generatedCompressorPattern = '(?m)^!if "(?<algorithm>none|lzma)" == "none"\r?\n[ \t]+SetCompress off\r?\n!else\r?\n(?:[ \t]*;[^\r\n]*\r?\n)*[ \t]+SetCompressor(?: /SOLID)? "\k<algorithm>"\r?\n!endif\r?$'
if ($content -match $generatedCompressorPattern) {
  $content = [regex]::Replace($content, $generatedCompressorPattern, 'SetCompressor "lzma"')
}
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
  # Remove the generated copy instruction before inserting the cache block.
  # Removing it afterwards would also remove the identical instruction inside
  # the new block and silently produce an installer without pandoc.exe.
  $content = $content.Replace($pandocFileMatch.Value, "").Replace($pandocDirectory, $pandocCacheBlock)
}
if ($content -notmatch '(?m)^\s*File /a "/oname=pandoc\\windows\\pandoc\.exe" "[^"]+"\r?$') {
  throw "Bundled Pandoc executable copy instruction is missing from the NSIS script."
}

$pandocDelete = '    Delete "$INSTDIR\pandoc\windows\pandoc.exe"'
$pandocVersionDelete = '    Delete "$INSTDIR\pandoc\windows\pandoc.version"'
if (!$content.Contains($pandocVersionDelete)) {
  if (!$content.Contains($pandocDelete)) {
    throw "Could not find the Pandoc uninstall instruction."
  }
  $content = $content.Replace($pandocDelete, "$pandocDelete`r`n$pandocVersionDelete")
}

$historyDelete = '    Delete "$INSTDIR\history.json"'
if (!$content.Contains($historyDelete)) {
  $uninstallAnchor = '  Delete "$INSTDIR\${MAINBINARYNAME}.exe"'
  if (!$content.Contains($uninstallAnchor)) {
    throw "Could not find the main executable uninstall instruction."
  }
  $content = $content.Replace($uninstallAnchor, "$uninstallAnchor`r`n$historyDelete")
}

$baseCacheBlock = @'
  ; Keep one exact installer as the source for the next signed binary delta.
  CreateDirectory "$APPDATA\md-king\update-base"
  ClearErrors
  CopyFiles /SILENT "$EXEPATH" "$APPDATA\md-king\update-base\installer.exe"
  ${If} ${Errors}
    DetailPrint "Update base could not be cached; the next update will use a full download."
    ClearErrors
  ${EndIf}

'@
if (!$content.Contains('; Keep one exact installer as the source')) {
  $cacheAnchor = '  WriteUninstaller "$INSTDIR\uninstall.exe"'
  if (!$content.Contains($cacheAnchor)) { throw 'Could not find the NSIS installer cache anchor.' }
  $content = $content.Replace($cacheAnchor, "$baseCacheBlock`r`n$cacheAnchor")
}

Set-Content -LiteralPath $installerScript -Value $content -NoNewline -Encoding utf8

# Apply all installer patches before patch-nsis-installer.ps1 compiles once.
Write-Host "NSIS resource updates written to: $installerScript"
