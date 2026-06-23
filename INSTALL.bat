@echo off
echo ========================================
echo   QUARKS CUTS - Instalacao
echo   Os cortes da IA, direto na timeline.
echo ========================================
echo.

REM Check for administrator rights
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator!
    echo Right-click INSTALL.bat and select "Run as administrator"
    echo.
    pause
    exit /b 1
)

echo [1/3] Setting up PlayerDebugMode...
reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
if %errorLevel% equ 0 (
    echo    Done - Debug mode enabled
) else (
    echo    WARNING - Could not set registry key
)

echo.
echo [2/3] Installing plugin...
set "SOURCE=%~dp0clip_assassin"
set "TARGET=C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\quarks_cuts"

if not exist "%SOURCE%" (
    echo    ERROR - clip_assassin folder not found!
    pause
    exit /b 1
)

if exist "%TARGET%" (
    echo    Removing old version...
    rmdir /s /q "%TARGET%" >nul 2>&1
)

echo    Copying files...
REM Exclui a pasta bin\ (binarios grandes do Whisper/ffmpeg, ~GBs). O engine usa
REM caminhos absolutos do config.json, entao nao precisa copiar bin\ para o Program Files.
robocopy "%SOURCE%" "%TARGET%" /E /XD "%SOURCE%\bin" /NFL /NDL /NJH /NJS /NC /NS /NP >nul
if %errorLevel% GEQ 8 (
    echo    ERROR - Failed to copy files
    pause
    exit /b 1
)
echo    Done - Plugin installed

echo.
echo [3/3] Finalizing installation...
echo    Done
echo.
echo ========================================
echo   INSTALLATION COMPLETE!
echo ========================================
echo.
echo Proximos passos:
echo   1. Reinicie o Adobe Premiere Pro
echo   2. Va em: Window - Extensions - Quarks Cuts
echo   3. Importe o video do podcast e carregue o clips.json!
echo.
pause
