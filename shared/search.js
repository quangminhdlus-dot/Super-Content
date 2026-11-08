import { ResearchError } from "../server/validation.js";
export const emptyMission = () => ({
  name: "",
  description: "",
  method: "description",
  source: "channels",
  keywords: [],
  examples: [],
  additional: "",
  plan: null,
  task_id: null,
});
export function videoId(value) {
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
        u.hostname,
      ) ||
      u.username ||
      u.password ||
      u.port
    )
      throw 0;
    const id =
      u.hostname === "youtu.be"
        ? u.pathname.slice(1)
        : u.pathname === "/watch"
          ? u.searchParams.get("v")
          : u.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})$/)?.[1];
    if (!/^[\w-]{11}$/.test(id || "")) throw 0;
    return id;
  } catch {
    throw new ResearchError(
      "VIDEO_URL",
      "Dùng đường dẫn HTTPS của video YouTube hợp lệ.",
    );
  }
}
export function validateMission(input, { draft = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ResearchError("MISSION", "Nhiệm vụ không hợp lệ.");
  const m = { ...emptyMission(), ...input };
  for (const [key, max] of [
    ["name", 120],
    ["description", 12000],
    ["additional", 2000],
  ])
    if (typeof m[key] !== "string" || m[key].length > max)
      throw new ResearchError(
        "MISSION",
        `Trường ${key} vượt giới hạn ${max} ký tự.`,
      );
  if (
    !["description", "keywords", "examples"].includes(m.method) ||
    !["channels", "youtube", "combined"].includes(m.source)
  )
    throw new ResearchError(
      "MISSION",
      "Chọn phương pháp và nguồn nghiên cứu hợp lệ.",
    );
  if (
    !Array.isArray(m.keywords) ||
    m.keywords.length > 5 ||
    m.keywords.some((k) => typeof k !== "string" || !k.trim() || k.length > 120)
  )
    throw new ResearchError(
      "MISSION",
      "Tối đa 5 từ khóa, mỗi từ khóa 1–120 ký tự.",
    );
  if (!Array.isArray(m.examples) || m.examples.length > 3)
    throw new ResearchError("MISSION", "Tối đa 3 video mẫu.");
  m.examples = [...new Set(m.examples.map(videoId))].map(
    (id) => `https://www.youtube.com/watch?v=${id}`,
  );
  m.keywords = [...new Set(m.keywords.map((k) => k.trim()))];
  if (
    !draft &&
    ((m.method === "description" && !m.description.trim()) ||
      (m.method === "keywords" && !m.keywords.length) ||
      (m.method === "examples" && !m.examples.length))
  )
    throw new ResearchError(
      "MISSION",
      "Nhập mô tả nhu cầu, từ khóa hoặc video mẫu theo phương pháp đã chọn.",
    );
  if (m.task_id !== null && !/^[0-9a-f-]{36}$/i.test(m.task_id))
    throw new ResearchError("MISSION", "Mã nhiệm vụ không hợp lệ.");
  return {
    name: m.name,
    description: m.description,
    additional: m.additional,
    method: m.method,
    source: m.source,
    keywords: m.keywords,
    examples: m.examples,
    task_id: m.task_id,
    plan: m.plan ? validatePlan(m.plan) : null,
  };
}
export function validatePlan(p) {
  const text = (s, max = 1500) => typeof s === "string" && s.length <= max;
  if (
    !p ||
    !Array.isArray(p.groups) ||
    p.groups.length < 1 ||
    p.groups.length > 5
  )
    throw new ResearchError(
      "AI_PLAN_FORMAT",
      "Chiến lược cần 1–5 hướng tìm kiếm.",
    );
  const intent = {};
  for (const key of [
    "audience",
    "problem",
    "outcome",
    "direct_topics",
    "related_topics",
    "selection",
    "exclusions",
  ]) {
    if (!text(p.intent?.[key]))
      throw new ResearchError(
        "AI_PLAN_FORMAT",
        "Phân tích ý định thiếu trường hoặc quá dài.",
      );
    intent[key] = p.intent[key];
  }
  const seen = new Set();
  const groups = p.groups.map((g) => {
    if (
      !text(g.topic, 200) ||
      !text(g.query, 120) ||
      !g.query.trim() ||
      !["vi", "en"].includes(g.language) ||
      !text(g.reason, 500) ||
      !Number.isFinite(g.relevance) ||
      g.relevance < 0 ||
      g.relevance > 1
    )
      throw new ResearchError("AI_PLAN_FORMAT", "Hướng tìm kiếm không hợp lệ.");
    const k = g.query.trim().toLowerCase();
    if (seen.has(k))
      throw new ResearchError("AI_PLAN_FORMAT", "Các truy vấn phải khác nhau.");
    seen.add(k);
    return {
      topic: g.topic,
      query: g.query.trim(),
      language: g.language,
      reason: g.reason,
      relevance: g.relevance,
      enabled: g.enabled !== false,
    };
  });
  if (!groups.some((g) => g.enabled))
    throw new ResearchError(
      "AI_PLAN_FORMAT",
      "Bật ít nhất một hướng nghiên cứu.",
    );
  return { intent, groups };
}
export function proposalOrder(a, b, order = "fit") {
  const x = a.analysis || {},
    y = b.analysis || {};
  if (order === "newest")
    return Date.parse(b.data.published_at) - Date.parse(a.data.published_at);
  if (order === "growth")
    return (
      Number(!!y.eligible) - Number(!!x.eligible) ||
      (y.growth_ratio || 0) - (x.growth_ratio || 0) ||
      (y.view_ratio || 0) - (x.view_ratio || 0)
    );
  if (order === "strategic")
    return (y.personal_fit ?? y.score ?? 0) - (x.personal_fit ?? x.score ?? 0);
  return (
    (y.score ?? y.need_fit ?? 0) - (x.score ?? x.need_fit ?? 0) ||
    (y.score || 0) - (x.score || 0)
  );
}
