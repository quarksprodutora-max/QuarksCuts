// ============================================================================
// QUARKS CUTS — SERVIDOR MCP INTERNO (mcp-server.js)
// Roda dentro do painel CEP (com Node.js habilitado).
// Inicia um servidor HTTP local em 127.0.0.1 e grava a conexão em:
// %LOCALAPPDATA%\QuarksCuts\mcp-connection.json
//
// Permite que Antigravity, Claude, ChatGPT ou Cursor controlem o Premiere Pro
// e acessem diretamente o cache local do Whisper!
// ============================================================================

(function () {
  'use strict';

  var http, fs, path, os, crypto;
  try {
    http = require('http');
    fs = require('fs');
    path = require('path');
    os = require('os');
    crypto = require('crypto');
  } catch (e) {
    console.warn('[Quarks MCP] Node.js core modules não disponíveis.');
    return;
  }

  var DEFAULT_PORT = 39281;
  var serverInstance = null;
  var currentPort = 0;
  var authToken = '';

  function getAppDataDir() {
    var base = process.env.LOCALAPPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')));
    return path.join(base, 'QuarksCuts');
  }

  function getCacheDir() {
    return path.join(getAppDataDir(), 'cache');
  }

  function getConnectionFilePath() {
    var dir = getAppDataDir();
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    }
    return path.join(dir, 'mcp-connection.json');
  }

  function writeConnectionFile(port, token) {
    var p = getConnectionFilePath();
    var data = {
      port: port,
      token: token,
      url: 'http://127.0.0.1:' + port + '/mcp',
      pid: process.pid,
      updatedAt: new Date().toISOString()
    };
    try {
      fs.writeFileSync(p, JSON.stringify(data, null, 2), {encoding:'utf8',mode:0o600});
      console.log('[Quarks MCP] Conexão gravada com sucesso em:', p);
    } catch (e) {
      console.error('[Quarks MCP] Falha ao gravar arquivo de conexão:', e);
    }
  }

  function removeConnectionFile() {
    var p = getConnectionFilePath();
    try {
      if (fs.existsSync(p) && JSON.parse(fs.readFileSync(p,'utf8')).token === authToken) fs.unlinkSync(p);
    } catch (e) {}
  }

  function isLoopback(addr) {
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  }

  // Avalia código ExtendScript via CSInterface de forma assíncrona com Promise
  function evalExtendScriptAsync(script) {
    return new Promise(function (resolve) {
      var csi = typeof csInterface !== 'undefined' ? csInterface : (typeof window !== 'undefined' && window.csInterface ? window.csInterface : null);
      if (!csi && typeof CSInterface !== 'undefined') {
        try { csi = new CSInterface(); } catch (e) {}
      }
      if (!csi) {
        return resolve('ERROR: CSInterface não está disponível no contexto do painel.');
      }
      try {
        csi.evalScript(script, function (result) {
          resolve(result);
        });
      } catch (err) {
        resolve('ERROR: ' + (err.message || String(err)));
      }
    });
  }

  // --- GERENCIADOR DE CACHE DO WHISPER ---
  function listCachedTranscripts() {
    var cacheRoot = getCacheDir();
    if (!fs.existsSync(cacheRoot)) return [];
    var entries = fs.readdirSync(cacheRoot);
    var items = [];

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var fullPath = path.join(cacheRoot, entry);
      try {
        var stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          var files = fs.readdirSync(fullPath);
          var transcripts = files.filter(function (f) { return f.indexOf('transcript-') === 0 && f.indexOf('.json') !== -1; });
          var hasAudio = files.indexOf('audio.wav') !== -1;
          var seqName = entry.indexOf('__') !== -1 ? entry.split('__').slice(1).join('__') : entry;

          items.push({
            folder: entry,
            sequenceName: seqName,
            hasTranscript: transcripts.length > 0,
            transcriptFiles: transcripts,
            hasAudio: hasAudio,
            modified: stat.mtime.toISOString()
          });
        }
      } catch (e) {}
    }
    items.sort(function (a, b) { return new Date(b.modified) - new Date(a.modified); });
    return items;
  }

  // Executores de Ferramentas MCP
  var toolHandlers = {
    quarks_list_cached_transcripts: async function () {
      var list = listCachedTranscripts();
      return { total: list.length, items: list };
    },

    quarks_get_timeline_info: async function () {
      var jsx = [
        '(function() {',
        '  try {',
        '    var seq = app.project ? app.project.activeSequence : null;',
        '    if (!seq) return JSON.stringify({ ok: false, error: "Nenhuma sequência aberta na timeline." });',
        '    var fps = 30;',
        '    try { if (seq.timebase) fps = (254016000000 / seq.timebase); } catch(eFps) {}',
        '    var durSec = 0;',
        '    try { if (seq.end) durSec = (Number(seq.end) / 254016000000); } catch(eDur) {}',
        '    var playheadSec = 0;',
        '    try { playheadSec = (Number(seq.getPlayerPosition().ticks) / 254016000000); } catch(eP) {}',
        '    var cacheKey = "";',
        '    try { if (typeof qcActiveCacheKey === "function") cacheKey = qcActiveCacheKey(); } catch(eCk) {}',
        '    return JSON.stringify({',
        '      ok: true,',
        '      projectName: app.project ? app.project.name : "",',
        '      sequenceName: seq.name,',
        '      sequenceId: seq.sequenceID,',
        '      cacheKey: cacheKey,',
        '      durationSeconds: Math.round(durSec * 100) / 100,',
        '      playheadSeconds: Math.round(playheadSec * 100) / 100,',
        '      fps: fps,',
        '      videoTracks: seq.videoTracks ? seq.videoTracks.numTracks : 0,',
        '      audioTracks: seq.audioTracks ? seq.audioTracks.numTracks : 0',
        '    });',
        '  } catch(e) {',
        '    return JSON.stringify({ ok: false, error: e.toString() });',
        '  }',
        '})()'
      ].join('\n');

      var res = await evalExtendScriptAsync(jsx);
      try {
        return JSON.parse(res);
      } catch (e) {
        return { ok: false, raw: res };
      }
    },

    quarks_eval_extendscript: async function (args) {
      if (!args || !args.script) throw new Error('Parâmetro script é obrigatório.');
      var result = await evalExtendScriptAsync(args.script);
      return { output: result };
    },

    quarks_cut_silence: async function (args) {
      if (typeof qcRunSilence !== 'function') throw new Error('Painel ainda não inicializado.');
      return {ok:true, result:await qcRunSilence(args || {})};
    },
    quarks_apply_jcut: async function (args) {
      if (typeof qcRunJCut !== 'function') throw new Error('Painel ainda não inicializado.');
      return {ok:true, result:await qcRunJCut(args || {})};
    },
    quarks_add_chapter_markers: async function (args) {
      if (!args || !Array.isArray(args.chapters) || !args.chapters.length) throw new Error('Lista de capítulos vazia.');
      var lines = args.chapters.map(function(c) {
        if (!c || typeof c.seconds !== 'number' || !Number.isFinite(c.seconds) || c.seconds < 0 || typeof c.title !== 'string' || !c.title.trim()) throw new Error('Capítulo inválido: use seconds e title.');
        return c.seconds + '|' + c.title.replace(/[|\r\n]/g,' ');
      }).join('\n');
      var result = await evalExtendScriptAsync('qcAddChapterMarkers(' + JSON.stringify(lines) + ');');
      return checkedHost(result);
    },
    quarks_insert_srt: async function (args) {
      if (!args || typeof args.srtPath !== 'string' || !args.srtPath) throw new Error('srtPath obrigatório.');
      return checkedHost(await evalExtendScriptAsync('qcAttachSrtToActiveSequence(' + JSON.stringify(args.srtPath) + ');'));
    },

    quarks_export_frame: async function (args) {
      if (!args || args.seconds === undefined) throw new Error('Parâmetro seconds obrigatório.');
      var sec = args.seconds;
      if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) throw new Error('seconds deve ser um número não negativo.');
      var outPath = args.outputPath || path.join(os.tmpdir(), 'quarks_frame_' + Math.round(sec) + '.png');
      outPath = outPath.replace(/\\/g, '/');

      var script = [
        '(function() {',
        '  var seq = app.project ? app.project.activeSequence : null;',
        '  if (!seq) return "ERROR: Nenhuma sequência ativa.";',
        '  var ticks = String(Math.round(' + sec + ' * 254016000000));',
        '  var prevTime = seq.getPlayerPosition();',
        '  seq.setPlayerPosition(ticks);',
        '  try {',
        '    var ok = seq.exportFramePNG(ticks, ' + JSON.stringify(outPath) + ');',
        '    return ok ? ' + JSON.stringify(outPath) + ' : "ERROR: Falha ao exportar frame.";',
        '  } finally { seq.setPlayerPosition(prevTime.ticks); }',
        '})()'
      ].join('\n');

      var res = await evalExtendScriptAsync(script);
      if (res.indexOf('ERROR') === 0) {
        return { ok: false, error: res };
      }
      return { ok: true, path: res };
    },

    quarks_unnest_sequence: async function () {
      var res = await evalExtendScriptAsync('quarksUnnestActive();');
      return checkedHost(res);
    }
  };

  function checkedHost(result) {
    if (typeof result !== 'string' || !/^(OK|SUCCESS):/.test(result)) throw new Error(result || 'Premiere não confirmou a operação.');
    return {ok:true,result:result};
  }
  var descriptions = {
    quarks_list_cached_transcripts: 'Lista transcrições locais.',
    quarks_get_timeline_info: 'Lê sequência ativa e FPS sem arredondamento.',
    quarks_eval_extendscript: 'Executa ExtendScript no Premiere; pode modificar o projeto.',
    quarks_cut_silence: 'Remove silêncios e aguarda o resultado; backup habilitado conforme painel.',
    quarks_apply_jcut: 'Aplica J-Cuts e aguarda o resultado.',
    quarks_add_chapter_markers: 'Insere capítulos na sequência ativa.',
    quarks_insert_srt: 'Insere SRT na sequência ativa.',
    quarks_export_frame: 'Exporta um frame PNG.',
    quarks_unnest_sequence: 'Desaninha a sequência ativa.'
  };
  var properties = {
    quarks_eval_extendscript:{script:{type:'string',minLength:1}},
    quarks_cut_silence:{thresholdDb:{type:'number',maximum:0},minDurationMs:{type:'number',exclusiveMinimum:0},paddingMs:{type:'number',minimum:0},trackIndex:{type:'integer',minimum:-1},mode:{type:'string',enum:['razor','lift','ripple']},backup:{type:'boolean'},autoThreshold:{type:'boolean'}},
    quarks_apply_jcut:{frames:{type:'integer',minimum:1,maximum:120},backup:{type:'boolean'}},
    quarks_add_chapter_markers:{chapters:{type:'array',minItems:1,items:{type:'object',required:['seconds','title'],properties:{seconds:{type:'number',minimum:0},title:{type:'string',minLength:1}},additionalProperties:false}}},
    quarks_insert_srt:{srtPath:{type:'string',minLength:1}},
    quarks_export_frame:{seconds:{type:'number',minimum:0},outputPath:{type:'string',minLength:1}}
  };
  var required = {quarks_eval_extendscript:['script'],quarks_add_chapter_markers:['chapters'],quarks_insert_srt:['srtPath'],quarks_export_frame:['seconds']};
  var definitions = Object.keys(toolHandlers).map(function(name) {
    return {name:name,description:descriptions[name],inputSchema:{type:'object',properties:properties[name] || {},required:required[name] || [],additionalProperties:false}};
  });
  var inFlight = false;
  async function dispatch(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return {jsonrpc:'2.0',id:null,error:{code:-32600,message:'Requisição inválida'}};
    if (msg.id === undefined) return null; // Notificações não executam ferramentas nem recebem resposta RPC.
    var result, error;
    try {
      if (msg.method === 'initialize') result = {protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:false}},serverInfo:{name:'quarks-cuts',version:'1.2.0'}};
      else if (msg.method === 'ping') result = {};
      else if (msg.method === 'tools/list') result = {tools:definitions};
      else if (msg.method === 'tools/call') {
        var name = msg.params && msg.params.name;
        if (!Object.prototype.hasOwnProperty.call(toolHandlers,name)) throw new Error('Ferramenta desconhecida: ' + name);
        var args = msg.params.arguments || {};
        if (typeof args !== 'object' || Array.isArray(args)) throw new Error('Argumentos inválidos.');
        if (inFlight || (typeof qcBusy !== 'undefined' && qcBusy)) throw new Error('Outra operação está em andamento.');
        inFlight = true;
        var ownsPanelLock = name !== 'quarks_cut_silence' && name !== 'quarks_apply_jcut' && typeof qcSetBusy === 'function';
        if (ownsPanelLock) qcSetBusy(true);
        try {
          var data = await toolHandlers[name](args);
          if (name === 'quarks_eval_extendscript' && /^ERROR:|^EvalScript error/i.test(String(data.output))) throw new Error(data.output);
          result = {content:[{type:'text',text:JSON.stringify(data,null,2)}],isError:!!(data && data.ok === false)};
        } finally { inFlight = false; if (ownsPanelLock) qcSetBusy(false); }
      } else error = {code:-32601,message:'Método não suportado: ' + msg.method};
    } catch(e) {
      result = {content:[{type:'text',text:e.message || String(e)}],isError:true};
    }
    return error ? {jsonrpc:'2.0',id:msg.id,error:error} : {jsonrpc:'2.0',id:msg.id,result:result};
  }

  function handleMcpRequest(req, res) {
    function send(code, data) { res.writeHead(code, {'Content-Type':'application/json'}); res.end(data === undefined ? '' : JSON.stringify(data)); }
    if (!isLoopback(req.socket.remoteAddress)) return send(403,{error:'Apenas conexões locais.'});
    if (req.url !== '/mcp') return send(404,{error:'Endpoint desconhecido.'});
    var origin = req.headers.origin;
    if (origin) {
      try { var u = new URL(origin); if (!/^https?:$/.test(u.protocol) || ['localhost','127.0.0.1','[::1]'].indexOf(u.hostname) < 0) return send(403,{error:'Origem não permitida.'}); }
      catch(e) { return send(403,{error:'Origem inválida.'}); }
    }
    if (req.headers.authorization !== 'Bearer ' + authToken) return send(401,{error:'Token inválido.'});
    if (req.method !== 'POST') return send(405,{error:'Use POST. SSE não disponível.'});
    var chunks = [], bytes = 0, oversized = false;
    req.on('data',function(chunk) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { if (!oversized) send(413,{error:'Corpo excede 1 MB.'}); oversized = true; chunks = []; return; }
      if (!oversized) chunks.push(chunk);
    });
    req.on('end',async function() {
      if (oversized) return;
      var data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch(e) { return send(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'JSON inválido'}}); }
      var batch = Array.isArray(data), messages = batch ? data : [data], replies = [];
      if (!messages.length) return send(400,{jsonrpc:'2.0',id:null,error:{code:-32600,message:'Lote vazio'}});
      for (var i=0;i<messages.length;i++) { var reply = await dispatch(messages[i]); if (reply) replies.push(reply); }
      if (!replies.length) return send(202);
      send(200,batch ? replies : replies[0]);
    });
  }

  function start(preferredPort) {
    if (serverInstance) return;
    preferredPort = preferredPort === undefined ? DEFAULT_PORT : preferredPort;
    authToken = crypto.randomBytes(16).toString('hex');

    serverInstance = http.createServer(handleMcpRequest);

    serverInstance.on('error', function (err) {
      if (err.code === 'EADDRINUSE') {
        console.warn('[Quarks MCP] Porta ' + preferredPort + ' em uso, tentando porta aleatória livre...');
        serverInstance.listen(0, '127.0.0.1');
      } else {
        console.error('[Quarks MCP] Erro no servidor:', err);
      }
    });

    serverInstance.listen(preferredPort, '127.0.0.1', function () {
      var addr = serverInstance.address();
      currentPort = addr.port;
      console.log('[Quarks MCP] Servidor ativo em 127.0.0.1:' + currentPort);
      writeConnectionFile(currentPort, authToken);
      updateUIBadge(true, currentPort);
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', stop);
    }
  }

  function stop() {
    if (serverInstance) {
      try { serverInstance.close(); } catch (e) {}
      serverInstance = null;
    }
    currentPort = 0;
    removeConnectionFile();
    updateUIBadge(false, 0);
  }

  function updateUIBadge(active, port) {
    if (typeof document === 'undefined') return;
    var el = document.getElementById('qcMcpBadge');
    if (!el) return;
    if (active) {
      el.style.display = 'inline-flex';
      el.textContent = '🟢 MCP Ativo (' + port + ')';
      el.title = 'Servidor MCP conectado e pronto para Antigravity / Claude / ChatGPT';
    } else {
      el.style.display = 'none';
    }
  }

  var api = {
    start: start,
    stop: stop,
    isRunning: function () { return Boolean(serverInstance && serverInstance.listening); },
    getPort: function () { return currentPort; }
  };

  // Exporta em todos os escopos globais possíveis no CEF / Node
  if (typeof window !== 'undefined') window.QuarksMcpServer = api;
  if (typeof global !== 'undefined') global.QuarksMcpServer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // Auto-inicia o servidor assim que o arquivo é avaliado
  try {
    if (typeof window !== 'undefined') start(DEFAULT_PORT);
  } catch (eStart) {
    console.warn('[Quarks MCP] Falha no auto-start inicial:', eStart);
  }

  return api;
})();
