# Changelog — Quarks Cuts

Registro das mudanças deste fork (Quarks Cuts). Para o histórico do projeto
original (Clip Assassin v1.0/v1.1), veja
[`docs/historico/CHANGELOG-clip-assassin.md`](docs/historico/CHANGELOG-clip-assassin.md).

## [2.0.0] - Godmode, Legendas SupoClip & Acabamentos Automáticos (out/2026)

### 🎬 Legendas Animadas SupoClip na Trilha V2
- **Renderização local ultrarrápida** (~2s) com canal alfa e importação direta para a trilha V2 da timeline ativa.
- **Estilos virais integrados**: Hormozi (amarelo/destaque palavra a palavra), MrBeast (zoom e pop dinâmico), TikTok (fundo escuro e alta legibilidade) e Podcast (minimalista).
- **Alinhamento de frames e pontuação** via `engine/supoclip-animator.js`.

### ⏱️ Automação de Legendas em Lote & `.prtextstyle`
- **Inserção nativa na Timeline**: importa e alinha arquivos `.srt` gerados diretamente nas sequências de corte em `00:00:00:00`.
- **Estilo de Legenda Padrão**: suporte nativo a arquivos `.prtextstyle` (com o preset `Quarks Podcast.prtextstyle` embutido).
- **Processamento em lote**: aplica legendas automaticamente a todas as sequências de um bin/pasta do projeto com 1 clique.

### ✂️ Nova Aba "Acabamentos": Remoção de Respiros & J-Cut
- **Remoção de Respiros e Silêncios**: integração com motor `autocut-engine.jsx` e `audio-analysis.js` para detectar e remover respiros e hesitações na timeline mantendo sincronia de áudio e vídeo.
- **J-Cut Automático**: integração com `autojcut-engine.jsx` para suavizar cortes entre oradores com sobreposição natural de áudio/vídeo.
- **Opção de backup da sequência** antes de aplicar qualquer alteração.

### 🧠 Inteligência Artificial & Seletor Livre de Modelos Gemini
- **Seletor de modelos livre**: permite escolher ou digitar qualquer modelo do Gemini (`gemini-2.5-flash`, `gemini-3.6-flash`, etc.).
- **Montagem dinâmica (2 a 8 partes)**: gera cortes não lineares inteligentes com gancho inicial (cold open hook) e fechamento coerente.
- **Regras de retenção SupoClip**: snap de sentença (início e fim de frase precisos, sem cortar no meio da fala) e 4 pilares de viralidade.
- **Preset de áudio leve Waveform 16kHz Mono**: exportação ~90% menor e muito mais rápida que 48kHz estéreo sem nenhuma perda de acurácia no Whisper.

## [Não lançado]

### 🔧 INSTALL.bat sem travamento (ago/2026)
- **Auto-elevação via UAC**: se o script detectar que não está como administrador,
  relança a si mesmo elevado em vez de falhar em silêncio.
- **robocopy com `/R:0 /W:0`**: sem o loop infinito de tentativas quando há erro
  de acesso negado em `Program Files (x86)` — falha rápido com mensagem clara de
  que o problema é permissão/UAC.
- **Teste de gravação no destino** antes de remover a versão anterior: sem
  permissão, o instalador avisa imediatamente onde clicar ("Executar como
  administrador").

### 🖼️ Emojis/ícones do painel (mojibake no CEP)
- Removidos os variant selectors `U+FE0F` (`&#65039;`/`&#xFE0F;`) que o Chromium
  antigo do CEP exibia como lixo (`âš™`, `ðŸŽ¬`); entidades de emoji trocadas por
  emoji direto sem selector.

### 🎯 Correções da auditoria do plug-in (ago/2026)
- **Prompt de cortes mais confiável**: o modelo agora analisa os pontos fortes do
  chunk ANTES de escolher os cortes (campo `analise` no JSON), informa a duração
  de cada segmento e o total (`duracao_total_s`) — e o painel valida a faixa de
  duração pedida (folga de 80%-120%) descartando cortes fora dela.
- **Loop aberto-fechado**: corte com gancho deslocado agora PRECISA retornar ao
  gancho no final; sem material para fechar o loop, o modelo usa corte
  cronológico. Corte incoerente é pior que corte sem gancho.
- **Regra do reuso integral**: quando um trecho é puxado do meio do episódio
  para o começo do corte, a fala completa dele DEVE reaparecer também na posição
  original (com contexto antes e depois) — o gancho nunca rouba a fala do seu
  lugar, garantindo nexo total do corte.
- **Variedade**: instrução para não repetir o mesmo trecho forte como gancho de
  cortes diferentes e alternar assuntos entre cortes do mesmo lote.
- **Deduplicação entre chunks**: cortes quase idênticos entre chunks vizinhos
  (sobreposição Jaccard ≥ 0.6) viram um só, mantendo o de melhor nota de hook.
- **Podcast editado com meta de faixa**: meta de duração vira faixa alvo ±5min,
  com regras "NUNCA CORTE" (abertura, perguntas estruturantes, insights-chave) e
  anti-sobrecorte — preferível passar um pouco da meta a quebrar a entrevista.
- **Bug de prompts de hook corrigido**: estilos Joel Jota e Diary of a CEO usavam
  `\\n` literal (chegava ao Gemini como "\n" em vez de quebra de linha); agora as
  quebras são reais.
- **INSTALL.sh corrigido**: instalava em `clip_assassin` (nome do projeto
  original) em vez de `quarks_cuts`.
- **Installação portátil**: `engine/config.json` não precisa mais de caminhos
  absolutos da máquina de desenvolvimento — binários em branco caem no bundle
  `bin/` da extensão (o `INSTALL.bat` preserva esse config nas reinstalações).
- **`extractChapters` exportado**: extraía capítulos do dossiê de marketing na
  UI, mas o módulo não exportava a função (capítulos/capitulos_youtube.txt não
  funcionavam).
- **Models estáveis**: alias `gemini-flash-latest` trocado por `gemini-3.6-flash`
  e fallback por `gemini-3.5-flash-lite` (o `3.1 flash-lite` foi descontinuado).
  Atualizado também no `config.example.json` e no instalador (.iss).
- **`srt.js`**: removida a definição duplicada de `buildCutSrt` (a segunda
  sobrescrevia a primeira silenciosamente).

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
