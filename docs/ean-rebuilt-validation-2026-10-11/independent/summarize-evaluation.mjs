// Independent evidence replay only: no reader execution and no frozen-file changes.
import { readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = dirname(fileURLToPath(import.meta.url));
const input = resolve(process.argv[2] ?? join(here, '../../rebuilt-ean/actual-matrix-v1'));
const output = resolve(process.argv[3] ?? join(here, 'actual-matrix-review.json'));
if (existsSync(output)) throw Error('Use a fresh review output; existing evidence is immutable');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const raw = (n) => readFileSync(join(input, n));
const json = (n) => JSON.parse(raw(n));
const lines = (n) => raw(n).toString('utf8').trim().split(/\r?\n/).map(JSON.parse);
const plan = json('evaluation-plan.json'), summary = json('summary.json');
const baseline = lines('baseline-conformance.jsonl'), candidate = lines('candidate-comparison.jsonl');
const assert = (v, m) => { if (!v) throw Error(m); };
assert(summary.status === 'actual-candidate-comparison-completed' && !summary.harnessSelfCheck, 'Not an actual completed candidate run');
assert(sha(raw('evaluation-plan.json')) === summary.planSha256, 'Plan hash changed');
assert(plan.runnerSha256 === sha(readFileSync(join(here, '../candidate/evaluate-rebuilt.mjs'))), 'Evaluator source changed');
assert(baseline.length === plan.scopeCounts.selectedProfiles && candidate.length === baseline.length, 'Record count mismatch');
assert(new Set(candidate.map(r => r.profileId)).size === candidate.length, 'Duplicate candidate profile');
const baseById = new Map(baseline.map(r => [r.profileId, r]));
const profiles = new Map(plan.profiles.map(p => [p.id, p]));
const items = new Map(plan.items.map(i => [i.group + '/' + i.id, i]));
const normalize = (results, omit = []) => results.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !omit.includes(k)).map(([k,v]) => [k, k === 'error' && typeof v === 'string' && omit.includes('sourceLocation') ? v.replace(/ @ ([^\r\n]+?):\d+(?::\d+)?$/, ' @ $1:<source-line>') : v]))).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const same = (a,b,omit = []) => JSON.stringify(normalize(a,omit)) === JSON.stringify(normalize(b,omit));
const allowed = (item, p) => {
  const ts = item.expectedTargets ?? (item.truth === null ? [] : [{text:item.truth, families:['EAN13'], unknownAddon:!!item.photo}]);
  return ts.filter(t => !p.options.formats.length || t.families.some(f => p.options.formats.includes(f))).map(t => ({...t, match: s => t.nonEAN || p.options.eanAddOnSymbol === 'Ignore' ? s === t.text : p.options.eanAddOnSymbol === 'Require' ? t.addon ? s === t.text + t.addon : t.unknownAddon ? s.startsWith(t.text) && /^\d{2}(\d{3})?$/.test(s.slice(t.text.length)) : false : s === t.text || t.addon && s === t.text+t.addon || t.unknownAddon && s.startsWith(t.text) && /^\d{2}(\d{3})?$/.test(s.slice(t.text.length))}));
};
const strictTargets = (item,p,run) => { const expected = allowed(item,p); return run.results.filter(r => r.isValid && expected.some(e => e.match(r.text) && e.families.includes(r.format))); };
const facts = { reviewedAt: new Date().toISOString(), input, reviewerSha256: sha(readFileSync(fileURLToPath(import.meta.url))), hashes: Object.fromEntries(['evaluation-plan.json','summary.json','baseline-conformance.jsonl','candidate-comparison.jsonl','changed-profiles.json','engine-inputs.json','retained-dist-graph-fingerprints.json'].map(n => [n,sha(raw(n))])), node:plan.node, cpu:plan.cpu, profiles:candidate.length, preparedRasters:plan.items.length, baselineMismatches:baseline.filter(r=>!r.equivalent||r.released315.error||r.baseline.error).length, changes: { false07Suppression:[], sourceLocationDiagnosticOnly:[], lineSupportOnly:[], other:[] }, newTextProfiles:[], newFormatTextBytesProfiles:[], lostStrictTargetProfiles:[], strictTargetGeometryOrCountChanges:[], targetTextButWrongFormatProfiles:[], maxSymbolLimitViolations:[], residualFalse07:[], arms:{}, readerCalls:{released315:0,baseline:0,candidate:0}, warmDecodeMs:{released315:0,baseline:0,candidate:0}, knownFalse35:{baseline:0,candidate:0} };
for (const r of candidate) {
  const b = baseById.get(r.profileId), p=profiles.get(r.profileId), item=items.get(r.itemKey);
  assert(b && p && item && p.itemKey===r.itemKey, 'Missing profile/item');
  assert(JSON.stringify(b.baseline) === JSON.stringify(r.baseline), 'Baseline record changed between phases');
  for (const k of ['released315','baseline']) { facts.readerCalls[k]+=b[k].readerCalls; facts.warmDecodeMs[k]+=b[k].warmDecodeMs; }
  facts.readerCalls.candidate+=r.candidate.readerCalls; facts.warmDecodeMs.candidate+=r.candidate.warmDecodeMs;
  const before=strictTargets(item,p,r.baseline), after=strictTargets(item,p,r.candidate), key=r.arm+'/'+r.mode;
  const arm=facts.arms[key]??={profiles:0,baselineStrictTargetProfiles:0,candidateStrictTargetProfiles:0,baselineStrictTargetDetections:0,candidateStrictTargetDetections:0};
  arm.profiles++; arm.baselineStrictTargetProfiles+=!!before.length; arm.candidateStrictTargetProfiles+=!!after.length; arm.baselineStrictTargetDetections+=before.length; arm.candidateStrictTargetDetections+=after.length;
  const info={profileId:r.profileId,itemKey:r.itemKey,arm:r.arm,mode:r.mode,options:r.options};
  const strictLost=before.filter(t=>!after.some(a=>a.text===t.text&&a.format===t.format));
  if(strictLost.length) facts.lostStrictTargetProfiles.push({...info,results:strictLost});
  if(!same(before,after,['lineCount','sourceLocation'])) facts.strictTargetGeometryOrCountChanges.push({...info,before,after});
  const badFamily=r.candidate.results.filter(t=>t.isValid&&allowed(item,p).some(a=>a.match(t.text))&&!after.includes(t));
  if(badFamily.length) facts.targetTextButWrongFormatProfiles.push({...info,results:badFamily});
  if(r.newPayloads.length) facts.newTextProfiles.push({...info,values:r.newPayloads});
  const newTyped=r.candidate.results.filter(c=>!r.baseline.results.some(b=>b.text===c.text&&b.format===c.format&&b.bytesHex===c.bytesHex));
  if(newTyped.length) facts.newFormatTextBytesProfiles.push({...info,results:newTyped});
  if(r.candidate.results.length>p.options.maxNumberOfSymbols) facts.maxSymbolLimitViolations.push(info);
  if(r.candidateOutcome.confirmedFalse07Present) facts.residualFalse07.push({...info,results:r.candidate.results.filter(t=>t.text.startsWith('0798884816632'))});
  facts.knownFalse35.baseline+=!!r.baselineOutcome.confirmedFalse35Present; facts.knownFalse35.candidate+=!!r.candidateOutcome.confirmedFalse35Present;
  if(!r.equivalent) {
    if(r.baselineOutcome.confirmedFalse07Present&&!r.candidateOutcome.confirmedFalse07Present&&same(r.baseline.results.filter(t=>!t.text.startsWith('0798884816632')),r.candidate.results)) facts.changes.false07Suppression.push(info);
    else if(same(r.baseline.results,r.candidate.results,['sourceLocation'])) facts.changes.sourceLocationDiagnosticOnly.push({...info,baselineErrors:r.baseline.results.map(t=>t.error),candidateErrors:r.candidate.results.map(t=>t.error)});
    else if(same(r.baseline.results,r.candidate.results,['lineCount'])) facts.changes.lineSupportOnly.push({...info,baselineLineCounts:r.baseline.results.map(t=>t.lineCount),candidateLineCounts:r.candidate.results.map(t=>t.lineCount)});
    else facts.changes.other.push({...info,baseline:r.baseline.results,candidate:r.candidate.results});
  }
}
facts.readerCalls.total=Object.values(facts.readerCalls).reduce((a,b)=>a+b,0);
facts.runtimeApproximation={planFrozenAt:plan.preparedAt,summaryFileLastWriteUtc:statSync(join(input,'summary.json')).mtime.toISOString(),planToFinalWriteMs:statSync(join(input,'summary.json')).mtimeMs-Date.parse(plan.preparedAt),scope:'Approximate engine-initialization/evaluation/write interval after fixture preparation; filesystem timestamp, not an independently measured full-process wall time. Primary summary recordedAt is baseline-phase completion, not full-run completion.'};
facts.residualFalse07FormatLabels=Object.fromEntries([...new Set(facts.residualFalse07.map(r=>r.options.formatLabel))].map(f=>[f,facts.residualFalse07.filter(r=>r.options.formatLabel===f).length]));
facts.limitations=['Payload-family presence and retained target geometry/count are checked only on this frozen option matrix.','Two correct-read line-support reductions are recorded; untested larger minLineCount policies may behave differently.','Diagnostic source-line changes are preserved in primary records; ignoring them here only classifies the observed difference.','No held-out corpus, browser integration, native memory-safety, real deployment, or Scandit comparison is established by this replay.'];
writeFileSync(output,JSON.stringify(facts,null,2)+'\n');
console.log(JSON.stringify({output,profiles:facts.profiles,readerCalls:facts.readerCalls,changes:Object.fromEntries(Object.entries(facts.changes).map(([k,v])=>[k,v.length])),newTextProfiles:facts.newTextProfiles.length,newFormatTextBytesProfiles:facts.newFormatTextBytesProfiles.length,lostStrictTargetProfiles:facts.lostStrictTargetProfiles.length,strictTargetGeometryOrCountChanges:facts.strictTargetGeometryOrCountChanges.length,targetTextButWrongFormatProfiles:facts.targetTextButWrongFormatProfiles.length,residualFalse07FormatLabels:facts.residualFalse07FormatLabels,knownFalse35:facts.knownFalse35,runtime:facts.runtimeApproximation},null,2));
