import { test, expect } from "@playwright/test";

async function open(page, count) {
  await page.goto("./");
  await page.evaluate(async (count) => {
    const request = indexedDB.open("super-content-v1", 1);
    await new Promise((resolve) => (request.onsuccess = resolve));
    const db = request.result;
    const tx = db.transaction("videos", "readwrite");
    tx.objectStore("videos").put({
      key: "research:demo:settings",
      scope: "research:demo",
      id: "settings",
      value: {
        settings: {
          channels: [],
          keywords: [],
          mode: "channels",
          published_after: "2026-10-01",
          published_before: "2026-11-08",
          result_limit: 50,
        },
        proposals: Array.from({ length: count }, (_, i) => ({
          youtube_id: `video${String(i).padStart(6, "0")}`,
          status: "suggested",
          sources: ["Kênh thử nghiệm"],
          data: {
            title: `Video đề xuất ${i + 1}`,
            channel: "Kênh thử nghiệm",
            views: 1000,
            published_at: "2026-11-01T00:00:00Z",
          },
          analysis: { score: 50, reasons: ["Dữ liệu kiểm thử bố cục cuộn."] },
        })),
        runs: [],
      },
    });
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
  }, count);
  await page.locator(".research-shortcut").click();
  await expect(page.locator(".proposal-card")).toHaveCount(count);
}

for (const count of [30, 100]) {
  for (const [width, height] of [
    [1024, 768],
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ]) {
    test(`${count} proposals scroll independently at ${width}x${height}`, async ({
      page,
    }, info) => {
      test.skip(info.project.name !== "desktop");
      await page.setViewportSize({ width, height });
      await open(page, count);
      const left = page.locator(".research-settings");
      const right = page.locator(".research-results");
      const before = await left.boundingBox();
      const tabs = await page.locator(".research-tabs").boundingBox();
      const heading = await page.locator(".page-heading").boundingBox();
      const sidebar = await page.locator(".sidebar").boundingBox();
      await right.hover();
      await page.mouse.wheel(0, 1000000);
      await expect
        .poll(() =>
          right.evaluate((el) =>
            Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop),
          ),
        )
        .toBeLessThan(2);
      await expect(page.locator(".proposal-card").last()).toBeInViewport();
      await page.mouse.wheel(0, 10000);
      expect(await left.boundingBox()).toEqual(before);
      expect(await left.evaluate((el) => el.scrollTop)).toBe(0);
      expect(await page.locator(".research-tabs").boundingBox()).toEqual(tabs);
      expect(await page.locator(".page-heading").boundingBox()).toEqual(
        heading,
      );
      expect(await page.locator(".sidebar").boundingBox()).toEqual(sidebar);
      expect(
        await page.evaluate(() => ({
          y: scrollY,
          overflow: document.documentElement.scrollHeight > innerHeight + 1,
          horizontal: document.documentElement.scrollWidth > innerWidth,
        })),
      ).toEqual({ y: 0, overflow: false, horizontal: false });
      const rightTop = await right.evaluate((el) => el.scrollTop);
      await left.hover();
      await page.mouse.wheel(0, 100000);
      await expect(
        page.getByRole("button", { name: "Quét ngay", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "Lưu cấu hình", exact: true }),
      ).toBeInViewport();
      expect(await right.evaluate((el) => el.scrollTop)).toBe(rightTop);
      if (width === 1440 && count === 100)
        await page.screenshot({
          path: "test-results/research-scroll-desktop.png",
        });
      await page
        .getByRole("button", { name: "Tiêu chuẩn nội dung", exact: true })
        .click();
      await expect(page.locator("#criteria-form")).toBeVisible();
      expect(
        await page
          .locator("main")
          .evaluate((el) => getComputedStyle(el).overflowY),
      ).toBe("visible");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollHeight > innerHeight,
        ),
      ).toBeTruthy();
    });
  }
  for (const [width, height] of [
    [390, 844],
    [375, 667],
  ]) {
    test(`${count} proposals use natural one-column scrolling on iPhone viewport ${width}`, async ({
      page,
    }, info) => {
      test.skip(info.project.name !== "mobile");
      await page.setViewportSize({ width, height });
      await open(page, count);
      const left = await page.locator(".research-settings").boundingBox();
      const right = await page.locator(".research-results").boundingBox();
      expect(right.y).toBeGreaterThan(left.y + left.height);
      expect(Math.abs(right.x - left.x)).toBeLessThan(1);
      for (const selector of [".research-settings", ".research-results"])
        expect(
          await page
            .locator(selector)
            .evaluate((el) => getComputedStyle(el).overflowY),
        ).toBe("visible");
      await page.locator(".proposal-card").last().scrollIntoViewIfNeeded();
      await expect(page.locator(".proposal-card").last()).toBeInViewport();
      expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      if (width === 390 && count === 100)
        await page.screenshot({
          path: "test-results/research-scroll-iphone.png",
        });
    });
  }
}
