export class ResearchError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function parseChannel(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ResearchError("CHANNEL_URL", "Đường dẫn kênh không hợp lệ.");
  }
  if (
    url.protocol !== "https:" ||
    !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
      url.hostname,
    ) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new ResearchError(
      "CHANNEL_URL",
      "Chỉ nhận đường dẫn kênh HTTPS của YouTube.",
    );
  const path = decodeURIComponent(url.pathname)
    .replace(/\/+$/, "")
    .replace(/\/(videos|shorts|streams|featured|about)$/, "");
  if (/^\/channel\/UC[\w-]{22}$/.test(path))
    return { url: `https://www.youtube.com${path}`, id: path.slice(9) };
  if (/^\/@[^/\s]{1,100}$/.test(path))
    return { url: `https://www.youtube.com${path}`, handle: path.slice(1) };
  if (/^\/user\/[\w.-]{1,100}$/.test(path))
    return { url: `https://www.youtube.com${path}`, username: path.slice(6) };
  throw new ResearchError(
    "CHANNEL_URL",
    "Dùng đường dẫn /@tenkenh, /channel/UC… hoặc /user/tenkenh. Với /c/, hãy mở kênh và sao chép đường dẫn @ mới.",
  );
}
export function validateSettings(raw, now = new Date()) {
  if (!raw || !Array.isArray(raw.channels) || !Array.isArray(raw.keywords))
    throw new ResearchError("SETTINGS", "Cấu hình nghiên cứu không hợp lệ.");
  if (raw.channels.length > 10 || raw.keywords.length > 5)
    throw new ResearchError(
      "LIMIT",
      "Tối đa 10 kênh và 5 từ khóa mỗi lần quét.",
    );
  const channels = [
    ...new Map(
      raw.channels.map((c) => {
        const p = parseChannel(typeof c === "string" ? c : c.url);
        return [p.url, p];
      }),
    ).values(),
  ];
  const keywords = [
    ...new Set(raw.keywords.map((k) => String(k).trim()).filter(Boolean)),
  ];
  if (keywords.some((k) => k.length > 120))
    throw new ResearchError("KEYWORD", "Từ khóa tối đa 120 ký tự.");
  if (!["channels", "keywords", "combined"].includes(raw.mode))
    throw new ResearchError("MODE", "Chọn nguồn nghiên cứu.");
  if (raw.mode !== "keywords" && !channels.length)
    throw new ResearchError("CHANNELS", "Thêm ít nhất một kênh.");
  if (raw.mode !== "channels" && !keywords.length)
    throw new ResearchError("KEYWORDS", "Thêm ít nhất một từ khóa.");
  const start = new Date(`${raw.published_after}T00:00:00.000Z`),
    end = new Date(`${raw.published_before}T23:59:59.999Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(raw.published_after || "") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(raw.published_before || "") ||
    !Number.isFinite(+start) ||
    !Number.isFinite(+end) ||
    start.toISOString().slice(0, 10) !== raw.published_after ||
    end.toISOString().slice(0, 10) !== raw.published_before ||
    start > end ||
    end - start > 366 * 86400000 ||
    start > now
  )
    throw new ResearchError(
      "DATES",
      "Chọn khoảng ngày hợp lệ, tối đa 366 ngày.",
    );
  const result_limit = Number(raw.result_limit);
  if (!Number.isInteger(result_limit) || result_limit < 1 || result_limit > 50)
    throw new ResearchError("RESULT_LIMIT", "Số đề xuất từ 1 đến 50.");
  return {
    channels,
    keywords,
    mode: raw.mode,
    published_after: raw.published_after,
    published_before: raw.published_before,
    result_limit,
  };
}
