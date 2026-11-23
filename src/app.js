import "@fontsource/be-vietnam-pro/vietnamese-400.css";
import "@fontsource/be-vietnam-pro/vietnamese-700.css";
import "@fontsource/be-vietnam-pro/latin-400.css";
import "@fontsource/be-vietnam-pro/latin-700.css";
import "./styles.css";
import {
  STAGES,
  LABELS,
  createVideo,
  parseTitles,
  transition,
  visible,
} from "./model.js";
import * as db from "./storage.js";
import { cloud, fetchVideos, saveVideo } from "./cloud.js";
import { initResearch, showResearch, resetResearch } from "./research/ui.js";
import { provenance } from "./research/client.js";
import { initVoice } from "./voice.js";
import { voiceRequest } from "./voice-client.js";
const app = document.querySelector("#app"),
  dialog = document.querySelector("#dialog");
const paths = {
  ideas: "M9 18h6 M10 22h4 M8 14a7 7 0 1 1 8 0l-1 4H9z",
  script: "M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5",
  filming: "M3 6h12v12H3z M15 10l6-4v12l-6-4",
  editing: "M4 4h16v16H4z M4 9h16 M9 9v11 M8 4v5 M16 4v5",
  published: "M9 8l7 4-7 4z M3 5h18v14H3z",
  archive: "M3 4h18v5H3z M5 9v12h14V9 M10 13h4",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  search: "M21 21l-6-6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  plus: "M12 5v14 M5 12h14",
  settings: "M4 7h16 M7 4v6 M4 17h16 M16 14v6",
  arrow: "M5 12h14 M14 7l5 5-5 5",
  back: "M19 12H5 M10 7l-5 5 5 5",
  check: "M5 12l4 4L19 6",
  close: "M6 6l12 12 M6 18L18 6",
  utilities: "M4 6h16v12H4z M4 10h16 M10 14h4",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z M5 11a7 7 0 0 0 14 0 M12 18v4 M8 22h8",
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[n] || paths.script}"/></svg>`;
const e = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const voice = initVoice({
  onInserted: ({ target }) => {
    if (target.id === "idea-content") void suggestTitleForIdea();
    if (target.id === "quick-idea-content") void saveQuickRecordedIdea(target.value);
  },
});
let user = null,
  scope = "demo",
  records = [],
  view = "ideas",
  selected = new Set(),
  search = "",
  editing = null,
  working = false,
  syncMessage = "",
  writeChain = Promise.resolve(),
  generation = 0;
const rowVideo = (r) => r.video;
const videos = () => records.map(rowVideo);
const rows = () =>
  videos()
    .filter(
      (v) =>
        visible(v, view) &&
        `${v.title} ${v.notes}`
          .toLocaleLowerCase("vi")
          .includes(search.toLocaleLowerCase("vi")),
    )
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
    );
const count = (v) => videos().filter((x) => visible(x, v)).length;
const date = (s) => (s ? new Date(s).toLocaleDateString("vi-VN") : "—");
function toast(message) {
  const t = document.querySelector("#toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 4500);
}
function setScale(value) {
  try {
    localStorage.setItem("sc-font", value);
  } catch {}
  document.documentElement.dataset.size = value;
}
try {
  setScale(localStorage.getItem("sc-font") || "medium");
} catch {
  setScale("medium");
}
function nav() {
  return STAGES.map(
    (s, i) =>
      `<button class="nav-item ${view === s ? "active" : ""}" data-view="${s}" ${view === s ? 'aria-current="page"' : ""}>${icon(s)}<span>${["Ý tưởng", "Kịch bản", "Chờ quay", "Hoàn thiện", "Đã đăng"][i]}</span><b>${count(s)}</b></button>`,
  ).join("");
}
function status() {
  const dirty = records.filter((r) => r.dirty).length,
    conflicts = records.filter((r) => r.conflict).length;
  return !user
    ? "Trải nghiệm · Chỉ lưu trên thiết bị"
    : conflicts
      ? `${conflicts} xung đột cần xử lý`
      : syncMessage || (dirty ? `${dirty} thay đổi chờ đồng bộ` : "Đã đồng bộ");
}
function updateStatus() {
  const message = status();
  document
    .querySelectorAll("[data-status]")
    .forEach((el) => (el.textContent = message));
  const notice = document.querySelector(".local-notice");
  if (notice) {
    // Routine sync stays out of the workspace; alert only on failed sync or conflicts.
    notice.hidden = !user || (
      !records.some((record) => record.conflict) &&
      !syncMessage.startsWith("Chưa đồng bộ")
    );
  }
}
initResearch({
  getUser: () => user,
  onImported: async () => {
    await sync();
    await reload();
    document.querySelector(".sidebar nav").innerHTML = nav();
    document.querySelector(".mobile-nav").innerHTML = nav();
  },
});
function render() {
  app.innerHTML = `<aside class="sidebar"><a class="brand" href="./"><span class="brand-mark">${icon(publishedIcon())}</span><span>super content<span class="orange">.</span></span></a><div class="nav-caption">KHÔNG GIAN SẢN XUẤT</div><nav>${nav()}</nav><div class="side-extra"><button data-view="research" class="nav-item ${view === "research" ? "active" : ""}">${icon("search")}<span>Nghiên cứu YouTube</span></button><button data-view="archive" class="nav-item ${view === "archive" ? "active" : ""}">${icon("archive")}<span>Lưu trữ</span><b>${count("archive")}</b></button><button data-view="trash" class="nav-item ${view === "trash" ? "active" : ""}">${icon("trash")}<span>Thùng rác</span><b>${count("trash")}</b></button></div><div class="side-bottom"><span class="avatar">${user ? "SC" : "T"}</span><div><strong>${user ? "Tài khoản của bạn" : "Không gian trải nghiệm"}</strong><small>${e(user?.email || "Dữ liệu trên thiết bị này")}</small></div></div></aside><main><header class="topbar"><span class="breadcrumb">Super Content</span><button class="research-shortcut" data-view="research">${icon("search")}<span>Nghiên cứu</span></button><details class="utility-dropdown"><summary aria-label="Lưu trữ và Thùng rác" title="Lưu trữ và Thùng rác">${icon("utilities")}</summary><div class="utility-popover"><button type="button" data-view="archive">${icon("archive")}<span>Lưu trữ</span><b>${count("archive")}</b></button><button type="button" data-view="trash">${icon("trash")}<span>Thùng rác</span><b>${count("trash")}</b></button></div></details><button class="icon-button" data-action="settings" aria-label="Cài đặt">${icon("settings")}</button></header><div class="local-notice" hidden><span data-status>${e(status())}</span><button data-action="sync">Thử đồng bộ lại</button></div><div id="content">${view === "research" ? "" : editing ? editorHTML() : listHTML()}</div></main><textarea id="quick-idea-content" class="quick-idea-buffer" aria-hidden="true" tabindex="-1" data-voice-bound="true"></textarea><button class="quick-record-button" type="button" data-action="quick-record" aria-label="Ghi ý tưởng nhanh" title="Ghi ý tưởng nhanh">${icon("mic")}</button><nav class="mobile-nav">${nav()}</nav><div id="selection"></div>`;
  if (view === "research") showResearch(document.querySelector("#content"));
  else if (!editing) renderRows();
  else {
    bindEditor();
    showProvenance();
  }
  renderSelection();
  updateStatus();
}
function publishedIcon() {
  return "published";
}
function listHTML() {
  const i = STAGES.indexOf(view);
  const title = LABELS[i] || (view === "archive" ? "Lưu trữ" : "Thùng rác");
  return `<section class="page-heading"><div><h1>${title}<span class="heading-count">${count(view)}</span></h1></div>${view === "ideas" ? `<button class="primary" data-action="add">${icon("plus")} Thêm ý tưởng</button>` : ""}</section><section class="panel list-panel"><div class="list-toolbar"><label class="search">${icon("search")}<input id="search" placeholder="Tìm kiếm tiêu đề, ghi chú…" aria-label="Tìm kiếm" value="${e(search)}"></label><span class="sort-label">Mới nhất trước</span></div><div class="list-caption"><label><input type="checkbox" id="select-all"> <span>Chọn tất cả</span></label><span id="result-count"></span></div><div id="rows"></div></section>`;
}
function renderRows() {
  const list = rows(),
    container = document.querySelector("#rows");
  if (!container) return;
  container.innerHTML = list.length
    ? list
        .map(
          (v) =>
            `<article class="video-row ${selected.has(v.id) ? "selected" : ""}"><label class="row-selector"><input type="checkbox" class="row-check" data-id="${v.id}" aria-label="Chọn ${e(v.title)}" ${selected.has(v.id) ? "checked" : ""}></label><button class="video-main" data-open="${v.id}"><strong>${e(v.title || "Ý tưởng chưa có tiêu đề")}</strong><span>${date(v.created_at)} <i>·</i> ${e((v.notes || v.script)?.slice(0, 90) || "Chưa có nội dung")}${v.stage === "published" ? ` <i>·</i> Đăng ${date(v.published_at)}` : ""}</span></button><span class="tag ${v.script ? "ready" : ""}">${view === "script" ? (v.script ? "Đang viết" : "Chưa viết") : e(LABELS[STAGES.indexOf(v.stage)])}</span><button class="icon-button" data-open="${v.id}" aria-label="Mở ${e(v.title)}">${icon("arrow")}</button></article>`,
        )
        .join("")
    : `<div class="empty"><span class="empty-icon">${icon(view)}</span><h2>${search ? "Không tìm thấy nội dung" : "Chưa có video ở đây"}</h2><p>${search ? "Thử tìm bằng từ khóa khác." : view === "ideas" ? "Ghi lại nội dung ý tưởng; AI có thể gợi ý tiêu đề sau." : "Video sẽ xuất hiện khi bạn chuyển đến công đoạn này."}</p>${view === "ideas" && !search ? '<button class="primary" data-action="add">+ Thêm ý tưởng đầu tiên</button>' : ""}</div>`;
  document.querySelector("#result-count").textContent = `${list.length} video`;
  const all = document.querySelector("#select-all");
  all.checked = list.length > 0 && list.every((v) => selected.has(v.id));
  all.indeterminate = list.some((v) => selected.has(v.id)) && !all.checked;
}
function renderSelection() {
  const bar = document.querySelector("#selection");
  if (!bar) return;
  const n = selected.size,
    i = STAGES.indexOf(view);
  const quickButton = document.querySelector(".quick-record-button");
  if (quickButton) quickButton.hidden = n > 0;
  bar.innerHTML =
    n && !editing && view !== "research"
      ? `<div class="selection-bar"><span><b>${n}</b> đã chọn</span><button data-action="deselect">Bỏ chọn</button><div class="selection-actions">${i > 0 ? `<button data-move="${STAGES[i - 1]}" aria-label="Về ${LABELS[i - 1]}">${icon("back")} ${LABELS[i - 1]}</button>` : ""}${i >= 0 && i < 4 ? `<button class="primary" data-move="${STAGES[i + 1]}">${i === 2 ? "Đã quay xong → Hoàn thiện" : `Chuyển sang ${LABELS[i + 1]}`} ${icon("arrow")}</button>` : ""}${view === "archive" || view === "trash" ? '<button class="primary" data-action="restore">Khôi phục</button>' : `<button data-action="archive">${icon("archive")} Lưu trữ</button>`}${view === "trash" ? '<button class="danger" data-action="purge">Xóa vĩnh viễn</button>' : `<button class="danger" data-action="delete">${icon("trash")} Xóa</button>`}</div></div>`
      : "";
}
async function reload() {
  records = await db.all(scope);
}
function enqueue(id, change) {
  const activeScope = scope;
  writeChain = writeChain
    .catch(() => {})
    .then(async () => {
      const saved = await db.mutate(activeScope, id, (old) => {
        const video =
          typeof change === "function"
            ? change(old?.video)
            : { ...old.video, ...change };
        return {
          ...old,
          video: { ...video, updated_at: new Date().toISOString() },
          dirty: activeScope !== "demo",
          token: crypto.randomUUID(),
        };
      });
      if (scope === activeScope) {
        const index = records.findIndex((r) => r.video.id === id);
        if (index < 0) records.push(saved);
        else records[index] = saved;
        updateStatus();
      }
    });
  return writeChain;
}
function busy() {
  app.querySelectorAll("button,input").forEach((el) => (el.disabled = true));
}
async function batch(action) {
  const ids = [...selected],
    now = new Date().toISOString();
  if (
    action === "purge" &&
    !confirm(
      `Xóa vĩnh viễn ${ids.length} video? Không thể khôi phục nội dung sau thao tác này.`,
    )
  )
    return;
  if (
    action === "delete" &&
    !confirm(`Chuyển ${ids.length} video vào thùng rác?`)
  )
    return;
  busy();
  try {
    for (const id of ids)
      await enqueue(id, (v) =>
        action === "archive"
          ? { ...v, archived_at: now }
          : action === "delete"
            ? { ...v, deleted_at: now }
            : action === "restore"
              ? { ...v, deleted_at: null, archived_at: null }
              : {
                  ...v,
                  title: "",
                  notes: "",
                  script: "",
                  source_url: "",
                  postproduction_notes: "",
                  draft_url: "",
                  youtube_url: "",
                  purged_at: now,
                },
      );
    selected.clear();
    render();
    scheduleSync();
    toast("Đã lưu thay đổi trên thiết bị");
  } catch {
    toast("Không thể lưu. Nội dung vẫn đang mở; hãy sao lưu và thử lại.");
    render();
  }
}
async function move(stage) {
  if (
    stage === "filming" &&
    videos().some((v) => selected.has(v.id) && !v.script.trim()) &&
    !confirm("Có video chưa có kịch bản. Vẫn chuyển sang Chờ quay?")
  )
    return;
  const ids = [...selected];
  busy();
  try {
    for (const id of ids) await enqueue(id, (v) => transition(v, stage));
    selected.clear();
    render();
    scheduleSync();
    toast("Đã chuyển công đoạn");
  } catch {
    toast("Không thể lưu thay đổi. Vui lòng thử lại.");
    render();
  }
}
function modal(html) {
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${html.title}</h2><button class="icon-button" data-action="close" aria-label="Đóng">${icon("close")}</button></div>${html.body}`;
  dialog.setAttribute("aria-labelledby", "dialog-title");
  if (!dialog.open) dialog.showModal();
}
function addModal() {
  modal({
    title: "Thêm ý tưởng",
    body: [
      '<form id="add-form" class="idea-create-form">',
      '<label class="field" for="new-idea-title">Tiêu đề video',
      '<input id="new-idea-title" name="title" type="text" autofocus placeholder="Nhập tiêu đề (có thể để trống)"></label>',
      '<label class="field" for="new-idea-content">Nội dung ý tưởng',
      '<textarea id="new-idea-content" name="content" rows="7" aria-label="Nội dung ý tưởng" placeholder="Viết ý tưởng hoặc bấm biểu tượng micro để ghi âm…"></textarea></label>',
      '<p class="muted">Có thể chỉ nhập nội dung; AI sẽ thử gợi ý tiêu đề khi lưu.</p>',
      '<div class="dialog-footer"><button type="button" data-action="close">Hủy</button><button class="primary" type="submit">Lưu ý tưởng ',
      icon("plus"),
      '</button></div></form>',
      '<details class="bulk-idea"><summary>Thêm nhiều tiêu đề cùng lúc</summary><form id="bulk-add-form">',
      '<label class="field">Danh sách tiêu đề (mỗi dòng một ý tưởng)',
      '<textarea name="titles" rows="6" required placeholder="Một ý tưởng mới…&#10;Một câu chuyện đáng kể…"></textarea></label>',
      '<div id="duplicates"></div><div class="dialog-footer"><button class="primary" type="submit">',
      'Thêm vào kho ý tưởng ', icon("plus"), '</button></div></form></details>',
    ].join(""),
  });

  dialog.querySelector("#add-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const title = form.elements.title.value.trim();
    const content = form.elements.content.value.trim();
    if (!title && !content) {
      form.elements.content.focus();
      toast("Hãy nhập tiêu đề hoặc nội dung ý tưởng.");
      return;
    }
    if (title && parseTitles(title, videos())[0]?.duplicate &&
        !confirm("Tiêu đề này đã tồn tại. Vẫn thêm ý tưởng mới?")) return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const video = { ...createVideo(title, user?.id), notes: content };
    try {
      await enqueue(video.id, () => video);
      dialog.close();
      view = "ideas";
      editing = null;
      render();
      scheduleSync();
      toast("Đã thêm ý tưởng");
      if (!title && content) void suggestNewIdeaTitle(video.id, content);
    } catch {
      toast("Không thể lưu ý tưởng. Hãy giữ nội dung đang nhập và thử lại.");
      submit.disabled = false;
    }
  };

  let reviewed = false;
  dialog.querySelector("#bulk-add-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const parsed = parseTitles(form.elements.titles.value, videos());
    if (!parsed.length) return;
    const duplicates = parsed.filter((x) => x.duplicate);
    if (duplicates.length && !reviewed) {
      dialog.querySelector("#duplicates").innerHTML =
        '<div class="warning">Có ' + duplicates.length +
        ' tiêu đề trùng. Tích chọn những tiêu đề trùng bạn muốn giữ; bỏ tích để bỏ qua.</div>' +
        parsed.map((p, i) => (p.duplicate
          ? '<label class="duplicate"><input type="checkbox" name="keep" value="' +
            i + '"> ' + e(p.title) + '</label>'
          : '')).join('');
      reviewed = true;
      form.elements.titles.oninput = () => {
        reviewed = false;
        dialog.querySelector("#duplicates").innerHTML = "";
      };
      return;
    }
    const keeps = new Set(
      [...form.querySelectorAll("[name=keep]:checked")].map((x) => +x.value),
    );
    form.querySelector("[type=submit]").disabled = true;
    let added = 0;
    try {
      for (const [i, p] of parsed.entries()) {
        if (p.duplicate && !keeps.has(i)) continue;
        const video = createVideo(p.title, user?.id);
        await enqueue(video.id, () => video);
        added++;
      }
      dialog.close();
      render();
      scheduleSync();
      toast("Đã thêm " + added + " ý tưởng");
    } catch {
      toast("Không thể lưu tất cả tiêu đề. Hãy kiểm tra bộ nhớ thiết bị.");
      form.querySelector("[type=submit]").disabled = false;
    }
  };
}

// Save a voice-captured idea directly into the idea inbox after user confirmation.
async function saveQuickRecordedIdea(value) {
  const content = value.trim();
  if (!content) return;
  const video = { ...createVideo("", user?.id), notes: content };
  try {
    await enqueue(video.id, () => video);
    editing = null;
    selected.clear();
    search = "";
    view = "ideas";
    render();
    scheduleSync();
    toast("Đã lưu ý tưởng từ ghi âm");
    void suggestNewIdeaTitle(video.id, content);
  } catch {
    editing = null;
    view = "ideas";
    render();
    addModal();
    const field = dialog.querySelector("#new-idea-content");
    if (field) field.value = content;
    toast("Chưa lưu được. Nội dung đã được giữ trong biểu mẫu để anh thử lại.");
  }
}

// Suggest a title after saving the content; do not block the creation flow.
async function suggestNewIdeaTitle(id, content) {
  try {
    const suggestion = (await voiceRequest("title", content, new AbortController().signal)).trim();
    if (!suggestion) return;
    const current = videos().find((v) => v.id === id);
    if (!current || current.title.trim() || current.notes.trim() !== content || current.deleted_at) return;
    await enqueue(id, (v) =>
      v.title.trim() || v.notes.trim() !== content
        ? v
        : { ...v, title: suggestion },
    );
    scheduleSync();
    if (!editing && !dialog.open && view === "ideas") render();
  } catch {
    // Keep saved content intact when AI title generation is unavailable.
  }
}

function editorHTML() {
  const v = videos().find((x) => x.id === editing);
  if (!v) {
    editing = null;
    return listHTML();
  }
  const isIdea = v.stage === "ideas";
  const primaryField = isIdea ? "notes" : "script";
  const primaryId = isIdea ? "idea-content" : "script";
  const primaryText = v[primaryField] || "";
  return `<section class="editor"><div class="editor-top"><button data-action="back">${icon("back")} Danh sách</button><span id="save-state" role="status">Đã lưu trên thiết bị</span></div><div class="editor-heading"><span class="eyebrow">${e(LABELS[STAGES.indexOf(v.stage)])}</span><label class="sr-only" for="video-title">Tiêu đề video</label><input class="title-input" id="video-title" data-field="title" value="${e(v.title)}" placeholder="Tiêu đề (có thể để trống để AI gợi ý)">${isIdea ? '<div class="title-ai-tools"><button type="button" data-action="suggest-title">Gợi ý tiêu đề từ nội dung</button><small id="title-suggestion-status" role="status"></small></div>' : ""}${isIdea && !primaryText.trim() && v.title.trim().length > 110 ? '<button type="button" data-action="move-title-to-content">Chuyển phần ghi nhầm ở tiêu đề xuống nội dung</button>' : ""}</div><div class="editor-grid"><div class="script-panel panel"><div class="script-toolbar"><h2>${isIdea ? "Nội dung ý tưởng" : "Nội dung kịch bản"}</h2><span id="word-count">${primaryText.trim() ? primaryText.trim().split(/\s+/).length : 0} từ</span></div><textarea id="${primaryId}" data-field="${primaryField}" placeholder="${isIdea ? "Nói hoặc viết toàn bộ ý tưởng ở đây. Bấm Ghi âm để bắt đầu…" : "Bắt đầu câu chuyện của bạn…"}" aria-label="${isIdea ? "Nội dung ý tưởng" : "Nội dung kịch bản"}">${e(primaryText)}</textarea></div><aside class="details panel"><h2>Thông tin video</h2>${field("Nguồn tham khảo", "source_url", v.source_url, "url")}${isIdea ? (v.script?.trim() ? field("Kịch bản đã soạn", "script", v.script, "textarea") : "") : field("Ghi chú ý tưởng", "notes", v.notes, "textarea")}${field("Ghi chú hậu kỳ", "postproduction_notes", v.postproduction_notes, "textarea")}${field("Liên kết bản dựng", "draft_url", v.draft_url, "url")}${field("Đường dẫn YouTube", "youtube_url", v.youtube_url, "url")}${field("Ngày xuất bản", "published_at", v.published_at?.slice(0, 10) || "", "date")}<small>Ngày tạo: ${date(v.created_at)}</small></aside></div></section>`;
}
function field(label, key, value, type) {
  return `<label class="field">${label}${type === "textarea" ? `<textarea data-field="${key}" rows="3">${e(value)}</textarea>` : `<input data-field="${key}" type="${type}" value="${e(value)}" placeholder="${type === "url" ? "https://…" : ""}">`}</label>`;
}
function bindEditor() {
  app.querySelectorAll("[data-field]").forEach((input) =>
    input.addEventListener("input", () => {
      const id = editing,
        key = input.dataset.field,
        value = input.value;
      document.querySelector("#save-state").textContent = "Đang lưu…";
      if (input.id === "script" || input.id === "idea-content")
        document.querySelector("#word-count").textContent =
          `${value.trim() ? value.trim().split(/\s+/).length : 0} từ`;
      enqueue(id, {
        [key]:
          key === "published_at"
            ? value
              ? new Date(`${value}T12:00:00`).toISOString()
              : null
            : value,
      })
        .then(() => {
          if (editing === id)
            document.querySelector("#save-state").textContent = user
              ? "Đã lưu trên thiết bị · Chờ đồng bộ"
              : "Đã lưu trên thiết bị";
          scheduleSync();
        })
        .catch(() => {
          document.querySelector("#save-state").textContent =
            "Lưu thất bại — giữ màn hình này và sao chép nội dung";
          toast(
            "Không thể lưu. Đừng đóng trang; hãy sao chép kịch bản để bảo toàn nội dung.",
          );
        });
    }),
  );
}
function moveAccidentalTitleToContent() {
  const title = document.querySelector("#video-title");
  const content = document.querySelector("#idea-content");
  if (!title?.value.trim() || !content || content.value.trim()) return;
  if (!window.confirm("Chuyển toàn bộ tiêu đề hiện tại xuống Nội dung ý tưởng, rồi để AI gợi ý một tiêu đề ngắn hơn?")) return;
  content.value = title.value.trim();
  title.value = "";
  title.dispatchEvent(new Event("input", { bubbles: true }));
  content.dispatchEvent(new Event("input", { bubbles: true }));
  void suggestTitleForIdea();
}

let titleSuggestionSequence = 0;
async function suggestTitleForIdea() {
  const id = editing;
  const target = document.querySelector("#idea-content");
  const titleInput = document.querySelector("#video-title");
  const status = document.querySelector("#title-suggestion-status");
  if (!id || !target || !titleInput || titleInput.value.trim()) return;
  const content = target.value.trim();
  if (!content) {
    if (status) status.textContent = "Hãy nhập hoặc ghi âm nội dung ý tưởng trước.";
    return;
  }
  const sequence = ++titleSuggestionSequence;
  if (status) status.textContent = "Đang đề xuất tiêu đề…";
  try {
    const suggestion = await voiceRequest("title", content, new AbortController().signal);
    if (
      sequence !== titleSuggestionSequence ||
      editing !== id ||
      document.querySelector("#idea-content")?.value.trim() !== content ||
      titleInput !== document.querySelector("#video-title") ||
      titleInput.value.trim()
    ) return;
    titleInput.value = suggestion;
    titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    if (status) status.textContent = "Đã gợi ý tiêu đề. Anh có thể chỉnh sửa.";
  } catch {
    if (status?.isConnected && editing === id)
      status.textContent = "Chưa gợi ý được tiêu đề. Nội dung đã được giữ; bấm để thử lại.";
  }
}

async function showProvenance() {
  const video = videos().find((v) => v.id === editing);
  if (!video) return;
  const target = document.createElement("section");
  target.className = "research-provenance";
  document.querySelector(".details")?.append(target);
  try {
    const links = await provenance(user, video);
    if (!target.isConnected) return;
    target.innerHTML = links.length
      ? "<h3>Hồ sơ nghiên cứu gốc</h3>" +
        links
          .map((link) => {
            const snapshot = link.snapshot || { video: link };
            const proposal = snapshot.video || {},
              data = proposal.data || {},
              analysis = proposal.analysis || {};
            return `<details><summary>${e(data.title || "Nguồn YouTube")}</summary><p>${e((proposal.sources || []).join(" · "))}</p><p>${e(analysis.angle || "")}</p><pre>${e(JSON.stringify(snapshot, null, 2))}</pre></details>`;
          })
          .join("")
      : "";
  } catch {
    if (target.isConnected)
      target.textContent =
        "Chưa tải được hồ sơ nghiên cứu. Nguồn và dữ liệu trên thiết bị vẫn được giữ.";
  }
}
function settings() {
  modal({
    title: "Cài đặt",
    body: `<section class="settings-section"><h3>Cỡ chữ</h3><div class="font-options">${[
      ["small", "Nhỏ"],
      ["medium", "Trung bình"],
      ["large", "Lớn"],
    ]
      .map(
        ([v, l]) =>
          `<button data-scale="${v}" aria-pressed="${document.documentElement.dataset.size === v}">${l}</button>`,
      )
      .join(
        "",
      )}</div></section><section class="settings-section"><h3>Tài khoản & đồng bộ</h3><p class="muted" data-status>${e(status())}</p>${!cloud ? "<p>Chưa kết nối Supabase. Dữ liệu trải nghiệm chỉ ở trình duyệt này, chưa đồng bộ giữa các thiết bị. Xóa dữ liệu trình duyệt sẽ xóa dữ liệu cục bộ.</p>" : user ? `<p>${e(user.email)}</p><button data-action="sync">Đồng bộ lại</button><button data-action="logout">Đăng xuất</button>` : `<form id="auth-form"><label class="field">Email<input name="email" type="email" autocomplete="email" required></label><label class="field">Mật khẩu<input name="password" type="password" minlength="8" autocomplete="current-password" required></label><div class="auth-actions"><button class="primary" type="submit">Đăng nhập</button><button type="button" data-action="signup">Tạo tài khoản</button></div><p class="muted">Không gian trải nghiệm và dữ liệu tài khoản được lưu riêng.</p></form>`}<p id="auth-status" role="status"></p></section>${records
      .filter((r) => r.conflict)
      .map(
        (r) =>
          `<section class="settings-section"><h3>Xung đột: ${e(r.video.title)}</h3><p>Bản trên thiết bị vẫn được giữ. Hãy tải bản sao trước khi chọn phiên bản.</p><button data-conflict="${r.video.id}" data-choice="local">Giữ bản thiết bị</button><button data-conflict="${r.video.id}" data-choice="remote">Dùng bản máy chủ</button></section>`,
      )
      .join(
        "",
      )}<section class="settings-section"><h3>Dữ liệu & ứng dụng</h3><button data-action="export">Tải bản sao JSON</button><p class="muted">iPhone: mở bằng Safari → Chia sẻ → Thêm vào Màn hình chính. Cần truy cập trang qua HTTPS.</p><div class="mobile-utilities"><button data-view="archive">Lưu trữ (${count("archive")})</button><button data-view="trash">Thùng rác (${count("trash")})</button></div></section>`,
  });
  const form = dialog.querySelector("#auth-form");
  if (form)
    form.onsubmit = (ev) => {
      ev.preventDefault();
      authenticate(false);
    };
}
async function authenticate(signup) {
  const f = dialog.querySelector("#auth-form");
  if (!f.reportValidity()) return;
  const label = dialog.querySelector("#auth-status");
  label.textContent = "Đang kết nối…";
  try {
    const credentials = {
      email: f.elements.email.value,
      password: f.elements.password.value,
    };
    const { error } = signup
      ? await cloud.auth.signUp(credentials)
      : await cloud.auth.signInWithPassword(credentials);
    if (error) throw error;
    label.textContent = signup
      ? "Kiểm tra email để xác nhận tài khoản (nếu được yêu cầu)."
      : "Đăng nhập thành công";
  } catch (err) {
    label.textContent = `Không thể đăng nhập/đăng ký: ${err.message}`;
  }
}
function scheduleSync() {
  clearTimeout(scheduleSync.timer);
  scheduleSync.timer = setTimeout(sync, 900);
}
async function sync() {
  if (!user || working) return;
  working = true;
  const myScope = scope;
  syncMessage = "Đang đồng bộ…";
  updateStatus();
  try {
    await writeChain;
    await reload();
    for (const record of records.filter((r) => r.dirty && !r.conflict)) {
      const remote = await saveVideo(record.video, record.video.revision);
      if (scope !== myScope) return;
      if (!remote) {
        const remotes = await fetchVideos(),
          other = remotes.find((v) => v.id === record.video.id);
        await db.mutate(scope, record.video.id, (current) => ({
          ...current,
          conflict: other || {
            ...record.video,
            purged_at: new Date().toISOString(),
          },
        }));
        continue;
      }
      await db.mutate(scope, record.video.id, (current) =>
        current.token === record.token
          ? { ...current, video: remote, dirty: false, conflict: null }
          : {
              ...current,
              video: { ...current.video, revision: remote.revision },
            },
      );
    }
    const remoteVideos = await fetchVideos();
    if (scope !== myScope) return;
    for (const video of remoteVideos)
      await db.mutate(scope, video.id, (current) =>
        current?.dirty ||
        (editing === video.id &&
          current &&
          current.video.revision !== video.revision)
          ? current
          : { video, dirty: false, token: crypto.randomUUID() },
      );
    await reload();
    syncMessage = "";
    if (!editing && !dialog.open && view !== "research") render();
    else updateStatus();
  } catch (err) {
    syncMessage = "Chưa đồng bộ · Bản trên thiết bị được giữ";
    updateStatus();
    console.warn("Content sync failed:", err.code || "network");
  } finally {
    working = false;
  }
}
async function changeSession(session) {
  await writeChain.catch(() => {});
  const newUser = session?.user || null;
  if (newUser?.id === user?.id && generation) return;
  generation++;
  voice.cancel();
  resetResearch();
  user = newUser;
  scope = user?.id || "demo";
  selected.clear();
  editing = null;
  search = "";
  view = "ideas";
  syncMessage = "";
  await reload();
  if (dialog.open) dialog.close();
  render();
  if (user) sync();
}
async function exportData() {
  await writeChain;
  await reload();
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            application: "Super Content",
            exported_at: new Date().toISOString(),
            videos: videos(),
            conflicts: records
              .filter((r) => r.conflict)
              .map((r) => ({ id: r.video.id, remote: r.conflict })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `super-content-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener("click", async (ev) => {
  if (!ev.target.closest(".utility-dropdown"))
    document.querySelector(".utility-dropdown[open]")?.removeAttribute("open");
  const b = ev.target.closest("button");
  if (!b) return;
  try {
    if (b.dataset.view) {
      await writeChain;
      view = b.dataset.view;
      editing = null;
      selected.clear();
      search = "";
      dialog.close();
      render();
    } else if (b.dataset.open) {
      editing = b.dataset.open;
      selected.clear();
      render();
    } else if (b.dataset.move) await move(b.dataset.move);
    else if (b.dataset.scale) {
      setScale(b.dataset.scale);
      settings();
    } else if (b.dataset.conflict) {
      const id = b.dataset.conflict,
        choice = b.dataset.choice;
      if (
        !confirm(
          "Áp dụng phiên bản đã chọn? Nên tải bản sao JSON trước khi tiếp tục.",
        )
      )
        return;
      await db.mutate(scope, id, (r) =>
        choice === "remote"
          ? { ...r, video: r.conflict, dirty: false, conflict: null }
          : {
              ...r,
              video: { ...r.video, revision: r.conflict.revision },
              conflict: null,
              dirty: true,
              token: crypto.randomUUID(),
            },
      );
      await reload();
      settings();
      scheduleSync();
    } else
      switch (b.dataset.action) {
        case "add":
          addModal();
          break;
        case "quick-record": {
          if (!user) {
            settings();
            toast("Đăng nhập trong Cài đặt để ghi ý tưởng bằng AI.");
            break;
          }
          const scratch = document.querySelector("#quick-idea-content");
          if (!scratch) break;
          scratch.value = "";
          voice.open(scratch, { quick: true });
          break;
        }
        case "suggest-title":
          await suggestTitleForIdea();
          break;
        case "move-title-to-content":
          moveAccidentalTitleToContent();
          break;
        case "settings":
          settings();
          break;
        case "close":
          dialog.close();
          break;
        case "back":
          await writeChain;
          editing = null;
          render();
          break;
        case "deselect":
          selected.clear();
          renderRows();
          renderSelection();
          break;
        case "archive":
        case "delete":
        case "restore":
        case "purge":
          await batch(b.dataset.action);
          break;
        case "sync":
          await sync();
          toast(status());
          break;
        case "export":
          await exportData();
          break;
        case "signup":
          await authenticate(true);
          break;
        case "logout":
          if (working) {
            toast("Đang đồng bộ, vui lòng thử lại sau.");
            break;
          }
          await writeChain;
          if (
            records.some((r) => r.dirty) &&
            !confirm(
              "Có thay đổi chưa đồng bộ. Chúng sẽ được giữ trên thiết bị cho tài khoản này. Vẫn đăng xuất?",
            )
          )
            break;
          {
            const { error } = await cloud.auth.signOut({ scope: "local" });
            if (error) throw error;
          }
          break;
      }
  } catch (err) {
    toast(`Không thể hoàn tất: ${err.message}`);
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  const menu = document.querySelector(".utility-dropdown[open]");
  if (menu) {
    menu.removeAttribute("open");
    menu.querySelector("summary")?.focus();
  }
});
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.classList.contains("row-check")) {
    el.checked ? selected.add(el.dataset.id) : selected.delete(el.dataset.id);
    renderRows();
    renderSelection();
  }
  if (el.id === "select-all") {
    rows().forEach((v) =>
      el.checked ? selected.add(v.id) : selected.delete(v.id),
    );
    renderRows();
    renderSelection();
  }
});
document.addEventListener("input", (ev) => {
  if (ev.target.id === "search") {
    search = ev.target.value;
    selected.clear();
    renderRows();
    renderSelection();
  }
});

// Prevent accidental page zoom on touch devices while preserving normal scrolling.
if (window.matchMedia("(pointer: coarse)").matches) {
  const preventPinch = (event) => {
    if (event.cancelable) event.preventDefault();
  };
  for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(name, preventPinch, { passive: false });
  }
  document.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 1 && event.cancelable) event.preventDefault();
    },
    { passive: false },
  );
}

window.addEventListener("online", sync);
setInterval(() => {
  if (user) sync();
}, 15000);
window.addEventListener("beforeunload", (ev) => {
  if (
    document.querySelector("#save-state")?.textContent.startsWith("Đang lưu") ||
    document
      .querySelector("#save-state")
      ?.textContent.startsWith("Lưu thất bại")
  ) {
    ev.preventDefault();
    ev.returnValue = "";
  }
});
try {
  await reload();
  render();
  if (cloud) {
    cloud.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => changeSession(session), 0);
    });
    const { data, error } = await cloud.auth.getSession();
    if (error) throw error;
    await changeSession(data.session);
  }
} catch {
  app.innerHTML =
    '<main class="fatal"><h1>Chưa mở được dữ liệu</h1><p>Hãy cho phép trình duyệt lưu dữ liệu rồi tải lại trang. Không xóa dữ liệu trình duyệt nếu bạn đã có kịch bản.</p></main>';
}
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  const register = () =>
    navigator.serviceWorker
      .register("./sw.js")
      .catch(() => toast("Chưa bật được chế độ ngoại tuyến."));
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
