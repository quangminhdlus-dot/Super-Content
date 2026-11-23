import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createVoiceService,
  validateAudio,
  createVoiceLimiter,
} from "../server/voice.js";
import { createResearchServer } from "../server/index.js";
import {
  insertVoiceText,
  MAX_AUDIO_BYTES,
  recordingType,
} from "../shared/voice.js";

const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
const mp4 = Buffer.from([0, 0, 0, 20, ...Buffer.from("ftypisom")]);
test("preserves real WebM/MP4 containers, model names, Vietnamese hints and private editing", async () => {
  const calls = [];
  const service = createVoiceService({
    key: "test-only",
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return Response.json(
        url.endsWith("transcriptions")
          ? { text: "ừ tôi muốn giữ luận điểm này" }
          : {
              status: "completed",
              output: [
                {
                  content: [
                    {
                      type: "output_text",
                      text: "Tôi muốn giữ luận điểm này.",
                    },
                  ],
                },
              ],
            },
      );
    },
  });
  for (const [bytes, type, filename] of [
    [webm, "audio/webm;codecs=opus", "recording.webm"],
    [mp4, "audio/mp4", "recording.m4a"],
  ]) {
    const result = await service.transcribe(bytes, type);
    const body = calls.at(-1).options.body;
    assert.equal(body.get("file").name, filename);
    assert.deepEqual(Buffer.from(await body.get("file").arrayBuffer()), bytes);
    assert.equal(body.get("model"), "gpt-transcribe");
    assert.equal(body.get("languages[]"), "vi");
    assert.equal(result.original, "ừ tôi muốn giữ luận điểm này");
  }
  await service.polish("ừ tôi muốn giữ luận điểm này");
  const edit = JSON.parse(calls.at(-1).options.body);
  assert.equal(edit.model, "gpt-6.1-terra");
  assert.equal(edit.store, false);
  assert.match(edit.instructions, /Không tự sáng tác/);
  assert.equal(edit.tools, undefined);
});
test("suggests one concise Vietnamese title from a spoken idea without adding claims", async () => {
  const calls = [];
  const service = createVoiceService({
    key: "test-only",
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return Response.json({
        status: "completed",
        output: [{ content: [{ type: "output_text", text: "  “Thành công đòi hỏi nỗ lực bền bỉ”  " }] }],
      });
    },
  });
  assert.deepEqual(await service.suggestTitle("Tôi muốn chia sẻ rằng thành công là quá trình cần nỗ lực."), {
    title: "Thành công đòi hỏi nỗ lực bền bỉ",
  });
  const input = JSON.parse(calls[0].options.body);
  assert.equal(input.model, "gpt-6.1-terra");
  assert.equal(input.store, false);
  assert.match(input.instructions, /không thêm tình tiết/);
});

test("rejects mislabeled, empty and oversized audio; exposes no provider diagnostics", async () => {
  for (const [bytes, type] of [
    [webm, "audio/mp4"],
    [Buffer.alloc(0), "audio/webm"],
    [Buffer.alloc(MAX_AUDIO_BYTES + 1), "audio/webm"],
    [webm, "text/html"],
  ])
    assert.throws(() => validateAudio(bytes, type));
  const service = createVoiceService({
    key: "test-only",
    fetcher: async () =>
      new Response("secret upstream diagnostics", { status: 401 }),
  });
  await assert.rejects(
    service.transcribe(webm, "audio/webm"),
    (err) => err.code === "VOICE_API" && !err.message.includes("secret"),
  );
  await assert.rejects(
    createVoiceService().transcribe(webm, "audio/webm"),
    (err) => err.code === "VOICE_CONFIG",
  );
  await assert.rejects(service.polish(""));
});
test("selects Safari MP4 and inserts without deleting selected content", () => {
  assert.equal(
    recordingType({ isTypeSupported: (type) => type === "audio/mp4" }),
    "audio/mp4",
  );
  assert.deepEqual(insertVoiceText("Trước sau", "mới", 6), {
    value: "Trước mới sau",
    cursor: 10,
  });
  assert.deepEqual(insertVoiceText("", "mới", 0), { value: "mới", cursor: 3 });
});
test("rejects changed quotations and incomplete edits, verifies model access without inference", async () => {
  const service = createVoiceService({
    key: "test-only",
    fetcher: async (url) =>
      url.includes("/models/")
        ? new Response(null, { status: 200 })
        : Response.json({
            status: "completed",
            output: [
              { content: [{ type: "output_text", text: 'Tôi nói "mới".' }] },
            ],
          }),
  });
  await assert.rejects(
    service.polish('Tôi nói "cũ".'),
    (err) => err.code === "VOICE_QUOTES",
  );
  assert.deepEqual(await service.verifyModels(), {
    configured: true,
    transcription: true,
    editing: true,
  });
  assert.deepEqual(await createVoiceService().verifyModels(), {
    configured: false,
    transcription: false,
    editing: false,
  });
});
test("authenticated-user quotas bound concurrent and hourly use", () => {
  const reserve = createVoiceLimiter();
  const a = reserve("a", "transcribe"),
    b = reserve("a", "polish");
  assert.throws(
    () => reserve("a", "transcribe"),
    (err) => err.status === 429,
  );
  a();
  b();
  for (let i = 1; i < 30; i++) reserve("a", "transcribe")();
  assert.throws(() => reserve("a", "transcribe"));
  reserve("b", "transcribe")();
});
test("voice HTTP routes enforce CORS, verified auth and size limits before AI", async (t) => {
  let calls = 0;
  const server = createResearchServer({
    allowedOrigins: ["https://app.example"],
    authenticate: async (token) => (token === "valid" ? { id: "a" } : null),
    voice: {
      transcribe: async (bytes, type) => {
        validateAudio(bytes, type);
        calls++;
        return { original: "Xin chào" };
      },
      polish: async (original) => {
        calls++;
        return { polished: original + "." };
      },
      suggestTitle: async () => {
        calls++;
        return { title: "Tiêu đề gợi ý" };
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/voice`;
  const headers = {
    authorization: "Bearer valid",
    origin: "https://app.example",
    "content-type": "audio/webm;codecs=opus",
  };
  assert.equal(
    (
      await fetch(base + "/transcribe", {
        method: "POST",
        headers: { ...headers, authorization: "" },
        body: webm,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/transcribe", {
        method: "POST",
        headers: { ...headers, authorization: "Bearer forged" },
        body: webm,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(base + "/transcribe", {
        method: "POST",
        headers: { ...headers, origin: "https://evil.example" },
        body: webm,
      })
    ).status,
    403,
  );
  const result = await fetch(base + "/transcribe", {
    method: "POST",
    headers,
    body: webm,
  });
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(await result.json(), { original: "Xin chào" });
  const polish = await fetch(base + "/polish", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ original: "Xin chào" }),
  });
  assert.deepEqual(await polish.json(), { polished: "Xin chào." });
  const title = await fetch(base + "/title", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ original: "Xin chào" }),
  });
  assert.deepEqual(await title.json(), { title: "Tiêu đề gợi ý" });
  assert.equal(
    (
      await fetch(base + "/transcribe", {
        method: "POST",
        headers,
        body: Buffer.alloc(MAX_AUDIO_BYTES + 1),
      })
    ).status,
    413,
  );
  assert.equal(calls, 3);
});
