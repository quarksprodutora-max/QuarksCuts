# ============================================================
#  QUARKS CUTS - INSTALADOR ALTERNATIVO (PowerShell)
#  Faz o mesmo que o INSTALL.bat, com elevacao automatica via UAC.
#  Executa com duplo clique. Se nao for admin, reexecuta-se elevado.
# ============================================================
$ErrorActionPreference = 'Continue'

# --- Auto-elevacao ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'Pedindo permissoes de administrador (UAC)... Clique em SIM na janela azul.'
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -elevated" -Verb RunAs -Wait
    exit
}

$SOURCE = Join-Path $PSScriptRoot 'clip_assassin'
$TARGET = 'C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\quarks_cuts'

Write-Host '========================================'
Write-Host '  QUARKS CUTS - Instalacao (alternativo)'
Write-Host '========================================'

if (-not (Test-Path $SOURCE)) {
    Write-Host "ERRO: pasta clip_assassin nao encontrada em $PSScriptRoot"
    Read-Host 'Pressione Enter para sair'
    exit 1
}

# --- Debug mode do CEP ---
foreach ($ver in @('CSXS.12','CSXS.11','CSXS.10','CSXS.9')) {
    $regKey = "HKCU:\Software\Adobe\$ver"
    if (-not (Test-Path $regKey)) { New-Item -Path $regKey -Force | Out-Null }
    Set-ItemProperty -Path $regKey -Name 'PlayerDebugMode' -Value '1' -Type String | Out-Null
}
Write-Host '[1/3] Modo debug do CEP habilitado'

# --- Backup do config.json ---
$cfgSrc = Join-Path $TARGET 'engine\config.json'
$cfgBak = Join-Path $env:TEMP "quarks_config_backup_$(Get-Random).json"
if (Test-Path $cfgSrc) {
    Copy-Item $cfgSrc $cfgBak -Force
    Write-Host "[2/3] Backup das suas configuracoes salvo"
} else {
    Write-Host '[2/3] Primeira instalacao (sem config anterior)'
}

# --- Remove versao antiga e copia ---
if (Test-Path $TARGET) {
    Remove-Item $TARGET -Recurse -Force
}
New-Item -ItemType Directory -Path $TARGET -Force | Out-Null

# Exclui bin/ (binarios ficam no repo) e backups .bak*
Get-ChildItem $SOURCE -Recurse | Where-Object {
    $rel = $_.FullName.Substring($SOURCE.Length + 1)
    -not $_.PSIsContainer -or $_.FullName -notlike "$SOURCE\bin*"
} | ForEach-Object {
    if ($_.FullName -like '*\bin\*') { return }          # pula tudo de bin\
    if ($_.FullName -like '*.bak' -or $_.FullName -like '*.bak2' -or $_.FullName -like '*.bak3' -or $_.FullName -like '*.bak4' -or $_.FullName -like '*.bak_*' -or $_.FullName -like '*.bak_final' -or $_.FullName -like '*.bak_pre_*' -or $_.FullName -like '*.bak_v*') { return }
    $dest = $_.FullName.Replace($SOURCE, $TARGET)
    if ($_.PSIsContainer) {
        if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }
    } else {
        Copy-Item $_.FullName $dest -Force
    }
}
Write-Host '    Arquivos copiados para:'
Write-Host "    $TARGET"

# --- Restaura config.json ---
if (Test-Path $cfgBak) {
    $engDir = Join-Path $TARGET 'engine'
    if (-not (Test-Path $engDir)) { New-Item -ItemType Directory -Path $engDir -Force | Out-Null }
    Copy-Item $cfgBak $cfgSrc -Force
    Remove-Item $cfgBak -Force
    Write-Host '[3/3] Suas configuracoes (API key, mogrt, preset) restauradas'
}

Write-Host ''
Write-Host '========================================'
Write-Host '  INSTALACAO CONCLUIDA!'
Write-Host '========================================'
Write-Host 'Proximos passos:'
Write-Host '  1. Reinicie o Adobe Premiere Pro'
Write-Host '  2. Window > Extensions > Quarks Cuts'
Read-Host 'Pressione Enter para sair'
