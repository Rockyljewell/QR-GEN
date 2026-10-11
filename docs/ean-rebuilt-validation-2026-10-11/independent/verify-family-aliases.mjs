// Supplement to literal format-name review. Upstream reports QRCode for QR model inputs.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),input=resolve(process.argv[2]??join(here,'../../rebuilt-ean/actual-matrix-v1'));
const output=resolve(process.argv[3]??join(here,'actual-matrix-family-review.json'));
if(existsSync(output))throw Error('Use fresh evidence output');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=n=>readFileSync(join(input,n)),plan=JSON.parse(read('evaluation-plan.json'));
const records=read('candidate-comparison.jsonl').toString().trim().split(/\r?\n/).map(JSON.parse);
const literalPath=join(here,'actual-matrix-review.json'),literal=JSON.parse(readFileSync(literalPath));
const familyOf=f=>['QRCodeModel1','QRCodeModel2'].includes(f)?'QRCode':f;
const items=new Map(plan.items.map(i=>[i.group+'/'+i.id,i]));
const observedAliases=literal.targetTextButWrongFormatProfiles;
for(const r of observedAliases){
 const expected=items.get(r.itemKey).expectedTargets;
 if(!expected||!r.results.every(o=>o.format==='QRCode'&&expected.some(t=>t.text===o.text&&t.families.some(f=>['QRCodeModel1','QRCodeModel2'].includes(f)))))throw Error('Unexpected format-name difference');
}
const arms=structuredClone(literal.arms),aliasArmProfiles=new Map();
for(const r of observedAliases){
 const key=r.arm+'/'+r.mode,list=aliasArmProfiles.get(key)??[]; list.push(r); aliasArmProfiles.set(key,list);
}
for(const [key,list]of aliasArmProfiles){
 arms[key].baselineStrictTargetProfiles+=list.length;arms[key].candidateStrictTargetProfiles+=list.length;
 arms[key].baselineStrictTargetDetections+=list.reduce((s,r)=>s+r.results.length,0);arms[key].candidateStrictTargetDetections+=list.reduce((s,r)=>s+r.results.length,0);
}
const missingOrChangedAliases=[];
for(const alias of observedAliases){
 const r=records.find(r=>r.profileId===alias.profileId);
 for(const c of alias.results)if(!r.baseline.results.some(b=>b.isValid&&b.text===c.text&&b.format===c.format&&b.bytesHex===c.bytesHex&&JSON.stringify(b.position)===JSON.stringify(c.position)))missingOrChangedAliases.push(alias.profileId);
}
if(missingOrChangedAliases.length)throw Error('Alias decode behavior changed');
const facts={scope:'Independent output-family supplement to literal format-name review; no decoder execution.',input,planSha256:sha(read('evaluation-plan.json')),literalReviewSha256:sha(readFileSync(literalPath)),reviewerSha256:sha(readFileSync(fileURLToPath(import.meta.url))),profileCount:records.length,familyDefinition:'EAN13, UPCA, UPCE, EAN8 and other tested formats require exact returned name. QRCodeModel1 and QRCodeModel2 are accepted as the upstream QRCode output family; no QR subtype equality claim is made.',expectedQrModelInputToQrCodeOutputProfiles:observedAliases.length,unexpectedOutputFamilyProfiles:0,lostExpectedTextFamilyByteProfiles:literal.lostStrictTargetProfiles.length,retainedExpectedTargetGeometryOrCountChanges:literal.strictTargetGeometryOrCountChanges.length,newTextFormatByteProfiles:literal.newFormatTextBytesProfiles.length,arms,aliasProfiles:observedAliases.map(r=>({profileId:r.profileId,itemKey:r.itemKey,arm:r.arm,mode:r.mode,inputFormats:r.options.formats,returnedFormats:r.results.map(t=>t.format)})),limitations:literal.limitations};
writeFileSync(output,JSON.stringify(facts,null,2)+'\n');
console.log(JSON.stringify({output,profileCount:facts.profileCount,expectedQrAliases:facts.expectedQrModelInputToQrCodeOutputProfiles,unexpectedOutputFamilyProfiles:0,lostExpectedTextFamilyByteProfiles:facts.lostExpectedTextFamilyByteProfiles,arms},null,2));
