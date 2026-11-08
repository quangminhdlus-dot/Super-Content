import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSettings,
  parseChannel,
  ResearchError,
} from "../server/validation.js";
import { scoreVideo } from "../server/scoring.js";
import { YouTube, discover } from "../server/youtube.js";
import { enrichEligible } from "../server/ai.js";
import { runScan } from "../server/scan.js";
import { createResearchServer } from "../server/index.js";
const now = Date.parse("2026-11-08T00:00:00Z");
const settings = {
  channels: [{ url: "https://www.youtube.com/@example" }],
  keywords: [],
  mode: "channels",
  published_after: "2026-10-01",
  published_before: "2026-11-08",
  result_limit: 10,
};
function video(id, views = 1000, extra = {}) {
  return {
    youtube_id: id,
    title: "Sức khỏe mỗi ngày",
    description: "Thói quen",
    channel_id: "UC" + "a".repeat(22),
    channel: "Example",
    category_id: "27",
    published_at: "2026-11-01T00:00:00Z",
    url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    duration_seconds: 600,
    views,
    likes: null,
    comments: null,
    sources: ["Kênh: Example"],
    candidate: true,
    ...extra,
  };
}
test("validates official channel routes, source limits, dates and prevents arbitrary fetch destinations", () => {
  assert.equal(
    parseChannel("https://www.youtube.com/@example").handle,
    "@example",
  );
  for (const value of [
    "http://www.youtube.com/@x",
    "https://www.youtube.com.evil/@x",
    "https://youtube.com@evil.test/@x",
    "https://youtube.com/watch?v=abcdef",
  ])
    assert.throws(() => parseChannel(value));
  assert.equal(validateSettings(settings, new Date(now)).result_limit, 10);
  assert.throws(() =>
    validateSettings(
      { ...settings, published_after: "2026-02-30" },
      new Date(now),
    ),
  );
  assert.throws(() =>
    validateSettings({ ...settings, result_limit: 51 }, new Date(now)),
  );
  assert.throws(() =>
    validateSettings({ ...settings, mode: "combined" }, new Date(now)),
  );
});
test("high views are not automatically an outlier; comparable age and duration and history are required", () => {
  const candidate = video("candidate01", 1000000);
  let score = scoreVideo(candidate, [candidate], [], [], now);
  assert.equal(score.view_ratio, null);
  assert.equal(score.eligible, false);
  assert.equal(score.confidence, "low");
  const peers = Array.from({ length: 5 }, (_, i) =>
    video(`peer000000${i}`, 1000000),
  );
  score = scoreVideo(candidate, [candidate, ...peers], [], [], now);
  assert.equal(score.view_ratio, 1);
  assert.equal(score.eligible, false);
  score = scoreVideo(
    { ...candidate, views: 4000000 },
    [candidate, ...peers],
    [],
    [],
    now,
  );
  assert.equal(score.view_ratio, 4);
  assert.equal(score.eligible, true);
  assert.equal(score.views_per_day, null);
  const shorts = peers.map((v) => ({ ...v, duration_seconds: 60 }));
  assert.equal(
    scoreVideo(candidate, [candidate, ...shorts], [], [], now).view_ratio,
    null,
  );
  const old = peers.map((v) => ({
    ...v,
    published_at: "2024-01-01T00:00:00Z",
  }));
  assert.equal(scoreVideo(candidate, old, [], [], now).view_ratio, null);
  const history = [candidate, ...peers].map((v) => ({
    youtube_id: v.youtube_id,
    views: v.views - 100,
    captured_at: new Date(now - 86400000).toISOString(),
  }));
  score = scoreVideo(candidate, [candidate, ...peers], history, [], now);
  assert.equal(score.views_per_day, 100);
  assert.equal(score.growth_ratio, 1);
  assert.equal(score.confidence, "medium");
  const dayOld = {
    ...candidate,
    published_at: new Date(now - 23 * 3600000).toISOString(),
  };
  const hourOld = peers.map((p) => ({
    ...p,
    published_at: new Date(now - 3600000).toISOString(),
  }));
  assert.equal(scoreVideo(dayOld, hourOld, [], [], now).view_ratio, null);
  const corrections = history.map((s) => ({ ...s, views: 2000000 }));
  assert.equal(
    scoreVideo(candidate, peers, corrections, [], now).views_per_day,
    null,
  );
  const tooRecent = history.map((v) => ({
    ...v,
    captured_at: new Date(now - 10000).toISOString(),
  }));
  assert.equal(
    scoreVideo(candidate, peers, tooRecent, [], now).views_per_day,
    null,
  );
});
function fakeYouTube(requests, { fail = false } = {}) {
  return async (input) => {
    const u = new URL(input);
    requests.push(u);
    if (fail)
      return new Response(
        JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }),
        { status: 403 },
      );
    const resource = u.pathname.split("/").pop();
    let data;
    if (resource === "channels")
      data = {
        items: [
          {
            id: "UC" + "a".repeat(22),
            snippet: { title: "Example" },
            contentDetails: { relatedPlaylists: { uploads: "UU-example" } },
          },
        ],
      };
    if (resource === "playlistItems")
      data = {
        items: Array.from({ length: 6 }, (_, i) => ({
          contentDetails: { videoId: `video00000${i}` },
        })),
      };
    if (resource === "videos")
      data = {
        items: u.searchParams
          .get("id")
          .split(",")
          .map((id, i) => ({
            id,
            snippet: {
              title: `Thói quen ${i}`,
              description: "Nghiên cứu",
              channelId: "UC" + "a".repeat(22),
              channelTitle: "Example",
              categoryId: "27",
              publishedAt: "2026-11-01T00:00:00Z",
            },
            contentDetails: { duration: "PT10M" },
            statistics: {
              viewCount: String(i === 0 ? 10000 : 1000),
              commentCount: "10",
            },
          })),
      };
    if (resource === "search")
      data = { items: [{ id: { videoId: "video000000" } }] };
    return Response.json(data);
  };
}
test("known channels use uploads, keyword source is merged, API errors never expose the key", async () => {
  const requests = [],
    yt = new YouTube("secret-server-key", { fetcher: fakeYouTube(requests) });
  const result = await discover(
    yt,
    validateSettings(
      { ...settings, keywords: ["Thói quen"], mode: "combined" },
      new Date(now),
    ),
  );
  assert.equal(result.videos.length, 6);
  assert.equal(new Set(result.videos.map((v) => v.youtube_id)).size, 6);
  assert.equal(result.videos[0].sources.length, 2);
  assert.equal(result.videos[0].likes, null);
  assert.equal(
    requests.filter((u) => u.pathname.endsWith("/search")).length,
    1,
  );
  const only = [];
  await discover(
    new YouTube("key", { fetcher: fakeYouTube(only) }),
    validateSettings(settings, new Date(now)),
  );
  assert.equal(only.filter((u) => u.pathname.endsWith("/search")).length, 0);
  await assert.rejects(
    () =>
      new YouTube("do-not-leak", {
        fetcher: fakeYouTube([], { fail: true }),
      }).resolve({ handle: "@example" }),
    (error) =>
      error.code === "YOUTUBE_QUOTA" && !error.message.includes("do-not-leak"),
  );
});
test("AI only sees the top three numerically qualified videos; unavailable AI keeps numeric results", async () => {
  const items = Array.from({ length: 6 }, (_, i) => ({
    ...video(`v${i}`),
    analysis: { eligible: i > 0, angle: "fallback" },
  }));
  let calls = 0;
  await enrichEligible(items, {
    key: "secret",
    fetcher: async () => {
      calls++;
      return Response.json({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  angle: "Góc khai thác có dữ liệu riêng",
                }),
              },
            ],
          },
        ],
      });
    },
  });
  assert.equal(calls, 3);
  assert.equal(items[0].analysis.angle, "fallback");
  assert.equal(items[4].analysis.angle, "fallback");
  assert.equal(items[1].analysis.angle_source, "ai");
  const warnings = await enrichEligible(items, {
    key: "secret",
    fetcher: async () => new Response("", { status: 500 }),
  });
  assert.equal(warnings.length, 1);
});
test("scan orchestrates persistence, snapshots and logs failure without losing prior data", async () => {
  let result, finished;
  const repo = {
    settings: async () => settings,
    begin: async () => "run-id",
    history: async () => [],
    persist: async (v, id, time) => {
      result = { v, id, time };
    },
    finish: async (id, v) => {
      finished = v;
    },
  };
  const output = await runScan(
    repo,
    { youtubeKey: "key" },
    { fetcher: fakeYouTube([]), now },
  );
  assert.equal(output.found, 6);
  assert.equal(output.proposed, 6);
  assert.equal(result.v.length, 6);
  assert.ok(result.v.every((v) => v.analysis));
  assert.equal(finished.status, "succeeded");
  await assert.rejects(
    () =>
      runScan(
        repo,
        { youtubeKey: "key" },
        { fetcher: fakeYouTube([], { fail: true }), now },
      ),
    (e) => e.code === "YOUTUBE_QUOTA",
  );
  assert.equal(finished.status, "failed");
  assert.equal(finished.error_code, "YOUTUBE_QUOTA");
  await assert.rejects(
    () => runScan(repo, {}, {}),
    (e) => e.code === "YOUTUBE_NOT_CONFIGURED",
  );
});
test("HTTP API requires a verified bearer, enforces origins, propagates rate limits and sanitizes exceptions", async () => {
  let calls = 0;
  const server = createResearchServer({
    allowedOrigins: ["https://app.example"],
    authenticate: async (token) =>
      ["good", "limited", "failure"].includes(token)
        ? { id: token === "good" ? "account-a" : token }
        : null,
    scan: async (user) => {
      if (user.id === "limited")
        throw new ResearchError("SCAN_LIMIT", "Đã đạt giới hạn quét.", 429);
      if (user.id === "failure")
        throw new Error("Sensitive provider details: secret-server-key");
      assert.equal(user.id, "account-a");
      calls++;
      return { proposed: 2 };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/research/scan`;
  try {
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: { Authorization: "Bearer invalid" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          headers: {
            Origin: "https://evil.example",
            Authorization: "Bearer good",
          },
        })
      ).status,
      403,
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { Origin: "https://app.example", Authorization: "Bearer good" },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).proposed, 2);
    assert.equal(calls, 1);
    const limited = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer limited" },
    });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "SCAN_LIMIT");
    const broken = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer failure" },
    });
    assert.equal(broken.status, 503);
    assert.ok(!(await broken.text()).includes("secret-server-key"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
