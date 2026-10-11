// Synthetic parser/gate probes only. No SDK/reader imports or recognition.
import {readFileSync} from 'node:fs';import {dirname,join} from 'node:path';import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';import vm from 'node:vm';import assert from 'node:assert/strict';
const here=dirname(fileURLToPath(import.meta.url)),code=readFileSync(join(here,'run-paired.mjs'),'utf8');
const captureCode=code.slice(code.indexOf('function capture('),code.indexOf('const outOfCallErrors=[]'));
const gateCode=code.slice(code.indexOf('entry.traceComplete='),code.indexOf('  if(entry.traceComplete)'));
assert(captureCode.startsWith('function capture(')&&gateCode.includes('priorBytes'));
const prefix='QRGEN_ROW_TRACE ',bounds={maxEventsPerCall:250000,maxBytesPerCall:33554432,maxEventBytes:16384};
const patch=readFileSync(join(here,'actual-row-trace.patch'),'utf8');
const knownEvents=new Set([...patch.matchAll(/\bQRT(?:_EAN|_BOOL)?\(\s*"([^"]+)"/g),...patch.matchAll(/\bEvent\s+\w+\(\s*"([^"]+)"/g)].map(m=>m[1]));
const blank=()=>({fd:1,bytes:0,hostDropped:0,nonTrace:0,seq:0,events:0,sequenceGaps:0,types:{},transportErrors:[]});
function run(mutate=()=>{}){
 const lines=[];const events=[{event:'call-begin',width:640,height:480,maxEvents:bounds.maxEventsPerCall,maxBytes:bounds.maxBytesPerCall,maxLine:bounds.maxEventBytes},
  {event:'oned-pass-begin'},{event:'row-attempt'},{event:'decode-attempt'},{event:'left-guard-found'},{event:'collector-insert'}].map((e,i)=>({schema:1,seq:i+1,...e}));
 const end={schema:1,seq:7,event:'call-end',priorEvents:6,priorBytes:0,dropped:0,oversized:0,rows:1,attempts:1,candidates:1,groups:1,passes:1};
 end.priorBytes=events.reduce((n,e)=>n+Buffer.byteLength(prefix+JSON.stringify(e)+'\n'),0);events.push(end);mutate(events);
 const b=blank(),t=blank(),entry={};const c={Buffer,prefix,hostCap:34*1024*1024,knownEvents,current:{baseline:b,instrumented:t},outOfCallErrors:[],
  writeSync:(_fd,s)=>{lines.push(s);return Buffer.byteLength(s);},b,t,entry,source:{width:640,height:480},plan:{bounds}};
 vm.createContext(c);vm.runInContext(captureCode,c);
 for(const e of events)c.capture('instrumented',prefix+JSON.stringify(e));
 vm.runInContext(gateCode,c);return {passed:c.entry.traceComplete,transportErrors:t.transportErrors};
}
const checks=[];const probe=(name,edit,expected)=>{const r=run(edit);assert.equal(r.passed,expected,name);checks.push({name,passed:true});};
probe('exact-complete-synthetic-stream',()=>{},true);
probe('wrong-event-schema',e=>{e[2].schema=2;},false);
probe('unknown-event-type',e=>{e[2].event='unrecognised';},false);
probe('wrong-input-width',e=>{e[0].width=641;},false);
probe('wrong-input-height',e=>{e[0].height=481;},false);
probe('wrong-event-cap',e=>{e[0].maxEvents--;},false);
probe('wrong-byte-cap',e=>{e[0].maxBytes--;},false);
probe('wrong-line-cap',e=>{e[0].maxLine--;},false);
probe('prior-byte-mismatch',e=>{e.at(-1).priorBytes++;},false);
probe('sequence-gap',e=>{e[3].seq++;},false);
probe('reported-drop',e=>{e.at(-1).dropped=1;},false);
probe('reported-oversize',e=>{e.at(-1).oversized=1;},false);
probe('attempt-counter-mismatch',e=>{e.at(-1).attempts=2;},false);
probe('missing-call-end',e=>{e.pop();},false);
const sha=b=>createHash('sha256').update(b).digest('hex');
const result={scope:'Synthetic trace parser/completeness probes. No engine calls, builds or measured trace replay.',checks,
 runnerSha256:sha(readFileSync(join(here,'run-paired.mjs'))),auditCodeSha256:sha(readFileSync(fileURLToPath(import.meta.url))),recognitionCalls:0,readerImports:0};
console.log(JSON.stringify(result));
