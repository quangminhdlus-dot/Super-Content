import { ResearchError } from "./validation.js";
const ROOT = "https://www.googleapis.com/youtube/v3/";
export function durationSeconds(iso = "") {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m
    ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
    : null;
}
export class YouTube {
  constructor(key, { fetcher = fetch, signal, budget = 650 } = {}) {
    this.key = key;
    this.fetcher = fetcher;
    this.signal = signal;
    this.units = 0;
    this.budget = Math.min(650, Math.max(0, budget));
  }
  async get(resource, params) {
    const cost = resource === "search" ? 100 : 1;
    if (this.units + cost > this.budget)
      throw new ResearchError(
        "QUOTA_BUDGET",
        "Đã chạm ngân sách API mỗi lần quét.",
        429,
      );
    this.units += cost;
    const url = new URL(resource, ROOT);
    Object.entries({ ...params, key: this.key }).forEach(([k, v]) =>
      url.searchParams.set(k, v),
    );
    let response;
    try {
      response = await this.fetcher(url, {
        signal: this.signal
          ? AbortSignal.any([this.signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
    } catch {
      throw new ResearchError(
        "YOUTUBE_NETWORK",
        "Không kết nối được YouTube API. Thử lại sau.",
        502,
      );
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const reason = body.error?.errors?.[0]?.reason;
      throw new ResearchError(
        reason === "quotaExceeded" ? "YOUTUBE_QUOTA" : "YOUTUBE_API",
        reason === "quotaExceeded"
          ? "YouTube API đã hết hạn mức. Chờ hạn mức được cấp lại."
          : "YouTube API từ chối yêu cầu. Kiểm tra khóa, quyền API và giới hạn IP phía máy chủ.",
        502,
      );
    }
    return response.json();
  }
  async resolve(channel) {
    const result = await this.get("channels", {
      part: "snippet,contentDetails",
      ...(channel.id
        ? { id: channel.id }
        : channel.handle
          ? { forHandle: channel.handle }
          : { forUsername: channel.username }),
    });
    const c = result.items?.[0];
    if (!c?.contentDetails?.relatedPlaylists?.uploads)
      throw new ResearchError(
        "CHANNEL_NOT_FOUND",
        "Không tìm thấy kênh hoặc danh sách tải lên. Kiểm tra đường dẫn kênh.",
      );
    return {
      ...channel,
      id: c.id,
      title: c.snippet.title,
      uploads: c.contentDetails.relatedPlaylists.uploads,
    };
  }
  async uploads(channel, pages = 2) {
    const result = [];
    let pageToken = "";
    for (let page = 0; page < pages; page++) {
      const body = await this.get("playlistItems", {
        part: "contentDetails",
        playlistId: channel.uploads,
        maxResults: 50,
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of body.items || [])
        if (item.contentDetails?.videoId)
          result.push(item.contentDetails.videoId);
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return result;
  }
  async search(keyword, settings) {
    const body = await this.get("search", {
      part: "snippet",
      type: "video",
      q: keyword,
      maxResults: 50,
      order: "date",
      publishedAfter: `${settings.published_after}T00:00:00Z`,
      publishedBefore: `${settings.published_before}T23:59:59Z`,
    });
    return (body.items || []).map((x) => x.id?.videoId).filter(Boolean);
  }
  async details(ids) {
    const result = [];
    for (let i = 0; i < ids.length; i += 50) {
      const body = await this.get("videos", {
        part: "snippet,contentDetails,statistics",
        id: ids.slice(i, i + 50).join(","),
      });
      for (const v of body.items || []) {
        const s = v.snippet,
          stats = v.statistics || {};
        if (!s || !stats.viewCount || !s.publishedAt) continue;
        const number = (k) =>
          stats[k] === undefined ? null : Number(stats[k]);
        result.push({
          youtube_id: v.id,
          title: s.title,
          description: s.description?.slice(0, 1500) || "",
          channel_id: s.channelId,
          category_id: s.categoryId || null,
          channel: s.channelTitle,
          published_at: s.publishedAt,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
          duration_seconds: durationSeconds(v.contentDetails?.duration),
          views: number("viewCount"),
          likes: number("likeCount"),
          comments: number("commentCount"),
        });
      }
    }
    return result;
  }
}
// Channel discovery uses uploads playlists; search is only used for configured keywords.
export async function discover(youtube, settings) {
  const sources = new Map(),
    allIds = new Set(),
    resolved = [];
  const add = (id, source) => {
    allIds.add(id);
    sources.set(id, [...new Set([...(sources.get(id) || []), source])]);
  };
  if (settings.mode !== "keywords")
    for (const input of settings.channels) {
      const channel = await youtube.resolve(input);
      resolved.push(channel);
      for (const id of await youtube.uploads(channel, 3))
        add(id, `Kênh: ${channel.title}`);
    }
  if (settings.mode !== "channels")
    for (const keyword of settings.keywords)
      for (const id of await youtube.search(keyword, settings))
        add(id, `Từ khóa: ${keyword}`);
  const candidates = await youtube.details([...allIds]);
  const channels = new Set(resolved.map((c) => c.id));
  let comparisons = 0;
  const warnings = [];
  // Bounded channel baselines for keyword discoveries, never a search per channel.
  for (const id of [...new Set(candidates.map((v) => v.channel_id))]) {
    if (channels.has(id)) continue;
    if (comparisons >= 10) {
      warnings.push(
        "Chỉ lấy mẫu đối chiếu cho tối đa 10 kênh ngoài danh sách theo dõi.",
      );
      break;
    }
    const c = await youtube.resolve({ id });
    channels.add(id);
    comparisons++;
    for (const videoId of await youtube.uploads(c, 2)) {
      if (allIds.size < 2000) allIds.add(videoId);
      else
        warnings.push(
          "Giới hạn tổng 2.000 video mẫu mỗi lượt; một số kênh có thể chưa đủ mẫu đối chiếu.",
        );
    }
  }
  const known = new Set(candidates.map((v) => v.youtube_id));
  const baseline = await youtube.details(
    [...allIds].filter((id) => !known.has(id)),
  );
  const start = Date.parse(`${settings.published_after}T00:00:00Z`),
    end = Date.parse(`${settings.published_before}T23:59:59.999Z`);
  const videos = [...candidates, ...baseline].map((v) => ({
    ...v,
    sources: sources.get(v.youtube_id) || [`Đối chiếu kênh: ${v.channel}`],
    candidate:
      sources.has(v.youtube_id) &&
      Date.parse(v.published_at) >= start &&
      Date.parse(v.published_at) <= end,
  }));
  warnings.push(
    "Mẫu hữu hạn: tối đa 150 video tải lên/kênh theo dõi, 50 kết quả/từ khóa và 100 video/kênh đối chiếu. Không bảo đảm bao phủ toàn bộ khoảng ngày.",
  );
  return { videos, resolved, warnings: [...new Set(warnings)] };
}
