import { ResearchError, validateSettings, parseChannel } from "./validation.js";
import { YouTube } from "./youtube.js";
import { scoreVideo, scoringContext } from "./scoring.js";
import {
  defaultCriteria,
  personalScore,
  normalizeText,
} from "../shared/personalization.js";
import { evaluatePersonalAI } from "./personal-ai.js";
export async function startResearchJob(repo, personal, input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ResearchError("JOB_INPUT", "Dữ liệu job không hợp lệ.");
  const { kind = "research", query = "" } = input;
  if (
    !["research", "refresh"].includes(kind) ||
    typeof query !== "string" ||
    query.length > 200
  )
    throw new ResearchError(
      "JOB_INPUT",
      "Loại nghiên cứu hoặc từ tìm kiếm không hợp lệ.",
    );
  const raw = (await repo.settings()) || {
      channels: [],
      keywords: [],
      mode: "channels",
      published_after: new Date(Date.now() - 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      published_before: new Date().toISOString().slice(0, 10),
      result_limit: 10,
    },
    channels = await personal.channels(),
    active = channels.filter((c) => c.enabled && !c.duplicate_of);
  const settings = validateSettings(
    {
      ...raw,
      channels: active.map((c) => ({ url: c.url })),
      mode: kind === "refresh" ? "channels" : raw?.mode,
    },
    new Date(),
  );
  // validateSettings receives a Date below; JSON query cannot select another account or destination.
  const tasks = [];
  if (kind === "refresh")
    for (const c of active)
      tasks.push({
        type: "channel",
        row_id: c.id,
        pages: 0,
        page_token: null,
        watermark: c.last_video_at,
      });
  if (kind === "research" && settings.mode !== "channels")
    for (const keyword of settings.keywords)
      tasks.push({ type: "keyword", keyword });
  tasks.push({ type: "evaluate" });
  return personal.start({ ...settings, kind, query }, tasks);
}
export async function stepResearchJob(
  repo,
  personal,
  id,
  config,
  {
    fetcher = fetch,
    signal = AbortSignal.timeout(85000),
    now = Date.now(),
  } = {},
) {
  const job = await personal.claim(id);
  if (["completed", "cancelled"].includes(job.status)) return job;
  const task = job.tasks[job.cursor],
    youtube = new YouTube(config.youtubeKey, {
      fetcher,
      signal,
      budget: 2500 - job.api_units,
    });
  try {
    if (task.type !== "evaluate" && job.api_units >= 2500)
      throw new ResearchError(
        "JOB_QUOTA",
        "Tiến trình đã đạt 2.500 đơn vị API. Hủy và giảm số nguồn trước khi tạo lượt mới.",
        429,
      );
    if (task.type === "channel") {
      if (!config.youtubeKey)
        throw new ResearchError(
          "YOUTUBE_NOT_CONFIGURED",
          "Chưa cấu hình khóa YouTube phía máy chủ.",
          503,
        );
      const row = await personal.channel(task.row_id);
      if (!row || !row.enabled || row.duplicate_of)
        return personal.commit(job, {});
      const resolved =
        row.youtube_channel_id && row.uploads
          ? {
              id: row.youtube_channel_id,
              title: row.title,
              uploads: row.uploads,
            }
          : await youtube.resolve(parseChannel(row.url));
      const channels = await personal.channels();
      if (
        channels.some(
          (c) =>
            c.id !== row.id &&
            !c.duplicate_of &&
            c.youtube_channel_id === resolved.id,
        )
      )
        return personal.commit(job, {
          channel: { ...resolved, row_id: row.id },
          units: youtube.units,
        });
      const page = await youtube.get("playlistItems", {
        part: "contentDetails",
        playlistId: resolved.uploads,
        maxResults: 50,
        ...(task.page_token ? { pageToken: task.page_token } : {}),
      });
      const pageIds = (page.items || [])
        .map((i) => i.contentDetails?.videoId)
        .filter(Boolean);
      // Watermarks bound discovery, but must not freeze statistics of older
      // uploads. Refresh the retained sample on the first page of each run.
      const cachedIds =
        task.pages === 0
          ? (await personal.channelVideoIds?.(resolved.id)) || []
          : [];
      const ids = [...new Set([...pageIds, ...cachedIds])].slice(0, 150);
      const items = await youtube.details(ids);
      const latest =
        [task.latest, row.last_video_at, ...items.map((v) => v.published_at)]
          .filter(Boolean)
          .sort((a, b) => Date.parse(a) - Date.parse(b))
          .at(-1) || null;
      const reached =
        !!task.watermark &&
        items
          .filter((v) => pageIds.includes(v.youtube_id))
          .some(
            (v) => Date.parse(v.published_at) <= Date.parse(task.watermark),
          );
      const next = {
        ...task,
        pages: task.pages + 1,
        page_token: page.nextPageToken || null,
        latest,
      };
      const done = !page.nextPageToken || reached || next.pages >= 3;
      return personal.commit(job, {
        items: items.map((v) => ({
          ...v,
          sources: [`Kênh: ${resolved.title}`],
          analysis: {},
          proposed: false,
        })),
        task: next,
        done,
        units: youtube.units,
        channel: {
          ...resolved,
          row_id: row.id,
          latest: done ? latest : row.last_video_at,
        },
      });
    }
    if (task.type === "keyword") {
      if (!config.youtubeKey)
        throw new ResearchError(
          "YOUTUBE_NOT_CONFIGURED",
          "Chưa cấu hình khóa YouTube phía máy chủ.",
          503,
        );
      const ids = await youtube.search(task.keyword, job.settings),
        videos = await youtube.details(ids);
      return personal.commit(job, {
        items: videos.map((v) => ({
          ...v,
          sources: [`Từ khóa: ${task.keyword}`],
          analysis: {},
          proposed: false,
        })),
        units: youtube.units,
      });
    }
    if (task.type !== "evaluate")
      throw new ResearchError("JOB_TASK", "Loại lô không hợp lệ.");
    const [cache, history, memories, profile, channels] = await Promise.all([
      personal.cache(),
      repo.history(),
      personal.memories(),
      personal.profile(job.criteria_version),
      personal.channels(),
    ]);
    const criteria = profile || { id: null, content: defaultCriteria() },
      pool = cache.map((r) => ({
        ...r.data,
        sources: r.sources,
        collected_at: r.collected_at,
      })),
      context = scoringContext(pool, history, now),
      followed = new Set(
        channels
          .filter((c) => c.enabled && !c.duplicate_of)
          .map((c) => c.youtube_channel_id),
      );
    const queryTokens =
        normalizeText(job.settings.query).match(/[\p{L}\p{N}]+/gu) || [],
      keywordSources = new Set(
        job.settings.keywords.map((k) => `Từ khóa: ${k}`),
      ),
      after = job.settings.published_after + "T00:00:00Z",
      before = job.settings.published_before + "T23:59:59.999Z";
    const candidates = pool.filter(
      (v) =>
        Date.parse(v.published_at) >= Date.parse(after) &&
        Date.parse(v.published_at) <= Date.parse(before) &&
        ((job.settings.mode !== "keywords" && followed.has(v.channel_id)) ||
          (job.settings.mode !== "channels" &&
            v.sources.some((s) => keywordSources.has(s)))) &&
        queryTokens.every((t) =>
          normalizeText(`${v.title} ${v.description}`).includes(t),
        ),
    );
    for (const v of candidates) {
      let base = scoreVideo(
        v,
        pool,
        history,
        job.settings.keywords,
        now,
        context,
      );
      if (now - Date.parse(v.collected_at) > 86400000)
        base = {
          ...base,
          eligible: false,
          view_ratio: null,
          growth_ratio: null,
          confidence: "low",
          reasons: [
            ...base.reasons,
            "Số liệu đã cũ hơn 24 giờ; cập nhật kênh trước khi kết luận cơ hội tăng trưởng hiện tại.",
          ],
        };
      v.analysis = {
        ...personalScore(v, base, criteria.content, memories),
        criteria_version: criteria.id,
        statistics_as_of: v.collected_at,
      };
    }
    candidates.sort((a, b) => b.analysis.score - a.analysis.score);
    const warnings = await evaluatePersonalAI(
      candidates.slice(0, 12),
      criteria,
      memories,
      { key: config.openaiKey, model: config.openaiModel, fetcher, signal },
    );
    candidates.sort((a, b) => b.analysis.score - a.analysis.score);
    const chosen = new Set(
      candidates.slice(0, job.settings.result_limit).map((v) => v.youtube_id),
    );
    // Preserve original collection time and avoid creating a fabricated fresh statistics snapshot on a cache-only search.
    const evaluationItems = candidates.map((v) => ({
      ...v,
      analysis: { ...v.analysis, evaluation_warnings: warnings },
      proposed: chosen.has(v.youtube_id),
      cache_evaluation: true,
    }));
    return personal.commit(job, { items: evaluationItems });
  } catch (error) {
    const safe =
      error instanceof ResearchError
        ? error
        : new ResearchError(
            "JOB_FAILED",
            "Lô xử lý chưa hoàn tất. Tiến độ trước đó vẫn được giữ.",
            502,
          );
    await personal
      .commit(job, {
        error: `${safe.code}: ${safe.message}`,
        units: youtube.units,
      })
      .catch(() => {});
    console.warn(
      JSON.stringify({
        event: "personal_step_failed",
        job_id: id,
        code: safe.code,
      }),
    );
    throw safe;
  }
}
