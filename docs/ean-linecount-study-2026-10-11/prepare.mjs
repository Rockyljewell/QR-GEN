// Regenerate derived rasters; verify all frozen original/derived pixel hashes.
import {writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {manifest,dependencyRequire,cacheRoot,checked,sha256,writeReport} from './common.mjs';
const sharp=dependencyRequire('sharp'),{PNG}=dependencyRequire('pngjs');
for(const item of manifest.cases){
 const source=checked(join(cacheRoot,item.localImage),item.sourceSha256);
 const pipeline=()=>sharp(source).flatten({background:'#ffffff'}).removeAlpha().toColourspace('srgb');
 const original=await pipeline().ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(sha256(original.data)!==item.rasters[0].pixelsSha256)throw Error('Original pixels changed');
 const {data,info}=await pipeline().resize({width:640,height:480,fit:'inside',withoutEnlargement:true,kernel:'lanczos3'}).raw().toBuffer({resolveWithObject:true});
 const left=Math.floor((640-info.width)/2),top=Math.floor((480-info.height)/2),luma=Buffer.alloc(640*480,200);
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*3;luma[(y+top)*640+x+left]=Math.round(16+(65.738*data[i]+129.057*data[i+1]+25.064*data[i+2])/255);}
 const png=new PNG({width:640,height:480});for(let i=0;i<luma.length;i++){const v=Math.max(0,Math.min(255,Math.round((luma[i]-16)*255/219)));png.data[i*4]=png.data[i*4+1]=png.data[i*4+2]=v;png.data[i*4+3]=255;}
 const raster=item.rasters[1],bytes=PNG.sync.write(png);
 if(sha256(bytes)!==raster.pngSha256||sha256(png.data)!==raster.pixelsSha256)throw Error('Derived raster changed');
 const target=join(cacheRoot,raster.local);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);
}
writeReport('preparation.json',{sourceCases:manifest.cases.length,allFrozenRasterHashesMatched:true,sharpVersion:sharp.versions.sharp});
