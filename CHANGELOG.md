# Changelog — Quarks Cuts

Registro das mudanças deste fork (Quarks Cuts). Para o histórico do projeto
original (Clip Assassin v1.0/v1.1), veja
[`docs/historico/CHANGELOG-clip-assassin.md`](docs/historico/CHANGELOG-clip-assassin.md).

## [Não lançado]

### 🧠 Qualidade dos cortes e transcrição (aprendizados do VoxFlow)
- **Filtro anti-alucinação do Whisper** (portado do `transcriber.py` do VoxFlow e
  adaptado ao nível de palavra do whisper.cpp): remove anotações de não-fala
  ("[Música]", "♪") e colapsa loops de palavra/frase ("obrigado obrigado
  obrigado…"), que sujavam cortes e legendas em trechos de música/silêncio.
- **Chunking para episódios longos**: transcrições grandes agora são analisadas
  pelo Gemini em partes com sobreposição (como o clipper.py do VoxFlow) — evita
  resposta truncada e cortes perdidos em podcasts de 2h+.
- **Recuperação de JSON truncado**: se o Gemini cortar a resposta no meio, os
  cortes completos são resgatados em vez de descartar o lote inteiro.
- **Avaliação de viralidade**: cada corte volta com nota de gancho e potencial
  viral; o painel grava um `relatorio-cortes.txt` na pasta do projeto.

### 🗄️ Cache e limpeza (evita reprocessamento)
- **Cache persistente por sequência** (`%LOCALAPPDATA%\QuarksCuts\cache\`): o áudio
  exportado e a transcrição do Whisper agora são guardados em disco, associados à
  sequência. Trocar só a **qualidade do Whisper** não reexporta o áudio (a etapa
  mais lenta em arquivos grandes) — só roda o Whisper de novo. Trocar só
  **quantidade/duração dos cortes** (mesmo modelo) reaproveita até a transcrição e
  vai direto pro Gemini.
- **🧹 Limpar cache** — novo botão que apaga a pasta de cache inteira (todas as
  sequências) e também sobras antigas de `.wav` no TEMP.
- **Correção de vazamento de disco**: identificados `.wav` órfãos no TEMP (~2,3 GB
  em processamentos de dias atrás, nunca limpos — causa provável da "duplicação"
  percebida em arquivos grandes) quando o processamento não terminava normalmente
  (Premiere fechado/travado no meio de um export longo). Agora: (1) o áudio
  exportado vai direto pra pasta de cache persistente em vez de TEMP, eliminando
  essa classe de vazamento; (2) uma varredura automática no carregamento do painel
  remove `.wav` órfãos com mais de 3h no TEMP, como rede de segurança.

### 🎉 Novidades
- **⚡ Gerar cortes** — pipeline completo dentro do Premiere: exporta o áudio da
  sequência ativa, transcreve offline com **Whisper (whisper.cpp)** e o **Gemini**
  escolhe os cortes (gancho primeiro); cria uma sequência por corte na bin `cortes`.
  Substitui a dependência do app externo VoxFlow para esse fluxo.
- **💬 Gerar legenda** — transcreve um corte já montado e gera um `.srt` com linhas
  curtas, **quebrando na pontuação** (vírgula/ponto → nova legenda), corrigido
  (gramática/acentuação) pelo Gemini. Salva em `legendas/` e importa na bin.
- **🪺 Desaninhar (unnest)** — reconstrói os clipes originais a partir de uma
  sequência aninhada na timeline ativa (a API do Premiere não tem unnest nativo;
  feito remapeando o clipe-nest à sequência-fonte e reinserindo o conteúdo).
- Controles: **qualidade** do Whisper (small/medium/large), **quantidade** e
  **duração** dos cortes, **formato do quadro** (9:16 / 16:9 / igual à fonte).
- Layout novo (cards, logo Quarks); removido o antigo "Modo manual"
  (RUN THE BLADES / REVERSE BLADES / Test Connection) da interface.

### 🛠️ Robustez de rede (Gemini)
- Chamada ao Gemini agora sai por **`curl.exe`** (processo separado do Windows) em
  vez do módulo `https` do Node — em algumas máquinas o firewall/antivírus bloqueia
  o `Premiere.exe` de acessar a rede, o que derrubava a chamada de dentro do
  processo do Premiere. Fallback automático para `https`/IPv4 se o curl faltar.
- Retentativas com backoff maior (até 6 tentativas) e respeito ao tempo de espera
  sugerido pela API (`retry in Xs`) em erros 429/500/503.
- Fallback de modelo (`gemini-flash-latest` → `gemini-flash-lite-latest`) quando o
  principal está sobrecarregado.
- Mensagem de erro específica para cota excedida (429): cada pessoa deve usar a
  própria chave gratuita do Gemini — chave compartilhada estoura o limite (~20
  requisições/min) quando várias pessoas usam ao mesmo tempo.

### 📋 Técnico
- Node.js habilitado no manifest da extensão (`--enable-nodejs --mixed-context`).
- Novos módulos: `engine/transcribe.js` (ffmpeg + whisper.cpp), `engine/gemini-cortes.js`
  (seleção de cortes e correção de legenda), `engine/srt.js` (montagem/agrupamento de `.srt`).
- Documentação reorganizada: notas específicas de macOS e materiais do fork original
  movidos para `docs/` (ver [`README.md`](README.md)).

---

## Histórico anterior a este fork

Ver [`docs/historico/CHANGELOG-clip-assassin.md`](docs/historico/CHANGELOG-clip-assassin.md)
para as versões 1.0 e 1.1 do Clip Assassin original (timecode com frames, detecção
automática de framerate, modo REVERSE BLADES).
