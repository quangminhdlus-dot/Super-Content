import { parseChannel } from "../server/validation.js";
export const FIELDS = {
  positioning: "Định vị kênh",
  audience: "Khán giả mục tiêu",
  topics: "Chủ đề muốn phát triển",
  worthwhile: "Điều kiện đáng làm",
  avoid: "Nội dung không muốn",
  examples: "Video mẫu tốt/không tốt và lý do",
};
export const WEIGHTS = {
  growth: "Tăng trưởng",
  engagement: "Tương tác",
  relevance: "Phù hợp",
  novelty: "Tính mới",
  potential: "Tiềm năng khai thác",
};
export const defaultCriteria = () => ({
  positioning: "",
  audience: "",
  topics: "",
  worthwhile: "",
  avoid: "",
  examples: "",
  weights: {
    growth: 20,
    engagement: 10,
    relevance: 40,
    novelty: 15,
    potential: 15,
  },
});
export function validateCriteria(input) {
  const result = {};
  for (const key of Object.keys(FIELDS)) {
    if (typeof input[key] !== "string" || input[key].length > 12000)
      throw new Error("Mỗi phần tiêu chuẩn tối đa 12.000 ký tự.");
    result[key] = input[key];
  }
  result.weights = {};
  for (const key of Object.keys(WEIGHTS)) {
    const v = Number(input.weights?.[key]);
    if (!Number.isFinite(v) || v < 0 || v > 100)
      throw new Error("Trọng số từ 0 đến 100.");
    result.weights[key] = v;
  }
  if (!Object.values(result.weights).some((v) => v > 0))
    throw new Error("Ít nhất một trọng số phải lớn hơn 0.");
  return result;
}
export function channelKey(channel) {
  const p = parseChannel(channel.url);
  return (
    channel.youtube_channel_id ||
    p.id ||
    p.url.toLocaleLowerCase("vi").normalize("NFC")
  );
}
export function importChannels(text, existing = [], group = "") {
  // A resolved handle must remain recognizable by both its URL and channel ID.
  const keys = (channel) => [
    channelKey(channel),
    channelKey({ url: channel.url }),
  ];
  const seen = new Set(existing.flatMap(keys)),
    added = [],
    duplicates = [],
    invalid = [];
  for (const line of text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      const p = parseChannel(line),
        aliases = keys(p);
      if (aliases.some((key) => seen.has(key))) {
        duplicates.push(line);
        continue;
      }
      if (existing.length + added.length >= 500)
        throw new Error("Tối đa 500 kênh.");
      aliases.forEach((key) => seen.add(key));
      added.push({
        ...p,
        canonical_url: p.url,
        topic_group: group.slice(0, 100),
        enabled: true,
        title: "",
        youtube_channel_id: p.id || null,
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      invalid.push({ url: line, error: error.message });
    }
  }
  return { added, duplicates, invalid };
}
const stop = new Set(
  "va cua cho voi nhung mot cac la de toi ban nay khong duoc co ve trong theo tu cung den hay thi khi video noi dung".split(
    " ",
  ),
);
export function tokens(text) {
  return [...new Set(normalizeText(text).match(/[a-z0-9]{3,}/g) || [])].filter(
    (x) => !stop.has(x),
  );
}
export function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}
export function similarity(a, b) {
  const aa = tokens(a),
    bb = new Set(tokens(b));
  return aa.length
    ? aa.filter((t) => bb.has(t)).length /
        Math.sqrt(aa.length * Math.max(bb.size, 1))
    : 0;
}
export function retrieveMemories(video, memories) {
  const text = `${video.title} ${video.description || ""}`;
  return memories
    .filter((m) => m.confirmed === true)
    .map((m) => ({
      ...m,
      similarity: similarity(text, `${m.video_title || ""} ${m.text}`),
    }))
    .filter((m) => m.similarity > 0)
    .sort(
      (a, b) =>
        b.similarity - a.similarity ||
        String(b.updated_at).localeCompare(String(a.updated_at)),
    )
    .slice(0, 6);
}
export function personalScore(
  video,
  base,
  criteria = defaultCriteria(),
  memories = [],
) {
  const text = `${video.title} ${video.description || ""}`,
    examples = retrieveMemories(video, memories),
    positive = [
      criteria.positioning,
      criteria.audience,
      criteria.topics,
      criteria.worthwhile,
    ].join(" "),
    fit = similarity(text, positive),
    avoid = similarity(text, criteria.avoid);
  const adjustment = Math.max(
    -0.15,
    Math.min(
      0.15,
      examples.reduce(
        (s, m) =>
          s + (m.preference === "negative" ? -1 : 1) * m.similarity * 0.08,
        0,
      ),
    ),
  );
  const components = {
    growth: Math.min(
      1,
      Math.max((base.view_ratio || 0) / 4, (base.growth_ratio || 0) / 3),
    ),
    engagement: Math.min(
      1,
      (((video.likes || 0) + (video.comments || 0) * 2) /
        Math.max(video.views, 1)) *
        10,
    ),
    relevance: Math.max(0, Math.min(1, fit * 2 - avoid * 2 + adjustment)),
    novelty: !examples.length
      ? 0.5
      : 1 -
        Math.max(
          0,
          ...examples
            .filter((m) => m.preference === "positive")
            .map((m) => m.similarity),
        ),
    potential: Math.max(0, Math.min(1, 0.25 + fit - avoid)),
  };
  const total = Object.values(criteria.weights).reduce((a, b) => a + b, 0) || 1;
  const score = Math.round(
    (Object.entries(components).reduce(
      (sum, [k, v]) => sum + v * criteria.weights[k],
      0,
    ) /
      total) *
      100,
  );
  return {
    ...base,
    score,
    components,
    group: base.eligible ? "growth" : "strategic",
    ranking_engine: "rules",
    used_memory_ids: examples.map((m) => m.id),
    personal_reasons: [
      `Phù hợp từ vựng với tiêu chuẩn: ${Math.round(fit * 100)}%; nội dung tránh: ${Math.round(avoid * 100)}%.`,
      ...examples.map(
        (m) =>
          `Ghi nhớ đã xác nhận: ${m.preference === "negative" ? "thường loại" : "ưu tiên"} “${m.video_title || m.text}” — ${m.text}`,
      ),
    ],
    data_access: [
      "Tiêu đề YouTube",
      "Mô tả công khai (rút gọn)",
      "Thống kê API",
    ],
    note:
      base.note +
      " Chưa đọc video, transcript hoặc nội dung bình luận. Đánh giá theo quy tắc nếu chưa có AI.",
  };
}
export function applyAI(personal, ai, weights) {
  const components = { ...personal.components };
  for (const key of ["relevance", "novelty", "potential"]) {
    if (typeof ai[key] !== "number" || ai[key] < 0 || ai[key] > 1)
      throw new Error("AI_SCORE_FORMAT");
    components[key] = ai[key];
  }
  if (typeof ai.explanation !== "string" || typeof ai.angle !== "string")
    throw new Error("AI_TEXT_FORMAT");
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  return {
    ...personal,
    components,
    score: Math.round(
      (Object.entries(components).reduce((s, [k, v]) => s + v * weights[k], 0) /
        total) *
        100,
    ),
    ranking_engine: "ai",
    personal_reasons: [
      ...personal.personal_reasons,
      ai.explanation.slice(0, 2000),
    ],
    angle: ai.angle.slice(0, 2000),
    angle_source: "ai",
  };
}
