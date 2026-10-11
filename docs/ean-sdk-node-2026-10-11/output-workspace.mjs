// File-only planning: reject every protected output before mkdir/mkdtemp.
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute, sep, join } from 'node:path';
import { tmpdir } from 'node:os';
const within=(root,path)=>{const rel=relative(root,path);return rel===''||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep);};
function resolvedThroughExistingParent(path){
 let p=resolve(path),tail=[];
 while(!existsSync(p)){const next=dirname(p);if(next===p)throw Error('No existing output ancestor');tail.unshift(p.slice(next.length+1));p=next;}
 return resolve(realpathSync(p),...tail);
}
export function planReplayWorkspace({explicitOutput,protectedRoots}){
 const protectedPaths=protectedRoots.map(p=>realpathSync(resolve(p)));
 let plan,canonical;
 if(explicitOutput){
  const requested=resolve(explicitOutput);if(existsSync(requested))throw Error('Use a fresh output directory');
  canonical=resolvedThroughExistingParent(requested);plan={kind:'explicit',path:canonical};
 }else{
  // Resolve the actual temporary directory, including an existing symlink/junction,
  // before appending the literal prefix used to create a fresh sibling directory.
  const base=realpathSync(resolve(tmpdir()));canonical=join(base,'qrgen-staged-sdk-node-');plan={kind:'temporary',prefix:canonical};
 }
 for(const p of protectedPaths)if(within(p,canonical))throw Error('Output may not be inside package, dependency checkout, frozen input cache or consumer package');
 return plan;
}
