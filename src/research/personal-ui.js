import * as store from "./personal-client.js";
import { FIELDS, WEIGHTS } from "../../shared/personalization.js";
const e = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const when = (s) => (s ? new Date(s).toLocaleString("vi-VN") : "Chưa cập nhật");
const decisions = {
  chosen: "Chọn làm video",
  later: "Xem xét sau",
  rejected: "Không phù hợp",
  excellent: "Đặc biệt xuất sắc",
};
export async function personalView(
  target,
  tab,
  user,
  { navigate, refreshChannels },
) {
  let data;
  target.innerHTML = '<p class="muted">Đang tải không gian cá nhân…</p>';
  try {
    data = await store.loadPersonal(user);
  } catch (error) {
    target.innerHTML = `<p class="warning">${e(error.message)}</p>`;
    return;
  }
  if (!target.isConnected) return;
  let search = "",
    group = "",
    notice = "";
  const current = () =>
    data.versions.slice().sort((a, b) => b.revision - a.revision)[0] || {
      revision: 0,
      content: store.defaultCriteria(),
    };
  async function reload() {
    data = await store.loadPersonal(user);
    draw();
  }
  function draw() {
    if (!target.isConnected) return;
    target.innerHTML = `<p class="muted">${user ? "Dữ liệu riêng theo tài khoản." : "Trải nghiệm cục bộ · Chưa đồng bộ giữa các thiết bị."}</p><p id="personal-status" role="status">${e(notice)}</p>${tab === "channels" ? channelsHTML() : tab === "criteria" ? criteriaHTML() : memoryHTML()}`;
    target.onclick = handle;
    target.oninput = (ev) => {
      if (ev.target.id === "channel-search") {
        search = ev.target.value;
        renderChannelRows();
      }
    };
    target.onchange = (ev) => {
      if (ev.target.id === "channel-group-filter") {
        group = ev.target.value;
        renderChannelRows();
      }
    };
    if (tab === "channels") renderChannelRows();
    target
      .querySelector("#criteria-form")
      ?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget,
          content = { weights: {} };
        for (const k of Object.keys(FIELDS)) content[k] = f.elements[k].value;
        for (const k of Object.keys(WEIGHTS))
          content.weights[k] = Number(f.elements[k].value);
        try {
          await store.saveCriteria(user, content, current().revision);
          notice =
            "Đã lưu phiên bản tiêu chuẩn mới. Các phiên bản trước được giữ nguyên.";
          await reload();
        } catch (error) {
          status(error.message);
        }
      });
  }
  function status(text) {
    notice = text;
    const output = target.querySelector("#personal-status");
    if (output) output.textContent = text;
  }
  function channelsHTML() {
    const groups = [
      ...new Set(data.channels.map((c) => c.topic_group).filter(Boolean)),
    ];
    return `<section class="panel personal-panel"><div class="personal-heading"><h2>Kênh theo dõi <span class="heading-count">${data.channels.length}/500</span></h2><button class="primary" data-personal="refresh" ${!user ? "disabled" : ""}>Cập nhật kênh theo lô</button></div><p class="muted">Nhập ít nhất 100 kênh trong một lần; tối đa 500 kênh. Mã/tên kênh dạng @ được phân giải khi máy chủ gọi YouTube. Chỉ đọc các trang mới nhất, giữ tiến độ nếu gián đoạn.</p><label class="field">Dán đường dẫn kênh, mỗi dòng một URL<textarea id="bulk-channels" rows="5" placeholder="https://www.youtube.com/@tenkenh"></textarea></label><label class="field">Nhóm chủ đề cho lần nhập này<input id="bulk-group" maxlength="100" placeholder="Ví dụ: Sức khỏe"></label><button class="primary" data-personal="import">Nhập danh sách kênh</button><div class="channel-filters"><label class="field">Tìm kênh<input id="channel-search" type="search" value="${e(search)}"></label><label class="field">Nhóm<select id="channel-group-filter"><option value="">Tất cả nhóm</option>${groups.map((g) => `<option ${g === group ? "selected" : ""}>${e(g)}</option>`).join("")}</select></label></div><div id="channel-rows"></div></section>`;
  }
  function renderChannelRows() {
    target.querySelector("#channel-rows").innerHTML =
      data.channels
        .filter(
          (c) =>
            (!group || c.topic_group === group) &&
            `${c.title} ${c.url} ${c.youtube_channel_id || ""}`
              .toLocaleLowerCase("vi")
              .includes(search.toLocaleLowerCase("vi")),
        )
        .map(
          (c) =>
            `<article class="channel-row"><label class="channel-enable"><input type="checkbox" data-channel-toggle="${c.id}" ${c.enabled ? "checked" : ""} ${c.duplicate_of ? "disabled" : ""}> Theo dõi</label><div><strong>${e(c.title || c.url)}</strong><small>${e(c.youtube_channel_id || "Chờ phân giải mã kênh")} ${c.duplicate_of ? "· Kênh trùng đã được tắt" : ""}</small><a href="${e(c.url)}" target="_blank" rel="noopener noreferrer">${e(c.url)}</a><small>Cập nhật dữ liệu: ${when(c.last_checked_at)} · Sửa cấu hình: ${when(c.updated_at)}</small></div><label class="field">Nhóm<input data-channel-group="${c.id}" maxlength="100" value="${e(c.topic_group)}"></label><button data-save-channel="${c.id}">Lưu nhóm</button><button class="danger" data-remove-personal-channel="${c.id}">Xóa kênh</button></article>`,
        )
        .join("") || '<p class="muted">Không có kênh phù hợp.</p>';
    target.querySelectorAll("[data-channel-toggle]").forEach(
      (input) =>
        (input.onchange = async () => {
          const c = data.channels.find(
            (c) => c.id === input.dataset.channelToggle,
          );
          try {
            await store.saveChannels(user, [{ ...c, enabled: input.checked }]);
            notice = "Đã cập nhật theo dõi.";
            await reload();
          } catch (error) {
            status(error.message);
            input.checked = !input.checked;
          }
        }),
    );
  }
  function criteriaHTML() {
    const c = current();
    return `<section class="panel personal-panel"><h2>Tiêu chuẩn nội dung</h2><p class="muted">Phiên bản hiện tại: ${c.revision || "Chưa lưu"}. Bộ đánh giá và AI dùng trực tiếp các tiêu chuẩn này. Không có cơ chế tự sửa tiêu chuẩn hoặc trọng số.</p><form id="criteria-form">${Object.entries(
      FIELDS,
    )
      .map(
        ([k, label]) =>
          `<label class="field">${label}<textarea name="${k}" rows="4" maxlength="12000">${e(c.content[k])}</textarea></label>`,
      )
      .join(
        "",
      )}<h3>Trọng số (0–100, được chuẩn hóa khi chấm điểm)</h3><div class="weight-grid">${Object.entries(
      WEIGHTS,
    )
      .map(
        ([k, label]) =>
          `<label class="field">${label}<input name="${k}" type="number" min="0" max="100" value="${c.content.weights[k]}" required></label>`,
      )
      .join(
        "",
      )}</div><button class="primary" type="submit">Lưu tiêu chuẩn mới</button></form><h3 class="section-spacer">Lịch sử thay đổi</h3>${
      data.versions
        .map(
          (v) =>
            `<details class="history-item"><summary>Phiên bản ${v.revision} · ${when(v.created_at)}</summary>${Object.entries(
              FIELDS,
            )
              .map(
                ([k, label]) => `<p><b>${label}</b><br>${e(v.content[k])}</p>`,
              )
              .join(
                "",
              )}<pre>${e(JSON.stringify(v.content.weights, null, 2))}</pre><button data-restore-criteria="${v.id}">Dùng nội dung này làm phiên bản mới</button></details>`,
        )
        .join("") || "<p>Chưa có lịch sử.</p>"
    }</section>`;
  }
  function memoryHTML() {
    return `<section class="panel personal-panel"><h2>Bộ nhớ học hỏi</h2><p class="muted">Chỉ những ghi nhớ đã xác nhận được dùng cho lần đánh giá tiếp theo. Không huấn luyện lại mô hình, không tự thay đổi tiêu chuẩn. Xóa ghi nhớ dừng việc truy xuất nó; lịch sử quyết định/đánh giá vẫn được giữ.</p><h3>Ghi nhớ đã lưu</h3>${data.memories.map((m) => `<article class="memory-item"><strong>${e(m.video_title || "Ghi nhớ cá nhân")}</strong><label class="field">Nội dung ghi nhớ<textarea data-memory-text="${m.id}" rows="3" maxlength="2000">${e(m.text)}</textarea></label><label class="field">Xu hướng<select data-memory-preference="${m.id}"><option value="positive" ${m.preference === "positive" ? "selected" : ""}>Ưu tiên</option><option value="negative" ${m.preference === "negative" ? "selected" : ""}>Thường loại</option></select></label><label><input type="checkbox" data-memory-confirmed="${m.id}" ${m.confirmed ? "checked" : ""}> Tôi xác nhận dùng ghi nhớ này</label><div class="research-buttons"><button data-save-memory="${m.id}">Lưu ghi nhớ</button><button class="danger" data-delete-memory="${m.id}">Xóa ghi nhớ</button></div></article>`).join("") || '<p class="muted">Chưa có ghi nhớ được xác nhận.</p>'}<h3 class="section-spacer">Lịch sử lựa chọn</h3>${
      data.feedback
        .map(
          (f) =>
            `<article class="history-item"><b>${e(decisions[f.decision])} · ${e(f.video_snapshot?.title || f.youtube_id)}</b><p>${e(f.reason || "Không ghi lý do")}</p><small>${when(f.created_at)} · Tiêu chuẩn lúc lựa chọn: ${e(data.versions.find((v) => v.id === f.criteria_version)?.revision || "Chưa có")} · Bản đánh giá: ${e(f.evaluated_version || "Chưa cá nhân hóa")}</small><p class="muted">Nhiệm vụ: ${e(f.research_context?.mission?.name || f.research_context?.mission?.description || "Chưa gắn nhiệm vụ")}</p><label class="field">Sửa lựa chọn<select data-edit-decision="${f.id}">${Object.entries(
              decisions,
            )
              .map(
                ([v, l]) =>
                  `<option value="${v}" ${f.decision === v ? "selected" : ""}>${l}</option>`,
              )
              .join(
                "",
              )}</select></label><label class="field">Sửa lý do<textarea data-edit-reason="${f.id}" maxlength="2000">${e(f.reason)}</textarea></label><button data-edit-feedback="${f.id}">Lưu phản hồi đã sửa</button><button class="danger" data-delete-feedback="${f.id}">Xóa phản hồi</button>${f.decision !== "later" && !data.memories.some((m) => m.feedback_id === f.id) ? `<button data-learn-feedback="${f.id}">Xác nhận ghi nhớ từ lựa chọn này</button>` : ""}</article>`,
        )
        .join("") ||
      '<p class="muted">Đánh giá các video trong Đề xuất để xây dựng lịch sử.</p>'
    }<h3 class="section-spacer">Lịch sử đánh giá và giải thích</h3>${
      data.evaluations
        .slice(0, 50)
        .map(
          (v) =>
            `<details class="history-item"><summary>${e(v.youtube_id)} · ${when(v.created_at)} · ${e(v.explanation.ranking_engine || "rules")}</summary><p>${e((v.explanation.personal_reasons || []).join("\n"))}</p><p>Tiêu chuẩn: ${e(v.criteria_version || "Mặc định")}</p><p>Nguồn đã truy cập: ${e((v.explanation.data_access || []).join(", "))}</p></details>`,
        )
        .join("") ||
      '<p class="muted">Có lịch sử sau khi chạy đánh giá từ máy chủ.</p>'
    }</section>`;
  }
  async function handle(ev) {
    const b = ev.target.closest("button");
    if (!b) return;
    try {
      if (b.dataset.editFeedback || b.dataset.deleteFeedback) {
        const id = b.dataset.editFeedback || b.dataset.deleteFeedback;
        if (
          b.dataset.deleteFeedback &&
          !confirm("Xóa phản hồi và ghi nhớ gắn với phản hồi này?")
        )
          return;
        await store.editFeedback(
          user,
          id,
          target.querySelector(`[data-edit-decision="${id}"]`).value,
          target.querySelector(`[data-edit-reason="${id}"]`).value,
          !!b.dataset.deleteFeedback,
        );
        notice =
          "Đã cập nhật phản hồi. Ghi nhớ liên quan cần được xác nhận lại.";
        await reload();
        return;
      }
      if (b.dataset.personal === "import") {
        const result = store.importChannels(
          target.querySelector("#bulk-channels").value,
          data.channels,
          target.querySelector("#bulk-group").value,
        );
        await store.saveChannels(user, result.added);
        notice = `Đã thêm ${result.added.length} kênh; bỏ ${result.duplicates.length} kênh trùng; ${result.invalid.length} dòng lỗi.${
          result.invalid.length
            ? " " +
              result.invalid
                .slice(0, 3)
                .map((i) => i.error)
                .join(" ")
            : ""
        }`;
        await reload();
      }
      if (b.dataset.personal === "refresh") await refreshChannels();
      if (b.dataset.saveChannel) {
        const c = data.channels.find((c) => c.id === b.dataset.saveChannel);
        await store.saveChannels(user, [
          {
            ...c,
            topic_group: target.querySelector(`[data-channel-group="${c.id}"]`)
              .value,
          },
        ]);
        notice = "Đã lưu nhóm.";
        await reload();
      }
      if (b.dataset.removePersonalChannel) {
        await store.removeChannel(user, b.dataset.removePersonalChannel);
        notice = "Đã xóa kênh theo dõi; video đã thu thập vẫn được giữ.";
        await reload();
      }
      if (b.dataset.restoreCriteria) {
        const version = data.versions.find(
          (v) => v.id === b.dataset.restoreCriteria,
        );
        if (confirm("Lưu nội dung phiên bản này thành phiên bản mới?")) {
          await store.saveCriteria(user, version.content, current().revision);
          notice = "Đã tạo phiên bản mới từ lịch sử.";
          await reload();
        }
      }
      if (b.dataset.learnFeedback) {
        const f = data.feedback.find((f) => f.id === b.dataset.learnFeedback);
        if (
          !confirm(
            "Xác nhận dùng lựa chọn và lý do này làm ghi nhớ cho các đề xuất sau?",
          )
        )
          return;
        await store.saveMemory(user, {
          feedback_id: f.id,
          text:
            f.reason || `${decisions[f.decision]}: ${f.video_snapshot?.title}`,
          video_title: f.video_snapshot?.title || "",
          preference: f.decision === "rejected" ? "negative" : "positive",
          confirmed: true,
        });
        notice = "Đã xác nhận ghi nhớ.";
        await reload();
      }
      if (b.dataset.saveMemory) {
        const m = data.memories.find((m) => m.id === b.dataset.saveMemory);
        await store.saveMemory(user, {
          ...m,
          text: target.querySelector(`[data-memory-text="${m.id}"]`).value,
          preference: target.querySelector(`[data-memory-preference="${m.id}"]`)
            .value,
          confirmed: target.querySelector(`[data-memory-confirmed="${m.id}"]`)
            .checked,
        });
        notice = "Đã cập nhật ghi nhớ.";
        await reload();
      }
      if (b.dataset.deleteMemory) {
        if (!confirm("Xóa ghi nhớ này khỏi các lần xếp hạng tiếp theo?"))
          return;
        await store.deleteMemory(user, b.dataset.deleteMemory);
        notice = "Đã xóa ghi nhớ.";
        await reload();
      }
    } catch (error) {
      status(error.message);
    }
  }
  draw();
}
