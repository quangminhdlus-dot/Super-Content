import { YouTube } from "./youtube.js";
import { durationBucket } from "./scoring.js";

const DAY = 86400000;
const CACHE_MS = 6 * 3600000;
const ERROR_CACHE_MS = 20 * 60000;
const MAX_CACHE = 150;
const MEDIAN = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const i = Math.floor((sorted.length - 1) / 2);
  const j = Math.ceil((sorted.length - 1) / 2);
  return (sorted[i] + sorted[j]) / 2;
};
function ageDays(date, now) {
  const age = (now - Date.parse(date)) / DAY;
  return Number.isFinite(age) ? Math.max(1, age) : null;
}
function viewRate(video, now) {
  const age = ageDays(video.published_at, now);
  return age ? video.views / age : null;
}
export function normalizeTitleQuery(value) {
  const query = String(value || "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  const words = query.split(" ").filter(Boolean);
  return words.length >= 2 && words.length <= 10 ? query : null;
}
export function benchmarkTitleVideos(candidates, comparison, now = Date.now()) {
  const poolByChannel = new Map();
  for (const peer of comparison) {
    const list = poolByChannel.get(peer.channel_id) || [];
    list.push(peer);
    poolByChannel.set(peer.channel_id, list);
  }
  return candidates.map((candidate) => {
    const age = ageDays(candidate.published_at, now);
    const rate = viewRate(candidate, now);
    const format = durationBucket(candidate.duration_seconds);
    const peers = (poolByChannel.get(candidate.channel_id) || [])
      .filter((p) => {
        const peerAge = ageDays(p.published_at, now);
        return p.youtube_id !== candidate.youtube_id &&
          peerAge && age && peerAge / age >= 0.5 && peerAge / age <= 2 &&
          format !== "unknown" && durationBucket(p.duration_seconds) === format &&
          Number.isFinite(p.views) && p.views >= 0;
      });
    const median = MEDIAN(peers.map((p) => viewRate(p, now)).filter((v) => v > 0));
    const ratio = peers.length >= 5 && median > 0 && rate != null
      ? Math.round((rate / median) * 10) / 10
      : null;
    return {
      id: candidate.youtube_id,
      title: candidate.title,
      channel: candidate.channel,
      publishedAt: candidate.published_at,
      url: candidate.url,
      views: candidate.views,
      ageDays: Math.round(age || 0),
      viewRateProxy: Math.round(rate || 0),
      peerCount: peers.length,
      relativeViewRate: ratio,
      isOutlier: ratio !== null && ratio >= 2,
      period: age <= 183 ? "6m" : "12m",
    };
  });
}
export function createTitleResearch({
  youtubeKey,
  fetcher = fetch,
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  let spentToday = 0, spendingDate = "";
  const MAX_DAILY_UNITS = 2600;
  async function study(query, signal) {
    const cleaned = normalizeTitleQuery(query);
    const today = new Date(now()).toISOString().slice(0, 10);
    if (!cleaned) return { status: "unavailable", reason: "query", examples: [], sampledVideos: 0 };
    if (!youtubeKey) return { status: "unavailable", reason: "no_key", examples: [], sampledVideos: 0 };
    const key = cleaned.toLocaleLowerCase("en");
    const item = cache.get(key);
    if (item && item.until > now()) return item.promise;
    if (today !== spendingDate) { spendingDate = today; spentToday = 0; }
    if (spentToday + 140 > MAX_DAILY_UNITS)
      return { status: "unavailable", reason: "daily_budget", examples: [], sampledVideos: 0 };
    spentToday += 140; // Pre-reserve upper bound before concurrent requests.
    const promise = (async () => {
      const youtube = new YouTube(youtubeKey, { fetcher, signal, budget: 150 });
      const cutoff = new Date(now() - 365 * DAY).toISOString();
      const result = await youtube.get("search", {
        part: "snippet",
        type: "video",
        q: cleaned,
        maxResults: 50,
        order: "relevance",
        publishedAfter: cutoff,
        relevanceLanguage: "en",
        safeSearch: "moderate",
      });
      const ids = (result.items || []).map((item) => item.id?.videoId).filter(Boolean);
      const all = await youtube.details([...new Set(ids)]);
      const recent = all.filter((video) => {
        const age = ageDays(video.published_at, now());
        return age && age <= 365 && age >= 2 &&
          video.duration_seconds >= 180 && video.duration_seconds <= 7200 &&
          video.views >= 5000;
      });
      if (!recent.length)
        return { status: "unavailable", reason: "no_matches", query: cleaned, sampledVideos: 0, examples: [] };
      // One query per topic; prioritize relevance from YouTube search and normalize by age.
      // Avoid treating channel size / total views as evidence a title worked.
      const byRate = (a, b) => (viewRate(b, now()) || 0) - (viewRate(a, now()) || 0);
      const lastSixMonths = recent.filter((v) => ageDays(v.published_at, now()) <= 183).sort(byRate);
      const olderSixMonths = recent.filter((v) => ageDays(v.published_at, now()) > 183).sort(byRate);
      // Prefer recent patterns, but retain 6-12-month evidence when available.
      const promising = [...lastSixMonths.slice(0, 6), ...olderSixMonths.slice(0, 2)]
        .slice(0, 8);
      const uniqueChannels = [...new Set(promising.map((v) => v.channel_id))].slice(0, 8);
      const channels = await youtube.get("channels", {
        part: "contentDetails", id: uniqueChannels.join(","), maxResults: 50,
      });
      const uploads = new Map((channels.items || []).map((ch) =>
        [ch.id, ch.contentDetails?.relatedPlaylists?.uploads]).filter(([, id]) => id));
      const peerIds = new Set();
      // Each upload playlist request costs 1 unit. Failed comparisons remain unverified.
      const results = await Promise.allSettled(uniqueChannels.map(async (id) => {
        const playlistId = uploads.get(id);
        if (!playlistId) return [];
        const page = await youtube.get("playlistItems", {
          part: "contentDetails", playlistId, maxResults: 50,
        });
        return (page.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
      }));
      for (const result of results)
        if (result.status === "fulfilled")
          for (const id of result.value) peerIds.add(id);
      const peerDetails = peerIds.size ? await youtube.details([...peerIds]) : [];
      const scored = benchmarkTitleVideos(promising, peerDetails, now());
      const best = scored.sort((a, b) =>
        Number(b.isOutlier) - Number(a.isOutlier) ||
        (b.relativeViewRate || 0) - (a.relativeViewRate || 0) ||
        b.viewRateProxy - a.viewRateProxy);
      const verified = best.filter((v) => v.isOutlier);
      const examples = (verified.length ? verified : best).slice(0, 6);
      return {
        status: verified.length ? "verified" : "sampled",
        reason: verified.length ? "channel_benchmark" : "insufficient_peers",
        query: cleaned,
        sampledVideos: recent.length,
        matchedChannels: uniqueChannels.length,
        verifiedOutliers: verified.length,
        asOf: new Date(now()).toISOString(),
        windowMonths: 12,
        examples,
        disclaimer: "Lượt xem/tốc độ trung bình từ khi đăng là chỉ số đại diện, không phải CTR hoặc tốc độ tăng trưởng đo theo thời gian. Nội dung, ảnh bìa, quy mô kênh và thời điểm đăng cũng ảnh hưởng hiệu suất.",
      };
    })().catch((error) => ({
      status: "unavailable",
      reason: error?.code === "YOUTUBE_QUOTA" ? "quota" : "provider",
      query: cleaned,
      sampledVideos: 0,
      examples: [],
    }));
    // Deduplicate concurrent requests. Failure cache is short to allow recovery.
    cache.set(key, { until: now() + CACHE_MS, promise });
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    const value = await promise;
    if (value.status === "unavailable") cache.set(key, {
      until: now() + ERROR_CACHE_MS, promise: Promise.resolve(value),
    });
    return value;
  }
  return { study };
}
