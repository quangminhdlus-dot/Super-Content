import { expect, test } from "@playwright/test";

test.use({
  permissions: ["camera", "microphone"],
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("opens the script directly, adjusts the reader and saves a recoverable recording", async ({page, context}) => {
  test.setTimeout(60000);
  const requests = [];
  page.on("request", request => requests.push(request));
  await context.route("https://huggingface.co/**", route => route.abort());
  await context.route("**/prompter/sherpa-commercial-worker.js", route => route.fulfill({
    contentType: "application/javascript",
    body: 'self.onmessage=({data})=>self.postMessage({type:data.type==="load"?"ready":"result",text:"",processing_ms:0,seconds:0});',
  }));
  await context.addInitScript(() => {
    const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.inputs = [];
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await native(constraints);
      window.inputs.push({constraints, stream});
      return stream;
    };
  });
  await page.goto("./");
  await expect(page.locator(".page-heading h1")).toContainText("Kho ý tưởng");
  expect(requests.some(request => /\/prompter\/|prompter-.+\.(?:js|css)/.test(request.url()))).toBe(false);
  const original = "Mở đầu.\n\n**Giữ nguyên dấu, và chữ đậm!**";
  await page.evaluate(async script => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open("super-content-v1", 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const now = new Date().toISOString(), id = crypto.randomUUID();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("videos", "readwrite");
      const video = {id, title:"Kịch bản trước đây", stage:"filming", script, notes:"", postproduction_notes:"", source_url:"", created_at:now, updated_at:now};
      tx.objectStore("videos").put({key:"demo:" + id, scope:"demo", video, dirty:false});
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, original);
  await page.reload();
  await expect(page.locator('[data-view="filming"]')).toHaveCount(0);
  await page.locator('[data-view="script"]:visible').click();
  await page.getByRole("button", {name:/^Kịch bản trước đây/}).click();
  const latest = original + "\n\n" + "Câu cuối vừa được sửa. ".repeat(18).trim();
  await page.locator("#script").fill(latest);

  const inputs = () => page.evaluate(() => window.inputs.map(input => ({
    video:input.constraints.video, states:input.stream.getTracks().map(track=>track.readyState)
  })));
  await page.getByRole("button", {name:"Nhắc chữ không camera"}).click();
  const read = page.getByRole("dialog", {name:"Nhắc chữ", exact:true});
  await expect(read.getByTestId("reader").locator("strong")).toHaveText("Giữ nguyên dấu, và chữ đậm!");
  await expect.poll(async () => (await inputs()).length).toBe(1);
  expect((await inputs())[0].video).toBeUndefined();
  await read.getByRole("button", {name:"Về kịch bản"}).click();

  await page.getByRole("button", {name:"Quay với Prompter"}).click();
  const studio = page.getByRole("dialog", {name:"Quay với Prompter", exact:true});
  await expect(studio.getByTestId("reader").locator("strong")).toHaveText("Giữ nguyên dấu, và chữ đậm!");
  await expect(studio.getByTestId("reader")).toContainText("Câu cuối vừa được sửa.");
  await expect(studio.locator("iframe")).toHaveCount(0);
  await expect(studio.getByRole("button", {name:/Chuẩn bị camera/})).toHaveCount(0);
  const preview = studio.getByRole("button", {name:"Xem camera"});
  await expect(preview).toBeEnabled();
  const beforePreview = (await inputs()).length;
  await preview.click();
  await expect(studio.locator(".sc-p-camera-grid")).toBeVisible();
  await expect(studio.locator(".sc-p-camera-video")).toHaveCSS("transform", "none");
  await studio.getByRole("button", {name:"Đóng xem camera"}).click();
  expect((await inputs()).length).toBe(beforePreview);
  await studio.getByRole("button", {name:"Đổi camera"}).click();
  await expect(preview).toBeEnabled();
  expect((await inputs()).at(-1).video.facingMode.ideal).toBe("environment");

  const left = studio.getByRole("slider", {name:"Vị trí đọc bên trái"});
  const right = studio.getByRole("slider", {name:"Vị trí đọc bên phải"});
  await expect(left).toHaveAttribute("aria-valuenow", "0");
  const handle = await left.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 80, {steps:4});
  await page.mouse.up();
  const anchor = await left.getAttribute("aria-valuenow");
  expect(Number(anchor)).toBeGreaterThan(0);
  await expect(right).toHaveAttribute("aria-valuenow", anchor);
  await studio.getByRole("slider", {name:"Cỡ chữ"}).evaluate(node => {
    node.value = "46";
    node.dispatchEvent(new Event("input", {bubbles:true}));
  });
  await expect(studio.getByTestId("reader")).toHaveCSS("font-size", "46px");

  await studio.getByRole("button", {name:"Cài đặt", exact:true}).click();
  await expect(studio.getByRole("spinbutton", {name:"Đếm ngược"})).toHaveValue("3");
  await studio.getByRole("spinbutton", {name:"Đếm ngược"}).fill("1");
  await studio.getByRole("button", {name:"Đóng cài đặt"}).click();
  await expect(studio.getByRole("button", {name:"Theo giọng nói"})).toHaveAttribute("aria-pressed", "true");
  await studio.getByRole("button", {name:"Bắt đầu quay"}).click();
  await expect(studio.locator(".sc-p-count")).toHaveText("1");
  await expect(studio.locator(".sc-p-live")).toBeHidden();
  await expect(studio.getByRole("button", {name:"Dừng quay"})).toBeVisible();
  await expect(studio.locator(".sc-p-live")).toContainText("ĐANG QUAY");
  await expect(studio.locator(".sc-p-preview")).toBeHidden();
  const captureCount = (await inputs()).length;
  await studio.getByRole("button", {name:"Tốc độ cố định"}).click();
  await expect(studio.getByRole("slider", {name:"Tốc độ đọc"})).toBeVisible();
  await expect.poll(() => studio.locator(".sc-p-scroll").evaluate(node => node.scrollTop)).toBeGreaterThan(15);
  await studio.getByRole("button", {name:"Thủ công"}).click();
  await studio.locator(".sc-p-scroll").evaluate(node => {node.scrollTop += 100;});
  await expect(studio.getByRole("button", {name:"Dừng quay"})).toBeVisible();
  expect((await inputs()).length).toBe(captureCount);
  await expect(studio.locator(".sc-p-live")).toContainText(/0:0[2-9]/);
  await studio.getByRole("button", {name:"Dừng quay"}).click();
  await expect(studio.locator(".sc-p-review video")).toHaveAttribute("src", /^blob:/);

  await studio.getByRole("button", {name:"Video chưa lưu"}).click();
  await studio.getByRole("button", {name:"Đóng video chưa lưu"}).click();
  await studio.getByRole("button", {name:"Về kịch bản"}).click();
  await page.getByRole("button", {name:"Quay với Prompter"}).click();
  await expect(studio.getByTestId("reader")).toHaveCSS("font-size", "46px");
  await expect(studio.getByRole("slider", {name:"Vị trí đọc bên trái"})).toHaveAttribute("aria-valuenow", anchor);
  await studio.getByRole("button", {name:"Cài đặt", exact:true}).click();
  await studio.getByRole("button", {name:"Video chưa lưu (1)"}).click();
  await studio.getByRole("region", {name:"Video chưa lưu"}).locator("[data-p=draftList] button").click();
  await expect(studio.locator(".sc-p-review video")).toHaveAttribute("src", /^blob:/);
  await expect(studio.getByRole("button", {name:"Chuyển sang Hoàn thiện"})).toBeHidden();
  const downloading = page.waitForEvent("download");
  await studio.getByRole("button", {name:"Tải xuống"}).click();
  expect(await (await downloading).failure()).toBeNull();
  await studio.getByRole("button", {name:"Đã lưu trên thiết bị"}).click();
  await studio.getByRole("button", {name:"Chuyển sang Hoàn thiện"}).click();
  await expect(page.locator(".editor-heading .eyebrow")).toHaveText("Hoàn thiện");
  await expect(page.locator("#script")).toHaveValue(latest);
  expect(requests.some(request => request.method() === "POST" && /storage\/v1|prompter_scripts/.test(request.url()))).toBe(false);
});
