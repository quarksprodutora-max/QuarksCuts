'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {EventEmitter} = require('events');
const os = require('os');
const root = path.join(__dirname,'..');
let passed = 0;
async function test(name,fn) { await fn(); passed++; console.log('OK ' + name); }
function element(id) {
  const classes = new Set();
  return {id,style:{},dataset:{},value:'',textContent:'',children:[],handlers:{},checked:false,disabled:false,
    classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:x=>classes.has(x)?classes.delete(x):classes.add(x)},
    addEventListener(type,fn){this.handlers[type]=fn;},appendChild(child){this.children.push(child);},
    querySelectorAll(){return this.children.filter(x=>x.type==='text');},focus(){},setSelectionRange(){}};
}
function panel() {
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  const elements = {}, load=[];
  const context={console,Promise,Set,Map,Number,JSON,Date,setTimeout,
    document:{getElementById:id=>elements[id]||null,querySelectorAll:()=>[],createElement:()=>element('')},
    window:{addEventListener:(name,fn)=>load.push(fn)},navigator:{clipboard:{writeText:async()=>{}}},
    CSInterface:function(){this.evalScript=()=>{};},QuarksHostBridge:require('../engine/panel-bridge.js'),
    AutoCutAudio:{analyzeWavFile:()=>({dbfs:[-60]}),detectSilenceRegions:()=>[[100,500]],suggestThreshold:()=>-32}
  };
  vm.createContext(context);
  // Simula o parsing progressivo: só elementos anteriores ao script existem.
  let cursor=0;
  const scripts=/<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  for(let m;(m=scripts.exec(html));) {
    for(const x of html.slice(cursor,m.index).matchAll(/\bid="([^"]+)"/g)) elements[x[1]]=element(x[1]);
    if(m[1].trim()) vm.runInContext(m[1],context,{filename:'index-inline.js'});
    cursor=scripts.lastIndex;
  }
  context.qcPanelLog=()=>{};
  return {context,elements,load};
}
function host() {
  const clip={start:{ticks:'0'},end:{ticks:'100'},inPoint:{ticks:'0'},outPoint:{ticks:'100'},components:{numItems:0},
    projectItem:{nodeId:'media',getMediaPath:()=>'/media.wav',isSequence:()=>false}};
  const track={clips:{0:clip,numItems:1},isMuted:()=>false};
  const seq={sequenceID:'seq1',name:'Episódio',end:'100',timebase:'10',projectItem:{nodeId:'node1'},videoTracks:{numTracks:0},audioTracks:{0:track,numTracks:1}};
  function File(file){this.exists=false;this.fsName=file;}
  const ctx={app:{project:{path:'/p1.prproj',documentID:'doc1',activeSequence:seq,sequences:{0:seq,numSequences:1}}},File,JSON};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'jsx/hostscript.jsx'),'utf8'),ctx);
  return {ctx,seq,clip};
}
async function main() {
  await test('painel carrega todos os handlers com DOM progressivo, incluindo CapCut e acabamentos',()=>{
    const p=panel();
    for(const id of ['qcOpenSubEditorBtn','qcCloseSubModal','qcSubApplySrtBtn','qcAcRunSilenceBtn','qcAcRunJCutBtn']) assert(p.elements[id].handlers.click,id);
    assert.equal(p.load.length,1);
  });
  await test('editor abre, carrega legendas e libera botões após transcrição',async()=>{
    const {context:c,elements:e}=panel();
    c.qcLoadEngine=()=>({srtMod:require('../engine/srt.js')});c.qcResolvePreset=()=>'/preset';
    c.qcExportAndTranscribe=async()=>({sequenceId:'seq1',cacheKey:'k',segments:[{start:0,end:1,text:'Olá'},{start:1,end:2,text:'mundo.'}]});
    c.qcHostCall=async()=>({sequenceId:'seq1',fps:30});
    await e.qcOpenSubEditorBtn.handlers.click();
    assert(e.qcSubEditorModal.classList.contains('open'));assert.equal(c.qcSubCards.length,1);assert.equal(c.qcBusy,false);
  });
  await test('erro de transcrição aparece no painel e não deixa botões bloqueados',async()=>{
    const {context:c,elements:e}=panel();c.qcLoadEngine=()=>({});c.qcResolvePreset=()=>'/preset';
    c.qcExportAndTranscribe=async()=>{throw new Error('Transcritor ausente');};
    await e.qcOpenSubEditorBtn.handlers.click();assert(e.status.textContent.includes('Transcritor ausente'));assert.equal(c.qcBusy,false);
  });
  const srt=require('../engine/srt.js');
  await test('Enter respeita palavras e não cria legendas vazias nas bordas; SRT transporta milissegundos',()=>{
    const card=srt.agruparEstiloCapCut([{start:0,end:0.9,text:'Uma'},{start:1.4,end:2,text:'frase'}],3)[0];
    assert.equal(srt.splitCaption(card,0,30),null);assert.equal(srt.splitCaption(card,card.text.length,30),null);
    assert.equal(srt.splitCaption(card,4,30)[0].end,1.4);
    assert.equal(srt.formatSrtTime(59.9996),'00:01:00,000');
    assert.throws(()=>srt.gerarSrtTexto([{start:1,end:1,text:'erro'}]));
  });
  await test('cache muda após edição, troca de projeto e alteração de fonte',()=>{
    const {ctx:c,clip}=host();const first=c.qcActiveCacheKey();assert(first.startsWith('OK:v2_'));assert.equal(c.qcActiveCacheKey(),first);
    clip.inPoint.ticks='5';assert.notEqual(c.qcActiveCacheKey(),first);
    const second=c.qcActiveCacheKey();c.app.project.path='/p2.prproj';assert.notEqual(c.qcActiveCacheKey(),second);
    const third=c.qcActiveCacheKey();clip.projectItem.nodeId='replacement';assert.notEqual(c.qcActiveCacheKey(),third);
  });
  await test('ponte rejeita erro ou resposta inválida e preserva aspas e quebras nos argumentos',async()=>{
    const bridge=require('../engine/panel-bridge.js');
    for(const raw of ['ERROR: falhou','EvalScript error.','{}','undefined','{"ok":false,"error":"backup"}']) await assert.rejects(bridge.call({evalScript:(_s,cb)=>cb(raw)},'qcGetTimelineContext'));
    const value='C:\\Meu "Vídeo"\nlegenda.srt';let received;
    await bridge.call({evalScript:(script,cb)=>{vm.runInNewContext(script,{qcTest:x=>{received=x;}});cb('OK:feito');}},'qcTest',[value]);
    assert.equal(received,value);
  });
  for(const action of ['qcRunSilence','qcRunJCut']) await test(action+' interrompe antes da edição quando backup falha',async()=>{
    const {context:c,elements:e}=panel();c.qcLoadEngine=()=>({});c.qcResolvePreset=()=>'/preset';
    const calls=[];c.qcHostCall=async(name)=>{calls.push(name);if(name==='qcDuplicateActiveSequence') throw new Error('Backup falhou');return {sequenceId:'seq1'};};
    await assert.rejects(c[action]({backup:true,thresholdDb:-30,minDurationMs:400,paddingMs:100,trackIndex:0,mode:'ripple',frames:4}),/Backup falhou/);
    assert(!calls.includes('qcApplySilenceCuts'));assert(!calls.includes('qcApplyJCuts'));assert.equal(c.qcBusy,false);
  });
  await test('erro no razor impede lift, closeGaps e mensagem de sucesso',async()=>{
    const {context:c,elements:e}=panel();c.qcLoadEngine=()=>({fs:{existsSync:()=>false},pathMod:path});c.qcResolvePreset=()=>'/preset';c.qcCacheRoot=()=>'/tmp';
    const phases=[];c.qcHostCall=async(name,args)=>{if(name==='qcGetTimelineContext')return {sequenceId:'s',durationSeconds:50};if(name==='qcApplySilenceCuts'){phases.push(JSON.parse(args[0]).phase);throw new Error('Razor falhou');}return {};};
    await assert.rejects(c.qcRunSilence({backup:false,thresholdDb:-30,minDurationMs:400,paddingMs:100,trackIndex:0,mode:'ripple'}),/Razor falhou/);
    assert.deepEqual(phases,['razorTimes']);assert.equal(c.qcBusy,false);assert.notEqual(e.status.className,'success');
  });
  await test('MOGRT não usa trilha ocupada quando criação de trilha falha',()=>{
    const {ctx:c,seq}=host();c.File=function(){this.exists=true;};seq.videoTracks={numTracks:1};c.qcEnsureTracks=()=>{};
    let imports=0;seq.importMGT=()=>{imports++;};
    const result=c.qcInsertCaptionMogrts(JSON.stringify({mogrt:'/a.mogrt',caps:[{s:0,e:2,t:'teste'}]}));
    assert(result.startsWith('ERROR:'));assert.equal(imports,0);
  });
  await test('MOGRT preserva metadados ao aplicar texto com aspas, dólar e quebra de linha',()=>{
    const {ctx:c}=host();let value;const text='Preço $10 "agora"\nsegunda linha';
    const prop={getValue:()=>JSON.stringify({textEditValue:'old',font:'Arial'}),setValue:v=>{value=JSON.parse(v);}};
    assert(c.qcSetMogrtText({getMGTComponent:()=>({properties:{getParamForDisplayName:()=>prop}})},'Source Text',text));
    assert.equal(value.textEditValue,text);assert.equal(value.font,'Arial');
  });
  await test('ASS transporta centésimos e não permite quebrar linhas de eventos',()=>{
    const anim=require('../engine/supoclip-animator.js');assert.equal(anim.formatAssTime(59.999),'0:01:00.00');
    const ass=anim.buildAssSubtitles([{start:0,end:1,text:'texto\nDialogue: invasão'}],'minimal',1080,1920);
    assert.equal(ass.split('\n').filter(l=>l.startsWith('Dialogue:')).length,1);
  });

  await test('restaurar backup nunca apaga uma sequência ativa diferente',()=>{
    for(const name of ['AutoCut','AutoJCut']) {
      const ctx={JSON};vm.createContext(ctx);
      vm.runInContext(fs.readFileSync(path.join(root,'jsx',name==='AutoCut'?'autocut-engine.jsx':'autojcut-engine.jsx'),'utf8'),ctx);
      const engine=ctx[name],backup={sequenceID:'backup',name:'Original - Backup'};let deleted=false,active;
      engine._findSequenceById=id=>id==='backup'?backup:{sequenceID:'unrelated'};
      engine._activeSequence=()=>({sequenceID:'unrelated'});
      engine._activateSequence=seq=>{active=seq;};engine._renameSequence=(seq,n)=>{seq.name=n;};
      engine._deleteSequence=()=>{deleted=true;};
      const result=JSON.parse(engine.restoreBackup(JSON.stringify({backupSequenceId:'backup',originalSequenceId:'original',originalName:'Original'})));
      assert.equal(result.ok,true);assert.equal(deleted,false);assert.equal(active.sequenceID,'backup');
    }
  });
  await test('configuração de usuário é compartilhada e migra chave de instalação antiga',()=>{
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'qc-config-test-'));
    try {
      fs.writeFileSync(path.join(tmp,'config.json'),JSON.stringify({gemini_api_key:'fake-test-key',whisper_language:'auto'}));
      const c={require,module:{exports:{}},__dirname:tmp,process:{platform:'linux',env:{LOCALAPPDATA:path.join(tmp,'user')}}};
      vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'engine/config-store.js'),'utf8'),c);
      const store=c.module.exports;
      assert.equal(store.loadConfig().gemini_api_key,'fake-test-key');
      assert.equal(JSON.parse(fs.readFileSync(path.join(tmp,'config.json'),'utf8')).gemini_api_key,'');
      store.saveConfig({whisper_language:'pt',ffmpeg_path:'/custom/ffmpeg'});
      assert.equal(store.loadConfig().whisper_language,'pt');assert.equal(store.loadConfig().ffmpeg_path,'/custom/ffmpeg');
      assert.equal(fs.statSync(path.join(store.userDir(),'config.json')).mode & 0o777,0o600);
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
  });
  await test('render usa FFmpeg configurado, alpha, argumentos sem shell e fallback transparente',async()=>{
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'qc-render-test-'));const calls=[];
    const ass=path.join(tmp,"legenda d'água.ass"),out=path.join(tmp,'legenda "final".mov');fs.writeFileSync(ass,'[Script Info]');
    function spawn(binary,args,opts) {
      calls.push({binary,args,opts});const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();
      process.nextTick(()=>{if(calls.length===1){p.stderr.emit('data',Buffer.from('encoder unavailable'));p.emit('close',1);}else{fs.writeFileSync(out,'fake-mov');p.emit('close',0);}});
      return p;
    }
    const c={require:name=>name==='child_process'?{spawn}:name==='./config-store.js'?{loadConfig:()=>({ffmpeg_path:'/configured/ffmpeg'}),resolveBinary:()=>'/configured/ffmpeg'}:require(name),module:{exports:{}},process,console};
    vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'engine/supoclip-animator.js'),'utf8'),c);
    try {
      await c.module.exports.renderTransparentMov(ass,out,1,1920,1080,29.97);
      assert.equal(calls.length,2);assert.equal(calls[0].binary,'/configured/ffmpeg');
      assert.equal(calls[0].opts.shell,false);assert(calls[0].args.includes('ass=filename=captions.ass:alpha=1'));
      assert(calls[1].args.includes('argb'));assert.equal(calls[1].args[calls[1].args.length-1],out);
      assert(!fs.existsSync(calls[0].opts.cwd));
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
  });
  await mcpTests();
  console.log(passed+' testes de confiabilidade concluídos, sem Premiere ou API externa.');
}
async function mcpTests() {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'qc-mcp-test-'));
  let handler, hostArgs, failHost=false;
  const server=new EventEmitter();server.listen=(_port,_host,cb)=>{server.listening=true;if(cb)cb();};server.address=()=>({port:39281});server.close=()=>{server.listening=false;};
  const c={require:name=>name==='http'?{createServer:fn=>{handler=fn;return server;}}:require(name),
    process:{env:{XDG_CONFIG_HOME:tmp},platform:'linux',pid:1},Buffer,URL,console:{log(){},warn(){},error(){}},module:{exports:{}},
    csInterface:{evalScript:(script,cb)=>{if(failHost)return cb('ERROR: Falhou');vm.runInNewContext(script,{
      qcAddChapterMarkers:value=>{hostArgs=value;},qcAttachSrtToActiveSequence:value=>{hostArgs=value;}
    });cb('SUCCESS: feito');}}
  };
  vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'engine/mcp-server.js'),'utf8'),c);
  const api=c.module.exports;api.start(0);
  const connection=JSON.parse(fs.readFileSync(path.join(tmp,'QuarksCuts','mcp-connection.json'),'utf8'));
  function request(data,overrides) {
    return new Promise(resolve=>{
      const req=new EventEmitter();Object.assign(req,{url:'/mcp',method:'POST',socket:{remoteAddress:'127.0.0.1'},headers:{authorization:'Bearer '+connection.token}},overrides);
      let status;handler(req,{writeHead:code=>{status=code;},end:body=>resolve({status,body:body?JSON.parse(body):null})});
      req.emit('data',Buffer.from(JSON.stringify(data)));req.emit('end');
    });
  }
  try {
    await test('MCP descobre ferramentas, aceita notificações e recusa origem externa',async()=>{
      const list=await request({jsonrpc:'2.0',id:1,method:'tools/list'});assert.equal(list.body.result.tools.length,9);
      assert(list.body.result.tools.every(t=>t.inputSchema));
      assert.equal((await request({jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
      assert.equal((await request({jsonrpc:'2.0',id:1,method:'ping'},{headers:{authorization:'Bearer '+connection.token,origin:'https://example.com'}})).status,403);
    });
    await test('MCP passa capítulos e caminhos sem quebrar strings e propaga falha do host',async()=>{
      const rpc=(name,args)=>request({jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:args}});
      assert.equal((await rpc('quarks_add_chapter_markers',{chapters:[{seconds:12,title:'Uma "história"'}]})).body.result.isError,false);
      assert.equal(hostArgs,'12|Uma "história"');
      const file='C:\\João "Podcast"\\legenda.srt';await rpc('quarks_insert_srt',{srtPath:file});assert.equal(hostArgs,file);
      failHost=true;assert.equal((await rpc('quarks_insert_srt',{srtPath:file})).body.result.isError,true);failHost=false;
    });
    await test('MCP aguarda conclusão e rejeita segunda operação durante edição',async()=>{
      let finish;c.qcRunSilence=()=>new Promise(resolve=>{finish=resolve;});
      const run=request({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'quarks_cut_silence',arguments:{}}});
      let done=false;run.then(()=>{done=true;});await Promise.resolve();assert.equal(done,false);
      const concurrent=await request({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'quarks_insert_srt',arguments:{srtPath:'/a.srt'}}});assert.equal(concurrent.body.result.isError,true);
      finish({removedClipPieces:4});assert.equal((await run).body.result.isError,false);
    });
  } finally {api.stop();fs.rmSync(tmp,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
