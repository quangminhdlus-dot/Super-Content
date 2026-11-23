import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { repository } from "./repository.js";
import { personalRepository } from "./personal-repository.js";
import { startResearchJob, stepResearchJob } from "./jobs.js";
import { ResearchError } from "./validation.js";
import { createVoiceService, createVoiceLimiter } from "./voice.js";
import { MAX_AUDIO_BYTES } from "../shared/voice.js";
export function createResearchServer({
  authenticate,
  scan,
  jobs,
  voice,
  allowedOrigins = [],
  version = process.env.RENDER_GIT_COMMIT || null,
}) {
  const attempts = new Map();
  const reserveVoice = createVoiceLimiter();
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const reply = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (origin && !allowedOrigins.includes(origin))
      return reply(403, {
        code: "ORIGIN",
        error: "Nguồn truy cập không được phép.",
      });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader(
        "Access-Control-Allow-Headers",
        "authorization, content-type",
      );
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === "/health" && req.method === "GET")
      return reply(200, {
        service: "Super Content Research",
        status: "ok",
        version,
        voice: { configured: voice?.configured === true },
      });
    const voiceOperation =
      req.url === "/api/voice/transcribe"
        ? "transcribe"
        : req.url === "/api/voice/polish"
          ? "polish"
          : req.url === "/api/voice/title"
            ? "title"
            : null;
    const step = req.url?.match(
      /^\/api\/research\/jobs\/([0-9a-f-]{36})\/step$/,
    );
    if (
      (!["/api/research/scan", "/api/research/jobs"].includes(req.url) &&
        !step &&
        !voiceOperation) ||
      req.method !== "POST"
    )
      return reply(404, { error: "Không tìm thấy API." });
    const ip = req.socket.remoteAddress,
      now = Date.now();
    let limit = attempts.get(ip);
    if (!limit || now - limit.start >= 60000) limit = { start: now, count: 0 };
    limit.count++;
    attempts.set(ip, limit);
    if (attempts.size > 10000) attempts.delete(attempts.keys().next().value);
    if (limit.count > 300)
      return reply(429, {
        code: "REQUEST_LIMIT",
        error: "Quá nhiều yêu cầu. Thử lại sau một phút.",
      });
    // No user-supplied query or arbitrary fetch URL. Settings come from the authenticated account.

    const token = req.headers.authorization?.match(
      /^Bearer (\S{1,8192})$/,
    )?.[1];
    if (!token) return reply(401, { error: "Vui lòng đăng nhập." });
    try {
      const user = await authenticate(token);
      if (!user?.id)
        throw new ResearchError("AUTH", "Phiên đăng nhập không hợp lệ.", 401);
      if (voiceOperation) {
        if (!voice)
          throw new ResearchError(
            "VOICE_CONFIG",
            "Ghi âm AI chưa được bật trên máy chủ.",
            503,
          );
        const release = reserveVoice(user.id, voiceOperation);
        const controller = new AbortController();
        const disconnect = () => {
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", disconnect);
        try {
          const maximum =
            voiceOperation === "transcribe" ? MAX_AUDIO_BYTES : 131072;
          if (Number(req.headers["content-length"]) > maximum) {
            req.resume();
            throw new ResearchError(
              "BODY_LIMIT",
              "Đoạn ghi quá lớn. Ghi từng đoạn tối đa 2 phút / 8 MB.",
              413,
            );
          }
          let bytes = 0;
          const chunks = [];
          for await (const chunk of req.iterator({ destroyOnReturn: false })) {
            bytes += chunk.length;
            if (bytes > maximum) {
              req.resume();
              throw new ResearchError(
                "BODY_LIMIT",
                "Đoạn ghi vượt quá giới hạn tải lên.",
                413,
              );
            }
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks);
          let result;
          if (voiceOperation === "transcribe")
            result = await voice.transcribe(
              body,
              req.headers["content-type"],
              controller.signal,
            );
          else {
            if (
              req.headers["content-type"]?.split(";")[0] !== "application/json"
            )
              throw new ResearchError("BODY_JSON", "Cần dữ liệu JSON.", 415);
            let input;
            try {
              input = JSON.parse(body.toString("utf8"));
            } catch {
              throw new ResearchError(
                "BODY_JSON",
                "Dữ liệu biên tập không hợp lệ.",
              );
            }
            result = voiceOperation === "title"
              ? await voice.suggestTitle(input?.original, controller.signal)
              : await voice.polish(input?.original, controller.signal);
          }
          if (!controller.signal.aborted) reply(200, result);
        } finally {
          res.off("close", disconnect);
          release();
        }
        return;
      }
      if (jobs) {
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          bytes += chunk.length;
          if (bytes > 131072) {
            req.resume();
            throw new ResearchError("BODY_LIMIT", "Yêu cầu quá lớn.", 413);
          }
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks).toString("utf8");
        let input;
        try {
          input = body ? JSON.parse(body) : {};
        } catch {
          throw new ResearchError("BODY_JSON", "Dữ liệu yêu cầu không hợp lệ.");
        }
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new ResearchError(
            "JOB_INPUT",
            "Dữ liệu job phải là một đối tượng JSON.",
          );
        reply(
          200,
          step ? await jobs.step(user, step[1]) : await jobs.start(user, input),
        );
      } else reply(200, await scan(user));
    } catch (error) {
      const safe =
        error instanceof ResearchError
          ? error
          : new ResearchError(
              "SERVER_ERROR",
              "Máy chủ chưa hoàn tất yêu cầu.",
              503,
            );
      console.warn(
        JSON.stringify({
          event: "research_request_failed",
          code: safe.code,
          status: safe.status,
        }),
      );
      reply(safe.status, { code: safe.code, error: safe.message });
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    YOUTUBE_API_KEY,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    RESEARCH_ALLOWED_ORIGINS,
    PORT,
  } = process.env;
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !RESEARCH_ALLOWED_ORIGINS
  ) {
    console.error(
      "Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEARCH_ALLOWED_ORIGINS on the server.",
    );
    process.exitCode = 1;
  } else {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init = {}) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
      },
    });
    const voice = createVoiceService({
      key: OPENAI_API_KEY,
      transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL,
      editModel: process.env.OPENAI_VOICE_EDIT_MODEL,
    });
    const server = createResearchServer({
      voice,
      allowedOrigins: RESEARCH_ALLOWED_ORIGINS.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      authenticate: async (token) => {
        const { data, error } = await admin.auth.getUser(token);
        if (error)
          throw new ResearchError("AUTH", "Phiên hết hạn. Đăng nhập lại.", 401);
        return data.user;
      },
      jobs: {
        start: (user, input) =>
          startResearchJob(
            repository(admin, user.id),
            personalRepository(admin, user.id),
            input,
          ),
        step: (user, id) =>
          stepResearchJob(
            repository(admin, user.id),
            personalRepository(admin, user.id),
            id,
            {
              youtubeKey: YOUTUBE_API_KEY,
              openaiKey: OPENAI_API_KEY,
              openaiModel: OPENAI_MODEL,
            },
          ),
      },
    });
    server.requestTimeout = 100000;
    server.headersTimeout = 10000;
    server.listen(Number(PORT) || 8787, "0.0.0.0", () => {
      console.log("Super Content Research API started.");
      // Metadata reads cost no inference tokens; log only boolean readiness, never secrets.
      voice
        .verifyModels()
        .then((ready) =>
          console.log(JSON.stringify({ event: "voice_readiness", ...ready })),
        );
    });
  }
}
