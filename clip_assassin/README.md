# Quarks Cuts — atualização do painel CEP

## Instalar a atualização

1. Feche o Premiere. Faça uma cópia da pasta da extensão instalada.
2. Extraia `dist/quarks-cuts-update.zip` sobre a pasta existente do Quarks Cuts, mantendo `bin/`, seus modelos, MOGRTs e configurações locais. O ZIP não contém credenciais nem sobrescreve `engine/config.json`.
3. Abra o Premiere novamente: é necessário recarregar também os scripts JSX, não apenas a aparência do painel.
4. Em **Configurações**, confira a chave Gemini e os caminhos dos recursos. Instalações antigas migram a chave para `%LOCALAPPDATA%\QuarksCuts\config.json` quando possível. Em macOS usa `~/Library/Application Support/QuarksCuts`; em Linux usa `$XDG_CONFIG_HOME/QuarksCuts` ou `~/.config/QuarksCuts`.

O pacote atualiza código. Não inclui FFmpeg, Whisper/faster-whisper, modelos de transcrição nem um template MOGRT. Preserve os recursos já instalados. Em uma instalação nova, configure os executáveis/modelos antes de transcrever. O FFmpeg usado pela legenda animada precisa do filtro `ass` (libass).

## Legendas CapCut

Abra uma sequência com áudio e clique em **Legendas CapCut**. O editor usa a transcrição da sequência e do modelo selecionados. Se não houver cache atual, transcreve primeiro. Não precisa de Gemini para abrir ou editar essas legendas.

- **Enter:** divide a legenda, usando o tempo da palavra quando o texto ainda corresponde à transcrição; para texto reescrito, o tempo é estimado proporcionalmente. Enter nas bordas não cria cartões vazios.
- **Backspace** no começo: une com a anterior.
- **Salvar SRT:** preserva as edições em arquivo e importa para o projeto.
- **Inserir SRT na timeline:** cria legendas nativas sem precisar de um MOGRT.
- **Aplicar MOGRTs:** requer um template com campo de texto editável. Falhas parciais são informadas e o editor permanece aberto.

Se a timeline mudar após abrir o editor, salve o SRT antes de reabrir. A aplicação em uma sequência diferente é bloqueada. Legendas nativas SRT não têm animação palavra a palavra; para isso use o fluxo separado **Gerar Legenda Animada**, ou um MOGRT adequado.

## Correções

- Os modais são criados antes de registrar os eventos: a falha que interrompia a inicialização do CapCut e dos acabamentos foi removida.
- Cache identifica projeto, sequência, clipes, tempos, mídia, mutes, sequências aninhadas e parâmetros/keyframes expostos pelo Premiere. Modelo/idioma fazem parte da identificação da transcrição. Efeitos de terceiros não expostos pelo DOM podem exigir **Limpar cache**.
- Silêncio e J-Cut exigem confirmação de backup quando habilitado. Erros interrompem etapas seguintes. A reconstrução manual incompleta não é aceita como backup.
- **Desfazer** abre uma sequência restaurada a partir do backup e preserva a edição anterior; não apaga outra sequência ativa nem altera referências existentes em nests.
- Overlays usam o tamanho e FPS reais da sequência, FFmpeg configurado, argumentos sem shell e processamento de alpha. A inserção usa uma trilha nova, sem sobrescrever V1/V2.
- MCP anuncia ferramentas com schemas, aceita notificações, aguarda ações assíncronas, verifica erros e serializa operações. Endpoint local autenticado `/mcp`, transporte HTTP JSON, protocolo 2025-03-26. GET/SSE não implementado (405).

## Verificação

```sh
node tests/editorial-engine.test.js
node tests/reliability.test.js
python3 scripts/package-extension.py
```

Os testes usam respostas e objetos controlados: verificam inicialização progressiva do DOM, abertura do editor, tempos de legenda, cache, falhas de backup/edição, ponte com JSX e requisições MCP. Não usam a chave Gemini nem abrem o Premiere.

Validação final no Premiere: abrir CapCut, dividir/unir uma legenda, inserir SRT, conferir um MOGRT, renderizar um overlay curto e testar silêncio/J-Cut em uma cópia da sequência. O ambiente de desenvolvimento desta revisão não dispõe de Premiere ou FFmpeg para validar a aparência renderizada.

Referências: [exemplos CEP da Adobe](https://github.com/Adobe-CEP/Samples/tree/master/PProPanel), [filtros FFmpeg](https://ffmpeg.org/ffmpeg-filters.html#subtitles-1), [transporte MCP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports).
