# Quarks Cuts — painel do Premiere - Cortes para podcast

> Os cortes da IA, direto na timeline do Premiere — na ordem certa (gancho primeiro).

Extensão CEP para o Premiere Pro que faz **todo o fluxo de cortes dentro do Premiere**:
transcreve o áudio com **Whisper offline**, deixa o **Gemini** escolher os cortes e cria
**uma sequência por corte** — sem depender de app externo. Também gera **legendas .srt**
e desaninha (unnest) sequências.

Fork de [Clip Assassin](https://github.com/Uhlovic/Clip_Assassin) (a base de criar
sequências a partir de tempos vem dele).

## Recursos
- **⚡ Gerar cortes** — exporta o áudio da sequência ativa → Whisper transcreve offline →
  Gemini seleciona os cortes (gancho primeiro) → uma sequência por corte na bin `cortes`.
- **💬 Gerar legenda** — transcreve um corte e gera um `.srt` com **linhas curtas quebradas
  na pontuação** (≤20 chars), com gramática/acentuação corrigidas pelo Gemini. Salva na
  pasta `legendas` e importa na bin.
- **🪺 Desaninhar (unnest)** — transforma a sequência aninhada nos clipes originais.
- **📂 Carregar clips.json** — ainda funciona, caso você já tenha o `clips.json`.
- Opções: **qualidade** do Whisper, **quantidade** e **duração** dos cortes, **formato
  9:16 / 16:9**.

## Instalação
1. Feche o Premiere.
2. Botão direito em `INSTALL.bat` → **Executar como administrador**
   (ativa o PlayerDebugMode do CSXS e copia a extensão para a pasta CEP).
3. Abra o Premiere → **Window → Extensions → Quarks Cuts**.

> A versão para a equipe (pasta `_dist/`, fora do Git) já vem **autocontida** com
> `whisper.cpp`, modelo e `ffmpeg` — não precisa instalar Python nem baixar nada.

## Configuração (chave do Gemini)
Cada pessoa usa a **própria** chave (a cota gratuita é **por chave**; compartilhar dá
erro 429). Crie a sua grátis em <https://aistudio.google.com/apikey> e cole em
`clip_assassin/engine/config.json` (use o `config.example.json` como base):

```json
{
  "gemini_api_key": "SUA_CHAVE_AQUI",
  "clip_model": "gemini-flash-latest",
  "clip_model_fallback": "gemini-flash-lite-latest",
  "whisper_model": "ggml-small.bin"
}
```
> Ao criar a chave, use a **"Generative Language API"** (não "Gemini for Google Cloud"
> nem "Cloud Assist"). O ideal é gerar pelo AI Studio e deixar **sem restrição de API**.

## Como usar
**Gerar cortes:** abra a **sequência** do episódio na timeline → **⚡ Gerar cortes da
sequência ativa**. Acompanhe: exporta áudio → transcreve (offline) → Gemini → monta as
sequências na bin `cortes`. Cada corte fica aninhado; use **🪺 Desaninhar** se quiser os
clipes originais.

**Gerar legenda:** abra um **corte** na timeline → **💬 Gerar legenda da sequência ativa**.
Gera o `.srt` na pasta `legendas` (e importa na bin). Arraste na faixa de legenda do corte.

## Binários (não versionados)
Os executáveis e modelos ficam em `clip_assassin/bin/` (fora do Git — ver
`clip_assassin/bin/README.md`):
- **whisper.cpp** (`whisper-cli.exe` + DLLs) — <https://github.com/ggml-org/whisper.cpp/releases>
- **modelo ggml** (`ggml-small.bin`, `medium`, `large-v3`) — <https://huggingface.co/ggerganov/whisper.cpp/tree/main>
- **ffmpeg.exe** — <https://www.gyan.dev/ffmpeg/builds/>

## Notas técnicas
- O painel roda **Node.js** (manifest com `--enable-nodejs --mixed-context`).
- A chamada do Gemini sai por **`curl.exe`** (processo separado) com fallback `https`/IPv4 —
  assim funciona mesmo quando o `Premiere.exe` está bloqueado no firewall.
- Whisper precisa de WAV 16 kHz mono → o `ffmpeg` faz essa conversão antes.
- Os recursos de IA (⚡ Gerar cortes, 💬 Gerar legenda) são **Windows-only** (binários
  `.exe` e chamada a `curl.exe` do sistema).

## Documentação
- [`CHANGELOG.md`](CHANGELOG.md) — mudanças deste fork (Quarks Cuts).
- [`docs/MACOS_NOTES.md`](docs/MACOS_NOTES.md) — instalação no macOS (guia do projeto
  original; recursos de IA não funcionam lá — ver aviso no topo do arquivo).
- [`docs/historico/`](docs/historico/) — changelog e release notes do **Clip Assassin**
  original (upstream), anteriores a este fork.

## Créditos e licença
Projeto da **Quarks Produtora**, licença **MIT** — use, modifique e melhore à vontade
(pull requests são bem-vindos!). Construído sobre ombros de gigantes:

- **[Clip Assassin](https://github.com/Uhlovic/Clip_Assassin)** (Uhlovic, MIT) — a base
  original de criação de sequências a partir de faixas de tempo, ponto de partida deste fork.
- **[Claude Code](https://claude.com/claude-code)** (Anthropic) — parceiro de
  desenvolvimento deste projeto: arquitetura, código do pipeline de IA (transcrição,
  cortes, legendas, MOGRT), instalador e depuração foram construídos em sessões de
  programação em dupla com o Claude.
- **[whisper.cpp](https://github.com/ggml-org/whisper.cpp)** (Georgi Gerganov) —
  transcrição offline.
- **[FFmpeg](https://ffmpeg.org)** — extração/conversão de áudio.
- **Google Gemini** — seleção de cortes, correção e tradução de legendas.
- **[auto-legenda](https://github.com/EriclesCalvt/auto-legenda)** (EriclesCalvt) —
  referência da técnica de preenchimento de texto em MOGRTs via ExtendScript.
