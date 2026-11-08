import {
  emptyMission,
  validateMission,
  proposalOrder,
} from "../../shared/search.js";
import { missionFields, captureMission } from "./mission-ui.js";
import * as missions from "./missions.js";
import * as client from "./client.js";
import * as personal from "./personal-client.js";
import { personalView } from "./personal-ui.js";
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
  epoch = 0,
  workspace = "research",
  groupFilter = "",
  continueJob = true,
  mission = emptyMission(),
  savedMissions = [],
  missionError = "",
  sortOrder = "fit";
export function initResearch(options) {
  getUser = options.getUser;
  onImported = options.onImported;
}
export function resetResearch() {
  mission = emptyMission();
  savedMissions = [];
  missionError = "";
  sortOrder = "fit";
  epoch++;
  workspace = "research";
  groupFilter = "";
  continueJob = false;
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
      loaded.personal = await personal.loadPersonal(getUser());
      let tasks = [],
        taskError = "";
      try {
        tasks = await missions.loadMissions(getUser());
      } catch (e) {
        taskError = e.message;
      }
      if (version !== epoch) return;
      savedMissions = tasks;
      missionError = taskError;
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
  const tabs = `<nav class="research-tabs" aria-label="Không gian nghiên cứu">${[
    ["research", "Nghiên cứu & Đề xuất"],
    ["channels", "Kênh theo dõi"],
    ["criteria", "Tiêu chuẩn nội dung"],
    ["memory", "Bộ nhớ học hỏi"],
  ]
    .map(
      ([v, l]) =>
        `<button data-workspace="${v}" class="${workspace === v ? "active" : ""}">${l}</button>`,
    )
    .join("")}</nav>`;
  if (workspace !== "research") {
    container.innerHTML = `${tabs}<div id="personal-workspace"></div>`;
    container.onclick = (ev) => {
      const v = ev.target.closest("[data-workspace]")?.dataset.workspace;
      if (v) {
        workspace = v;
        draw();
      }
    };
    personalView(
      container.querySelector("#personal-workspace"),
      workspace,
      getUser(),
      {
        navigate: (v) => {
          workspace = v;
          draw();
        },
        refreshChannels: () => runJob("refresh"),
      },
    );
    return;
  }
  container.innerHTML = `${tabs}<section class="page-heading"><div><div class="eyebrow">KHÁM PHÁ & SÀNG LỌC</div><h1>Nghiên cứu YouTube</h1><p>Nguồn nghiên cứu và đề xuất, tách biệt với Kho ý tưởng.</p></div><button data-research="refresh">Tải lại dữ liệu</button></section>${local ? '<p class="warning">Chế độ cục bộ: có thể lưu cấu hình trên thiết bị. Đăng nhập Supabase và kết nối máy chủ để quét dữ liệu YouTube thật.</p>' : ""}${!client.apiConfigured ? '<p class="muted">Chưa cấu hình máy chủ nghiên cứu. Khóa API chỉ được đặt phía máy chủ.</p>' : ""}<p class="muted">Mỗi lượt đánh giá dùng tối đa 2.000 video thu thập gần nhất; tìm kiếm có thể bỏ sót video cũ hơn trong kho.</p><p id="research-status" role="status" class="${loadError ? "warning" : "muted"}">${escape(loadError || "")}</p><div class="research-grid"><section class="panel research-settings" tabindex="0" aria-label="Nguồn nghiên cứu"><h2>Tìm video bằng AI</h2><form id="research-settings">${missionFields(mission, savedMissions, missionError)}<h3>Nguồn nghiên cứu</h3><h3>Kênh theo dõi <small>(${state.personal?.channels?.filter((c) => c.enabled && !c.duplicate_of).length || 0} đang bật)</small></h3><p class="muted">Tìm trong dữ liệu đã thu thập. Dùng mục Kênh để nhập hàng loạt và cập nhật theo lô.</p><button type="button" data-workspace="channels">Quản lý 100+ kênh</button><h3 class="section-spacer">${mission.method === "description" ? "Từ khóa bổ sung (không bắt buộc)" : "Từ khóa"} <small>(${s.keywords.length}/5)</small></h3><div class="source-list">${s.keywords.map((k, i) => `<div><input aria-label="Từ khóa ${i + 1}" data-keyword="${i}" value="${escape(k)}" maxlength="120"><button type="button" data-remove-keyword="${i}" aria-label="Xóa từ khóa ${i + 1}">×</button></div>`).join("")}</div><label class="field">Từ khóa mới<input id="new-keyword" maxlength="120" placeholder="Ví dụ: thói quen buổi sáng"></label><button type="button" data-research="add-keyword">+ Thêm từ khóa</button><label class="field">Nguồn tìm kiếm<select name="mode">${[
    ["channels", "Chỉ kênh đang theo dõi"],
    ["keywords", "Toàn YouTube"],
    ["combined", "Kênh theo dõi và toàn YouTube"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${s.mode === v ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></label><details class="search-advanced"><summary>Tùy chọn nâng cao</summary><label class="field">Tìm tiêu đề/mô tả trong kho dữ liệu<input id="research-query" maxlength="200" value="${escape(s.search_query || "")}" placeholder="Từ khóa tìm nhanh, không gọi YouTube ở chế độ kho"></label><div class="date-range"><label class="field">Đăng từ ngày (UTC)<input name="published_after" type="date" value="${escape(s.published_after)}" required></label><label class="field">Đến ngày (UTC)<input name="published_before" type="date" value="${escape(s.published_before)}" required></label></div><label class="field">Số đề xuất mỗi lần quét<input name="result_limit" type="number" min="1" max="50" value="${s.result_limit}" required></label></details><div class="research-buttons"><button type="submit">Lưu cấu hình</button><button type="button" class="primary" data-research="scan" ${running || local || !client.apiConfigured || !!loadError ? "disabled" : ""}>${running ? "Đang quét…" : "Quét ngay"}</button></div><p class="muted">Tối đa 10 lượt/24 giờ, cách nhau ít nhất 60 giây. Chỉ quét thủ công; lịch tự động chưa bật.</p></form></section><div class="research-results" tabindex="0" role="region" aria-label="Danh sách đề xuất"><section class="panel run-panel">${jobHTML()}<h2>Lần quét gần nhất</h2><p>${when(last?.started_at)}</p>${last ? `<strong>${escape({ running: "Đang chạy", succeeded: "Hoàn tất", failed: "Có lỗi" }[last.status])}</strong><p>${last.found_count} video tìm thấy · ${last.proposed_count} đề xuất · ${last.api_units} đơn vị API</p>${last.error_message ? `<p class="warning">${escape(last.error_code)}: ${escape(last.error_message)}</p>` : ""}${(last.warnings || []).map((w) => `<p class="muted">${escape(w)}</p>`).join("")}` : '<p class="muted">Kết quả quét được lưu theo tài khoản để xem trên các thiết bị.</p>'}${
    state.runs.length > 1
      ? `<details><summary>Lịch sử ${state.runs.length - 1} lần trước</summary>${state.runs
          .slice(1)
          .map(
            (r) =>
              `<p>${when(r.started_at)} · ${escape(r.status)} · ${escape(r.error_message || `${r.proposed_count} đề xuất`)}</p>`,
          )
          .join("")}</details>`
      : ""
  }</section><section class="proposal-section"><div class="proposal-heading"><h2>Đề xuất <span class="heading-count">${proposalPool().filter((p) => p.status === filter).length}</span></h2><label class="field">Trạng thái<select id="proposal-filter">${[
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
    )}</select></label></div><label class="field">Sắp xếp<select id="proposal-sort">${[
    ["fit", "Phù hợp nhất"],
    ["growth", "Cơ hội tăng trưởng tốt nhất"],
    ["strategic", "Giá trị chiến lược cao nhất"],
    ["newest", "Mới nhất"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${sortOrder === v ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></label><label class="field">Nhóm cơ hội<select id="opportunity-group"><option value="" ${!groupFilter ? "selected" : ""}>Tất cả nhóm</option><option value="growth" ${groupFilter === "growth" ? "selected" : ""}>Cơ hội tăng trưởng</option><option value="strategic" ${groupFilter === "strategic" ? "selected" : ""}>Giá trị chiến lược dài hạn</option></select></label><p class="muted">Điểm là sàng lọc tương đối, không phải bảo đảm đột biến. Thiếu lịch sử sẽ được ghi rõ. Hiển thị tối đa 500 đề xuất gần nhất.</p><div class="proposal-select"><label><input id="research-select-all" type="checkbox"> Chọn tất cả kết quả đang xem</label><span>${selected.length} đã chọn (tối đa 50)</span></div><div id="proposals">${proposalCards()}</div>${filter !== "accepted" && selected.length ? `<div class="proposal-actions"><button class="primary" data-research="accept" ${selected.length ? "" : "disabled"}>Chuyển vào Kho ý tưởng</button><button data-research="ignore" ${selected.length ? "" : "disabled"}>Bỏ qua</button><button data-research="archive" ${selected.length ? "" : "disabled"}>Lưu trữ đề xuất</button>${filter !== "suggested" ? `<button data-research="restore" ${selected.length ? "" : "disabled"}>Đưa lại chờ duyệt</button>` : ""}</div>` : ""}</section></div></div>`;
  bind();
  const selectAll = container.querySelector("#research-select-all");
  const shown = proposalPool().filter(
    (p) =>
      p.status === filter &&
      (!groupFilter || (p.analysis?.group || "strategic") === groupFilter),
  );
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
function currentSearchJob() {
  return state.personal?.jobs?.find(
    (j) => j.status === "completed" && j.settings?.kind !== "plan",
  );
}
function proposalPool() {
  const job = currentSearchJob();
  return filter === "suggested" && job?.settings?.mission
    ? state.proposals.filter(
        (p) =>
          p.last_run_id === job.run_id &&
          p.analysis?.search_context &&
          p.analysis.selected_for_mission !== false,
      )
    : state.proposals;
}
function proposalCards() {
  const proposals = proposalPool()
    .filter(
      (p) =>
        p.status === filter &&
        (!groupFilter || (p.analysis?.group || "strategic") === groupFilter),
    )
    .sort((a, b) => proposalOrder(a, b, sortOrder));
  return proposals.length
    ? proposals
        .map((p) => {
          const v = p.data,
            a = p.analysis || {};
          return `<article class="panel proposal-card"><div class="proposal-card-top">${filter !== "accepted" ? `<label class="row-selector"><input type="checkbox" data-proposal="${escape(p.youtube_id)}" aria-label="Chọn đề xuất ${escape(v.title)}" ${selection.has(p.youtube_id) ? "checked" : ""}></label>` : ""}${safeImage(v.thumbnail) ? `<img src="${escape(safeImage(v.thumbnail))}" loading="lazy" alt="" width="144" height="81">` : ""}<div><h3><a href="https://www.youtube.com/watch?v=${encodeURIComponent(p.youtube_id)}" target="_blank" rel="noopener noreferrer">${escape(v.title)}</a></h3><p class="muted">${escape(v.channel)} · ${when(v.published_at)}</p></div></div><div class="research-metrics"><span>${number(v.views)} lượt xem</span><span>${number(v.likes)} thích</span><span>${number(v.comments)} bình luận</span></div><p class="tag">${a.group === "growth" ? "Cơ hội tăng trưởng" : "Giá trị chiến lược dài hạn"} · ${["ai", "ai_search"].includes(a.ranking_engine) ? "AI cá nhân hóa" : "Quy tắc / Chưa có AI"}</p><p><strong class="orange">${Number(a.score) || 0}/100</strong> · Tin cậy ${a.confidence === "medium" ? "vừa" : a.confidence === "limited" ? "hạn chế" : "thấp"} · ${a.eligible ? "Qua sàng lọc số liệu" : "Chưa đủ bằng chứng vượt trội"}</p><ul>${[...(a.reasons || []), ...(a.personal_reasons || [])].map((r) => `<li>${escape(r)}</li>`).join("")}</ul>${a.search_context ? `<div class="search-scores"><span>Nhu cầu hiện tại: ${a.need_fit == null ? "Chưa có đánh giá AI" : `${Number(a.need_fit)}/100`}</span><span>Tiêu chuẩn cá nhân: ${Number(a.personal_fit) || 0}/100</span><span>Tín hiệu thị trường: ${Number(a.market_score) || 0}/100</span></div><p>${escape(a.search_explanation || "Tìm từ khóa và đối chiếu theo quy tắc.")}</p><p class="muted">${escape((a.missing_data || []).join(" · "))}</p><details><summary>Nhiệm vụ dẫn đến đề xuất</summary><p>${escape(a.search_context.mission?.name || a.search_context.mission?.description || a.search_context.mission?.keywords?.join(", "))}</p><p>Phương pháp: ${escape(a.search_context.mission?.method)} · Nguồn: ${escape(a.search_context.mission?.source)}</p></details>` : ""}${(a.evaluation_warnings || []).map((w) => `<p class="muted">${escape(w)}</p>`).join("")}<p class="proposal-angle"><b>Góc khai thác ${a.angle_source === "ai" ? "(AI)" : "(gợi ý biên tập)"}</b><br>${escape(a.angle || "Chưa có gợi ý.")}</p><div class="feedback-form"><p class="muted">Lựa chọn gần nhất: ${escape({ chosen: "Chọn làm video", later: "Xem xét sau", rejected: "Không phù hợp", excellent: "Đặc biệt xuất sắc" }[state.personal?.feedback?.find((f) => f.youtube_id === p.youtube_id)?.decision] || "Chưa đánh giá")}</p><label class="field">Đánh giá của bạn<select data-feedback-choice="${escape(p.youtube_id)}"><option value="chosen">Chọn làm video</option><option value="later">Xem xét sau</option><option value="rejected">Không phù hợp</option><option value="excellent">Đặc biệt xuất sắc</option></select></label><label class="field">Lý do (không bắt buộc)<textarea data-feedback-reason="${escape(p.youtube_id)}" rows="2" maxlength="2000"></textarea></label><button data-feedback-save="${escape(p.youtube_id)}">Lưu lựa chọn</button><small>Chỉ dùng để học sau khi bạn xác nhận ghi nhớ ở mục Bộ nhớ học hỏi.</small></div><details><summary>Nguồn & thời điểm ghi nhận</summary><p>${escape((p.sources || []).join(" · "))}</p><p>Nguồn đã truy cập: ${escape((a.data_access || ["Tiêu đề, mô tả và thống kê API"]).join(", "))}. Chưa đọc transcript/video/bình luận.</p><p>Thu thập: ${when(p.collected_at)}</p><p class="muted">${escape(a.note || "")}</p></details></article>`;
        })
        .join("")
    : currentSearchJob()?.settings?.mission && filter === "suggested"
      ? '<div class="panel empty"><h3>Không có video phù hợp trong lượt này</h3><p>Thử mở rộng nguồn, khoảng ngày hoặc mô tả nhu cầu. Các kết quả lịch sử vẫn được giữ trong nhiệm vụ.</p></div>'
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
  mission = captureMission(container, mission);
  if (
    JSON.stringify(mission.keywords) !== JSON.stringify(state.settings.keywords)
  )
    mission.plan = null;
  mission.keywords = [...state.settings.keywords];
  state.settings.search_query =
    container.querySelector("#research-query")?.value || "";
  container
    .querySelectorAll("[data-keyword]")
    .forEach(
      (el) =>
        (state.settings.keywords[Number(el.dataset.keyword)] = el.value.trim()),
    );
  if (
    JSON.stringify(mission.keywords) !== JSON.stringify(state.settings.keywords)
  )
    mission.plan = null;
  mission.keywords = [...state.settings.keywords];
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
function jobHTML() {
  const job = state.personal?.jobs?.find((j) =>
    ["pending", "running", "paused"].includes(j.status),
  );
  return `<div id="job-progress">${job ? `<h3>Tiến trình đang giữ ở máy chủ</h3><p>Lô ${job.cursor}/${job.tasks.length} · ${escape(job.status)} · ${when(job.updated_at)}</p><p class="muted">Tiếp tục dùng cấu hình và phiên bản tiêu chuẩn lúc bắt đầu lượt này.</p>${job.error_message ? `<p class="warning">${escape(job.error_message)}</p>` : ""}<button data-job-action="resume" data-job-id="${job.id}">Tiếp tục lô còn lại</button><button data-job-action="cancel" data-job-id="${job.id}">Hủy tiến trình</button>` : ""}</div>`;
}
async function runJob(kind, resumeId = null) {
  if (running) return;
  running = true;
  continueJob = true;
  const mounted = container,
    version = epoch;
  workspace = "research";
  draw();
  message("Đang xử lý từng lô, tiến độ lưu trên máy chủ…");
  try {
    const job = await client.scanNow({
      kind,
      mission:
        kind === "refresh" || resumeId ? undefined : validateMission(mission),
      query: state.settings.search_query || "",
      resumeId,
      shouldContinue: () =>
        continueJob && epoch === version && mounted.isConnected,
      onProgress: (job) => {
        if (!mounted.isConnected || version !== epoch) return;
        const el = container.querySelector("#job-progress");
        if (el)
          el.innerHTML = `<p>Đã xử lý ${job.cursor}/${job.tasks.length} lô · ${job.api_units} đơn vị YouTube API</p><button data-job-action="pause">Tạm dừng sau lô này</button>`;
      },
    });
    if (epoch === version && mounted.isConnected) {
      if (job.settings?.search_plan) mission.plan = job.settings.search_plan;
      await showResearch(container);
      message(
        job.settings?.kind === "plan"
          ? "Đã tạo chiến lược. Bạn có thể chỉnh sửa trước khi Quét ngay."
          : job.status === "completed"
            ? "Đã hoàn tất đánh giá. Đề xuất chờ bạn duyệt."
            : "Đã dừng; bấm tiếp tục để xử lý phần còn lại.",
      );
    }
  } catch (error) {
    if (epoch === version && mounted.isConnected) {
      await showResearch(container);
      message(error.message, true);
    }
  } finally {
    running = false;
    if (epoch === version && mounted.isConnected) {
      const btn = container.querySelector("[data-research=scan]");
      if (btn) {
        btn.disabled = !getUser() || !client.apiConfigured || !!loadError;
        btn.textContent = "Quét ngay";
      }
    }
  }
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
    if (el.id === "search-method") {
      syncForm();
      draw();
    } else if (el.id === "saved-mission") {
      const t = savedMissions.find((t) => t.id === el.value);
      if (t) {
        try {
          mission = validateMission(structuredClone(t.spec), { draft: true });
        } catch (error) {
          message(error.message, true);
          return;
        }
        mission.task_id = t.id;
        state.settings.keywords = [...mission.keywords];
        state.settings.mode = {
          channels: "channels",
          youtube: "keywords",
          combined: "combined",
        }[mission.source];
        draw();
      }
    } else if (el.id === "proposal-sort") {
      syncForm();
      sortOrder = el.value;
      draw();
    } else if (el.id === "opportunity-group") {
      syncForm();
      groupFilter = el.value;
      selection.clear();
      draw();
    } else if (el.id === "proposal-filter") {
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
            proposalPool()
              .filter(
                (p) =>
                  p.status === filter &&
                  (!groupFilter ||
                    (p.analysis?.group || "strategic") === groupFilter),
              )
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
      if (b.dataset.workspace) {
        workspace = b.dataset.workspace;
        draw();
        return;
      }
      if (b.dataset.jobAction === "pause") {
        continueJob = false;
        message("Sẽ dừng sau lô đang xử lý; tiến độ được giữ.");
        return;
      }
      if (b.dataset.jobAction === "resume") {
        await runJob("research", b.dataset.jobId);
        return;
      }
      if (b.dataset.jobAction === "cancel") {
        await personal.cancelJob(getUser(), b.dataset.jobId);
        await showResearch(container);
        return;
      }
      if (b.dataset.feedbackSave) {
        const p = state.proposals.find(
            (p) => p.youtube_id === b.dataset.feedbackSave,
          ),
          choice = container.querySelector(
            `[data-feedback-choice="${p.youtube_id}"]`,
          ).value,
          reason = container.querySelector(
            `[data-feedback-reason="${p.youtube_id}"]`,
          ).value;
        await personal.feedback(getUser(), p, choice, reason);
        if (choice === "chosen") {
          await client.acceptProposals(getUser(), [p.youtube_id]);
          await onImported();
        }
        if (choice === "rejected")
          await client.setProposalStatus(getUser(), [p.youtube_id], "ignored");
        await showResearch(container);
        message(
          "Đã lưu lựa chọn và phiên bản tiêu chuẩn. Ghi nhớ chỉ được dùng khi bạn xác nhận.",
        );
        return;
      }
      if (b.dataset.removeKeyword !== undefined) {
        state.settings.keywords.splice(Number(b.dataset.removeKeyword), 1);
        dirty = true;
        draw();
        return;
      }
      switch (action) {
        case "save-mission": {
          const revision =
            savedMissions.find((t) => t.id === mission.task_id)?.revision || 0;
          const saved = await missions.saveMission(
            getUser(),
            mission,
            revision,
          );
          mission = structuredClone(saved.spec);
          mission.task_id = saved.id;
          savedMissions = await missions.loadMissions(getUser());
          draw();
          message("Đã lưu nhiệm vụ. Mô tả không thay đổi tiêu chuẩn lâu dài.");
          break;
        }
        case "new-mission":
          mission = emptyMission();
          state.settings.mode = "channels";
          state.settings.keywords = [];
          draw();
          break;
        case "mission-history": {
          const history = await missions.taskHistory(
            getUser(),
            mission.task_id,
          );
          const output = document.createElement("div");
          output.className = "mission-history";
          output.innerHTML = history.length
            ? history
                .map(
                  (j) =>
                    `<details><summary>${when(j.created_at)} · ${escape(j.status)} · ${j.evaluations.length} kết quả</summary>${j.evaluations.map((v) => `<p><a target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/watch?v=${encodeURIComponent(v.youtube_id)}">${escape(v.youtube_id)}</a> · ${escape(v.explanation.search_explanation || "")}</p>`).join("")}</details>`,
                )
                .join("")
            : "Chưa có lần chạy đã lưu trên máy chủ.";
          container.querySelector(".mission-history")?.remove();
          b.parentElement.after(output);
          break;
        }
        case "plan":
          mission.plan = null;
          await save();
          await runJob("plan");
          break;
        case "add-plan": {
          if (mission.plan.groups.length >= 5)
            throw new Error("Tối đa 5 hướng tìm kiếm.");
          const query = container.querySelector("#plan-new-query").value.trim();
          if (!query) throw new Error("Nhập hướng tìm kiếm mới.");
          mission.plan.groups.push({
            topic: query,
            query,
            language: "vi",
            reason: "Hướng do người dùng bổ sung.",
            relevance: 1,
            enabled: true,
          });
          draw();
          break;
        }
        case "clear-plan":
          mission.plan = null;
          draw();
          break;
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
          validateMission(mission);
          await save();
          await runJob("research");
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
