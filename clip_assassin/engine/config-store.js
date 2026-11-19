'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
function userDir() {
  const base = process.env.LOCALAPPDATA || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')));
  return path.join(base, 'QuarksCuts');
}
function readConfig(file) {
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Configuração inválida: ' + file);
  return data;
}
function loadConfig() {
  const bundled = path.join(__dirname, 'config.json');
  const base = readConfig(fs.existsSync(bundled) ? bundled : path.join(__dirname, 'config.example.json'));
  let user = readConfig(path.join(userDir(), 'config.json'));
  // Migra instalações antigas sem perder a chave nem exigir escrita em Program Files.
  if (base.gemini_api_key && base.gemini_api_key.indexOf('COLE_') !== 0 && !user.gemini_api_key) {
    user = saveConfig({gemini_api_key:base.gemini_api_key});
    base.gemini_api_key = '';
    try { fs.writeFileSync(bundled, JSON.stringify(base,null,2) + '\n','utf8'); } catch(e) {}
  }
  return Object.assign({}, base, user);
}
function saveConfig(changes) {
  const dir = userDir();
  fs.mkdirSync(dir, {recursive:true, mode:0o700});
  const file = path.join(dir, 'config.json');
  const data = Object.assign({}, readConfig(file), changes);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), {encoding:'utf8', mode:0o600});
  return data;
}
function resolveBinary(configured, defaultName) {
  const bin = path.join(__dirname, '..', 'bin');
  if (configured) {
    const explicit = path.isAbsolute(configured) ? configured : path.join(bin, configured);
    if (fs.existsSync(explicit)) return explicit;
  }
  const bundled = path.join(bin, defaultName);
  return fs.existsSync(bundled) ? bundled : null;
}
module.exports = {userDir, loadConfig, saveConfig, resolveBinary};
