import { validateMission, videoId, validatePlan } from "../shared/search.js";
import { ResearchError, validateSettings } from "./validation.js";
import { planSearch } from "./search-ai.js";
export async function startMissionJob(repo, personal, input) {
  if (!["research", "plan"].includes(input.kind || "research"))
    throw new ResearchError("JOB_INPUT", "Loại nhiệm vụ không hợp lệ.");
  const mission = validateMission(input.mission);
  await personal.ensureSearchReady?.();
  const raw = (await repo.settings()) || {
    published_after: new Date(Date.now() - 30 * 86400000)
      .toISOString()
      .slice(0, 10),
    published_before: new Date().toISOString().slice(0, 10),
    result_limit: 10,
  };
  const active = (await personal.channels()).filter(
    (c) => c.enabled && !c.duplicate_of,
  );
  const settings = validateSettings({
    ...raw,
    mode: { channels: "channels", youtube: "keywords", combined: "combined" }[
      mission.source
    ],
    channels: active.map((c) => ({ url: c.url })),
    keywords: mission.keywords.length ? mission.keywords : ["AI planning"],
  });
  const tasks = [{ type: "plan" }];
  if (input.kind !== "plan") {
    if (mission.source !== "youtube")
      for (const c of active.filter(
        (c) =>
          !c.last_checked_at ||
          Date.now() - Date.parse(c.last_checked_at) > 86400000,
      ))
        tasks.push({
          type: "channel",
          row_id: c.id,
          pages: 0,
          page_token: null,
          watermark: c.last_video_at,
        });
    tasks.push({ type: "evaluate" });
  }
  return personal.start(
    { ...settings, mission, kind: input.kind || "research", query: "" },
    tasks,
  );
}
export async function planStep(job, personal, youtube, config) {
  const mission = validateMission(job.settings.mission);
  if (mission.method !== "keywords" && !config.key)
    throw new ResearchError(
      "AI_NOT_CONFIGURED",
      "Tìm kiếm thông minh đang tạm thời không hoạt động: AI chưa cấu hình.",
      503,
    );
  let plan = mission.plan;
  if (!plan && mission.method === "keywords")
    plan = validatePlan({
      intent: {
        audience: "",
        problem: mission.keywords.join(", "),
        outcome: "",
        direct_topics: mission.keywords.join(", "),
        related_topics: "",
        selection: mission.additional,
        exclusions: "",
      },
      groups: mission.keywords.map((query) => ({
        topic: query,
        query,
        language: "vi",
        reason: "Từ khóa do người dùng nhập; chưa phân tích ngữ nghĩa.",
        relevance: 1,
      })),
    });
  if (!plan) {
    if (!config.key)
      throw new ResearchError(
        "AI_NOT_CONFIGURED",
        "Tìm kiếm thông minh đang tạm thời không hoạt động: chưa cấu hình OpenAI trên máy chủ.",
        503,
      );
    await personal.reserveAI(job.id, "plan");
    if (mission.examples.length && !youtube.key)
      throw new ResearchError(
        "YOUTUBE_NOT_CONFIGURED",
        "Cần YouTube API để đọc video mẫu.",
        503,
      );
    const examples = mission.examples.length
      ? await youtube.details(mission.examples.map(videoId))
      : [];
    if (examples.length !== mission.examples.length)
      throw new ResearchError(
        "EXAMPLE_UNAVAILABLE",
        "Không đọc được một hoặc nhiều video mẫu (riêng tư, đã xóa hoặc không có số liệu).",
        400,
      );
    plan = await planSearch(mission, examples, config);
  }
  const remaining = job.tasks.slice(job.cursor + 1);
  if (job.settings.kind !== "plan" && mission.source !== "channels")
    remaining.splice(
      Math.max(0, remaining.length - 1),
      0,
      ...plan.groups
        .filter((g) => g.enabled)
        .map((g) => ({ type: "keyword", keyword: g.query })),
    );
  return personal.commit(job, {
    task: { search_plan: plan, remaining_tasks: remaining },
    units: youtube.units,
  });
}
