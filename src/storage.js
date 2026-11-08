const opened = new Promise((resolve, reject) => {
  const r = indexedDB.open("super-content-v1", 1);
  r.onupgradeneeded = () =>
    r.result.createObjectStore("videos", { keyPath: "key" });
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
export async function all(scope) {
  const db = await opened;
  return new Promise((resolve, reject) => {
    const r = db.transaction("videos").objectStore("videos").getAll();
    r.onsuccess = () => resolve(r.result.filter((x) => x.scope === scope));
    r.onerror = () => reject(r.error);
  });
}
// Read-modify-write in one transaction: a keystroke never overwrites another tab's newer fields.
export async function mutate(scope, id, fn) {
  const db = await opened;
  return new Promise((resolve, reject) => {
    const t = db.transaction("videos", "readwrite"),
      s = t.objectStore("videos");
    let result;
    const r = s.get(`${scope}:${id}`);
    r.onsuccess = () => {
      try {
        result = fn(r.result);
        if (result) s.put({ ...result, key: `${scope}:${id}`, scope });
      } catch (e) {
        t.abort();
        reject(e);
      }
    };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Không thể lưu dữ liệu"));
  });
}
