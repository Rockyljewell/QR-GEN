// Enumerate at most two complete distinct EAN13 words among exactly equal-best
// digit matches. Dynamic programming bounds each parity/checksum state to two
// distinct prefixes; this suffices to establish ambiguity without truth use.
import {parities} from './trace-rows.mjs';
export function equalBestValidWords(digits){
 let states=new Map([['0:0',{parity:0,sum:0,words:['']}]]);
 for(let i=0;i<12;i++){
  const next=new Map(),d=digits[i],best=d.candidates.filter(x=>x.variance===d.winner.variance);
  for(const state of states.values())for(const choice of best){
   const parity=i<6?(state.parity<<1)|(choice.index>=10?1:0):state.parity;
   let residue=(state.sum+choice.digit*(i%2===0?3:1))%10;
   let lead=null;if(i===5){lead=parities.indexOf(parity);if(lead<0)continue;residue=(residue+lead)%10;}
   const key=parity+':'+residue,target=next.get(key)??{parity,sum:residue,words:[]};
   for(const prefix of state.words){const word=(lead===null?'':String(lead))+prefix+choice.digit;if(target.words.length<2&&!target.words.includes(word))target.words.push(word);}
   next.set(key,target);
  }
  states=next;
 }
 const words=[];for(const state of states.values())if(state.sum===0)for(const word of state.words)if(!words.includes(word)){words.push(word);if(words.length===2)return words;}
 return words;
}

