import { parseChannel } from "../../server/validation.js";
import * as client from "./client.js";
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const number = (v) =>
  v === null || v === undefined
    ? "Không công khai"
    : Number(v).toLocaleString("vi-VN");
const when = (value) =>
  value ? new Date(value).toLocaleString("vi-VN") : "Chưa chạy";
let state = { settings: client.defaults(), proposals: [], runs: [] },
  selection = new Set(),
  getUser,
  onImported,
  container,
  filter = "suggested",
  running = false,
  dirty = false,
  loadError = "",
  epoch = 0;
export function initResearch(options) {
  getUser = options.getUser;
  onImported = options.onImported;
}
export function resetResearch() {
  epoch++;
  state = { settings: client.defaults(), proposals: [], runs: [] };
  selection.clear();
  dirty = false;
  loadError = "";
}
export async function showResearch(target, { refresh = true } = {}) {
  container = target;
  const mounted = container,
    version = epoch;
  if (refresh) {
    container.innerHTML = '<p class="muted">Đang tải nghiên cứu…</p>';
    try {
      const loaded = await client.loadResearch(getUser());
      if (version !== epoch) return;
      state = loaded;
      dirty = false;
      loadError = "";
    } catch (error) {
      if (version !== epoch) return;
      loadError = error.message;
    }
  }
  if (!mounted.isConnected || container !== mounted) return;
  draw();
}
function message(text, isError = false) {
  const output = container.querySelector("#research-status");
  if (output) {
    output.textContent = text;
    output.className = isError ? "warning" : "muted";
  }
}
function draw() {
  const s = state.settings,
    last = state.runs[0],
    local = !getUser(),
    selected = [...selection];
  container.innerHTML = `<section class="page-heading"><div><div class="eyebrow">KHÁM PHÁ & SÀNG LỌC</div><h1>Nghiên cứu YouTube</h1><p>Nguồn nghiên cứu và đề xuất, tách biệt với Kho ý tưởng.</p></div><button data-research="refresh">Tải lại dữ liệu</button></section>${local ? '<p class="warning">Chế độ cục bộ: có thể lưu cấu hình trên thiết bị. Đăng nhập Supabase và kết nối máy chủ để quét dữ liệu YouTube thật.</p>' : ""}${!client.apiConfigured ? '<p class="muted">Chưa cấu hình máy chủ nghiên cứu. Khóa API chỉ được đặt phía máy chủ.</p>' : ""}<p id="research-status" role="status" class="${loadError ? "warning" : "muted"}">${escape(loadError || "")}</p><div class="research-grid"><section class="panel research-settings"><h2>Nguồn nghiên cứu</h2><form id="research-settings"><h3>Kênh theo dõi <small>(${s.channels.length}/10)</small></h3><div class="source-list">${s.channels.map((c, i) => `<div><a href="${escape(c.url)}" target="_blank" rel="noopener noreferrer">${escape(c.title || c.url)}</a><button type="button" data-remove-channel="${i}" aria-label="Xóa kênh ${escape(c.url)}">×</button></div>`).join("")}</div><label class="field">Đường dẫn kênh<input id="channel-url" type="url" placeholder="https://www.youtube.com/@tenkenh"></label><button type="button" data-research="add-channel">+ Thêm kênh</button><h3 class="section-spacer">Từ khóa <small>(${s.keywords.length}/5)</small></h3><div class="source-list">${s.keywords.map((k, i) => `<div><input aria-label="Từ khóa ${i + 1}" data-keyword="${i}" value="${escape(k)}" maxlength="120"><button type="button" data-remove-keyword="${i}" aria-label="Xóa từ khóa ${i + 1}">×</button></div>`).join("")}</div><label class="field">Từ khóa mới<input id="new-keyword" maxlength="120" placeholder="Ví dụ: thói quen buổi sáng"></label><button type="button" data-research="add-keyword">+ Thêm từ khóa</button><label class="field">Nguồn quét<select name="mode">${[
    ["channels", "Theo kênh"],
    ["keywords", "Theo từ khóa"],
    ["combined", "Kết hợp hai nguồn (gộp kết quả)"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${s.mode === v ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></label><div class="date-range"><label class="field">Đăng từ ngày (UTC)<input name="published_after" type="date" value="${escape(s.published_after)}" required></label><label class="field">Đến ngày (UTC)<input name="published_before" type="date" value="${escape(s.published_before)}" required></label></div><label class="field">Số đề xuất mỗi lần quét<input name="result_limit" type="number" min="1" max="50" value="${s.result_limit}" required></label><div class="research-buttons"><button type="submit">Lưu cấu hình</button><button type="button" class="primary" data-research="scan" ${running || local || !client.apiConfigured || !!loadError ? "disabled" : ""}>${running ? "Đang quét…" : "Quét ngay"}</button></div><p class="muted">Tối đa 10 lượt/24 giờ, cách nhau ít nhất 60 giây. Chỉ quét thủ công; lịch tự động chưa bật.</p></form></section><div><section class="panel run-panel"><h2>Lần quét gần nhất</h2><p>${when(last?.started_at)}</p>${last ? `<strong>${escape({ running: "Đang chạy", succeeded: "Hoàn tất", failed: "Có lỗi" }[last.status])}</strong><p>${last.found_count} video tìm thấy · ${last.proposed_count} đề xuất · ${last.api_units} đơn vị API</p>${last.error_message ? `<p class="warning">${escape(last.error_code)}: ${escape(last.error_message)}</p>` : ""}${(last.warnings || []).map((w) => `<p class="muted">${escape(w)}</p>`).join("")}` : '<p class="muted">Kết quả quét được lưu theo tài khoản để xem trên các thiết bị.</p>'}${
    state.runs.length > 1
      ? `<details><summary>Lịch sử ${state.runs.length - 1} lần trước</summary>${state.runs
          .slice(1)
          .map(
            (r) =>
              `<p>${when(r.started_at)} · ${escape(r.status)} · ${escape(r.error_message || `${r.proposed_count} đề xuất`)}</p>`,
          )
          .join("")}</details>`
      : ""
  }</section><section class="proposal-section"><div class="proposal-heading"><h2>Đề xuất <span class="heading-count">${state.proposals.filter((p) => p.status === filter).length}</span></h2><label class="field">Trạng thái<select id="proposal-filter">${[
    ["suggested", "Chờ duyệt"],
    ["ignored", "Đã bỏ qua"],
    ["archived", "Đã lưu trữ"],
    ["accepted", "Đã chuyển vào kho"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${filter === v ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></label></div><p class="muted">Điểm là sàng lọc tương đối, không phải bảo đảm đột biến. Thiếu lịch sử sẽ được ghi rõ. Hiển thị tối đa 500 đề xuất gần nhất.</p><div class="proposal-select"><label><input id="research-select-all" type="checkbox"> Chọn tất cả kết quả đang xem</label><span>${selected.length} đã chọn (tối đa 50)</span></div><div id="proposals">${proposalCards()}</div>${filter !== "accepted" && selected.length ? `<div class="proposal-actions"><button class="primary" data-research="accept" ${selected.length ? "" : "disabled"}>Chuyển vào Kho ý tưởng</button><button data-research="ignore" ${selected.length ? "" : "disabled"}>Bỏ qua</button><button data-research="archive" ${selected.length ? "" : "disabled"}>Lưu trữ đề xuất</button>${filter !== "suggested" ? `<button data-research="restore" ${selected.length ? "" : "disabled"}>Đưa lại chờ duyệt</button>` : ""}</div>` : ""}</section></div></div>`;
  bind();
  const selectAll = container.querySelector("#research-select-all");
  const shown = state.proposals.filter((p) => p.status === filter);
  selectAll.checked =
    shown.length > 0 &&
    shown.slice(0, 50).every((p) => selection.has(p.youtube_id));
  selectAll.indeterminate =
    !selectAll.checked && shown.some((p) => selection.has(p.youtube_id));
}
function safeImage(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "i.ytimg.com"
      ? u.href
      : "";
  } catch {
    return "";
  }
}
function proposalCards() {
  const proposals = state.proposals.filter((p) => p.status === filter);
  return proposals.length
    ? proposals
        .map((p) => {
          const v = p.data,
            a = p.analysis || {};
          return `<article class="panel proposal-card"><div class="proposal-card-top">${filter !== "accepted" ? `<label class="row-selector"><input type="checkbox" data-proposal="${escape(p.youtube_id)}" aria-label="Chọn đề xuất ${escape(v.title)}" ${selection.has(p.youtube_id) ? "checked" : ""}></label>` : ""}${safeImage(v.thumbnail) ? `<img src="${escape(safeImage(v.thumbnail))}" loading="lazy" alt="" width="144" height="81">` : ""}<div><h3><a href="https://www.youtube.com/watch?v=${encodeURIComponent(p.youtube_id)}" target="_blank" rel="noopener noreferrer">${escape(v.title)}</a></h3><p class="muted">${escape(v.channel)} · ${when(v.published_at)}</p></div></div><div class="research-metrics"><span>${number(v.views)} lượt xem</span><span>${number(v.likes)} thích</span><span>${number(v.comments)} bình luận</span></div><p><strong class="orange">${Number(a.score) || 0}/100</strong> · Tin cậy ${a.confidence === "medium" ? "vừa" : a.confidence === "limited" ? "hạn chế" : "thấp"} · ${a.eligible ? "Qua sàng lọc số liệu" : "Chưa đủ bằng chứng vượt trội"}</p><ul>${(a.reasons || []).map((r) => `<li>${escape(r)}</li>`).join("")}</ul><p class="proposal-angle"><b>Góc khai thác ${a.angle_source === "ai" ? "(AI)" : "(gợi ý biên tập)"}</b><br>${escape(a.angle || "Chưa có gợi ý.")}</p><details><summary>Nguồn & thời điểm ghi nhận</summary><p>${escape((p.sources || []).join(" · "))}</p><p>Thu thập: ${when(p.collected_at)}</p><p class="muted">${escape(a.note || "")}</p></details></article>`;
        })
        .join("")
    : '<div class="panel empty"><h3>Chưa có đề xuất ở đây</h3><p>Thêm nguồn và quét để nghiên cứu video. Kết quả chỉ vào Kho ý tưởng sau khi bạn duyệt.</p></div>';
}
function syncForm() {
  const f = container.querySelector("#research-settings");
  if (!f) return;
  for (const k of [
    "mode",
    "published_after",
    "published_before",
    "result_limit",
  ])
    state.settings[k] =
      k === "result_limit" ? Number(f.elements[k].value) : f.elements[k].value;
  container
    .querySelectorAll("[data-keyword]")
    .forEach(
      (el) =>
        (state.settings.keywords[Number(el.dataset.keyword)] = el.value.trim()),
    );
}
async function save() {
  syncForm();
  const f = container.querySelector("#research-settings");
  if (!f.reportValidity())
    throw new Error("Kiểm tra khoảng ngày và số kết quả.");
  const s = state.settings;
  if (s.published_after > s.published_before)
    throw new Error("Ngày bắt đầu phải trước ngày kết thúc.");
  await client.saveSettings(getUser(), {
    channels: s.channels,
    keywords: s.keywords.filter(Boolean),
    mode: s.mode,
    published_after: s.published_after,
    published_before: s.published_before,
    result_limit: s.result_limit,
  });
  dirty = false;
}
function bind() {
  container.querySelector("#research-settings").onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      await save();
      message(
        getUser()
          ? "Đã lưu cấu hình trên tài khoản."
          : "Đã lưu trên thiết bị; chưa đồng bộ.",
      );
    } catch (error) {
      message(error.message, true);
    }
  };
  container.oninput = (ev) => {
    if (ev.target.closest("#research-settings")) dirty = true;
  };
  container.onchange = (ev) => {
    const el = ev.target;
    if (el.id === "proposal-filter") {
      syncForm();
      filter = el.value;
      selection.clear();
      draw();
    } else if (el.dataset.proposal) {
      syncForm();
      el.checked
        ? selection.add(el.dataset.proposal)
        : selection.delete(el.dataset.proposal);
      if (selection.size > 50) {
        selection.delete(el.dataset.proposal);
        message("Chọn tối đa 50 đề xuất mỗi lần.", true);
      }
      draw();
    } else if (el.id === "research-select-all") {
      syncForm();
      selection = el.checked
        ? new Set(
            state.proposals
              .filter((p) => p.status === filter)
              .slice(0, 50)
              .map((p) => p.youtube_id),
          )
        : new Set();
      draw();
    }
  };
  container.onclick = async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const action = b.dataset.research;
    try {
      syncForm();
      if (b.dataset.removeChannel !== undefined) {
        state.settings.channels.splice(Number(b.dataset.removeChannel), 1);
        dirty = true;
        draw();
        return;
      }
      if (b.dataset.removeKeyword !== undefined) {
        state.settings.keywords.splice(Number(b.dataset.removeKeyword), 1);
        dirty = true;
        draw();
        return;
      }
      switch (action) {
        case "add-channel": {
          if (state.settings.channels.length >= 10)
            throw new Error("Tối đa 10 kênh.");
          const c = parseChannel(
            container.querySelector("#channel-url").value.trim(),
          );
          if (state.settings.channels.some((x) => x.url === c.url))
            throw new Error("Kênh đã có trong danh sách.");
          state.settings.channels.push(c);
          dirty = true;
          draw();
          break;
        }
        case "add-keyword": {
          const value = container.querySelector("#new-keyword").value.trim();
          if (!value || value.length > 120)
            throw new Error("Nhập từ khóa từ 1 đến 120 ký tự.");
          if (state.settings.keywords.length >= 5)
            throw new Error("Tối đa 5 từ khóa.");
          if (
            state.settings.keywords.some(
              (k) =>
                k.toLocaleLowerCase("vi") === value.toLocaleLowerCase("vi"),
            )
          )
            throw new Error("Từ khóa đã có.");
          state.settings.keywords.push(value);
          dirty = true;
          draw();
          break;
        }
        case "refresh":
          if (dirty && !confirm("Bỏ thay đổi cấu hình chưa lưu và tải lại?"))
            return;
          await showResearch(container);
          break;
        case "scan":
          if (running) return;
          running = true;
          try {
            await save();
            draw();
            message("Đang quét YouTube…");
            await client.scanNow();
            await showResearch(container);
            message("Quét hoàn tất. Đề xuất chưa tự chuyển vào Kho ý tưởng.");
          } catch (error) {
            await showResearch(container);
            message(error.message, true);
          } finally {
            running = false;
            const button = container.querySelector("[data-research=scan]");
            if (button)
              button.disabled =
                !getUser() || !client.apiConfigured || !!loadError;
            if (button) button.textContent = "Quét ngay";
          }
          break;
        case "accept":
        case "ignore":
        case "archive":
        case "restore": {
          if (!selection.size) return;
          const ids = [...selection];
          b.disabled = true;
          if (action === "accept") {
            await client.acceptProposals(getUser(), ids);
            await onImported();
          } else
            await client.setProposalStatus(
              getUser(),
              ids,
              { ignore: "ignored", archive: "archived", restore: "suggested" }[
                action
              ],
            );
          selection.clear();
          await showResearch(container);
          message(
            action === "accept"
              ? "Đã chuyển vào Kho ý tưởng hoặc liên kết hồ sơ đã có; không tạo bản sao."
              : "Đã cập nhật đề xuất.",
          );
          break;
        }
      }
    } catch (error) {
      b.disabled = false;
      message(error.message, true);
    }
  };
}
