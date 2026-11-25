// 全心日記 admin console.
// ★ The lock here is cosmetic: every admin API on the backend requires an admin session
//   (router-backend apps/all_mo_diary/admin_routes.py).
(function () {
  const api = window.amdApi;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Times in Taipei time: 2026-11-11 16:22 GMT+8. Anything unparseable is shown as is.
  const TIME_PARTS = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const fmtTime = (iso) => {
    if (!iso) return "-";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    const p = Object.fromEntries(TIME_PARTS.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} GMT+8`;
  };
  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1) + " MB";
  // Every load takes a number; a slow old response that comes back after a newer one is dropped
  // instead of overwriting the newer screen.
  const gen = { fonts: 0, feedback: 0, detail: 0 };
  let feedbackFilters = { kind: "", status: "", app_version: "", device_model: "", page: 1 };
  // Font uploads in progress: font id → progress (0–1). Kept here, not on the page: the font list is
  // rebuilt by any edit, publish or tab switch during an upload, and the rebuilt entry must still
  // show the upload and not offer a second one.
  const uploading = new Map();

  function message(text, kind) {
    $("msg").innerHTML = text ? `<div class="banner ${kind === "warn" ? "warn" : ""}">${esc(text)}</div>` : "";
    if (text) setTimeout(() => { if ($("msg").textContent.includes(text)) $("msg").innerHTML = ""; }, 6000);
  }

  async function run(fn, okText) {
    try {
      await fn();
      if (okText) message(okText);
    } catch (e) {
      message(e.error || String(e), "warn");
      if (e.status === 401) showLogin();
    }
  }

  // Signing in happens on the home page (the console link appears there for admins).
  function showLogin() {
    location.replace("index.html");
  }

  async function start() {
    if (!api.token()) return showLogin();
    try {
      const me = await api.call("GET", "/api/admin/me");
      $("who").textContent = me.email;
      $("status").hidden = true;
      $("app").hidden = false;
      $("logout").hidden = false;
      await loadFonts();
    } catch (e) {
      if (e.status === 401 || e.status === 403) return showLogin();
      // Backend asleep or unreachable: the session is still stored; stay so a reload can retry.
      $("status-msg").textContent = e.error;
      $("status").hidden = false;
    }
  }

  $("logout").onclick = () => run(async () => {
    try { await api.call("POST", "/api/admin/logout"); } finally { api.setToken(null); showLogin(); }
  });

  const TABS = ["fonts", "version", "feedback", "admins", "audit", "system"];
  $("tabs").onclick = (ev) => {
    const tab = ev.target.dataset && ev.target.dataset.tab;
    if (!tab) return;
    for (const b of $("tabs").querySelectorAll("button")) b.classList.toggle("active", b.dataset.tab === tab);
    for (const t of TABS) $("tab-" + t).hidden = t !== tab;
    ({ fonts: loadFonts, version: loadVersion, feedback: loadFeedback, admins: loadAdmins, audit: loadAudit, system: loadSystem })[tab]();
  };

  // ── Fonts ───────────────────────────────────────────────
  async function loadFonts() {
    const mine = ++gen.fonts;
    await run(async () => {
      const [data, o] = await Promise.all([api.call("GET", "/api/admin/fonts"), api.call("GET", "/api/admin/overview")]);
      if (mine !== gen.fonts) return;
      renderFonts(data, o);
    });
  }

  // The new-font form isn't saved until 新增字體 is pressed, and a redraw rebuilds its fields: what was
  // typed there is carried over, and cleared once the font has been added.
  const NEW_FONT_FIELDS = ["new-font-name", "new-font-sort", "new-font-attribution"];
  let fontsRedrawWaiting = false;

  function renderFonts(data, o) {
    // A redraw replaces every field. One that is being typed in would lose its text — an earlier
    // save or an upload can finish while a statement is being written — so the redraw waits until
    // that field is left. A font's own field left with a change saves itself and reloads; anything
    // else reloads here.
    const editing = document.activeElement;
    const typing = !!editing && $("tab-fonts").contains(editing)
      && editing.matches("textarea, input:not([type=checkbox]):not([type=file])");
    if (typing && editing.value !== editing.defaultValue) {
      if (!fontsRedrawWaiting) {
        fontsRedrawWaiting = true;
        editing.addEventListener("blur", () => {
          fontsRedrawWaiting = false;
          const savesItself = editing.dataset.font && editing.value !== editing.defaultValue;
          if (!savesItself) loadFonts();
        }, { once: true });
      }
      return;
    }
    // Redrawing now: a field that was waited for is replaced along with the rest, and a replaced
    // field never reports being left.
    fontsRedrawWaiting = false;
    const draft = NEW_FONT_FIELDS.map((id) => ($(id) ? $(id).value : ""));
    const draftLicensed = !!$("new-font-licensed") && $("new-font-licensed").checked;
    const release = data.release;
    const publishedIds = new Set(release ? release.content.fonts.map((f) => f.id) : []);
    const unpublished = data.fonts.some((f) => f.download_url && (!f.published ||
      JSON.stringify(pick(f)) !== JSON.stringify(pick(release.content.fonts.find((r) => r.id === f.id) || {}))));
    // One block per font, every control under its name: a table cell has no room for a name above
    // the control or for a statement of several lines, and on a phone no room at all.
    const items = data.fonts.map((f) => `<div class="font-item">
        <div class="row font-head"><strong>ID ${f.id}</strong>
          ${f.published || publishedIds.has(f.id) ? '<span class="muted">已發布</span>' : `<button data-del-font="${f.id}" class="danger push">刪除</button>`}</div>
        <div class="font-fields">
          <div class="font-main">
            <div class="row">
              <label class="field grow">名稱<input data-font="${f.id}" data-f="name" value="${esc(f.name)}"></label>
              <label class="field field-short">排序<input data-font="${f.id}" data-f="sort" value="${f.sort}" inputmode="numeric"></label>
            </div>
            <div class="row checks">
              <label><input type="checkbox" data-font="${f.id}" data-f="licensed" ${f.licensed ? "checked" : ""}> 有授權</label>
              <label><input type="checkbox" data-font="${f.id}" data-f="disabled" ${f.disabled ? "checked" : ""}> 停用</label>
            </div>
            <div class="field">檔案
              <div class="file-info">${f.download_url
                ? `<span title="${esc(f.file_name)}">安裝後 ${mb(f.font_bytes)}，下載 ${mb(f.download_bytes)}</span>`
                : '<span class="muted">還沒上傳</span>'}
                <input type="file" accept=".gz,application/gzip" data-upload="${f.id}" ${o.fonts_upload_configured && !uploading.has(f.id) ? "" : "disabled"}>
                <progress data-progress="${f.id}" max="1" value="${uploading.get(f.id) || 0}" ${uploading.has(f.id) ? "" : "hidden"}></progress>
              </div>
            </div>
          </div>
          <label class="field">來源／授權說明<textarea data-font="${f.id}" data-f="attribution" rows="4" maxlength="500">${esc(f.attribution)}</textarea></label>
        </div>
      </div>`).join("");
    $("tab-fonts").innerHTML = `
      ${o.fonts_upload_configured ? "" : '<div class="banner warn">後端還沒設定字體的 GitHub repo（ALL_MO_DIARY__FONTS_REPO、ALL_MO_DIARY__GITHUB_TOKEN），目前不能上傳。</div>'}
      ${o.cache_consistent ? "" : '<div class="banner warn">快取版本和資料庫版本不一致，請到「系統」按「重新載入快取」。</div>'}
      <div class="card">
        <div class="row"><h3>字體清單</h3><span class="muted">目前發布：${esc(release ? release.version : "沒有")}</span>
          ${unpublished ? '<span class="pill warn">草稿有未發布的修改</span>' : '<span class="pill">和發布版本一樣</span>'}
          <button id="publish-fonts" class="primary push">發布</button></div>
        ${items || '<p class="muted">還沒有字體</p>'}
      </div>
      <div class="card">
        <h3>新增字體</h3>
        <div class="font-fields">
          <div class="font-main">
            <div class="row">
              <label class="field grow">名稱<input id="new-font-name" placeholder="App 上顯示的名稱"></label>
              <label class="field field-short">排序<input id="new-font-sort" inputmode="numeric"></label>
            </div>
            <div class="row checks"><label><input type="checkbox" id="new-font-licensed"> 有授權</label></div>
          </div>
          <label class="field">來源／授權說明（可以留空）<textarea id="new-font-attribution" rows="3" maxlength="500"></textarea></label>
        </div>
        <div class="row actions"><button id="add-font">新增字體</button></div>
      </div>
      <ul class="notes">
        <li>上傳的是<strong>字體瘦身工具</strong>產生的 <code>.otf.gz</code>（meta repo 的 tools/字體瘦身.command）。</li>
        <li>修改會先存成草稿，按「發布」才會讓 App 下載新的清單。ID 永遠不可改、不可重用；發布過的字體不能刪除，只能停用。</li>
        <li>「有授權」只是標示，不會擋上傳。內建的 Noto Sans TC 不在這個清單裡。</li>
        <li>「來源／授權說明」會照原樣顯示在 App 的字體設定頁與開放原始碼授權頁；授權條款要求標示來源的字體一定要填，不需要的可以留空。</li>
      </ul>`;
    NEW_FONT_FIELDS.forEach((id, i) => { $(id).value = draft[i]; });
    $("new-font-licensed").checked = draftLicensed;
    bindFonts();
    if (typing) {
      // The cursor stays in the field it was in (the field itself is a new element now).
      const same = editing.id ? $(editing.id)
        : document.querySelector(`[data-font="${editing.dataset.font}"][data-f="${editing.dataset.f}"]`);
      if (same) {
        same.focus();
        same.setSelectionRange(editing.selectionStart, editing.selectionEnd);
      }
    }
  }

  // What a publish would change. A list published without the attribution key counts as an empty
  // one, so it only shows as an unpublished change once a statement has been written.
  function pick(f) {
    return { name: f.name, sort: f.sort, disabled: f.disabled, licensed: f.licensed, attribution: f.attribution || "",
      file_name: f.file_name };
  }

  function bindFonts() {
    $("publish-fonts").onclick = () => {
      if (!confirm("發布後，App 下次檢查更新就會拿到新的字體清單。確定？")) return;
      run(async () => {
        const r = await api.call("POST", "/api/admin/fonts/publish");
        message(`已發布版本 ${r.version}（${r.count} 個字體）${r.cache_reloaded ? "" : "；快取晚點才會更新"}`);
        await loadFonts();
      });
    };
    $("add-font").onclick = () => run(async () => {
      const sort = parseInt($("new-font-sort").value || "0", 10);
      await api.call("POST", "/api/admin/fonts", { name: $("new-font-name").value, sort: isNaN(sort) ? 0 : sort,
        licensed: $("new-font-licensed").checked, attribution: $("new-font-attribution").value });
      for (const id of NEW_FONT_FIELDS) $(id).value = "";
      $("new-font-licensed").checked = false;
      await loadFonts();
    }, "已新增，接著上傳字體檔");
    document.querySelectorAll("[data-font]").forEach((el) => {
      el.onchange = () => {
        const f = el.dataset.f;
        let value = el.type === "checkbox" ? el.checked : el.value;
        if (f === "sort") { value = parseInt(value, 10); if (isNaN(value)) return message("排序要是整數", "warn"); }
        const sent = el.value;
        run(async () => {
          await api.call("PATCH", "/api/admin/fonts/" + el.dataset.font, { [f]: value });
          // What was sent is saved now, so it no longer counts as text being typed. Otherwise a field
          // that still has the cursor (the window lost focus, not the field) would hold the redraw
          // back for good: it never reports being left again, and the saved text is not a change.
          if (el.type !== "checkbox") el.defaultValue = sent;
          await loadFonts();
        }, "已存成草稿");
      };
    });
    document.querySelectorAll("[data-del-font]").forEach((b) => {
      b.onclick = () => {
        if (!confirm("確定刪除這個字體？")) return;
        run(async () => { await api.call("DELETE", "/api/admin/fonts/" + b.dataset.delFont); await loadFonts(); }, "已刪除");
      };
    });
    document.querySelectorAll("[data-upload]").forEach((input) => {
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!file.name.endsWith(".gz")) { message("請上傳字體瘦身工具產生的 .otf.gz", "warn"); input.value = ""; return; }
        const id = Number(input.dataset.upload);
        if (uploading.has(id)) return;
        uploading.set(id, 0);
        input.disabled = true;
        // Looked up on every update: the list may have been rebuilt since the upload started.
        const showProgress = () => {
          const bar = document.querySelector(`[data-progress="${id}"]`);
          if (bar) { bar.hidden = false; bar.value = uploading.get(id) || 0; }
        };
        showProgress();
        run(async () => {
          try {
            await api.upload(`/api/admin/fonts/${id}/file`, file, (p) => { uploading.set(id, p); showProgress(); });
          } finally {
            // Success or failure, the entry is rebuilt from the server without the upload state.
            uploading.delete(id);
            await loadFonts();
          }
        }, "已上傳，記得按「發布」");
      };
    });
  }

  // ── App version and forced update ───────────────────────
  async function loadVersion() {
    await run(async () => {
      const c = await api.call("GET", "/api/admin/app-config");
      $("tab-version").innerHTML = `<div class="card">
        <p class="muted">強制更新只在重大問題或法律衝突時使用；只對有網路、而且有做每日檢查的手機生效。畫面上會顯示這裡寫的原因。</p>
        <div class="form">
          <label class="field">最低可用 App 版本（x.y.z）<input id="cfg-min" class="short" value="${esc(c.min_app_version)}"></label>
          <label class="field">強制更新的原因<textarea id="cfg-reason" maxlength="300">${esc(c.force_reason)}</textarea></label>
          <label class="field">更新連結（https://，上架前可以留空）<input id="cfg-url" value="${esc(c.update_url)}"></label>
          <label class="field">公告（App 每日檢查時顯示一次，留空就不顯示）<input id="cfg-ann" value="${esc(c.announcement)}" maxlength="300"></label>
        </div>
        <p class="muted">最後修改：${esc(fmtTime(c.updated_at))} ${esc(c.updated_by)}</p>
        <button id="cfg-save" class="primary">儲存</button></div>`;
      $("cfg-save").onclick = () => {
        if (!confirm("儲存後立即生效。確定？")) return;
        run(async () => {
          await api.call("PUT", "/api/admin/app-config", {
            min_app_version: $("cfg-min").value.trim(), force_reason: $("cfg-reason").value,
            update_url: $("cfg-url").value.trim(), announcement: $("cfg-ann").value,
          });
          await loadVersion();
        }, "已儲存");
      };
    });
  }

  // ── Feedback ────────────────────────────────────────────
  const STATUS = { new: "新的", in_progress: "處理中", done: "已處理", wont_fix: "不處理" };
  const KIND = { suggestion: "提供建議", problem: "遇到問題" };

  async function loadFeedback() {
    const mine = ++gen.feedback;
    await run(async () => {
      const q = new URLSearchParams(Object.entries(feedbackFilters).filter(([, v]) => v)).toString();
      const data = await api.call("GET", "/api/admin/feedback?" + q);
      if (mine !== gen.feedback) return;
      const opt = (values, labels, current) => '<option value="">全部</option>' +
        values.map((v) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(labels ? labels[v] : v)}</option>`).join("");
      // The version and the phone model go under the description: as columns of their own they
      // would leave the description, the one long text, the narrowest column.
      const pages = data.page > 1 || data.page * data.per_page < data.total;
      $("tab-feedback").innerHTML = `<div class="card">
          <div class="toolbar">
            <label class="field">類型<select id="f-kind">${opt(Object.keys(KIND), KIND, feedbackFilters.kind)}</select></label>
            <label class="field">狀態<select id="f-status">${opt(Object.keys(STATUS), STATUS, feedbackFilters.status)}</select></label>
            <label class="field">版本<select id="f-ver">${opt(data.app_versions, null, feedbackFilters.app_version)}</select></label>
            <label class="field">機型<select id="f-model">${opt(data.device_models, null, feedbackFilters.device_model)}</select></label>
            <span class="muted count">共 ${data.total} 則（最長保留 90 天）</span>
          </div>
          <div class="scroll-x"><table><thead><tr><th>時間</th><th>類型</th><th>狀態</th><th>描述</th></tr></thead><tbody>
          ${data.items.map((i) => `<tr data-fb="${i.id}">
            <td class="nowrap aside minor">${esc(fmtTime(i.received_at))}</td><td class="nowrap">${esc(KIND[i.kind])}</td><td class="nowrap">${esc(STATUS[i.status])}</td>
            <td class="line breakable">${esc(i.description)}<span class="muted sub">App ${esc(i.app_version)} · ${esc(i.device_model)}</span></td></tr>`).join("") ||
            '<tr><td colspan="4" class="muted">沒有意見回饋</td></tr>'}
          </tbody></table></div>
          ${pages ? `<div class="row actions">
            <button id="f-prev" ${data.page <= 1 ? "disabled" : ""}>上一頁</button>
            <span class="muted">第 ${data.page} 頁</span>
            <button id="f-next" ${data.page * data.per_page >= data.total ? "disabled" : ""}>下一頁</button>
          </div>` : ""}
        </div>
        <div id="fb-detail"></div>
        <div class="card"><h3>個資刪除請求</h3>
          <p class="muted">刪掉某個 Email 的所有意見回饋（隱私權政策第七條）。</p>
          <div class="row"><input id="del-email" class="field-wide" placeholder="email@example.com"><button id="del-email-btn" class="danger">全部刪除</button></div>
        </div>`;
      const set = (k) => (ev) => { feedbackFilters[k] = ev.target.value; feedbackFilters.page = 1; loadFeedback(); };
      $("f-kind").onchange = set("kind");
      $("f-status").onchange = set("status");
      $("f-ver").onchange = set("app_version");
      $("f-model").onchange = set("device_model");
      if (pages) {
        $("f-prev").onclick = () => { feedbackFilters.page -= 1; loadFeedback(); };
        $("f-next").onclick = () => { feedbackFilters.page += 1; loadFeedback(); };
      }
      document.querySelectorAll("[data-fb]").forEach((tr) => { tr.onclick = () => showFeedback(tr.dataset.fb); });
      $("del-email-btn").onclick = () => {
        const email = $("del-email").value.trim();
        if (!email || !confirm(`確定刪除 ${email} 的所有意見回饋？無法復原。`)) return;
        run(async () => {
          const r = await api.call("POST", "/api/admin/feedback/delete-by-email", { email });
          message(`已刪除 ${r.deleted} 則`);
          await loadFeedback();
        });
      };
    });
  }

  function renderLogs(logs) {
    if (!logs) return '<p class="muted">沒有記錄檔（「提供建議」不附記錄檔）。</p>';
    const lines = (logs.logs || []).map((l) => {
      const { t, lv, c, ...rest } = l;
      return `${t} ${String(lv).toUpperCase().padEnd(5)} ${c} ${Object.keys(rest).length ? JSON.stringify(rest) : ""}`;
    });
    return `<h4>記錄檔（${lines.length} 行）</h4><pre class="log">${esc(lines.join("\n"))}</pre>
      ${logs.exit_reasons && logs.exit_reasons.length ? `<h4>上次結束原因</h4><pre class="log">${esc(JSON.stringify(logs.exit_reasons, null, 1))}</pre>` : ""}
      ${logs.text ? `<pre class="log">${esc(logs.text)}</pre>` : ""}`;
  }

  async function showFeedback(id) {
    const mine = ++gen.detail;
    await run(async () => {
      const f = await api.call("GET", "/api/admin/feedback/" + id);
      if (mine !== gen.detail) return;
      $("fb-detail").innerHTML = `<div class="card">
        <div class="row detail-head"><div><strong>${esc(KIND[f.kind])}</strong><span class="muted breakable">${esc(f.id)}</span></div>
          <button id="fb-close" class="push">關閉</button></div>
        <p>${esc(f.description).replace(/\n/g, "<br>")}</p>
        <p class="muted">Email：${esc(f.email)}｜收到：${esc(fmtTime(f.received_at))}｜手機時間：${esc(fmtTime(f.device_time))}<br>
        App ${esc(f.app_version)}（${esc(f.build_number)}）｜${esc(f.device_model)}｜${esc(f.os_version)}｜安裝 ID ${esc(f.install_id)}</p>
        <div class="row">
          <select id="fb-status">${Object.keys(STATUS).map((s) => `<option value="${s}" ${s === f.status ? "selected" : ""}>${STATUS[s]}</option>`).join("")}</select>
          <input id="fb-note" class="grow" value="${esc(f.admin_note)}" placeholder="處理備註">
          <button id="fb-save" class="primary">儲存</button>
          <button id="fb-delete" class="danger">刪除</button>
        </div>
        <h4>快照</h4><pre class="log">${esc(JSON.stringify(f.snapshot, null, 1))}</pre>
        ${renderLogs(f.logs)}
      </div>`;
      $("fb-close").onclick = () => { $("fb-detail").innerHTML = ""; };
      $("fb-save").onclick = () => run(async () => {
        await api.call("PATCH", "/api/admin/feedback/" + id, { status: $("fb-status").value, admin_note: $("fb-note").value });
        await loadFeedback();
      }, "已儲存");
      $("fb-delete").onclick = () => {
        if (!confirm("確定刪除這則意見回饋？")) return;
        run(async () => { await api.call("DELETE", "/api/admin/feedback/" + id); await loadFeedback(); }, "已刪除");
      };
      $("fb-detail").scrollIntoView({ behavior: "smooth" });
    });
  }

  // ── Admins ──────────────────────────────────────────────
  async function loadAdmins() {
    await run(async () => {
      const data = await api.call("GET", "/api/admin/admins");
      $("tab-admins").innerHTML = `<div class="card">
        <div class="scroll-x"><table><thead><tr><th>Email</th><th>備註</th><th></th></tr></thead><tbody>
        ${data.admins.map((a) => `<tr><td class="lead">${esc(a.email)}</td><td class="line minor breakable">${esc(a.note)}</td>
          <td class="nowrap aside">${a.fixed ? '<span class="muted">環境變數設定</span>' : `<button data-rm="${esc(a.email)}" class="danger">移除</button>`}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="row add-row"><label class="field field-wide">Email<input id="adm-email"></label><label class="field field-wide">備註<input id="adm-note"></label><button id="adm-add" class="primary">新增管理員</button></div>
      </div>`;
      $("adm-add").onclick = () => run(async () => {
        await api.call("POST", "/api/admin/admins", { email: $("adm-email").value.trim(), note: $("adm-note").value.trim() });
        await loadAdmins();
      }, "已新增");
      document.querySelectorAll("[data-rm]").forEach((b) => {
        b.onclick = () => {
          if (!confirm(`確定移除 ${b.dataset.rm}？`)) return;
          run(async () => { await api.call("DELETE", "/api/admin/admins/" + encodeURIComponent(b.dataset.rm)); await loadAdmins(); }, "已移除");
        };
      });
    });
  }

  // ── Audit log ───────────────────────────────────────────
  // Read-only: who changed what in this console, newest first. The backend records every write and
  // every refused request (router-backend shared/audit_log.py) and keeps 180 days.
  const AUDIT_ACTIONS = {
    login: "登入", logout: "登出", reload_cache: "重新載入快取",
    create_font: "新增字體", update_font: "修改字體", delete_font: "刪除字體", upload_font_file: "上傳字體檔", publish_fonts: "發布字體清單",
    put_app_config: "修改 App 版本設定",
    update_feedback: "修改意見回饋", delete_feedback: "刪除意見回饋", delete_feedback_by_email: "依 Email 刪除意見回饋",
    add_admin: "新增管理員", remove_admin: "移除管理員",
  };
  const AUDIT_RESULTS = { ok: "成功", denied: "被拒", failed: "失敗" };
  let auditRows = [];

  async function loadAudit(more) {
    await run(async () => {
      const before = more && auditRows.length ? "?before=" + auditRows[auditRows.length - 1].id : "";
      const data = await api.call("GET", "/api/admin/audit" + before);
      auditRows = more ? auditRows.concat(data.items) : data.items;
      const label = (a) => AUDIT_ACTIONS[String(a).split(".").pop()] || a;
      $("tab-audit").innerHTML = `<div class="card">
        <div class="scroll-x"><table><thead><tr><th>時間</th><th>帳號</th><th>動作</th><th>對象</th><th>結果</th></tr></thead><tbody>
        ${auditRows.map((r) => `<tr><td class="nowrap line minor last">${esc(fmtTime(r.at))}</td><td class="line">${esc(r.actor || "-")}</td><td class="lead">${esc(label(r.action))}</td>
          <td class="line minor breakable${r.target ? "" : " empty"}">${esc(r.target || "-")}</td><td class="nowrap aside${r.result === "ok" ? "" : " warn"}">${esc(AUDIT_RESULTS[r.result] || r.result)}</td></tr>`).join("")}
        </tbody></table></div>
        ${data.items.length === 50 ? '<div class="row actions"><button id="audit-more">載入更早的</button></div>' : ""}
        <p class="muted">只能看，不能改或刪；保留 180 天。</p>
      </div>`;
      const moreBtn = $("audit-more");
      if (moreBtn) moreBtn.onclick = () => loadAudit(true);
    });
  }

  // ── System ──────────────────────────────────────────────
  async function loadSystem() {
    await run(async () => {
      const o = await api.call("GET", "/api/admin/overview");
      $("tab-system").innerHTML = `<div class="card">
        <p>快取的字體清單版本：${esc(o.cache.loaded ? (o.cache.fonts_version || "還沒發布") : "還沒載入")}<br>
        資料庫的字體清單版本：${esc(o.fonts_version || "還沒發布")}<br>
        ${o.cache_consistent ? '<span class="ok">一致</span>' : '<span class="warn">不一致</span>'}
        <span class="muted">（快取載入時間 ${esc(fmtTime(o.cache.loaded_at))}）</span></p>
        <p>意見回饋資料表：${o.feedback_table_mb} MB（上限 ${o.feedback_table_limit_mb} MB）｜新的意見回饋 ${o.new_feedback} 則</p>
        <button id="reload-cache">重新載入快取</button>
        <p class="muted">萬一曾用 SQL 直接改了資料，按這個鈕或重啟後端即可。</p>
      </div>`;
      $("reload-cache").onclick = () => run(async () => { await api.call("POST", "/api/admin/cache/reload"); await loadSystem(); }, "已重新載入");
    });
  }

  start();
})();
