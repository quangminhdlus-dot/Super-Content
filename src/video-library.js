import {clipFile, clipName, confirmClipRemoval, exportClip, frameLabel, loadVideoRuntime} from "./video-files.js";

const size = bytes => bytes < 1024 * 1024
  ? Math.ceil(bytes / 1024) + " KB"
  : (bytes / (1024 * 1024)).toLocaleString("vi-VN", {maximumFractionDigits:1}) + " MB";
const duration = seconds => seconds > 0
  ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
  : "Chưa rõ thời lượng";

export function mountVideoLibrary(host, owner, titles) {
  host.innerHTML = `<section class="page-heading"><div><h1>Video</h1></div></section>
    <section class="panel video-library">
      <p data-total role="status">Đang mở Kho Video…</p>
      <p class="muted">Video lưu trong trình duyệt này. Xóa dữ liệu website có thể làm mất video.</p>
      <div class="video-library-actions" data-selection hidden>
        <button type="button" data-select-all>Chọn tất cả</button>
        <button type="button" data-clear>Bỏ chọn</button>
        <button type="button" class="danger" data-delete-selected>Xóa đã chọn</button>
      </div>
      <p data-selected role="status" hidden></p>
      <p data-removal-status role="status" hidden></p>
      <div data-clips></div>
    </section>
    <dialog class="library-delete" aria-labelledby="library-delete-title">
      <h2 id="library-delete-title"></h2>
      <form method="dialog" class="video-library-actions">
        <button type="submit" value="cancel" autofocus>Hủy</button>
        <button type="submit" value="remove" class="danger" data-approve></button>
      </form>
    </dialog>
    <dialog class="library-player" aria-labelledby="library-video-title">
      <div class="library-player-header"><h2 id="library-video-title"></h2><button type="button" data-back>Về danh sách</button></div>
      <video controls playsinline preload="metadata"></video>
      <p data-player-info></p>
      <p data-message role="status"></p>
      <div class="video-library-actions">
        <button class="primary" type="button" data-save>Lưu vào iPhone</button>
        <button type="button" data-download>Lưu vào Tệp / tải xuống</button>
        <button type="button" data-confirm hidden>Đã lưu trên thiết bị</button>
        <button class="danger" type="button" data-delete>Xóa</button>
      </div>
    </dialog>`;
  const find = selector => host.querySelector(selector);
  const dialog = find(".library-player"), deleteDialog = find(".library-delete"), player = find("video"), list = find("[data-clips]");
  const total = find("[data-total]"), message = find("[data-message]"), info = find("[data-player-info]");
  const confirmButton = find("[data-confirm]");
  const selectedIds = new Set();
  const removalStatus = find("[data-removal-status]");
  let items = [];
  let core, active, url, closed = false, busy = false, generation = 0;

  function closePlayer() {
    generation++;
    active = undefined;
    player.pause();
    player.removeAttribute("src");
    player.load();
    if (url) URL.revokeObjectURL(url);
    url = undefined;
    dialog.close();
  }

  function refreshActions() {
    if (closed) return;
    for (const selector of ["[data-save]", "[data-download]", "[data-delete]", "[data-confirm]"]) {
      find(selector).disabled = !active || busy;
    }
    confirmButton.hidden = !active?.confirm || !!active?.clip.savedAt;
    refreshSelection();
  }

  function refreshSelection() {
    const selected = items.filter(clip => selectedIds.has(clip.id));
    const summary = find("[data-selected]");
    summary.hidden = !selected.length;
    summary.textContent = `${selected.length} video đã chọn · ${size(selected.reduce((sum, clip) => sum + clip.bytes, 0))}`;
    find("[data-selection]").hidden = !items.length;
    find("[data-select-all]").disabled = busy || selected.length === items.length;
    find("[data-clear]").disabled = busy || !selected.length;
    find("[data-delete-selected]").disabled = busy || !selected.length;
    for (const checkbox of list.querySelectorAll("input[type=checkbox]")) {
      checkbox.checked = selectedIds.has(checkbox.value);
      checkbox.disabled = busy;
    }
    for (const button of list.querySelectorAll("button")) button.disabled = busy;
  }

  async function save(download) {
    if (!active || busy) return;
    const selected = active;
    busy = true;
    selected.confirm = false;
    refreshActions();
    try {
      await exportClip(core, selected.file, download);
      if (active !== selected) return;
      selected.confirm = true;
      message.textContent = "Kiểm tra video trong Ảnh hoặc Tệp rồi xác nhận đã lưu.";
    } catch (error) {
      if (active === selected) message.textContent = error.name === "AbortError"
        ? "Đã hủy chia sẻ." : "Chưa lưu được. Thử dùng Lưu vào Tệp.";
    } finally {
      busy = false;
      refreshActions();
    }
  }

  async function open(clip, saveImmediately = false) {
    if (busy || closed) return;
    closePlayer();
    const token = generation;
    find("#library-video-title").textContent = clipName(clip);
    info.textContent = duration(clip.seconds);
    message.textContent = "Đang mở video…";
    refreshActions();
    dialog.showModal();
    try {
      const file = await clipFile(core, clip);
      if (closed || token !== generation) return;
      active = {clip, file};
      url = URL.createObjectURL(file);
      player.src = url;
      message.textContent = clip.reason || "";
      refreshActions();
      if (saveImmediately) {
        if (navigator.userActivation?.isActive !== false || !navigator.canShare?.({files:[file]})) await save(false);
        else find("[data-save]").focus();
      }
    } catch (error) {
      if (!closed && token === generation) message.textContent = error.message || "Chưa mở được tệp.";
    }
  }

  async function remove(clip) {
    if (busy || !confirmClipRemoval(clip)) return;
    await removeClips([clip]);
  }

  async function removeClips(clips) {
    if (busy || closed) return;
    busy = true;
    refreshActions();
    const removed = new Set();
    let lastError;
    try {
      removalStatus.hidden = false;
      for (const [index, clip] of clips.entries()) {
        if (closed) return;
        removalStatus.textContent = `Đang xóa ${index + 1}/${clips.length} video…`;
        try {
          await core.DraftStore.remove(clip.id, clip.owner, clip.contentId);
          removed.add(clip.id);
          selectedIds.delete(clip.id);
          if (active?.clip.id === clip.id) closePlayer();
        } catch (error) {
          lastError = error;
        }
      }
      if (closed) return;
      items = items.filter(clip => !removed.has(clip.id));
      try { await refresh(); } catch { if (!closed) renderList(); }
      if (closed) return;
      const failed = clips.length - removed.size;
      removalStatus.textContent = `Đã xóa ${removed.size} video.${failed ? ` Không xóa được ${failed} video.` : ""}`;
      if (dialog.open && failed) message.textContent = lastError?.message || "Chưa xóa được video.";
    } finally {
      busy = false;
      refreshActions();
    }
  }

  function row(clip) {
    const element = document.createElement("article");
    element.className = "video-library-row";
    element.innerHTML = `<div class="video-library-item"><input type="checkbox"><div><button class="clip-title" type="button"></button><small></small></div></div>
      <div class="video-library-actions"><button type="button">Xem lại</button><button type="button">Lưu vào iPhone</button><button class="danger" type="button">Xóa</button></div>`;
    const [title, view, store, discard] = element.querySelectorAll("button");
    title.textContent = clipName(clip);
    const checkbox = element.querySelector("input");
    checkbox.value = clip.id;
    checkbox.setAttribute("aria-label", `Chọn ${title.textContent}`);
    checkbox.onchange = () => {
      if (checkbox.checked) selectedIds.add(clip.id);
      else selectedIds.delete(clip.id);
      refreshSelection();
    };
    element.querySelector("small").textContent = [
      new Date(clip.created).toLocaleString("vi-VN"), duration(clip.seconds), size(clip.bytes),
      clip.savedAt ? "Đã xác nhận lưu" : "Chưa xác nhận lưu", !clip.complete && "Gián đoạn",
    ].filter(Boolean).join(" · ");
    title.onclick = view.onclick = () => void open(clip);
    store.onclick = () => void open(clip, true);
    discard.onclick = () => void remove(clip);
    return element;
  }

  async function refresh() {
    const current = await core.DraftStore.catalog(owner, titles);
    if (closed) return;
    items = current;
    renderList();
  }

  function renderList() {
    const bytes = items.reduce((sum, clip) => sum + clip.bytes, 0);
    total.textContent = items.length ? `${items.length} video · ${size(bytes)} trên thiết bị` : "Chưa có video.";
    list.replaceChildren(...items.map(row));
    refreshSelection();
  }

  find("[data-select-all]").onclick = () => {
    if (busy) return;
    items.forEach(clip => selectedIds.add(clip.id));
    refreshSelection();
  };
  find("[data-clear]").onclick = () => {
    if (busy) return;
    selectedIds.clear();
    refreshSelection();
  };
  find("[data-delete-selected]").onclick = () => {
    if (busy || deleteDialog.open) return;
    const clips = items.filter(clip => selectedIds.has(clip.id));
    if (!clips.length) return;
    find("#library-delete-title").textContent = `Xóa vĩnh viễn ${clips.length} video đã chọn khỏi thiết bị?`;
    find("[data-approve]").textContent = `Xóa ${clips.length} video`;
    deleteDialog.querySelector("form").onsubmit = event => {
      if (event.submitter?.value !== "remove") return;
      event.preventDefault();
      deleteDialog.close();
      void removeClips(clips);
    };
    deleteDialog.showModal();
  };

  find("[data-back]").onclick = closePlayer;
  dialog.oncancel = event => { event.preventDefault(); closePlayer(); };
  find("[data-save]").onclick = () => void save(false);
  find("[data-download]").onclick = () => void save(true);
  find("[data-delete]").onclick = () => { if (active) void remove(active.clip); };
  player.onloadedmetadata = () => {
    const actualDuration = Number.isFinite(player.duration) ? player.duration : active?.clip.seconds;
    info.textContent = [duration(actualDuration), player.videoWidth && frameLabel(player.videoWidth, player.videoHeight)].filter(Boolean).join(" · ");
  };
  player.onerror = () => {
    if (!active) return;
    message.textContent = [active.clip.reason, "Trình duyệt chưa phát được tệp này. Video vẫn có thể tải xuống."].filter(Boolean).join(" ");
  };
  confirmButton.onclick = async () => {
    if (!active || busy || !active.confirm) return;
    const selected = active;
    busy = true;
    refreshActions();
    try {
      selected.clip.savedAt = await core.DraftStore.markSaved(selected.clip.id);
      if (active === selected) message.textContent = "Đã xác nhận lưu. Video vẫn nằm trong Kho Video.";
      await refresh();
    } catch {
      if (active === selected) message.textContent = "Chưa ghi nhận được xác nhận lưu.";
    } finally {
      busy = false;
      refreshActions();
    }
  };
  void loadVideoRuntime().then(runtime => {
    if (!closed) { core = runtime; return refresh(); }
  }).catch(error => { if (!closed) total.textContent = error.message || "Không mở được Kho Video."; });

  return () => { closed = true; deleteDialog.close(); closePlayer(); host.replaceChildren(); };
}
