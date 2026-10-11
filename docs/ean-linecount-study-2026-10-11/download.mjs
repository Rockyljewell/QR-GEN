// Download only the frozen pinned source/truth list. No decoder is loaded.
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {manifest,cacheRoot,checked} from './common.mjs';
const jobs=manifest.cases.flatMap(item=>[{path:item.sourcePath,local:item.localImage,sha:item.sourceSha256},{path:item.truthPath,local:item.localTruth,sha:item.truthSha256}]);
let next=0;
await Promise.all(Array.from({length:12},async()=>{while(next<jobs.length){const job=jobs[next++],target=join(cacheRoot,job.local);if(!existsSync(target)){const response=await fetch('https://raw.githubusercontent.com/zxing/zxing/'+manifest.sourceCommit+'/'+job.path);if(!response.ok)throw Error(response.status+' '+job.path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,Buffer.from(await response.arrayBuffer()));}checked(target,job.sha);}}));
console.log(JSON.stringify({sourceCases:manifest.cases.length,verifiedFiles:jobs.length,cache:cacheRoot}));
