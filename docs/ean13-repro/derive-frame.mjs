// Modified conversion: reproduce only the single PNG diagnostic raster.
// Inputs are immutable; output always goes to temp/the explicit output directory.
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {manifest,dependencyRequire,fixtureBytes,sha256,outputRoot,writeReport} from './common.mjs';
const sharp=dependencyRequire('sharp'),{PNG}=dependencyRequire('pngjs');
const source=manifest.fixtures.find(item=>item.pipeline==='original-PNG');
const expected=manifest.fixtures.find(item=>item.pipeline==='frozen-first-frame-limited-Y-expanded-RGB');
const {data,info}=await sharp(fixtureBytes(source)).flatten({background:'#ffffff'}).removeAlpha().toColourspace('srgb')
 .resize({width:640,height:480,fit:'inside',withoutEnlargement:true,kernel:'lanczos3'}).raw().toBuffer({resolveWithObject:true});
if(info.channels!==3||info.width!==480||info.height!==360)throw Error('Unexpected source raster');
const width=640,height=480,left=80,top=60,luma=Buffer.alloc(width*height,200);
for(let row=0;row<info.height;row++)for(let col=0;col<info.width;col++){
 const i=(row*info.width+col)*3;
 luma[(row+top)*width+col+left]=Math.round(16+(65.738*data[i]+129.057*data[i+1]+25.064*data[i+2])/255);
}
const png=new PNG({width,height});
for(let i=0;i<luma.length;i++){
 const value=Math.max(0,Math.min(255,Math.round((luma[i]-16)*255/219)));
 png.data[i*4]=png.data[i*4+1]=png.data[i*4+2]=value;png.data[i*4+3]=255;
}
const bytes=PNG.sync.write(png),hash=sha256(bytes);
if(hash!==expected.sha256)throw Error('Derived PNG hash differs from the recorded fixture');
writeFileSync(join(outputRoot,expected.local),bytes);
writeReport('derivation-results.json',{scope:'Deterministic derived fixture regeneration; not actual Chrome pixel proof',recordedAt:new Date().toISOString(),sha256:hash,width,height,left,top,resized:false,sharpVersion:sharp.versions.sharp});
