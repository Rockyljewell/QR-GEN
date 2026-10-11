// Diagnostic port of the pinned GlobalHistogram + EAN13 active code paths.
// Read-only artifacts; not replacement product code. Exact selected bit rows
// are replayed through the original WASM BoolCast reader as a cross-check.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=dirname(fileURLToPath(import.meta.url)),art=dirname(root);
const requested=resolve(process.env.QRGEN_REPRO_DEPENDENCY_ROOT??process.env.QRGEN_COMPARISON_REPO??process.cwd());
const dependencyRoot=existsSync(join(requested,'packages/sdk/package.json'))?join(requested,'packages/sdk'):requested;
const require=createRequire(join(dependencyRoot,'package.json'));
const {PNG}=require('pngjs'),sharp=require('sharp'),reader=require('zxing-wasm/reader');
if(reader.ZXING_WASM_VERSION!=='3.1.5')throw Error('Expected local zxing-wasm3.1.5');
const wasm=readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
reader.prepareZXingModule({overrides:{wasmBinary:wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength)},fireImmediately:false});
const sha=b=>createHash('sha256').update(b).digest('hex');
const f=Math.fround,sum=a=>a.reduce((a,b)=>a+b,0);
const L=[[3,2,1,1],[2,2,2,1],[2,1,2,2],[1,4,1,1],[1,1,3,2],[1,2,3,1],[1,1,1,4],[1,3,1,2],[1,2,1,3],[3,1,1,2]];
const LG=[...L,...L.map(x=>[...x].reverse())],parities=[0,11,13,14,19,25,28,21,22,26];
function valid(s){let n=0;for(let i=0;i<13;i++)n+=Number(s[i])*(i%2?3:1);return n%10===0;}
function blackPoint(line){
 const buckets=Array(32).fill(0);for(const x of line)buckets[x>>3]++;
 let first=0;for(let i=1;i<32;i++)if(buckets[i]>buckets[first])first=i;
 const maxBucket=buckets[first];let second=0,score=0;
 for(let i=0;i<32;i++){const s=buckets[i]*(i-first)**2;if(s>score){score=s;second=i;}}
 if(first>second)[first,second]=[second,first];
 if(second-first<=2)return {threshold:-2,buckets,first,second};
 let valley=second-1;score=-1;
 for(let i=second-1;i>first;i--){const s=(i-first)**2*(second-i)*(maxBucket-buckets[i]);if(s>score){score=s;valley=i;}}
 return {threshold:(valley<<3)-1,buckets,first,second};
}
function binarize(line){const h=blackPoint(line),bits=new Uint8Array(line.length);if(h.threshold<=0)return {...h,bits:null};
 for(let i=0;i<line.length;i++){const v=i===0||i===line.length-1?line[i]:Math.trunc((-line[i-1]+4*line[i]-line[i+1])/2);bits[i]=v<=h.threshold?1:0;}
 return {...h,bits};}
function runsOf(bits){const runs=[0];let state=0;for(const b of bits){if(b!==state){runs.push(0);state=b;}runs[runs.length-1]++;}if(state)runs.push(0);return runs;}
function guard(r,at,len,qz,space){if(at<0||at+len>r.length)return 0;const a=r.slice(at,at+len),mod=sum(a)/len;
 if(space<qz*mod-1||a.some(x=>Math.abs(x-mod)>mod*.5+.5))return 0;return mod;}
function variance(c,p){const total=sum(c);if(total<7)return Infinity;const unit=f(total/7),max=f(f(.7)*unit);let v=0;
 for(let i=0;i<4;i++){const d=Math.abs(f(c[i]-f(p[i]*unit)));if(d>max)return Infinity;v=f(v+d);}return f(v/total);}
function digit(c,left){const ps=left?LG:L,candidates=ps.map((p,i)=>({index:i,digit:i%10,parity:i>=10?'G':'L',variance:variance(c,p),pattern:p})).filter(x=>x.variance<f(.48)).sort((a,b)=>a.variance-b.variance||a.index-b.index);
 if(!candidates.length)return null;const winner=candidates[0],ties=candidates.filter(x=>x.variance===winner.variance);return {runs:c,moduleSize:f(sum(c)/7),winner,ties:ties.length,candidates};}
function parse(runs,rejectTies=false,includeChecksumErrors=false){const out=[],prefix=[0];for(const x of runs)prefix.push(prefix.at(-1)+x);
 for(let at=1;at+59<=runs.length;at+=2){
  const leftSpace=at===1?2147483647:runs[at-1];const start=guard(runs,at,3,6,leftSpace);if(!start)continue;
  const endAt=at+56,endSpace=endAt+3===runs.length-1?2147483647:runs[endAt+3];const end=guard(runs,endAt,3,3,endSpace),mid=guard(runs,at+27,5,0,0);if(!end||!mid)continue;
  let digs=[],lg=0,txt='';for(let i=0;i<12;i++){const pos=at+(i<6?3+4*i:32+4*(i-6)),d=digit(runs.slice(pos,pos+4),i<6);if(!d||(rejectTies&&d.ties>1))break;d.position=[prefix[pos],prefix[pos+4]-1];digs.push(d);txt+=d.winner.digit;if(i<6)lg=(lg<<1)|(d.winner.index>=10?1:0);}
  if(digs.length!==12||!parities.includes(lg))continue;txt=String(parities.indexOf(lg))+txt;
  if(!includeChecksumErrors&&!valid(txt))continue;
  const moduleGuard=(sum(runs.slice(at,at+3))+sum(runs.slice(at+27,at+32))+sum(runs.slice(endAt,endAt+3)))/11;
  out.push({text:txt,at,checksumValid:valid(txt),parity:lg,start:prefix[at],end:prefix[endAt+3]-1,guards:{left:start,middle:mid,right:end,leftSpace:at===1?null:runs[at-1],rightSpace:endAt+3===runs.length-1?null:runs[endAt+3],moduleMean:moduleGuard},digitModuleRelativeToGuard:digs.map(d=>d.moduleSize/moduleGuard),digits:digs});
 }
 return out;}
function lum(png){const out=new Uint8Array(png.width*png.height);for(let i=0;i<out.length;i++){let j=i*4;out[i]=(306*png.data[j]+601*png.data[j+1]+117*png.data[j+2]+512)>>10;}return out;}
function getLine(p,axis,row){const arr=new Uint8Array(axis==='horizontal'?p.width:p.height);for(let i=0;i<arr.length;i++)arr[i]=axis==='horizontal'?p.lum[row*p.width+i]:p.lum[(p.height-1-i)*p.width+row];return arr;}
function simpleResult(r){return {text:r.text,lineCount:r.lineCount,isValid:r.isValid,error:r.error,position:r.position};}
const options={formats:['EAN13'],tryHarder:true,tryRotate:true,tryDownscale:false,tryInvert:false,maxNumberOfSymbols:255,minLineCount:2,returnErrors:false,eanAddOnSymbol:'Ignore',binarizer:'LocalAverage'};
export {root,art,require,PNG,sharp,reader,wasm,sha,valid,blackPoint,binarize,runsOf,parse,lum,getLine,simpleResult,options,parities,guard};
