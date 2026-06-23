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

function run(cmd, args, onStderr) {
  return new Promise((resolve, reject) => {
    let err = '';
    const p = spawn(cmd, args, { windowsHide: true });
    p.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      if (onStderr) onStderr(s);
    });
    p.on('error', (e) => reject(new Error('Falha ao executar ' + path.basename(cmd) + ': ' + e.message)));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(path.basename(cmd) + ' saiu com código ' + code + '. ' + err.slice(-400)));
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
  return segs;
}

// transcribe(mediaPath, { onProgress, model }) -> Promise<{ segments, language }>
// opts.model: nome/caminho do modelo (sobrepõe o config) — usado pelo dropdown de qualidade.
// Saída em nível de PALAVRA (-ml 1): cada segmento é uma palavra com timestamp.
// A legenda reagrupa quebrando na pontuação; a seleção de cortes agrupa em blocos.
async function transcribe(mediaPath, opts) {
  opts = opts || {};
  const cfg = loadConfig();

  const ffmpeg = resolveBin(cfg.ffmpeg_path, 'ffmpeg.exe');
  const whisper = resolveBin(cfg.whisper_cli_path, 'whisper-cli.exe');
  const model = resolveBin(opts.model || cfg.whisper_model, 'ggml-small.bin');

  if (!ffmpeg) throw new Error('ffmpeg.exe não encontrado em bin/ (veja bin/README.md).');
  if (!whisper) throw new Error('whisper-cli.exe não encontrado em bin/ (veja bin/README.md).');
  if (!model) throw new Error('Modelo Whisper (.bin) não encontrado em bin/ (veja bin/README.md).');

  const stamp = Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const wavPath = path.join(os.tmpdir(), 'qc-' + stamp + '.wav');
  const outBase = path.join(os.tmpdir(), 'qc-' + stamp);
  const jsonPath = outBase + '.json';
  const lang = cfg.whisper_language || 'auto';

  try {
    if (opts.onProgress) opts.onProgress('Extraindo áudio (ffmpeg)…');
    await run(ffmpeg, ['-y', '-i', mediaPath, '-ar', '16000', '-ac', '1', '-vn', '-f', 'wav', wavPath]);

    if (opts.onProgress) opts.onProgress('Transcrevendo (Whisper offline)…');
    await run(
      whisper,
      ['-m', model, '-f', wavPath, '-l', lang, '-ml', '1', '-sow', '-oj', '-of', outBase],
      function (s) {
        // whisper.cpp imprime progresso em stderr; mantém o status "vivo".
        if (opts.onProgress) opts.onProgress('Transcrevendo (Whisper offline)…');
      }
    );

    if (!fs.existsSync(jsonPath)) throw new Error('Whisper não gerou o JSON esperado (' + jsonPath + ').');
    const segments = parseWhisperJson(jsonPath);
    if (segments.length === 0) throw new Error('Transcrição vazia — o vídeo tem fala audível?');
    return { segments: segments, language: lang };
  } finally {
    // limpeza dos temporários
    try { fs.existsSync(wavPath) && fs.unlinkSync(wavPath); } catch (e) {}
    try { fs.existsSync(jsonPath) && fs.unlinkSync(jsonPath); } catch (e) {}
  }
}

module.exports = { transcribe };
