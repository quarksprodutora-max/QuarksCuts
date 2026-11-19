'use strict';
// Offline: respostas controladas; não lê credenciais nem chama Gemini/Premiere.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../engine/gemini-cortes.js'), 'utf8');
const sandbox = {
  require: name => name === './log.js' ? { qcLog: () => {} } : require(name),
  module: { exports: {} }, process: { env: {} }, __dirname: path.join(__dirname, '../engine'),
  console, setTimeout, Buffer
};
vm.createContext(sandbox);
vm.runInContext(source + `\nloadConfig = () => ({gemini_api_key:'offline-test'});
gerarPromoDoc = async () => ({promoSemRaw:'',chaptersRaw:''});
module.exports.testing = {normalizeClips,dedupeClips,selectEditorialClips,validSourceRanges,
validateHookAlternatives,buildPrompt,getHookStyleInstructions};
`, sandbox);
const api = sandbox.module.exports;
const t = api.testing;
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('OK ' + name); }
function clip(start, end, score, group, version) {
  return { segmentos: [{inicio:start,fim:end}], avaliacao:{hook_score:score}, assunto_id:group, versao:version || 'unica' };
}
check('preserva versões contidas e ordens diferentes, remove apenas montagem repetida', () => {
  const short = clip(0,60,80,'a','curta'), long = clip(0,90,90,'a','longa');
  assert.equal(t.dedupeClips([short,long]).length,2);
  assert.equal(t.dedupeClips([short,clip(0.1,60.1,95,'a')])[0].avaliacao.hook_score,95);
  const a = {segmentos:[{inicio:0,fim:10},{inicio:30,fim:40}]};
  const b = {segmentos:a.segmentos.slice().reverse()};
  assert.equal(t.dedupeClips([a,b]).length,2);
});
check('seleção global mantém assunto posterior e diversidade antes das variantes', () => {
  const result = t.selectEditorialClips([clip(0,30,20,'a'),clip(40,70,10,'a'),clip(3000,3030,95,'b')],2);
  assert.equal(result[0].assunto_id,'b'); assert.equal(result[1].assunto_id,'a');
});
check('rejeita tempos inventados, infinitos, repetidos e intervalos excluídos', () => {
  const lines=['[0.0-10.0] Uma fala.','[10.0-20.0] Outra fala.'];
  assert(t.validSourceRanges([{inicio:10,fim:20},{inicio:0,fim:10}],lines));
  for(const ranges of [[{inicio:0.5,fim:20}],[{inicio:0,fim:Infinity}],[{inicio:0,fim:20},{inicio:10,fim:20}]]) {
    assert(!t.validSourceRanges(ranges,lines));
  }
  assert(!t.validSourceRanges([{inicio:0,fim:20}],lines,[{inicio:12,fim:13}]));
});
check('normalização não aceita corte parcialmente inválido ou duração fora da faixa', () => {
  assert.equal(t.normalizeClips({clips:[clip(0,19,90,'a')]},20,90).length,0);
  assert.equal(t.normalizeClips({clips:[{segmentos:[{inicio:0,fim:30},null]}]},20,90).length,0);
  assert.equal(t.normalizeClips({clips:[clip(0,60,90,'a','curta')]},20,90)[0].versao,'curta');
});
const hookLines=Array.from({length:6},(_,i)=>`[${i*10}.0-${(i+1)*10}.0] Esta é a fala completa número ${i}.`);
const hookRanges=hookLines.map((line,i)=>({inicio:i*10,fim:(i+1)*10,frase_exata:`Esta é a fala completa número ${i}.`}));
check('trailer exige 55–65s, múltiplas passagens e fala literal', () => {
  const item={nome:'Trailer',avaliacao:{hook_score:90},hook_segmentos:hookRanges};
  assert.equal(t.validateHookAlternatives({alternativas:[item]},hookLines)[0].duracao_s,60);
  assert.equal(t.validateHookAlternatives({alternativas:[{...item,hook_segmentos:hookRanges.slice(0,5)}]},hookLines).length,0);
  assert.equal(t.validateHookAlternatives({alternativas:[{...item,hook_segmentos:hookRanges.map((r,i)=>i? r:{...r,frase_exata:'Fala inventada.'})}]},hookLines).length,0);
});
async function integration() {
  const words=Array.from({length:2300},(_,i)=>({start:i*10,end:(i+1)*10,text:`Esta é a fala completa número ${i}.`}));
  const replies=[
    {momentos:[{assunto:'Decisão',resumo:'Decisão e contexto.',inicio:0,fim:30}]},
    {momentos:[{assunto:'Consequência da decisão',resumo:'Retomada da mesma decisão.',inicio:22000,fim:22030}]},
    {assuntos:[{assunto:'A decisão e sua consequência',momentos:['m0','m1']}]},
    {clips:[{
      titulo:'Uma decisão',versao:'longa',frase_abertura:'Esta é a fala completa número 2200.',
      frase_fechamento:'Esta é a fala completa número 2.',avaliacao:{hook_score:90},
      segmentos:[{inicio:22000,fim:22030},{inicio:0,fim:30}]
    },{
      titulo:'Travessia inválida',versao:'unica',frase_abertura:'Esta é a fala completa número 0.',
      frase_fechamento:'Esta é a fala completa número 2202.',avaliacao:{hook_score:100},
      segmentos:[{inicio:0,fim:22030}]
    }]}
  ];
  const prompts=[];
  sandbox.mockCall=async (_models,_key,body)=>{
    prompts.push(body.contents[0].parts[0].text);
    assert(replies.length,'Chamada extra inesperada');
    return JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(replies.shift())}]}}]});
  };
  vm.runInContext('callGemini = mockCall;',sandbox);
  const result=await api.gerarCortes(words,{quantidade:60,minDur:20,maxDur:90});
  assert.equal(replies.length,0);
  assert.equal(result.clips.length,1);
  assert.equal(result.clips[0].segmentos[0].inicio,22000);
  assert.equal(result.clips[0].segmentos[1].inicio,0);
  assert(result.clips[0].titulo.includes('[longo]'));
  assert(prompts[3].includes('[0.0-10.0]') && prompts[3].includes('[22000.0-22010.0]'));
  passed++; console.log('OK fluxo completo conecta retomadas entre chunks e preserva montagem não cronológica');

  let calls=0;
  sandbox.mockCall=async()=>{
    calls++;
    const ranges=calls===1?hookRanges.slice(0,5):hookRanges;
    return JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({alternativas:[{nome:'Trailer',avaliacao:{hook_score:80},hook_segmentos:ranges}]})}]}}]});
  };
  vm.runInContext('callGemini = mockCall;',sandbox);
  const hook=await api.gerarHookApenas(words.slice(0,6),{});
  assert.equal(calls,2); assert.equal(hook.duracao_s,60); assert.equal(hook.hook_segmentos.length,6);
  assert.equal(hook.hook_alternativas.length,1);
  passed++; console.log('OK hook refaz proposta inválida e preserva contrato público do painel');
  console.log(`${passed} verificações concluídas, sem rede.`);
}
integration().catch(e=>{console.error(e);process.exitCode=1;});
