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
  document
    .querySelectorAll("[data-status]")
    .forEach((el) => (el.textContent = status()));
}
function render() {
  app.innerHTML = `<aside class="sidebar"><a class="brand" href="./"><span class="brand-mark">${icon(publishedIcon())}</span><span>super content<span class="orange">.</span></span></a><div class="nav-caption">KHÔNG GIAN SẢN XUẤT</div><nav>${nav()}</nav><div class="side-extra"><button data-view="archive" class="nav-item ${view === "archive" ? "active" : ""}">${icon("archive")}<span>Lưu trữ</span><b>${count("archive")}</b></button><button data-view="trash" class="nav-item ${view === "trash" ? "active" : ""}">${icon("trash")}<span>Thùng rác</span><b>${count("trash")}</b></button></div><div class="side-bottom"><span class="avatar">${user ? "SC" : "T"}</span><div><strong>${user ? "Tài khoản của bạn" : "Không gian trải nghiệm"}</strong><small>${e(user?.email || "Dữ liệu trên thiết bị này")}</small></div></div></aside><main><header class="topbar"><span class="breadcrumb">Super Content <span>/</span> ${e(editing ? "Soạn thảo" : LABELS[STAGES.indexOf(view)] || (view === "archive" ? "Lưu trữ" : "Thùng rác"))}</span><button class="icon-button" data-action="settings" aria-label="Cài đặt">${icon("settings")}</button></header><div class="local-notice"><span class="status-dot"></span><span data-status>${e(status())}</span><button data-action="${user ? "sync" : "settings"}">${user ? "Đồng bộ lại" : "Tài khoản & cài đặt"} ${icon("arrow")}</button></div><div id="content">${editing ? editorHTML() : listHTML()}</div></main><nav class="mobile-nav">${nav()}</nav><div id="selection"></div>`;
  if (!editing) renderRows();
  else bindEditor();
  renderSelection();
}
function publishedIcon() {
  return "published";
}
function listHTML() {
  const i = STAGES.indexOf(view);
  return `<section class="page-heading"><div><div class="eyebrow">${i >= 0 ? `CÔNG ĐOẠN 0${i + 1} / 05` : "QUẢN LÝ NỘI DUNG"}</div><h1>${LABELS[i] || (view === "archive" ? "Lưu trữ" : "Thùng rác")}<span class="heading-count">${count(view)}</span></h1><p>${["Lưu lại ý tưởng. Chọn nội dung bạn muốn bắt đầu.", "Phát triển ý tưởng thành câu chuyện của bạn.", "Kịch bản đã sẵn sàng. Đến lúc bấm máy.", "Dựng phim và hoàn thiện những chi tiết cuối.", "Những nội dung đã đến với khán giả."][i] || "Nội dung được giữ lại cùng toàn bộ thông tin."}</p></div>${view === "ideas" ? `<button class="primary" data-action="add">${icon("plus")} Thêm ý tưởng</button>` : ""}</section><section class="panel list-panel"><div class="list-toolbar"><label class="search">${icon("search")}<input id="search" placeholder="Tìm kiếm tiêu đề, ghi chú…" aria-label="Tìm kiếm" value="${e(search)}"></label><span class="sort-label">Mới nhất trước</span></div><div class="list-caption"><label><input type="checkbox" id="select-all"> <span>Chọn tất cả</span></label><span id="result-count"></span></div><div id="rows"></div></section><div class="list-foot">${icon("check")} Mỗi video, một hồ sơ xuyên suốt 5 công đoạn.</div>`;
}
function renderRows() {
  const list = rows(),
    container = document.querySelector("#rows");
  if (!container) return;
  container.innerHTML = list.length
    ? list
        .map(
          (v) =>
            `<article class="video-row ${selected.has(v.id) ? "selected" : ""}"><label class="row-selector"><input type="checkbox" class="row-check" data-id="${v.id}" aria-label="Chọn ${e(v.title)}" ${selected.has(v.id) ? "checked" : ""}></label><button class="video-main" data-open="${v.id}"><strong>${e(v.title)}</strong><span>${date(v.created_at)} <i>·</i> ${e(v.notes?.slice(0, 90) || "Chưa có ghi chú")}${v.stage === "published" ? ` <i>·</i> Đăng ${date(v.published_at)}` : ""}</span></button><span class="tag ${v.script ? "ready" : ""}">${view === "script" ? (v.script ? "Đang viết" : "Chưa viết") : e(LABELS[STAGES.indexOf(v.stage)])}</span><button class="icon-button" data-open="${v.id}" aria-label="Mở ${e(v.title)}">${icon("arrow")}</button></article>`,
        )
        .join("")
    : `<div class="empty"><span class="empty-icon">${icon(view)}</span><h2>${search ? "Không tìm thấy nội dung" : "Chưa có video ở đây"}</h2><p>${search ? "Thử tìm bằng từ khóa khác." : view === "ideas" ? "Thêm một tiêu đề hoặc dán nhiều dòng để bắt đầu." : "Video sẽ xuất hiện khi bạn chuyển đến công đoạn này."}</p>${view === "ideas" && !search ? '<button class="primary" data-action="add">+ Thêm ý tưởng đầu tiên</button>' : ""}</div>`;
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
  bar.innerHTML =
    n && !editing
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
    body: `<p class="muted">Mỗi dòng là một tiêu đề. Bạn có thể dán cả danh sách.</p><form id="add-form"><label class="field">Tiêu đề video<textarea name="titles" rows="8" autofocus required placeholder="Một ý tưởng mới…\nMột câu chuyện đáng kể…"></textarea></label><div id="duplicates"></div><div class="dialog-footer"><button type="button" data-action="close">Hủy</button><button class="primary" type="submit">Thêm vào kho ý tưởng ${icon("plus")}</button></div></form>`,
  });
  let reviewed = false;
  dialog.querySelector("#add-form").onsubmit = async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget,
      parsed = parseTitles(form.elements.titles.value, videos());
    if (!parsed.length) return;
    const duplicates = parsed.filter((x) => x.duplicate);
    if (duplicates.length && !reviewed) {
      dialog.querySelector("#duplicates").innerHTML =
        `<div class="warning">Có ${duplicates.length} tiêu đề trùng. Tích chọn những tiêu đề trùng bạn muốn giữ; bỏ tích để bỏ qua.</div>${parsed.map((p, i) => (p.duplicate ? `<label class="duplicate"><input type="checkbox" name="keep" value="${i}"> ${e(p.title)}</label>` : "")).join("")}`;
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
      toast(`Đã thêm ${added} ý tưởng`);
    } catch {
      toast("Không thể lưu tất cả tiêu đề. Hãy kiểm tra bộ nhớ thiết bị.");
      form.querySelector("[type=submit]").disabled = false;
    }
  };
}
function editorHTML() {
  const v = videos().find((x) => x.id === editing);
  if (!v) {
    editing = null;
    return listHTML();
  }
  return `<section class="editor"><div class="editor-top"><button data-action="back">${icon("back")} Danh sách</button><span id="save-state" role="status">Đã lưu trên thiết bị</span></div><div class="editor-heading"><span class="eyebrow">${e(LABELS[STAGES.indexOf(v.stage)])}</span><label class="sr-only" for="video-title">Tiêu đề video</label><input class="title-input" id="video-title" data-field="title" value="${e(v.title)}" placeholder="Tiêu đề video"></div><div class="editor-grid"><div class="script-panel panel"><div class="script-toolbar"><h2>Nội dung kịch bản</h2><span id="word-count">${v.script.trim() ? v.script.trim().split(/\s+/).length : 0} từ</span></div><textarea id="script" data-field="script" placeholder="Bắt đầu câu chuyện của bạn…" aria-label="Nội dung kịch bản">${e(v.script)}</textarea></div><aside class="details panel"><h2>Thông tin video</h2>${field("Nguồn tham khảo", "source_url", v.source_url, "url")}${field("Ghi chú ý tưởng", "notes", v.notes, "textarea")}${field("Ghi chú hậu kỳ", "postproduction_notes", v.postproduction_notes, "textarea")}${field("Liên kết bản dựng", "draft_url", v.draft_url, "url")}${field("Đường dẫn YouTube", "youtube_url", v.youtube_url, "url")}${field("Ngày xuất bản", "published_at", v.published_at?.slice(0, 10) || "", "date")}<small>Ngày tạo: ${date(v.created_at)}</small></aside></div></section>`;
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
      if (key === "script")
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
    if (!editing && !dialog.open) render();
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
