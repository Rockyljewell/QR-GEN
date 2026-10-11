// Rebuild from frozen writer315 bit rows; no decoder and no source-file writes.
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {packageRoot,dependencyRequire,cacheRoot,readJson,sha256,writeReport} from '../common.mjs';
const manifest=readJson(join(packageRoot,'generated/manifest.json')),{PNG}=dependencyRequire('pngjs');
function white(width,height,value=255){const png=new PNG({width,height});for(let i=0;i<width*height;i++){png.data[i*4]=png.data[i*4+1]=png.data[i*4+2]=value;png.data[i*4+3]=255;}return png;}
function rotate(source,degrees){const target=new PNG({width:degrees%180?source.height:source.width,height:degrees%180?source.width:source.height});for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){const [tx,ty]=degrees===0?[x,y]:degrees===90?[source.height-1-y,x]:degrees===180?[source.width-1-x,source.height-1-y]:[y,source.width-1-x],a=(y*source.width+x)*4,b=(ty*target.width+tx)*4;for(let c=0;c<4;c++)target.data[b+c]=source.data[a+c];}return target;}
mkdirSync(join(cacheRoot,'generated/images'),{recursive:true});
for(const item of manifest.cases){
 let png;
 if(item.kind==='positive'){
  const row=manifest.symbols.find(s=>s.payload===item.expected).rowBits;png=white((11+95+7)*item.moduleWidth,manifest.frameHeight);const top=Math.floor((manifest.frameHeight-item.barHeight)/2);
  if(row.length!==95||row.slice(0,3)!=='101'||row.slice(45,50)!=='01010'||row.slice(-3)!=='101')throw Error('Invalid frozen EAN row');
  for(let m=0;m<row.length;m++)if(row[m]==='1')for(let y=top;y<top+item.barHeight;y++)for(let dx=0;dx<item.moduleWidth;dx++){const i=(y*png.width+(11+m)*item.moduleWidth+dx)*4;png.data[i]=png.data[i+1]=png.data[i+2]=0;}
 }else{png=white(320,manifest.frameHeight,item.pattern==='gray'?127:255);if(item.pattern==='black-rectangle')for(let y=24;y<40;y++)for(let x=110;x<210;x++){const i=(y*png.width+x)*4;png.data[i]=png.data[i+1]=png.data[i+2]=0;}}
 const rotated=rotate(png,item.rotation),bytes=PNG.sync.write(rotated);
 if(sha256(bytes)!==item.sha256||sha256(rotated.data)!==item.rgbaSha256)throw Error('Generated frozen hash differs: '+item.id);
 writeFileSync(join(cacheRoot,'generated',item.local),bytes);
}
writeReport('generated-preparation.json',{cases:manifest.cases.length,allFrozenHashesMatched:true,method:'Reconstruct frozen writer3.1.5 module rows recorded in manifest; exact rotations and deliberately clipped bars'});
