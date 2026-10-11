import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const here=dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const m=JSON.parse(readFileSync(join(here,'package-manifest.json')));
for(const f of m.files){const b=readFileSync(join(here,f.path));if(b.length!==f.bytes||sha(b)!==f.sha256)throw Error('Changed package file: '+f.path);if(f.uncompressedSha256&&sha(gunzipSync(b))!==f.uncompressedSha256)throw Error('Changed uncompressed data: '+f.path);}
const raw=gunzipSync(readFileSync(join(here,'candidate-comparison.jsonl.gz'))).toString().trim().split(/\r?\n/).map(JSON.parse);
if(raw.length!==3988||new Set(raw.map(r=>r.profileId)).size!==3988)throw Error('Unexpected raw profile count');
console.log(JSON.stringify({status:'package-integrity-passed',files:m.files.length,profiles:raw.length,originalPlanSha256:m.originalPlanSha256,packageManifestSha256:sha(readFileSync(join(here,'package-manifest.json')))}));
