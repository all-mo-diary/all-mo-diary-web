// 由 demo/tools/build.py 從 js/admin.js 產生,不要手改。
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
          ${f.published || publishedIds.has(f.id) ? '<span class="muted">Published</span>' : `<button data-del-font="${f.id}" class="danger push">Delete</button>`}</div>
        <div class="font-fields">
          <div class="font-main">
            <div class="row">
              <label class="field grow">Name<input data-font="${f.id}" data-f="name" value="${esc(f.name)}"></label>
              <label class="field field-short">Order<input data-font="${f.id}" data-f="sort" value="${f.sort}" inputmode="numeric"></label>
            </div>
            <div class="row checks">
              <label><input type="checkbox" data-font="${f.id}" data-f="licensed" ${f.licensed ? "checked" : ""}> Licensed</label>
              <label><input type="checkbox" data-font="${f.id}" data-f="disabled" ${f.disabled ? "checked" : ""}> Disabled</label>
            </div>
            <div class="field">File
              <div class="file-info">${f.download_url
                ? `<span title="${esc(f.file_name)}">Installed ${mb(f.font_bytes)}, download ${mb(f.download_bytes)}</span>`
                : '<span class="muted">Not uploaded</span>'}
                <input type="file" accept=".gz,application/gzip" data-upload="${f.id}" ${o.fonts_upload_configured && !uploading.has(f.id) ? "" : "disabled"}>
                <progress data-progress="${f.id}" max="1" value="${uploading.get(f.id) || 0}" ${uploading.has(f.id) ? "" : "hidden"}></progress>
              </div>
            </div>
          </div>
          <label class="field">Source and licence statement<textarea data-font="${f.id}" data-f="attribution" rows="4" maxlength="500">${esc(f.attribution)}</textarea></label>
        </div>
      </div>`).join("");
    $("tab-fonts").innerHTML = `
      ${o.fonts_upload_configured ? "" : '<div class="banner warn">The backend has no GitHub repo for fonts yet (ALL_MO_DIARY__FONTS_REPO, ALL_MO_DIARY__GITHUB_TOKEN), so uploads are off.</div>'}
      ${o.cache_consistent ? "" : '<div class="banner warn">The cache and the database disagree on the version. Go to "System" and press "Reload cache".</div>'}
      <div class="card">
        <div class="row"><h3>Font list</h3><span class="muted">Published: ${esc(release ? release.version : "none")}</span>
          ${unpublished ? '<span class="pill warn">The draft has unpublished changes</span>' : '<span class="pill">Same as published</span>'}
          <button id="publish-fonts" class="primary push">Publish</button></div>
        ${items || '<p class="muted">No fonts yet</p>'}
      </div>
      <div class="card">
        <h3>Add a font</h3>
        <div class="font-fields">
          <div class="font-main">
            <div class="row">
              <label class="field grow">Name<input id="new-font-name" placeholder="As shown in the App"></label>
              <label class="field field-short">Order<input id="new-font-sort" inputmode="numeric"></label>
            </div>
            <div class="row checks"><label><input type="checkbox" id="new-font-licensed"> Licensed</label></div>
          </div>
          <label class="field">Source and licence statement (optional)<textarea id="new-font-attribution" rows="3" maxlength="500"></textarea></label>
        </div>
        <div class="row actions"><button id="add-font">Add font</button></div>
      </div>
      <ul class="notes">
        <li>Upload the <code>.otf.gz</code> made by the <strong>font subsetting tool</strong> (tools/ in the meta repo).</li>
        <li>Changes are saved as a draft; the App gets the new list only after "Publish". IDs never change and are never reused; a published font can't be deleted, only disabled.</li>
        <li>"Licensed" is only a label and doesn't block uploads. The built-in Noto Sans TC is not in this list.</li>
        <li>The "source and licence statement" is shown as written on the font settings page and the open-source licences page of the App. Fill it in for fonts whose licence requires naming the source; leave it empty for the rest.</li>
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
      if (!confirm("After publishing, the App gets the new font list at its next update check. Continue?")) return;
      run(async () => {
        const r = await api.call("POST", "/api/admin/fonts/publish");
        message(`Published version ${r.version} (${r.count} fonts)${r.cache_reloaded ? "" : "; the cache will catch up shortly"}`);
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
    }, "Added. Now upload the font file");
    document.querySelectorAll("[data-font]").forEach((el) => {
      el.onchange = () => {
        const f = el.dataset.f;
        let value = el.type === "checkbox" ? el.checked : el.value;
        if (f === "sort") { value = parseInt(value, 10); if (isNaN(value)) return message("Order must be a whole number", "warn"); }
        const sent = el.value;
        run(async () => {
          await api.call("PATCH", "/api/admin/fonts/" + el.dataset.font, { [f]: value });
          // What was sent is saved now, so it no longer counts as text being typed. Otherwise a field
          // that still has the cursor (the window lost focus, not the field) would hold the redraw
          // back for good: it never reports being left again, and the saved text is not a change.
          if (el.type !== "checkbox") el.defaultValue = sent;
          await loadFonts();
        }, "Saved as draft");
      };
    });
    document.querySelectorAll("[data-del-font]").forEach((b) => {
      b.onclick = () => {
        if (!confirm("Delete this font?")) return;
        run(async () => { await api.call("DELETE", "/api/admin/fonts/" + b.dataset.delFont); await loadFonts(); }, "Deleted");
      };
    });
    document.querySelectorAll("[data-upload]").forEach((input) => {
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!file.name.endsWith(".gz")) { message("Upload the .otf.gz made by the font subsetting tool", "warn"); input.value = ""; return; }
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
        }, "Uploaded. Remember to press \"Publish\"");
      };
    });
  }

  // ── App version and forced update ───────────────────────
  async function loadVersion() {
    await run(async () => {
      const c = await api.call("GET", "/api/admin/app-config");
      $("tab-version").innerHTML = `<div class="card">
        <p class="muted">Use a forced update only for serious problems or legal conflicts; it only reaches phones that are online and run the daily check. The reason written here is shown on screen.</p>
        <div class="form">
          <label class="field">Minimum usable App version (x.y.z)<input id="cfg-min" class="short" value="${esc(c.min_app_version)}"></label>
          <label class="field">Reason for the forced update<textarea id="cfg-reason" maxlength="300">${esc(c.force_reason)}</textarea></label>
          <label class="field">Update link (https://; may be empty before listing)<input id="cfg-url" value="${esc(c.update_url)}"></label>
          <label class="field">Announcement (shown once at the App's daily check; empty shows nothing)<input id="cfg-ann" value="${esc(c.announcement)}" maxlength="300"></label>
        </div>
        <p class="muted">Last changed: ${esc(fmtTime(c.updated_at))} ${esc(c.updated_by)}</p>
        <button id="cfg-save" class="primary">Save</button></div>`;
      $("cfg-save").onclick = () => {
        if (!confirm("Saving takes effect immediately. Continue?")) return;
        run(async () => {
          await api.call("PUT", "/api/admin/app-config", {
            min_app_version: $("cfg-min").value.trim(), force_reason: $("cfg-reason").value,
            update_url: $("cfg-url").value.trim(), announcement: $("cfg-ann").value,
          });
          await loadVersion();
        }, "Saved");
      };
    });
  }

  // ── Feedback ────────────────────────────────────────────
  const STATUS = { new: "New", in_progress: "In progress", done: "Done", wont_fix: "Won't fix" };
  const KIND = { suggestion: "Suggestion", problem: "Problem" };

  async function loadFeedback() {
    const mine = ++gen.feedback;
    await run(async () => {
      const q = new URLSearchParams(Object.entries(feedbackFilters).filter(([, v]) => v)).toString();
      const data = await api.call("GET", "/api/admin/feedback?" + q);
      if (mine !== gen.feedback) return;
      const opt = (values, labels, current) => '<option value="">All</option>' +
        values.map((v) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(labels ? labels[v] : v)}</option>`).join("");
      // The version and the phone model go under the description: as columns of their own they
      // would leave the description, the one long text, the narrowest column.
      const pages = data.page > 1 || data.page * data.per_page < data.total;
      $("tab-feedback").innerHTML = `<div class="card">
          <div class="toolbar">
            <label class="field">Type<select id="f-kind">${opt(Object.keys(KIND), KIND, feedbackFilters.kind)}</select></label>
            <label class="field">Status<select id="f-status">${opt(Object.keys(STATUS), STATUS, feedbackFilters.status)}</select></label>
            <label class="field">Version<select id="f-ver">${opt(data.app_versions, null, feedbackFilters.app_version)}</select></label>
            <label class="field">Model<select id="f-model">${opt(data.device_models, null, feedbackFilters.device_model)}</select></label>
            <span class="muted count">${data.total} in total (kept up to 90 days)</span>
          </div>
          <div class="scroll-x"><table><thead><tr><th>Time</th><th>Type</th><th>Status</th><th>Description</th></tr></thead><tbody>
          ${data.items.map((i) => `<tr data-fb="${i.id}">
            <td class="nowrap aside minor">${esc(fmtTime(i.received_at))}</td><td class="nowrap">${esc(KIND[i.kind])}</td><td class="nowrap">${esc(STATUS[i.status])}</td>
            <td class="line breakable">${esc(i.description)}<span class="muted sub">App ${esc(i.app_version)} · ${esc(i.device_model)}</span></td></tr>`).join("") ||
            '<tr><td colspan="4" class="muted">No feedback</td></tr>'}
          </tbody></table></div>
          ${pages ? `<div class="row actions">
            <button id="f-prev" ${data.page <= 1 ? "disabled" : ""}>Previous</button>
            <span class="muted">Page ${data.page}</span>
            <button id="f-next" ${data.page * data.per_page >= data.total ? "disabled" : ""}>Next</button>
          </div>` : ""}
        </div>
        <div id="fb-detail"></div>
        <div class="card"><h3>Personal data deletion request</h3>
          <p class="muted">Delete all feedback from one e-mail (Privacy Policy, section 7).</p>
          <div class="row"><input id="del-email" class="field-wide" placeholder="email@example.com"><button id="del-email-btn" class="danger">Delete all</button></div>
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
        if (!email || !confirm(`Delete all feedback from ${email}? This can't be undone.`)) return;
        run(async () => {
          const r = await api.call("POST", "/api/admin/feedback/delete-by-email", { email });
          message(`Deleted ${r.deleted}`);
          await loadFeedback();
        });
      };
    });
  }

  function renderLogs(logs) {
    if (!logs) return '<p class="muted">No log (suggestions come without one).</p>';
    const lines = (logs.logs || []).map((l) => {
      const { t, lv, c, ...rest } = l;
      return `${t} ${String(lv).toUpperCase().padEnd(5)} ${c} ${Object.keys(rest).length ? JSON.stringify(rest) : ""}`;
    });
    return `<h4>Log (${lines.length} lines)</h4><pre class="log">${esc(lines.join("\n"))}</pre>
      ${logs.exit_reasons && logs.exit_reasons.length ? `<h4>Last exit reasons</h4><pre class="log">${esc(JSON.stringify(logs.exit_reasons, null, 1))}</pre>` : ""}
      ${logs.text ? `<pre class="log">${esc(logs.text)}</pre>` : ""}`;
  }

  async function showFeedback(id) {
    const mine = ++gen.detail;
    await run(async () => {
      const f = await api.call("GET", "/api/admin/feedback/" + id);
      if (mine !== gen.detail) return;
      $("fb-detail").innerHTML = `<div class="card">
        <div class="row detail-head"><div><strong>${esc(KIND[f.kind])}</strong><span class="muted breakable">${esc(f.id)}</span></div>
          <button id="fb-close" class="push">Close</button></div>
        <p>${esc(f.description).replace(/\n/g, "<br>")}</p>
        <p class="muted">Email: ${esc(f.email)} | Received: ${esc(fmtTime(f.received_at))} | Phone time: ${esc(fmtTime(f.device_time))}<br>
        App ${esc(f.app_version)} (${esc(f.build_number)}) | ${esc(f.device_model)} | ${esc(f.os_version)} | Install ID ${esc(f.install_id)}</p>
        <div class="row">
          <select id="fb-status">${Object.keys(STATUS).map((s) => `<option value="${s}" ${s === f.status ? "selected" : ""}>${STATUS[s]}</option>`).join("")}</select>
          <input id="fb-note" class="grow" value="${esc(f.admin_note)}" placeholder="Handling note">
          <button id="fb-save" class="primary">Save</button>
          <button id="fb-delete" class="danger">Delete</button>
        </div>
        <h4>Snapshot</h4><pre class="log">${esc(JSON.stringify(f.snapshot, null, 1))}</pre>
        ${renderLogs(f.logs)}
      </div>`;
      $("fb-close").onclick = () => { $("fb-detail").innerHTML = ""; };
      $("fb-save").onclick = () => run(async () => {
        await api.call("PATCH", "/api/admin/feedback/" + id, { status: $("fb-status").value, admin_note: $("fb-note").value });
        await loadFeedback();
      }, "Saved");
      $("fb-delete").onclick = () => {
        if (!confirm("Delete this feedback?")) return;
        run(async () => { await api.call("DELETE", "/api/admin/feedback/" + id); await loadFeedback(); }, "Deleted");
      };
      $("fb-detail").scrollIntoView({ behavior: "smooth" });
    });
  }

  // ── Admins ──────────────────────────────────────────────
  async function loadAdmins() {
    await run(async () => {
      const data = await api.call("GET", "/api/admin/admins");
      $("tab-admins").innerHTML = `<div class="card">
        <div class="scroll-x"><table><thead><tr><th>Email</th><th>Note</th><th></th></tr></thead><tbody>
        ${data.admins.map((a) => `<tr><td class="lead">${esc(a.email)}</td><td class="line minor breakable">${esc(a.note)}</td>
          <td class="nowrap aside">${a.fixed ? '<span class="muted">Set by environment variable</span>' : `<button data-rm="${esc(a.email)}" class="danger">Remove</button>`}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="row add-row"><label class="field field-wide">Email<input id="adm-email"></label><label class="field field-wide">Note<input id="adm-note"></label><button id="adm-add" class="primary">Add admin</button></div>
      </div>`;
      $("adm-add").onclick = () => run(async () => {
        await api.call("POST", "/api/admin/admins", { email: $("adm-email").value.trim(), note: $("adm-note").value.trim() });
        await loadAdmins();
      }, "Added");
      document.querySelectorAll("[data-rm]").forEach((b) => {
        b.onclick = () => {
          if (!confirm(`Remove ${b.dataset.rm}?`)) return;
          run(async () => { await api.call("DELETE", "/api/admin/admins/" + encodeURIComponent(b.dataset.rm)); await loadAdmins(); }, "Removed");
        };
      });
    });
  }

  // ── Audit log ───────────────────────────────────────────
  // Read-only: who changed what in this console, newest first. The backend records every write and
  // every refused request (router-backend shared/audit_log.py) and keeps 180 days.
  const AUDIT_ACTIONS = {
    login: "Sign in", logout: "Sign out", reload_cache: "Reload cache",
    create_font: "Add font", update_font: "Edit font", delete_font: "Delete font", upload_font_file: "Upload font file", publish_fonts: "Publish font list",
    put_app_config: "Edit app version settings",
    update_feedback: "Edit feedback", delete_feedback: "Delete feedback", delete_feedback_by_email: "Delete feedback by email",
    add_admin: "Add admin", remove_admin: "Remove admin",
  };
  const AUDIT_RESULTS = { ok: "OK", denied: "Refused", failed: "Failed" };
  let auditRows = [];

  async function loadAudit(more) {
    await run(async () => {
      const before = more && auditRows.length ? "?before=" + auditRows[auditRows.length - 1].id : "";
      const data = await api.call("GET", "/api/admin/audit" + before);
      auditRows = more ? auditRows.concat(data.items) : data.items;
      const label = (a) => AUDIT_ACTIONS[String(a).split(".").pop()] || a;
      $("tab-audit").innerHTML = `<div class="card">
        <div class="scroll-x"><table><thead><tr><th>Time</th><th>Account</th><th>Action</th><th>Target</th><th>Result</th></tr></thead><tbody>
        ${auditRows.map((r) => `<tr><td class="nowrap line minor last">${esc(fmtTime(r.at))}</td><td class="line">${esc(r.actor || "-")}</td><td class="lead">${esc(label(r.action))}</td>
          <td class="line minor breakable${r.target ? "" : " empty"}">${esc(r.target || "-")}</td><td class="nowrap aside${r.result === "ok" ? "" : " warn"}">${esc(AUDIT_RESULTS[r.result] || r.result)}</td></tr>`).join("")}
        </tbody></table></div>
        ${data.items.length === 50 ? '<div class="row actions"><button id="audit-more">Load older</button></div>' : ""}
        <p class="muted">Read-only: nothing here can be edited or deleted. Kept for 180 days.</p>
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
        <p>Font list version in cache: ${esc(o.cache.loaded ? (o.cache.fonts_version || "not published") : "not loaded")}<br>
        Font list version in database: ${esc(o.fonts_version || "not published")}<br>
        ${o.cache_consistent ? '<span class="ok">Consistent</span>' : '<span class="warn">Inconsistent</span>'}
        <span class="muted">(cache loaded ${esc(fmtTime(o.cache.loaded_at))})</span></p>
        <p>Feedback table: ${o.feedback_table_mb} MB (limit ${o.feedback_table_limit_mb} MB) | New feedback: ${o.new_feedback}</p>
        <button id="reload-cache">Reload cache</button>
        <p class="muted">If data was ever changed directly with SQL, press this or restart the backend.</p>
      </div>`;
      $("reload-cache").onclick = () => run(async () => { await api.call("POST", "/api/admin/cache/reload"); await loadSystem(); }, "Reloaded");
    });
  }

  start();
})();
