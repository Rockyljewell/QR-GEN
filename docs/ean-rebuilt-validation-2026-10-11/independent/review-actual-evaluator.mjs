// Read-only review of existing actual-matrix evidence; no decoder calls.
import {readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url)),output=join(root,'../rebuilt-ean/actual-matrix-v1');
const sha=x=>createHash('sha256').update(x).digest('hex');
const read=p=>readFileSync(p),json=p=>JSON.parse(read(p));
const plan=json(join(output,'evaluation-plan.json'));
const records=read(join(output,'candidate-comparison.jsonl')).toString().trim().split('\n').map(x=>JSON.parse(x));
const items=new Map(plan.items.map(i=>[i.group+'/'+i.id,i]));
function targets(item,profile){
 const ts=item.expectedTargets??(item.truth===null?[]:[{text:item.truth,families:['EAN13'],unknownAddon:!!item.photo}]);
 return ts.filter(t=>!profile.options.formats.length||t.families.some(f=>profile.options.formats.includes(f)));
}
function targetMatch(r,t,p){
 if(!r.isValid||!t.families.includes(r.format))return false;
 if(t.nonEAN||p.options.eanAddOnSymbol==='Ignore')return r.text===t.text;
 const addon=r.text.startsWith(t.text)?r.text.slice(t.text.length):null;
 const validAddon=t.addon?addon===t.addon:t.unknownAddon&&/^(\d{2}|\d{5})$/.test(addon??'');
 return p.options.eanAddOnSymbol==='Require'?validAddon:r.text===t.text||validAddon;
}
const strictLoss=[],newValues=[],controls=[],invalidErrorLineOnly=[],lineCountOnly=[];
for(const r of records){
 const item=items.get(r.itemKey), ts=targets(item,r);
 const beforeTargets=r.baseline.results.filter(b=>ts.some(t=>targetMatch(b,t,r)));
 for(const b of beforeTargets)if(!r.candidate.results.some(c=>c.isValid&&c.text===b.text&&c.format===b.format&&c.bytesHex===b.bytesHex))strictLoss.push({profileId:r.profileId,itemKey:r.itemKey,text:b.text,format:b.format});
 for(const c of r.candidate.results)if(!r.baseline.results.some(b=>b.text===c.text&&b.format===c.format))newValues.push({profileId:r.profileId,itemKey:r.itemKey,text:c.text,format:c.format});
 if(['generated-no-code','real-negative-original','real-negative-derived','synthetic-adversarial-no-code'].includes(item.group)&&r.candidate.results.some(c=>c.isValid))controls.push(r.profileId);
 if(!r.equivalent&&r.baseline.results.length===r.candidate.results.length){
  const stripped=(a,field)=>JSON.stringify(a.map(x=>{const y={...x};delete y[field];return y;}));
  if(stripped(r.baseline.results,'error')===stripped(r.candidate.results,'error'))invalidErrorLineOnly.push(r.profileId);
  if(stripped(r.baseline.results,'lineCount')===stripped(r.candidate.results,'lineCount'))lineCountOnly.push({profileId:r.profileId,itemKey:r.itemKey});
 }
}
const port=json(join(root,'review-package/recorded-word-results.json'));
const actualCore=new Map(records.filter(r=>r.arm==='full-frozen-corpus'&&!r.options.tryDownscale).map(r=>[r.itemKey+'/'+r.options.tryHarder,r]));
const normalized=results=>JSON.stringify(results.map(r=>({text:r.text,lineCount:r.lineCount,position:r.position})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
const portDifferences=[];let matched=0;
for(const p of port.runs){
 const r=actualCore.get(p.group+'/'+p.id+'/'+p.tryHarder);
 if(!r)throw Error('Missing shared port profile '+p.id);
 const before=normalized(p.before)===normalized(r.baseline.results),after=normalized(p.after)===normalized(r.candidate.results);
 if(!before||!after)portDifferences.push({id:p.id,group:p.group,tryHarder:p.tryHarder,beforeMatches:before,afterMatches:after});
 matched++;
}
const evidence={scope:'Independent read-only evidence review; no new decoding/native/browser execution. Target retention requires exact text, returned family and bytes. Port comparison is limited to shared EAN13/max255/downscale:false profiles.',runnerSha256:sha(read(join(root,'candidate/evaluate-rebuilt.mjs'))),evaluationPlanSha256:sha(read(join(output,'evaluation-plan.json'))),records:records.length,strictTextFormatByteTargetLosses:strictLoss,newTextFormatPairs:newValues,candidateNoCodeOutputProfiles:controls,errorFieldOnlyChanges:invalidErrorLineOnly.length,lineCountOnlyChanges:lineCountOnly,sharedPortProfiles:matched,portBaselineOrCandidateDifferences:portDifferences,correction:'Earlier conversational /1/01 support-change label was mistaken. Frozen port evidence and actual WASM both identify original fast ean13-3-23,9780201310054,lineCount8→7. Actual comparison includes downscale off/on, giving2profiles.',inversionReview:'Static comparison with current SDK inversion.ts confirms the separately modelled arm uses the same native-format exclusions, new RGB copy preserving alpha, full second-pass limit, inversion flag toggle, exact text/format/bytes plus spatial dedup, and combined max budget for these opaque RGBA/max255/returnErrors:false cases. It is not product SDK execution with a replaced dependency.',limitations:['Error-field-only changes include moved source locations; raw output strings are intentionally retained.','No population accuracy, phone/vendor parity, full public SDK, browser worker or native suite claim follows from this review.']};
writeFileSync(join(root,'independent-evaluator-review.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
if(strictLoss.length||newValues.length||controls.length||portDifferences.length||matched!==942)process.exitCode=1;
