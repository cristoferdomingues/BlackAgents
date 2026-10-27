; Custom NSIS hooks for the BlackAgents desktop installer.
;
; Two problems are handled here:
;
; 1. The stock electron-builder template decides that "the app is running" by
;    matching every process whose executable lives under $INSTDIR. That also
;    matches helpers shipped in the app directory (and the installer's own
;    uninstaller), so upgrades asked users to close a window that was not open.
;    We only look for the app executable itself and close it for the user.
;
; 2. Packages built from 0.7.x embedded a nested copy of the electron build
;    output (resources\server\dist-electron\win-unpacked\resources\server\...).
;    Some of those paths exceed the Windows MAX_PATH limit, so the old
;    uninstaller cannot delete them. It then exits with an error and the new
;    installer retries for a few seconds before showing the same misleading
;    "BlackAgents cannot be closed" dialog. We delete those leftovers with a
;    long-path aware command before the old version is uninstalled.

!include "LogicLib.nsh"

!define BA_INSTALL_LOG "$TEMP\blackagents-install.log"

!macro BA_LOG _text
  Push $9
  ClearErrors
  FileOpen $9 "${BA_INSTALL_LOG}" a
  ${IfNot} ${Errors}
    FileWrite $9 "${_text}$\r$\n"
    FileClose $9
  ${EndIf}
  Pop $9
!macroend

; !insertmacro REMOVE_LONG_PATH_DIR "$INSTDIR\some\legacy\dir"
!macro REMOVE_LONG_PATH_DIR _dir
  RMDir /r "${_dir}"
  ${If} ${FileExists} "${_dir}\*.*"
    DetailPrint "Removing leftover files from the previous version..."
    nsExec::ExecToLog `"$SYSDIR\cmd.exe" /C rd /s /q "\\?\${_dir}"`
    Pop $R5
    ${If} ${FileExists} "${_dir}\*.*"
      !insertmacro BA_LOG "could not remove legacy directory ${_dir} (rd exit $R5)"
    ${EndIf}
  ${EndIf}
!macroend

; Runs from .onInit after $INSTDIR is known, before the old version is removed.
!macro customInit
  !insertmacro REMOVE_LONG_PATH_DIR "$INSTDIR\resources\server\dist-electron"
!macroend

!macro customCheckAppRunning
  Push $R0
  Push $R2

  StrCpy $R2 0
  ${Do}
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 != 0
      ${ExitDo}
    ${EndIf}

    ${If} $R2 == 0
      DetailPrint "$(appClosing)"
      !insertmacro BA_LOG "closing a running ${APP_EXECUTABLE_FILENAME}"
    ${EndIf}

    nsExec::ExecToLog `"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
    Sleep 500
    IntOp $R2 $R2 + 1
    ${If} $R2 >= 6
      ${ExitDo}
    ${EndIf}
  ${Loop}

  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    !insertmacro BA_LOG "${APP_EXECUTABLE_FILENAME} is still running after 6 kill attempts"
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY
    Quit
  ${EndIf}

  Pop $R2
  Pop $R0
!macroend

; A failed removal of the previous version must not block the upgrade - the new
; files are extracted over the old install right after this check.
!macro customUnInstallCheck
  ${If} $R0 != 0
    !insertmacro BA_LOG "previous uninstaller exited with $R0, continuing with the upgrade"
    DetailPrint "The previous version could not be removed cleanly (code $R0). Continuing."
  ${EndIf}
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro customUnInstallCheck
!macroend
