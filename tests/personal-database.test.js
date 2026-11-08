import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { defaultCriteria, importChannels } from "../shared/personalization.js";
test("003 migration preserves production data; criteria versions, decisions, memory and resumable leases are account isolated", async () => {
  const db = new PGlite();
  await db.exec(
    `create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`,
  );
  for (const file of [
    "001_content_videos.sql",
    "002_youtube_research.sql",
    "003_personal_research.sql",
  ])
    await db.exec(readFileSync("supabase/" + file, "utf8"));
  const a = "00000000-0000-0000-0000-000000000001",
    b = "00000000-0000-0000-0000-000000000002";
  await db.query("insert into auth.users values($1),($2)", [a, b]);
  const as = async (role, id = a) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role " + role);
  };
  await as("authenticated");
  await db.query(
    "insert into public.content_videos(id,user_id,title,script) values(gen_random_uuid(),$1,'Giữ nguyên','Kịch bản quan trọng')",
    [a],
  );
  const channels = importChannels(
    Array.from(
      { length: 100 },
      (_, i) => `https://www.youtube.com/@channel${i}`,
    ).join("\n"),
  ).added;
  const save = () =>
    db.query("select public.save_content_channels($1::jsonb)", [
      JSON.stringify(channels),
    ]);
  await save();
  await save();
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.content_research_channels",
      )
    ).rows[0].n,
    100,
  );
  const criteria = defaultCriteria();
  criteria.topics = "Khoa học";
  const one = (
    await db.query("select * from public.save_content_criteria($1,0)", [
      JSON.stringify(criteria),
    ])
  ).rows[0];
  criteria.topics = "Lịch sử";
  const two = (
    await db.query("select * from public.save_content_criteria($1,1)", [
      JSON.stringify(criteria),
    ])
  ).rows[0];
  assert.equal(two.revision, 2);
  assert.equal(
    (
      await db.query(
        "select content from public.content_criteria_versions where id=$1",
        [one.id],
      )
    ).rows[0].content.topics,
    "Khoa học",
  );
  await assert.rejects(
    () =>
      db.query("select * from public.save_content_criteria($1,0)", [
        JSON.stringify(criteria),
      ]),
    /CRITERIA_CONFLICT/,
  );
  await as("service_role");
  const tasks = [{ type: "channel", row_id: "sample" }, { type: "evaluate" }];
  const job = (
    await db.query(
      "select * from public.start_content_research_job($1,$2,$3)",
      [a, "{}", JSON.stringify(tasks)],
    )
  ).rows[0];
  const claim = () =>
    db.query("select * from public.claim_content_research_step($1,$2)", [
      a,
      job.id,
    ]);
  const claimed = (await claim()).rows[0];
  await assert.rejects(() => claim(), /JOB_BUSY/);
  const item = {
    youtube_id: "video000000",
    title: "Thí nghiệm khoa học",
    url: "https://youtube.com/watch?v=video000000",
    views: 100,
    likes: null,
    comments: null,
    sources: ["Kênh: A"],
    analysis: {},
    proposed: true,
  };
  const commit = (lease, items, task, done) =>
    db.query(
      "select * from public.commit_content_research_step($1,$2,$3,$4,$5,$6,1,null,null)",
      [a, job.id, lease, JSON.stringify(items), JSON.stringify(task), done],
    );
  await commit(
    claimed.lease_token,
    [item],
    { type: "channel", page_token: "next-page", pages: 1 },
    false,
  );
  const resumed = (await claim()).rows[0];
  assert.equal(resumed.tasks[0].page_token, "next-page");
  await assert.rejects(
    () => commit(claimed.lease_token, [], null, true),
    /STALE_LEASE/,
  );
  await commit(resumed.lease_token, [], null, true);
  const evaluation = (await claim()).rows[0];
  await commit(
    evaluation.lease_token,
    [
      {
        ...item,
        cache_evaluation: true,
        analysis: {
          criteria_version: two.id,
          personal_reasons: ["Đúng tiêu chuẩn lịch sử"],
          ranking_engine: "rules",
        },
      },
    ],
    null,
    true,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.content_research_snapshots",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.content_research_evaluations",
      )
    ).rows[0].n,
    1,
  );
  await as("authenticated");
  const f = (
    await db.query(
      "select * from public.record_content_feedback($1,'excellent','Tôi thích cách tiếp cận')",
      [item.youtube_id],
    )
  ).rows[0];
  assert.equal(f.criteria_version, two.id);
  assert.equal(f.evaluated_version, two.id);
  const memory = (
    await db.query(
      "insert into public.content_preference_memories(user_id,feedback_id,text,video_title,preference,confirmed) values($1,$2,'Ưu tiên cách giải thích khoa học','Thí nghiệm khoa học','positive',true) returning *",
      [a, f.id],
    )
  ).rows[0];
  const rejected = (
    await db.query(
      "select * from public.record_content_feedback($1,'rejected','Không hợp chủ đề mới')",
      [item.youtube_id],
    )
  ).rows[0];
  assert.equal(rejected.decision, "rejected");
  assert.equal(rejected.criteria_version, two.id);
  await as("authenticated", b);
  for (const table of [
    "content_research_channels",
    "content_criteria_versions",
    "content_research_feedback",
    "content_preference_memories",
    "content_research_jobs",
    "content_research_evaluations",
  ])
    assert.equal(
      (await db.query("select * from public." + table)).rows.length,
      0,
    );
  await assert.rejects(
    () =>
      db.query(
        "insert into public.content_preference_memories(user_id,feedback_id,text,preference) values($1,$2,'Steal','positive')",
        [b, f.id],
      ),
    /row-level security/,
  );
  await assert.rejects(
    () =>
      db.query("select * from public.record_content_feedback($1,$2,$3)", [
        item.youtube_id,
        "chosen",
        "bad",
      ]),
    /Proposal not found/,
  );
  await assert.rejects(
    () =>
      db.query("select * from public.claim_content_research_step($1,$2)", [
        a,
        job.id,
      ]),
    /permission denied/,
  );
  await as("authenticated");
  await db.query("delete from public.content_preference_memories where id=$1", [
    memory.id,
  ]);
  assert.equal(
    (await db.query("select * from public.content_preference_memories")).rows
      .length,
    0,
  );
  assert.equal(
    (await db.query("select script from public.content_videos")).rows[0].script,
    "Kịch bản quan trọng",
  );
  await db.close();
});
