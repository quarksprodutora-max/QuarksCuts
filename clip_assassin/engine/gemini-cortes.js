// Seleção de cortes via Gemini (Google), dentro do painel CEP.
// Recebe os segmentos transcritos (com timestamps em segundos) e devolve o
// schema que o painel já entende: { clips: [ { titulo, segmentos:[{inicio,fim}] } ] }.
//
// Usa o módulo `https` do Node (não `fetch`) para evitar indisponibilidade de
// fetch e problemas de CORS no runtime do CEP. Reaproveita o padrão de retentativa
// e o header X-goog-api-key do curadoria/gemini.js.

const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { qcLog } = require('./log.js');

// curl.exe nativo do Windows (10/11). Roda como PROCESSO SEPARADO, então passa
// pelo firewall mesmo quando o Premiere.exe está bloqueado de acessar a internet
// por firewall/antivírus. É o mesmo motivo de ffmpeg/whisper funcionarem.
const CURL = (process.env.SystemRoot || 'C:\\Windows') + '\\System32\\curl.exe';

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}

const MAX_TRIES = 6; // por modelo

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
// backoff crescente com teto e jitter: ~4s,8s,12s,16s,20s
function delay(tries) { return Math.min(tries * 4000, 20000) + Math.floor(Math.random() * 1500); }

// Requisição via curl.exe (processo separado → passa pelo firewall do Premiere).
// Resolve { status, body }. Rejeita com .code='ENOENT' se não houver curl.
function curlRequest(model, apiKey, payload) {
  return new Promise((resolve, reject) => {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent';
    const args = ['-sS', '--ipv4', '--max-time', '120', '-X', 'POST', url,
      '-H', 'Content-Type: application/json', '-H', 'X-goog-api-key: ' + apiKey,
      '--data-binary', '@-', '-w', '\n%{http_code}'];
    const cp = spawn(CURL, args, { windowsHide: true });
    let out = '', err = '';
    cp.stdout.on('data', (d) => (out += d));
    cp.stderr.on('data', (d) => (err += d));
    cp.on('error', (e) => reject(e)); // ENOENT se curl ausente
    cp.on('close', () => {
      const i = out.lastIndexOf('\n');
      const status = parseInt(out.slice(i + 1).trim(), 10);
      if (!status) { reject(new Error('curl falhou: ' + (err || 'sem resposta').slice(0, 200))); return; }
      resolve({ status: status, body: out.slice(0, i) });
    });
    try { cp.stdin.on('error', () => {}); cp.stdin.write(payload); cp.stdin.end(); } catch (e) {}
  });
}

// Fallback: módulo https do Node (IPv4 forçado). Resolve { status, body }.
function httpsRequest(model, apiKey, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: '/v1beta/models/' + model + ':generateContent',
      method: 'POST', family: 4,
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey, 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = ''; res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

// Escolhe o transporte: curl (passa pelo firewall); se não houver curl, usa https.
async function doRequest(model, apiKey, payload) {
  try { return await curlRequest(model, apiKey, payload); }
  catch (e) { if (e && e.code === 'ENOENT') return await httpsRequest(model, apiKey, payload); throw e; }
}

// POST JSON para UM modelo do Gemini, com retentativas em 429/500/503.
function postGemini(model, apiKey, bodyObj) {
  const payload = JSON.stringify(bodyObj);
  async function attempt(tries) {
    let res;
    try {
      res = await doRequest(model, apiKey, payload);
    } catch (e) {
      if (tries < MAX_TRIES) { await wait(delay(tries)); return attempt(tries + 1); }
      const code = e && e.code;
      if (code === 'EACCES' || code === 'ENETUNREACH' || code === 'ECONNREFUSED') {
        throw new Error('Sem acesso à internet para o Gemini (' + code + '). Firewall/antivírus pode estar bloqueando, ou a rede.');
      }
      throw new Error('Falha de rede ao chamar o Gemini: ' + (e && e.message ? e.message : e));
    }
    if (res.status >= 200 && res.status < 300) {
      qcLog('gemini', model + ' HTTP ' + res.status + ' (tentativa ' + tries + ')');
      return res.body;
    }
    qcLog('gemini', model + ' HTTP ' + res.status + ' (tentativa ' + tries + '): ' + String(res.body).slice(0, 150));
    if ([429, 500, 503].indexOf(res.status) !== -1 && tries < MAX_TRIES) {
      const m = /retry in (\d+(?:\.\d+)?)s/i.exec(res.body);
      const w = m ? Math.min(parseFloat(m[1]) * 1000 + 800, 60000) : delay(tries);
      await wait(w);
      return attempt(tries + 1);
    }
    if (res.status === 429) {
      throw new Error('Limite da chave do Gemini atingido (cota do plano gratuito). ' +
        'Use uma chave PRÓPRIA (cada pessoa a sua, grátis em aistudio.google.com/apikey) ' +
        'ou ative billing. Não compartilhem a mesma chave.');
    }
    throw new Error('Gemini erro ' + res.status + ': ' + String(res.body).slice(0, 300));
  }
  return attempt(1);
}

// Tenta uma lista de modelos em ordem. Se o 1o esgotar as retentativas (ex.: 503
// persistente por sobrecarga), cai para o próximo (ex.: flash-lite).
async function callGemini(models, apiKey, bodyObj) {
  let lastErr = null;
  for (let i = 0; i < models.length; i++) {
    try {
      return await postGemini(models[i], apiKey, bodyObj);
    } catch (e) {
      lastErr = e;
      // só vale a pena trocar de modelo em erro de disponibilidade/limite
      if (!/erro (429|500|503)|Falha de rede/.test(e.message)) throw e;
      if (i + 1 < models.length) qcLog('gemini', 'fallback de modelo: ' + models[i] + ' -> ' + models[i + 1]);
    }
  }
  qcLog('gemini', 'todos os modelos falharam: ' + (lastErr && lastErr.message));
  throw lastErr || new Error('Gemini indisponível.');
}

// Monta a lista de modelos (principal + fallback), sem vazios/duplicados.
function modelList(cfg) {
  const list = [cfg.clip_model || 'gemini-flash-latest'];
  const fb = cfg.clip_model_fallback || 'gemini-flash-lite-latest';
  if (fb && list.indexOf(fb) === -1) list.push(fb);
  return list;
}

// Monta a transcrição compacta como LINHAS "[ini-fim] texto" (segundos, 1 casa).
// Os segmentos vêm curtos (nível palavra); agrupamos em blocos de ~200 chars
// para reduzir o tamanho do contexto enviado ao Gemini.
function buildTranscriptLines(segments) {
  const lines = [];
  let bufText = '', bufStart = null, bufEnd = null;
  function flush() {
    if (bufText) lines.push('[' + bufStart.toFixed(1) + '-' + bufEnd.toFixed(1) + '] ' + bufText.trim());
    bufText = ''; bufStart = null; bufEnd = null;
  }
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (bufStart === null) bufStart = s.start;
    bufEnd = s.end;
    bufText += (bufText ? ' ' : '') + s.text;
    if (bufText.length >= 200) flush();
  }
  flush();
  return lines;
}

// Divide as linhas em pedaços com sobreposição (padrão do clipper.py do VoxFlow:
// episódios longos estouram o tamanho de RESPOSTA do modelo — pedir muitos cortes
// de uma transcrição gigante devolve JSON truncado). ~300 linhas ≈ 60k chars.
const CHUNK_LINES = 300;
const CHUNK_OVERLAP = 20;

function chunkLines(lines) {
  const chunks = [];
  if (!lines.length) return chunks;
  let start = 0;
  while (start < lines.length) {
    const end = start + CHUNK_LINES;
    chunks.push(lines.slice(start, end));
    if (end >= lines.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

// Resgata cortes completos de um JSON truncado (resposta cortada no meio) —
// varredura por profundidade de chaves dentro do array "clips", portada do
// recover_partial_clips do VoxFlow. Sem isso, um corte incompleto no fim da
// resposta perderia TODOS os cortes do chunk.
function recoverPartialClips(raw) {
  const recovered = [];
  const arrayStart = raw.indexOf('"clips"');
  if (arrayStart === -1) return recovered;
  const bracketStart = raw.indexOf('[', arrayStart);
  if (bracketStart === -1) return recovered;

  let depth = 0, inString = false, escapeNext = false, objStart = null;
  for (let i = bracketStart; i < raw.length; i++) {
    const ch = raw[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (ch === '\\' && inString) { escapeNext = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== null) {
        try {
          const obj = JSON.parse(raw.slice(objStart, i + 1));
          if (obj.titulo && obj.segmentos) recovered.push(obj);
        } catch (e) { /* objeto quebrado: ignora */ }
        objStart = null;
      }
    }
  }
  return recovered;
}

// Saneia/normaliza a resposta do Gemini no schema do painel.
// Preserva a avaliação de viralidade (usada no relatório dos cortes).
function normalizeClips(parsed) {
  const out = [];
  const clips = (parsed && parsed.clips) || [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i] || {};
    const segs = c.segmentos || [];
    const norm = [];
    for (let j = 0; j < segs.length; j++) {
      const ini = parseFloat(segs[j].inicio);
      const fim = parseFloat(segs[j].fim);
      if (!isNaN(ini) && !isNaN(fim) && fim > ini) norm.push({ inicio: ini, fim: fim });
    }
    if (norm.length > 0) {
      out.push({
        titulo: c.titulo || ('Corte ' + (i + 1)),
        avaliacao: c.avaliacao || null,
        legenda_ig: c.legenda_ig || '',
        dicas_edicao: c.dicas_edicao || '',
        segmentos: norm,
      });
    }
  }
  return out;
}

// Extrai o texto da 1a resposta do Gemini.
function extractText(raw) {
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error('Resposta do Gemini ilegível.'); }
  return (data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0]) ? data.candidates[0].content.parts[0].text : '';
}

function buildPrompt(transcript, alvo, minD, maxD) {
  return (
    'Você é um Especialista em Estratégia de Conteúdo Viral e Editor Sênior de cortes (clips) brasileiro, com experiência comprovada em TikTok, Reels e Shorts. Seu objetivo: cortes que capturam a atenção nos primeiros segundos, geram curiosidade, incentivam compartilhamento e levam tráfego ao episódio completo.\n' +
    'Abaixo está a TRANSCRIÇÃO do episódio, uma linha por trecho no formato "[inicio-fim] texto", onde inicio e fim são SEGUNDOS do vídeo original. Exemplo: "[0.0-5.5] Olá a todos e bem-vindos ao nosso podcast!"\n\n' +
    'Tarefa: crie ' + alvo + ' cortes virais e autossuficientes, cada um com ' + minD + ' a ' + maxD + ' segundos de duração total.\n\n' +
    'REGRA DE OURO — GANCHO PRIMEIRO (OBRIGATÓRIA EM TODO CORTE):\n' +
    'O primeiro segmento de CADA corte deve ser um GANCHO de 3 a 8 segundos retirado do momento mais impactante do assunto — MESMO que no episódio ele apareça depois. Reordene: gancho primeiro, desenvolvimento depois. Um corte com um único segmento contínuo, sem gancho reposicionado, SÓ é aceitável se o trecho já começar naturalmente com uma frase de impacto.\n' +
    'Tipos de gancho que funcionam: declaração controversa/polarizadora; pergunta instigante que o público já se fez; dado ou fato chocante; história começando no meio da tensão; promessa clara de valor ("você nunca mais vai ver X do mesmo jeito").\n' +
    'Continuidade: se o gancho for um trecho deslocado, os segmentos seguintes devem retomar o contexto de forma orgânica, chegando de volta ao ponto do gancho para fechar o raciocínio (o espectador precisa sentir que a promessa do gancho foi cumprida).\n\n' +
    'EDIÇÃO NÃO-LINEAR E DINÂMICA:\n' +
    '- Não se prenda à ordem cronológica: monte a melhor narrativa possível com 2 a 5 segmentos por corte.\n' +
    '- Elimine pausas, hesitações e enrolação: prefira vários segmentos curtos e densos a um bloco longo com partes mortas.\n' +
    '- O corte deve construir uma ideia e culminar num ponto-chave (pode terminar com gancho de curiosidade para o episódio completo).\n' +
    '- PRIORIZE: opiniões fortes, histórias pessoais impactantes, revelações/segredos, dicas acionáveis, dados surpreendentes e insights contra-intuitivos.\n' +
    '- Você PODE reutilizar um mesmo trecho forte em cortes diferentes.\n\n' +
    'REGRAS TÉCNICAS:\n' +
    '- Use os timestamps REAIS da transcrição; não invente tempos. Cada segmento deve começar/terminar em fronteiras naturais de fala.\n' +
    '- titulo: chamada curta e atrativa em pt-BR (sem hashtags).\n' +
    '- avaliacao: "hook" (nota + justificativa curta, ex.: "9/10 - abre com pergunta que prende") e "potencial_viral" ("Muito Alta", "Alta", "Média" ou "Baixa").\n' +
    '- legenda_ig: legenda pronta para postar o corte no Instagram Reels, em pt-BR: 1-3 frases envolventes + CTA para ouvir o episódio completo + 4 a 6 hashtags relevantes (combinando amplas e de nicho).\n' +
    '- dicas_edicao: 1-3 sugestões CURTAS e práticas para o editor deixar o Reels mais dinâmico neste corte específico: texto de impacto para pôr na tela (e em qual momento), palavras-chave para destacar na legenda dinâmica, ideia de b-roll/imagem de apoio se couber, e o CTA visual do final (ex.: "Ouça o episódio completo — link na bio").\n\n' +
    'Responda APENAS em JSON válido, sem markdown, no formato exato:\n' +
    '{"clips":[{"titulo":"...","avaliacao":{"hook":"...","potencial_viral":"..."},"legenda_ig":"...","dicas_edicao":"...","segmentos":[{"inicio":12.3,"fim":58.7}]}]}\n\n' +
    'TRANSCRIÇÃO:\n"""\n' + transcript + '\n"""'
  );
}

// gerarCortes(segments, { quantidade, minDur, maxDur, onProgress }) -> Promise<{ clips: [...] }>
// Episódios longos são processados em CHUNKS (com sobreposição) e os cortes
// somados — evita resposta truncada do modelo em transcrições gigantes.
async function gerarCortes(segments, opts) {
  opts = opts || {};
  const cfg = loadConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey || apiKey.indexOf('COLE_SUA_CHAVE') === 0) {
    throw new Error('Defina gemini_api_key em engine/config.json.');
  }

  const minD = opts.minDur && opts.minDur > 0 ? opts.minDur : 20;
  const maxD = opts.maxDur && opts.maxDur > 0 ? opts.maxDur : 90;
  const lines = buildTranscriptLines(segments);
  const chunks = chunkLines(lines);

  // Duração total da fala: vídeos de 1h+ têm material de sobra — sem quantidade
  // definida, garante um MÍNIMO de 20 cortes (pedido da produção).
  const durTotal = segments.length ? segments[segments.length - 1].end : 0;
  const total = opts.quantidade && opts.quantidade > 0 ? opts.quantidade : 0;
  let alvo;
  if (total > 0) {
    alvo = 'EXATAMENTE ' + Math.ceil(total / chunks.length);
  } else if (durTotal > 3600) {
    alvo = 'PELO MENOS ' + Math.ceil(20 / chunks.length);
  } else {
    alvo = 'de 5 a 12';
  }

  qcLog('cortes', 'INÍCIO — ' + lines.length + ' blocos de transcrição em ' + chunks.length + ' chunk(s), alvo: ' + alvo);
  let clips = [];
  let lastErr = null;
  for (let c = 0; c < chunks.length; c++) {
    if (opts.onProgress && chunks.length > 1) opts.onProgress('Analisando parte ' + (c + 1) + '/' + chunks.length + '…');
    if (c > 0) await wait(3000); // respiro entre chunks p/ não bater rate limit
    const body = {
      contents: [{ parts: [{ text: buildPrompt(chunks[c].join('\n'), alvo, minD, maxD) }] }],
      generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
    };
    let text = '';
    try {
      text = extractText(await callGemini(modelList(cfg), apiKey, body));
    } catch (e) {
      lastErr = e;
      qcLog('cortes', 'chunk ' + (c + 1) + ' FALHOU: ' + e.message);
      continue; // um chunk falhou; os outros ainda podem render cortes
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // resposta truncada: resgata os cortes completos em vez de perder o chunk
      parsed = { clips: recoverPartialClips(text) };
      qcLog('cortes', 'chunk ' + (c + 1) + ' com JSON truncado — recuperados ' + parsed.clips.length + ' corte(s)');
    }
    clips = clips.concat(normalizeClips(parsed));
  }
  qcLog('cortes', 'FIM — ' + clips.length + ' corte(s) no total');

  if (clips.length === 0) {
    if (lastErr) throw lastErr;
    throw new Error('O Gemini não encontrou cortes utilizáveis.');
  }
  if (total > 0 && clips.length > total) clips = clips.slice(0, total);
  return { clips: clips };
}

// Idiomas suportados no dropdown de legenda (código → nome usado no prompt).
const IDIOMAS = {
  pt: 'português do Brasil',
  en: 'inglês',
  es: 'espanhol',
  fr: 'francês',
  it: 'italiano',
};

// corrigirLegendas(textos[], { idioma }) -> Promise<string[]> (mesma quantidade/ordem).
// Sem idioma: corrige ortografia/acentuação. Com idioma ('en', 'es'...): TRADUZ
// linha a linha para o idioma-alvo. Nos dois casos as linhas não são juntadas
// nem divididas — o timing da legenda original é preservado.
async function corrigirLegendas(textos, opts) {
  opts = opts || {};
  const cfg = loadConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey || apiKey.indexOf('COLE_SUA_CHAVE') === 0) {
    throw new Error('Defina gemini_api_key em engine/config.json.');
  }
  if (!textos || !textos.length) return [];

  const alvo = opts.idioma && IDIOMAS[opts.idioma] ? IDIOMAS[opts.idioma] : null;
  qcLog('legenda', (alvo ? 'TRADUÇÃO para ' + alvo : 'correção pt-BR') + ' — ' + textos.length + ' linhas');

  const numbered = textos.map((t, i) => i + '\t' + t).join('\n');
  const tarefa = alvo
    ? 'TRADUZA as legendas abaixo para ' + alvo + ', linha a linha. As linhas são trechos ' +
      'CONSECUTIVOS da mesma fala (leia todas para entender o contexto antes de traduzir). ' +
      'Distribua a tradução de forma natural entre as linhas, respeitando a ordem temporal da fala.\n'
    : 'Corrija ortografia, acentuação e pontuação das legendas abaixo, em pt-BR.\n';
  const prompt =
    tarefa +
    'REGRAS IMPORTANTES:\n' +
    '- NÃO junte nem divida linhas: a saída tem EXATAMENTE a mesma quantidade de itens, na mesma ordem.\n' +
    (alvo
      ? '- Traduza o sentido com naturalidade; não deixe nada no idioma original.\n'
      : '- É PROIBIDO mover palavras entre linhas: cada linha tem um TEMPO de exibição fixo, ' +
        'sincronizado com a fala. A linha corrigida deve ter EXATAMENTE as mesmas palavras da ' +
        'original (mesma quantidade, mesma ordem) — só conserte grafia, acentos e pontuação. ' +
        'NÃO redistribua texto para equalizar o tamanho das linhas. NÃO reescreva o sentido.\n') +
    '- Não adicione comentários.\n' +
    '\nEntrada (uma por linha, "indice<TAB>texto"):\n' + numbered + '\n\n' +
    'Responda APENAS em JSON: {"linhas":[{"i":0,"texto":"..."}, ...]}';

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };

  const raw = await callGemini(modelList(cfg), apiKey, body);
  let parsed;
  try { parsed = JSON.parse(extractText(raw)); } catch (e) { return textos.slice(); }
  const out = textos.slice();
  const arr = (parsed && parsed.linhas) || [];
  let rejeitadas = 0;
  for (let k = 0; k < arr.length; k++) {
    const i = parseInt(arr[k].i, 10);
    if (!isNaN(i) && i >= 0 && i < out.length && typeof arr[k].texto === 'string' && arr[k].texto.trim()) {
      const novo = arr[k].texto.trim();
      // Modo correção: valida que o modelo NÃO redistribuiu palavras entre
      // linhas (cada linha tem tempo fixo; re-flow dessincroniza texto × fala).
      // Se a contagem de palavras mudou, a linha corrigida é DESCARTADA.
      if (!alvo && contaPalavras(novo) !== contaPalavras(textos[i])) { rejeitadas++; continue; }
      out[i] = novo;
    }
  }
  if (rejeitadas > 0) qcLog('legenda', rejeitadas + ' linha(s) rejeitada(s) na validação anti-reflow (mantido o texto original)');
  return out;
}

// Conta palavras ignorando pontuação solta (p/ validar a correção linha a linha).
function contaPalavras(s) {
  const m = String(s).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

// corrigirPalavras(words) -> Promise<string[]> (mesmo tamanho/ordem).
// O Whisper em PT muitas vezes transcreve SEM pontuação — e o agrupamento de
// legendas quebra NA pontuação. Esta etapa roda ANTES do agrupamento: o Gemini
// recebe as palavras numeradas e devolve cada uma corrigida (acentos/grafia)
// e com a pontuação ANEXADA à palavra onde ela ocorre na fala. Validação
// rígida por item: 1 palavra entra → 1 palavra sai (senão mantém a original).
const PALAVRAS_POR_LOTE = 400;

function validaPalavraCorrigida(original, corrigida) {
  if (typeof corrigida !== 'string') return false;
  const c = corrigida.trim();
  if (!c || /\s/.test(c)) return false;          // juntou palavras? rejeita
  return contaPalavras(c) === 1 && contaPalavras(original) === 1;
}

async function corrigirPalavras(words) {
  const cfg = loadConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey || apiKey.indexOf('COLE_SUA_CHAVE') === 0) {
    throw new Error('Defina gemini_api_key em engine/config.json.');
  }
  const textos = words.map(function (w) { return w.text; });
  const out = textos.slice();
  let corrigidas = 0, rejeitadas = 0;

  for (let base = 0; base < textos.length; base += PALAVRAS_POR_LOTE) {
    const lote = textos.slice(base, base + PALAVRAS_POR_LOTE);
    const numbered = lote.map((t, i) => i + '\t' + t).join('\n');
    const prompt =
      'Abaixo estão palavras CONSECUTIVAS transcritas automaticamente de uma fala em português do Brasil. ' +
      'A transcrição pode estar sem pontuação e com acentos/grafia errados.\n' +
      'Devolva AS MESMAS palavras, na MESMA ordem e quantidade, fazendo apenas:\n' +
      '- corrigir acentuação e grafia da palavra;\n' +
      '- ANEXAR a pontuação (vírgula, ponto, ?, !, :) ao FINAL da palavra onde a pontuação ocorre na fala (leia o contexto completo para decidir);\n' +
      '- iniciar com maiúscula a palavra que começa uma frase.\n' +
      'REGRAS: NÃO junte, divida, remova, adicione ou troque palavras. Cada item de saída corresponde ao item de entrada de mesmo índice e contém UMA única palavra.\n\n' +
      'Entrada (uma por linha, "indice<TAB>palavra"):\n' + numbered + '\n\n' +
      'Responda APENAS em JSON: {"palavras":[{"i":0,"t":"..."}, ...]}';

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    };
    let parsed;
    try {
      parsed = JSON.parse(extractText(await callGemini(modelList(cfg), apiKey, body)));
    } catch (e) {
      qcLog('legenda', 'pontuação: lote ' + (base / PALAVRAS_POR_LOTE + 1) + ' falhou (' + e.message + ') — mantendo palavras originais');
      continue;
    }
    const arr = (parsed && parsed.palavras) || [];
    for (let k = 0; k < arr.length; k++) {
      const i = parseInt(arr[k].i, 10);
      if (isNaN(i) || i < 0 || i >= lote.length) continue;
      if (validaPalavraCorrigida(lote[i], arr[k].t)) { out[base + i] = arr[k].t.trim(); corrigidas++; }
      else rejeitadas++;
    }
  }
  qcLog('legenda', 'pontuação por palavra: ' + corrigidas + ' corrigidas, ' + rejeitadas + ' rejeitadas de ' + textos.length);
  return out;
}

module.exports = { gerarCortes, corrigirLegendas, corrigirPalavras };
