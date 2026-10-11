// Artifact-only JS port of the pinned EAN13-only, full-resolution 1D reader.
// Baseline must be checked against actual unmodified WASM for every raster.
import {binarize,runsOf,parse,getLine,guard} from './trace-rows.mjs';
import {equalBestValidWords} from './word-ambiguity.mjs';
const maxAbs=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const absSum=a=>Math.abs(a.x)+Math.abs(a.y);
function intersects(a,b){const ranges=p=>[Math.min(...p.map(p=>p.x)),Math.max(...p.map(p=>p.x)),Math.min(...p.map(p=>p.y)),Math.max(...p.map(p=>p.y))],aa=ranges(a),bb=ranges(b);return !(aa[1]<bb[0]||bb[1]<aa[0]||aa[3]<bb[2]||bb[3]<aa[2]);}
function equal(sl,ml){if(sl.text!==ml.text||sl.axis!==ml.axis||sl.reverse!==ml.reverse)return false;
 const dTop=maxAbs(ml.p[0],sl.p[0]),dBot=maxAbs(ml.p[3],sl.p[0]),len=maxAbs(sl.p[0],sl.p[2]);
 const mlen=sl.p[0].y===sl.p[2].y?Math.abs(ml.p[0].x-ml.p[2].x):Math.abs(ml.p[0].y-ml.p[2].y);
 return Math.min(dTop,dBot)<Math.trunc(len/2)&&Math.abs(len-mlen)<Math.trunc(len/5);}
function rowResults(runs,tryHarder,rejectTies){const eans=new Map(parse(runs,rejectTies,true).map(x=>[x.at,x])),out=[];
 let cursor=1;
 while(cursor<runs.length){let at=cursor,found=false;
  if(runs.length-cursor<33)break;
  if(at===1&&guard(runs,at,3,6,2147483647))found=true;
  else for(;at<runs.length-33;at+=2)if(guard(runs,at,3,6,runs[at-1])){found=true;break;}
  if(!found)break;
  const ean=eans.get(at);if(ean?.checksumValid&&equalBestValidWords(ean.digits).length<2)out.push(ean);
  cursor=(ean?at+56:at)+2;
  if(!tryHarder)break;
 }
 return out;}
export function portRead(p,{tryHarder=true,rejectTies=false,minLineCount=2,maxSymbols=255}={}){
 const all=[];
 for(const axis of ['horizontal','vertical']){
  const rotate=axis==='vertical',width=rotate?p.height:p.width,height=rotate?p.width:p.height,middle=Math.trunc(height/2),step=Math.max(1,Math.trunc(height/(tryHarder?(maxSymbols===1?256:512):32))),maxLines=tryHarder?height:15,minLines=Math.min(minLineCount,height),checkRows=[],res=[];
  for(let i=0;i<maxLines;i++){
   let row=middle+step*(i%2===0?Math.trunc((i+1)/2):-Math.trunc((i+1)/2)),isCheck=false;
   if(row<0||row>=height)break;
   if(checkRows.length){i--;row=checkRows.pop();isCheck=true;if(row<0||row>=height)continue;}
   const bin=binarize(getLine(p,axis,row));if(!bin.bits)continue;
   for(const reverse of [false,true]){
    const bits=reverse?Uint8Array.from(bin.bits).reverse():bin.bits;
    for(const found of rowResults(runsOf(bits),tryHarder,rejectTies)){
     let points=[{x:found.start,y:row},{x:found.end,y:row},{x:found.end,y:row},{x:found.start,y:row}];
     if(reverse)points=points.map(v=>({x:width-v.x-1,y:v.y}));if(rotate)points=points.map(v=>({x:v.y,y:width-v.x-1}));
     const candidate={text:found.text,lineCount:1,p:points,axis,reverse,rows:[row],tiedRows:found.digits.some(d=>d.ties>1)?[row]:[]};let merged=false;
     for(const other of res)if(equal(candidate,other)){
      const dt=maxAbs(other.p[0],candidate.p[0]),db=maxAbs(other.p[3],candidate.p[0]);
      if(dt<db||(dt===db&&(rotate!==(absSum(other.p[0])>absSum(candidate.p[0]))))){other.p[0]=candidate.p[0];other.p[1]=candidate.p[1];}
      else{other.p[2]=candidate.p[2];other.p[3]=candidate.p[3];}
      other.lineCount++;other.rows.push(row);other.tiedRows.push(...candidate.tiedRows);merged=true;break;
     }
     if(!merged){res.push(candidate);if(!isCheck&&minLines>1&&step>1){checkRows.splice(0,checkRows.length,row-1,row+1);if(step>2)checkRows.push(row-2,row+2);}}
    }
   }
  }
  const valid=res.filter(x=>x.lineCount>=minLines);
  for(let i=0;i<valid.length;i++)for(let j=i+1;j<valid.length;j++)if(intersects(valid[i].p,valid[j].p)){
   const drop=valid[i].lineCount<valid[j].lineCount?valid[i]:valid[j];drop.text=null;drop.p=Array.from({length:4},()=>({x:0,y:0}));
  }
  all.push(...valid.filter(x=>x.text));
 }
 return all.map(r=>({text:r.text,lineCount:r.lineCount,position:{topLeft:r.p[0],topRight:r.p[1],bottomRight:r.p[2],bottomLeft:r.p[3]},axis:r.axis,reverse:r.reverse,rows:r.rows,tiedRows:r.tiedRows}));
}
