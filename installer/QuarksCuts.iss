; Instalador unificado Quarks Cuts:
;  - Extensão CEP do Premiere (painel Quarks Cuts, com Whisper offline + Gemini)
;  - VoxFlow (app desktop de transcrição/cortes)
; Tela extra pede a chave da API do Gemini (com link p/ gerar) e grava nos configs.
; Compilar: ISCC.exe QuarksCuts.iss  →  gera _dist\QuarksCuts-Setup.exe

#define PanelSrc "C:\Users\laura\quarks_cuts_panel\_dist\QuarksCuts-Equipe-small\clip_assassin"
#define VoxSrc   "C:\Users\laura\.gemini\antigravity\scratch\video_transcriber\backend\dist\QuarksCuts"

[Setup]
AppId={{7A3E9C41-5B2D-4F8A-9E1C-QUARKSCUTS01}
AppName=Quarks Cuts
AppVersion=2.0
AppPublisher=Quarks Produtora
DefaultDirName={autopf}\QuarksCuts
DisableDirPage=yes
DefaultGroupName=Quarks Cuts
OutputDir=C:\Users\laura\quarks_cuts_panel\_dist
OutputBaseFilename=QuarksCuts-Setup
Compression=lzma2/fast
SolidCompression=no
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Messages]
; O Windows não permite fixar na barra de tarefas via instalador — fica a dica manual.
FinishedLabel=A instalação do [name] foi concluída.%n%nPainel: abra o Premiere em Window > Extensions > Quarks Cuts.%nVoxFlow: atalho na Área de Trabalho e no Menu Iniciar.%n%nDica: para fixar o VoxFlow na barra de tarefas, clique com o botão DIREITO no atalho da Área de Trabalho e escolha "Fixar na barra de tarefas".

[Types]
Name: "full"; Description: "Instalação completa (painel do Premiere + VoxFlow)"
Name: "custom"; Description: "Personalizada"; Flags: iscustom

[Components]
Name: "panel"; Description: "Painel Quarks Cuts no Premiere (cortes + legendas por IA)"; Types: full custom; Flags: fixed
Name: "vox"; Description: "VoxFlow — app de transcrição e cortes (fora do Premiere)"; Types: full

[Files]
; ---- Painel CEP (inclui whisper.cpp + ffmpeg + modelo small + preset de áudio) ----
Source: "{#PanelSrc}\*"; DestDir: "{commoncf32}\Adobe\CEP\extensions\quarks_cuts"; \
  Flags: recursesubdirs createallsubdirs ignoreversion; Components: panel
; ---- VoxFlow (LocalAppData: o app grava config.json e uploads\ ao lado do exe) ----
Source: "{#VoxSrc}\*"; DestDir: "{localappdata}\Programs\QuarksCuts"; \
  Flags: recursesubdirs createallsubdirs ignoreversion; Components: vox

[Registry]
; PlayerDebugMode: o Premiere só carrega extensões não assinadas com isso ligado.
Root: HKCU; Subkey: "Software\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Components: panel
Root: HKCU; Subkey: "Software\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Components: panel

[Icons]
Name: "{group}\VoxFlow (Quarks Cuts)"; Filename: "{localappdata}\Programs\QuarksCuts\QuarksCuts.exe"; WorkingDir: "{localappdata}\Programs\QuarksCuts"; Components: vox
Name: "{autodesktop}\VoxFlow (Quarks Cuts)"; Filename: "{localappdata}\Programs\QuarksCuts\QuarksCuts.exe"; WorkingDir: "{localappdata}\Programs\QuarksCuts"; Components: vox; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Criar atalho do VoxFlow na Área de Trabalho"; Components: vox

[Run]
Filename: "{localappdata}\Programs\QuarksCuts\QuarksCuts.exe"; WorkingDir: "{localappdata}\Programs\QuarksCuts"; \
  Description: "Abrir o VoxFlow agora"; Flags: postinstall nowait skipifsilent unchecked; Components: vox

[Code]
var
  KeyPage: TInputQueryWizardPage;

procedure OpenKeyLink(Sender: TObject);
var
  ErrorCode: Integer;
begin
  ShellExecAsOriginalUser('open', 'https://aistudio.google.com/apikey', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
end;

procedure InitializeWizard;
var
  LinkLabel: TNewStaticText;
begin
  KeyPage := CreateInputQueryPage(wpSelectComponents,
    'Chave da API do Gemini',
    'A inteligência dos cortes usa o Google Gemini (grátis).',
    'Cole abaixo a SUA chave da API. Cada pessoa deve usar a própria chave — ' +
    'a cota gratuita é por chave e compartilhar dá erro de limite (429).' + #13#10 + #13#10 +
    'Se ainda não tem, clique no link abaixo para gerar (leva 1 minuto). ' +
    'Você também pode deixar em branco e configurar depois em engine\config.json (painel) ' +
    'ou nas Configurações (VoxFlow).');
  KeyPage.Add('Chave da API do Gemini (opcional):', False);

  LinkLabel := TNewStaticText.Create(KeyPage);
  LinkLabel.Parent := KeyPage.Surface;
  LinkLabel.Top := KeyPage.Edits[0].Top + KeyPage.Edits[0].Height + ScaleY(12);
  LinkLabel.Left := 0;
  LinkLabel.Caption := '🔑 Gerar minha chave grátis: https://aistudio.google.com/apikey';
  LinkLabel.Font.Color := clBlue;
  LinkLabel.Font.Style := [fsUnderline];
  LinkLabel.Cursor := crHand;
  LinkLabel.OnClick := @OpenKeyLink;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Key, CfgPath, Cfg: String;
  CfgAnsi: AnsiString;
begin
  if CurStep <> ssPostInstall then Exit;
  Key := Trim(KeyPage.Values[0]);
  if Key = '' then Exit;

  { Painel: troca o placeholder do engine\config.json pela chave }
  if WizardIsComponentSelected('panel') then
  begin
    CfgPath := ExpandConstant('{commoncf32}\Adobe\CEP\extensions\quarks_cuts\engine\config.json');
    if LoadStringFromFile(CfgPath, CfgAnsi) then
    begin
      Cfg := String(CfgAnsi);
      if StringChangeEx(Cfg, 'COLE_SUA_CHAVE_GEMINI_AQUI', Key, True) > 0 then
        SaveStringToFile(CfgPath, AnsiString(Cfg), False);
    end;
  end;

  { VoxFlow: cria o config.json ao lado do exe com a chave }
  if WizardIsComponentSelected('vox') then
  begin
    CfgPath := ExpandConstant('{localappdata}\Programs\QuarksCuts\config.json');
    Cfg := '{' + #13#10 +
           '  "gemini_api_key": "' + Key + '",' + #13#10 +
           '  "clip_model": "gemini-3.6-flash",' + #13#10 +
           '  "clip_model_fallback": "gemini-3.5-flash-lite"' + #13#10 +
           '}' + #13#10;
    SaveStringToFile(CfgPath, AnsiString(Cfg), False);
  end;
end;
