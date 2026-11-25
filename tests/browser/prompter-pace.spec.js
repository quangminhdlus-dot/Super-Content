import {expect, test} from "@playwright/test";

const rates = [50, 100, 150, 200, 260];
const line = "Một hai ba bốn năm sáu bảy tám chín mười.";

for (const layout of [
  {name:"dọc", width:440, height:956, font:36, frame:16},
  {name:"ngang, tốc độ khung hình thấp", width:956, height:440, font:56, frame:100},
]) {
  test(`đo cuộn WPM ở màn hình ${layout.name}`, async ({page}) => {
    await page.setViewportSize({width:layout.width, height:layout.height});
    await page.goto("./");
    await page.getByRole("button", {name:"Thêm ý tưởng"}).first().click();
    await page.locator("#new-idea-title").fill("Đo tốc độ đọc");
    await page.locator("#new-idea-content").fill("Nội dung thử");
    await page.getByRole("button", {name:"Lưu ý tưởng", exact:true}).click();
    await page.getByRole("button", {name:/^Đo tốc độ đọc/}).click();
    await page.getByRole("button", {name:"Chuyển sang Kịch bản"}).click();
    await page.locator("#script").fill(Array(6).fill(line).join("\n"));
    await page.evaluate(font => {
      localStorage.setItem("super-content:prompter", JSON.stringify({mode:"fixed", font}));
      window.cameraRequests = 0;
      navigator.mediaDevices.getUserMedia = async () => { window.cameraRequests++; throw Error("Unexpected media request"); };
      let id = 0, now, callbacks = new Map();
      window.requestAnimationFrame = callback => { const next = ++id; callbacks.set(next, callback); return next; };
      window.cancelAnimationFrame = token => callbacks.delete(token);
      window.advanceFrames = (time, frame) => {
        now ??= performance.now();
        let elapsed = 0;
        do {
          const next = Math.min(frame, time - elapsed);
          elapsed += next;
          now += next;
          const queued = callbacks;
          callbacks = new Map();
          queued.forEach(callback => callback(now));
        } while (elapsed < time);
      };
    }, layout.font);
    await page.getByRole("button", {name:"Nhắc chữ không camera"}).click();
    await expect(page.locator("[data-segment]")).toHaveCount(6);
    await expect(page.getByTestId("reader")).toHaveCSS("font-size", `${layout.font}px`);

    const measurements = await page.evaluate(({rates, frame}) => {
      const scroll = document.querySelector("[data-p=scroll]");
      const reader = document.querySelector("[data-p=script]");
      const play = document.querySelector("[data-p=record]");
      const slider = document.querySelector("[data-p=speed]");
      const lineTop = index => reader.querySelector(`[data-segment="${index}"]`).getBoundingClientRect().top;
      const goal = lineTop(2) - lineTop(0);
      const reset = rate => {
        play.click();
        scroll.scrollTop = 0;
        slider.value = rate;
        slider.dispatchEvent(new Event("input", {bubbles:true}));
        window.advanceFrames(0, frame);
        play.click();
      };
      const measured = rates.map(rate => {
        reset(rate);
        window.advanceFrames(20 * 60000 / rate, frame);
        const travelled = scroll.scrollTop;
        return {rate, goal, travelled, actual: Math.round(100 * rate * travelled / goal) / 100};
      });
      reset(50);
      window.advanceFrames(6000, frame);
      slider.value = "150";
      slider.dispatchEvent(new Event("input", {bubbles:true}));
      window.advanceFrames(6000, frame);
      const changed = scroll.scrollTop;
      window.advanceFrames(16000, frame);
      const finished = scroll.scrollTop;
      const limit = scroll.scrollHeight - scroll.clientHeight;
      window.advanceFrames(1000, frame);
      return {measured, changed, goal, finished, limit, settled:scroll.scrollTop, cameras:window.cameraRequests};
    }, {rates, frame:layout.frame});
    for (const m of measurements.measured) {
      expect(Math.abs(m.travelled - m.goal), JSON.stringify(m)).toBeLessThanOrEqual(2);
      expect(Math.abs(m.actual - m.rate)).toBeLessThanOrEqual(m.rate * .015);
    }
    expect(Math.abs(measurements.changed - measurements.goal)).toBeLessThanOrEqual(2);
    expect(measurements.finished).toBe(measurements.limit);
    expect(measurements.settled).toBe(measurements.limit);
    expect(measurements.cameras).toBe(0);
    console.log(layout.name + ": " + measurements.measured.map(item=>item.actual).join(", ") + " WPM");
  });
}
