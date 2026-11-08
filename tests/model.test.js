import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createVideo,
  transition,
  visible,
  parseTitles,
  STAGES,
} from "../src/model.js";
test("20 titles, 7 moved: exact identity and all script/metadata survive the whole pipeline", () => {
  const videos = Array.from({ length: 20 }, (_, i) => ({
    ...createVideo(`Video ${i}`),
    script: "Kịch bản dài",
    notes: "Góc nhìn",
    source_url: "https://example.com",
  }));
  const ids = videos.map((v) => v.id);
  for (let i = 0; i < 7; i++) videos[i] = transition(videos[i], "script");
  assert.equal(videos.filter((v) => visible(v, "ideas")).length, 13);
  assert.equal(videos.filter((v) => visible(v, "script")).length, 7);
  for (const stage of STAGES.slice(2))
    for (let i = 0; i < 7; i++) videos[i] = transition(videos[i], stage);
  assert.equal(videos[0].script, "Kịch bản dài");
  assert.ok(videos[0].published_at);
  assert.deepEqual(
    videos.map((v) => v.id),
    ids,
  );
  assert.equal(
    transition(videos[0], "editing").source_url,
    "https://example.com",
  );
  assert.throws(() => transition(videos[0], "bad"));
});
test("duplicates are normalized including duplicate titles within the same pasted batch", () => {
  const result = parseTitles("  Ý TƯỞNG \n\nMới\n mới \n", [
    createVideo("ý tưởng"),
  ]);
  assert.deepEqual(
    result.map((r) => r.duplicate),
    [true, false, true],
  );
});
test("archive, trash, restore, purge preserve stage and filter independently", () => {
  const v = { ...createVideo("A"), archived_at: "now" };
  assert.ok(visible(v, "archive"));
  assert.ok(!visible(v, "ideas"));
  v.deleted_at = "now";
  assert.ok(visible(v, "trash"));
  assert.ok(!visible(v, "archive"));
  v.deleted_at = null;
  v.archived_at = null;
  assert.ok(visible(v, "ideas"));
  v.purged_at = "now";
  assert.ok(!visible(v, "ideas"));
  assert.ok(!visible(v, "trash"));
});
