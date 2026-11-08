import { test } from "node:test";
import assert from "node:assert/strict";
import {
  importChannels,
  defaultCriteria,
  personalScore,
} from "../shared/personalization.js";
import { evaluatePersonalAI } from "../server/personal-ai.js";
import { startResearchJob, stepResearchJob } from "../server/jobs.js";
const base = {
  eligible: false,
  view_ratio: null,
  growth_ratio: null,
  reasons: [],
  note: "Chưa đủ thống kê.",
};
const video = (title, id = "video000000") => ({
  youtube_id: id,
  title,
  description: "",
  channel_id: "UC" + "a".repeat(22),
  channel: "Example",
  category_id: "27",
  duration_seconds: 600,
  published_at: "2026-11-01T00:00:00Z",
  views: 1000,
  likes: null,
  comments: null,
  sources: ["Kênh: Example"],
});
test("100 channels imported with canonical duplicate detection, topic and disabled state retained", () => {
  const input =
    Array.from(
      { length: 100 },
      (_, i) => `https://www.youtube.com/@channel${i}`,
    ).join("\n") +
    "\nhttps://youtube.com/@CHANNEL1/videos\nhttps://evil.test/@x";
  const result = importChannels(input, [], "Khoa học");
  assert.equal(result.added.length, 100);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.invalid.length, 1);
  assert.ok(
    result.added.every((c) => c.enabled && c.topic_group === "Khoa học"),
  );
  assert.equal(importChannels(input, result.added).added.length, 0);
});
test("the same videos change ranking with personal criteria; only confirmed similar memories influence scores", () => {
  const health = video("Dinh dưỡng sức khỏe"),
    tech = video("Lập trình máy tính"),
    c = defaultCriteria();
  c.weights = {
    growth: 0,
    engagement: 0,
    relevance: 100,
    novelty: 0,
    potential: 0,
  };
  c.topics = "dinh dưỡng sức khỏe";
  assert.ok(
    personalScore(health, base, c).score > personalScore(tech, base, c).score,
  );
  c.topics = "lập trình máy tính";
  assert.ok(
    personalScore(tech, base, c).score > personalScore(health, base, c).score,
  );
  c.topics = "";
  const memory = {
    id: "m1",
    confirmed: true,
    preference: "positive",
    text: "ưu tiên máy tính",
    video_title: tech.title,
  };
  const learned = personalScore(tech, base, c, [memory]);
  assert.ok(learned.score > personalScore(tech, base, c, []).score);
  assert.deepEqual(learned.used_memory_ids, ["m1"]);
  assert.match(learned.personal_reasons.join(" "), /máy tính/);
  assert.equal(
    personalScore(tech, base, c, [{ ...memory, confirmed: false }]).score,
    0,
  );
});
test("AI receives the actual criteria version and confirmed decisions and changes the rank components without changing user weights", async () => {
  const profile = { id: "version-one", content: defaultCriteria() };
  profile.content.topics = "Khoa học";
  const original = JSON.stringify(profile);
  const memory = {
    id: "memory",
    confirmed: true,
    preference: "negative",
    video_title: "Khoa học bí ẩn",
    text: "Không thích giật gân",
  };
  const v = video("Khoa học bí ẩn");
  v.analysis = personalScore(v, base, profile.content, [memory]);
  let payload;
  await evaluatePersonalAI(
    [v],
    profile,
    [memory, { ...memory, id: "unconfirmed", confirmed: false }],
    {
      key: "server-only",
      fetcher: async (_url, req) => {
        payload = JSON.parse(req.body);
        return Response.json({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    relevance: 0.1,
                    novelty: 0.2,
                    potential: 0.3,
                    angle: "Phân tích khoa học với nguồn xác minh",
                    explanation:
                      "Theo tiêu chuẩn và ví dụ không thích giật gân.",
                  }),
                },
              ],
            },
          ],
        });
      },
    },
  );
  const input = JSON.parse(payload.input);
  assert.equal(input.criteria_version, profile.id);
  assert.equal(input.criteria.topics, "Khoa học");
  assert.equal(input.confirmed_examples.length, 1);
  assert.equal(v.analysis.ranking_engine, "ai");
  assert.equal(v.analysis.components.relevance, 0.1);
  assert.equal(JSON.stringify(profile), original);
});
test("100 channel jobs are persisted as resumable steps; cache-only research never calls YouTube", async () => {
  const channels = Array.from({ length: 100 }, (_, i) => ({
    id: `row${i}`,
    url: `https://youtube.com/@c${i}`,
    enabled: true,
    youtube_channel_id: "UC" + "a".repeat(22),
  }));
  let started;
  const settings = {
    channels: [],
    keywords: [],
    mode: "channels",
    published_after: "2026-10-01",
    published_before: "2026-11-08",
    result_limit: 10,
  };
  const repo = { settings: async () => settings, history: async () => [] };
  const personal = {
    channels: async () => channels,
    start: async (s, t) => {
      started = { settings: s, tasks: t };
      return started;
    },
  };
  await startResearchJob(repo, personal, { kind: "refresh" });
  assert.equal(started.tasks.length, 101);
  assert.equal(started.tasks[0].type, "channel");
  const job = {
    id: "job",
    status: "running",
    criteria_version: null,
    settings: { ...settings, query: "" },
    tasks: [{ type: "evaluate" }],
    cursor: 0,
    api_units: 0,
  };
  let committed;
  Object.assign(personal, {
    claim: async () => job,
    cache: async () => [
      {
        data: video("Khoa học"),
        sources: ["Kênh: Example"],
        collected_at: "2026-11-08T00:00:00Z",
      },
    ],
    memories: async () => [],
    profile: async () => null,
    commit: async (_job, result) => {
      committed = result;
      return { ...job, status: "completed" };
    },
  });
  const result = await stepResearchJob(
    repo,
    personal,
    "job",
    {},
    {
      now: Date.parse("2026-11-08T01:00:00Z"),
      fetcher: async () => {
        throw new Error("Network must not be used");
      },
    },
  );
  assert.equal(result.status, "completed");
  assert.equal(committed.items.length, 1);
  assert.equal(committed.items[0].cache_evaluation, true);
  assert.equal(committed.items[0].analysis.ranking_engine, "rules");
});
test("each channel request reads at most one playlist page and resumes from the persisted page token after restart", async () => {
  const row = {
    id: "channel-row",
    url: "https://youtube.com/@example",
    enabled: true,
    last_video_at: null,
  };
  let job = {
    id: "job",
    status: "running",
    api_units: 0,
    cursor: 0,
    tasks: [
      {
        type: "channel",
        row_id: row.id,
        pages: 0,
        page_token: null,
        watermark: null,
      },
      { type: "evaluate" },
    ],
  };
  const requests = [];
  const personal = {
    claim: async () => JSON.parse(JSON.stringify(job)),
    channel: async () => row,
    channels: async () => [row],
    commit: async (_job, result) => {
      if (result.channel)
        Object.assign(row, {
          youtube_channel_id: result.channel.id,
          uploads: result.channel.uploads,
          title: result.channel.title,
        });
      job.api_units += result.units || 0;
      if (result.done === false) job.tasks[0] = result.task;
      else job.cursor++;
      return job;
    },
  };
  const fetcher = async (input) => {
    const u = new URL(input);
    requests.push(u);
    const endpoint = u.pathname.split("/").pop();
    if (endpoint === "channels")
      return Response.json({
        items: [
          {
            id: "UC" + "a".repeat(22),
            snippet: { title: "Example" },
            contentDetails: { relatedPlaylists: { uploads: "UU-example" } },
          },
        ],
      });
    if (endpoint === "playlistItems")
      return Response.json({
        items: [{ contentDetails: { videoId: "video000000" } }],
        ...(u.searchParams.get("pageToken")
          ? {}
          : { nextPageToken: "checkpoint-page-two" }),
      });
    return Response.json({
      items: [
        {
          id: "video000000",
          snippet: {
            title: "Test",
            description: "",
            channelId: "UC" + "a".repeat(22),
            channelTitle: "Example",
            categoryId: "27",
            publishedAt: "2026-11-08T00:00:00Z",
          },
          statistics: { viewCount: "100" },
          contentDetails: { duration: "PT10M" },
        },
      ],
    });
  };
  await stepResearchJob(
    {},
    personal,
    "job",
    { youtubeKey: "server-key" },
    { fetcher },
  );
  assert.equal(job.cursor, 0);
  assert.equal(job.tasks[0].page_token, "checkpoint-page-two");
  assert.equal(
    requests.filter((u) => u.pathname.endsWith("playlistItems")).length,
    1,
  );
  job = JSON.parse(JSON.stringify(job));
  await stepResearchJob(
    {},
    personal,
    "job",
    { youtubeKey: "server-key" },
    { fetcher },
  );
  assert.equal(job.cursor, 1);
  assert.equal(
    requests.filter((u) => u.pathname.endsWith("channels")).length,
    1,
  );
  assert.equal(
    requests
      .filter((u) => u.pathname.endsWith("playlistItems"))[1]
      .searchParams.get("pageToken"),
    "checkpoint-page-two",
  );
  job.cursor = 0;
  job.tasks[0] = {
    type: "channel",
    row_id: row.id,
    pages: 0,
    page_token: null,
    watermark: "2026-11-08T00:00:00+00:00",
  };
  await stepResearchJob(
    {},
    personal,
    "job",
    { youtubeKey: "server-key" },
    { fetcher },
  );
  assert.equal(
    job.cursor,
    1,
    "An equal PostgreSQL +00:00 watermark stops paging even though YouTube uses Z",
  );
});
