import { test } from "node:test";
import assert from "node:assert/strict";
import { createVideo } from "../src/model.js";
import { mergeCloudVideo, sameVideoContent } from "../src/sync-merge.js";
const seed = () => ({ ...createVideo("Ý tưởng"), user_id: "user-id", revision: 1, notes: "Bản gốc" });
test("same content and newer revision do not create a spurious conflict", () => {
  const base=seed(), remote={...base,revision:3,updated_at:"2026-01-01"};
  assert.equal(sameVideoContent(base,remote),true);
  assert.deepEqual(mergeCloudVideo(base,null,remote),remote);
});
test("independent polished content and AI title are merged without data loss", () => {
  const base=seed(), local={...base,notes:"Bản trau chuốt"}, remote={...base,title:"Tiêu đề AI",revision:2};
  const merged=mergeCloudVideo(local,base,remote);
  assert.equal(merged.notes,"Bản trau chuốt");
  assert.equal(merged.title,"Tiêu đề AI");
});
test("genuine overlapping changes never overwrite either version", () => {
  const base=seed(), local={...base,notes:"Máy này"}, remote={...base,notes:"Máy khác",revision:2};
  assert.equal(mergeCloudVideo(local,base,remote),null);
  assert.equal(mergeCloudVideo(local,null,remote),null);
});
test("identical concurrent field edits are safe", () => {
  const base=seed(), local={...base,notes:"Nội dung mới"}, remote={...base,notes:"Nội dung mới",revision:2};
  assert.equal(mergeCloudVideo(local,base,remote).notes,"Nội dung mới");
});
test("no merge across users or video IDs", () => {
  const base=seed();
  assert.equal(mergeCloudVideo(base,base,{...base,user_id:"different"}),null);
  assert.equal(mergeCloudVideo(base,base,{...base,id:"different"}),null);
});
