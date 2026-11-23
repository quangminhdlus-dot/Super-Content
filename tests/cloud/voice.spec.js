import { test, expect } from "@playwright/test";

async function setup(page, { mp4 = false } = {}) {
  await page.route("**/voice-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html lang="vi"><head><meta charset="utf-8"><link rel="stylesheet" href="./src/styles.css"></head><body><label>Tiêu đề<input id="video-title" value=""></label><label>Nội dung<textarea id="target">Đầu Cuối</textarea></label></body></html>',
    }),
  );
  await page.goto("./voice-test");
  await page.evaluate(
    async ({ mp4 }) => {
      const { initVoice } = await import("/super-content/src/voice.js");
      window.requests = [];
      window.stopped = 0;
      window.failPolish = false;
      window.failTranscribe = false;
      window.deferTranscribe = false;
      window.denied = false;
      window.delayPermission = false;
      window.testStream = () => ({
        getTracks: () => [
          {
            stop: () => {
              window.stopped++;
            },
          },
        ],
        getAudioTracks: () => [],
      });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            if (window.denied)
              throw new DOMException("denied", "NotAllowedError");
            if (window.delayPermission)
              return new Promise((resolve) => {
                window.grantPermission = () => resolve(window.testStream());
              });
            return window.testStream();
          },
        },
      });
      window.MediaRecorder = class {
        static isTypeSupported(type) {
          return mp4 ? type === "audio/mp4" : type.startsWith("audio/webm");
        }
        constructor(stream, options) {
          this.mimeType = options.mimeType;
          this.state = "inactive";
        }
        start() {
          this.state = "recording";
        }
        pause() {
          if (this.state === "recording") this.state = "paused";
        }
        resume() {
          if (this.state === "paused") this.state = "recording";
        }
        stop() {
          if (this.state === "inactive") return;
          this.state = "inactive";
          queueMicrotask(() => {
            this.ondataavailable?.({
              data: new Blob(
                [
                  mp4
                    ? new Uint8Array([
                        0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109,
                      ])
                    : new Uint8Array([26, 69, 223, 163, 0, 0, 0, 0]),
                ],
                { type: this.mimeType },
              ),
            });
            this.onstop?.();
          });
        }
      };
      window.voiceApi = initVoice({
        authorize: async () => {},
        onQuickTranscript: async (text) => {
          window.quickSavedText = text;
          return "saved-idea-1";
        },
        onQuickPolished: async (_id, _original, polished) => {
          window.quickPolishedText = polished;
        },
        onQuickClosed: (id) => { window.quickClosedId = id; },
        request: async (operation, body, signal) => {
          window.requests.push({
            operation,
            type: body?.type,
            size: body?.size,
          });
          if (signal.aborted) throw new Error("cancelled");
          if (operation === "transcribe") {
            if (window.failTranscribe) throw new Error("Mất mạng thử nghiệm");
            if (window.deferTranscribe) {
              await new Promise((resolve) => { window.resumeTranscribe = resolve; });
            }
            return "ừ nội dung gốc";
          }
          if (window.failPolish) throw new Error("Lỗi biên tập thử nghiệm");
          return "Nội dung rõ ràng.";
        },
      });
      window.changes = 0;
      document.querySelector("#target").addEventListener("input", () => {
        window.changes++;
      });
    },
    { mp4 },
  );
}
async function open(page) {
  const requestCount = await page.evaluate(() => window.requests.length);
  await page.locator("#target").evaluate((el) => {
    el.focus();
    el.setSelectionRange(4, 4);
  });
  await page
    .getByRole("button", { name: "Ghi âm cho Nội dung", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Gửi bản ghi", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ghi lại", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Tạm dừng" }).click();
  await expect(page.locator("#voice-dialog")).toHaveAttribute("data-voice-phase", "paused");
  await expect(page.getByRole("button", { name: "Tiếp tục" })).toBeVisible();
  expect(await page.evaluate(() => window.requests.length)).toBe(requestCount);
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await expect(page.locator("#voice-dialog")).toHaveAttribute("data-voice-phase", "recording");
}
async function record(page, { expectSuccess = true } = {}) {
  await open(page);
  await page
    .getByRole("button", { name: "Gửi bản ghi", exact: true })
    .click();
  if (expectSuccess) {
    await expect(page.locator("#target")).toHaveValue("Đầu Nội dung rõ ràng. Cuối");
  }
}

test("Send shows ONLY compact animated saving icon and cannot be dismissed while processing", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.deferTranscribe = true; });
  await open(page);
  await page.getByRole("button", { name: "Gửi bản ghi", exact: true }).click();
  const panel = page.locator("#voice-dialog");
  await expect(panel).toHaveAttribute("data-voice-phase", "processing");
  await expect(panel.locator(".voice-saving-indicator")).toBeVisible();
  await expect(panel.locator(".voice-saving-spinner")).toBeVisible();
  await expect(panel.locator(".voice-heading")).toBeHidden();
  await expect(panel.locator("#voice-status")).toBeHidden();
  await expect(panel.locator(".voice-disclosure")).toBeHidden();
  await expect(panel.locator('[data-voice="cancel"]')).toBeHidden();
  const box = await panel.boundingBox();
  expect(box.width).toBeLessThan(140);
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await page.evaluate(() => { window.resumeTranscribe(); });
  await expect(panel).toHaveCount(0);
});

test("Quick idea Send uses the same compact processing UI until saved", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.deferTranscribe = true; });
  await page.evaluate(() => window.voiceApi.open(document.querySelector("#target"), { quick: true }));
  await expect(page.getByRole("button", { name: "Gửi bản ghi" })).toBeVisible();
  await page.getByRole("button", { name: "Gửi bản ghi" }).click();
  const panel = page.locator("#voice-dialog");
  await expect(panel).toHaveAttribute("data-voice-phase", "processing");
  await expect(panel.locator(".voice-saving-indicator")).toBeVisible();
  await expect(panel.locator(".voice-heading")).toBeHidden();
  await expect(panel.locator('[data-voice="cancel"]')).toBeHidden();
  await page.evaluate(() => window.resumeTranscribe());
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => window.quickSavedText)).toBe("ừ nội dung gốc");
  expect(await page.evaluate(() => window.quickClosedId)).toBe("saved-idea-1");
});

test("voice recorder attaches to content, never to a title field", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("button", { name: "Ghi âm cho Nội dung" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Ghi âm cho Tiêu đề/ })).toHaveCount(0);
  await expect(page.locator("#video-title + .voice-mic")).toHaveCount(0);
});

for (const mp4 of [false, true])
  test(`Send immediately inserts polished content ${mp4 ? "Safari MP4" : "Chrome WebM"}`, async ({ page }) => {
    await setup(page, { mp4 });
    await record(page);
    await expect(page.locator("#voice-dialog")).toHaveCount(0);
    await expect(page.locator("#target")).toHaveValue("Đầu Nội dung rõ ràng. Cuối");
    expect(await page.evaluate(() => window.changes)).toBe(1);
    expect(await page.evaluate(() => window.requests[0].type)).toBe(
      mp4 ? "audio/mp4" : "audio/webm;codecs=opus",
    );
    expect(await page.evaluate(() => window.stopped)).toBeGreaterThan(0);
  });

test("retry uses the original transcript without retranscribing after polish failure", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { window.failPolish = true; });
  await record(page, { expectSuccess: false });
  await expect(page.locator("#voice-status")).toContainText("Lỗi biên tập thử nghiệm");
  await expect(page.locator("#voice-original")).toHaveValue("ừ nội dung gốc");
  await page.evaluate(() => { window.failPolish = false; });
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.locator("#voice-dialog")).toHaveCount(0);
  await expect(page.locator("#target")).toHaveValue("Đầu Nội dung rõ ràng. Cuối");
  expect(await page.evaluate(() =>
    window.requests.filter(r => r.operation === "transcribe").length)).toBe(1);
});

test("replacing editor DOM during recording never asks to discard unsent audio", async ({ page }) => {
  await setup(page);
  await open(page);
  await page.evaluate(() => {
    window.unexpectedDiscardPrompts = 0;
    window.confirm = () => {
      window.unexpectedDiscardPrompts++;
      return false;
    };
    document.querySelector("#target").remove();
  });
  await expect(page.locator("#voice-dialog")).toHaveAttribute("data-voice-phase", "recording");
  expect(await page.evaluate(() => window.unexpectedDiscardPrompts)).toBe(0);
  await page.getByRole("button", { name: "Gửi bản ghi" }).click();
  await expect(page.locator("#voice-original")).toHaveValue("ừ nội dung gốc");
  await expect(page.locator("#voice-status")).toContainText("Ô nội dung đã thay đổi", { timeout: 1_500 }).catch(() => {});
  // The transcript stays available in the dialog for copying even though the editor changed.
  await expect(page.locator("#voice-original")).toHaveValue("ừ nội dung gốc");
  await page.getByRole("button", { name: "Đóng ghi âm" }).click();
});
test("delete X discards recording without sending or inserting it", async ({ page }) => {
  await setup(page);
  await open(page);
  await page.getByRole("button", { name: "Xóa bản ghi" }).click();
  await expect(page.locator("#voice-dialog")).toHaveCount(0);
  expect(await page.evaluate(() => window.requests.length)).toBe(0);
  await expect(page.locator("#target")).toHaveValue("Đầu Cuối");
});
test("denied microphone, pending permission cancellation, automatic stop and concurrent edits are safe", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    window.denied = true;
  });
  await page
    .getByRole("button", { name: "Ghi âm cho Nội dung", exact: true })
    .click();
  await expect(page.locator("#voice-status")).toContainText(
    "Chưa được cấp quyền micro",
  );
  await page.evaluate(() => {
    window.denied = false;
    window.delayPermission = true;
  });
  await page.getByRole("button", { name: "Ghi lại", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => typeof window.grantPermission))
    .toBe("function");
  await page.getByRole("button", { name: "Đóng ghi âm", exact: true }).click();
  await page.evaluate(() => {
    window.grantPermission();
    window.delayPermission = false;
  });
  await expect
    .poll(() => page.evaluate(() => window.stopped))
    .toBeGreaterThan(0);
  await page.clock.install();
  await open(page);
  await page.clock.fastForward(600001);
  await expect(page.locator("#voice-dialog")).toHaveAttribute("data-voice-phase", "ready");
  await expect(page.getByRole("button", { name: "Gửi bản ghi" })).toBeVisible();
  await page.locator("#target").evaluate((el) => {
    el.value = "Bản mới từ đồng bộ";
  });
  await page.getByRole("button", { name: "Gửi bản ghi" }).click();
  await expect(page.locator("#voice-status")).toContainText("Nội dung đã thay đổi");
  await expect(page.locator("#target")).toHaveValue("Bản mới từ đồng bộ");
  await expect(page.locator("#voice-polished")).toHaveValue("Nội dung rõ ràng.");
});
