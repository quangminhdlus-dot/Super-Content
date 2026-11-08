import { readdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((f) =>
    f.isDirectory() ? walk(`${dir}/${f.name}`) : [`${dir}/${f.name}`],
  );
}
const files = walk("dist").filter((f) => !f.endsWith("/sw.js"));
const version = createHash("sha256")
  .update(files.map((f) => readFileSync(f)).join(""))
  .digest("hex")
  .slice(0, 12);
writeFileSync(
  "dist/sw.js",
  `const CACHE='super-content-${version}',FILES=${JSON.stringify(files.map((f) => "./" + f.slice(5)))};
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('super-content-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL('./',self.location).pathname))return;
 event.respondWith(caches.open(CACHE).then(async cache=>{const found=await cache.match(event.request,{ignoreVary:true});if(found)return found;try{return await fetch(event.request);}catch(error){if(event.request.mode==='navigate')return await cache.match(new URL('./index.html',self.location).href);throw error;}}));});`,
);
