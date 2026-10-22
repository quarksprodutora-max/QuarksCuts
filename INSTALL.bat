@echo off
echo ========================================
echo   QUARKS CUTS - Instalacao
echo   Os cortes da IA, direto na timeline.
echo ========================================
echo.

REM Verifica direitos de administrador; se nao tiver, pede elevacao do UAC
REM /elevated = ja veio da elevacao, nao pedir de novo
if "%~1" NEQ "/elevated" (
echo Verificando permissoes de administrador...
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo    Sem permissoes de administrador. Pedindo elevacao (UAC)...
    echo    Se aparecer uma janela azul "Deseja permitir...", clique em SIM.
    powershell -NoProfile -Command "Start-Process -FilePath '%~dpnx0' -ArgumentList '/elevated' -Verb RunAs"
    exit /b 0
)
)

echo [1/3] Habilitando modo debug do CEP...
reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKEY_CURRENT_USER\Software\Adobe\CSXS.9"  /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo    OK

echo.
echo [2/3] Preparando instalacao...
set "SOURCE=%~dp0clip_assassin"
set "TARGET=C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\quarks_cuts"
set "CFG_SRC=%TARGET%\engine\config.json"
set "CFG_BAK=%TEMP%\quarks_config_backup_%RANDOM%.json"

if not exist "%SOURCE%" (
    echo    ERRO: pasta clip_assassin nao encontrada!
    pause
    exit /b 1
)

REM === PRESERVA config.json (contem API key, caminhos mogrt/preset) ===
if exist "%CFG_SRC%" (
    echo    Preservando suas configuracoes (config.json)...
    copy /Y "%CFG_SRC%" "%CFG_BAK%" >nul 2>&1
    if exist "%CFG_BAK%" (
        echo    Backup salvo em: %CFG_BAK%
    ) else (
        echo    AVISO: nao foi possivel fazer backup do config.json
    )
) else (
    echo    (primeira instalacao - sem config anterior)
)

echo.
REM === PRESETS EMBUTIDOS (Audio .epr e Legenda .prtextstyle) ===
REM Os presets e estilos sao copiados automaticamente pelo robocopy abaixo.

echo [3/3] Instalando plugin...
REM Testa se temos gravacao na pasta de destino antes de apagar tudo
if exist "%TARGET%" (
    echo teste_gravacao > "%TARGET%\__qc_test.txt" 2>nul
    if not exist "%TARGET%\__qc_test.txt" (
        echo    ERRO: sem permissao de gravacao em:
        echo    %TARGET%
        echo    A instalacao precisa de direitos de administrador.
        echo    Feche este painel e clique DIREITO no INSTALL.bat ^> "Executar como administrador".
        pause
        exit /b 1
    )
    del "%TARGET%\__qc_test.txt" >nul 2>&1
)
if exist "%TARGET%" (
    echo    Removendo versao anterior...
    rmdir /s /q "%TARGET%" >nul 2>&1
)

echo    Copiando arquivos...
REM Copia TUDO, incluindo a pasta engine e bin (necessarios para o funcionamento local)
REM Exclui apenas arquivos de backup temporarios
robocopy "%SOURCE%" "%TARGET%" /E ^
    /XF "*.bak" "*.bak2" "*.bak3" "*.bak4" "*.bak_*" "*.bak_final" "*.bak_pre_*" "*.bak_v*" ^
    /R:0 /W:0 ^
    /NFL /NDL /NJH /NJS /NC /NS /NP >nul

if %errorLevel% GEQ 8 (
    echo    ERRO: falha ao copiar arquivos (codigo %errorLevel%)
    echo    CAUSA PROVAVEL: falta de permissao em Program Files (x86).
    echo    Solucao: feche este painel, clique DIREITO no INSTALL.bat e escolha
    echo    "Executar como administrador". Depois abra o Premiere de novo.
    if exist "%CFG_BAK%" del "%CFG_BAK%" >nul 2>&1
    pause
    exit /b 1
)

REM === RESTAURA config.json preservado ===
if exist "%CFG_BAK%" (
    echo    Restaurando suas configuracoes (API key, mogrt, preset)...
    if not exist "%TARGET%\engine" mkdir "%TARGET%\engine"
    copy /Y "%CFG_BAK%" "%CFG_SRC%" >nul 2>&1
    del "%CFG_BAK%" >nul 2>&1
    echo    Configuracoes restauradas com sucesso!
)

REM === CONFIGURA PRESET PADRAO (16kHz Mono Leve) SE NENHUM FOR DEFINIDO ===
if exist "%TARGET%\engine\config.json" (
    powershell -NoProfile -Command "$c='%TARGET%\engine\config.json';$j=Get-Content $c -Raw -Encoding UTF8|ConvertFrom-Json;if(-not $j.audio_export_preset -or -not (Test-Path $j.audio_export_preset)){$j.audio_export_preset='%TARGET%\presets\Waveform_Audio_16kHz_Mono.epr';$j|ConvertTo-Json -Depth 5|Set-Content $c -Encoding UTF8}" >nul 2>&1
)

echo    Plugin instalado!

echo.
echo Finalizando...
echo.
echo ========================================
echo   INSTALACAO CONCLUIDA!
echo ========================================
echo.
echo Proximos passos:
echo   1. Reinicie o Adobe Premiere Pro
echo   2. Va em: Window ^> Extensions ^> Quarks Cuts
echo.
echo O PRESET DE AUDIO FOI CONFIGURADO AUTOMATICAMENTE.
echo.
echo SUAS CONFIGURACOES FORAM PRESERVADAS:
echo   - API Key do Gemini
echo   - Modelo MOGRT de legenda
echo   - Caminhos do Whisper / FFmpeg
echo.
pause
