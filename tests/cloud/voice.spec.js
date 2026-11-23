import { test, expect } from "@playwright/test";

async function setup(page, { mp4 = false } = {}) {
  await page.route("**/voice-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html lang="vi"><head><meta charset="utf-8"></head><body><label>Tiêu đề<input id="video-title" value=""></label><label>Nội dung<textarea id="target">Đầu Cuối</textarea></label></body></html>',
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
      initVoice({
        authorize: async () => {},
        request: async (operation, body, signal) => {
          window.requests.push({
            operation,
            type: body?.type,
            size: body?.size,
          });
          if (signal.aborted) throw new Error("cancelled");
          if (operation === "transcribe") {
            if (window.failTranscribe) throw new Error("Mất mạng thử nghiệm");
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
async function record(page) {
  await open(page);
  await page
    .getByRole("button", { name: "Gửi bản ghi", exact: true })
    .click();
  await expect(page.locator("#voice-original")).toHaveValue("ừ nội dung gốc");
}
test("voice recorder attaches to content, never to a title field", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("button", { name: "Ghi âm cho Nội dung" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Ghi âm cho Tiêu đề/ })).toHaveCount(0);
  await expect(page.locator("#video-title + .voice-mic")).toHaveCount(0);
});

for (const mp4 of [false, true])
  test(`review ${mp4 ? "Safari MP4" : "Chrome WebM"}, explicit insertion, cursor and cancellation`, async ({
    page,
  }) => {
    await setup(page, { mp4 });
    await record(page);
    await expect(page.locator("#voice-polished")).toHaveValue(
      "Nội dung rõ ràng.",
    );
    await expect(page.locator("#target")).toHaveValue("Đầu Cuối");
    expect(await page.evaluate(() => window.changes)).toBe(0);
    expect(await page.evaluate(() => window.requests[0].type)).toBe(
      mp4 ? "audio/mp4" : "audio/webm;codecs=opus",
    );
    expect(await page.evaluate(() => window.stopped)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Đóng ghi âm", exact: true }).click();
    await expect(page.locator("#target")).toHaveValue("Đầu Cuối");
    expect(
      await page.locator("#target").evaluate((el) => el.selectionStart),
    ).toBe(4);
    await record(page);
    await page
      .getByRole("button", { name: "Chèn tại con trỏ", exact: true })
      .click();
    await expect(page.locator("#target")).toHaveValue(
      "Đầu Nội dung rõ ràng. Cuối",
    );
    expect(await page.evaluate(() => window.changes)).toBe(1);
    expect(
      await page.locator("#target").evaluate((el) => el.selectionStart),
    ).toBe(22);
  });
test("network retries keep audio; polish failure keeps original without transcribing twice; replace needs confirmation", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    window.failTranscribe = true;
  });
  await open(page);
  await page
    .getByRole("button", { name: "Gửi bản ghi", exact: true })
    .click();
  await expect(page.locator("#voice-status")).toContainText(
    "Mất mạng thử nghiệm",
  );
  await page.evaluate(() => {
    window.failTranscribe = false;
    window.failPolish = true;
  });
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.locator("#voice-status")).toContainText(
    "Lỗi biên tập thử nghiệm",
  );
  await expect(page.locator("#voice-original")).toHaveValue("ừ nội dung gốc");
  await page.evaluate(() => {
    window.failPolish = false;
  });
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.locator("#voice-polished")).toHaveValue(
    "Nội dung rõ ràng.",
  );
  expect(
    await page.evaluate(
      () => window.requests.filter((r) => r.operation === "transcribe").length,
    ),
  ).toBe(2);
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Thay thế toàn bộ ô", exact: true })
    .click();
  await expect(page.locator("#target")).toHaveValue("Đầu Cuối");
  await page.locator("#voice-version").selectOption("original");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Thay thế toàn bộ ô", exact: true })
    .click();
  await expect(page.locator("#target")).toHaveValue("ừ nội dung gốc");
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
  await page.getByRole("button", { name: "Gửi bản ghi" }).click();
  await expect(page.locator("#voice-polished")).toHaveValue(
    "Nội dung rõ ràng.",
  );
  await page.locator("#target").evaluate((el) => {
    el.value = "Bản mới từ đồng bộ";
  });
  await page
    .getByRole("button", { name: "Chèn tại con trỏ", exact: true })
    .click();
  await expect(page.locator("#voice-status")).toContainText(
    "Ô nội dung đã thay đổi",
  );
  await expect(page.locator("#target")).toHaveValue("Bản mới từ đồng bộ");
});
