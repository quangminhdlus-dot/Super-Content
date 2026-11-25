async function weight(url,file,cache,progress){
  let data=await cache?.match(url).then(response=>response?.arrayBuffer()).catch(()=>undefined);
  const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(data&&(data.byteLength!==file.bytes||await hash(data)!==file.sha256)){await cache.delete(url);data=undefined;}
  if(!data){
    const response=await fetch(url);if(!response.ok)throw Error('Model HTTP '+response.status);
    const reader=response.body.getReader(),bytes=new Uint8Array(file.bytes);let offset=0;
    for(;;){const {value,done}=await reader.read();if(done)break;if(offset+value.length>bytes.length){await reader.cancel();throw Error('Model size');}bytes.set(value,offset);offset+=value.length;progress(offset);}
    if(offset!==bytes.length||await hash(bytes)!==file.sha256)throw Error('Model integrity');
    data=bytes.buffer;if(cache)await cache.put(url,new Response(data)).catch(()=>{});
  }
  progress(file.bytes);return data;
}
