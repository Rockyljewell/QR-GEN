import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const json=p=>JSON.parse(readFileSync(p)),plan=json(join(here,'frozen-plan.json')),freeze=json(join(here,'freeze.json'));
if(sha(readFileSync(join(here,'frozen-plan.json')))!==freeze.planSha256)throw Error('Frozen plan hash mismatch');
if(existsSync(join(here,'matrix-summary.json')))throw Error('Refusing existing summary');
const profileMap=new Map(plan.profiles.map(p=>[p.id,p])),itemMap=new Map(plan.items.map(i=>[i.key,i]));
const records={},runSummaries={};
for(const label of['baseline','candidate'])for(const format of['esm','cjs']){
 const key=label+'-'+format,dir=join(here,key),bytes=readFileSync(join(dir,'results.jsonl')),rows=bytes.toString().trim().split('\n').map(JSON.parse),summary=json(join(dir,'summary.json'));
 if(rows.length!==plan.profiles.length||new Set(rows.map(r=>r.profileId)).size!==rows.length||sha(bytes)!==summary.resultsSha256||summary.planSha256!==freeze.planSha256)throw Error('Incomplete/tampered results '+key);
 records[key]=new Map(rows.map(r=>[r.profileId,r]));runSummaries[key]=summary;
}
const canon=x=>JSON.stringify(x),valueKey=b=>canon([b.data,b.symbology,b.rawBytes]);
const matchesTarget=(b,p)=>p.target&&b.data===p.target.data&&b.symbology===p.target.symbology;
const bag=values=>{const m=new Map();for(const v of values)m.set(v,(m.get(v)??0)+1);return m;};
const subtract=(a,b)=>{const left=bag(b);return a.filter(v=>{const n=left.get(v)??0;if(n){left.set(v,n-1);return false;}return true;});};
const changes=[],lostTargets=[],lostTargetRecords=[],newValues=[],noCodeOutputs=[],knownFalse07=[],knownFalse35=[],unreviewedCompanionMismatches=[];
const groups={};let orderedDifferences=0,esmCjsDifferences=0;
for(const p of plan.profiles){
 const item=itemMap.get(p.itemKey),b=records['baseline-esm'].get(p.id),c=records['candidate-esm'].get(p.id),bo=b.output??[],co=c.output??[];
 for(const label of['baseline','candidate']){const a=records[label+'-esm'].get(p.id),z=records[label+'-cjs'].get(p.id);if(a.status!==z.status||canon(a.output)!==canon(z.output)||canon(a.error)!==canon(z.error))esmCjsDifferences++;}
 const g=groups[p.arm+'|'+item.group+'|hard='+p.options.tryHarder]??={profiles:0,baselineTargetPresence:0,candidateTargetPresence:0,baselineTargetCount:0,candidateTargetCount:0,baselineAnyOutput:0,candidateAnyOutput:0};g.profiles++;
 const bt=bo.filter(x=>matchesTarget(x,p)),ct=co.filter(x=>matchesTarget(x,p));g.baselineTargetPresence+=!!bt.length;g.candidateTargetPresence+=!!ct.length;g.baselineTargetCount+=bt.length;g.candidateTargetCount+=ct.length;g.baselineAnyOutput+=!!bo.length;g.candidateAnyOutput+=!!co.length;
 if(bt.length&&!ct.length)lostTargets.push({profileId:p.id,itemKey:p.itemKey,options:p.options,baselineTargets:bt,candidate:co});
 const missingTargetValues=subtract(bt.map(valueKey),ct.map(valueKey));if(missingTargetValues.length)lostTargets.push({profileId:p.id,itemKey:p.itemKey,kind:'target-byte-or-count-loss',missing:missingTargetValues});
 const missingTargetRecords=subtract(bt.map(canon),ct.map(canon));if(missingTargetRecords.length)lostTargetRecords.push({profileId:p.id,itemKey:p.itemKey,missing:missingTargetRecords});
 const added=subtract(co.map(valueKey),bo.map(valueKey));if(added.length)newValues.push({profileId:p.id,itemKey:p.itemKey,options:p.options,values:added});
 if(canon(bo)!==canon(co)||b.status!==c.status){orderedDifferences++;changes.push({profileId:p.id,itemKey:p.itemKey,options:p.options,baseline:bo,candidate:co,removedValues:subtract(bo.map(valueKey),co.map(valueKey)),addedValues:added});}
 if(p.noCode&&(bo.length||co.length))noCodeOutputs.push({profileId:p.id,itemKey:p.itemKey,baseline:bo,candidate:co});
 if(item.id==='ean13-2-07'||item.group==='actual-Chrome-supplement'){
  const wrong=x=>x.data==='0798884816632'&&x.symbology==='ean13'||x.data==='798884816632'&&x.symbology==='upca';
  if(bo.some(wrong)||co.some(wrong))knownFalse07.push({profileId:p.id,itemKey:p.itemKey,options:p.options,baseline:bo.filter(wrong),candidate:co.filter(wrong),suppressed:bo.some(wrong)&&!co.some(wrong),recoveredTruth:co.some(x=>matchesTarget(x,p))});
 }
 if(item.id==='ean13-1-35'&&(bo.some(x=>x.data==='7034759003930')||co.some(x=>x.data==='7034759003930')))knownFalse35.push({profileId:p.id,itemKey:p.itemKey,options:p.options,baseline:bo,candidate:co});
 if(item.photo&&item.id!=='ean13-2-07'&&item.group!=='actual-Chrome-supplement'&&item.id!=='ean13-1-35')for(const[label,values]of[['baseline',bo],['candidate',co]])for(const value of values)if(!matchesTarget(value,p))unreviewedCompanionMismatches.push({profileId:p.id,itemKey:p.itemKey,label,companion:item.truth,value,scope:'Companion mismatch only: secondary visible barcode or unreviewed error; not proven false positive.'});
}
const errors=Object.values(runSummaries).reduce((n,s)=>n+s.errors.length,0),mutations=Object.values(runSummaries).reduce((n,s)=>n+s.mutations,0),validationFailures=Object.values(runSummaries).reduce((n,s)=>n+s.validationFailures,0),provenanceErrors=Object.values(runSummaries).flatMap(s=>s.provenanceErrors);
const matrix=plan.profiles.filter(p=>p.arm==='generated-72-matrix');
const matrixTargetMisses=matrix.filter(p=>!records['baseline-esm'].get(p.id).output?.some(b=>matchesTarget(b,p))||!records['candidate-esm'].get(p.id).output?.some(b=>matchesTarget(b,p))).map(p=>({profileId:p.id,itemKey:p.itemKey,options:p.options,baseline:records['baseline-esm'].get(p.id),candidate:records['candidate-esm'].get(p.id)}));
const summary={scope:'Actual public packed-SDK Node24 scanImage execution;551 frozen rasters,1162profiles per package/format. No population accuracy, phone, default-CDN migration or complete issue32 fix claim.',createdAt:new Date().toISOString(),planSha256:freeze.planSha256,runnerSha256:sha(readFileSync(join(here,'run-consumer.mjs'))),summaryRunnerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),counts:{rasters:551,profiles:1162,runs:4,sdkCalls:1162*4,changedProfilesPerFormat:orderedDifferences,esmCjsDifferences,lostTargetEvents:lostTargets.length,lostTargetFullRecords:lostTargetRecords.length,newValueProfiles:newValues.length,noCodeOutputProfiles:noCodeOutputs.length,errors,mutations,validationFailures,provenanceErrors:provenanceErrors.length,matrixProfiles:matrix.length,matrixTargetMisses:matrixTargetMisses.length,knownFalse07Profiles:knownFalse07.length,knownFalse07Suppressed:knownFalse07.filter(p=>p.suppressed).length,knownFalse07Residual:knownFalse07.filter(p=>p.candidate.length).length,knownFalse35Profiles:knownFalse35.length,unreviewedCompanionMismatchRecords:unreviewedCompanionMismatches.length},integrationGate:errors||mutations||validationFailures||provenanceErrors.length||esmCjsDifferences||lostTargets.length||lostTargetRecords.length||newValues.length||noCodeOutputs.length||matrixTargetMisses.length?'requires-review':'passed-scoped-gates',groups,changes,lostTargets,lostTargetRecords,newValues,noCodeOutputs,knownFalse07,knownFalse35,unreviewedCompanionMismatches,matrixTargetMisses,runSummaries,limitations:['Repeated profiles/formats are not independent photographs.','All public fields except timestamp retained; rawBytes are never derived from normalized text.','Knownfalse suppression is not recovery;35andUPCA-only residuals remain.','Companion mismatches may be secondary visible labels and are not a population false-positive estimate.','DefaultCDN/buildidentity/cachemigration/custombinary compatibility and physicalphones are not established.']};
writeFileSync(join(here,'matrix-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({integrationGate:summary.integrationGate,...summary.counts}));
