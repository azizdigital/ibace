'use strict';

/* =====================================================================
   IbACE — Operator locks
   A second, separate register for the operators' own shared locks.
   For their record and reference only: two statuses (available / in use),
   photo optional, no OIM password, and nothing here is ever written into
   the OIM Assist export files. Loaded after app.js and uses its helpers.
   ===================================================================== */

/* ---------------------------------------------------------------------
   OPERATOR LOCK LIST — CHANGE IT HERE.
   Mock-up list: Prod-01 .. Prod-30. Replace with the real lock numbers,
   for example: const OPS_LOCK_IDS = ["P-101", "P-102", "P-103"];
   then bump CACHE_VERSION in service-worker.js.
   On the next launch new ids are added. Ids taken off the list are removed
   only if they are available and have no history; otherwise they are kept.
   --------------------------------------------------------------------- */
const OPS_LOCK_IDS = (() => {
  const ids = [];
  for (let n = 1; n <= 30; n++) ids.push("Prod-" + String(n).padStart(2, "0"));
  return ids;
})();

const OPS_FIELDS = ["usedBy", "isolationDesc", "location", "remarks"];
const OPS_STATUS = {
  available: { label: "Available", icon: "unlock" },
  inuse:     { label: "In use",    icon: "lock" }
};

const opsState = { locks: [], filters: { status: "All", q: "" }, openId: null, view: "oim", busy: false };
const opsPhotos = {}; // in-memory mirror of the "opsPhotos" store: { id: dataURL }

function opsBlank(id) {
  return {
    id, status: "available",
    usedBy: "", isolationDesc: "", location: "", remarks: "",
    takenAt: "", recordedBy: "",
    lockBox: "", boxChanges: "", // lockbox.js
    log: []
  };
}
function opsGet(id) { return opsState.locks.find((l) => l.id === id) || null; }
function opsOrder(id) { const i = OPS_LOCK_IDS.indexOf(id); return i < 0 ? OPS_LOCK_IDS.length : i; }
function opsSort() {
  opsState.locks.sort((a, b) => opsOrder(a.id) - opsOrder(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function opsCounts() {
  const inuse = opsState.locks.filter((l) => l.status === "inuse").length;
  return { inuse, available: opsState.locks.length - inuse, total: opsState.locks.length };
}
function opsPill(status) {
  const meta = OPS_STATUS[status] || OPS_STATUS.available;
  return h("span", { class: "pill st-" + status }, icon(meta.icon), meta.label);
}

/* ------------------------------ storage ------------------------------ */
async function opsLoad() {
  let stored = [];
  const photos = {};
  await tx(["opsLocks", "opsPhotos"], "readonly", (t) => {
    t.objectStore("opsLocks").getAll().onsuccess = (e) => { stored = e.target.result || []; };
    t.objectStore("opsPhotos").openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (c) { photos[c.key] = c.value; c.continue(); }
    };
  });

  // Bring the stored locks in line with OPS_LOCK_IDS without ever dropping a record that holds information.
  const have = new Set(stored.map((l) => l.id));
  const toAdd = OPS_LOCK_IDS.filter((id) => !have.has(id)).map(opsBlank);
  const toRemove = stored.filter((l) => !OPS_LOCK_IDS.includes(l.id) && l.status !== "inuse" && !(Array.isArray(l.log) && l.log.length));
  if (toAdd.length || toRemove.length) {
    await tx(["opsLocks", "opsPhotos"], "readwrite", (t) => {
      const s = t.objectStore("opsLocks"), ps = t.objectStore("opsPhotos");
      toAdd.forEach((l) => s.put(l));
      toRemove.forEach((l) => { s.delete(l.id); ps.delete(l.id); });
    });
  }
  const gone = new Set(toRemove.map((l) => l.id));
  opsState.locks = stored.filter((l) => !gone.has(l.id)).concat(toAdd)
    .map((l) => Object.assign(opsBlank(l.id), l, { status: l.status === "inuse" ? "inuse" : "available", log: Array.isArray(l.log) ? l.log : [] }));
  opsSort();
  for (const k of Object.keys(opsPhotos)) delete opsPhotos[k];
  for (const [k, v] of Object.entries(photos)) if (!gone.has(k)) opsPhotos[k] = v;
}

/** photoChange: undefined = leave photo alone, null = delete, string = save. */
async function opsCommit(next, photoChange) {
  next.updatedTs = Date.now(); // see sync.js
  await tx(["opsLocks", "opsPhotos"], "readwrite", (t) => {
    t.objectStore("opsLocks").put(next);
    if (photoChange === null) t.objectStore("opsPhotos").delete(next.id);
    else if (typeof photoChange === "string") t.objectStore("opsPhotos").put(photoChange, next.id);
  });
  const i = opsState.locks.findIndex((l) => l.id === next.id);
  if (i >= 0) opsState.locks[i] = next; else opsState.locks.push(next);
  if (photoChange === null) delete opsPhotos[next.id];
  else if (typeof photoChange === "string") opsPhotos[next.id] = photoChange;
}

/* ------------------------------ view switch ------------------------------ */
const VIEWS = ["home", "oim", "ops", "tools", "me"];
function opsSetView(view) {
  opsState.view = VIEWS.includes(view) ? view : "home";
  if (opsState.view === "oim" || opsState.view === "ops") opsState.lockView = opsState.view; // the Locks tab reopens on the register used last
  VIEWS.forEach((v) => { $("#view-" + v).hidden = opsState.view !== v; });
  $("#lock-switch").hidden = !(opsState.view === "oim" || opsState.view === "ops");
  window.scrollTo(0, 0);
  if (opsState.view === "ops") opsRender();
  else if (opsState.view === "oim") renderRegister(); // app.js
  else opsRenderTabs();
}

/** Redraws the bottom tab bar and the screen that is showing. Called after every change. */
function opsRenderTabs() {
  const c = opsCounts();
  const oimOut = state.padlocks.filter((p) => p.status !== "available").length;
  const inLocks = opsState.view === "oim" || opsState.view === "ops";
  const tab = (key, label, iconName, active, sub, go) => h("button", {
    type: "button", role: "tab", class: "tab" + (active ? " is-active" : ""), id: "tab-" + key,
    "aria-selected": String(active), "aria-label": label + (sub ? ", " + sub : ""), onclick: () => opsSetView(go)
  }, icon(iconName), h("span", { class: "tab-name", text: label }));
  $("#view-tabs").replaceChildren(
    tab("home", "Home", "home", opsState.view === "home", "", "home"),
    tab("locks", "Locks", "lock", inLocks, (oimOut + c.inuse) + " in use", opsState.lockView || "oim"),
    tab("tools", "Tools", "tools", opsState.view === "tools", "", "tools"),
    tab("me", "Me", "user", opsState.view === "me", "", "me"));
  const seg = (view, label, n, total) => h("button", {
    type: "button", class: "seg-btn" + (opsState.view === view ? " is-active" : ""), id: "seg-" + view, "aria-pressed": String(opsState.view === view), onclick: () => opsSetView(view)
  }, label, h("span", { class: "seg-sub", text: n + " of " + total + " in use" }));
  $("#lock-switch").replaceChildren(seg("oim", "OIM padlocks", oimOut, state.padlocks.length), seg("ops", "Prod locks", c.inuse, c.total));
  if (opsState.view === "home") homeRender(); // home.js
  else if (opsState.view === "tools") toolsRender(); // tools.js
  else if (opsState.view === "me") meRender(); // me.js
}

/* ------------------------------ register ------------------------------ */
function opsFiltered() {
  const f = opsState.filters;
  const q = f.q.trim().toLowerCase();
  return opsState.locks.filter((l) => {
    if (f.status !== "All" && l.status !== f.status) return false;
    if (q && !(l.id.toLowerCase().includes(q) || (l.usedBy || "").toLowerCase().includes(q) || (l.location || "").toLowerCase().includes(q) || (l.lockBox || "").toLowerCase().includes(q))) return false;
    return true;
  });
}

function opsRender() {
  opsRenderTabs();
  const c = opsCounts();
  const tile = (key, cls, label, value) => h("button", {
    type: "button", class: "count " + cls + (opsState.filters.status === key ? " is-active" : ""),
    "aria-pressed": String(opsState.filters.status === key),
    "aria-label": value + " " + label,
    onclick: () => { opsState.filters.status = key; opsRender(); }
  }, h("span", { class: "count-num", text: String(value) }), h("span", { class: "count-label", text: label }));
  $("#ops-counts").replaceChildren(
    tile("available", "count-available", "Available", c.available),
    tile("inuse", "count-issued", "In use", c.inuse),
    tile("All", "count-total", "Total", c.total));

  $("#ops-filter-status").replaceChildren(
    h("span", { class: "chip-row-label", text: "Status" }),
    ...["All", "available", "inuse"].map((v) => h("button", {
      type: "button", class: "fchip" + (opsState.filters.status === v ? " is-active" : ""),
      "aria-pressed": String(opsState.filters.status === v),
      onclick: () => { opsState.filters.status = v; opsRender(); }
    }, v === "All" ? "All" : OPS_STATUS[v].label)));

  opsRenderGrid();
}

function opsRenderGrid() {
  const list = opsFiltered();
  const grid = $("#ops-grid");
  $("#ops-result-count").textContent = list.length === opsState.locks.length
    ? "Showing all " + list.length + " operator locks"
    : "Showing " + list.length + " of " + opsState.locks.length + " operator locks";
  if (!list.length) {
    grid.replaceChildren(h("div", { class: "empty" },
      h("p", { text: "No operator locks match these filters." }),
      h("button", { type: "button", class: "btn", onclick: () => { opsState.filters = { status: "All", q: "" }; $("#ops-search").value = ""; opsRender(); } }, "Clear filters")));
    return;
  }
  grid.replaceChildren(...list.map((l) => {
    const hasPhoto = !!opsPhotos[l.id];
    return h("button", {
      type: "button", class: "card st-" + l.status,
      "aria-label": l.id + ", " + OPS_STATUS[l.status].label + (l.usedBy ? ", used by " + l.usedBy : "") + (l.status === "inuse" && l.lockBox ? ", lock box " + l.lockBox : "") + (hasPhoto ? ", has photo" : ""),
      onclick: () => opsOpen(l.id)
    },
      h("span", { class: "card-top" }, h("span", { class: "card-id", text: l.id }), hasPhoto ? icon("camera", "card-cam") : null),
      h("span", { class: "card-cat", text: l.status === "inuse" && l.location ? l.location : "Operator lock" }),
      lbCardLine("ops", l), // lockbox.js
      h("span", { class: "card-state" }, opsPill(l.status), l.status === "inuse" ? ageEl(l.takenAt) : null), // ageEl: home.js
      h("span", { class: "card-who", text: l.status === "inuse" ? l.usedBy : " " }));
  }));
}

/* ------------------------------ lock sheet ------------------------------ */
let opsFieldTimer = null;
let opsChain = Promise.resolve();
function opsSerial(fn) {
  const p = opsChain.then(fn);
  opsChain = p.catch(() => {});
  return p;
}
function opsReadFields() {
  const out = {};
  for (const k of OPS_FIELDS) {
    const el = document.getElementById("o-" + k);
    if (!el) return null;
    out[k] = el.value;
  }
  return out;
}
function opsSaveState(text, isError) {
  const el = document.getElementById("ops-save-state");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-error", !!isError);
}
/** Save edited details of a lock that is in use. Details of an available lock are saved by "Take lock". */
function opsFlush() {
  clearTimeout(opsFieldTimer);
  const id = opsState.openId;
  const vals = opsReadFields();
  if (!id || !vals) return opsChain;
  return opsSerial(async () => {
    const l = opsGet(id);
    if (!l || l.status !== "inuse" || OPS_FIELDS.every((k) => l[k] === vals[k])) return;
    try {
      await opsCommit(Object.assign({}, l, vals));
      if (opsState.openId === id) opsSaveState("Saved");
      opsRender();
    } catch (err) {
      if (opsState.openId === id) opsSaveState("Not saved", true);
      toast("Your edits could not be saved to this device. Check free storage and try again.", "error");
      throw err;
    }
  });
}
function opsOnInput() {
  const l = opsGet(opsState.openId);
  if (!l || l.status !== "inuse") return;
  opsSaveState("Saving…");
  clearTimeout(opsFieldTimer);
  opsFieldTimer = setTimeout(() => { opsFlush().catch(() => {}); }, 350);
}

function opsOpen(id) {
  if (!opsGet(id)) return;
  opsState.openId = id;
  opsRenderSheet(true);
  const closeBtn = document.getElementById("ops-sheet-close");
  if (closeBtn) closeBtn.focus();
}
async function opsClose() {
  try { await opsFlush(); } catch (_) { /* toast already shown */ }
  opsState.openId = null;
  opsRenderSheet();
  opsRender();
}

function opsField(key, label, value, o) {
  const opts = o || {};
  const id = "o-" + key;
  const props = {
    id, class: "input", maxlength: opts.maxlength || 200, placeholder: opts.placeholder, autocomplete: "off",
    autocapitalize: opts.autocapitalize || "sentences", oninput: opsOnInput, onchange: () => { opsFlush().catch(() => {}); }
  };
  const input = opts.textarea ? h("textarea", Object.assign({ rows: 2 }, props)) : h("input", Object.assign({ type: "text" }, props));
  input.value = value || "";
  return h("div", { class: "field" }, h("label", { for: id, text: label }), input);
}

function opsPhotoSection(l) {
  if (l.status !== "inuse") {
    return h("section", { class: "block" }, h("h3", { text: "Photo (optional)" }),
      h("p", { class: "hint", text: "A photo can be added once the lock is taken. It is not required." }));
  }
  const photo = opsPhotos[l.id];
  const camInput = h("input", { type: "file", accept: "image/*", capture: "environment", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
  const galInput = h("input", { type: "file", accept: "image/*", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
  const onPick = (e) => { const file = e.target.files && e.target.files[0]; e.target.value = ""; if (file) opsPhotoPicked(file); };
  camInput.addEventListener("change", onPick);
  galInput.addEventListener("change", onPick);
  return h("section", { class: "block" },
    h("h3", { text: "Photo (optional)" }),
    photo ? h("button", { type: "button", class: "thumb", "aria-label": "View photo full size", onclick: () => openViewer(photo, l.id) },
      h("img", { src: photo, alt: "Photo for " + l.id })) : null,
    h("p", { class: "hint", text: photo ? "Tap the photo to view it full size. It is deleted when the lock is returned." : "No photo yet. Add one if it helps as a reference." }),
    h("div", { class: "btn-row" },
      h("button", { type: "button", class: "btn btn-accent", onclick: () => camInput.click() }, icon("camera"), photo ? "Retake photo" : "Take photo"),
      h("button", { type: "button", class: "btn", onclick: () => galInput.click() }, icon("image"), "Choose from gallery"),
      photo ? h("button", { type: "button", class: "btn btn-quiet", onclick: () => opsRemovePhoto(l.id) }, "Remove photo") : null),
    camInput, galInput);
}

function opsHistorySection(l) {
  const log = l.log;
  const head = h("h3", { text: "History" + (log.length ? " (" + log.length + ")" : "") });
  if (!log.length) return h("section", { class: "block" }, head, h("p", { class: "hint", text: "No history yet. A record is added each time this lock is returned." }));
  const line = (label, value) => (value ? h("div", { class: "log-line" }, h("dt", { text: label }), h("dd", { text: value })) : null);
  return h("section", { class: "block" }, head,
    h("ol", { class: "log" }, log.map((e) => h("li", { class: "log-entry" },
      h("p", { class: "log-title", text: e.usedBy || "User not recorded" }),
      h("dl", null,
        line("Isolation", e.isolationDesc),
        line("Location", e.location),
        line("Lock box", (e.lockBox || "") + (e.boxChanges ? " (changed: " + e.boxChanges + ")" : "")),
        line("Returned while", e.oimStillInBox ? e.oimStillInBox + " was still in the box" : ""),
        line("Taken", fmtTime(e.takenAt) + (e.recordedBy ? " (recorded by " + e.recordedBy + ")" : "")),
        line("Returned", e.syncConflict ? "Not returned: replaced by a newer record from another phone during sync" : fmtTime(e.returnedAt) + (e.returnedBy ? " (recorded by " + e.returnedBy + ")" : "")),
        line("Photo", e.hadPhoto ? "Yes" : "No"),
        line("Remarks", e.remarks))))));
}

function opsRenderSheet(fresh) {
  const root = $("#ops-sheet");
  const l = opsState.openId ? opsGet(opsState.openId) : null;
  if (!l) {
    root.hidden = true;
    root.replaceChildren();
    document.body.classList.remove("no-scroll");
    return;
  }
  const prevBody = root.querySelector(".sheet-body");
  const prevScroll = prevBody && !fresh ? prevBody.scrollTop : 0;
  const draft = !fresh && l.status === "available" ? opsReadFields() : null; // keep what was typed if the sheet redraws
  const inuse = l.status === "inuse";
  const val = (k) => (draft ? draft[k] : l[k]);

  const panel = h("div", { class: "sheet st-" + l.status, role: "dialog", "aria-modal": "true", "aria-labelledby": "ops-sheet-title" },
    h("header", { class: "sheet-head" },
      h("div", null, h("h2", { id: "ops-sheet-title", class: "sheet-id", text: l.id }), h("p", { class: "sheet-cat", text: "Operator lock" })),
      opsPill(l.status),
      h("button", { type: "button", class: "icon-btn", id: "ops-sheet-close", "aria-label": "Close", onclick: opsClose }, icon("close"))),
    h("div", { class: "sheet-body" },
      lbSection("ops", l), // lockbox.js
      inuse ? h("ul", { class: "facts" }, h("li", null, "Taken " + fmtTime(l.takenAt) + (l.recordedBy ? ", recorded by " + l.recordedBy : ""))) : null,
      h("section", { class: "block" },
        h("div", { class: "block-head" }, h("h3", { text: "Details" }), h("span", { class: "save-state", id: "ops-save-state", "aria-live": "polite" })),
        opsField("usedBy", "Used by", draft ? draft.usedBy : (inuse ? l.usedBy : state.operator), { autocapitalize: "words", placeholder: "Who is using this lock" }),
        opsField("isolationDesc", "Isolation description", val("isolationDesc"), { textarea: true, maxlength: 500 }),
        opsField("location", "Location", val("location")),
        opsField("remarks", "Remarks", val("remarks"), { textarea: true, maxlength: 1000 }),
        inuse ? null : h("p", { class: "hint", text: "These details are saved when you tap Take lock." })),
      opsPhotoSection(l),
      opsHistorySection(l),
      inuse ? h("section", { class: "block block-reset" },
        h("button", { type: "button", class: "btn btn-quiet btn-quiet-danger", onclick: () => opsUndo(l.id) }, "Taken by mistake? Clear without history"),
        h("p", { class: "hint", text: "Makes the lock available again and adds nothing to its history." })) : null),
    h("footer", { class: "sheet-foot" }, inuse
      ? h("button", { type: "button", class: "btn btn-primary btn-big", onclick: () => opsReturn(l.id) }, icon("unlock"), "Return lock")
      : h("button", { type: "button", class: "btn btn-primary btn-big", onclick: () => opsTake(l.id) }, icon("lock"), "Take lock")));

  if (prevBody) panel.classList.add("sheet-static"); // redraw of an open sheet: no slide-in
  root.replaceChildren(panel);
  root.hidden = false;
  document.body.classList.add("no-scroll");
  panel.querySelector(".sheet-body").scrollTop = prevScroll;
}

/* ------------------------------ actions ------------------------------ */
async function opsRun(fn) {
  if (opsState.busy) return;
  opsState.busy = true;
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast("That change could not be saved to this device, so nothing was changed. Check free storage and try again.", "error");
  } finally {
    opsState.busy = false;
    opsRenderSheet();
    opsRender();
  }
}

// available -> in use
function opsTake(id) {
  return opsRun(async () => {
    const l = opsGet(id);
    const vals = opsReadFields();
    if (!l || l.status !== "available" || !vals) return;
    const usedBy = vals.usedBy.trim();
    if (!usedBy) {
      toast("Enter who is using this lock in “Used by” first.", "error");
      setTimeout(() => { const el = document.getElementById("o-usedBy"); if (el) { el.classList.add("is-invalid"); el.focus(); } }, 0);
      return;
    }
    const box = lbRequire("ops", id); // lockbox.js: a lock box is required
    if (!box || lbTaken("ops", id, box)) return;
    await opsCommit(Object.assign({}, l, vals, { status: "inuse", usedBy, takenAt: nowLocalISO(), recordedBy: state.operator, lockBox: box, boxChanges: "" }));
    lbDraft.ops = { id: null, box: "", platform: "" };
    opsRenderSheet(true);
    toast(id + " taken by " + usedBy + ", lock box " + box, "success");
  });
}

// in use -> available, with a history entry (newest first); photo deleted
function opsReturn(id) {
  return opsRun(async () => {
    await opsFlush();
    let l = opsGet(id);
    if (!l || l.status !== "inuse") return;
    const boxMates = l.lockBox ? lbUse(l.lockBox).oim : []; // lockbox.js
    const ok = await confirmDialog({
      title: "Return " + id + "?",
      message: [
        boxMates.length ? boxMates.map((p) => p.id).join(", ") + " (OIM padlock) is still in " + l.lockBox + ". Check with the OIM before taking this lock off." : "",
        "The lock becomes available again and this use is saved to its history.",
        opsPhotos[id] ? "The photo is deleted on return." : ""
      ].filter(Boolean),
      confirmLabel: boxMates.length ? "Return anyway" : "Return lock"
    });
    if (!ok) return;
    l = opsGet(id);
    if (!l || l.status !== "inuse") return;
    const entry = {
      usedBy: l.usedBy, isolationDesc: l.isolationDesc, location: l.location, remarks: l.remarks,
      takenAt: l.takenAt, returnedAt: nowLocalISO(), hadPhoto: !!opsPhotos[id],
      recordedBy: l.recordedBy || "", returnedBy: state.operator, device: state.device,
      lockBox: l.lockBox || "", boxChanges: l.boxChanges || "", oimStillInBox: boxMates.map((p) => p.id).join(", ")
    };
    const next = Object.assign(opsBlank(id), { log: [entry].concat(l.log) });
    await opsCommit(next, null);
    opsRenderSheet(true);
    toast(id + " returned and available", "success");
  });
}

// in use -> available, no history entry (for fixing a mistake)
function opsUndo(id) {
  return opsRun(async () => {
    const ok = await confirmDialog({
      title: "Clear " + id + " without history?",
      message: "The details and photo are deleted and the lock becomes available. Nothing is added to its history. Use Return lock instead if the lock was really used.",
      confirmLabel: "Clear lock", danger: true
    });
    if (!ok) return;
    const l = opsGet(id);
    if (!l || l.status !== "inuse") return;
    clearTimeout(opsFieldTimer);
    await opsChain;
    await opsCommit(Object.assign(opsBlank(id), { log: l.log }), null);
    opsRenderSheet(true);
    toast(id + " cleared", "success");
  });
}

async function opsPhotoPicked(file) {
  const id = opsState.openId;
  if (!id) return;
  try {
    const data = await compressImage(file);
    await opsFlush();
    const l = opsGet(id);
    if (!l || l.status !== "inuse") return;
    await opsCommit(l, data);
    toast("Photo saved for " + id, "success");
  } catch (err) {
    console.error(err);
    toast("That photo could not be saved. Try taking it again, or choose a JPEG or PNG from the gallery.", "error");
  }
  opsRenderSheet();
  opsRender();
}

function opsRemovePhoto(id) {
  return opsRun(async () => {
    const ok = await confirmDialog({ title: "Remove this photo?", message: "The photo for " + id + " will be deleted from this device.", confirmLabel: "Remove photo", danger: true });
    if (!ok) return;
    await opsFlush();
    const l = opsGet(id);
    if (!l) return;
    await opsCommit(l, null);
    toast("Photo removed", "success");
  });
}

/* ------------------------------ backup and restore ------------------------------ */
function opsBuildBackup() {
  const date = todayLocal();
  const locks = opsState.locks.filter((l) => l.status === "inuse" || l.log.length).map(clone);
  const photos = {};
  opsState.locks.forEach((l) => { if (l.status === "inuse" && opsPhotos[l.id]) photos[l.id] = opsPhotos[l.id]; });
  return {
    name: "Operator_Locks_Backup_" + date + ".json",
    count: locks.length, photoCount: Object.keys(photos).length,
    text: JSON.stringify({
      exportInfo: { type: "operator_locks_backup", exportDate: date, count: locks.length, operator: state.operator, device: state.device },
      operatorLocks: locks, operatorLockPhotos: photos
    }, null, 2)
  };
}

function opsLogKey(e) { return [e.takenAt, e.returnedAt, e.usedBy].join("|"); }

async function opsRestoreFile(file) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (_) { toast(file.name + " is not a readable JSON file.", "error"); return; }
  if (!obj || !obj.exportInfo || obj.exportInfo.type !== "operator_locks_backup" || !Array.isArray(obj.operatorLocks)) {
    toast(file.name + " is not an operator locks backup file.", "error");
    return;
  }
  const txt = (v) => (typeof v === "string" ? v : "");
  const cleanEntry = (e) => ({
    usedBy: txt(e.usedBy), isolationDesc: txt(e.isolationDesc), location: txt(e.location), remarks: txt(e.remarks),
    takenAt: txt(e.takenAt), returnedAt: txt(e.returnedAt), hadPhoto: e.hadPhoto === true,
    recordedBy: txt(e.recordedBy), returnedBy: txt(e.returnedBy), device: txt(e.device),
    lockBox: txt(e.lockBox), boxChanges: txt(e.boxChanges), oimStillInBox: txt(e.oimStillInBox)
  });
  const incoming = new Map();
  let skipped = 0;
  obj.operatorLocks.forEach((raw) => {
    const cur = raw && typeof raw.id === "string" ? opsGet(raw.id) : null;
    if (!cur) { skipped++; return; }
    const seen = new Set();
    const log = (Array.isArray(raw.log) ? raw.log.filter((e) => e && typeof e === "object").map(cleanEntry) : []).concat(cur.log)
      .filter((e) => { const k = opsLogKey(e); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (a.returnedAt < b.returnedAt ? 1 : a.returnedAt > b.returnedAt ? -1 : 0));
    incoming.set(cur.id, Object.assign(opsBlank(cur.id), {
      status: raw.status === "inuse" ? "inuse" : "available",
      usedBy: txt(raw.usedBy), isolationDesc: txt(raw.isolationDesc), location: txt(raw.location), remarks: txt(raw.remarks),
      takenAt: txt(raw.takenAt), recordedBy: txt(raw.recordedBy), lockBox: txt(raw.lockBox), boxChanges: txt(raw.boxChanges), updatedTs: Date.now(), log
    }));
  });
  if (!incoming.size) { toast("That backup has no locks that match this device's list.", "error"); return; }

  const photoOps = new Map(); // id -> dataURL | null (delete)
  incoming.forEach((rec, id) => { if (rec.status !== "inuse" && opsPhotos[id]) photoOps.set(id, null); });
  const srcPhotos = obj.operatorLockPhotos && typeof obj.operatorLockPhotos === "object" ? obj.operatorLockPhotos : {};
  for (const [id, v] of Object.entries(srcPhotos)) {
    if (incoming.has(id) && incoming.get(id).status === "inuse" && typeof v === "string" && v.startsWith("data:image/")) photoOps.set(id, v);
  }
  const photoPuts = Array.from(photoOps.values()).filter((v) => typeof v === "string").length;

  const ok = await confirmDialog({
    title: "Restore operator locks?",
    message: [
      "This will overwrite " + incoming.size + (incoming.size === 1 ? " operator lock" : " operator locks") + " and load " + photoPuts +
        (photoPuts === 1 ? " photo" : " photos") + " on this device. Locks not in the backup are left as they are. History is merged, never removed.",
      "Backup dated " + (txt(obj.exportInfo.exportDate) || "unknown") + (txt(obj.exportInfo.operator) ? ", made by " + txt(obj.exportInfo.operator) : "") + ".",
      skipped ? skipped + " lock(s) in the file are not on this device's list and will be skipped." : ""
    ].filter(Boolean),
    confirmLabel: "Restore", danger: true
  });
  if (!ok) return;
  try {
    await tx(["opsLocks", "opsPhotos"], "readwrite", (t) => {
      const s = t.objectStore("opsLocks"), ps = t.objectStore("opsPhotos");
      incoming.forEach((rec) => s.put(rec));
      photoOps.forEach((v, id) => { if (v === null) ps.delete(id); else ps.put(v, id); });
    });
    incoming.forEach((rec, id) => { const i = opsState.locks.findIndex((l) => l.id === id); if (i >= 0) opsState.locks[i] = rec; });
    photoOps.forEach((v, id) => { if (v === null) delete opsPhotos[id]; else opsPhotos[id] = v; });
    toast("Operator locks restored: " + incoming.size + " lock(s), " + photoPuts + " photo(s)", "success");
  } catch (err) {
    console.error(err);
    toast("The backup could not be saved to this device, so nothing was changed. Check free storage and try again.", "error");
  }
  opsRenderSheet();
  opsRender();
}

/** Extra section for the Export panel (app.js). closePanel closes that panel. */
function opsExportSection(closePanel) {
  const b = opsBuildBackup();
  const input = h("input", { type: "file", accept: ".json,application/json", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
  input.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    closePanel();
    await opsRestoreFile(file);
  });
  return [
    h("hr"),
    h("h3", { text: "Operator locks backup" }),
    h("p", { class: "hint", text: "Operator locks are kept on this device only and are never included in the OIM Assist files above. This backup file holds " +
      b.count + (b.count === 1 ? " lock" : " locks") + " (in use, or with history) and " + b.photoCount + (b.photoCount === 1 ? " photo." : " photos.") }),
    h("div", { class: "btn-row" },
      h("button", { type: "button", class: "btn", id: "ops-backup-download", onclick: () => { downloadFile(opsBuildBackup()); toast("Operator locks backup downloaded", "success"); } }, "Download backup"),
      h("button", { type: "button", class: "btn", onclick: () => input.click() }, "Restore backup")),
    input
  ];
}

/* ------------------------------ start-up ------------------------------ */
function opsInit() {
  $("#ops-search").addEventListener("input", (e) => { opsState.filters.q = e.target.value; opsRenderGrid(); });
  $("#ops-sheet").addEventListener("mousedown", (e) => { if (e.target === e.currentTarget) opsClose(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && opsState.openId && !document.querySelector(".overlay-dialog, .overlay-viewer")) opsClose();
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) opsFlush().catch(() => {}); });
  window.addEventListener("pagehide", () => { opsFlush().catch(() => {}); });
  opsSetView("home");
}
