// Log em arquivo do painel Quarks Cuts — diário de tudo que acontece, para
// diagnosticar problemas nas máquinas da equipe sem depender de print de tela.
//
// Destino: %APPDATA%\QuarksCuts\panel.log (a pasta da extensão fica em Program
// Files, que NÃO é gravável sem admin). Rotação simples: >1 MB vira panel.old.log.
// Logging é best-effort: NUNCA lança exceção (um log quebrado não pode derrubar
// o fluxo principal).

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_DIR = path.join(process.env.APPDATA || os.tmpdir(), 'QuarksCuts');
const LOG_FILE = path.join(LOG_DIR, 'panel.log');
const MAX_BYTES = 1024 * 1024; // 1 MB

function ts() {
  const d = new Date();
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
    ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
}

function rotateIfNeeded() {
  try {
    const st = fs.statSync(LOG_FILE);
    if (st.size > MAX_BYTES) {
      const old = path.join(LOG_DIR, 'panel.old.log');
      try { fs.existsSync(old) && fs.unlinkSync(old); } catch (e) {}
      fs.renameSync(LOG_FILE, old);
    }
  } catch (e) { /* arquivo ainda não existe */ }
}

// qcLog('transcribe', 'mensagem') → "[2026-07-05 14:32:01] [transcribe] mensagem"
function qcLog(area, msg) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, '[' + ts() + '] [' + area + '] ' + String(msg) + '\r\n', 'utf8');
  } catch (e) { /* best-effort: nunca propaga erro de log */ }
}

module.exports = { qcLog, LOG_FILE };
