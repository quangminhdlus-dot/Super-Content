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
    let ratio = 9 / 16;
    window.attempts = [];
    const old = JSON.parse(localStorage.getItem("super-content:prompter") || "{}");
    if (old.mic === undefined) localStorage.setItem("super-content:prompter", JSON.stringify({...old, mic:"expired", framing:"landscape"}));
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.attempts.push(constraints);
      ratio = constraints.video?.aspectRatio?.ideal ?? ratio;
      if (constraints.audio?.deviceId?.ideal === "expired") {
        throw Object.assign(new DOMException("Stale input", "OverconstrainedError"), {constraint:"deviceId"});
      }
      if (constraints.video?.width && !window.inputs.some(input => input.constraints.video)) {
        throw Object.assign(new DOMException("Sensor dimensions", "OverconstrainedError"), {constraint:"width"});
      }
      const stream = await native(constraints);
      if (constraints.video) {
        for (const video of stream.getVideoTracks()) { video.stop(); stream.removeTrack(video); }
        const canvas = document.createElement("canvas");
        const wide = ratio > 1;
        canvas.width = wide ? 640 : 360;
        canvas.height = wide ? 360 : 640;
        const paint = canvas.getContext("2d");
        paint.fillStyle = "#26a471";
        paint.fillRect(0,0,canvas.width,canvas.height);
        const [track] = canvas.captureStream(24).getVideoTracks();
        const timer = setInterval(() => {
          if (track.readyState === "ended") return clearInterval(timer);
          paint.fillRect(0,0,canvas.width,canvas.height);
        }, 40);
        stream.addTrack(track);
      }
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
  await expect(read.locator(".sc-p-backdrop")).toBeHidden();
  await read.getByRole("button", {name:"Cài đặt", exact:true}).click();
  await expect(read.getByRole("slider", {name:"Độ phủ đen của camera"})).toBeHidden();
  await read.getByRole("button", {name:"Đóng cài đặt"}).click();
  await expect.poll(async () => (await inputs()).length).toBe(1);
  expect((await inputs())[0].video).toBe(false);
  expect(await page.evaluate(() => window.attempts.slice(0,2).map(item => item.audio.deviceId))).toEqual([{ideal:"expired"}, undefined]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("super-content:prompter")).mic)).toBe("");
  await read.getByRole("button", {name:"Về kịch bản"}).click();
  await page.evaluate(() => { const key = "super-content:prompter"; localStorage.setItem(key, JSON.stringify({...JSON.parse(localStorage.getItem(key)), mic:"expired"})); });

  await page.getByRole("button", {name:"Quay với Prompter"}).click();
  const studio = page.getByRole("dialog", {name:"Quay với Prompter", exact:true});
  await expect(studio.getByTestId("reader").locator("strong")).toHaveText("Giữ nguyên dấu, và chữ đậm!");
  await expect(studio.getByTestId("reader")).toContainText("Câu cuối vừa được sửa.");
  await expect(studio.locator("iframe")).toHaveCount(0);
  await expect(studio.getByRole("button", {name:/Chuẩn bị camera/})).toHaveCount(0);
  const preview = studio.getByRole("button", {name:"Xem camera"});
  await expect(preview).toBeEnabled();
  const beforePreview = (await inputs()).length;
  await expect.poll(() => studio.locator(".sc-p-camera-video").evaluate(video => [video.videoWidth,video.videoHeight])).toEqual([360,640]);
  const cameraVideo = studio.locator(".sc-p-camera-video");
  const blackout = studio.locator(".sc-p-blackout");
  const settings = studio.getByRole("button", {name:"Cài đặt", exact:true});
  const closeSettings = studio.getByRole("button", {name:"Đóng cài đặt"});
  const cover = studio.getByRole("slider", {name:"Độ phủ đen của camera"});
  const setCover = value => cover.evaluate((node, value) => {
    node.value = String(value);
    node.dispatchEvent(new Event("input", {bubbles:true}));
  }, value);
  await expect(blackout).toHaveCSS("opacity", "0.9");
  await expect(cameraVideo).toHaveCSS("object-fit", "cover");
  await expect(cameraVideo).toHaveCSS("opacity", "1");
  await expect(blackout).toHaveCSS("pointer-events", "none");
  expect(await blackout.boundingBox()).toEqual(await cameraVideo.boundingBox());
  await settings.click();
  for (const level of [0, 50, 90, 100, 50]) {
    await setCover(level);
    await expect(blackout).toHaveCSS("opacity", String(level / 100));
    await expect(studio.locator("[data-p=coverValue]")).toHaveText(level + "%");
  }
  await closeSettings.click();
  expect((await inputs()).length).toBe(beforePreview);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("super-content:prompter")).mic)).toBe("");
  await preview.click();
  await expect(studio.locator(".sc-p-camera-grid")).toBeVisible();
  await expect(studio.locator(".sc-p-camera-video")).toHaveCSS("transform", "none");
  await studio.getByRole("button", {name:"Đóng xem camera"}).click();
  expect((await inputs()).length).toBe(beforePreview);
  const microphone = await page.evaluateHandle(() => window.inputs.at(-1).stream.getAudioTracks()[0]);
  const front = await page.evaluateHandle(() => window.inputs.at(-1).stream.getVideoTracks()[0]);
  await studio.getByRole("button", {name:"Đổi camera"}).click();
  await expect(preview).toBeEnabled();
  expect((await inputs()).at(-1).video.facingMode.ideal).toBe("environment");
  expect(await page.evaluate(() => window.inputs.at(-1).constraints.audio)).toBe(false);
  expect(await microphone.evaluate(track => track.readyState)).toBe("live");
  expect(await front.evaluate(track => track.readyState)).toBe("ended");
  await expect(studio.getByRole("button", {name:"Thử lại"})).toBeHidden();
  await expect(blackout).toHaveCSS("opacity", "0.5");

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
  await settings.click();
  await setCover(100);
  await expect(blackout).toHaveCSS("opacity", "1");
  await closeSettings.click();
  await expect(studio.locator(".sc-p-live")).toContainText("ĐANG QUAY");
  await studio.getByRole("button", {name:"Tốc độ cố định"}).click();
  await expect(studio.getByRole("slider", {name:"Tốc độ đọc"})).toBeVisible();
  await expect.poll(() => studio.locator(".sc-p-scroll").evaluate(node => node.scrollTop)).toBeGreaterThan(15);
  await studio.getByRole("button", {name:"Thủ công"}).click();
  await studio.locator(".sc-p-scroll").evaluate(node => {node.scrollTop += 100;});
  await expect(studio.getByRole("button", {name:"Dừng quay"})).toBeVisible();
  expect((await inputs()).length).toBe(captureCount);
  await expect(studio.locator(".sc-p-live")).toContainText(/0:0[2-9]/);
  await studio.getByRole("button", {name:"Dừng quay"}).click();
  const recorded = studio.locator(".sc-p-review video");
  await expect(recorded).toHaveAttribute("src", /^blob:/);
  await expect(studio.locator("[data-p=reviewOrientation]")).toHaveText("Dọc 9:16 · 360×640");
  await expect.poll(() => recorded.evaluate(video => video.readyState >= 2 && video.videoWidth > 0)).toBe(true);
  await recorded.evaluate(async video => { video.muted = true; await video.play(); });
  await expect.poll(() => recorded.evaluate(video => video.currentTime)).toBeGreaterThan(.3);
  const light = await recorded.evaluate(video => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, 32, 32);
    const rgba = context.getImageData(0, 0, 32, 32).data;
    return rgba.filter((channel, index) => index % 4 !== 3 && channel > 40).length;
  });
  expect(light).toBeGreaterThan(0);


  await expect(studio.locator("[data-p=reviewTitle]")).toHaveText("1. Kịch bản trước đây");
  await expect(studio.getByRole("button", {name:"Chuyển sang Hoàn thiện"})).toBeVisible();
  await studio.getByRole("button", {name:"Kho Video"}).click();
  const library = page.locator(".video-library");
  const player = page.locator(".library-player");
  const rows = library.locator(".video-library-row");
  const videoTab = page.locator('[data-view="video"]:visible');
  await expect(videoTab).toHaveAttribute("aria-current","page");
  const navigation = page.locator(".mobile-nav:visible");
  if (await navigation.count()) {
    await expect(navigation.locator("button.nav-item")).toHaveCount(5);
    expect(await navigation.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await expect(rows).toHaveCount(1);
  expect((await inputs()).every(input => input.states.every(state => state === "ended"))).toBe(true);
  const inputsBeforeReview = (await inputs()).length;
  await rows.first().getByRole("button", {name:"Xem lại"}).click();
  await expect(player.locator("video")).toHaveAttribute("src", /^blob:/);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", {configurable:true, value:() => true});
    Object.defineProperty(navigator, "share", {configurable:true, value:async () => { throw new DOMException("Hủy","AbortError"); }});
  });
  await player.getByRole("button", {name:"Lưu vào iPhone"}).click();
  await expect(player.locator("[data-message]")).toHaveText("Đã hủy chia sẻ.");
  await expect(player.getByRole("button", {name:"Đã lưu trên thiết bị"})).toBeHidden();
  const downloading = page.waitForEvent("download");
  await player.getByRole("button", {name:"Lưu vào Tệp / tải xuống"}).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/^1\. Kịch bản trước đây\.(mp4|webm)$/);
  await player.getByRole("button", {name:"Đã lưu trên thiết bị"}).click();
  await expect(player.locator("[data-message]")).toContainText("vẫn nằm trong Kho Video");
  await player.getByRole("button", {name:"Về danh sách"}).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Đã xác nhận lưu");
  expect((await inputs()).length).toBe(inputsBeforeReview);

  async function take(rename, chooseLandscape = false) {
    await page.locator('[data-view="script"]:visible').click();
    await page.locator(".video-main").first().click();
    if (rename) await page.locator("#video-title").fill(rename);
    await page.getByRole("button", {name:"Quay với Prompter"}).click();
    await expect(studio.getByTestId("reader")).toHaveCSS("font-size", "46px");
    await expect(preview).toBeEnabled();
    if (chooseLandscape) {
      await settings.click();
      await expect(studio.getByLabel("Hướng quay")).toHaveValue("portrait");
      await studio.getByLabel("Hướng quay").selectOption("landscape");
      await closeSettings.click();
    }
    await expect.poll(() => cameraVideo.evaluate(video => [video.videoWidth,video.videoHeight])).toEqual([640,360]);
    await studio.getByRole("button", {name:"Bắt đầu quay"}).click();
    await expect(studio.locator(".sc-p-live")).toContainText(/0:0[1-9]/);
    await studio.getByRole("button", {name:"Dừng quay"}).click();
    await expect(studio.locator(".sc-p-review video")).toHaveAttribute("src", /^blob:/);
    await expect(studio.locator("[data-p=reviewOrientation]")).toHaveText("Ngang 16:9 · 640×360");
    await studio.getByRole("button", {name:"Kho Video"}).click();
  }

  await take("Tiêu đề mới", true);
  await expect(rows.locator(".clip-title")).toHaveText(["2. Tiêu đề mới","1. Kịch bản trước đây"]);
  const dialogPromise = page.waitForEvent("dialog");
  const deleteAction = rows.first().getByRole("button", {name:"Xóa",exact:true}).click();
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain("2. Tiêu đề mới");
  await dialog.accept();
  await deleteAction;
  await expect(rows.locator(".clip-title")).toHaveText(["1. Kịch bản trước đây"]);
  await page.reload();
  await videoTab.click();
  await expect(rows.locator(".clip-title")).toHaveText(["1. Kịch bản trước đây"]);
  await take();
  await expect(rows.locator(".clip-title")).toHaveText(["3. Tiêu đề mới","1. Kịch bản trước đây"]);
  await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("super-prompter-recordings");
    let example;
    for await (const dir of root.values()) {
      if (dir.kind !== "directory") continue;
      const meta = JSON.parse(await (await (await dir.getFileHandle("manifest.json")).getFile()).text());
      if (meta.take === 3) { example = {dir, meta}; break; }
    }
    const sample = await (await example.dir.getFileHandle("0.chunk")).getFile();
    async function add(owner, title) {
      const id = crypto.randomUUID();
      const dir = await root.getDirectoryHandle(id,{create:true});
      async function write(name, value) {
        const handle = await dir.getFileHandle(name,{create:true});
        const writer = await handle.createWritable();
        await writer.write(value);
        await writer.close();
      }
      await write("0.chunk",sample);
      const old = {...example.meta,id,owner,title,take:undefined,created:"2026-11-20T01:00:00Z",chunks:0,bytes:0,complete:false};
      await write("manifest.json",JSON.stringify(old));
    }
    await add("demo",undefined);
    await add("a-different-account","Không được hiện");
    navigator.storage.estimate = async () => ({quota:64*1024*1024,usage:32*1024*1024});
  });
  await page.locator('[data-view="script"]:visible').click();
  await page.locator(".video-main").first().click();
  await page.getByRole("button", {name:"Quay với Prompter"}).click();
  await expect(preview).toBeEnabled();
  await expect.poll(() => cameraVideo.evaluate(video => video.videoWidth)).toBe(640);
  await cameraVideo.evaluate(video => {
    Object.defineProperty(video,"videoWidth",{configurable:true,value:360});
    Object.defineProperty(video,"videoHeight",{configurable:true,value:640});
    video.dispatchEvent(new Event("resize"));
  });
  await expect(studio.locator("[data-p=status]")).toContainText("Camera đang hiển thị Dọc 9:16");
  await expect(studio.getByRole("button", {name:"Bắt đầu quay"})).toBeDisabled();
  await cameraVideo.evaluate(video => {
    delete video.videoWidth;
    delete video.videoHeight;
    video.dispatchEvent(new Event("resize"));
  });
  await studio.getByRole("button", {name:"Bắt đầu quay"}).click();
  await expect(studio.locator("[data-p=status]")).toContainText("dưới 128 MB");
  await studio.getByRole("button", {name:"Về kịch bản"}).click();
  await videoTab.click();
  await expect(rows.locator(".clip-title")).toHaveText(["3. Tiêu đề mới","1. Kịch bản trước đây","4. Tiêu đề mới"]);
  await expect(rows.last()).toContainText("Gián đoạn");
  await expect(library).not.toContainText("Không được hiện");
  await rows.last().getByRole("button", {name:"Xem lại"}).click();
  await expect(player.locator("video")).toHaveAttribute("src", /^blob:/);
  await expect(player.locator("[data-message]")).toContainText("phục hồi");
  expect(requests.some(request => request.method() === "POST" && /storage\/v1|prompter_scripts/.test(request.url()))).toBe(false);
});
