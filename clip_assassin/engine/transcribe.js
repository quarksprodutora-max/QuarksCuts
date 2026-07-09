// Transcrição offline dentro do painel CEP (Node habilitado no manifest).
// Fluxo: ffmpeg (extrai WAV 16kHz mono) -> whisper-cli.exe (whisper.cpp, -oj)
// -> parseia o JSON de saída em segmentos { start, end, text } (em segundos).
//
// Binários esperados (autocontidos) em clip_assassin/bin/ — ver bin/README.md.
// Caminhos podem ser sobrescritos em engine/config.json.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { qcLog } = require('./log.js');

const ENGINE_DIR = __dirname;
const BIN_DIR = path.join(ENGINE_DIR, '..', 'bin');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ENGINE_DIR, 'config.json'), 'utf8'));
  } catch (e) {
    return {};
  }
}

// Resolve um binário do config: caminho ABSOLUTO usa direto; caminho RELATIVO
// é resolvido dentro de bin/ (bundle portável). Se nada bater, tenta o default
// em bin/. Retorna null se não achar.
function resolveBin(cfgPath, defaultName) {
  if (cfgPath) {
    var c = path.isAbsolute(cfgPath) ? cfgPath : path.join(BIN_DIR, cfgPath);
    if (fs.existsSync(c)) return c;
  }
  var p = path.join(BIN_DIR, defaultName);
  if (fs.existsSync(p)) return p;
  return null;
}

// Resolve o MODELO pedido no dropdown de qualidade. Procura, nesta ordem:
// caminho absoluto → bin/ da extensão → a PASTA do modelo configurado no
// config (quem guarda os modelos fora da extensão, como no INSTALL.bat da
// máquina de desenvolvimento, tem todos os .bin lado a lado).
function resolveModelo(override, cfgModel) {
  if (override) {
    if (path.isAbsolute(override)) return fs.existsSync(override) ? override : null;
    var noBin = path.join(BIN_DIR, override);
    if (fs.existsSync(noBin)) return noBin;
    if (cfgModel && path.isAbsolute(cfgModel)) {
      var aoLado = path.join(path.dirname(cfgModel), override);
      if (fs.existsSync(aoLado)) return aoLado;
    }
    return null; // pedido explícito não encontrado: NÃO cair em outro modelo
  }
  return resolveBin(cfgModel, 'ggml-small.bin');
}

// Sem saída por este tempo = processo travado (ex.: Windows suspendeu no meio
// e o processo nunca voltou) → mata e retorna erro claro, em vez de o painel
// ficar "Transcrevendo…" para sempre.
const STALL_MS = 10 * 60 * 1000;

function run(cmd, args, onStderr, collect) {
  return new Promise((resolve, reject) => {
    let err = '';
    let out = '';
    let lastActivity = Date.now();
    let settled = false;
    const t0 = Date.now();
    qcLog('run', path.basename(cmd) + ' ' + args.join(' '));
    const p = spawn(cmd, args, {
      windowsHide: true,
      env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }),
    });

    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > STALL_MS) {
        clearInterval(watchdog);
        if (!settled) {
          settled = true;
          try { p.kill('SIGKILL'); } catch (e) {}
          qcLog('run', 'WATCHDOG matou ' + path.basename(cmd) + ' após ' + Math.round((Date.now() - t0) / 1000) + 's sem atividade');
          reject(new Error(path.basename(cmd) + ' ficou ' + Math.round(STALL_MS / 60000) +
            ' min sem responder e foi finalizado. Tente de novo (evite suspender o PC durante o processo).'));
        }
      }
    }, 60 * 1000);

    p.stdout.on('data', (d) => {
      lastActivity = Date.now();
      if (collect) out += d.toString();
    });
    p.stderr.on('data', (d) => {
      lastActivity = Date.now();
      const s = d.toString();
      err += s;
      if (onStderr) onStderr(s);
    });
    p.on('error', (e) => {
      clearInterval(watchdog);
      if (!settled) { settled = true; reject(new Error('Falha ao executar ' + path.basename(cmd) + ': ' + e.message)); }
    });
    p.on('close', (code) => {
      clearInterval(watchdog);
      if (settled) return;
      settled = true;
      const secs = Math.round((Date.now() - t0) / 1000);
      if (code === 0) {
        qcLog('run', path.basename(cmd) + ' OK em ' + secs + 's');
        resolve(out);
      } else {
        qcLog('run', path.basename(cmd) + ' FALHOU código ' + code + ' em ' + secs + 's. stderr: ' + err.slice(-400));
        reject(new Error(path.basename(cmd) + ' saiu com código ' + code + '. ' + err.slice(-400)));
      }
    });
  });
}

// Converte os "offsets" (ms) do JSON do whisper.cpp em segundos.
function parseWhisperJson(jsonPath) {
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const tr = raw.transcription || [];
  const segs = [];
  for (let i = 0; i < tr.length; i++) {
    const o = tr[i].offsets || {};
    const text = (tr[i].text || '').trim();
    if (!text) continue;
    segs.push({
      start: (o.from || 0) / 1000,
      end: (o.to || 0) / 1000,
      text: text,
    });
  }
  return filterHallucinations(segs);
}

// Filtro anti-alucinação (portado do transcriber.py do VoxFlow, adaptado para
// a saída em nível de PALAVRA do whisper.cpp com -ml 1). Em trechos de música,
// silêncio ou ruído o Whisper alucina: anotações tipo "[Música]"/"♪" e loops
// de palavra/frase ("obrigado obrigado obrigado…", "você sabe você sabe…").
function qcNormWord(t) {
  return String(t).toLowerCase().replace(/^[.,!?"'…¿¡()\[\]]+|[.,!?"'…¿¡()\[\]]+$/g, '');
}

function filterHallucinations(words) {
  // 1) artefatos não-fala: [Música], (Aplausos), ♪♫, legendas de comunidade
  const clean = words.filter(function (w) {
    const t = w.text.trim();
    if (/^[\[\(].*[\]\)]$/.test(t)) return false;
    if (/[♪♫]/.test(t)) return false;
    return true;
  });

  // 2) colapsa loops: se a palavra repete a de p posições atrás (período 1..5)
  //    por 2+ ciclos completos da "frase", descarta o excedente. Mantém até
  //    2 repetições (fala real tem "não, não, não"; 3+ ciclos é alucinação).
  const drop = new Array(clean.length).fill(false);
  for (let p = 1; p <= 5; p++) {
    let run = 0;
    for (let i = p; i < clean.length; i++) {
      const cur = qcNormWord(clean[i].text);
      if (cur !== '' && cur === qcNormWord(clean[i - p].text)) {
        run++;
        if (run >= p * 2) drop[i] = true;
      } else {
        run = 0;
      }
    }
  }
  return clean.filter(function (w, i) { return !drop[i]; });
}

// Preset do -dtw a partir do nome do arquivo do modelo (ggml-small.bin →
// "small", ggml-large-v3.bin → "large.v3"). null = modelo não reconhecido
// (não passa -dtw; melhor sem do que com preset errado).
function dtwPreset(modelPath) {
  const n = path.basename(String(modelPath)).toLowerCase();
  if (n.indexOf('large-v3') !== -1 || n.indexOf('large.v3') !== -1) return 'large.v3';
  if (n.indexOf('large-v2') !== -1 || n.indexOf('large.v2') !== -1) return 'large.v2';
  if (n.indexOf('large-v1') !== -1) return 'large.v1';
  if (n.indexOf('medium.en') !== -1) return 'medium.en';
  if (n.indexOf('medium') !== -1) return 'medium';
  if (n.indexOf('small.en') !== -1) return 'small.en';
  if (n.indexOf('small') !== -1) return 'small';
  if (n.indexOf('base.en') !== -1) return 'base.en';
  if (n.indexOf('base') !== -1) return 'base';
  if (n.indexOf('tiny.en') !== -1) return 'tiny.en';
  if (n.indexOf('tiny') !== -1) return 'tiny';
  return null;
}

// Resolve o caminho do modelo que SERIA usado para uma dada opção (ou o padrão
// do config). Síncrono — usado pelo painel para nomear o cache SEM precisar
// rodar a transcrição (ex.: decidir se já existe transcript-<modelo>.json).
function resolveModelPath(modelOverride) {
  const cfg = loadConfig();
  return resolveModelo(modelOverride, cfg.whisper_model);
}

// transcribe(mediaPath, { onProgress, model }) -> Promise<{ segments, language }>
// opts.model: nome/caminho do modelo (sobrepõe o config) — usado pelo dropdown de qualidade.
// Saída em nível de PALAVRA (-ml 1): cada segmento é uma palavra com timestamp.
// A legenda reagrupa quebrando na pontuação; a seleção de cortes agrupa em blocos.
async function transcribe(mediaPath, opts) {
  opts = opts || {};
  const cfg = loadConfig();

  // Motor "fw:<tamanho>" — faster-whisper (fw-words.exe): alinhamento de
  // palavra por cross-attention, mais preciso que o whisper.cpp em fala
  // contínua/rápida. Decodifica a mídia sozinho (sem passo de ffmpeg).
  if (opts.model && opts.model.indexOf('fw:') === 0) {
    return transcribeFw(mediaPath, opts.model.substring(3), cfg, opts);
  }

  const ffmpeg = resolveBin(cfg.ffmpeg_path, 'ffmpeg.exe');
  const whisper = resolveBin(cfg.whisper_cli_path, 'whisper-cli.exe');
  const model = resolveModelo(opts.model, cfg.whisper_model);

  if (!ffmpeg) throw new Error('ffmpeg.exe não encontrado em bin/ (veja bin/README.md).');
  if (!whisper) throw new Error('whisper-cli.exe não encontrado em bin/ (veja bin/README.md).');
  if (!model) {
    if (opts.model) {
      const onde = cfg.whisper_model && path.isAbsolute(cfg.whisper_model)
        ? path.dirname(cfg.whisper_model) : BIN_DIR;
      throw new Error('O modelo "' + opts.model + '" não está instalado. Baixe-o em ' +
        'huggingface.co/ggerganov/whisper.cpp e coloque em: ' + onde +
        ' — ou escolha outra Qualidade no dropdown.');
    }
    throw new Error('Modelo Whisper (.bin) não encontrado em bin/ (veja bin/README.md).');
  }

  qcLog('transcribe', 'INÍCIO — mídia: ' + mediaPath + ' | modelo: ' + path.basename(model));

  const stamp = Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const wavPath = path.join(os.tmpdir(), 'qc-' + stamp + '.wav');
  const outBase = path.join(os.tmpdir(), 'qc-' + stamp);
  const jsonPath = outBase + '.json';
  const lang = cfg.whisper_language || 'auto';

  try {
    if (opts.onProgress) opts.onProgress('Extraindo áudio (ffmpeg)…');
    await run(ffmpeg, ['-y', '-i', mediaPath, '-ar', '16000', '-ac', '1', '-vn', '-f', 'wav', wavPath]);

    if (opts.onProgress) opts.onProgress('Transcrevendo (Whisper offline)… 0%');
    let lastPct = 0;
    // -dtw: timestamps token-a-token por alinhamento (DTW) — reduz o "jitter"
    // dos tempos por palavra (legenda ora adiantada, ora atrasada). O preset
    // precisa casar com o modelo; se não reconhecermos, seguimos sem -dtw.
    const dtw = dtwPreset(model);
    const args = ['-m', model, '-f', wavPath, '-l', lang, '-ml', '1', '-sow', '-pp', '-oj', '-of', outBase];
    if (dtw) args.push('-dtw', dtw);
    // VAD (Silero): ancora os tempos ao início/fim REAIS de fala — melhora muito
    // a sincronia em fala rápida e evita legenda "espalhada" sobre pausas.
    // Procura o modelo ao lado do modelo Whisper e em bin/; sem ele, segue sem VAD.
    const vad = resolveModelo('ggml-silero-v5.1.2.bin', cfg.whisper_model);
    if (vad) args.push('--vad', '-vm', vad, '-vp', '60');
    qcLog('transcribe', 'dtw=' + (dtw || 'off') + ' vad=' + (vad ? 'on' : 'off'));
    await run(
      whisper,
      args,
      function (s) {
        // -pp faz o whisper.cpp imprimir "progress = NN%" no stderr.
        const m = /progress\s*=\s*(\d+)%/.exec(s);
        if (m) lastPct = parseInt(m[1], 10);
        if (opts.onProgress) opts.onProgress('Transcrevendo (Whisper offline)… ' + lastPct + '%');
      }
    );

    if (!fs.existsSync(jsonPath)) throw new Error('Whisper não gerou o JSON esperado (' + jsonPath + ').');
    const segments = parseWhisperJson(jsonPath);
    qcLog('transcribe', 'FIM — ' + segments.length + ' palavras transcritas');
    if (segments.length === 0) throw new Error('Transcrição vazia — o vídeo tem fala audível?');
    return { segments: segments, language: lang };
  } finally {
    // limpeza dos temporários
    try { fs.existsSync(wavPath) && fs.unlinkSync(wavPath); } catch (e) {}
    try { fs.existsSync(jsonPath) && fs.unlinkSync(jsonPath); } catch (e) {}
  }
}

// Transcrição via fw-words.exe (faster-whisper standalone).
// Procura o exe em: cfg.fw_words_path (absoluto) → bin/fw-words/fw-words.exe.
async function transcribeFw(mediaPath, size, cfg, opts) {
  let exe = cfg.fw_words_path || '';
  if (exe && !fs.existsSync(exe)) exe = '';
  if (!exe) {
    const p = path.join(BIN_DIR, 'fw-words', 'fw-words.exe');
    if (fs.existsSync(p)) exe = p;
  }
  if (!exe) {
    throw new Error('fw-words.exe (motor faster-whisper) não está instalado nesta máquina. ' +
      'Use outra Qualidade no dropdown, ou instale o pacote completo.');
  }

  qcLog('transcribe', 'INÍCIO (faster-whisper ' + size + ') — mídia: ' + mediaPath);
  if (opts.onProgress) opts.onProgress('Transcrevendo (faster-whisper)… 0%');
  let lastPct = 0;
  const out = await run(exe, [mediaPath, size], function (s) {
    const m = /progress\s*=\s*(\d+)%/.exec(s);
    if (m) lastPct = parseInt(m[1], 10);
    if (opts.onProgress) opts.onProgress('Transcrevendo (faster-whisper)… ' + lastPct + '%');
  }, true);

  const line = String(out).trim().split('\n').filter(Boolean).pop() || '';
  let data;
  try { data = JSON.parse(line); } catch (e) { throw new Error('fw-words não retornou JSON válido.'); }
  if (data.error) throw new Error('faster-whisper: ' + data.error);

  const segs = (data.words || []).map(function (w) {
    return { start: w.s, end: w.e, text: String(w.t).trim() };
  }).filter(function (w) { return w.text; });
  const filtered = filterHallucinations(segs);
  qcLog('transcribe', 'FIM (faster-whisper) — ' + filtered.length + ' palavras');
  if (filtered.length === 0) throw new Error('Transcrição vazia — o vídeo tem fala audível?');
  return { segments: filtered, language: data.language || 'auto' };
}

module.exports = { transcribe, resolveModelPath };
