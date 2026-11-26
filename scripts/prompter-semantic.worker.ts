import {pipeline,env, type FeatureExtractionPipeline} from '@huggingface/transformers';
import {cosine} from './matcher';
import {readVector,trimVectorCache,vectorKey,writeVector} from './embeddingCache';
import {meaningUnits} from './meaningUnits';
import runtimeModule from '@ort-runtime/ort-wasm-simd-threaded.jsep.mjs?url';
import runtimeWasm from '@ort-runtime/ort-wasm-simd-threaded.jsep.wasm?url';
env.allowLocalModels=false;
// One WASM thread keeps memory predictable on Surface and works without COOP/COEP.
env.backends.onnx.wasm!.numThreads=1;
env.backends.onnx.wasm!.wasmPaths={mjs:runtimeModule,wasm:runtimeWasm};
let extractor:FeatureExtractionPipeline|undefined;
let vectors:number[][][]=[];
let generation=0;
let requestedGeneration=0;
const embeddings=new Map<string,number[]>();
let chain=Promise.resolve();
const createExtractor = pipeline as unknown as (task:'feature-extraction',model:string,options:{dtype:'q8';device:'wasm';progress_callback:(p:unknown)=>void})=>Promise<FeatureExtractionPipeline>;
async function getVector(text:string,embed:FeatureExtractionPipeline) {
  const memory=embeddings.get(text);
  if(memory)return {vector:memory,reused:true};
  const key=await vectorKey(text).catch(()=>undefined);
  let vector=key?await readVector(key).catch(()=>undefined):undefined;
  const reused=!!vector;
  if(!vector){
    const output=await embed(text,{pooling:'mean',normalize:true});
    vector=Array.from(output.data as Float32Array);
    if(key)await writeVector(key,vector).catch(()=>{});
  }
  if(embeddings.size>=1000)embeddings.delete(embeddings.keys().next().value!);
  embeddings.set(text,vector);
  return {vector,reused};
}
async function handle(data:{type:string;texts?:string[];text?:string;id?:number;generation:number;modelHost?:string;position?:number;range?:{first:number;last:number}}){
  try{
    if(data.type==='init'){
      generation=data.generation;
      if(!extractor){env.useBrowserCache=true;if(data.modelHost){env.remoteHost=data.modelHost;env.remotePathTemplate='models/{model}/'}extractor=await createExtractor('feature-extraction','Xenova/paraphrase-multilingual-MiniLM-L12-v2',{dtype:'q8',device:'wasm',progress_callback:(p)=>self.postMessage({type:'progress',progress:p,generation:data.generation})})}
      vectors=[];
      let reused=0;
      for(const text of data.texts||[]){
        if(data.generation!==requestedGeneration)return;
        const line:number[][]=[];let allReused=true;
        for(const unit of meaningUnits(text)){
          if(data.generation!==requestedGeneration)return;
          const item=await getVector(unit,extractor);line.push(item.vector);allReused=allReused&&item.reused;
        }
        vectors.push(line);
        if(allReused)reused++;
        self.postMessage({type:'indexing',done:vectors.length,total:data.texts!.length,generation:data.generation});
      }
      void trimVectorCache().catch(()=>{});
      self.postMessage({type:'ready',generation,reused,embedded:vectors.length-reused});
    }else if(data.type==='match'&&extractor&&data.generation===generation){
      const output=await extractor(data.text!,{pooling:'mean',normalize:true});
      const v=Array.from(output.data as Float32Array);
      const first=Math.max(0,data.range?.first??(data.position===undefined?0:data.position-1));
      const end=Math.min(vectors.length,data.range?data.range.last+1:(data.position===undefined?vectors.length:data.position+4));
      const nearby=vectors.slice(first,end);
      self.postMessage({type:'match',id:data.id,generation,scores:Object.fromEntries(nearby.map((views,i)=>[first+i,Math.max(...views.map(x=>cosine(v,x)))]))});
    }
  }catch(e){self.postMessage({type:'error',message:String(e),generation:data.generation})}
}
self.onmessage=e=>{if(e.data.type==='init')requestedGeneration=e.data.generation;chain=chain.then(()=>handle(e.data))};
