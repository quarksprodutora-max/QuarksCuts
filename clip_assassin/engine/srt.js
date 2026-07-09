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
// Funde legendas CURTÍSSIMAS com a vizinha: em fala rápida, quebras por
// pontuação geram legendas de 0,3-0,5s ("não,", "olha,") que piscam rápido
// demais para ler. Funde com a próxima (ou anterior, se for a última) quando
// o texto combinado continua curto o bastante para caber bem na tela.
const MIN_CAP_DUR = 0.7;   // segundos
const MERGE_MAX_CHARS = 38;

function mergeShortCaptions(caps) {
  if (!caps || caps.length < 2) return caps;
  const out = caps.map(function (c) { return { start: c.start, end: c.end, text: c.text }; });
  for (let i = 0; i < out.length; i++) {
    if (out[i].end - out[i].start >= MIN_CAP_DUR) continue;
    const next = out[i + 1], prev = out[i - 1];
    // Direção respeita a pontuação (senão desfaz a quebra por frase):
    // termina com pontuação = fim de frase/cláusula → pertence à ANTERIOR;
    // sem pontuação = começo de ideia → pertence à PRÓXIMA.
    const fecha = /[.,!?;:…]$/.test(out[i].text);
    const podePrev = prev && (prev.text + ' ' + out[i].text).length <= MERGE_MAX_CHARS;
    const podeNext = next && (out[i].text + ' ' + next.text).length <= MERGE_MAX_CHARS &&
                     !/[.,!?;:…]$/.test(out[i].text); // nunca arrasta pontuação p/ o meio
    if (fecha && podePrev) {
      prev.text = prev.text + ' ' + out[i].text;
      prev.end = out[i].end;
      out.splice(i, 1); i--;
    } else if (podeNext) {
      next.text = out[i].text + ' ' + next.text;
      next.start = out[i].start;
      out.splice(i, 1); i--;
    } else if (podePrev && !/[.,!?;:…]$/.test(prev.text)) {
      // último recurso: junta com a anterior se ELA não fecha frase
      prev.text = prev.text + ' ' + out[i].text;
      prev.end = out[i].end;
      out.splice(i, 1); i--;
    }
    // sem vizinho que caiba: fica curta mesmo (melhor que texto gigante)
  }
  return out;
}

const GAP_MAX = 0.4; // buracos menores que isso entre legendas são fechados

// leadSec: antecipa a ENTRADA de cada legenda (prática padrão de legendagem —
// legenda entrando um tiquinho antes da fala é percebida como sincronizada;
// entrando depois, como atrasada). Nunca invade a legenda anterior.
function snapToFrames(caps, fps, leadSec) {
  if (!fps || fps <= 0 || !caps || !caps.length) return caps;
  const lead = leadSec || 0;
  const dur = 1 / fps;
  const out = [];
  let prevEnd = 0;
  for (let i = 0; i < caps.length; i++) {
    let s = Math.round(Math.max(0, caps[i].start - lead) / dur) * dur;
    let e = Math.round(caps[i].end / dur) * dur;
    if (s < prevEnd) s = prevEnd;          // não sobrepõe a legenda anterior
    if (e < s + dur) e = s + dur;          // pelo menos 1 frame de duração
    out.push({ start: s, end: e, text: caps[i].text });
    prevEnd = e;
  }
  // Fecha micro-gaps ("respiros"): a legenda anterior estica até a próxima
  // quando o buraco é pequeno — padrão de legendagem, leitura mais confortável.
  for (let i = 0; i < out.length - 1; i++) {
    const gap = out[i + 1].start - out[i].end;
    if (gap > 0 && gap <= GAP_MAX) out[i].end = out[i + 1].start;
  }
  return out;
}

// Monta o texto SRT de UM corte.
// segmentos: [{inicio, fim}] em SEGUNDOS da timeline original, na ordem do corte.
// captionSegs: [{start, end, text}] em SEGUNDOS da timeline original (ordenados).
function buildCutSrt(segmentos, captionSegs) {
  const lines = [];
  let idx = 1;

  // 1. Criar um mapeamento da timeline original para a timeline do corte
  const cutTimelineMap = []; // [{ originalStart, originalEnd, cutStart, cutEnd }]
  let currentCutOffset = 0;
  for (const seg of segmentos) {
    const s = parseFloat(seg.inicio);
    const e = parseFloat(seg.fim);
    if (isNaN(s) || isNaN(e) || e <= s) continue;
    cutTimelineMap.push({ originalStart: s, originalEnd: e, cutStart: currentCutOffset, cutEnd: currentCutOffset + (e - s) });
    currentCutOffset += (e - s);
  }

  // 2. Processar cada legenda original
  for (const cap of captionSegs) {
    const originalCapStart = cap.start;
    const originalCapEnd = cap.end;
    const txt = (cap.text || '').trim();
    if (!txt) continue;

    const rebasedCaptionParts = [];

    // Encontrar todas as partes da legenda original que caem nos segmentos do corte
    for (const mapEntry of cutTimelineMap) {
      const intersectionStartOriginal = Math.max(originalCapStart, mapEntry.originalStart);
      const intersectionEndOriginal = Math.min(originalCapEnd, mapEntry.originalEnd);

      if (intersectionEndOriginal > intersectionStartOriginal) {
        // Há uma interseção. Calcular o tempo re-baseado para esta parte da legenda.
        const localStart = mapEntry.cutStart + (intersectionStartOriginal - mapEntry.originalStart);
        const localEnd = mapEntry.cutStart + (intersectionEndOriginal - mapEntry.originalStart);
        rebasedCaptionParts.push({ start: localStart, end: localEnd, text: txt });
      }
    }

    // 3. Consolidar as partes re-baseadas em entradas SRT, respeitando gaps
    if (rebasedCaptionParts.length > 0) {
      // Ordenar as partes para garantir processamento correto
      rebasedCaptionParts.sort((a, b) => a.start - b.start);

      let currentSrtEntryStart = rebasedCaptionParts[0].start;
      let currentSrtEntryEnd = rebasedCaptionParts[0].end;

      for (let i = 1; i < rebasedCaptionParts.length; i++) {
        const part = rebasedCaptionParts[i];
        // Se a parte atual é contígua ou muito próxima da anterior, estender a entrada SRT
        // Definimos um pequeno limiar para considerar contíguo e evitar fragmentação excessiva
        const CONTIGUITY_THRESHOLD = 0.05; // 50ms
        if (part.start - currentSrtEntryEnd <= CONTIGUITY_THRESHOLD) {
          currentSrtEntryEnd = part.end; // Estender o fim
        } else {
          // Se há um gap significativo, finalizar a entrada atual e começar uma nova
          lines.push(idx + '\n' + formatSrtTime(currentSrtEntryStart) + ' --> ' + formatSrtTime(currentSrtEntryEnd) + '\n' + txt + '\n');
          idx++;
          currentSrtEntryStart = part.start;
          currentSrtEntryEnd = part.end;
        }
      }
      // Adicionar a última entrada SRT
      lines.push(idx + '\n' + formatSrtTime(currentSrtEntryStart) + ' --> ' + formatSrtTime(currentSrtEntryEnd) + '\n' + txt + '\n');
      idx++;
    }
  }
  return lines.join('\n');
}

function buildCutSrt(segmentos, captionSegs) {
  const lines = [];
  let idx = 1;

  // Pré-calcular o mapeamento de tempo do original para o corte
  // Isso cria uma função que, dado um tempo na timeline original, retorna o tempo correspondente na timeline do corte
  const originalToCutTimeMap = (function() {
    const map = []; // [{originalStart, originalEnd, cutStart, cutEnd}]
    let currentCutTime = 0;
    for (const seg of segmentos) {
      const s = parseFloat(seg.inicio);
      const e = parseFloat(seg.fim);
      if (isNaN(s) || isNaN(e) || e <= s) continue;
      map.push({ originalStart: s, originalEnd: e, cutStart: currentCutTime, cutEnd: currentCutTime + (e - s) });
      currentCutTime += (e - s);
    }

    return function(originalTime) {
      for (const entry of map) {
        if (originalTime >= entry.originalStart && originalTime < entry.originalEnd) {
          return entry.cutStart + (originalTime - entry.originalStart);
        }
      }
      return null; // Tempo original não está em nenhum segmento do corte
    };
  })();

  // Iterar sobre cada legenda original
  for (const cap of captionSegs) {
    const originalCapStart = cap.start;
    const originalCapEnd = cap.end;
    const txt = (cap.text || '').trim();
    if (!txt) continue;

    let rebasedStart = null;
    let rebasedEnd = null;

    // Encontrar o início e fim da legenda na timeline do corte
    // Percorrer os segmentos do corte para ver onde a legenda original se encaixa
    let currentCutOffset = 0;
    for (const seg of segmentos) {
      const s = parseFloat(seg.inicio);
      const e = parseFloat(seg.fim);
      if (isNaN(s) || isNaN(e) || e <= s) continue;

      // Calcular a interseção da legenda com o segmento atual
      const intersectionStartOriginal = Math.max(originalCapStart, s);
      const intersectionEndOriginal = Math.min(originalCapEnd, e);

      if (intersectionEndOriginal > intersectionStartOriginal) {
        // Há uma interseção. Calcular o tempo re-baseado para esta parte da legenda.
        const localIntersectionStart = currentCutOffset + (intersectionStartOriginal - s);
        const localIntersectionEnd = currentCutOffset + (intersectionEndOriginal - s);

        if (rebasedStart === null) {
          rebasedStart = localIntersectionStart;
        }
        rebasedEnd = localIntersectionEnd; // Sempre estender o fim re-baseado
      }
      currentCutOffset += (e - s);
    }

    // Se a legenda foi encontrada em pelo menos um segmento do corte
    if (rebasedStart !== null && rebasedEnd !== null && rebasedEnd > rebasedStart) {
      lines.push(idx + '\n' + formatSrtTime(rebasedStart) + ' --> ' + formatSrtTime(rebasedEnd) + '\n' + txt + '\n');
      idx++;
    }
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

module.exports = { gerarLegendas, captionsDentroDosCortes, buildCutSrt, agruparPorPontuacao, snapToFrames, parseSrtContent, mergeShortCaptions };
