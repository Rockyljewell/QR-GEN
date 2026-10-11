// Derived portable numerical audit. No SDK imports, raster analysis or decoder calls.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {verifyPackage} from './verify-package.mjs';
const here=dirname(fileURLToPath(import.meta.url));verifyPackage();
const results=JSON.parse(gunzipSync(readFileSync(join(here,'records/results.json.gz')))),supplement=JSON.parse(gunzipSync(readFileSync(join(here,'records/complete-trace-and-limit-evidence.json.gz'))));
const canonical=x=>x&&typeof x==='object'?Array.isArray(x)?x.map(canonical):Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const equal=(x,y)=>JSON.stringify(canonical(x))===JSON.stringify(canonical(y));
function geometry(position){
 const p=['topLeft','topRight','bottomRight','bottomLeft'].map(k=>position[k]);if(p.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw Error('Nonfinite position');
 const dx=(p[1].x+p[2].x-p[0].x-p[3].x)/2,dy=(p[1].y+p[2].y-p[0].y-p[3].y)/2,axis=Math.abs(dx)>=Math.abs(dy)?'x':'y',perp=axis==='x'?'y':'x';
 const range=k=>[Math.min(...p.map(q=>q[k])),Math.max(...p.map(q=>q[k]))];
 return{axis,dx,dy,angleDegrees:Math.atan2(dy,dx)*180/Math.PI,span:range(axis),supportEnvelope:range(perp),aabb:{x:range('x'),y:range('y')},position};
}
function pair(a,b,i,j){
 const same=a.axis===b.axis,len=s=>s[1]-s[0],intersection=same?Math.max(0,Math.min(a.span[1],b.span[1])-Math.max(a.span[0],b.span[0])):null;
 // Actual interval union; its zero-overlap IoU is also zero. For overlapping intervals it equals the original enclosing interval.
 const union=same?len(a.span)+len(b.span)-intersection:null,gap=same?Math.max(0,Math.max(a.supportEnvelope[0],b.supportEnvelope[0])-Math.min(a.supportEnvelope[1],b.supportEnvelope[1])):null;
 return{a:i,b:j,sameDominantAxis:same,exactParallel:a.dx*b.dy-a.dy*b.dx===0,spanOverlap:intersection,spanIntersectionOverUnion:same&&union>0?intersection/union:null,perpendicularEnvelopeGap:gap,gapOverShorterSymbolSpan:same?gap/Math.min(len(a.span),len(b.span)):null,positiveAabbIntersection:['x','y'].every(k=>Math.min(a.aabb[k][1],b.aabb[k][1])-Math.max(a.aabb[k][0],b.aabb[k][0])>0),projectionOnlyRelated:same&&intersection>0};
}
let auditedEnvelopes=0,auditedPairs=0;
for(const row of [...results.allFrozenGeometry,...results.controlResults]){
 if(row.resultCount!==row.envelopes.length||row.resultCount!==row.annotationsAfterGeometry.length)throw Error('Lost per-detection count');
 const gs=row.envelopes.map(g=>geometry(g.position));if(!equal(gs,row.envelopes))throw Error('Geometry mismatch '+(row.itemKey??row.id));auditedEnvelopes+=gs.length;
 const ps=[];for(let i=0;i<gs.length;i++)for(let j=i+1;j<gs.length;j++)ps.push(pair(gs[i],gs[j],i,j));if(!equal(ps,row.pairs))throw Error('Pair mismatch '+(row.itemKey??row.id));auditedPairs+=ps.length;
 const remaining=new Set(gs.map((_,i)=>i)),components=[];while(remaining.size){const first=remaining.values().next().value,group=[first],todo=[first];remaining.delete(first);while(todo.length){const i=todo.pop();for(const p of ps){if(!p.projectionOnlyRelated)continue;const j=p.a===i?p.b:p.b===i?p.a:null;if(j!==null&&remaining.delete(j)){group.push(j);todo.push(j);}}}components.push(group.sort((a,b)=>a-b));}if(!equal(components,row.projectionComponents))throw Error('Component mismatch');
}
const falseControls=results.controlResults.filter(c=>c.expectedAfterGeometry.physicalSymbols===2&&c.pairs.some(p=>p.projectionOnlyRelated));
if(falseControls.length!==5||!equal(falseControls.map(c=>c.id),results.decision.falseGroupingControlIds)||results.decision.safeProductionFilterEstablished!==false)throw Error('Refutation summary mismatch');
const separate=results.controlResults.filter(c=>c.expectedAfterGeometry.physicalSymbols===2&&new Set(c.expectedAfterGeometry.payloads).size===2);if(separate.length!==6||separate.some(c=>c.resultCount!==2||c.expectedAfterGeometry.expectedPayloadPresent.some(x=>!x)))throw Error('Legitimate different-code controls mismatch');
if(results.allFrozenGeometry.length!==479||results.traceSummaries.length!==3||supplement.completeTraceSummaries.length!==4||supplement.existingMaxLimitProfiles.length!==24)throw Error('Scope/correction mismatch');
const limits=supplement.existingMaxLimitProfiles.filter(p=>p.options.tryHarder&&!p.options.tryDownscale).map(p=>({itemKey:p.itemKey,max:p.options.maxNumberOfSymbols,results:p.results.map(r=>({text:r.text,lineCount:r.lineCount}))}));
console.log(JSON.stringify({status:'recorded-numerical-audit-passed',scope:'Descriptive refutation only; no decoder execution or new filter',frozenRows:479,controls:9,auditedEnvelopes,auditedPairs,falseGroupingControlIds:falseControls.map(c=>c.id),completeAcceptedRowTraceCases:4,existingActualLimitProfiles:24,hardFullResolutionLimits:limits},null,2));
