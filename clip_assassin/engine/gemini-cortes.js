// Seleção de cortes e remontagem completa de podcast via Gemini (Google),
// dentro do painel CEP.
//
// Este arquivo reúne DUAS FUNCIONALIDADES:
// 1) gerarCortes â€” clipes soltos para Reels/Shorts (com chunking, porque a
//    saída é pesada: cada clipe carrega título/legenda/dicas).
// 2) gerarPodcastEditado â€” remontagem do EPISÃ“DIO INTEIRO (hook + abertura +
//    apresentação + conversa principal + participante extra + retorno +
//    encerramento) com meta de duração final, em DUAS PASSADAS sequenciais
//    (decidir cortes -> estruturar o que sobrou), sem chunking, porque a
//    decisão de "o que sai do tema" exige ver o episódio inteiro de uma vez.
//
// Usa o módulo `https` do Node (não `fetch`) para evitar indisponibilidade de
// fetch e problemas de CORS no runtime do CEP.

const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { qcLog } = require('./log.js');

// curl.exe nativo do Windows (10/11). Roda como PROCESSO SEPARADO, então passa
// pelo firewall mesmo quando o Premiere.exe está bloqueado de acessar a internet
// por firewall/antivírus. Ã‰ o mesmo motivo de ffmpeg/whisper funcionarem.
const CURL = (process.env.SystemRoot || 'C:\\Windows') + '\\System32\\curl.exe';

function loadConfig() {
  try {
    const userCfgPath = path.join(process.env.LOCALAPPDATA || '', 'QuarksCuts', 'config.json');
    if (fs.existsSync(userCfgPath)) {
      let baseCfg = {};
      try { baseCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch (e1) {}
      const userCfg = JSON.parse(fs.readFileSync(userCfgPath, 'utf8'));
      return Object.assign({}, baseCfg, userCfg);
    }
  } catch (e) {}
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}

const MAX_TRIES = 6;      // por modelo (erros de rede)
const MAX_TRIES_503 = 3;  // sobrecarga: depois de 3 falhas, troca de modelo
const MAX_TRIES_429 = 3;  // limite por minuto: espera o tempo sugerido; cota diaria nao adianta repetir

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
// backoff crescente com teto e jitter: ~4s,8s,12s,16s,20s
function delay(tries) { return Math.min(tries * 4000, 20000) + Math.floor(Math.random() * 1500); }

// Requisição via curl.exe (processo separado â†’ passa pelo firewall do Premiere).
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
    const corpo = String(res.body);
    // 500 chars (antes 150): o trecho que diz QUAL limite estourou fica no fim do JSON
    qcLog('gemini', model + ' HTTP ' + res.status + ' (tentativa ' + tries + '): ' + corpo.replace(/\s+/g, ' ').slice(0, 500));
    const cotaDiaria = res.status === 429 && /PerDay|per_day|limit:\s*0\b/i.test(corpo);
    const maxTries = res.status === 429 ? MAX_TRIES_429 : (res.status === 503 ? MAX_TRIES_503 : MAX_TRIES);
    if ([429, 500, 503].indexOf(res.status) !== -1 && !cotaDiaria && tries < maxTries) {
      const m = /retry in (\d+(?:\.\d+)?)s/i.exec(corpo);
      const w = m ? Math.min(parseFloat(m[1]) * 1000 + 800, 60000) : delay(tries);
      await wait(w);
      return attempt(tries + 1);
    }
    if (res.status === 429) {
      const err = new Error('Limite de uso do Gemini atingido no modelo ' + model +
        (cotaDiaria ? ' (cota DIÁRIA ou sem cota gratuita para esse modelo). ' : ' (limite por minuto). ') +
        'O limite vale por PROJETO do Google, não por chave: cada pessoa precisa de projeto próprio ' +
        '(aistudio.google.com/apikey) ou de billing ativado.');
      err.fallbackable = true; // outro modelo tem cota separada
      throw err;
    }
    const err = new Error('Gemini erro ' + res.status + ': ' + corpo.slice(0, 300));
    err.fallbackable = [500, 503].indexOf(res.status) !== -1;
    throw err;
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
      if (!e.fallbackable && !/erro (429|500|503)|Falha de rede/.test(e.message)) throw e;
      if (i + 1 < models.length) qcLog('gemini', 'fallback de modelo: ' + models[i] + ' -> ' + models[i + 1]);
    }
  }
  qcLog('gemini', 'todos os modelos falharam: ' + (lastErr && lastErr.message));
  throw lastErr || new Error('Gemini indisponível.');
}

// Monta a lista de modelos (principal + fallback), sem vazios/duplicados.
// clip_model: modelo primário para julgamento editorial (cortes E remontagem
// completa) â€” gemini-3.5-flash. clip_model_fallback: só entra em 429/500/503,
// não como economia deliberada â€” gemini-3.1-flash-lite é otimizado pra tarefas
// leves de alto volume, não pra julgamento narrativo sobre 2h de conversa.
function modelList(cfg, preferido) {
  const list = [];
  function add(m) { if (m && list.indexOf(m) === -1) list.push(m); }
  add(preferido);                                  // ex.: legenda_model (tarefa leve)
  add(cfg.clip_model || 'gemini-3.6-flash');
  add(cfg.clip_model_fallback || 'gemini-3.5-flash-lite');
  add('gemini-2.5-flash');
  add('gemini-2.5-pro');
  add('gemini-2.0-flash');
  add('gemini-1.5-pro');
  add('gemini-1.5-flash');
  add('gemini-flash-latest');                      // último recurso: sempre existe
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

// Extrai o texto da 1a resposta do Gemini.
function extractText(raw) {
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error('Resposta do Gemini ilegível.'); }
  return (data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0]) ? data.candidates[0].content.parts[0].text : '';
}

// ============================================================================
// PARTE 1 â€” gerarCortes (clipes soltos para Reels/Shorts)
// ============================================================================

// Divide as linhas em pedaços com sobreposição. Com os modelos modernos (1M tokens),
// 1000 linhas (~35-45 minutos) oferecem contexto narrativo profundo sem truncamento.
const CHUNK_LINES = 1000;
const CHUNK_OVERLAP = 50;

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

// Resgata cortes completos de um JSON truncado (resposta cortada no meio) â€”
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
// Valida a faixa de duração pedida (minD/maxD): cortes bem fora da faixa são
// descartados — evita cortes de 3s ou de 5 minutos que passam sem validação.
function normalizeClips(parsed, minD, maxD) {
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
      const total = norm.reduce((a, s) => a + (s.fim - s.inicio), 0);
      // Faixa com folga: 80% do mínimo, 120% do máximo.
      if (minD && (total < minD * 0.8 || total > maxD * 1.2)) continue;
      out.push({
        titulo: c.titulo || ('Corte ' + (i + 1)),
        avaliacao: c.avaliacao || null,
        hook_text_tela: c.hook_text_tela || '',
        loop_point: c.loop_point || '',
        legenda_ig: c.legenda_ig || '',
        dicas_edicao: c.dicas_edicao || '',
        segmentos: norm,
      });
    }
  }
  return out;
}

// Deduplica cortes repetidos ENTRE chunks: dois cortes com sobreposição de
// segmentos (Jaccard) acima de 0.6 são considerados o mesmo corte; mantém o que
// tem melhor nota de hook (HookScore do YouTube Agent Skill).
function dedupeClips(clips) {
  const keep = [];
  for (let i = 0; i < clips.length; i++) {
    const a = clips[i].segmentos || [];
    const durA = a.reduce((x, s) => x + (s.fim - s.inicio), 0);
    if (durA <= 0) { keep.push(clips[i]); continue; }
    let dupIdx = -1;
    for (let k = 0; k < keep.length && dupIdx === -1; k++) {
      const b = keep[k].segmentos || [];
      const durB = b.reduce((x, s) => x + (s.fim - s.inicio), 0);
      if (durB <= 0) continue;
      let inter = 0;
      for (let ia = 0; ia < a.length; ia++) {
        for (let ib = 0; ib < b.length; ib++) {
          const ini = Math.max(a[ia].inicio, b[ib].inicio);
          const fim = Math.min(a[ia].fim, b[ib].fim);
          if (fim > ini) inter += (fim - ini);
        }
      }
      if (inter / (durA + durB - inter) >= 0.6) dupIdx = k;
    }
    if (dupIdx === -1) {
      keep.push(clips[i]);
    } else {
      // Duplicata: mantém o corte com melhor nota de hook (HookScore 0-100 ou nota 1-10)
      const notaDeHook = function (cl) {
        if (cl.avaliacao && typeof cl.avaliacao.hook_score === 'number') return cl.avaliacao.hook_score;
        var m = /([0-9]+)\s*\/\s*10/.exec(((cl.avaliacao && (cl.avaliacao.hook || cl.avaliacao.motivo)) || ''));
        return m ? parseInt(m[1], 10) * 10 : -1;
      };
      if (notaDeHook(clips[i]) > notaDeHook(keep[dupIdx])) keep[dupIdx] = clips[i];
    }
  }
  return keep;
}

function buildPrompt(transcript, alvo, minD, maxD, tom, instrucaoCustom, modoMontagem) {
  var isLinear = (modoMontagem === 'linear');

  var instrucaoTom = '';
  if (tom === 'humor') {
    instrucaoTom = 'DIRETRIZ DE TOM — HUMORÍSTICO: Priorize momentos engraçados, sacadas rápidas, reações cômicas espontâneas e histórias divertidas com timing preciso, onde o convidado surpreende com observações inesperadas.\n';
  } else if (tom === 'educativo') {
    instrucaoTom = 'DIRETRIZ DE TOM — EDUCATIVO / INSIGHTS: Priorize dicas práticas, lições de negócios, explicações minuciosas e momentos "você sabia?" com dados e métodos concretos que agreguem valor imediato ao espectador.\n';
  } else if (tom === 'polemico') {
    instrucaoTom = 'DIRETRIZ DE TOM — POLÊMICO / DEBATE: Priorize quebras de crença contraintuitivas, opiniões fortes contra o senso comum, declarações que geram reflexão profunda e desmistificações do mercado.\n';
  } else if (tom === 'emocional') {
    instrucaoTom = 'DIRETRIZ DE TOM — EMOCIONAL / MOTIVACIONAL: Priorize pontos de virada pessoal, momentos de vulnerabilidade real, decisões difíceis no fundo do poço e histórias de superação com lições práticas de vida.\n';
  } else if (tom === 'variado') {
    instrucaoTom = 'DIRETRIZ DE TOM — MISTO / VARIADO: Alterne estrategicamente entre quebra de crença, histórias de bastidores, ensinamentos práticos e momentos reflexivos para compor um lote diversificado.\n';
  }

  var instrucaoExtra = (instrucaoCustom && instrucaoCustom.trim())
    ? 'INSTRUÇÃO ADICIONAL DO EDITOR (ajusta critérios de seleção sem violar regras técnicas): ' + instrucaoCustom.trim().substring(0, 500) + '\n'
    : '';

  if (isLinear) {
    return (
      'Você é um Editor Sênior de Vídeo para Shorts, Reels e TikTok (estilo Quarks Podcast).\n' +
      'Seu objetivo: selecionar cortes contínuos (take único) de alto impacto da transcrição abaixo.\n\n' +
      'Abaixo está a TRANSCRIÇÃO do episódio em blocos "[inicio-fim] texto" (segundos reais).\n\n' +
      'META: crie ' + alvo + ' cortes virais em take contínuo, cada um com ' + minD + ' a ' + maxD + ' segundos de duração total.\n\n' +
      instrucaoTom +
      instrucaoExtra +
      '# REGRAS DO TAKE CONTÍNUO:\n' +
      '- Comece com frase de impacto ou quebra de crença (sem vícios de linguagem "aí", "tipo assim").\n' +
      '- Termine na última sílaba da conclusão (punchline).\n' +
      '- Cada corte terá exatamente 1 segmento na lista "segmentos".\n\n' +
      'Responda APENAS em JSON válido, sem markdown, no formato exato:\n' +
      '{"analise":"2-4 frases analisando os momentos mais fortes","clips":[\n' +
      '{"titulo":"...","avaliacao":{"hook_score":85,"formula":"The Mistake","potencial_viral":"Alta","motivo":"..."},"hook_text_tela":"...","loop_point":"...","legenda_ig":"...","dicas_edicao":"...","segmentos":[{"inicio":12.3,"fim":58.7,"duracao_s":46.4}],"duracao_total_s":46.4}]}\n\n' +
      'TRANSCRIÇÃO:\n"""\n' + transcript + '\n"""'
    );
  }

  // MODO PADRÃO: CORTES COM ALTA RETENÇÃO E CONTEXTO COMPLETO (YOUTUBE AGENT SKILL)
  return (
    'Você é o Editor Chefe de Estratégia Viral de Shorts, TikTok e Reels do canal Quarks Podcast (@quarkspodcast), aplicando os princípios de alto impacto do YouTube Agent Skill (21 fórmulas de hook, HookScore, The Turn, Loop Points e Contexto Completo).\n\n' +
    'MISSÃO: Selecionar os CORTES MAIS VIRAIS, DE MAIOR RETENÇÃO E COM CONTEXTO NARRATIVO 100% PRESERVADO a partir da TRANSCRIÇÃO abaixo.\n\n' +
    'REGRA FUNDAMENTAL — MONTAGEM DINÂMICA DE 2 A 8 PARTES COM GANCHO INICIAL OBRIGATÓRIO:\n' +
    '- CADA CORTE DEVE SER UMA MONTAGEM COSTURADA CONTENDO ENTRE 2 E 8 PARTES (SEGMENTOS) no array "segmentos"!\n' +
    '- É TERMINANTEMENTE PROIBIDO gerar cortes de take único/corte direto neste modo. Crie SEMPRE uma costura dinâmica inteligente com no mínimo 2 e no máximo 8 partes selecionadas da transcrição.\n' +
    '- GANCHO INICIAL OBRIGATÓRIO (PARTE 1: 4 a 10s): O primeiro segmento de cada corte DEVE ser o gancho mais impactante, curioso, polêmico ou contraintuitivo da conversa (uma das 21 Fórmulas Virais abaixo). Ele pode ser resgatado de qualquer momento da entrevista e colocado na abertura para capturar a atenção imediata!\n' +
    '- PARTES INTERMEDIÁRIAS (Partes 2 até a penúltima): Trazem o contexto essencial, a história, o exemplo prático e o desenvolvimento ("The Turn"). Costure as falas fundamentais que explicam e fundamentam o gancho inicial, garantindo que o raciocínio faça total sentido para quem ouve sem perder o contexto.\n' +
    '- PARTE FINAL (Última Parte): Traz o payoff definitivo e a punchline, terminando com clareza na última sílaba falada (preparando o loop point).\n' +
    '- NÃO corte palavras pela metade e NÃO deixe pensamentos desconexos.\n' +
    '- NÃO tente remover respiros ou micro-pausas da fala aqui — a remoção de silêncios é feita pelo editor na timeline. NUNCA mencione J-Cut ou L-Cut nas dicas de edição!\n\n' +
    'TRANSCRIÇÃO EM BLOCOS "[inicio-fim] texto" (segundos reais do vídeo).\n' +
    'META: Gere ' + alvo + ' cortes virais, cada um com duração total somada estritamente entre ' + minD + ' e ' + maxD + ' segundos.\n\n' +
    instrucaoTom +
    instrucaoExtra +
    '# PILAR 1: AS 21 FÓRMULAS DE GANCHO VIRAL (YOUTUBE AGENT SKILL)\n' +
    'O primeiro trecho de CADA corte (Beat 1 / Parte 1: primeiros 4 a 10s) DEVE se encaixar em uma destas fórmulas consagradas do YouTube:\n' +
    '1. The Mistake: Expõe o erro crítico que a maioria comete sem perceber ("O maior erro ao precificar um serviço é...").\n' +
    '2. Contrarian Flip: Quebra o senso comum com uma verdade contraintuitiva ("Trabalhar duro não te deixa rico. O que te deixa rico é...").\n' +
    '3. The Statistic / Specificity: Dado, número real ou quantia em R$ chocante ("Perdi R$ 400 mil em 48 horas porque ignorei essa cláusula").\n' +
    '4. Someone Else\'s Result: Resultado prático de alguém com o mecanismo revelado ("Ele saiu do zero para 200 mil seguidores em 7 meses com esse formato").\n' +
    '5. The Warning: Aviso urgente de custo iminente ("Nunca assine uma sociedade antes de checar isso").\n' +
    '6. The Question: A dúvida exata que o espectador digita na busca ("Por que o seu faturamento sobe mas o seu caixa continua vazio?").\n' +
    '7. The Impossible Claim: Afirmação extraordinária que parece mentira, seguida de prova imediata.\n' +
    '8. The Insider: Segredo ou bastidor de bastidores que quase ninguém tem acesso.\n' +
    '9. The Direct Address: Filtro direto do público ideal ("Se você gerencia um time de mais de 5 pessoas, preste muita atenção").\n' +
    '10. The Reveal: Promessa de uma lição ou método prático entregue na tela.\n' +
    'REGRA DE ENTRADA LIMPA: Comece no ataque direto da frase. PROIBIDO abrir com hesitações ("Aí...", "Então...", "Tipo assim...", "Pois é...").\n\n' +
    '# PILAR 2: O RUBRIC DE AVALIAÇÃO VIRAL (YOUTUBE AGENT SKILL + SUPOCLIP)\n' +
    'Para cada corte, calcule a nota de viralidade (0 a 100) avaliando os 4 pilares fundamentais do SupoClip e YouTube Agent Skill:\n' +
    '- 1. Hook Strength (0-25): Força do gancho inicial nos primeiros 4 a 8s (especificidade, quebra de crença, curiosidade sem spoiler).\n' +
    '- 2. Engagement & Story (0-25): Tensão, ritmo dinâmico e emoção ao longo do desenvolvimento (The Turn).\n' +
    '- 3. Value & Insights (0-25): Dica prática, aprendizado real de negócios ou lição transformadora que o público quer guardar.\n' +
    '- 4. Shareability (0-25): Conteúdo "preciso mandar para alguém agora mesmo".\n' +
    'A nota total hook_score (0-100) é a soma ou média ponderada dessas dimensões.\n\n' +
    '# PILAR 3: ARQUITETURA NARRATIVA & SNAP DE SENTENÇA (SUPOCLIP GROUNDING)\n' +
    '- Início (0:00 - 0:08 | Segmento 1 - Hook Inicial): O gancho magnético isolado, autossuficiente.\n' +
    '- Meio (Segmentos 2 até penúltimo | The Turn & Contexto): A história real, a explicação minuciosa ou a virada prática, mantendo todo o contexto necessário para o espectador aprender ou se emocionar.\n' +
    '- Fim (Último Segmento | Payoff & Punchline): A conclusão definitiva que fecha a promessa do gancho.\n' +
    '- REGRA DE OURO DO SUPOCLIP (SNAP DE SENTENÇA): O final de cada segmento e, impreterivelmente, a última sílaba do corte DEVE coincidir com o final completo da frase/oração (ponto final, exclamação ou pergunta). É expressamente proibido cortar no meio de palavras ou antes da conclusão do raciocínio!\n\n' +
    '# PILAR 4: LOOP POINT & ON-SCREEN HOOK TEXT (YT-SHORTS)\n' +
    '- hook_text_tela: Texto de 2 a 4 palavras em caixa alta para a tela nos primeiros 2 a 3 segundos. REGRA VITAL: NUNCA repita as palavras exatas da fala falada! Deve ser um texto complementar de impacto visual (ex: Fala: "Perdi R$ 400 mil em 48 horas" -> Texto na tela: "O PIOR ERRO").\n' +
    '- loop_point: Estratégia onde a frase final se conecta organicamente com o início do Short.\n\n' +
    '# PILAR 5: DIRETRIZES EDITORIAIS QUARKS PODCAST (VOICE.MD)\n' +
    '- Foco em autoridade real, negócios, estratégia, superação, cultura e bastidores.\n' +
    '- ZERO clichês apelativos de "fique rico fácil" ou promessas mágicas.\n' +
    '- Títulos Mobile-First: 30 a 45 caracteres (para não truncar no feed de celular).\n\n' +
    '# REGRAS TÉCNICAS E JSON:\n' +
    '- QUANTIDADE OBRIGATÓRIA DE PARTES: cada corte DEVE conter entre 2 e 8 segmentos no array "segmentos" (mínimo 2, máximo 8 partes costuradas). NUNCA envie 1 segmento único!\n' +
    '- O primeiro segmento (Parte 1) é SEMPRE o Hook Inicial de alto impacto (4 a 10s).\n' +
    '- Os segmentos subsequentes desenvolvem a explicação e fecham na punchline.\n' +
    '- Use EXCLUSIVAMENTE timestamps REAIS da transcrição.\n' +
    '- duracao_total_s DEVE ser a soma exata dos segmentos e estar entre ' + minD + ' e ' + maxD + ' segundos.\n\n' +
    'Responda APENAS em JSON válido, sem markdown, no formato exato:\n' +
    '{\n' +
    '  "analise": "2-4 frases destacando os momentos de maior retenção deste trecho e a clareza do contexto.",\n' +
    '  "clips": [\n' +
    '    {\n' +
    '      "titulo": "O Erro de R$ 500 Mil Que Ninguém Vê",\n' +
    '      "avaliacao": {\n' +
    '        "hook_score": 94,\n' +
    '        "formula": "The Mistake",\n' +
    '        "potencial_viral": "Muito Alta",\n' +
    '        "motivo": "Abre com o gancho do erro crítico e costura o contexto da explicação com a lição final"\n' +
    '      },\n' +
    '      "hook_text_tela": "O MAIOR ERRO",\n' +
    '      "loop_point": "A última frase conecta de volta com a pergunta inicial",\n' +
    '      "legenda_ig": "A maioria dos empresários erra nisso todos os dias. Assista e entenda o porquê. Link completo na bio! #podcast #negocios #gestao #estrategia",\n' +
    '      "dicas_edicao": "HOOK TEXT: \\"O MAIOR ERRO\\" nos primeiros 2s. Zoom sutil no The Turn. Reforçar a punchline no final.",\n' +
    '      "segmentos": [\n' +
    '        {"inicio": 112.4, "fim": 118.8, "duracao_s": 6.4},\n' +
    '        {"inicio": 125.0, "fim": 142.3, "duracao_s": 17.3},\n' +
    '        {"inicio": 150.1, "fim": 168.5, "duracao_s": 18.4}\n' +
    '      ],\n' +
    '      "duracao_total_s": 42.1\n' +
    '    }\n' +
    '  ]\n' +
    '}\n' +
    'O campo "analise" vem PRIMEIRO. CADA CORTE DEVE CONTER OBRIGATORIAMENTE DE 2 A 8 PARTES COM GANCHO INICIAL.\n\n' +
    'TRANSCRIÇÃO:\n"""\n' + transcript + '\n"""'
  );
}

function buildPromoPrompt(transcriptText) {
  return (
    'Você é um Especialista em SEO de Vídeos, Copywriter Sênior e Estrategista Chefe do YouTube para podcasts de negócios e alto padrão (Quarks Podcast).\n' +
    'Sua missão é analisar a TRANSCRIÇÃO do episódio completo abaixo (com timestamps em segundos) e produzir um DOSSIÊ DE MARKETING E MÍDIAS de alto desempenho, focado em conversão de cliques, autoridade de marca e retenção.\n\n' +
    'Gere a resposta em formato Markdown estruturado com os seguintes tópicos exatos:\n\n' +
    '# --- DOSSIÊ DE MARKETING E MÍDIAS --- \n\n' +
    '**DIRETRIZES FUNDAMENTAIS DO CANAL**:\n' +
    '- FOCO EM AUTORIDADE E RESULTADOS: Destaque método, visão de negócio, cultura e bastidores reais. Evite jargões apelativos de coach ou promessas irreais.\n' +
    '- REGRA DE OURO DO PAREAMENTO (TÍTULO + THUMBNAIL): A capa e o título são uma unidade complementar. O texto da thumbnail NUNCA deve repetir as palavras do título.\n' +
    '- ZERO SPOILER E ANTI-TRUNCAMENTO: Títulos principais com o gancho central nos primeiros 40 caracteres para não serem cortados no celular.\n\n' +
    '## 1. MATÉRIA DE AUTORIDADE ESTILO FORBES (PARA BLOG / ARTIGO)\n' +
    'Artigo jornalístico de alto padrão, analítico e inspirador com base no episódio:\n' +
    '- Manchete de impacto no estilo Forbes/Exame.\n' +
    '- Resposta Rápida (40-60 palavras): resumo executivo com as principais entidades/conceitos do episódio para SEO e mecanismos de IA (AEO).\n' +
    '- 3 seções temáticas com subtítulos H3, abordando os maiores insights, viradas estratégicas e aprendizados práticos do convidado.\n\n' +
    '## 2. PAREAMENTO ESTRATÉGICO DE TÍTULOS (YOUTUBE)\n' +
    'Apresente 6 opções testadas de títulos em duas categorias, com seu respectivo texto complementar para a Thumbnail:\n\n' +
    '### Categoria A: Títulos Mobile-First (CTR Máximo no Feed - 35 a 45 caracteres)\n' +
    '*(Garante que o assunto principal não é cortado nas telas de smartphone)*\n' +
    '1. Título: [Título curto e magnético] | Texto para Capa: [2-3 palavras complementares em caixa alta]\n' +
    '2. Título: [Título curto e magnético] | Texto para Capa: [2-3 palavras complementares em caixa alta]\n' +
    '3. Título: [Título curto e magnético] | Texto para Capa: [2-3 palavras complementares em caixa alta]\n\n' +
    '### Categoria B: Títulos Desktop & Search (SEO e Autoridade - 50 a 60 caracteres)\n' +
    '4. Título: [Palavra-chave principal] + [Gancho contraintuitivo ou benefício concreto]\n' +
    '5. Título: [Palavra-chave principal] + [História de bastidor ou método do convidado]\n' +
    '6. Título: [Palavra-chave principal] + [Quebra de mito ou verdade do mercado]\n\n' +
    '- Indique explicitamente qual é o título RECOMENDADO número 1 e o racional da escolha.\n\n' +
    '## 3. DESCRIÇÃO ESTRATÉGICA DO VÍDEO (YOUTUBE)\n' +
    '- Topo (primeiras 2-3 linhas antes do "Mostrar Mais"): gancho magnético conectando a curiosidade do espectador ao valor da conversa.\n' +
    '- Bloco "O que você vai entender neste episódio": 4 a 6 bullets objetivos usando o marcador ✔ com os maiores destaques.\n' +
    '- Bloco de CTA e Redes: chamada para se inscrever no canal Quarks Podcast, seguir a Quarks Produtora e links de contato.\n' +
    '- Parágrafo de SEO Semântico (LSI): 3-4 linhas em linguagem natural citando as principais entidades, nicho e temas discutidos.\n' +
    '- Hashtags: 5 hashtags estratégicas (2 de marca, 2 de nicho e 1 de tendência).\n\n' +
    '## 4. TAGS DO YOUTUBE\n' +
    '- Lista de tags separadas por vírgula (máximo 450 caracteres no total), organizadas em: Tag única exata, Tags long-tail (perguntas reais) e Tags de categoria.\n\n' +
    '## 5. SUGESTÃO DE CAPA (THUMBNAIL DE ALTA TAXA DE CLIQUE)\n' +
    '- Composição Visual em 3 Elementos: 1) Expressão facial do convidado/host (choque, ceticismo ou seriedade executiva), 2) Elemento de apoio visual (objeto, documento, gráfico ou cenário de estúdio), 3) Texto da capa (2 a 4 palavras em tipografia bold de alto contraste).\n' +
    '- Paleta de cores recomendada e contraste com fundo escuro.\n' +
    '- Alerta de Zona Morta: manter o canto inferior direito 100% livre (área coberta pelo marcador de tempo do YouTube).\n\n' +
    '## 6. TRECHOS DE MAIOR IMPACTO (HIGHLIGHTS DO EPISÓDIO)\n' +
    '- 3 a 5 declarações marcantes literais da transcrição com o timestamp aproximado, prontas para serem usadas em postagens de citação ou teasers.\n\n' +
    '## 7. CAPÍTULOS DE RETENÇÃO (COM TIMESTAMPS)\n' +
    'Primeiro, liste os capítulos em formato legível com micro-ganchos instigantes (ex: "05:12 - O erro que quase quebrou o negócio", e não apenas "05:12 - O início") para colar na descrição do YouTube/Spotify.\n\n' +
    'Depois, repita EXATAMENTE os mesmos capítulos no bloco delimitado obrigatório para marcação na timeline do Premiere:\n' +
    'CAPITULOS_RAW_START\n' +
    '0.0|Introdução\n' +
    '312.5|Nome do segundo capítulo com micro-gancho\n' +
    'CAPITULOS_RAW_END\n\n' +
    'TRANSCRIÇÃO:\n"""\n' + transcriptText + '\n"""'
  );
}

// Extrai o bloco CAPITULOS_RAW_START...CAPITULOS_RAW_END de um texto de promo
// e devolve { chaptersRaw: "seg|nome\n..." (pronto pro qcAddChapterMarkers),
//             promoSemRaw: texto do dossiê sem o bloco machine-parseable
//             (o bloco cru não deveria ir pro markdown final que o usuário lê) }.
// Se não achar o bloco, devolve chaptersRaw vazio e o texto original intacto.
function extrairCapitulosRaw(promoText) {
  if (!promoText) return { chaptersRaw: '', promoSemRaw: promoText };
  const m = /CAPITULOS_RAW_START\s*([\s\S]*?)\s*CAPITULOS_RAW_END/.exec(promoText);
  if (!m) return { chaptersRaw: '', promoSemRaw: promoText };
  const chaptersRaw = m[1].trim();
  const promoSemRaw = promoText.replace(/CAPITULOS_RAW_START[\s\S]*?CAPITULOS_RAW_END\n?/, '').trim();
  return { chaptersRaw: chaptersRaw, promoSemRaw: promoSemRaw };
}

async function gerarPromoDoc(transcriptText, cfg, apiKey) {
  const body = {
    contents: [{ parts: [{ text: buildPromoPrompt(transcriptText) }] }],
    generationConfig: { temperature: 0.7 }
  };
  const raw = await callGemini(modelList(cfg), apiKey, body);
  const texto = extractText(raw);
  return extrairCapitulosRaw(texto); // { chaptersRaw, promoSemRaw }
}

// Classifica cada clip por sobreposição com "zonas" nomeadas (ex.: o trecho de
// seguro de um episódio). Regra: se mais de 50% da duração do clip cai dentro
// de uma zona, ele leva o nome dela; senão, cai no rótulo padrão ('podcast').
// Zona com maior sobreposição vence se o clip cruzar mais de uma.
function classificarClipsPorZona(clips, zonas, rotuloPadrao) {
  if (!zonas || !zonas.length) return clips;
  const padrao = rotuloPadrao || 'podcast';
  for (let i = 0; i < clips.length; i++) {
    const segs = clips[i].segmentos || [];
    const totalDur = segs.reduce((acc, s) => acc + (s.fim - s.inicio), 0);
    if (totalDur <= 0) { clips[i].categoria = padrao; continue; }

    let melhorZona = null, melhorOverlap = 0;
    for (let z = 0; z < zonas.length; z++) {
      const zona = zonas[z];
      let overlap = 0;
      for (let j = 0; j < segs.length; j++) {
        const ini = Math.max(segs[j].inicio, zona.inicio);
        const fim = Math.min(segs[j].fim, zona.fim);
        if (fim > ini) overlap += (fim - ini);
      }
      if (overlap > melhorOverlap) { melhorOverlap = overlap; melhorZona = zona; }
    }
    clips[i].categoria = (melhorZona && (melhorOverlap / totalDur) > 0.5) ? melhorZona.nome : padrao;
  }
  return clips;
}

// gerarCortes(segments, { quantidade, minDur, maxDur, onProgress, zonas }) -> Promise<{ clips: [...], promo: string }>
// zonas (opcional): [{ nome: 'seguro', inicio: 5459.0, fim: 7422.0 }, ...] â€”
// clips com mais de 50% de sobreposição numa zona recebem clip.categoria =
// zona.nome; os demais recebem 'podcast'. Sem zonas, categoria não é definida
// (comportamento idêntico ao anterior).
// excluir (opcional): [{ inicio, fim }, ...] â€” palavras dentro desses
// intervalos são removidas ANTES de montar os chunks, então o Gemini nem vê
// esse trecho e não desperdiça cortes nele (ex.: uma zona já coberta por
// outro lote de cortes, ou um desvio de tema já descartado).
// Episódios longos são processados em CHUNKS (com sobreposição) e os cortes
// somados â€” evita resposta truncada do modelo em transcrições gigantes.
async function gerarCortes(segments, opts) {
  opts = opts || {};
  const cfg = loadConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey || apiKey.indexOf('COLE_SUA_CHAVE') === 0) {
    throw new Error('Defina gemini_api_key em engine/config.json.');
  }

  if (opts.excluir && opts.excluir.length) {
    const antes = segments.length;
    segments = segments.filter((w) => !opts.excluir.some((r) => w.start >= r.inicio && w.start < r.fim));
    qcLog('cortes', 'exclusão de intervalo: ' + (antes - segments.length) + ' palavra(s) removida(s) de ' + opts.excluir.length + ' zona(s)');
  }

  const minD = opts.minDur && opts.minDur > 0 ? opts.minDur : 20;
  const maxD = opts.maxDur && opts.maxDur > 0 ? opts.maxDur : 90;
  const lines = buildTranscriptLines(segments);
  const chunks = chunkLines(lines);

  // Inicia geração do relatório de marketing (Forbes e YouTube) em paralelo
  let promo = null, chaptersRaw = '';
  const runPromo = (async () => {
    try {
      if (lines.length > 0) {
        qcLog('cortes', 'Iniciando geração paralela do relatório de marketing (Forbes/YouTube)…');
        const resPromo = await gerarPromoDoc(lines.join('\n'), cfg, apiKey);
        promo = resPromo.promoSemRaw;
        chaptersRaw = resPromo.chaptersRaw;
        qcLog('cortes', 'Relatório de marketing gerado com sucesso.');
      }
    } catch (e) {
      qcLog('cortes', 'Falha ao gerar o relatório de marketing: ' + e.message);
    }
  })();

  // Duração total da fala: vídeos de 1h+ têm material de sobra â€” sem quantidade
  // definida, garante um MÃ NIMO de 20 cortes (pedido da produção).
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

  qcLog('cortes', 'INÃ CIO â€” ' + lines.length + ' blocos de transcrição em ' + chunks.length + ' chunk(s), alvo: ' + alvo);
  let clips = [];
  let lastErr = null;
  for (let c = 0; c < chunks.length; c++) {
    if (opts.onProgress && chunks.length > 1) opts.onProgress('Analisando parte ' + (c + 1) + '/' + chunks.length + '…');
    if (c > 0) await wait(3000); // respiro entre chunks p/ não bater rate limit
    const body = {
      contents: [{ parts: [{ text: buildPrompt(chunks[c].join('\n'), alvo, minD, maxD, opts.tom, opts.instrucaoCustom, opts.modoMontagem) }] }],
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
      qcLog('cortes', 'chunk ' + (c + 1) + ' com JSON truncado â€” recuperados ' + parsed.clips.length + ' corte(s)');
    }
    clips = clips.concat(normalizeClips(parsed, minD, maxD));
  }
  // Deduplicação: cortes quase idênticos entre chunks vizinhos viram um só
  // (mantém o de melhor nota de hook).
  clips = dedupeClips(clips);
  qcLog('cortes', 'dedupe: ' + clips.length + ' corte(s) únicos')
  qcLog('cortes', 'FIM â€” ' + clips.length + ' corte(s) no total');

  // Aguarda a finalização do relatório promocional em segundo plano
  await runPromo;

  if (clips.length === 0) {
    if (lastErr) throw lastErr;
    throw new Error('O Gemini não encontrou cortes utilizáveis.');
  }
  if (opts.zonas && opts.zonas.length) {
    clips = classificarClipsPorZona(clips, opts.zonas, 'podcast');
    const porZona = {};
    for (let i = 0; i < clips.length; i++) porZona[clips[i].categoria] = (porZona[clips[i].categoria] || 0) + 1;
    qcLog('cortes', 'classificação por zona: ' + JSON.stringify(porZona));
  }
  if (total > 0 && clips.length > total) clips = clips.slice(0, total);
  return { clips: clips, promo: promo, chaptersRaw: chaptersRaw };
}

// Idiomas suportados no dropdown de legenda (código â†’ nome usado no prompt).
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
// nem divididas â€” o timing da legenda original é preservado.
async function corrigirLegendas(textos, opts) {
  opts = opts || {};
  const cfg = loadConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey || apiKey.indexOf('COLE_SUA_CHAVE') === 0) {
    throw new Error('Defina gemini_api_key em engine/config.json.');
  }
  if (!textos || !textos.length) return [];

  const alvo = opts.idioma && IDIOMAS[opts.idioma] ? IDIOMAS[opts.idioma] : null;
  qcLog('legenda', (alvo ? 'TRADUÇÃO para ' + alvo : 'correção pt-BR') + ' â€” ' + textos.length + ' linhas');

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
      : '- Ã‰ PROIBIDO mover palavras entre linhas: cada linha tem um TEMPO de exibição fixo, ' +
        'sincronizado com a fala. A linha corrigida deve ter EXATAMENTE as mesmas palavras da ' +
        'original (mesma quantidade, mesma ordem) â€” só conserte grafia, acentos e pontuação. ' +
        'NÃO redistribua texto para equalizar o tamanho das linhas. NÃŒO reescreva o sentido.\n') +
    '- Não adicione comentários.\n' +
    '\nEntrada (uma por linha, "indice<TAB>texto"):\n' + numbered + '\n\n' +
    'Responda APENAS em JSON: {"linhas":[{"i":0,"texto":"..."}, ...]}';

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };

  const raw = await callGemini(modelList(cfg, cfg.legenda_model), apiKey, body);
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
      // linhas (cada linha tem tempo fixo; re-flow dessincroniza texto Ã— fala).
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
  const m = String(s).match(/[\p{L}\p{N}]+(?:['â€™-][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

// corrigirPalavras(words) -> Promise<string[]> (mesmo tamanho/ordem).
// O Whisper em PT muitas vezes transcreve SEM pontuação â€” e o agrupamento de
// legendas quebra NA pontuação. Esta etapa roda ANTES do agrupamento: o Gemini
// recebe as palavras numeradas e devolve cada uma corrigida (acentos/grafia)
// e com a pontuação ANEXADA à palavra onde ela ocorre na fala. Validação
// rígida por item: 1 palavra entra â†’ 1 palavra sai (senão mantém a original).
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
      parsed = JSON.parse(extractText(await callGemini(modelList(cfg, cfg.legenda_model), apiKey, body)));
    } catch (e) {
      qcLog('legenda', 'pontuação: lote ' + (base / PALAVRAS_POR_LOTE + 1) + ' falhou (' + e.message + ') â€” mantendo palavras originais');
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

// ============================================================================
// PARTE 2 â€” gerarPodcastEditado (remontagem do episódio completo, 2 passadas)
// ============================================================================

// ---------- PASSADA 1: decidir o que cortar até bater a duração-alvo ----------

function buildTrimPrompt(transcript, alvoMinutos, duracaoOriginalMin) {
  return (
    'Você é um Editor de Podcast Sênior brasileiro, especialista em ritmo e corte de programas de entrevista longos.\n' +
    'Abaixo está a TRANSCRIÇÃO COMPLETA de um episódio de aproximadamente ' + duracaoOriginalMin + ' minutos, em blocos "[inicio-fim] texto" (segundos).\n\n' +
    'META: reduzir o episódio para uma duração final entre ' + Math.max(1, alvoMinutos - 5) + ' e ' + (alvoMinutos + 5) + ' minutos — alvo exato de ' + alvoMinutos + ' minutos, cortando o que tem MENOS valor para quem assiste o episódio completo.\n' +
    'NUNCA CORTE: perguntas do entrevistador que estruturam a entrevista, a abertura/apresentação, revelações e insights-chave, momentos de humor genuíno e qualquer trecho em que a fala é interrompida no meio (evite cortes que deixem frases pela metade).\n' +
    'ANTI-SOBRECORTE: é preferível ficar um pouco ACIMA da meta com o conteúdo íntegro do que cortar demais e quebrar a entrevista. Não force a meta cortando material bom.\n\n' +
    'PRIORIDADE DE CORTE (corte primeiro o topo da lista, só desça se precisar cortar mais para bater a meta):\n' +
    '1. Trechos que saem do tema central e servem só como material solto para reels/cortes, sem avançar a entrevista\n' +
    '2. Pausas longas, hesitação, problemas técnicos, retakes, conversa de bastidor não destinada ao episódio\n' +
    '3. Repetições e divagações sem valor novo\n' +
    '4. Se AINDA faltar cortar para bater a meta: trechos de desenvolvimento mais lento, mesmo relevantes, priorizando manter o que tem maior densidade de insight por minuto\n\n' +
    'REGRAS TÃ‰CNICAS:\n' +
    '- Use SOMENTE timestamps REAIS da transcrição â€” nunca invente tempos.\n' +
    '- Cada intervalo cortado deve ter começo/fim em fronteira natural de fala.\n' +
    '- Para cada corte, um motivo curto e específico (ex: "sai do tema para falar de futebol", "retake repetido do mesmo ponto", "trecho de menor densidade, cortado só para bater a meta de duração").\n' +
    '- Calcule e informe a duração total cortada e a duração estimada resultante.\n\n' +
    'Responda APENAS em JSON válido, sem markdown, no formato exato:\n' +
    '{"removidos":[{"inicio":610.2,"fim":680.8,"motivo":"..."}],"duracao_cortada_min":18.4,"duracao_estimada_final_min":121.6}\n\n' +
    'TRANSCRIÇÃO COMPLETA:\n"""\n' + transcript + '\n"""'
  );
}

async function gerarRemocoes(lines, alvoMinutos, duracaoOriginalMin, cfg, apiKey) {
  qcLog('podcast-editado', 'PASSADA 1 â€” decidindo cortes, meta ' + alvoMinutos + 'min (original ~' + duracaoOriginalMin + 'min)');

  const body = {
    contents: [{ parts: [{ text: buildTrimPrompt(lines.join('\n'), alvoMinutos, duracaoOriginalMin) }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
  };

  const text = extractText(await callGemini(modelList(cfg), apiKey, body));
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('Passada 1 (cortes) veio truncada ou inválida. Tente um modelo com limite de saída maior, ou reduza o episódio manualmente antes.');
  }

  const removidos = (parsed.removidos || [])
    .map((r) => ({ inicio: parseFloat(r.inicio), fim: parseFloat(r.fim), motivo: r.motivo || '(sem motivo informado)' }))
    .filter((r) => !isNaN(r.inicio) && !isNaN(r.fim) && r.fim > r.inicio);

  qcLog('podcast-editado', 'PASSADA 1 â€” ' + removidos.length + ' trecho(s) cortado(s), duração estimada final: ' + (parsed.duracao_estimada_final_min || '?') + 'min');
  return { removidos: removidos, duracaoEstimadaFinalMin: parsed.duracao_estimada_final_min || null };
}

// Filtra as linhas "[inicio-fim] texto" removendo as que se sobrepõem em mais
// de 50% a algum intervalo de "removidos". Retorna as linhas restantes, na
// mesma ordem, para alimentar a passada 2 (bem menor que a transcrição original).
function filtrarLinhasRemovidas(lines, removidos) {
  function parseLine(line) {
    const m = /^\[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\]/.exec(line);
    return m ? { inicio: parseFloat(m[1]), fim: parseFloat(m[2]) } : null;
  }
  function overlapFrac(a, r) {
    const ini = Math.max(a.inicio, r.inicio);
    const fim = Math.min(a.fim, r.fim);
    const inter = Math.max(0, fim - ini);
    const dur = a.fim - a.inicio;
    return dur > 0 ? inter / dur : 0;
  }
  return lines.filter((line) => {
    const iv = parseLine(line);
    if (!iv) return true; // linha sem timestamp reconhecível: mantém por segurança
    for (let i = 0; i < removidos.length; i++) {
      if (overlapFrac(iv, removidos[i]) > 0.5) return false;
    }
    return true;
  });
}

// ---------- PASSADA 2: estruturar o que sobrou ----------

function buildStructurePrompt(transcriptFiltrado, hookStyle) {
  const instrucaoHook = (hookStyle === 'jj')
    ? '1. hook - HOOK DE IMPACTO ESTILO "JOEL JOTA": Selecione de 3 a 5 recortes (total 30-60s) usando UM dos 4 arquétipos mais poderosos do episódio: (A) VULNERABILIDADE — o preço pessoal do sucesso (ausências de família, sacrifícios invisíveis, arrependimentos); (B) QUEBRA DE CRENÇA — afirmação contraintuitiva que destrói o óbvio do mercado (ex: "A gente não vende comida, a gente vende confiança"); (C) FUNDO DO POÇO — momento de quase falência, dívida crítica ou erro que mudou tudo; (D) REJEIÇÃO — atitude contraintuitiva de recusar clientes ou oportunidades, posicionamento de quem sabe o que não quer. REGRAS: Corte no ápice da tensão, NUNCA mostre a resolução. Cada frase deve ser completa — proibido corte no meio de fala.\n'
    : (hookStyle === 'diary')
    ? '1. hook - HOOK ESTILO "DIARY OF A CEO" (DIOC): Selecione de 3 a 5 recortes (6 a 10s cada) que criem um "Curiosity Gap" — começos de respostas obscuros ou provocativos que forçem o espectador a pensar "Como assim? Preciso entender". Aplique a Fórmula dos 5 Ps: Prova (autoridade do convidado), Promessa (o que o espectador vai aprender), Plano (direção sutil), Imagem (apelo visual ou mental marcante) e Dor (o problema ou sofrimento real que o episódio pretende resolver). PRIORIDADE: vulnerabilidades duradouras (traumas, medos reais, choro, confissões de fracasso) em vez de conquistas — o relatável vence o impressionante. REGRA CRUCIAL: cada trecho DEVE ser frase completa com início, meio e fim. Montagem final de 30 a 60s como trailer de filme.\n'
    : '1. hook - DESTAQUE DO EPISÓDIO: Selecione 1 a 3 recortes (8 a 20s cada) que contenham a informação mais surpreendente, valiosa ou emocionalmente forte do episódio. Priorize frases que gerem curiosidade ("Como assim?") ou ofereçam um insight poderoso e único. Cada trecho deve ter início, meio e fim claros — sem corte no meio de fala.\n'
  return (
    'Você é um Editor de Podcast Sênior brasileiro, especialista em remontagem narrativa e ritmo de programas de entrevista.\n' +
    'Abaixo está a transcrição JÃ  FILTRADA de um episódio (os trechos de menor valor já foram removidos em uma etapa anterior), em blocos "[inicio-fim] texto" (segundos).\n\n' +
    'TAREFA: organizar essa transcrição filtrada na estrutura de um podcast editado, NESSA ORDEM:\n' +
    instrucaoHook +
    '2. abertura â€” introdução original do podcast (vinheta falada, apresentação do programa).\n' +
    '3. apresentacao_participante â€” trecho de apresentação do(a) convidado(a) principal.\n' +
    '4. conversa_principal â€” corpo da entrevista com o(a) convidado(a) principal, em ordem lógica de assuntos (pode reordenar blocos entre si para melhorar fluidez, nunca invente conteúdo).\n' +
    '5. participante_extra â€” entrada de um segundo convidado/participante, se houver.\n' +
    '6. retorno_conversa_principal â€” volta ao(à) convidado(a) principal após a participação extra, se existir.\n' +
    '7. encerramento â€” despedida, CTA final, agradecimentos.\n' +
    'Se um bloco não existir no episódio, omita-o.\n\n' +
    'REGRAS TÃ‰CNICAS:\n' +
    '- Use SOMENTE os timestamps REAIS da transcrição fornecida.\n' +
    '- Um mesmo trecho PODE aparecer tanto no hook quanto na sua posição original no corpo (reuso esperado no hook).\n' +
    '- Não resuma nem reescreva falas â€” apenas selecione e ordene intervalos já existentes.\n\n' +
    'Responda APENAS em JSON válido, sem markdown, no formato exato:\n' +
    '{"podcast_editado":[{"bloco":"hook","ordem":1,"segmentos":[{"inicio":12.3,"fim":18.9},{"inicio":340.1,"fim":345.6}]},{"bloco":"abertura","ordem":2,"segmentos":[{"inicio":0.0,"fim":25.4}]}]}\n\n' +
    'TRANSCRIÇÃO FILTRADA:\n"""\n' + transcriptFiltrado + '\n"""'
  );
}

function normalizeEstrutura(parsed) {
  const blocos = [];
  const raw = (parsed && parsed.podcast_editado) || [];
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i] || {};
    const segs = (b.segmentos || [])
      .map((s) => ({ inicio: parseFloat(s.inicio), fim: parseFloat(s.fim) }))
      .filter((s) => !isNaN(s.inicio) && !isNaN(s.fim) && s.fim > s.inicio);
    if (b.bloco && segs.length > 0) {
      blocos.push({ bloco: b.bloco, ordem: b.ordem || (i + 1), segmentos: segs });
    }
  }
  blocos.sort((a, b) => a.ordem - b.ordem);
  return blocos;
}

async function gerarEstrutura(linesFiltradas, cfg, apiKey, hookStyle) {
  qcLog('podcast-editado', 'PASSADA 2 â€” estruturando ' + linesFiltradas.length + ' blocos restantes (hook: ' + (hookStyle || 'diary') + ')');

  const body = {
    contents: [{ parts: [{ text: buildStructurePrompt(linesFiltradas.join('\n'), hookStyle) }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
  };

  const text = extractText(await callGemini(modelList(cfg), apiKey, body));
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('Passada 2 (estrutura) veio truncada ou inválida.');
  }
  return normalizeEstrutura(parsed);
}

// gerarPodcastEditado(segments, opts) -> Promise<{ podcast_editado, removidos, duracaoEstimadaFinalMin, promo, chaptersRaw }>
// opts: { alvoDuracaoMin, hookStyle } â€” meta de duração final em minutos (padrão: 120);
// hookStyle: 'diary' (padrão, hook Diary of a CEO) ou 'padrao' (destaque simples do episódio)
async function gerarPodcastEditado(segments, opts) {
  opts = opts || {};
  const cfg = loadConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey || apiKey.indexOf('COLE_SUA_CHAVE') === 0) {
    throw new Error('Defina gemini_api_key em engine/config.json.');
  }

  const alvoMinutos = opts.alvoDuracaoMin && opts.alvoDuracaoMin > 0 ? opts.alvoDuracaoMin : 120;
  const hookStyle = (opts.hookStyle === 'padrao' || opts.hookStyle === 'jj' || opts.hookStyle === 'diary') ? opts.hookStyle : 'diary';
  const lines = buildTranscriptLines(segments);
  if (!lines.length) throw new Error('Transcrição vazia â€” nada para editar.');

  const duracaoOriginalMin = segments.length ? (segments[segments.length - 1].end / 60) : 0;
  qcLog('podcast-editado', 'INÃ CIO â€” duração original ~' + duracaoOriginalMin.toFixed(1) + 'min, meta ' + alvoMinutos + 'min');

  // Dossiê de marketing em paralelo â€” independente das decisões de edição,
  // roda sobre a transcrição completa original (mesmo padrão do gerarCortes).
  let promo = null, chaptersRaw = '';
  const runPromo = (async () => {
    try {
      qcLog('podcast-editado', 'Iniciando geração paralela do dossiê de marketing…');
      const resPromo = await gerarPromoDoc(lines.join('\n'), cfg, apiKey);
      promo = resPromo.promoSemRaw;
      chaptersRaw = resPromo.chaptersRaw;
      qcLog('podcast-editado', 'Dossiê de marketing gerado com sucesso.');
    } catch (e) {
      qcLog('podcast-editado', 'Falha ao gerar o dossiê de marketing: ' + e.message);
    }
  })();

  const { removidos, duracaoEstimadaFinalMin } = await gerarRemocoes(lines, alvoMinutos, duracaoOriginalMin.toFixed(0), cfg, apiKey);
  const linesFiltradas = filtrarLinhasRemovidas(lines, removidos);
  const podcastEditado = await gerarEstrutura(linesFiltradas, cfg, apiKey, hookStyle);

  await runPromo;

  qcLog('podcast-editado', 'FIM â€” ' + podcastEditado.length + ' bloco(s) estruturados, ' + removidos.length + ' trecho(s) removidos');
  return { podcast_editado: podcastEditado, removidos: removidos, duracaoEstimadaFinalMin: duracaoEstimadaFinalMin, promo: promo, chaptersRaw: chaptersRaw };
}

async function gerarHookApenas(segments, opts) {
  opts = opts || {};
  const cfg = loadConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey || apiKey.indexOf('COLE_SUA_CHAVE') === 0) {
    throw new Error('Defina gemini_api_key em engine/config.json.');
  }

  const hookStyle = (opts.hookStyle === 'padrao' || opts.hookStyle === 'jj' || opts.hookStyle === 'diary') ? opts.hookStyle : 'diary';
  const lines = buildTranscriptLines(segments);
  if (!lines.length) throw new Error('Transcrição vazia.');

  qcLog('gerar-hook', 'INÍCIO - solicitando apenas hook. Estilo: ' + hookStyle);

  const instrucaoHook = (hookStyle === 'jj')
    ? 'Aja como um arquiteto de retenção, montando um "Gancho de Impacto" estilo Joel Jota.\n' +
      'DIRETRIZES:\n' +
      '1. ESCOLHA UM ARQUÉTIPO: Identifique qual dos 4 é o mais poderoso no episódio e use-o como espinha dorsal:\n' +
      '   (A) VULNERABILIDADE — o preço pessoal que o sucesso cobra: ausências de família, sacrifícios invisíveis, momentos de arrependimento real.\n' +
      '   (B) QUEBRA DE CRENÇA — afirmação contraintuitiva que destrói o que o mercado acredita como óbvio. Ex: "A gente não vende comida, a gente vende confiança."\n' +
      '   (C) FUNDO DO POÇO — momento de quase falência, dívida crítica ou erro que mudou tudo. O ponto onde o convidado precisou parar de cavar e mudar de direção.\n' +
      '   (D) REJEIÇÃO — atitude contraintuitiva de recusar clientes, oportunidades ou o caminho óbvio. Posicionamento de quem sabe exatamente o que não quer.\n' +
      '2. REGRA DO ÁPICE: O último recorte deve terminar no ápice da tensão — NUNCA mostre a resolução, o desfecho ou a explicação do problema na intro.\n' +
      '3. ELIMINAR AUTOPILOTO: Nada de introduções burocráticas ("Olá, bem-vindos ao canal"). Comece imediatamente com a frase mais chocante ou reveladora do episódio.\n' +
      '4. RITMO E CADÊNCIA: Busque falas com ritmo ágil (150-180 palavras/min). Selecione de 3 a 5 recortes (6 a 10s cada), total de 30 a 60 segundos, trocando o estímulo a cada ~10 segundos.\n' +
      '5. SENTIDO COMPLETO: Apesar do corte abrupto no fim, cada frase precisa fazer sentido sozinha — nunca corte no meio de uma palavra ou ideia incompleta.\n' +
      '6. NEXO TOTAL: os recortes deslocados para a intro devem retomar a fala completa na sequência natural dela dentro do corpo (reuso integral da fala) — nada fica solto ou sem continuação.'
    : (hookStyle === 'diary')
    ? 'Aja como um caçador de "Curiosity Gaps", estilo Diary of a CEO (DIOC).\n' +
      'DIRETRIZES:\n' +
      '1. CURIOSITY GAP: Garimpe começos de respostas obscuros, surpreendentes ou altamente provocativos. O gancho deve fazer o espectador pensar: "Como assim? Preciso entender o contexto disso."\n' +
      '2. FÓRMULA DOS 5 Ps: Cruce Prova (quem é o convidado e por que tem autoridade), Promessa (o que o espectador vai aprender ou extrair de valioso), Plano (direção sutil de como o episódio se desenrola), Imagem (cortes com forte apelo visual ou descrição mental marcante) e Dor (o problema ou sofrimento real que o episódio pretende resolver).\n' +
      '3. VULNERABILIDADE SOBRE CONQUISTAS: Priorize "vulnerabilidades duradouras" — traumas, medos reais, choro, confissões de fracasso. O relatável vence o impressionante. Evite focar apenas em conquistas ("fiquei milionário", "criei uma grande empresa").\n' +
      '4. ELIMINAR AUTOPILOTO: Nunca comece com "Olá, bem-vindos". A intro deve começar com o pé no acelerador, entregando o gancho mais forte de imediato, sem burocracia.\n' +
      '5. REGRA CRUCIAL DE FRASE E RITMO: Cada recorte DEVE ser uma frase completa com início, meio e fim — é PROIBIDO cortar no meio de uma fala. Selecione EXATAMENTE 4 recortes (6 a 10s cada, trocando o estímulo a cada ~10 segundos) para uma montagem final de 30 a 60s como trailer de filme. DICA: 4 recortes de ~7-9s somam ~30-36s; acrescente um quinto recorte mais forte (até 10s) se precisar chegar perto de 60s.'
    : 'Selecione 1 a 3 recortes (8 a 25s cada) que contenham o momento mais surpreendente, valioso ou emocionalmente forte do episódio. Priorize frases que gerem curiosidade imediata ("Como assim?") ou ofereçam um insight poderoso e único. Cada trecho deve ter início, meio e fim claros — nunca corte no meio de uma fala. Pode ser um único trecho contínuo se já for forte o suficiente.'

  const prompt = 'Você é um Editor de Podcast Sênior especialista em retenção.\n' +
    'Abaixo está a transcrição de um episódio. ' +
    'Sua TAREFA ÚNICA é extrair um "Hook" (gancho de introdução) de alto impacto.\n\n' +
    'Instrução do Hook:\n' + instrucaoHook + '\n\n' +
    'REGRAS TÉCNICAS:\n' +
    '- Use SOMENTE os timestamps REAIS da transcrição fornecida.\n' +
    '- Não resuma nem reescreva falas. Use os tempos exatos do início da primeira palavra até o fim da última palavra da frase escolhida.\n\n' +
    'Responda APENAS em JSON válido no formato exato:\n' +
    '{"hook_segmentos":[{"inicio":12.3,"fim":18.9},{"inicio":340.1,"fim":345.6}]}\n\n' +
    'TRANSCRIÇÃO:\n"""\n' + lines.join('\n') + '\n"""';

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
  };

  const text = extractText(await callGemini(modelList(cfg), apiKey, body));
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('Retorno do Gemini veio truncado ou inválido.');
  }
  
  const segs = (parsed.hook_segmentos || [])
    .map(s => ({ inicio: parseFloat(s.inicio), fim: parseFloat(s.fim) }))
    .filter(s => !isNaN(s.inicio) && !isNaN(s.fim) && s.fim > s.inicio);
    
  if (segs.length === 0) throw new Error('Nenhum segmento de hook gerado pelo Gemini.');
  
  qcLog('gerar-hook', 'FIM - ' + segs.length + ' trechos selecionados para o hook.');
  return { hook_segmentos: segs };
}

// Extrai o sumário de capítulos do dossiê de marketing (texto "MM:SS - Nome"
// ou "HH:MM:SS - Nome") para gravar capitulos_youtube.txt e criar marcadores de
// capítulo na timeline. O dossiê é gerado em paralelo pelas funções
// gerarCortes/gerarPodcastEditado e este parser roda localmente, sem chamada à API.
function extractChapters(dossieText) {
  if (!dossieText) return { text: '', markers: [] };
  const lines = String(dossieText).split(/\r?\n/);
  const markers = [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    // aceita "MM:SS - Nome" e "HH:MM:SS - Nome" no começo da linha
    const m = /^(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–]\s*(.+)/.exec(lines[i]);
    if (!m) continue;
    const parts = m[1].split(':');
    let secs = 0;
    if (parts.length === 3) secs = +parts[0] * 3600 + +parts[1] * 60 + +parts[2];
    else secs = +parts[0] * 60 + +parts[1];
    const title = (m[2] || '').trim();
    if (!title || secs < 0) continue;
    markers.push({ seconds: secs, title: title });
    out.push(m[0].trim());
  }
  return { text: out.join('\n'), markers: markers };
}

module.exports = { extractChapters,  gerarCortes, corrigirLegendas, corrigirPalavras, gerarPodcastEditado, classificarClipsPorZona, gerarHookApenas };