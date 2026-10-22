# Melhorias Consolidadas - Quarks Cuts v2.0

Este projeto foi atualizado para ser mais robusto, inteligente e automatizado para produção de podcasts e vídeos curtos no Adobe Premiere Pro.

---

## 1. Legendas Animadas SupoClip na Trilha V2
- **Renderização Ultra-Rápida:** Cria sobreposições de legenda animadas com canal alfa (ProRes 4444) em ~2 segundos.
- **Inserção Direta:** Importa automaticamente o vídeo transparente gerado e o insere na trilha **V2** da timeline ativa do Premiere, sincronizado ao milésimo de segundo.
- **Estilos Virais Integrados:**
  - **Hormozi:** Palavra ativa em amarelo vibrante, fundo preto de alto contraste e transição dinâmica.
  - **MrBeast:** Zoom punch, destaque em azul/amarelo e máxima retenção.
  - **TikTok:** Minimalista com destaque suave em ciano.
  - **Podcast:** Limpo, elegante e direto ao ponto.

## 2. Inserção de Legendas em Lote + `.prtextstyle`
- **Inserção Direta na Timeline:** Cria a trilha de legenda nativa a partir do `.srt` em timecode absoluto `00:00:00:00`.
- **Estilo Nativo:** Suporte a arquivos `.prtextstyle` (já incluso o `Quarks Podcast.prtextstyle` na pasta `presets`).
- **Processamento em Lote:** Selecione uma pasta (bin) de sequências e legende dezenas de cortes com 1 clique.

## 3. Nova Aba "Acabamentos": Remoção de Respiros & J-Cut
- **Remover Respiros / Silêncios:** Analisa a forma de onda do áudio (dBFS) e remove pausas e respiros automaticamente na timeline sem dessincronizar áudio e vídeo.
- **J-Cut Automático:** Realiza corte em L e J para transições fluidas e naturais entre interlocutores.
- **Backup de Segurança:** Cria uma cópia duplicada da sequência antes de aplicar modificações.

## 4. Seletor Livre de Modelos Gemini & Regras Virais SupoClip
- **Modelos Flexíveis:** Permite alternar entre `gemini-2.5-flash`, `gemini-3.6-flash`, ou digitar qualquer versão mais recente da Google AI.
- **Montagem Dinâmica (2 a 8 Partes):** Identifica os momentos mais impactantes do episódio e os reorganiza com um gancho inicial (cold open hook) e fechamento do loop narrativo.
- **Snap de Sentença:** Cortes respeitam estritamente a pontuação natural da fala (nunca cortam frases pela metade).

## 5. Preset de Áudio Leve (16 kHz Mono)
- **Exportação 90% Menor:** Novo preset embutido (`presets/Waveform_Audio_16kHz_Mono.epr`) que acelera drasticamente a exportação de áudio no Media Encoder sem nenhuma perda de qualidade para o Whisper.

## 6. Instalador Inteligente (`INSTALL.bat` e `INSTALL-ALTERNATIVO.ps1`)
- **Elevação Automática via UAC:** Pede permissão de administrador automaticamente se necessário.
- **Preservação de Dados:** Mantém intactos a sua chave de API do Gemini e caminhos personalizados em `config.json`.
- **Presets Integrados:** Copia automaticamente os arquivos `.epr` e `.prtextstyle` para a pasta de extensões do Premiere.
