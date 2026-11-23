// Keep existing source_url TEXT compatible with earlier single-link records and sync.
// Multiple references use one HTTP(S) URL per line; no database migration required.
export const MAX_REFERENCE_LINKS = 40;
export const MAX_REFERENCE_URL_LENGTH = 2048;
export const MAX_SOURCE_URL_LENGTH = 32000;

export function referenceLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function safeReferenceUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > MAX_REFERENCE_URL_LENGTH || /[\u0000-\u001F\u007F]/u.test(raw))
    return null;
  const candidate = /^[a-z][\w+.-]*:/i.test(raw) ? raw : "https://" + raw;
  try {
    const url = new URL(candidate);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname.includes(".") ||
      url.username || url.password
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parseReferenceLinks(value) {
  return referenceLines(value)
    .map(safeReferenceUrl)
    .filter(Boolean);
}

export function referenceKind(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be")
    return "youtube";
  if (host === "vimeo.com" || host.endsWith(".vimeo.com") ||
      host === "tiktok.com" || host.endsWith(".tiktok.com"))
    return "video";
  if (url.pathname.match(/\.(?:pdf|docx?|txt)$/i) ||
      ["docs.google.com", "drive.google.com"].includes(host))
    return "document";
  return "link";
}

export function addReferenceLinks(original, incoming) {
  const existing = referenceLines(original);
  const additions = referenceLines(incoming);
  if (!additions.length) throw new Error("Hãy dán đường dẫn trước khi thêm.");
  if (existing.length + additions.length > MAX_REFERENCE_LINKS)
    throw new Error("Một ý tưởng lưu tối đa 40 đường dẫn tham khảo.");
  const seen = new Set(existing.map((line) => safeReferenceUrl(line)).filter(Boolean));
  const next = [...existing];
  for (const candidate of additions) {
    const url = safeReferenceUrl(candidate);
    if (!url) throw new Error("Liên kết không hợp lệ. Chỉ chấp nhận địa chỉ http hoặc https.");
    if (seen.has(url)) continue;
    next.push(url);
    seen.add(url);
  }
  const serialized = next.join("\n");
  if (serialized.length > MAX_SOURCE_URL_LENGTH)
    throw new Error("Danh sách đường dẫn đã vượt dung lượng cho phép.");
  return serialized;
}

export function removeReferenceLink(original, visibleIndex) {
  if (!Number.isSafeInteger(visibleIndex) || visibleIndex < 0)
    throw new Error("Không tìm thấy đường dẫn này.");
  const lines = referenceLines(original);
  let index = -1;
  const found = lines.findIndex((url) => {
    if (!safeReferenceUrl(url)) return false;
    index++;
    return index === visibleIndex;
  });
  if (found < 0) throw new Error("Không tìm thấy đường dẫn này.");
  lines.splice(found, 1);
  return lines.join("\n");
}
