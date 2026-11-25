/* Runtime: Apache-2.0. Offline weights: zzasdf vi68, declared Apache-2.0; see THIRD-PARTY-AI.md. */
importScripts('./vendor/sherpa-2.0.3/sherpa-onnx-wasm-web.js','./vendor/sherpa-2.0.3/sherpa-onnx-asr.js','./model-assets.js');
let runtime,recognizer,stream,lastText='';
self.onmessage=async({data})=>{
  try{
    if(data.type==='load'){
      const manifest=await(await fetch('./offline-model.json')).json();
      const wasm=await fetch('./vendor/sherpa-2.0.3/sherpa-onnx-wasm-web.wasm');if(!wasm.ok)throw Error('Runtime HTTP '+wasm.status);
      runtime=await SherpaOnnx({wasmBinary:await wasm.arrayBuffer(),print:()=>{},printErr:()=>{}});
      const cache=await caches.open(manifest.cache).catch(()=>undefined),total=manifest.files.reduce((sum,file)=>sum+file.bytes,0);let loaded=0,last=-1;
      for(const file of manifest.files){
        const bytes=await weight(manifest.root+file.name,file,cache,received=>{
          const progress=Math.floor((loaded+received)/total*100);if(progress!==last){last=progress;self.postMessage({type:'progress',progress});}
        });runtime.FS.writeFile('/'+file.path,new Uint8Array(bytes));loaded+=file.bytes;
      }
      recognizer=new OfflineRecognizer({
        featConfig:{sampleRate:16000,featureDim:80},
        modelConfig:{transducer:{encoder:'/encoder.int8.onnx',decoder:'/decoder.onnx',joiner:'/joiner.int8.onnx'},tokens:'/tokens.txt',numThreads:1,provider:'cpu',modelType:'transducer'},
        decodingMethod:'greedy_search',enableEndpoint:1,rule1MinTrailingSilence:1.5,rule2MinTrailingSilence:.55,rule3MinUtteranceLength:20,
      },runtime);
      if(!recognizer.handle)throw Error('Streaming initialization');
      for(const file of manifest.files)runtime.FS.unlink('/'+file.path);
      const warm=recognizer.createStream();
      try{warm.acceptWaveform(16000,new Float32Array(16000));recognizer.decode(warm);}finally{warm.free();}
      self.postMessage({type:'ready',memory_bytes:runtime.HEAPU8.length});
    }else if(data.type==='transcribe'&&recognizer){
      const start=performance.now(),stream=recognizer.createStream();
      try{stream.acceptWaveform(16000,data.samples);recognizer.decode(stream);const result=recognizer.getResult(stream);
        self.postMessage({type:'result',text:result.text||'',seconds:data.samples.length/16000,processing_ms:performance.now()-start});
      }finally{stream.free();}
    }
  }catch(error){self.postMessage({type:'error',code:error?.name||'streaming-error'});}
};
