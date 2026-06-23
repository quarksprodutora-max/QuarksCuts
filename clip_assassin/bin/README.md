# bin/ — binários do fluxo "⚡ Gerar cortes"

Esta pasta guarda os executáveis offline usados pelo botão **⚡ Gerar cortes**
(transcrição local + corte por IA). Eles **não** vão no Git (são grandes) — baixe
e coloque aqui manualmente. Se preferir, aponte caminhos absolutos em
`../engine/config.json` (`whisper_cli_path`, `whisper_model`, `ffmpeg_path`).

## Arquivos esperados

1. **`whisper-cli.exe`** (+ as DLLs ao lado)
   - Do projeto whisper.cpp (builds prontos para Windows):
     https://github.com/ggml-org/whisper.cpp/releases
   - Baixe o pacote Windows (ex.: `whisper-bin-x64.zip`) e copie `whisper-cli.exe`
     e todas as `.dll` que vierem junto para esta pasta.
   - (Em builds antigos o executável se chamava `main.exe` — renomeie para `whisper-cli.exe`
     ou ajuste `whisper_cli_path` no config.)

2. **`ggml-small.bin`** (modelo)
   - Modelos ggml: https://huggingface.co/ggerganov/whisper.cpp/tree/main
   - Sugestão inicial: `ggml-small.bin` (~466 MB, bom para PT-BR).
   - Para mais qualidade: `ggml-medium.bin` (~1.5 GB) ou um quantizado `q5`.
   - Se usar outro nome, ajuste `whisper_model` em `../engine/config.json`.

3. **`ffmpeg.exe`**
   - Build estático para Windows: https://www.gyan.dev/ffmpeg/builds/ (ou ffmpeg.org).
   - Copie apenas o `ffmpeg.exe` para esta pasta.
   - Usado para extrair WAV 16 kHz mono (formato que o whisper.cpp exige).

## Conferência rápida (PowerShell)
```
.\whisper-cli.exe --help
.\ffmpeg.exe -version
```

Depois preencha a `gemini_api_key` em `../engine/config.json` e rode o `INSTALL.bat`.
