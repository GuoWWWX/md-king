$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$nsisDir = Join-Path $projectRoot "src-tauri\target\release\nsis\x64"
$installerScript = Join-Path $nsisDir "installer.nsi"
$utilsScript = Join-Path $nsisDir "utils.nsh"
$outputExe = Join-Path $nsisDir "nsis-output.exe"
$bundleDir = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis"
$installedIconName = "md-king.ico"

if (!(Test-Path $installerScript)) {
  throw "Missing generated NSIS script. Run tauri build first: $installerScript"
}
if (!(Test-Path $utilsScript)) {
  throw "Missing generated NSIS utils script. Run tauri build first: $utilsScript"
}

$content = Get-Content -LiteralPath $installerScript -Raw

$skipPagePattern = '(?ms)\r?\n  ; In-place reinstall/upgrade should not force the user through the uninstall flow\.\r?\n  \$\{If\} \$R0 = 0\r?\n  \$\{OrIf\} \$R0 = 1\r?\n    Abort\r?\n  \$\{EndIf\}\r?\n'
$content = [regex]::Replace($content, $skipPagePattern, "`r`n")

$defaultSelectionPattern = '(?ms)    ; Check the first radio button if this the first time\r?\n    ; we enter this page or if the second button wasn''t\r?\n    ; selected the last time we were on this page\r?\n    \$\{If\} \$ReinstallPageCheck <> 2\r?\n      SendMessage \$R2 \$\{BM_SETCHECK\} \$\{BST_CHECKED\} 0\r?\n    \$\{Else\}\r?\n      SendMessage \$R3 \$\{BM_SETCHECK\} \$\{BST_CHECKED\} 0\r?\n    \$\{EndIf\}\r?\n'

$replacement = @'
    ; Keep the maintenance page visible. For upgrades, default to in-place install
    ; so pressing Next does not run the uninstall flow first.
    ${If} $ReinstallPageCheck = 2
      SendMessage $R3 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${ElseIf} $R0 = 1
      SendMessage $R3 ${BM_SETCHECK} ${BST_CHECKED} 0
      StrCpy $ReinstallPageCheck 2
    ${Else}
      SendMessage $R2 ${BM_SETCHECK} ${BST_CHECKED} 0
    ${EndIf}
'@

if ($content -notlike "*Keep the maintenance page visible*") {
  if ($content -notmatch $defaultSelectionPattern) {
    throw "Could not find the NSIS maintenance page default-selection block."
  }

  $content = [regex]::Replace($content, $defaultSelectionPattern, $replacement)
}

$refreshCall = @'

  Call RefreshExistingShortcutIcons
'@
$shortcutAnchor = @'
  !insertmacro MUI_STARTMENU_WRITE_END
'@
if ($content -notlike "*Function RefreshExistingShortcutIcons*") {
  if (!$content.Contains($shortcutAnchor)) {
    throw "Could not find the NSIS shortcut creation anchor."
  }

  $content = $content.Replace($shortcutAnchor, "$shortcutAnchor$refreshCall")
}

$mainBinaryCopy = '  File "${MAINBINARYSRCPATH}"'
$iconCopy = "  File `"/oname=$installedIconName`" `"`${INSTALLERICON}`""
if ($content -notlike "*$installedIconName*") {
  if (!$content.Contains($mainBinaryCopy)) {
    throw "Could not find the NSIS main binary copy line."
  }

  $content = $content.Replace($mainBinaryCopy, "$mainBinaryCopy`r`n$iconCopy")
}

$displayIconExe = '  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""'
$displayIconIco = '  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\' + $installedIconName + '$\""'
if ($content.Contains($displayIconExe)) {
  $content = $content.Replace($displayIconExe, $displayIconIco)
}

$deleteMainBinary = '  Delete "$INSTDIR\${MAINBINARYNAME}.exe"'
$deleteIcon = "  Delete `"`$INSTDIR\$installedIconName`""
if ($content -notlike "*$deleteIcon*") {
  if (!$content.Contains($deleteMainBinary)) {
    throw "Could not find the NSIS main binary delete line."
  }

  $content = $content.Replace($deleteMainBinary, "$deleteMainBinary`r`n$deleteIcon")
}

$startMenuShortcutWithFolder = '    CreateShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"'
$startMenuTargetWithFolder = '    !insertmacro SetShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"'
if ($content.Contains($startMenuShortcutWithFolder) -and !$content.Contains("$startMenuShortcutWithFolder`r`n$startMenuTargetWithFolder")) {
  $content = $content.Replace($startMenuShortcutWithFolder, "$startMenuShortcutWithFolder`r`n$startMenuTargetWithFolder")
}

$startMenuShortcut = '    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"'
$startMenuTarget = '    !insertmacro SetShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"'
if ($content.Contains($startMenuShortcut) -and !$content.Contains("$startMenuShortcut`r`n$startMenuTarget")) {
  $content = $content.Replace($startMenuShortcut, "$startMenuShortcut`r`n$startMenuTarget")
}

$desktopShortcut = '  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"'
$desktopTarget = '  !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"'
if ($content.Contains($desktopShortcut) -and !$content.Contains("$desktopShortcut`r`n$desktopTarget")) {
  $content = $content.Replace($desktopShortcut, "$desktopShortcut`r`n$desktopTarget")
}

$refreshFunction = @'

Function RefreshExistingShortcutIcons
  !if "${STARTMENUFOLDER}" != ""
    IfFileExists "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" 0 +3
      !insertmacro SetShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    IfFileExists "$SMPROGRAMS\${PRODUCTNAME}.lnk" 0 +3
      !insertmacro SetShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif

  IfFileExists "$DESKTOP\${PRODUCTNAME}.lnk" 0 +3
    !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"

  IfFileExists "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${PRODUCTNAME}.lnk" 0 +3
    !insertmacro SetShortcutTarget "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${PRODUCTNAME}.lnk"

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
FunctionEnd
'@
$functionAnchor = @'
Function CreateOrUpdateStartMenuShortcut
'@
if ($content -notlike "*Function RefreshExistingShortcutIcons*") {
  if (!$content.Contains($functionAnchor)) {
    throw "Could not find the NSIS shortcut function anchor."
  }

  $content = $content.Replace($functionAnchor, "$refreshFunction`r`n$functionAnchor")
}

Set-Content -LiteralPath $installerScript -Value $content -NoNewline -Encoding UTF8

$utilsContent = Get-Content -LiteralPath $utilsScript -Raw
$setPathNeedle = '      ${IShellLink::SetPath} $0 ''(w "${target}")'''
$setIconLine = "      `${IShellLink::SetIconLocation} `$0 '(w `"`$INSTDIR\$installedIconName`", 0)'"
$oldSetTargetIconLine = '      ${IShellLink::SetIconLocation} $0 ''(w "${target}", 0)'''
if ($utilsContent.Contains($oldSetTargetIconLine)) {
  $utilsContent = $utilsContent.Replace($oldSetTargetIconLine, $setIconLine)
  Set-Content -LiteralPath $utilsScript -Value $utilsContent -NoNewline -Encoding UTF8
}
if ($utilsContent -notlike "*SetIconLocation*") {
  if (!$utilsContent.Contains($setPathNeedle)) {
    throw "Could not find the NSIS SetShortcutTarget SetPath line."
  }

  $utilsContent = $utilsContent.Replace($setPathNeedle, "$setPathNeedle`r`n$setIconLine")
  Set-Content -LiteralPath $utilsScript -Value $utilsContent -NoNewline -Encoding UTF8
}

$makensisCandidates = @(
  (Join-Path $env:LOCALAPPDATA "tauri\NSIS\makensis.exe"),
  (Join-Path $env:LOCALAPPDATA "tauri\NSIS\Bin\makensis.exe")
)
$makensis = $makensisCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (!$makensis) {
  throw "Could not find makensis.exe under $env:LOCALAPPDATA\tauri\NSIS."
}

Push-Location $nsisDir
try {
  & $makensis "installer.nsi"
} finally {
  Pop-Location
}

if (!(Test-Path $outputExe)) {
  throw "NSIS did not produce $outputExe"
}

$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$installerExe = Join-Path $bundleDir "md-king_$($packageJson.version)_x64-setup.exe"
Copy-Item -LiteralPath $outputExe -Destination $installerExe -Force

Write-Host "NSIS installer written to:"
Write-Host $installerExe
