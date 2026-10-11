import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
function required(name){if(!process.env[name])throw Error('Required environment variable '+name);return resolve(process.env[name]);}
export const root=required('QRGEN_STAGED_WORKDIR');
export const repo=required('QRGEN_DIAGNOSTIC_REPO');
export const stage=required('QRGEN_STAGED_SDK_ROOT');
export const chromiumExe=required('QRGEN_CHROMIUM');
export const {chromium}=createRequire(join(repo,'site/package.json'))('playwright');
export const sharp=createRequire(join(repo,'package.json'))('sharp');
export const hash=x=>createHash('sha256').update(x).digest('hex');
export const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
export async function save(p,x){await mkdir(dirname(p),{recursive:true});await writeFile(p,JSON.stringify(x,null,2)+'\n',{flag:'wx'});}
export async function digest(p){const b=await readFile(p);return {bytes:b.length,sha256:hash(b)};}
export async function server(){
 const requests=[];
 const srv=createServer(async(req,res)=>{
  try {
   const p=new URL(req.url,'http://localhost').pathname;
   let file;
   if(p==='/'||p==='/index.html'){res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>Isolated SDK diagnostic</title>');return;}
   if(p==='/corrupt.wasm'){const b=Buffer.from('QRGEN deliberately corrupt non-WASM diagnostic v1\n');requests.push({path:p,sha256:hash(b),bytes:b.length});res.setHeader('content-type','application/wasm');res.end(b);return;}
   if(p.startsWith('/fixtures/'))file=join(root,p.slice(1));
   else if(/^\/staged\/(baseline|candidate)\//.test(p))file=join(stage,'consumers',p.split('/')[2],'package',...p.split('/').slice(3));
   else {res.writeHead(404);res.end();return;}
   const allowed=p.startsWith('/fixtures/')?join(root,'fixtures'):join(stage,'consumers',p.split('/')[2],'package');
   const rel=relative(resolve(allowed),resolve(file));if(rel.startsWith('..')||isAbsolute(rel))throw new Error('path outside allowlist');
   const b=await readFile(file);requests.push({path:p,sha256:hash(b),bytes:b.length});
   res.setHeader('cache-control','no-store');res.setHeader('content-type',p.endsWith('.wasm')?'application/wasm':p.endsWith('.js')?'text/javascript':p.endsWith('.png')?'image/png':'application/octet-stream');res.end(b);
  }catch(e){res.writeHead(404);res.end(String(e));}
 });
 await new Promise((ok,no)=>srv.once('error',no).listen(Number(process.env.QRGEN_DIAGNOSTIC_PORT??4352),'127.0.0.1',ok));
 const origin='http://127.0.0.1:'+srv.address().port;
 return {origin,requests,close:()=>new Promise(r=>srv.close(r))};
}
export async function launch(fixture){return chromium.launch({executablePath:chromiumExe,headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',...(fixture?['--use-file-for-fake-video-capture='+fixture]:[])]});}
export async function context(browser,origin){const c=await browser.newContext({permissions:['camera'],serviceWorkers:'block'});const blocked=[];await c.route('**/*',r=>{const u=r.request().url();if(u.startsWith(origin+'/')||u.startsWith('blob:')||u.startsWith('data:'))return r.continue();blocked.push(u);return r.abort('blockedbyclient');});return {context:c,blocked};}
