export class PCM16Resampler {
  constructor(inputRate){if(!Number.isFinite(inputRate)||inputRate<8000||inputRate>192000)throw Error('Unsupported audio sample rate');this.ratio=inputRate/16000;this.filled=0;this.sum=0}
  push(input){const output=[];for(const sample of input){let left=1;while(left>1e-9){const used=Math.min(left,this.ratio-this.filled);this.sum+=sample*used;this.filled+=used;left-=used;if(this.filled>=this.ratio-1e-9){output.push(this.sum/this.ratio);this.sum=0;this.filled=0}}}return output}
}
if(typeof registerProcessor==='function'){
 class SuperPrompterPCM extends AudioWorkletProcessor {
  constructor(){super();this.converter=new PCM16Resampler(sampleRate);this.buffer=new Float32Array(1600);this.offset=0;this.inputs=0}
  process(inputs){const input=inputs[0]?.[0];if(input){for(const value of this.converter.push(input)){this.buffer[this.offset++]=value;if(this.offset===1600){this.port.postMessage({type:'pcm',samples:this.buffer,inputRate:sampleRate,outputRate:16000,audioTime:currentTime},[this.buffer.buffer]);this.buffer=new Float32Array(1600);this.offset=0}}}else if(++this.inputs%100===0)this.port.postMessage({type:'input-missing',inputRate:sampleRate});return true}
 }
 registerProcessor('super-prompter-pcm',SuperPrompterPCM);
}
