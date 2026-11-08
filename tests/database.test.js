import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { createVideo } from "../src/model.js";
test("PostgreSQL RLS isolates accounts; CAS rejects stale revisions and rejects spoofed ownership", async () => {
  const db = new PGlite();
  await db.exec(
    `create role authenticated; create role anon; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
  );
  await db.exec(readFileSync("supabase/001_content_videos.sql", "utf8"));
  const a = "00000000-0000-0000-0000-000000000001",
    b = "00000000-0000-0000-0000-000000000002";
  await db.query("insert into auth.users values ($1),($2)", [a, b]);
  async function asUser(id) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  }
  await asUser(a);
  let v = createVideo("Private script", a);
  v.script = "Only account A";
  let saved = (
    await db.query("select * from public.save_content_video($1::jsonb,0)", [
      JSON.stringify(v),
    ])
  ).rows[0];
  assert.equal(saved.revision, 1);
  assert.equal(
    (
      await db.query("select * from public.save_content_video($1::jsonb,0)", [
        JSON.stringify(v),
      ])
    ).rows.length,
    0,
  );
  v = { ...v, title: "Updated" };
  saved = (
    await db.query("select * from public.save_content_video($1::jsonb,1)", [
      JSON.stringify(v),
    ])
  ).rows[0];
  assert.equal(saved.revision, 2);
  assert.equal(saved.script, "Only account A");
  assert.equal(
    (
      await db.query("select * from public.save_content_video($1::jsonb,1)", [
        JSON.stringify({ ...v, title: "Stale device" }),
      ])
    ).rows.length,
    0,
  );
  await asUser(b);
  assert.equal(
    (await db.query("select * from public.content_videos")).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        "update public.content_videos set title=$1 where id=$2 returning *",
        ["stolen", v.id],
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    () =>
      db.query("select * from public.save_content_video($1::jsonb,2)", [
        JSON.stringify(v),
      ]),
    /Unauthorized/,
  );
  await assert.rejects(
    () =>
      db.query(
        "insert into public.content_videos(id,user_id,title) values($1,$2,$3)",
        [crypto.randomUUID(), a, "spoof"],
      ),
    /row-level security/,
  );
  await db.exec("reset role; set role anon");
  await assert.rejects(
    () => db.query("select * from public.content_videos"),
    /permission denied/,
  );
  await asUser(a);
  assert.equal(
    (await db.query("select title from public.content_videos")).rows[0].title,
    "Updated",
  );
  await db.close();
});
