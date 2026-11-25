
import { expect, test } from "@playwright/test";

test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("legacy script opens in Super Content, records locally and moves after save confirmation", async ({ page, context }) => {
  test.setTimeout(60000);
  const requests = [];
  page.on("request", (request) => requests.push(request));
  await context.route("https://huggingface.co/**", (route) => route.abort());
  // Keep the production media streams and recorder. Stub only model startup so CI never downloads weights.
  await context.route("**/prompter/sherpa-commercial-worker.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'self.onmessage=({data})=>self.postMessage({type:data.type==="load"?"ready":"result",text:"",processing_ms:0,seconds:0});',
    }),
  );
  await context.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.mediaRequests = [];
    navigator.mediaDevices.getUserMedia = (constraints) => {
      window.mediaRequests.push(constraints);
      return getUserMedia(constraints);
    };
  });
  await page.goto("./");
  await expect(page.locator(".page-heading h1")).toContainText("Kho ý tưởng");
  expect(requests.some((request) => request.url().includes("/prompter/"))).toBe(false);
  const original = "Mở đầu.\n\n**Giữ nguyên dấu, và chữ đậm!**";
  await page.evaluate(async (script) => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open("super-content-v1", 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const now = new Date().toISOString(), id = crypto.randomUUID();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("videos", "readwrite");
      const video = { id, title: "Kịch bản trước đây", stage: "filming", script, notes: "", postproduction_notes: "", source_url: "", created_at: now, updated_at: now };
      tx.objectStore("videos").put({ key: "demo:" + id, scope: "demo", video, dirty: false });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, original);
  await page.reload();

  await expect(page.locator('[data-view="filming"]')).toHaveCount(0);
  await page.locator('[data-view="script"]:visible').click();
  await page.getByRole("button", {name: /^Kịch bản trước đây/}).click();
  const latest = original + "\n\nCâu cuối vừa được sửa.";
  await page.locator("#script").fill(latest);
  await page.getByRole("button", {name: "Nhắc chữ không camera"}).click();
  const reader = page.frameLocator('iframe[title="Nhắc chữ"]');
  await expect(reader.getByTestId("reader").locator("strong")).toHaveText("Giữ nguyên dấu, và chữ đậm!");
  await expect(reader.getByTestId("reader")).toContainText("Câu cuối vừa được sửa.");
  await reader.getByRole("button", {name: /^Bắt đầu/}).first().click();
  const readerFrame = page.frames().find((frame) => frame.url().includes("/prompter/"));
  await expect.poll(() => readerFrame.evaluate(() => window.mediaRequests.length)).toBe(1);
  expect(await readerFrame.evaluate(() => window.mediaRequests[0].video)).toBeUndefined();
  await reader.getByRole("button", {name: "Về kịch bản"}).click();

  await page.getByRole("button", {name: "Quay với Prompter"}).click();
  const recorder = page.frameLocator('iframe[title="Quay với Prompter"]');
  await expect(recorder.locator(".record-script-tools")).toContainText("Kịch bản trước đây");
  await expect(recorder.getByTestId("reader").locator("strong")).toHaveText("Giữ nguyên dấu, và chữ đậm!");
  await expect(recorder.getByRole("combobox", {name: "Hướng quay"})).toHaveValue("portrait");
  await recorder.getByRole("button", {name: "Chuẩn bị camera và micro"}).click();
  await expect(recorder.locator(".camera-preview")).toHaveCSS("transform", "none");
  await expect(recorder.locator(".camera-grid i")).toHaveCount(4);
  await recorder.getByRole("button", {name: "Đổi sang camera sau"}).click();
  await expect(recorder.getByRole("button", {name: "Đổi sang camera trước"})).toBeEnabled();
  const recordingFrame = page.frames().find((frame) => frame.url().includes("/prompter/"));
  expect(await recordingFrame.evaluate(() => window.mediaRequests.at(-1).video.facingMode.ideal)).toBe("environment");
  await recorder.getByRole("button", {name: "Bắt đầu quay", exact: true}).click();
  await expect(recorder.getByRole("button", {name: "Dừng quay"})).toBeVisible({timeout:15000});
  await expect(recorder.locator(".camera-preview")).toHaveCount(0);
  await recorder.getByRole("button", {name: "Cỡ chữ / cài đặt"}).click();
  await expect(recorder.getByRole("slider", {name: "Vị trí dòng đang đọc"})).toBeVisible();
  await recorder.getByRole("button", {name: "Đóng cài đặt"}).click();
  await expect(recorder.locator(".record-bar [aria-live]")).toContainText(/0:0[2-9]/);
  await recorder.getByRole("button", {name: "Dừng quay"}).click();
  await expect(recorder.getByRole("dialog", {name: "Xem lại video"})).toBeVisible({timeout:15000});
  await expect(recorder.locator(".record-output video")).toHaveAttribute("src", /^blob:/);
  await recorder.getByRole("button", {name: "Giữ nháp và đóng"}).click();
  await recorder.getByRole("button", {name: "Về kịch bản"}).click();
  await page.getByRole("button", {name: "Quay với Prompter"}).click();
  await recorder.getByRole("button", {name: "Video chưa lưu (1)"}).click();
  await recorder.getByRole("button", {name: "Xem và xuất"}).click();
  await expect(recorder.locator(".record-output video")).toHaveAttribute("src", /^blob:/);
  await expect(recorder.getByRole("button", {name: "Chuyển sang Hoàn thiện"})).toHaveCount(0);
  await recorder.getByText("Cách lưu và thông số", {exact:true}).click();
  const downloading = page.waitForEvent("download");
  await recorder.getByRole("button", {name: "Lưu vào Tệp / tải xuống"}).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  await recorder.getByRole("button", {name: "Đã lưu video"}).click();
  await recorder.getByRole("button", {name: "Chuyển sang Hoàn thiện"}).click();
  await expect(page.locator(".editor-heading .eyebrow")).toHaveText("Hoàn thiện");
  await expect(page.locator("#script")).toHaveValue(latest);
  expect(requests.some((request) => request.method() === "POST" && /storage\/v1|prompter_scripts/.test(request.url()))).toBe(false);
});
