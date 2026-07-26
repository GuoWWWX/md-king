@echo off
REM Wrapper that makes `cargo` work reliably on Windows.
REM
REM It works around two local environment problems:
REM   1. Git for Windows ships usr\bin\link.exe, which shadows the MSVC linker on
REM      PATH and makes rustc fail with confusing "extra operand" errors.
REM   2. When Visual Studio and the Windows SDK live on different drives, the LIB
REM      that vcvars64.bat sets up can miss the SDK's um\x64 directory (where
REM      kernel32.lib lives), producing LNK1181 at link time.
REM
REM Usage: scripts\cargo-msvc.bat check --manifest-path src-tauri\Cargo.toml
setlocal

REM Git Bash cannot pass environment variables whose name contains parentheses,
REM so %ProgramFiles(x86)% is empty when this script is invoked via `cmd //c`.
REM Derive the path from %SystemDrive% instead.
set "PF86=%SystemDrive%\Program Files (x86)"

REM Optional per-machine overrides (gitignored). Create scripts\cargo-msvc.local.bat
REM and `set MDKING_VS_ROOT=...` there if your toolchain lives somewhere unusual.
if exist "%~dp0cargo-msvc.local.bat" call "%~dp0cargo-msvc.local.bat"

REM --- Locate Visual Studio ---
set "VSWHERE=%PF86%\Microsoft Visual Studio\Installer\vswhere.exe"
REM --- Locate a Visual Studio install that actually ships the MSVC toolchain ---
REM Set MDKING_VS_ROOT yourself if your Visual Studio is not registered with
REM vswhere (e.g. a portable / relocated install). Otherwise every install
REM vswhere knows about is probed in turn, because the newest one is not
REM necessarily the one that has VC\Tools\MSVC.
REM The probe runs as a subroutine because plain `if not defined` inside a for body
REM would read the value captured when the block was entered, not the updated one.
set "VS_ROOT="
set "MSVC_VER="
if defined MDKING_VS_ROOT call :probe_msvc "%MDKING_VS_ROOT%"
if not defined MSVC_VER (
  if exist "%VSWHERE%" (
    for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -products * -property installationPath`) do call :probe_msvc "%%i"
  )
)
if not defined MSVC_VER (
  echo [cargo-msvc] No Visual Studio install with an MSVC toolchain was found.
  echo [cargo-msvc] Set MDKING_VS_ROOT to your Visual Studio root, e.g.
  echo [cargo-msvc]   set MDKING_VS_ROOT=D:\Tools\Visual Studio
  exit /b 1
)

call "%VS_ROOT%\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
set "MSVC_ROOT=%VS_ROOT%\VC\Tools\MSVC\%MSVC_VER%"

REM --- Locate a Windows SDK that actually ships kernel32.lib ---
REM Override with MDKING_SDK_ROOT if your SDK is not in the default location.
if defined MDKING_SDK_ROOT (
  set "SDK_ROOT=%MDKING_SDK_ROOT%"
) else (
  set "SDK_ROOT=%PF86%\Windows Kits\10"
)
set "SDK_VER="
for /f "usebackq tokens=*" %%v in (`dir /b /ad /o-n "%SDK_ROOT%\Lib" 2^>nul`) do call :probe_sdk "%%v"
if not defined SDK_VER (
  echo [cargo-msvc] No Windows SDK with kernel32.lib found under the Windows Kits Lib directory.
  echo [cargo-msvc] Set MDKING_SDK_ROOT if your SDK lives elsewhere.
  exit /b 1
)

REM --- Put the MSVC linker first, then fill in LIB / INCLUDE ---
set "PATH=%MSVC_ROOT%\bin\HostX64\x64;%SDK_ROOT%\bin\%SDK_VER%\x64;%PATH%"
set "LIB=%MSVC_ROOT%\lib\x64;%SDK_ROOT%\Lib\%SDK_VER%\ucrt\x64;%SDK_ROOT%\Lib\%SDK_VER%\um\x64"
set "INCLUDE=%MSVC_ROOT%\include;%SDK_ROOT%\Include\%SDK_VER%\ucrt;%SDK_ROOT%\Include\%SDK_VER%\um;%SDK_ROOT%\Include\%SDK_VER%\shared;%SDK_ROOT%\Include\%SDK_VER%\winrt"

cd /d "%~dp0.."
cargo %*
exit /b %ERRORLEVEL%

REM --- Subroutines ---

:probe_msvc
if defined MSVC_VER exit /b 0
for /f "usebackq tokens=*" %%v in (`dir /b /ad /o-n "%~1\VC\Tools\MSVC" 2^>nul`) do (
  if not defined MSVC_VER (
    set "VS_ROOT=%~1"
    set "MSVC_VER=%%v"
  )
)
exit /b 0

:probe_sdk
if defined SDK_VER exit /b 0
if exist "%SDK_ROOT%\Lib\%~1\um\x64\kernel32.lib" set "SDK_VER=%~1"
exit /b 0
