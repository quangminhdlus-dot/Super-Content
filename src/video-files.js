const runtimeUrl = new URL("prompter/runtime.js", document.baseURI);
runtimeUrl.searchParams.set("v", __PROMPTER_REVISION__);
export const loadVideoRuntime = () => import(/* @vite-ignore */ runtimeUrl.href);

export function clipName(clip) {
  const base = clip.title?.trim() || "Video " + new Date(clip.created).toLocaleString("vi-VN");
  return clip.take ? clip.take + ". " + base : base;
}
export function clipFile(core, clip) {
  const name = clipName(clip).replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").trim().replace(/[. ]+$/g, "");
  return core.DraftStore.file(clip, "Super-Content", Array.from(name).slice(0, 72).join(""));
}
export async function exportClip(core, file, download = false) {
  if (!download && navigator.canShare?.({files:[file]}) && navigator.share) {
    await core.shareVideo(file, "Super Content");
  } else {
    core.downloadVideo(file);
  }
}
export const confirmClipRemoval = clip => confirm(`Xóa “${clipName(clip)}” khỏi Kho Video?`);

export function frameOrientation(width, height) {
  if (!width || !height) return "";
  const ratio = width / height;
  if (Math.abs(ratio / (9 / 16) - 1) <= .02) return "portrait";
  if (Math.abs(ratio / (16 / 9) - 1) <= .02) return "landscape";
  return "other";
}
export function frameLabel(width, height) {
  const direction = frameOrientation(width, height);
  const ratio = direction === "portrait" ? "Dọc 9:16" : direction === "landscape" ? "Ngang 16:9" : "Tỷ lệ khác";
  return ratio + " · " + width + "×" + height;
}
