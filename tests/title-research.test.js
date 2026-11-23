import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTitleResearch, benchmarkTitleVideos, normalizeTitleQuery,
} from "../server/title-research.js";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const dateAgo = (days) => new Date(NOW - days * 86400000).toISOString();
const video = (id, { views = 10000, age = 40, channel = "UC" + "a".repeat(22), duration = 600 } = {}) => ({
  youtube_id: id,
  title: "Sức mạnh của sự kiên trì",
  channel_id: channel,
  channel: "Example Channel",
  published_at: dateAgo(age),
  url: "https://www.youtube.com/watch?v=" + id,
  duration_seconds: duration,
  views,
});

test("rejects unsafe, missing and non-specific title searches", () => {
  assert.equal(normalizeTitleQuery("  personal   discipline  "), "personal discipline");
  assert.equal(normalizeTitleQuery("motivation; delete tables"), "motivation delete tables");
  assert.equal(normalizeTitleQuery(""), null);
  assert.equal(normalizeTitleQuery("discipline"), null);
  assert.equal(normalizeTitleQuery("a b c d e f g h i j k"), null);
});

test("requires five comparable channel videos and only marks a measurable 2x outlier", () => {
  const main = video("abcDEFG1234", { views: 100000, age: 40 });
  const peers = Array.from({ length: 6 }, (_, i) =>
    video("peer" + String(i).padStart(7, "0"), { views: 12000, age: 40 + i }));
  const s = benchmarkTitleVideos([main], peers, NOW)[0];
  assert.equal(s.peerCount, 6);
  assert.equal(s.isOutlier, true);
  assert.ok(s.relativeViewRate > 6);
  assert.equal(s.period, "6m");
  assert.equal(benchmarkTitleVideos([main], peers.slice(0, 4), NOW)[0].relativeViewRate, null);
  assert.equal(benchmarkTitleVideos([main], peers.map(v => ({ ...v, duration_seconds: 20 })), NOW)[0].relativeViewRate, null);
  assert.equal(benchmarkTitleVideos([video("olderVIDEO1", { age: 220 })], peers, NOW)[0].period, "12m");
});

function youtubeFixture(urls) {
  const main = "abcDEFG1234";
  const peers = Array.from({ length: 6 }, (_, i) => "peer" + String(i).padStart(7, "0"));
  return async (input) => {
    const url = new URL(input);
    urls.push(url);
    const resource = url.pathname.split("/").pop();
    if (resource === "search")
      return Response.json({ items: [{ id: { videoId: main } }] });
    if (resource === "channels")
      return Response.json({ items: [{
        id: "UC" + "a".repeat(22),
        contentDetails: { relatedPlaylists: { uploads: "UU-test" } },
      }] });
    if (resource === "playlistItems")
      return Response.json({ items: [main, ...peers].map(id => ({ contentDetails: { videoId: id } })) });
    if (resource === "videos")
      return Response.json({ items: url.searchParams.get("id").split(",").map(id => {
        const v = video(id, { views: id === main ? 100000 : 10000 });
        return {
          id: v.youtube_id,
          snippet: {
            title: v.title, publishedAt: v.published_at,
            channelId: v.channel_id, channelTitle: v.channel,
            description: "habit systems",
            categoryId: "27",
          },
          contentDetails: { duration: "PT10M" },
          statistics: { viewCount: String(v.views), likeCount: "100", commentCount: "10" },
        };
      }) });
    return new Response("not found", { status: 404 });
  };
}
test("researches one last-year YouTube query, measures channel baseline and caches by topic", async () => {
  const calls = [];
  const service = createTitleResearch({
    youtubeKey: "server-only-test-key",
    fetcher: youtubeFixture(calls),
    now: () => NOW,
  });
  const result = await service.study("personal discipline");
  assert.equal(result.status, "verified");
  assert.equal(result.sampledVideos, 1);
  assert.equal(result.verifiedOutliers, 1);
  assert.equal(result.examples[0].relativeViewRate, 10);
  assert.equal(result.examples[0].isOutlier, true);
  assert.equal(result.examples[0].url, "https://www.youtube.com/watch?v=abcDEFG1234");
  assert.equal(result.windowMonths, 12);
  assert.equal(calls.filter(u => u.pathname.endsWith("/search")).length, 1);
  const cutoff = calls[0].searchParams.get("publishedAfter");
  assert.ok(Date.parse(cutoff) < NOW);
  assert.ok(Date.parse(cutoff) > NOW - 367 * 86400000);
  await service.study("personal discipline");
  assert.equal(calls.filter(u => u.pathname.endsWith("/search")).length, 1);
});
test("no YouTube key must never claim a title was backed by channel evidence", async () => {
  const service = createTitleResearch();
  const result = await service.study("personal discipline");
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.examples, []);
});
