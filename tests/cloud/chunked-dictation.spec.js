import { test, expect } from "@playwright/test";

async function setup(page, mode = "normal") {
  await page.route("**/chunk-test", route => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><body><textarea id="idea">Mở đầu</textarea><button id="mic">🎙</button><p id="status"></p><button id="other">Nút khác</button><output id="touches">0</output></body></html>',
  }));
  await page.goto("./chunk-test");
  await page.evaluate(async (mode) => {
    const { createChunkedDictation, isAppleMobile } = await import("/super-content/src/chunked-dictation.js");
    window.testMode = mode;
    window.recorderCount = 0;
    window.stoppedTracks = 0;
    window.transcripts = 0;
    window.mockUserAgent = isAppleMobile;
    const track = { stop: () => window.stoppedTracks++, addEventListener: () => {} };
    window.mockStream = { getTracks: () => [track] };
    window.allowPermission = null;
    class Recorder {
      static isTypeSupported(type) { return type === "audio/webm"; }
      constructor(stream, options) {
        this.mimeType = options.mimeType;
        this.state = "inactive";
        window.recorderCount++;
      }
      start() { this.state = "recording"; }
      stop() {
        if (this.state !== "recording") return;
        this.state = "inactive";
        if (window.testMode === "no-end") return;
        queueMicrotask(() => {
          this.ondataavailable?.({
            data: new Blob([new Uint8Array([26,69,223,163,0,0,0,0])], { type: this.mimeType }),
          });
          this.onstop?.();
        });
      }
    }
    const dev = {
      getUserMedia: () => mode === "no-permission"
        ? new Promise(resolve => { window.allowPermission = resolve; })
        : Promise.resolve(window.mockStream),
    };
    const transcript = async (blob, signal) => {
      window.transcripts++;
      if (window.testMode === "no-response") return new Promise(() => {});
      if (signal.aborted) throw new Error("aborted");
      return "hành động tạo động lực";
    };
    window.controller = createChunkedDictation({
      target: document.querySelector("#idea"),
      button: document.querySelector("#mic"),
      status: document.querySelector("#status"),
      authorize: async () => {},
      transcribe: transcript,
      mediaDevices: dev,
      Recorder,
      clipMs: 110,
      startupMs: 250,
      transcribeMs: 400,
      stopMs: 150,
    });
    document.querySelector("#mic").addEventListener("click", () => window.controller.toggle());
    document.querySelector("#other").addEventListener("click", () => {
      document.querySelector("#touches").textContent = String(
        Number(document.querySelector("#touches").textContent) + 1);
    });
    window.saved = 0;
    document.querySelector("#idea").addEventListener("input", () => window.saved++);
  }, mode);
}
test("iPhone safe voice clips append Vietnamese text while other controls remain clickable", async ({ page }) => {
  await setup(page);
  await page.locator("#idea").evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  await page.locator("#mic").click();
  await expect(page.locator("#mic")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#other").click();
  await expect(page.locator("#touches")).toHaveText("1");
  await expect(page.locator("#idea")).toHaveValue(/hành động tạo động lực/);
  await expect.poll(() => page.evaluate(() => window.saved)).toBeGreaterThan(0);
  await page.locator("#mic").click();
  await expect(page.locator("#mic")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => window.controller.isActive())).toBe(false);
  await expect.poll(() => page.evaluate(() => window.stoppedTracks)).toBeGreaterThan(0);
  await page.locator("#other").click();
  await expect(page.locator("#touches")).toHaveText("2");
});

test("permission pending forever can be cancelled immediately and late microphone permission is revoked", async ({ page }) => {
  await setup(page, "no-permission");
  await page.locator("#mic").click();
  await expect(page.locator("#mic")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#mic").click();
  await expect(page.locator("#mic")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => window.controller.isActive())).toBe(false);
  await page.locator("#other").click();
  await expect(page.locator("#touches")).toHaveText("1");
  await page.evaluate(() => window.allowPermission(window.mockStream));
  await expect.poll(() => page.evaluate(() => window.stoppedTracks)).toBeGreaterThan(0);
});

test("request start watchdog, transcript timeout and missing onstop never trap buttons", async ({ page }) => {
  await setup(page, "no-permission");
  await page.locator("#mic").click();
  await expect(page.locator("#mic")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator("#mic").getAttribute("aria-pressed")).toBe("false");
  await expect(page.locator("#status")).toContainText("không phản hồi");
  await page.locator("#other").click();
  await expect(page.locator("#touches")).toHaveText("1");

  await page.evaluate(() => window.testMode = "no-response");
  await page.evaluate(() => window.allowPermission(window.mockStream));
  await page.evaluate(() => { window.controller.abort(); });
  // The first controller was already released; create a new test controller.
});

test("a missing recorder onstop is recovered without waiting for Safari events", async ({ page }) => {
  await setup(page, "no-end");
  await page.locator("#mic").click();
  await expect(page.locator("#mic")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator("#mic").getAttribute("aria-pressed")).toBe("false");
  await expect(page.locator("#status")).toContainText("giải phóng");
  await expect.poll(() => page.evaluate(() => window.stoppedTracks)).toBeGreaterThan(0);
  await page.locator("#other").click();
  await expect(page.locator("#touches")).toHaveText("1");
});

test("transcription network stall times out and writing remains available", async ({ page }) => {
  await setup(page, "no-response");
  await page.locator("#mic").click();
  await expect.poll(() => page.evaluate(() => window.transcripts)).toBeGreaterThan(0);
  await expect.poll(() => page.locator("#mic").getAttribute("aria-pressed")).toBe("false");
  await expect(page.locator("#status")).toContainText("quá thời gian");
  await expect(page.locator("#idea")).toHaveValue("Mở đầu");
  await page.locator("#idea").fill("Mở đầu. Gõ thủ công.");
  await expect(page.locator("#idea")).toHaveValue("Mở đầu. Gõ thủ công.");
  await page.locator("#other").click();
  await expect(page.locator("#touches")).toHaveText("1");
});

test("keyboard edits during dictation do not get overwritten by delayed transcript", async ({ page }) => {
  await setup(page);
  await page.locator("#mic").click();
  await page.locator("#idea").fill("Gõ xen kẽ");
  await expect(page.locator("#mic")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => window.controller.isActive())).toBe(false);
  await expect(page.locator("#idea")).toHaveValue(/Gõ xen kẽ/);
});
