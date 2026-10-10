'use strict';

/* =====================================================================
   IbACE — Me tab: rotation calendar, daily log, concern reports
   Everything here is the phone owner's own record. It is kept in the
   "meta" store under keys starting "me:", and it is NEVER put in a sync
   file, the OIM Assist export or the Send to admin message. It leaves
   the phone only when the owner taps a share or send button.
   "Reset all data" (Settings) erases it with everything else.
   Loaded after tools.js; uses helpers from app.js and tools.js.
   ===================================================================== */

ICONS.calendar = '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>';

const ME_ROTATION_DEFAULT = { offStart: "2026-07-01", offDays: 14, onDays: 14 }; // off 1 to 14 July 2026, on duty 15 to 28 July, and so on
const ME_PLATFORMS = { IbA: "Irong Barat A (IbA)", IbB: "Irong Barat B (IbB)", IbC: "Irong Barat C (IbC)" };
const ME_MAX_PHOTOS = 3;
const ME_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const me = { rot: Object.assign({}, ME_ROTATION_DEFAULT), logs: {}, reports: {}, ot: { salary: "" }, month: "", showLogs: false, showReports: false };

/* ------------------------------ dates (calendar days, no time zones) ------------------------------ */
const meDayNumber = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : NaN; };
const meIso = (dayNumber) => new Date(dayNumber * 86400000).toISOString().slice(0, 10);
const meWeekday = (iso) => ME_WEEKDAYS[new Date(meDayNumber(iso) * 86400000).getUTCDay()];
function meNiceDate(iso, withYear) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? meWeekday(iso) + " " + Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + (withYear ? " " + m[1] : "") : ""; }

/** Where a date sits in the rotation: { on, day, of, left, changeOn }. */
function meRotation(iso) {
  const r = me.rot, cycle = r.offDays + r.onDays;
  const n = meDayNumber(iso), pos = (((n - meDayNumber(r.offStart)) % cycle) + cycle) % cycle;
  const on = pos >= r.offDays, day = on ? pos - r.offDays + 1 : pos + 1, of = on ? r.onDays : r.offDays;
  return { on, day, of, left: of - day, changeOn: meIso(n + (of - day) + 1) };
}

/* ------------------------------ storage ------------------------------ */
async function meLoad() {
  const found = {};
  await tx(["meta"], "readonly", (t) => {
    t.objectStore("meta").openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { if (typeof c.key === "string" && c.key.startsWith("me:")) found[c.key] = c.value; c.continue(); } };
  });
  const rot = found["me:rot"];
  me.rot = rot && !isNaN(meDayNumber(rot.offStart)) ? { offStart: rot.offStart, offDays: ME_ROTATION_DEFAULT.offDays, onDays: ME_ROTATION_DEFAULT.onDays } : Object.assign({}, ME_ROTATION_DEFAULT);
  me.logs = found["me:log"] && typeof found["me:log"] === "object" ? found["me:log"] : {};
  me.ot = found["me:ot"] && typeof found["me:ot"] === "object" ? found["me:ot"] : { salary: "" };
  me.reports = {};
  Object.keys(found).forEach((k) => { if (k.startsWith("me:rep:") && found[k] && found[k].id) me.reports[found[k].id] = found[k]; });
  me.month = todayLocal().slice(0, 7);
}
function meStore(values, okMessage) {
  return saveMeta(values).then(() => { if (okMessage) toast(okMessage, "success"); return true; })
    .catch((err) => { console.error(err); toast("That could not be saved to this phone. Check free storage and try again.", "error"); return false; });
}
function meSaveOt(v) { me.ot = { salary: String(v.salary || ""), type: v.type === "nonstaff" ? "nonstaff" : "staff", weekHours: v.weekHours === "39" ? "39" : "42" }; meStore({ "me:ot": me.ot }); }
const meReportList = () => Object.values(me.reports).sort((a, b) => b.ts - a.ts);
const meLogDates = () => Object.keys(me.logs).filter((d) => String(me.logs[d].text || "").trim()).sort().reverse();

/* ------------------------------ rotation card (also shown on Home) ------------------------------ */
function meRotationCard(idName) {
  const today = todayLocal(), r = meRotation(today);
  return h("section", { class: "rot-card " + (r.on ? "is-on" : "is-off"), id: idName || "rot-card", "aria-label": "Rotation" },
    h("div", { class: "rot-top" }, h("span", { class: "rot-label", text: "Rotation" }), h("span", { class: "hint", text: meNiceDate(today, true) })),
    h("p", { class: "rot-main" }, h("strong", { text: "Day " + r.day }), h("span", { text: " of " + r.of + ", " + (r.on ? "on duty" : "off") })),
    h("div", { class: "rot-bar", "aria-hidden": "true" }, Array.from({ length: r.of }, (_, i) => h("span", { class: i < r.day ? "is-done" : "" }))),
    h("p", { class: "hint rot-next", text: (r.left === 0 ? "Last day. " : r.left + (r.left === 1 ? " day" : " days") + " to go. ") + (r.on ? "Off from " : "Back on duty ") + meNiceDate(r.changeOn) + "." }));
}

async function meEditRotation() {
  const v = await formDialog({
    title: "Rotation dates",
    message: ["14 days off, then 14 days on duty, repeating.", "Enter the first day of any one of your off periods. If you are on the opposite crew, your off period starts 14 days later."],
    fields: [{ name: "offStart", label: "First day of an off period", type: "date", value: me.rot.offStart, required: true, requiredMessage: "Choose the date." }],
    confirmLabel: "Save",
    validate: (x) => (isNaN(meDayNumber(x.offStart)) ? { message: "Choose a valid date.", field: "offStart" } : null)
  });
  if (!v) return;
  me.rot.offStart = v.offStart;
  await meStore({ "me:rot": { offStart: me.rot.offStart } }, "Rotation dates saved");
  opsRenderTabs();
}

function meCalendar() {
  const [y, m] = me.month.split("-").map(Number), today = todayLocal();
  const first = meDayNumber(me.month + "-01"), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(first * 86400000).getUTCDay() + 6) % 7; // weeks start on Monday
  const move = (by) => { const d = new Date(Date.UTC(y, m - 1 + by, 1)); me.month = d.toISOString().slice(0, 7); meRender(); };
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h("span", { class: "cal-day is-blank" }));
  for (let d = 1; d <= days; d++) {
    const iso = meIso(first + d - 1), r = meRotation(iso), logged = !!(me.logs[iso] && String(me.logs[iso].text || "").trim());
    cells.push(h("span", { class: "cal-day " + (r.on ? "is-on" : "is-off") + (iso === today ? " is-today" : ""), "data-date": iso,
      "aria-label": meNiceDate(iso) + ", " + (r.on ? "on duty, day " : "off, day ") + r.day + (iso === today ? ", today" : "") + (logged ? ", has a daily log" : "") },
      String(d), logged ? h("span", { class: "cal-dot", "aria-hidden": "true" }) : null));
  }
  return h("section", { class: "block", id: "me-cal" },
    h("div", { class: "cal-head" },
      h("button", { type: "button", class: "icon-btn", id: "cal-prev", "aria-label": "Previous month", onclick: () => move(-1) }, icon("back")),
      h("h3", { id: "cal-title", text: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1] + " " + y }),
      h("button", { type: "button", class: "icon-btn", id: "cal-next", "aria-label": "Next month", onclick: () => move(1) }, icon("next"))),
    h("div", { class: "cal-grid cal-week", "aria-hidden": "true" }, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => h("span", { text: d }))),
    h("div", { class: "cal-grid", id: "cal-grid" }, cells),
    h("div", { class: "cal-key" },
      h("span", null, h("span", { class: "cal-swatch is-on" }), "On duty"), h("span", null, h("span", { class: "cal-swatch is-off" }), "Off"),
      h("span", null, h("span", { class: "cal-swatch is-today" }), "Today"), h("span", null, h("span", { class: "cal-dot" }), "Daily log")),
    h("div", { class: "btn-row" },
      me.month !== today.slice(0, 7) ? h("button", { type: "button", class: "btn", id: "cal-today", onclick: () => { me.month = today.slice(0, 7); meRender(); } }, "This month") : null,
      h("button", { type: "button", class: "btn btn-quiet", id: "rot-edit", onclick: meEditRotation }, "Change rotation dates")));
}

/* ------------------------------ daily log ------------------------------ */
let meLogTimer = null;
function meSaveLog(date, text, quiet) {
  const clean = String(text || "");
  if (!clean.trim()) delete me.logs[date]; else me.logs[date] = { text: clean, ts: Date.now() };
  return meStore({ "me:log": me.logs }).then((ok) => { const el = document.getElementById("log-state"); if (el && !quiet) el.textContent = ok ? "Saved on this phone" : "Not saved"; return ok; });
}
function meLogText(date) { return "*What I did excellent today*\n" + meNiceDate(date, true) + "\n" + (state.operator || "") + "\n\n" + me.logs[date].text.trim(); }
async function meShareText(text, doneMessage) {
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch (err) { if (err && err.name === "AbortError") return; console.error(err); }
  try { await copyText(text); toast(doneMessage, "success"); } catch (err) { console.error(err); toast("It could not be copied automatically.", "error"); }
}
async function meEditLog(date) {
  const v = await formDialog({
    title: "Daily log, " + meNiceDate(date, true),
    fields: [{ name: "text", label: "What I did excellent that day", type: "textarea", value: me.logs[date] ? me.logs[date].text : "", maxlength: 2000 }],
    confirmLabel: "Save"
  });
  if (!v) return;
  await meSaveLog(date, v.text, true);
  toast(v.text.trim() ? "Daily log saved" : "Daily log entry removed", "success");
  meRender();
}
function meLogSection() {
  const today = todayLocal(), past = meLogDates().filter((d) => d !== today);
  const box = h("textarea", { class: "input", id: "log-today", rows: 3, maxlength: 2000, placeholder: "For example: found and reported a weeping flange before start-up." });
  box.value = me.logs[today] ? me.logs[today].text : "";
  box.addEventListener("input", () => { const el = document.getElementById("log-state"); if (el) el.textContent = "Saving…"; clearTimeout(meLogTimer); meLogTimer = setTimeout(() => meSaveLog(today, box.value), 400); });
  box.addEventListener("change", () => { clearTimeout(meLogTimer); meSaveLog(today, box.value); });
  return h("section", { class: "block", id: "me-log" },
    h("div", { class: "block-head" }, h("h3", { text: "Daily log" }), h("span", { class: "save-state", id: "log-state", "aria-live": "polite", text: "Kept on this phone only" })),
    h("div", { class: "field" }, h("label", { for: "log-today", text: "What I did excellent today" }), box),
    h("div", { class: "btn-row" },
      h("button", { type: "button", class: "btn", id: "log-share", onclick: async () => { clearTimeout(meLogTimer); await meSaveLog(today, box.value); if (!me.logs[today]) { toast("Write something first.", "error"); return; } meShareText(meLogText(today), "Entry copied. Paste it where you want to send it."); } }, "Share today's entry"),
      past.length ? h("button", { type: "button", class: "btn btn-quiet", id: "log-past", "aria-expanded": String(me.showLogs), onclick: () => { me.showLogs = !me.showLogs; meRender(); } }, (me.showLogs ? "Hide" : "Show") + " past entries (" + past.length + ")") : null),
    me.showLogs && past.length ? h("ul", { class: "me-list", id: "log-list" }, past.map((d) => h("li", null,
      h("button", { type: "button", class: "me-row", onclick: () => meEditLog(d) }, h("strong", { text: meNiceDate(d, true) }), h("span", { text: me.logs[d].text.trim() })),
      h("button", { type: "button", class: "btn btn-small", "aria-label": "Share the entry for " + meNiceDate(d, true), onclick: () => meShareText(meLogText(d), "Entry copied. Paste it where you want to send it.") }, "Share")))) : null);
}

/* ------------------------------ report a concern ------------------------------ */
/** Reports saved by an earlier version used other field names; this reads either. */
function meReportFields(r) {
  const at = String(r.at || nowLocalISO());
  return { date: r.date || at.slice(0, 10), time: r.time || at.slice(11, 16), description: r.description != null ? r.description : (r.details || ""), action: r.action || "", forward: r.forward || "" };
}
/** The WhatsApp message, in the crew's "Operation Concern / Highlight" format. Action Taken and Way Forward are left out when empty. */
function meReportText(r) {
  const f = meReportFields(r), d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.date);
  const lines = ["*Operation Concern / Highlight*", "", "Dear OIM / OS,", "",
    "*Title:* " + r.title.trim(),
    "*Date:* " + (d ? d[3] + "/" + d[2] + "/" + d[1] : f.date) + (f.time ? " at " + f.time : ""),
    "*Platform:* " + (ME_PLATFORMS[r.platform] || r.platform),
    "*Module/Area:* " + (r.area.trim() || "-"), "",
    "*Description:*", f.description.trim()];
  if (f.action.trim()) lines.push("", "*Action Taken:*", f.action.trim());
  if (f.forward.trim()) lines.push("", "*Way Forward:*", f.forward.trim());
  if (r.photos.length) lines.push("", "*Photos:* " + r.photos.length + " (sent separately)");
  lines.push("", "Regards,", r.by || state.operator || "");
  return lines.join("\n");
}
function mePhotoFiles(r) {
  return r.photos.map((data, i) => {
    const bin = atob(data.split(",")[1]), bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    return new File([bytes], "concern_" + meReportFields(r).date + "_" + (i + 1) + ".jpg", { type: "image/jpeg" });
  });
}

/** The concern form. id = an existing report, or null for a new one. Nothing is kept until Save draft or a send button is used. */
function meOpenReport(id) {
  const existing = id ? me.reports[id] : null;
  const r = existing ? clone(existing) : { id: "r" + Date.now().toString(36), ts: 0, at: nowLocalISO(), by: state.operator, platform: "IbA", area: "", title: "", photos: [], status: "draft", sentAt: "" };
  Object.assign(r, meReportFields(r)); // date, time, description, action, forward
  const platform = h("select", { class: "input", id: "rep-platform" }, Object.keys(ME_PLATFORMS).map((p) => h("option", { value: p }, ME_PLATFORMS[p]))); platform.value = r.platform;
  const text = (idName, value, max) => { const el = h("input", { class: "input", id: idName, type: "text", maxlength: max, autocomplete: "off" }); el.value = value; return el; };
  const area = text("rep-area", r.area, 120), title = text("rep-title", r.title, 160);
  const area0 = (idName, value, rows) => { const el = h("textarea", { class: "input", id: idName, rows, maxlength: 2000 }); el.value = value; return el; };
  const details = area0("rep-details", r.description, 4), action = area0("rep-action", r.action, 3), forward = area0("rep-forward", r.forward, 2);
  const date = h("input", { class: "input", id: "rep-date", type: "date" }); date.value = r.date;
  const time = h("input", { class: "input", id: "rep-time", type: "time" }); time.value = r.time;
  const photoBox = h("div", { class: "rep-photos", id: "rep-photos" });
  const cam = h("input", { type: "file", accept: "image/*", capture: "environment", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
  const gal = h("input", { type: "file", accept: "image/*", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true", id: "rep-file" });
  const drawPhotos = () => photoBox.replaceChildren(
    ...r.photos.map((src, i) => h("div", { class: "rep-photo" }, h("img", { src, alt: "Photo " + (i + 1) }),
      h("button", { type: "button", class: "btn btn-small", "aria-label": "Remove photo " + (i + 1), onclick: () => { r.photos.splice(i, 1); drawPhotos(); } }, "Remove"))),
    r.photos.length < ME_MAX_PHOTOS ? h("div", { class: "btn-row" },
      h("button", { type: "button", class: "btn", onclick: () => cam.click() }, icon("camera"), "Take photo"),
      h("button", { type: "button", class: "btn", onclick: () => gal.click() }, icon("image"), "Choose from gallery")) : h("p", { class: "hint", text: "The most photos one report can hold is " + ME_MAX_PHOTOS + "." }));
  const onPick = async (e) => {
    const file = e.target.files && e.target.files[0]; e.target.value = "";
    if (!file || r.photos.length >= ME_MAX_PHOTOS) return;
    try { r.photos.push(await compressImage(file)); drawPhotos(); } catch (err) { console.error(err); toast("That photo could not be read. Try another one.", "error"); }
  };
  cam.addEventListener("change", onPick); gal.addEventListener("change", onPick);
  drawPhotos();

  const collect = () => {
    Object.assign(r, { platform: platform.value, area: area.value, title: title.value, description: details.value, action: action.value, forward: forward.value, date: date.value || r.date, time: time.value });
    delete r.details;
    if (!r.title.trim()) { toast("Enter the title.", "error"); title.classList.add("is-invalid"); title.focus(); return false; }
    if (!r.description.trim()) { toast("Enter the description.", "error"); details.classList.add("is-invalid"); details.focus(); return false; }
    return true;
  };
  const keep = async (status) => {
    r.ts = Date.now();
    if (status === "sent") { r.status = "sent"; r.sentAt = nowLocalISO(); }
    me.reports[r.id] = clone(r);
    const ok = await meStore({ ["me:rep:" + r.id]: me.reports[r.id] });
    opsRenderTabs();
    return ok;
  };
  async function saveDraft() { if (!collect()) return; if (await keep()) { toast("Saved. Send it when you have a connection.", "success"); panel.close(); } }
  async function sendText() {
    if (!collect()) return;
    let copied = true;
    try { await copyText(meReportText(r)); } catch (err) { console.error(err); copied = false; }
    window.open("https://wa.me/" + ADMIN_WHATSAPP, "_blank");
    await keep("sent");
    toast(copied ? "Report copied. In the admin's WhatsApp chat, press and hold the message box, tap Paste, then send." : "The report could not be copied automatically.", copied ? "success" : "error");
    drawActions();
  }
  async function sharePhotos() {
    if (!collect()) return;
    const files = mePhotoFiles(r);
    if (!(navigator.share && navigator.canShare && navigator.canShare({ files }))) { toast("This phone cannot share photos from here. Save them from the report and attach them in WhatsApp yourself.", "error"); return; }
    try { await navigator.share({ files, text: meReportText(r) }); await keep("sent"); toast("Photos handed to the share screen. Choose WhatsApp, then the admin.", "success"); }
    catch (err) { if (err && err.name === "AbortError") return; console.error(err); toast("Sharing did not work.", "error"); }
  }
  async function remove() {
    if (!(await confirmDialog({ title: "Delete this report?", message: "The text and photos are removed from this phone.", confirmLabel: "Delete report", danger: true }))) return;
    delete me.reports[r.id];
    try { await tx(["meta"], "readwrite", (t) => { t.objectStore("meta").delete("me:rep:" + r.id); }); } catch (err) { console.error(err); }
    toast("Report deleted", "success"); opsRenderTabs(); panel.close();
  }
  const actions = h("div", { class: "rep-actions" });
  const drawActions = () => actions.replaceChildren(
    h("button", { type: "button", class: "btn btn-wa btn-big btn-block", id: "rep-send", onclick: sendText }, "Copy and open WhatsApp"),
    h("p", { class: "hint", text: "The report is copied and the admin's chat (" + ADMIN_WHATSAPP_DISPLAY + ") opens. Paste, then send. This needs a connection." }),
    h("button", { type: "button", class: "btn btn-block", id: "rep-share", onclick: sharePhotos }, "Share photos"),
    h("p", { class: "hint", text: "WhatsApp cannot take photos from a link. Share photos opens the phone's share screen: choose WhatsApp, then the admin." }),
    h("div", { class: "btn-row" },
      h("button", { type: "button", class: "btn", id: "rep-save", onclick: saveDraft }, existing ? "Save changes" : "Save draft"),
      existing ? h("button", { type: "button", class: "btn btn-quiet btn-quiet-danger", id: "rep-delete", onclick: remove }, "Delete report") : null));
  drawActions();

  const panel = openPanel(existing ? "Concern / highlight" : "Report a concern or highlight", [
    r.status === "sent" ? h("p", { class: "notice notice-ok" }, icon("check"), h("span", { text: "Sent " + fmtTime(r.sentAt) })) : null,
    h("div", { class: "field" }, h("label", { for: "rep-title", text: "Title" }), title),
    h("div", { class: "two-col" }, h("div", { class: "field" }, h("label", { for: "rep-date", text: "Date" }), date), h("div", { class: "field" }, h("label", { for: "rep-time", text: "Time" }), time)),
    h("div", { class: "field" }, h("label", { for: "rep-platform", text: "Platform" }), platform),
    h("div", { class: "field" }, h("label", { for: "rep-area", text: "Module / Area" }), area),
    h("div", { class: "field" }, h("label", { for: "rep-details", text: "Description" }), details),
    h("div", { class: "field" }, h("label", { for: "rep-action", text: "Action taken (if any)" }), action),
    h("div", { class: "field" }, h("label", { for: "rep-forward", text: "Way forward (if any)" }), forward),
    h("h3", { text: "Photos (optional)" }), photoBox, cam, gal,
    h("hr"), actions
  ].filter(Boolean), { id: "rep-dialog-title" });
  title.focus();
}

function meReportSection() {
  const list = meReportList(), drafts = list.filter((r) => r.status !== "sent").length;
  return h("section", { class: "block", id: "me-reports" },
    h("div", { class: "block-head" }, h("h3", { text: "Report a concern" }), drafts ? h("span", { class: "save-state", text: drafts + (drafts === 1 ? " draft waiting" : " drafts waiting") }) : null),
    h("p", { class: "hint", text: "Text and photos, sent to the admin on WhatsApp. Save it as a draft when there is no connection." }),
    h("button", { type: "button", class: "btn btn-primary btn-block", id: "rep-new", onclick: () => meOpenReport(null) }, "New report"),
    list.length ? h("ul", { class: "me-list", id: "rep-list" }, list.map((r) => h("li", null,
      h("button", { type: "button", class: "me-row", onclick: () => meOpenReport(r.id) },
        h("strong", { text: r.title.trim() || "Untitled" }),
        h("span", { text: [r.platform, r.area.trim(), fmtTime(meReportFields(r).date + "T" + (meReportFields(r).time || "00:00")), r.photos.length ? r.photos.length + (r.photos.length === 1 ? " photo" : " photos") : ""].filter(Boolean).join(", ") })),
      h("span", { class: "me-tag " + (r.status === "sent" ? "is-sent" : "is-draft"), text: r.status === "sent" ? "Sent" : "Draft" })))) : null);
}

/* ------------------------------ screen ------------------------------ */
function meRender() {
  const root = $("#view-me");
  if (!root) return;
  if (document.activeElement && document.activeElement.id === "log-today") return; // do not redraw under the keyboard
  root.replaceChildren(meRotationCard("rot-card-me"), meCalendar(), meLogSection(), meReportSection());
}
