// Gera arquivos .srt (um por corte) a partir das legendas curtas transcritas.
// Os tempos das legendas (timeline original) são RE-BASEADOS ao início de cada
// corte, respeitando que um corte pode juntar vários trechos não contíguos.

const fs = require('fs');
const path = require('path');

function pad(n, w) { n = '' + n; while (n.length < w) n = '0' + n; return n; }

function formatSrtTime(sec) {
  if (sec < 0) sec = 0;
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  let t = Math.floor(sec);
  const h = Math.floor(t / 3600); t -= h * 3600;
  const m = Math.floor(t / 60); const s = t - m * 60;
  return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + ',' + pad(ms, 3);
}

function sanitizeFile(name) {
  return String(name).replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, ' ').trim().substring(0, 80);
}

// Reagrupa palavras (segmentos -ml 1) em legendas curtas, QUEBRANDO na pontuação.
// Regras: fecha a legenda quando a palavra termina em , . ! ? ; : … OU quando
// passar de maxChars. Isso gera legendas curtas e sensíveis (mais fácil juntar
// no Premiere do que dividir). words: [{start,end,text}] em ordem.
function agruparPorPontuacao(words, maxChars) {
  maxChars = maxChars || 20;
  var out = [], cur = null;
  var fechaEm = /[,.!?;:…]$/;
  for (var i = 0; i < words.length; i++) {
    var t = (words[i].text || '').replace(/^\s+|\s+$/g, '');
    if (!t) continue;
    if (cur === null) {
      cur = { start: words[i].start, end: words[i].end, text: t };
    } else {
      var cand = cur.text + ' ' + t;
      if (cand.length > maxChars) {
        out.push(cur);
        cur = { start: words[i].start, end: words[i].end, text: t };
      } else {
        cur.text = cand;
        cur.end = words[i].end;
      }
    }
    if (fechaEm.test(t)) { out.push(cur); cur = null; } // quebra após pontuação
  }
  if (cur) out.push(cur);
  return out;
}

// Alinha os tempos das legendas às fronteiras de FRAME da sequência.
// O Premiere só posiciona legendas em frames inteiros: tempos "quebrados" no SRT
// são arredondados na importação (até ±meio frame, às vezes pro lado errado).
// Pré-alinhando aqui, a importação vira exata. Garante também duração mínima de
// 1 frame e nenhuma sobreposição entre legendas vizinhas.
function snapToFrames(caps, fps) {
  if (!fps || fps <= 0 || !caps || !caps.length) return caps;
  const dur = 1 / fps;
  const out = [];
  let prevEnd = 0;
  for (let i = 0; i < caps.length; i++) {
    let s = Math.round(caps[i].start / dur) * dur;
    let e = Math.round(caps[i].end / dur) * dur;
    if (s < prevEnd) s = prevEnd;          // não sobrepõe a legenda anterior
    if (e < s + dur) e = s + dur;          // pelo menos 1 frame de duração
    out.push({ start: s, end: e, text: caps[i].text });
    prevEnd = e;
  }
  return out;
}

// Monta o texto SRT de UM corte.
// segmentos: [{inicio, fim}] em SEGUNDOS da timeline original, na ordem do corte.
// captionSegs: [{start, end, text}] em SEGUNDOS da timeline original (ordenados).
function buildCutSrt(segmentos, captionSegs) {
  const lines = [];
  let idx = 1;
  let cutOffset = 0; // duração acumulada dos trechos anteriores do corte

  for (let g = 0; g < segmentos.length; g++) {
    const s = parseFloat(segmentos[g].inicio);
    const e = parseFloat(segmentos[g].fim);
    if (isNaN(s) || isNaN(e) || e <= s) continue;

    for (let c = 0; c < captionSegs.length; c++) {
      const cap = captionSegs[c];
      const cs = Math.max(cap.start, s);
      const ce = Math.min(cap.end, e);
      if (ce <= cs) continue; // não cai neste trecho
      const localStart = cutOffset + (cs - s);
      const localEnd = cutOffset + (ce - s);
      const txt = (cap.text || '').trim();
      if (!txt) continue;
      lines.push(idx + '\n' + formatSrtTime(localStart) + ' --> ' + formatSrtTime(localEnd) + '\n' + txt + '\n');
      idx++;
    }
    cutOffset += (e - s);
  }
  return lines.join('\n');
}

// Filtra as legendas que caem dentro de algum corte (reduz o que mandamos corrigir).
function captionsDentroDosCortes(captionSegs, clips) {
  const keep = [];
  for (let c = 0; c < captionSegs.length; c++) {
    const cap = captionSegs[c];
    let dentro = false;
    for (let i = 0; i < clips.length && !dentro; i++) {
      const segs = clips[i].segmentos || [];
      for (let g = 0; g < segs.length; g++) {
        const s = parseFloat(segs[g].inicio), e = parseFloat(segs[g].fim);
        if (cap.end > s && cap.start < e) { dentro = true; break; }
      }
    }
    if (dentro) keep.push(cap);
  }
  return keep;
}

// Escreve um .srt por corte. items: [{ fileBase, segmentos }].
// Retorna { dir, files: [paths] }.
function gerarLegendas(items, captionSegs, outDir) {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (let i = 0; i < items.length; i++) {
    const srt = buildCutSrt(items[i].segmentos || [], captionSegs);
    if (!srt.trim()) continue;
    const file = path.join(outDir, sanitizeFile(items[i].fileBase) + '.srt');
    fs.writeFileSync(file, srt, 'utf8');
    files.push(file);
  }
  return { dir: outDir, files: files };
}

// Faz o caminho inverso: lê um arquivo .srt (ex.: legendas AJUSTADAS na timeline
// e exportadas pelo painel Texto do Premiere) e devolve [{start,end,text}] em
// segundos. Linhas múltiplas de uma legenda são unidas com espaço.
function parseSrtContent(content) {
  const caps = [];
  const blocks = String(content).replace(/\r/g, '').split(/\n\n+/);
  const timeRe = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
  for (let b = 0; b < blocks.length; b++) {
    const lines = blocks[b].split('\n').filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) continue;
    let ti = -1, m = null;
    for (let i = 0; i < lines.length && ti === -1; i++) {
      m = timeRe.exec(lines[i]);
      if (m) ti = i;
    }
    if (ti === -1) continue;
    const start = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000;
    const end = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8].padEnd(3, '0')) / 1000;
    const text = lines.slice(ti + 1).join(' ').trim();
    if (text && end > start) caps.push({ start: start, end: end, text: text });
  }
  return caps;
}

module.exports = { gerarLegendas, captionsDentroDosCortes, buildCutSrt, agruparPorPontuacao, snapToFrames, parseSrtContent };
