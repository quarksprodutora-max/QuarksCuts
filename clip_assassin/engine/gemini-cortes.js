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

// curl.exe nativo do Windows (10/11). Roda como PROCESSO SEPARADO, então passa
// pelo firewall mesmo quando o Premiere.exe está bloqueado de acessar a internet
// (ex.: instalação não-oficial). É o mesmo motivo de ffmpeg/whisper funcionarem.
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
    if (res.status >= 200 && res.status < 300) return res.body;
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
    }
  }
  throw lastErr || new Error('Gemini indisponível.');
}

// Monta a lista de modelos (principal + fallback), sem vazios/duplicados.
function modelList(cfg) {
  const list = [cfg.clip_model || 'gemini-flash-latest'];
  const fb = cfg.clip_model_fallback || 'gemini-flash-lite-latest';
  if (fb && list.indexOf(fb) === -1) list.push(fb);
  return list;
}

// Monta a transcrição compacta "[ini-fim] texto" (segundos, 1 casa).
// Os segmentos vêm curtos (<=25 chars); agrupamos em blocos de ~200 chars
// para reduzir o tamanho do contexto enviado ao Gemini.
function buildTranscript(segments) {
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
  return lines.join('\n');
}

// Saneia/normaliza a resposta do Gemini no schema do painel.
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
    if (norm.length > 0) out.push({ titulo: c.titulo || ('Corte ' + (i + 1)), segmentos: norm });
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

// gerarCortes(segments, { quantidade, minDur, maxDur }) -> Promise<{ clips: [...] }>
async function gerarCortes(segments, opts) {
  opts = opts || {};
  const cfg = loadConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey || apiKey.indexOf('COLE_SUA_CHAVE') === 0) {
    throw new Error('Defina gemini_api_key em engine/config.json.');
  }

  const alvo = (opts.quantidade && opts.quantidade > 0) ? ('EXATAMENTE ' + opts.quantidade) : 'de 5 a 12';
  const minD = opts.minDur && opts.minDur > 0 ? opts.minDur : 20;
  const maxD = opts.maxDur && opts.maxDur > 0 ? opts.maxDur : 90;
  const transcript = buildTranscript(segments);

  const prompt =
    'Você é um editor de cortes (clips) brasileiro especialista em podcasts/entrevistas para Reels, TikTok e Shorts.\n' +
    'Abaixo está a TRANSCRIÇÃO do episódio, uma linha por trecho no formato "[inicio-fim] texto", onde inicio e fim são SEGUNDOS do vídeo original.\n\n' +
    'Tarefa: escolha ' + alvo + ' cortes virais e autossuficientes, cada um com ' + minD + ' a ' + maxD + ' segundos de duração total.\n' +
    'Regras:\n' +
    '- Cada corte deve fazer sentido sozinho, com começo e fim de raciocínio.\n' +
    '- Comece pelo GANCHO mais forte: a ordem dos segmentos dentro do corte é a ordem em que aparecerão (pode reordenar para o gancho vir primeiro).\n' +
    '- Use os timestamps REAIS da transcrição; não invente tempos.\n' +
    '- Um corte pode juntar mais de um trecho (vários segmentos), mas mantenha-o coeso.\n' +
    '- titulo: chamada curta e atrativa em pt-BR (sem hashtags).\n\n' +
    'Responda APENAS em JSON válido, sem markdown, no formato exato:\n' +
    '{"clips":[{"titulo":"...","segmentos":[{"inicio":12.3,"fim":58.7}]}]}\n\n' +
    'TRANSCRIÇÃO:\n"""\n' + transcript + '\n"""';

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
  };

  const raw = await callGemini(modelList(cfg), apiKey, body);
  let parsed;
  try { parsed = JSON.parse(extractText(raw)); } catch (e) { throw new Error('O Gemini não retornou JSON de cortes válido.'); }
  const clips = normalizeClips(parsed);
  if (clips.length === 0) throw new Error('O Gemini não encontrou cortes utilizáveis.');
  return { clips: clips };
}

// corrigirLegendas(textos[]) -> Promise<string[]> (mesma quantidade/ordem).
// Corrige ortografia/acentuação SEM juntar/dividir linhas (preserva o timing).
async function corrigirLegendas(textos) {
  const cfg = loadConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey || apiKey.indexOf('COLE_SUA_CHAVE') === 0) {
    throw new Error('Defina gemini_api_key em engine/config.json.');
  }
  if (!textos || !textos.length) return [];

  const numbered = textos.map((t, i) => i + '\t' + t).join('\n');
  const prompt =
    'Corrija ortografia, acentuação e pontuação leve das legendas abaixo, em pt-BR.\n' +
    'REGRAS IMPORTANTES:\n' +
    '- NÃO junte nem divida linhas: a saída tem EXATAMENTE a mesma quantidade de itens, na mesma ordem.\n' +
    '- Mantenha cada linha curta (máx ~25 caracteres). Não adicione comentários.\n' +
    '- Corrija só o texto; não traduza, não reescreva o sentido.\n\n' +
    'Entrada (uma por linha, "indice<TAB>texto"):\n' + numbered + '\n\n' +
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
  for (let k = 0; k < arr.length; k++) {
    const i = parseInt(arr[k].i, 10);
    if (!isNaN(i) && i >= 0 && i < out.length && typeof arr[k].texto === 'string' && arr[k].texto.trim()) {
      out[i] = arr[k].texto.trim();
    }
  }
  return out;
}

module.exports = { gerarCortes, corrigirLegendas };
