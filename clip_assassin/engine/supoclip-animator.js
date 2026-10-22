// supoclip-animator.js
// Motor de Legendas Animadas estilo SupoClip (Hormozi, MrBeast, TikTok, Podcast)
// Gera arquivos .ASS avançados e renderiza Overlays de Vídeo Transparentes (ProRes 4444 com Alpha)

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const STYLES = {
  hormozi: {
    name: 'Hormozi (Pílula Verde + Pop)',
    font: 'Arial Black',
    fontSize: 72,
    primaryColor: '&H00FFFFFF',     // Branco
    highlightColor: '&H0000FF66',   // Verde brilhante
    outlineColor: '&H00000000',     // Preto
    boxColor: '&H8000BF49',         // Pílula verde semi-transparente
    outlineWidth: 5,
    shadow: 2,
    uppercase: true,
    wordPop: true,
    wordsPerLine: 3,
    posY: 1520                      // Terço inferior em 1080x1920
  },
  mrbeast: {
    name: 'MrBeast (Amarelo Bold + Destaque Vermelho)',
    font: 'Impact',
    fontSize: 76,
    primaryColor: '&H0000FFFF',     // Amarelo
    highlightColor: '&H00002DFF',   // Vermelho pop
    outlineColor: '&H00000000',     // Preto grosso
    boxColor: null,
    outlineWidth: 6,
    shadow: 3,
    uppercase: true,
    wordPop: true,
    wordsPerLine: 3,
    posY: 1480
  },
  tiktok: {
    name: 'TikTok (Rosa Neon + Pop)',
    font: 'Montserrat',
    fontSize: 66,
    primaryColor: '&H00FFFFFF',     // Branco
    highlightColor: '&H00552CFE',   // Rosa TikTok (#FE2C55 em BGR)
    outlineColor: '&H00000000',     // Preto
    boxColor: null,
    outlineWidth: 4,
    shadow: 2,
    uppercase: false,
    wordPop: true,
    wordsPerLine: 4,
    posY: 1520
  },
  podcast: {
    name: 'Podcast Clean (Dourado + Caixa Escura)',
    font: 'Arial',
    fontSize: 62,
    primaryColor: '&H00FFFFFF',     // Branco
    highlightColor: '&H0000B8FF',   // Dourado (#FFB800 em BGR)
    outlineColor: '&H001A1A1A',     // Grafite
    boxColor: '&H801A1A1A',         // Fundo escuro
    outlineWidth: 3,
    shadow: 0,
    uppercase: false,
    wordPop: false,
    wordsPerLine: 4,
    posY: 1540
  },
  minimal: {
    name: 'Minimalista (Branco Suave)',
    font: 'Arial',
    fontSize: 56,
    primaryColor: '&H00FFFFFF',
    highlightColor: '&H00FFFFFF',
    outlineColor: '&H00000000',
    boxColor: '&H80000000',
    outlineWidth: 2,
    shadow: 0,
    uppercase: false,
    wordPop: false,
    wordsPerLine: 5,
    posY: 1560
  }
};

function formatAssTime(seconds) {
  seconds = Math.max(0, parseFloat(seconds) || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor(Math.round((seconds - Math.floor(seconds)) * 100));
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`;
}

function escapeAss(text) {
  return String(text || '').replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}');
}

/**
 * Constrói o conteúdo .ASS a partir de palavras com timestamps
 * words: [{ start, end, text/word }]
 */
function buildAssSubtitles(words, styleKey, width, height) {
  width = width || 1080;
  height = height || 1920;
  const cfg = STYLES[styleKey] || STYLES.hormozi;

  // Ajusta posY proporcional se a resolução for diferente (ex: 16:9 horizontal)
  const isHorizontal = (width > height);
  const scaledPosY = isHorizontal ? Math.round(height * 0.82) : Math.round(height * (cfg.posY / 1920));
  const scaledFontSize = isHorizontal ? Math.round(cfg.fontSize * 0.75) : cfg.fontSize;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: SupoClip,${cfg.font},${scaledFontSize},${cfg.primaryColor},&H000000FF,${cfg.outlineColor},${cfg.boxColor || '&H00000000'},1,0,0,0,100,100,0,0,${cfg.boxColor ? 3 : 1},${cfg.outlineWidth},${cfg.shadow},2,40,40,${height - scaledPosY},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = [];
  const chunkSize = cfg.wordsPerLine || 3;
  const cleanWords = (words || []).map(w => ({
    start: parseFloat(w.start || 0),
    end: parseFloat(w.end || 0),
    text: (w.text || w.word || '').trim()
  })).filter(w => w.text && w.end > w.start);

  for (let i = 0; i < cleanWords.length; i += chunkSize) {
    const chunk = cleanWords.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const chunkEnd = chunk[chunk.length - 1].end;

    for (let localI = 0; localI < chunk.length; localI++) {
      const activeWord = chunk[localI];
      const start = activeWord.start;
      const end = (localI + 1 < chunk.length) ? chunk[localI + 1].start : chunkEnd;
      if (end <= start) continue;

      const spans = [];
      for (let localJ = 0; localJ < chunk.length; localJ++) {
        const item = chunk[localJ];
        let t = cfg.uppercase ? item.text.toUpperCase() : item.text;
        t = escapeAss(t);

        if (localJ === localI) {
          // Palavra ativa com highlight e opcional pop
          let tag = `\\c${cfg.highlightColor}`;
          if (cfg.boxColor) tag += `\\3c${cfg.boxColor}\\bord${cfg.outlineWidth + 2}`;
          spans.push(`{${tag}}${t}`);
        } else {
          // Palavra inativa
          let tag = `\\c${cfg.primaryColor}\\3c${cfg.outlineColor}\\bord${cfg.outlineWidth}`;
          spans.push(`{${tag}}${t}`);
        }
      }

      // Pop suave na entrada do bloco de palavras
      const entrance = (cfg.wordPop && localI === 0) ? '{\\fscx92\\fscy92\\t(0,120,\\fscx100\\fscy100)}' : '';
      const lineText = entrance + spans.join(' ');
      events.push(`Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},SupoClip,,0,0,0,,${lineText}`);
    }
  }

  return header + events.join('\n') + '\n';
}

/**
 * Renderiza um vídeo de sobreposição com fundo transparente (ProRes 4444 com Alpha)
 */
function renderTransparentMov(assPath, outMovPath, duration, width, height, fps) {
  return new Promise((resolve, reject) => {
    width = width || 1080;
    height = height || 1920;
    fps = fps || 30;
    duration = Math.max(1, parseFloat(duration) || 5);

    // Escapa o caminho do ASS para a sintaxe de filtro do FFmpeg no Windows
    const normAss = assPath.replace(/\\/g, '/');
    const escapedAss = normAss.replace(/:/g, '\\:');

    const cmd = `ffmpeg -y -f lavfi -i "color=c=black@0.0:size=${width}x${height}:rate=${fps}:duration=${duration},format=rgba" -vf "ass='${escapedAss}'" -c:v prores_ks -profile:v 4 -pix_fmt yuva444p10le "${outMovPath}"`;

    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // Fallback para QuickTime Animation (qtrle) com alpha caso prores_ks falhe
        const cmdRle = `ffmpeg -y -f lavfi -i "color=c=black@0.0:size=${width}x${height}:rate=${fps}:duration=${duration},format=rgba" -vf "ass='${escapedAss}'" -c:v qtrle "${outMovPath}"`;
        exec(cmdRle, (errRle) => {
          if (errRle) return reject(new Error('Falha ao renderizar overlay com FFmpeg: ' + (err.message || err)));
          resolve(outMovPath);
        });
        return;
      }
      resolve(outMovPath);
    });
  });
}

module.exports = {
  STYLES,
  buildAssSubtitles,
  renderTransparentMov
};
