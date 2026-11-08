import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { repository } from "./repository.js";
import { runScan } from "./scan.js";
import { ResearchError } from "./validation.js";
export function createResearchServer({
  authenticate,
  scan,
  allowedOrigins = [],
}) {
  const attempts = new Map();
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
      return reply(200, { service: "Super Content Research", status: "ok" });
    if (req.url !== "/api/research/scan" || req.method !== "POST")
      return reply(404, { error: "Không tìm thấy API." });
    const ip = req.socket.remoteAddress,
      now = Date.now();
    let limit = attempts.get(ip);
    if (!limit || now - limit.start >= 60000) limit = { start: now, count: 0 };
    limit.count++;
    attempts.set(ip, limit);
    if (attempts.size > 10000) attempts.delete(attempts.keys().next().value);
    if (limit.count > 80)
      return reply(429, {
        code: "REQUEST_LIMIT",
        error: "Quá nhiều yêu cầu. Thử lại sau một phút.",
      });
    // No user-supplied query or arbitrary fetch URL. Settings come from the authenticated account.
    req.resume();
    const token = req.headers.authorization?.match(
      /^Bearer (\S{1,8192})$/,
    )?.[1];
    if (!token) return reply(401, { error: "Vui lòng đăng nhập." });
    try {
      const user = await authenticate(token);
      if (!user?.id)
        throw new ResearchError("AUTH", "Phiên đăng nhập không hợp lệ.", 401);
      reply(200, await scan(user));
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
    const server = createResearchServer({
      allowedOrigins: RESEARCH_ALLOWED_ORIGINS.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      authenticate: async (token) => {
        const { data, error } = await admin.auth.getUser(token);
        if (error)
          throw new ResearchError("AUTH", "Phiên hết hạn. Đăng nhập lại.", 401);
        return data.user;
      },
      scan: (user) =>
        runScan(repository(admin, user.id), {
          youtubeKey: YOUTUBE_API_KEY,
          openaiKey: OPENAI_API_KEY,
          openaiModel: OPENAI_MODEL,
        }),
    });
    server.requestTimeout = 100000;
    server.headersTimeout = 10000;
    server.listen(Number(PORT) || 8787, "0.0.0.0", () =>
      console.log("Super Content Research API started."),
    );
  }
}
