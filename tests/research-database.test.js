import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("research SQL: RLS, server-only writes, atomic quotas, snapshots, idempotent import and existing script protection", async () => {
  const db = new PGlite();
  await db.exec(
    `create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`,
  );
  await db.exec(readFileSync("supabase/001_content_videos.sql", "utf8"));
  await db.exec(readFileSync("supabase/002_youtube_research.sql", "utf8"));
  const a = "00000000-0000-0000-0000-000000000001",
    b = "00000000-0000-0000-0000-000000000002";
  await db.query("insert into auth.users values($1),($2)", [a, b]);
  const as = async (role, id = a) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
  await as("authenticated");
  await db.query(
    "insert into public.content_research_settings(user_id) values($1)",
    [a],
  );
  await assert.rejects(
    () =>
      db.query(
        "insert into public.content_research_settings(user_id) values($1)",
        [b],
      ),
    /row-level security/,
  );
  await assert.rejects(
    () =>
      db.query("select public.begin_content_research_scan($1,$2)", [a, "{}"]),
    /permission denied/,
  );
  await as("service_role");
  const run = (
    await db.query("select public.begin_content_research_scan($1,$2) as id", [
      a,
      "{}",
    ])
  ).rows[0].id;
  await assert.rejects(
    () =>
      db.query("select public.begin_content_research_scan($1,$2)", [a, "{}"]),
    /SCAN_RUNNING/,
  );
  const item = {
    youtube_id: "video000000",
    title: "Nghiên cứu",
    url: "https://www.youtube.com/watch?v=video000000",
    channel: "Example",
    sources: ["Kênh: Example"],
    views: 10000,
    likes: null,
    comments: 100,
    analysis: { score: 55, angle: "Góc riêng" },
    proposed: true,
  };
  const persist = (items) =>
    db.query("select public.persist_content_research_scan($1,$2,$3,$4)", [
      a,
      run,
      JSON.stringify(items),
      "2026-11-08T00:00:00Z",
    ]);
  await persist([item]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from public.content_research_snapshots",
      )
    ).rows[0].n,
    1,
  );
  await as("authenticated");
  await assert.rejects(
    () =>
      db.query("update public.content_research_videos set status='accepted'"),
    /permission denied/,
  );
  const accept = (ids) =>
    db.query("select * from public.accept_content_research($1)", [ids]);
  const first = (await accept([item.youtube_id])).rows[0];
  assert.equal(first.stage, "ideas");
  assert.equal(first.source_url, item.url);
  const again = (await accept([item.youtube_id, item.youtube_id])).rows;
  assert.ok(again.every((v) => v.id === first.id));
  assert.equal(
    (await db.query("select count(*)::int as n from public.content_videos"))
      .rows[0].n,
    1,
  );
  const link = (await db.query("select * from public.content_research_links"))
    .rows[0];
  assert.equal(link.snapshot.statistics.length, 1);
  assert.equal(link.snapshot.video.analysis.angle, "Góc riêng");
  await as("authenticated", b);
  assert.equal(
    (await db.query("select * from public.content_research_videos")).rows
      .length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.content_research_links")).rows.length,
    0,
  );
  await assert.rejects(() => accept([item.youtube_id]), /Proposal not found/);
  await as("service_role");
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from public.content_research_imports",
      )
    ).rows[0].n,
    1,
  );
  await persist([{ ...item, title: "Refresh", sources: ["Từ khóa: mới"] }]);
  assert.equal(
    (await db.query("select status from public.content_research_videos"))
      .rows[0].status,
    "accepted",
  );
  assert.equal(
    (await db.query("select sources from public.content_research_videos"))
      .rows[0].sources.length,
    2,
  );
  // A manually entered reference must link the existing idea without overwriting its script.
  const other = {
    ...item,
    youtube_id: "video000001",
    url: "https://www.youtube.com/watch?v=video000001",
  };
  await persist([other]);
  await as("authenticated");
  await db.query(
    "insert into public.content_videos(id,user_id,title,source_url,script) values(gen_random_uuid(),$1,'Manual','https://youtu.be/video000001?t=5','Keep my script')",
    [a],
  );
  const imported = (await accept([other.youtube_id])).rows[0];
  assert.equal(imported.script, "Keep my script");
  assert.equal(imported.title, "Manual");
  await as("service_role");
  await db.query(
    "update public.content_research_runs set status='succeeded',completed_at=now() where id=$1",
    [run],
  );
  await assert.rejects(
    () =>
      db.query("select public.begin_content_research_scan($1,$2)", [a, "{}"]),
    /SCAN_COOLDOWN/,
  );
  await db.query(
    "update public.content_research_runs set started_at=now()-interval '2 minutes' where id=$1",
    [run],
  );
  const next = (
    await db.query("select public.begin_content_research_scan($1,$2) as id", [
      a,
      "{}",
    ])
  ).rows[0].id;
  assert.notEqual(next, run);
  await as("anon");
  await assert.rejects(
    () => db.query("select * from public.content_research_settings"),
    /permission denied/,
  );
  await assert.rejects(() => accept([item.youtube_id]), /permission denied/);
  await db.close();
});
