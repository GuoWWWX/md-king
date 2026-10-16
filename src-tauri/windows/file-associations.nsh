!ifndef MDKING_FILE_ASSOCIATIONS
!define MDKING_FILE_ASSOCIATIONS

!macro NSIS_HOOK_POSTINSTALL
  ; Register candidates without changing .md/.markdown defaults or UserChoice.
  WriteRegStr SHCTX "Software\Classes\md-king.Markdown" "" "Markdown 文档"
  WriteRegStr SHCTX "Software\Classes\md-king.Markdown\DefaultIcon" "" '$\"$INSTDIR\markdown.ico$\",0'
  WriteRegStr SHCTX "Software\Classes\md-king.Markdown\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\md-king.Markdown\Application" "ApplicationName" "md-king"
  WriteRegStr SHCTX "Software\Classes\md-king.Markdown\Application" "ApplicationIcon" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  WriteRegStr SHCTX "Software\Classes\Applications\md-king.exe" "FriendlyAppName" "md-king"
  WriteRegStr SHCTX "Software\Classes\Applications\md-king.exe\DefaultIcon" "" '$\"$INSTDIR\markdown.ico$\",0'
  WriteRegStr SHCTX "Software\Classes\Applications\md-king.exe\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\Applications\md-king.exe\SupportedTypes" ".md" ""
  WriteRegStr SHCTX "Software\Classes\Applications\md-king.exe\SupportedTypes" ".markdown" ""
  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "md-king.Markdown" ""
  WriteRegStr SHCTX "Software\Classes\.markdown\OpenWithProgids" "md-king.Markdown" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; An older installation must not unregister a newer copy at another path.
  ReadRegStr $0 SHCTX "Software\Classes\md-king.Markdown\shell\open\command" ""
  ${If} $0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
    DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "md-king.Markdown"
    DeleteRegValue SHCTX "Software\Classes\.markdown\OpenWithProgids" "md-king.Markdown"
    DeleteRegKey SHCTX "Software\Classes\md-king.Markdown"
  ${EndIf}
  ReadRegStr $0 SHCTX "Software\Classes\Applications\md-king.exe\shell\open\command" ""
  ${If} $0 == '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
    DeleteRegKey SHCTX "Software\Classes\Applications\md-king.exe"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!endif
