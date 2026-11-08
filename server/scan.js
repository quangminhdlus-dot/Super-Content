import { validateSettings, ResearchError } from "./validation.js";
import { YouTube, discover } from "./youtube.js";
import { scoreVideo, scoringContext } from "./scoring.js";
import { enrichEligible } from "./ai.js";
export async function runScan(
  repo,
  config,
  {
    fetcher = fetch,
    signal = AbortSignal.timeout(90000),
    now = Date.now(),
  } = {},
) {
  if (!config.youtubeKey)
    throw new ResearchError(
      "YOUTUBE_NOT_CONFIGURED",
      "Máy chủ chưa cấu hình YouTube API key.",
      503,
    );
  const raw = await repo.settings();
  const settings = validateSettings(raw, new Date(now));
  const id = await repo.begin(settings);
  const youtube = new YouTube(config.youtubeKey, { fetcher, signal });
  try {
    const history = await repo.history();
    const { videos, warnings } = await discover(youtube, settings);
    const context = scoringContext(videos, history, now);
    for (const v of videos)
      v.analysis = scoreVideo(
        v,
        videos,
        history,
        settings.keywords,
        now,
        context,
      );
    const proposals = videos
      .filter((v) => v.candidate)
      .sort(
        (a, b) =>
          Number(b.analysis.eligible) - Number(a.analysis.eligible) ||
          b.analysis.score - a.analysis.score ||
          b.views - a.views,
      )
      .slice(0, settings.result_limit);
    const chosen = new Set(proposals.map((v) => v.youtube_id));
    for (const v of videos) v.proposed = chosen.has(v.youtube_id);
    warnings.push(
      ...(await enrichEligible(proposals, {
        key: config.openaiKey,
        model: config.openaiModel,
        fetcher,
        signal,
      })),
    );
    if (signal.aborted)
      throw new ResearchError(
        "SCAN_TIMEOUT",
        "Lần quét quá thời gian; thử với ít nguồn hơn.",
        504,
      );
    await repo.persist(videos, id, new Date(now).toISOString());
    await repo.finish(id, {
      status: "succeeded",
      found_count: videos.filter((v) => v.candidate).length,
      proposed_count: proposals.length,
      api_units: youtube.units,
      warnings,
    });
    return {
      run_id: id,
      found: videos.filter((v) => v.candidate).length,
      proposed: proposals.length,
      warnings,
    };
  } catch (error) {
    const safe =
      error instanceof ResearchError
        ? error
        : new ResearchError(
            "SCAN_FAILED",
            "Quét không hoàn tất. Kết quả đã lưu trước đó vẫn được giữ.",
            502,
          );
    try {
      await repo.finish(id, {
        status: "failed",
        error_code: safe.code,
        error_message: safe.message,
        api_units: youtube.units,
      });
    } catch {
      console.error(
        JSON.stringify({
          event: "research_log_failed",
          run_id: id,
          code: "DATABASE",
        }),
      );
    }
    console.error(
      JSON.stringify({
        event: "research_scan_failed",
        run_id: id,
        code: safe.code,
      }),
    );
    throw safe;
  }
}
