'use strict';

/* =====================================================================
   IbACE — operator padlock register (offline PWA, vanilla JS)
   ===================================================================== */

/* ---------------------------------------------------------------------
   OIM PASSWORD — CHANGE IT HERE.
   This is a soft, offline, client-side gate only. Anyone who opens the
   source or DevTools can read it. It deters casual misuse; it is NOT
   real authentication.
   --------------------------------------------------------------------- */
// The OIM password is kept only as a salted SHA-256 hash, because this code is public.
// It is still a soft client-side gate: the check runs on the device and can be bypassed
// by anyone who edits the code. It deters casual misuse; it is not real authentication.
const OIM_PASSWORD_SALT = "ibace-oim:";
const OIM_PASSWORD_HASH = "d30c7ac57351f032f3bdc0d6806d53e1eec61927eeb6bb42419129d246f7f2a4";

/* ---------------------------------------------------------------------
   ADMIN WHATSAPP NUMBER — CHANGE IT HERE.
   Used by "Send to admin". Digits only, country code first, no "+" or spaces.
   --------------------------------------------------------------------- */
const ADMIN_WHATSAPP = "601175212736";
const ADMIN_WHATSAPP_DISPLAY = "+60 11 7521 2736";

const CATEGORIES = ["Daily", "IbB", "IbC", "Shutdown"];
const STATUSES   = ["available", "issued", "locked"];
// Seed: OIM-01..OIM-20 => Daily ; OIM-021..OIM-023 => IbB ; OIM-024..OIM-026 => IbC ; OIM-027..OIM-040 => Shutdown

const APP_VERSION = "3.5.2"; // shown in Settings; keep in step with CACHE_VERSION in service-worker.js
const DB_NAME = "oim-lock";
const DB_VERSION = 2; // v2 adds the operator-lock stores; existing data is kept
const PHOTO_MAX_EDGE = 1280;   // px, longest edge (matches OIM Assist)
const PHOTO_QUALITY = 0.6;     // JPEG quality (matches OIM Assist)
const FIELD_KEYS = ["issuedTo", "isolationDesc", "location", "remarks"];
const STATUS_META = {
  available: { label: "Available", icon: "unlock" },
  issued:    { label: "Issued",    icon: "user" },
  locked:    { label: "Locked",    icon: "lock" }
};

/* ------------------------------ state ------------------------------ */
const state = {
  padlocks: [],
  operator: "",
  device: "",
  filters: { category: "All", status: "All", q: "" },
  openId: null,
  persisted: null,
  busy: false,
  lastAdminExport: ""
};
const padlockPhotos = {}; // in-memory mirror of the IndexedDB "photos" store: { id: dataURL }
let db = null;
let installPromptEvent = null;

/* ------------------------------ helpers ------------------------------ */
const $ = (sel) => document.querySelector(sel);
const pad2 = (n) => String(n).padStart(2, "0");

/** Device-local time as YYYY-MM-DDTHH:mm (never UTC). */
function nowLocalISO() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}
function todayLocal() { return nowLocalISO().slice(0, 10); }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || "");
  if (!m) return "";
  return Number(m[3]) + " " + (MONTHS[Number(m[2]) - 1] || m[2]) + " " + m[1] + ", " + m[4] + ":" + m[5];
}

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
function idNumber(id) { return parseInt(String(id).replace(/^OIM-/, ""), 10) || 0; }
function getPadlock(id) { return state.padlocks.find((p) => p.id === id) || null; }

/** Tiny DOM builder. Text always goes in as text nodes, never as HTML. */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "value") el.value = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  lock:   '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>',
  user:   '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  image:  '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5-9 9"/>',
  close:  '<path d="M6 6l12 12M18 6L6 18"/>',
  warn:   '<path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v5M12 17.8v.4"/>',
  check:  '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
};
function icon(name, cls) {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("class", "icon" + (cls ? " " + cls : ""));
  s.innerHTML = ICONS[name] || "";
  return s;
}

function pill(status) {
  const meta = STATUS_META[status] || STATUS_META.available;
  return h("span", { class: "pill st-" + status }, icon(meta.icon), meta.label);
}

function toast(message, type) {
  const kind = type || "info";
  const el = h("div", { class: "toast toast-" + kind, role: kind === "error" ? "alert" : "status" },
    icon(kind === "error" ? "warn" : "check"), h("span", { text: message }));
  const box = $("#toasts");
  while (box.children.length >= 2) box.firstElementChild.remove(); // never bury the screen in messages
  box.append(el);
  setTimeout(() => el.remove(), kind === "error" ? 6500 : 3500);
  buzz(kind);
}

/** Short vibration with success and error messages. Android only: iPhone and iPad browsers have no vibration. */
function buzz(kind) {
  try {
    if (kind === "info" || typeof navigator.vibrate !== "function") return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // browsers block it before the first tap
    navigator.vibrate(kind === "error" ? [70, 60, 70] : 35);
  } catch (_) { /* vibration is a nicety, never a failure */ }
}

/* ------------------------------ data model ------------------------------ */
function blankPadlock(id, category) {
  return {
    // --- OIM Assist contract (section 4.1) ---
    id, category,
    status: "available",
    issuedTo: "", isolationDesc: "", location: "",
    issuedAt: "", lockedAt: "",
    remarks: "",
    log: [],
    // --- IbACE audit extras (ignored by OIM Assist's display) ---
    issuedBy: "", lockedBy: "",
    photoOverride: false, overrideReason: "",
    lockBox: "", boxOverride: "", boxChanges: "", // lockbox.js
    updatedAt: "", updatedBy: ""
  };
}

function buildMasterList() {
  const list = [];
  for (let n = 1; n <= 40; n++) {
    if (n <= 20) list.push(blankPadlock("OIM-" + String(n).padStart(2, "0"), "Daily"));
    else list.push(blankPadlock("OIM-" + String(n).padStart(3, "0"), n <= 23 ? "IbB" : n <= 26 ? "IbC" : "Shutdown"));
  }
  return list;
}

/** Back to available with every live field cleared. History (log) is kept. */
function clearLive(p) {
  return Object.assign({}, p, {
    status: "available",
    issuedTo: "", isolationDesc: "", location: "",
    issuedAt: "", lockedAt: "", remarks: "",
    issuedBy: "", lockedBy: "", photoOverride: false, overrideReason: "",
    lockBox: "", boxOverride: "", boxChanges: "",
    updatedAt: nowLocalISO(), updatedBy: state.operator
  });
}

/* ------------------------------ IndexedDB ------------------------------ */
function openDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("IndexedDB is not available in this browser.")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("padlocks")) d.createObjectStore("padlocks", { keyPath: "id" });
      if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos");
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
      if (!d.objectStoreNames.contains("opsLocks")) d.createObjectStore("opsLocks", { keyPath: "id" });
      if (!d.objectStoreNames.contains("opsPhotos")) d.createObjectStore("opsPhotos");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Could not open the database."));
    req.onblocked = () => reject(new Error("The database is open in another tab. Close other IbACE tabs and reload."));
  });
}

/** Run fn inside one transaction; resolves only once the transaction has fully committed. */
function tx(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    let out;
    const t = db.transaction(stores, mode);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error || new Error("Storage error."));
    t.onabort = () => reject(t.error || new Error("Storage transaction was cancelled."));
    try { out = fn(t); } catch (err) { try { t.abort(); } catch (_) { /* already finished */ } reject(err); }
  });
}

async function loadAll() {
  const loaded = { padlocks: [], photos: {}, meta: {} };
  await tx(["padlocks", "photos", "meta"], "readonly", (t) => {
    t.objectStore("padlocks").getAll().onsuccess = (e) => { loaded.padlocks = e.target.result || []; };
    t.objectStore("photos").openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (c) { loaded.photos[c.key] = c.value; c.continue(); }
    };
    t.objectStore("meta").openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (c) { loaded.meta[c.key] = c.value; c.continue(); }
    };
  });

  // Seed the fixed 40-padlock master list on first run ONLY if the store is empty.
  if (loaded.padlocks.length === 0) {
    const seed = buildMasterList();
    await tx(["padlocks"], "readwrite", (t) => {
      const s = t.objectStore("padlocks");
      seed.forEach((p) => s.put(p));
    });
    loaded.padlocks = seed;
  }

  state.padlocks = loaded.padlocks
    .map((p) => Object.assign(blankPadlock(p.id, p.category), p, { log: Array.isArray(p.log) ? p.log : [] }))
    .sort((a, b) => idNumber(a.id) - idNumber(b.id));
  for (const k of Object.keys(padlockPhotos)) delete padlockPhotos[k];
  Object.assign(padlockPhotos, loaded.photos);
  state.operator = typeof loaded.meta.operator === "string" ? loaded.meta.operator : "";
  state.device = typeof loaded.meta.device === "string" ? loaded.meta.device : "";
  state.lastAdminExport = typeof loaded.meta.lastAdminExport === "string" ? loaded.meta.lastAdminExport : "";
  state.installDismissed = loaded.meta.installDismissed === true;
}

/**
 * Persist one padlock (and optionally its photo) in a single transaction.
 * Memory is only updated after IndexedDB confirms the write, so what the
 * screen shows is always what is actually stored.
 * photoChange: undefined = leave photo alone, null = delete, string = save.
 */
async function commit(next, photoChange) {
  next.updatedTs = Date.now(); // lets "Sync with another phone" tell which phone changed this lock last
  await tx(["padlocks", "photos"], "readwrite", (t) => {
    t.objectStore("padlocks").put(next);
    if (photoChange === null) t.objectStore("photos").delete(next.id);
    else if (typeof photoChange === "string") t.objectStore("photos").put(photoChange, next.id);
  });
  const i = state.padlocks.findIndex((p) => p.id === next.id);
  if (i >= 0) state.padlocks[i] = next; else state.padlocks.push(next);
  if (photoChange === null) delete padlockPhotos[next.id];
  else if (typeof photoChange === "string") padlockPhotos[next.id] = photoChange;
}

async function saveMeta(values) {
  await tx(["meta"], "readwrite", (t) => {
    const s = t.objectStore("meta");
    for (const [k, v] of Object.entries(values)) s.put(v, k);
  });
}

/* ------------------------------ dialogs ------------------------------ */
/**
 * Small modal form. Resolves with { fieldName: value } or null if cancelled.
 * opts: { title, message (string | string[]), fields[], confirmLabel, cancelLabel,
 *         danger, dismissable (default true), validate(values) -> null | {message, field} }
 */
function formDialog(opts) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const dismissable = opts.dismissable !== false;
    const fields = opts.fields || [];
    const inputs = {};
    const errEl = h("p", { class: "dlg-error", role: "alert", hidden: true });
    const showErr = (msg) => { errEl.textContent = msg; errEl.hidden = false; };

    const fieldEls = fields.map((f) => {
      const id = "dlg-" + f.name;
      const common = {
        id, class: "input", placeholder: f.placeholder, maxlength: f.maxlength || 200,
        autocomplete: f.autocomplete || "off", autocapitalize: f.autocapitalize, spellcheck: "false"
      };
      const input = f.type === "textarea"
        ? h("textarea", Object.assign({ rows: 3 }, common))
        : h("input", Object.assign({ type: f.type || "text" }, common));
      input.value = f.value || "";
      inputs[f.name] = input;
      return h("div", { class: "field" },
        h("label", { for: id, text: f.label }),
        input,
        f.hint ? h("p", { class: "hint", text: f.hint }) : null);
    });

    const messages = [].concat(opts.message || []).map((m) => h("p", { class: "dlg-message", text: m }));
    const cancelBtn = dismissable
      ? h("button", { type: "button", class: "btn", onclick: () => close(null) }, opts.cancelLabel || "Cancel")
      : null;
    const okBtn = h("button", { type: "submit", class: "btn " + (opts.danger ? "btn-danger" : "btn-primary") },
      opts.confirmLabel || "OK");

    const form = h("form", { class: "dlg", novalidate: true, role: "dialog", "aria-modal": "true", "aria-labelledby": "dlg-title" },
      h("h2", { id: "dlg-title", text: opts.title }),
      messages, fieldEls, errEl,
      h("div", { class: "dlg-actions" }, cancelBtn, okBtn));
    const overlay = h("div", { class: "overlay overlay-dialog" }, form);

    function onKey(e) {
      if (e.key === "Escape" && dismissable) { e.stopPropagation(); close(null); }
    }
    function close(val) {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (prevFocus && document.contains(prevFocus) && prevFocus.focus) prevFocus.focus();
      resolve(val);
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      errEl.hidden = true;
      const values = {};
      for (const f of fields) values[f.name] = inputs[f.name].value;
      for (const f of fields) {
        if (f.required && !values[f.name].trim()) {
          showErr(f.requiredMessage || ("Enter " + f.label.toLowerCase() + "."));
          inputs[f.name].focus();
          return;
        }
      }
      if (opts.validate) {
        const problem = opts.validate(values);
        if (problem) {
          showErr(problem.message);
          if (problem.field && inputs[problem.field]) {
            if (inputs[problem.field].type === "password") inputs[problem.field].value = "";
            inputs[problem.field].focus();
          }
          return;
        }
      }
      close(values);
    });
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay && dismissable) close(null); });
    document.addEventListener("keydown", onKey, true);

    document.body.append(overlay);
    const first = fields.length ? inputs[fields[0].name] : okBtn;
    first.focus();
  });
}

function confirmDialog(opts) {
  return formDialog(opts).then((v) => v !== null);
}

const PASSWORD_FIELD = {
  name: "password", label: "OIM password", type: "password", required: true,
  requiredMessage: "Enter the OIM password.", autocomplete: "off"
};
/** SHA-256 of a string, as hex. Synchronous, so it can be used inside form validation. */
function sha256Hex(text) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const bytes = Array.from(new TextEncoder().encode(text));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? Math.floor(bitLen / 4294967296) >>> ((i - 4) * 8) & 0xff : (bitLen >>> (i * 8)) & 0xff);
  const hv = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const w = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = hv;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { hv[i] = (hv[i] + v) | 0; });
  }
  return hv.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}
function isOimPassword(text) { return sha256Hex(OIM_PASSWORD_SALT + String(text || "")) === OIM_PASSWORD_HASH; }

function checkPassword(values) {
  return isOimPassword(values.password) ? null : { message: "That OIM password is not correct.", field: "password" };
}

/* ------------------------------ register (summary, filters, grid) ------------------------------ */
function countBy(list) {
  const c = { available: 0, issued: 0, locked: 0 };
  list.forEach((p) => { if (c[p.status] != null) c[p.status]++; });
  return c;
}

function renderSummary() {
  const c = countBy(state.padlocks);
  const total = state.padlocks.length;
  const tile = (key, label, value) => h("button", {
    type: "button",
    class: "count count-" + key + (state.filters.status === (key === "total" ? "All" : key) ? " is-active" : ""),
    "aria-pressed": String(state.filters.status === (key === "total" ? "All" : key)),
    "aria-label": value + " " + label + ". Show " + (key === "total" ? "all padlocks" : label.toLowerCase() + " padlocks"),
    onclick: () => { state.filters.status = key === "total" ? "All" : key; renderRegister(); }
  }, h("span", { class: "count-num", text: String(value) }), h("span", { class: "count-label", text: label }));

  $("#summary-counts").replaceChildren(
    tile("available", "Available", c.available),
    tile("issued", "Issued", c.issued),
    tile("locked", "Locked", c.locked),
    tile("total", "Total", total)
  );

  $("#summary-cats").replaceChildren(...CATEGORIES.map((cat) => {
    const list = state.padlocks.filter((p) => p.category === cat);
    const cc = countBy(list);
    const bar = h("span", { class: "cat-bar", "aria-hidden": "true" });
    STATUSES.forEach((s) => {
      if (!cc[s]) return;
      const seg = h("span", { class: "cat-seg st-" + s });
      seg.style.flexGrow = String(cc[s]);
      bar.append(seg);
    });
    return h("button", {
      type: "button",
      class: "cat" + (state.filters.category === cat ? " is-active" : ""),
      "aria-pressed": String(state.filters.category === cat),
      onclick: () => { state.filters.category = state.filters.category === cat ? "All" : cat; renderRegister(); }
    },
      h("span", { class: "cat-name", text: cat }),
      h("span", { class: "cat-nums", text: cc.available + " of " + list.length + " available" }),
      bar);
  }));
}

function renderFilters() {
  const chips = (key, values, labelOf) => values.map((v) => h("button", {
    type: "button",
    class: "fchip" + (state.filters[key] === v ? " is-active" : ""),
    "aria-pressed": String(state.filters[key] === v),
    onclick: () => { state.filters[key] = v; renderRegister(); }
  }, labelOf(v)));
  $("#filter-category").replaceChildren(
    h("span", { class: "chip-row-label", text: "Category" }),
    ...chips("category", ["All"].concat(CATEGORIES), (v) => v));
  $("#filter-status").replaceChildren(
    h("span", { class: "chip-row-label", text: "Status" }),
    ...chips("status", ["All"].concat(STATUSES), (v) => (v === "All" ? "All" : STATUS_META[v].label)));
}

function filteredPadlocks() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  return state.padlocks.filter((p) => {
    if (f.category !== "All" && p.category !== f.category) return false;
    if (f.status !== "All" && p.status !== f.status) return false;
    if (q && !(p.id.toLowerCase().includes(q) || (p.issuedTo || "").toLowerCase().includes(q) || (p.lockBox || "").toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderGrid() {
  const list = filteredPadlocks();
  const grid = $("#grid");
  $("#result-count").textContent = list.length === state.padlocks.length
    ? "Showing all " + list.length + " padlocks"
    : "Showing " + list.length + " of " + state.padlocks.length + " padlocks";

  if (list.length === 0) {
    grid.replaceChildren(h("div", { class: "empty" },
      h("p", { text: "No padlocks match these filters." }),
      h("button", {
        type: "button", class: "btn",
        onclick: () => { state.filters = { category: "All", status: "All", q: "" }; $("#search").value = ""; renderRegister(); }
      }, "Clear filters")));
    return;
  }

  grid.replaceChildren(...list.map((p) => {
    const meta = STATUS_META[p.status];
    const hasPhoto = !!padlockPhotos[p.id];
    return h("button", {
      type: "button", class: "card st-" + p.status,
      "aria-label": p.id + ", " + p.category + ", " + meta.label +
        (p.issuedTo ? ", issued to " + p.issuedTo : "") + (p.status !== "available" && p.lockBox ? ", lock box " + p.lockBox : "") + (hasPhoto ? ", has photo" : ""),
      onclick: () => openPadlock(p.id)
    },
      h("span", { class: "card-top" },
        h("span", { class: "card-id", text: p.id }),
        hasPhoto ? icon("camera", "card-cam") : null),
      h("span", { class: "card-cat", text: p.category }),
      lbCardLine("oim", p), // lockbox.js
      h("span", { class: "card-state" }, pill(p.status), p.status !== "available" ? ageEl(p.issuedAt) : null), // ageEl: home.js
      h("span", { class: "card-who", text: p.issuedTo || "\u00a0" }));
  }));
}

function renderRegister() { renderSummary(); renderFilters(); renderGrid(); opsRenderTabs(); /* ops.js */ }

function renderHeader() {
  $("#operator-name").textContent = state.operator || "not set";
  const online = navigator.onLine !== false;
  $("#net-chip").className = "chip " + (online ? "chip-ok" : "chip-muted");
  $("#net-text").textContent = online ? "Online" : "Offline";
  const sc = $("#store-chip");
  if (state.persisted === null) {
    sc.className = "chip chip-muted"; $("#store-text").textContent = "Checking storage";
  } else if (state.persisted) {
    sc.className = "chip chip-ok"; $("#store-text").textContent = "Storage protected";
    sc.title = "This device has agreed to keep IbACE's data.";
  } else {
    sc.className = "chip chip-warn"; $("#store-text").textContent = "Storage not protected";
    sc.title = "The system may clear IbACE's data when storage runs low. Export regularly.";
  }
}

/* ------------------------------ padlock sheet (modal) ------------------------------ */
let fieldTimer = null;
let saveChain = Promise.resolve();
function serial(fn) {
  const p = saveChain.then(fn);
  saveChain = p.catch(() => {});
  return p;
}

function readFields() {
  const out = {};
  for (const k of FIELD_KEYS) {
    const el = document.getElementById("f-" + k);
    if (!el) return null;
    out[k] = el.value;
  }
  return out;
}

function setSaveState(text, isError) {
  const el = document.getElementById("save-state");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-error", !!isError);
}

/** Write any edited text fields to IndexedDB right now. */
function flushFields() {
  clearTimeout(fieldTimer);
  const id = state.openId;
  const vals = readFields();
  if (!id || !vals) return saveChain;
  return serial(async () => {
    const p = getPadlock(id);
    if (!p || FIELD_KEYS.every((k) => p[k] === vals[k])) return;
    try {
      await commit(Object.assign({}, p, vals, { updatedAt: nowLocalISO(), updatedBy: state.operator }));
      if (state.openId === id) setSaveState("Saved");
      renderRegister();
    } catch (err) {
      if (state.openId === id) setSaveState("Not saved", true);
      toast("Your edits could not be saved to this device. Check free storage and try again.", "error");
      throw err;
    }
  });
}

function onFieldInput() {
  setSaveState("Saving…");
  clearTimeout(fieldTimer);
  fieldTimer = setTimeout(() => { flushFields().catch(() => {}); }, 350);
}

function openPadlock(id) {
  if (!getPadlock(id)) return;
  state.openId = id;
  renderSheet();
  const closeBtn = document.getElementById("sheet-close");
  if (closeBtn) closeBtn.focus();
}

async function closeSheet() {
  try { await flushFields(); } catch (_) { /* toast already shown */ }
  state.openId = null;
  renderSheet();
  renderRegister();
}

function fieldRow(key, label, value, opts) {
  const o = opts || {};
  const id = "f-" + key;
  const props = {
    id, class: "input", maxlength: o.maxlength || 200, placeholder: o.placeholder,
    autocomplete: "off", autocapitalize: o.autocapitalize || "sentences", oninput: onFieldInput,
    onchange: () => { flushFields().catch(() => {}); }
  };
  const input = o.textarea ? h("textarea", Object.assign({ rows: 2 }, props)) : h("input", Object.assign({ type: "text" }, props));
  input.value = value || "";
  return h("div", { class: "field" }, h("label", { for: id, text: label }), input);
}

function photoSection(p) {
  const photo = padlockPhotos[p.id];
  if (p.status === "available") {
    return h("section", { class: "block" },
      h("h3", { text: "Proof photo" }),
      h("p", { class: "hint", text: "Issue this padlock first. The proof photo is taken once the lock is on the isolation point." }));
  }

  const camInput = h("input", { type: "file", accept: "image/*", capture: "environment", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
  const galInput = h("input", { type: "file", accept: "image/*", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
  const onPick = (e) => { const file = e.target.files && e.target.files[0]; e.target.value = ""; if (file) onPhotoPicked(file); };
  camInput.addEventListener("change", onPick);
  galInput.addEventListener("change", onPick);

  const canChange = p.status === "issued" || (p.status === "locked" && !photo);
  const kids = [h("h3", { text: "Proof photo" })];

  if (photo) {
    kids.push(h("button", { type: "button", class: "thumb", "aria-label": "View proof photo full size", onclick: () => openViewer(photo, p.id) },
      h("img", { src: photo, alt: "Proof photo for " + p.id })));
    kids.push(h("p", { class: "hint", text: p.status === "locked"
      ? "Tap the photo to view it full size. It is kept until this padlock is returned."
      : "Tap the photo to view it full size. You can retake it until the padlock is locked." }));
  } else if (p.status === "issued") {
    kids.push(h("p", { class: "notice notice-warn" }, icon("warn"), h("span", { text: "Photo required to Lock" })));
  } else {
    kids.push(h("p", { class: "notice notice-warn" }, icon("warn"),
      h("span", { text: "Locked without a photo (OIM override). You can still add one." })));
  }

  if (canChange) {
    kids.push(h("div", { class: "btn-row" },
      h("button", { type: "button", class: "btn btn-accent", onclick: () => camInput.click() }, icon("camera"), photo ? "Retake photo" : "Take photo"),
      h("button", { type: "button", class: "btn", onclick: () => galInput.click() }, icon("image"), "Choose from gallery"),
      photo && p.status === "issued"
        ? h("button", { type: "button", class: "btn btn-quiet", onclick: () => removePhoto(p.id) }, "Remove photo")
        : null));
  }
  kids.push(camInput, galInput, h("p", { class: "hint", id: "photo-state", "aria-live": "polite" }));
  return h("section", { class: "block" }, kids);
}

function cycleFacts(p) {
  if (p.status === "available") return null;
  const rows = [];
  rows.push(h("li", null, "Issued " + fmtTime(p.issuedAt) + (p.issuedBy ? " by " + p.issuedBy : "")));
  if (p.status === "locked") {
    rows.push(h("li", null, "Locked " + fmtTime(p.lockedAt) + (p.lockedBy ? " by " + p.lockedBy : "")));
    if (p.photoOverride) rows.push(h("li", null, "No-photo override reason: " + (p.overrideReason || "not recorded")));
  }
  return h("ul", { class: "facts" }, rows);
}

function historySection(p) {
  const log = Array.isArray(p.log) ? p.log : [];
  const head = h("h3", { text: "History" + (log.length ? " (" + log.length + ")" : "") });
  if (!log.length) return h("section", { class: "block" }, head, h("p", { class: "hint", text: "No completed cycles yet. A cycle is recorded each time this padlock is returned." }));

  const line = (label, value) => (value ? h("div", { class: "log-line" }, h("dt", { text: label }), h("dd", { text: value })) : null);
  return h("section", { class: "block" }, head,
    h("ol", { class: "log" }, log.map((e) => h("li", { class: "log-entry" },
      h("p", { class: "log-title", text: e.issuedTo || "Technician not recorded" }),
      h("dl", null,
        line("Isolation", e.isolationDesc),
        line("Location", e.location),
        line("Lock box", (e.lockBox || "") + (e.boxChanges ? " (changed: " + e.boxChanges + ")" : "")),
        line("No Prod lock", e.boxOverride ? "Reason: " + e.boxOverride : ""),
        line("Issued", fmtTime(e.issuedAt) + (e.issuedBy ? " by " + e.issuedBy : "")),
        line("Locked", e.lockedAt ? fmtTime(e.lockedAt) + (e.lockedBy ? " by " + e.lockedBy : "") : "Returned without locking"),
        line("Returned", e.syncConflict ? "Not returned: replaced by a newer record from another phone during sync" : fmtTime(e.returnedAt) + (e.operator ? " by " + e.operator : "")),
        line("Photo", e.hadPhoto ? "Yes" : "No"),
        line("Override", e.photoOverride ? (e.overrideReason || "No reason recorded") : ""),
        line("Remarks", e.remarks))))));
}

function renderSheet() {
  const root = $("#sheet");
  const p = state.openId ? getPadlock(state.openId) : null;
  if (!p) {
    root.hidden = true;
    root.replaceChildren();
    document.body.classList.remove("no-scroll");
    return;
  }
  const prevBody = root.querySelector(".sheet-body");
  const prevScroll = prevBody ? prevBody.scrollTop : 0;

  const actions = [];
  if (p.status === "available") {
    actions.push(h("button", { type: "button", class: "btn btn-primary btn-big", onclick: () => issuePadlock(p.id) }, icon("user"), "Issue"));
  } else if (p.status === "issued") {
    actions.push(h("button", { type: "button", class: "btn btn-big", onclick: () => returnPadlock(p.id) }, icon("unlock"), "Return"));
    actions.push(h("button", { type: "button", class: "btn btn-lock btn-big", onclick: () => lockPadlock(p.id) }, icon("lock"), "Lock"));
  } else {
    actions.push(h("button", { type: "button", class: "btn btn-primary btn-big", onclick: () => returnPadlock(p.id) }, icon("unlock"), "Return"));
  }

  const panel = h("div", { class: "sheet st-" + p.status, role: "dialog", "aria-modal": "true", "aria-labelledby": "sheet-title" },
    h("header", { class: "sheet-head" },
      h("div", null,
        h("h2", { id: "sheet-title", class: "sheet-id", text: p.id }),
        h("p", { class: "sheet-cat", text: p.category + " padlock" })),
      pill(p.status),
      h("button", { type: "button", class: "icon-btn", id: "sheet-close", "aria-label": "Close", onclick: closeSheet }, icon("close"))),
    h("div", { class: "sheet-body" },
      lbSection("oim", p), // lockbox.js
      cycleFacts(p),
      h("section", { class: "block" },
        h("div", { class: "block-head" }, h("h3", { text: "Isolation details" }), h("span", { class: "save-state", id: "save-state", "aria-live": "polite" })),
        fieldRow("issuedTo", "Issued to (technician name)", p.issuedTo, { autocapitalize: "words", placeholder: "Required to issue" }),
        fieldRow("isolationDesc", "Isolation description", p.isolationDesc, { textarea: true, maxlength: 500 }),
        fieldRow("location", "Location", p.location),
        fieldRow("remarks", "Remarks", p.remarks, { textarea: true, maxlength: 1000 })),
      photoSection(p),
      historySection(p),
      h("section", { class: "block block-reset" },
        h("button", { type: "button", class: "btn btn-quiet btn-quiet-danger", onclick: () => resetPadlock(p.id) }, "Reset this padlock (OIM password)"),
        h("p", { class: "hint", text: "Reset is for fixing mistakes. It clears the padlock without adding a history entry." }))),
    h("footer", { class: "sheet-foot" }, actions));

  if (prevBody) panel.classList.add("sheet-static"); // redraw of an open sheet: no slide-in
  root.replaceChildren(panel);
  root.hidden = false;
  document.body.classList.add("no-scroll");
  panel.querySelector(".sheet-body").scrollTop = prevScroll;
}

function openViewer(src, id) {
  const prevFocus = document.activeElement;
  const closeBtn = h("button", { type: "button", class: "btn viewer-close" }, "Close");
  const overlay = h("div", { class: "overlay overlay-viewer", role: "dialog", "aria-modal": "true", "aria-label": "Proof photo for " + id },
    h("img", { src, alt: "Proof photo for " + id }), closeBtn);
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
  function close() {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (prevFocus && document.contains(prevFocus) && prevFocus.focus) prevFocus.focus();
  }
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  closeBtn.focus();
}

/* ------------------------------ photos ------------------------------ */
/** Downscale so the longest edge is about 1280px, then encode JPEG at 0.6. */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth, ht = img.naturalHeight;
        if (!w || !ht) throw new Error("empty image");
        const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w, ht));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(ht * scale));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // JPEG has no transparency
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
        if (!data.startsWith("data:image/jpeg")) throw new Error("JPEG encoding failed");
        resolve(data);
      } catch (err) { reject(err); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable image")); };
    img.src = url;
  });
}

async function onPhotoPicked(file) {
  const id = state.openId;
  if (!id) return;
  const note = document.getElementById("photo-state");
  if (note) note.textContent = "Saving photo…";
  try {
    const data = await compressImage(file);
    await flushFields();
    const p = getPadlock(id);
    if (!p || p.status === "available") return;
    if (p.status === "locked" && padlockPhotos[id]) return; // proof of a locked padlock is not replaced
    await commit(Object.assign({}, p, { updatedAt: nowLocalISO(), updatedBy: state.operator }), data);
    toast("Photo saved for " + id, "success");
  } catch (err) {
    console.error(err);
    toast("That photo could not be saved. Try taking it again, or choose a JPEG or PNG from the gallery.", "error");
  }
  renderSheet();
  renderRegister();
}

async function removePhoto(id) {
  const ok = await confirmDialog({
    title: "Remove this photo?",
    message: "The photo for " + id + " will be deleted from this device. You will need a new one before locking.",
    confirmLabel: "Remove photo", danger: true
  });
  if (!ok) return;
  await runAction(async () => {
    await flushFields();
    const p = getPadlock(id);
    if (!p || p.status !== "issued") return;
    await commit(Object.assign({}, p, { updatedAt: nowLocalISO(), updatedBy: state.operator }), null);
    toast("Photo removed", "success");
  });
}

/* ------------------------------ lifecycle actions ------------------------------ */
/** Guard against double taps and show one clear message if storage fails. */
async function runAction(fn) {
  if (state.busy) return;
  state.busy = true;
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast("That change could not be saved to this device, so nothing was changed. Check free storage and try again.", "error");
  } finally {
    state.busy = false;
    renderSheet();
    renderRegister();
  }
}

// 1. Issue: available -> issued
function issuePadlock(id) {
  return runAction(async () => {
    await flushFields();
    const p = getPadlock(id);
    if (!p || p.status !== "available") return;
    const name = (p.issuedTo || "").trim();
    if (!name) {
      toast("Enter the technician's name in “Issued to” before issuing.", "error");
      setTimeout(() => {
        const el = document.getElementById("f-issuedTo");
        if (el) { el.classList.add("is-invalid"); el.focus(); }
      }, 0);
      return;
    }
    // lockbox.js: a lock box is required; a box with no operator lock in it needs a reason
    const box = lbRequire("oim", id);
    if (!box || lbTaken("oim", id, box)) return;
    const boxReason = await lbOimReason(id, box, "issue");
    if (boxReason === null) return;
    const cur = getPadlock(id);
    if (!cur || cur.status !== "available" || lbTaken("oim", id, box)) return;
    const now = nowLocalISO();
    await commit(Object.assign({}, cur, {
      status: "issued", issuedTo: name, issuedAt: now, lockedAt: "",
      issuedBy: state.operator, lockedBy: "", photoOverride: false, overrideReason: "",
      lockBox: box, boxOverride: boxReason, boxChanges: "",
      updatedAt: now, updatedBy: state.operator
    }));
    lbDraft.oim = { id: null, box: "", platform: "" };
    toast(id + " issued to " + name + ", lock box " + box, "success");
  });
}

// 2. Lock: issued -> locked (photo required, or comment + OIM password)
function lockPadlock(id) {
  return runAction(async () => {
    await flushFields();
    let p = getPadlock(id);
    if (!p || p.status !== "issued") return;

    let override = null;
    if (!padlockPhotos[id]) {
      override = await formDialog({
        title: "Lock " + id + " without a photo?",
        message: "A proof photo is required to lock. To lock without one, the OIM must give a reason and enter the OIM password. To add a photo instead, cancel and use “Take photo”.",
        fields: [
          { name: "reason", label: "Reason for no photo", type: "textarea", required: true, maxlength: 500, autocapitalize: "sentences",
            requiredMessage: "Enter the reason there is no photo." },
          PASSWORD_FIELD
        ],
        confirmLabel: "Lock without photo",
        validate: checkPassword
      });
      if (!override) return;
      p = getPadlock(id);
      if (!p || p.status !== "issued") return;
    }

    const now = nowLocalISO();
    const next = Object.assign({}, p, {
      status: "locked", lockedAt: now, lockedBy: state.operator,
      photoOverride: false, overrideReason: "", updatedAt: now, updatedBy: state.operator
    });
    // A photo may have been added while the override dialog was open; a photo always wins.
    if (override && !padlockPhotos[id]) {
      const reason = override.reason.trim();
      const stamp = "No-photo override: " + reason;
      next.photoOverride = true;
      next.overrideReason = reason;
      next.remarks = p.remarks && p.remarks.trim() ? p.remarks.trim() + "\n" + stamp : stamp;
    }
    await commit(next);
    toast(id + " locked" + (next.photoOverride ? " without photo (OIM override)" : ""), "success");
  });
}

// 3. Return: issued/locked -> available, writes a newest-first log entry, deletes the photo
function returnPadlock(id) {
  return runAction(async () => {
    await flushFields();
    let p = getPadlock(id);
    if (!p || p.status === "available") return;
    const ok = await confirmDialog({
      title: "Return " + id + "?",
      message: [
        (p.issuedTo || "The technician") + " is handing this padlock back. It becomes available again and this cycle is saved to its history.",
        padlockPhotos[id] ? "The proof photo is deleted on return." : ""
      ].filter(Boolean),
      confirmLabel: "Return padlock"
    });
    if (!ok) return;
    p = getPadlock(id);
    if (!p || p.status === "available") return;

    const entry = {
      // --- OIM Assist contract (section 4.2) ---
      issuedTo: p.issuedTo, isolationDesc: p.isolationDesc, location: p.location,
      issuedAt: p.issuedAt, lockedAt: p.lockedAt, returnedAt: nowLocalISO(),
      hadPhoto: !!padlockPhotos[id],
      operator: state.operator,
      // --- IbACE audit extras ---
      issuedBy: p.issuedBy || "", lockedBy: p.lockedBy || "", returnedBy: state.operator,
      remarks: p.remarks || "",
      photoOverride: !!p.photoOverride, overrideReason: p.overrideReason || "",
      lockBox: p.lockBox || "", boxOverride: p.boxOverride || "", boxChanges: p.boxChanges || "",
      device: state.device
    };
    const next = clearLive(p);
    next.log = [].concat(Array.isArray(p.log) ? p.log : []);
    next.log.unshift(entry); // newest first
    await commit(next, null);
    toast(id + " returned and available", "success");
  });
}

// 4. Reset: any -> available, no log entry, OIM password required
function resetPadlock(id) {
  return runAction(async () => {
    await flushFields();
    const answer = await formDialog({
      title: "Reset " + id + "?",
      message: "Reset clears the technician, isolation details, times, remarks and photo, and makes the padlock available. No history entry is written. Existing history is kept.",
      fields: [PASSWORD_FIELD],
      confirmLabel: "Reset padlock", danger: true,
      validate: checkPassword
    });
    if (!answer) return;
    const p = getPadlock(id);
    if (!p) return;
    await commit(clearLive(p), null);
    toast(id + " reset", "success");
  });
}

/* ------------------------------ operator identity ------------------------------ */
async function firstRunPrompt() {
  while (!state.operator) {
    const v = await formDialog({
      title: "Who is using IbACE?",
      message: "Your name is stamped on every padlock action from this device. Changing it later needs the OIM password.",
      fields: [
        { name: "operator", label: "Your name", value: license.name, required: true, maxlength: 80, autocapitalize: "words", autocomplete: "name", requiredMessage: "Enter your name." },
        { name: "device", label: "Device name (optional)", maxlength: 60, placeholder: "Deck Tablet 1", autocapitalize: "words",
          hint: "Added to exports so the OIM can tell devices apart." }
      ],
      confirmLabel: "Save and start", dismissable: false
    });
    if (!v) continue;
    const operator = v.operator.trim(), device = v.device.trim();
    try {
      await saveMeta({ operator, device });
      state.operator = operator; state.device = device;
      renderHeader();
      toast("Welcome, " + operator, "success");
    } catch (err) {
      console.error(err);
      toast("Your name could not be saved to this device. Try again.", "error");
    }
  }
}

async function changeOperator() {
  const v = await formDialog({
    title: "Change operator",
    message: "The OIM password is needed to change the name stamped on padlock actions.",
    fields: [
      PASSWORD_FIELD,
      { name: "operator", label: "Operator name", required: true, value: state.operator, maxlength: 80, autocapitalize: "words", requiredMessage: "Enter the operator's name." },
      { name: "device", label: "Device name (optional)", value: state.device, maxlength: 60, placeholder: "Deck Tablet 1", autocapitalize: "words" }
    ],
    confirmLabel: "Change operator",
    validate: checkPassword
  });
  if (!v) return;
  const operator = v.operator.trim(), device = v.device.trim();
  try {
    await saveMeta({ operator, device });
    state.operator = operator; state.device = device;
    renderHeader();
    toast("Operator is now " + operator, "success");
  } catch (err) {
    console.error(err);
    toast("The operator name could not be saved to this device. Nothing was changed.", "error");
  }
}

/* ------------------------------ export ------------------------------ */
function buildExport() {
  const date = todayLocal();
  // Multi-device-safe rule: only active padlocks, plus any with history.
  const padlocks = state.padlocks
    .filter((p) => p.status !== "available" || (Array.isArray(p.log) && p.log.length > 0))
    .map(clone);
  // Proof photos are exported only for padlocks that are locked.
  const photos = {};
  state.padlocks.forEach((p) => { if (p.status === "locked" && padlockPhotos[p.id]) photos[p.id] = padlockPhotos[p.id]; });

  const data = {
    exportInfo: { type: "oim_padlock_data", exportDate: date, count: padlocks.length, operator: state.operator, device: state.device, licensedTo: license.name, licenseId: license.id },
    padlocks
  };
  const photoFile = {
    exportInfo: { type: "oim_padlock_photos", exportDate: date, count: Object.keys(photos).length },
    padlockPhotos: photos
  };
  return {
    data:   { name: "OIM_Padlock_Data_" + date + ".json",   text: JSON.stringify(data, null, 2),      count: padlocks.length },
    photos: { name: "OIM_Padlock_Photos_" + date + ".json", text: JSON.stringify(photoFile, null, 2), count: photoFile.exportInfo.count }
  };
}

function downloadFile(file) {
  const url = URL.createObjectURL(new Blob([file.text], { type: "application/json" }));
  const a = h("a", { href: url, download: file.name, class: "visually-hidden" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function shareableFiles(exp) {
  try {
    if (!navigator.share || !navigator.canShare || typeof File !== "function") return null;
    const files = [
      new File([exp.data.text], exp.data.name, { type: "application/json" }),
      new File([exp.photos.text], exp.photos.name, { type: "application/json" })
    ];
    return navigator.canShare({ files }) ? files : null;
  } catch (_) { return null; }
}

function openExportPanel() {
  const prevFocus = document.activeElement;
  const exp = buildExport();
  const canShare = !!shareableFiles(exp);

  const restoreInput = h("input", { type: "file", accept: ".json,application/json", multiple: true, class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
  restoreInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    close();
    await restoreFromFiles(files);
  });

  const panel = h("div", { class: "dlg dlg-wide", role: "dialog", "aria-modal": "true", "aria-labelledby": "exp-title" },
    h("div", { class: "dlg-head" },
      h("h2", { id: "exp-title", text: "Export for OIM Assist" }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    h("p", { class: "dlg-message", text: "Two files are made. Send both to the OIM, who imports them into OIM Assist." }),
    h("ul", { class: "file-list" },
      h("li", null, h("strong", { text: exp.data.name }),
        h("span", { text: exp.data.count + (exp.data.count === 1 ? " padlock" : " padlocks") + " (active, or with history)" })),
      h("li", null, h("strong", { text: exp.photos.name }),
        h("span", { text: exp.photos.count + (exp.photos.count === 1 ? " photo" : " photos") + " (locked padlocks)" }))),
    canShare
      ? h("button", { type: "button", class: "btn btn-primary btn-big btn-block", onclick: shareNow }, "Share both files")
      : h("p", { class: "hint", text: "This browser cannot share JSON files directly. Download both files, then attach them in WhatsApp or email." }),
    h("div", { class: "btn-row" },
      h("button", { type: "button", class: "btn" + (canShare ? "" : " btn-primary"), onclick: () => { downloadFile(buildExport().data); toast("Padlock data file downloaded", "success"); } }, "Download data file"),
      h("button", { type: "button", class: "btn" + (canShare ? "" : " btn-primary"), onclick: () => { downloadFile(buildExport().photos); toast("Photos file downloaded", "success"); } }, "Download photos file")),
    h("hr"),
    h("h3", { text: "Restore from backup" }),
    h("p", { class: "hint", text: "Load export files made by IbACE back onto this device, for example after a tablet is replaced. Choose the data file, the photos file, or both. Needs the OIM password." }),
    h("button", { type: "button", class: "btn", onclick: () => restoreInput.click() }, "Choose backup files"),
    restoreInput,
    opsExportSection(() => close())); // ops.js

  const overlay = h("div", { class: "overlay overlay-dialog" }, panel);
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
  function close() {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (prevFocus && document.contains(prevFocus) && prevFocus.focus) prevFocus.focus();
  }
  async function shareNow() {
    const files = shareableFiles(buildExport()); // built synchronously inside the tap
    if (!files) { toast("Sharing is not available here. Use the download buttons instead.", "error"); return; }
    try {
      await navigator.share({ files, title: "IbACE export", text: "OIM padlock export from " + (state.operator || "IbACE") });
      toast("Export shared", "success");
    } catch (err) {
      if (err && err.name === "AbortError") return; // operator closed the share sheet
      console.error(err);
      toast("Sharing did not work. Use the download buttons instead.", "error");
    }
  }
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  panel.querySelector("button.btn").focus();
}

/* ------------------------------ restore from backup ------------------------------ */
const str = (v) => (typeof v === "string" ? v : "");

function sanitizeLogEntry(e) {
  const out = {};
  for (const [k, v] of Object.entries(e)) {
    if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") out[k] = v;
  }
  ["issuedTo", "isolationDesc", "location", "issuedAt", "lockedAt", "returnedAt"].forEach((k) => { out[k] = str(out[k]); });
  out.hadPhoto = out.hadPhoto === true;
  return out;
}

function logKey(e) { return [e.issuedAt, e.lockedAt, e.returnedAt, e.issuedTo].join("|"); }

/** Union of two logs, no duplicates, newest return first. */
function mergeLogs(incoming, existing) {
  const seen = new Set();
  const out = [];
  incoming.concat(existing).forEach((e) => {
    const k = logKey(e);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(e);
  });
  return out.sort((a, b) => (a.returnedAt < b.returnedAt ? 1 : a.returnedAt > b.returnedAt ? -1 : 0));
}

function normalizeIncoming(raw, current) {
  if (!raw || typeof raw !== "object" || !STATUSES.includes(raw.status)) return null;
  const incomingLog = Array.isArray(raw.log)
    ? raw.log.filter((e) => e && typeof e === "object" && !Array.isArray(e)).map(sanitizeLogEntry)
    : [];
  return Object.assign(blankPadlock(current.id, current.category), {
    status: raw.status,
    issuedTo: str(raw.issuedTo), isolationDesc: str(raw.isolationDesc), location: str(raw.location),
    issuedAt: str(raw.issuedAt), lockedAt: str(raw.lockedAt), remarks: str(raw.remarks),
    issuedBy: str(raw.issuedBy), lockedBy: str(raw.lockedBy),
    photoOverride: raw.photoOverride === true, overrideReason: str(raw.overrideReason),
    lockBox: str(raw.lockBox), boxOverride: str(raw.boxOverride), boxChanges: str(raw.boxChanges),
    updatedAt: str(raw.updatedAt), updatedBy: str(raw.updatedBy),
    log: mergeLogs(incomingLog, Array.isArray(current.log) ? current.log : [])
  });
}

async function restoreFromFiles(files) {
  const incomingPadlocks = new Map();
  const incomingPhotos = new Map();
  const problems = [];
  let skipped = 0;
  let info = null;

  for (const file of files) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (_) { problems.push(file.name + " is not a readable JSON file."); continue; }
    let recognised = false;
    if (obj && Array.isArray(obj.padlocks)) {
      recognised = true;
      if (obj.exportInfo && typeof obj.exportInfo === "object") info = obj.exportInfo;
      obj.padlocks.forEach((raw) => {
        const current = raw && typeof raw.id === "string" ? getPadlock(raw.id) : null;
        const rec = current ? normalizeIncoming(raw, current) : null;
        if (rec) { rec.updatedTs = Date.now(); incomingPadlocks.set(rec.id, rec); } else skipped++;
      });
    }
    if (obj && obj.padlockPhotos && typeof obj.padlockPhotos === "object" && !Array.isArray(obj.padlockPhotos)) {
      recognised = true;
      for (const [id, val] of Object.entries(obj.padlockPhotos)) {
        if (getPadlock(id) && typeof val === "string" && val.startsWith("data:image/")) incomingPhotos.set(id, val); else skipped++;
      }
    }
    if (!recognised) problems.push(file.name + " is not a IbACE export file.");
  }

  if (!incomingPadlocks.size && !incomingPhotos.size) {
    toast(problems[0] || "Those files contain nothing to restore.", "error");
    return;
  }

  // Work out the final state before asking, so the summary is exact.
  const finalStatus = (id) => (incomingPadlocks.has(id) ? incomingPadlocks.get(id).status : getPadlock(id).status);
  const photoOps = new Map(); // id -> dataURL | null (delete)
  incomingPadlocks.forEach((rec, id) => { if (rec.status === "available" && padlockPhotos[id]) photoOps.set(id, null); });
  let photosIgnored = 0;
  incomingPhotos.forEach((val, id) => { if (finalStatus(id) !== "available") photoOps.set(id, val); else photosIgnored++; });
  const photoPuts = Array.from(photoOps.values()).filter((v) => typeof v === "string").length;

  const lines = [
    "This will overwrite " + incomingPadlocks.size + (incomingPadlocks.size === 1 ? " padlock" : " padlocks") +
      " and load " + photoPuts + (photoPuts === 1 ? " photo" : " photos") + " on this device. Padlocks not in the backup are left as they are. History is merged, never removed."
  ];
  if (info) lines.push("Backup dated " + (str(info.exportDate) || "unknown") + (str(info.operator) ? ", exported by " + str(info.operator) : "") + (str(info.device) ? " on " + str(info.device) : "") + ".");
  if (skipped || photosIgnored) lines.push((skipped + photosIgnored) + " item(s) in the files will be skipped because they do not match this register.");
  problems.forEach((m) => lines.push(m));

  const answer = await formDialog({
    title: "Restore from backup?",
    message: lines,
    fields: [PASSWORD_FIELD],
    confirmLabel: "Restore", danger: true,
    validate: checkPassword
  });
  if (!answer) return;

  try {
    await tx(["padlocks", "photos"], "readwrite", (t) => {
      const ps = t.objectStore("padlocks"), fs = t.objectStore("photos");
      incomingPadlocks.forEach((rec) => ps.put(rec));
      photoOps.forEach((val, id) => { if (val === null) fs.delete(id); else fs.put(val, id); });
    });
    incomingPadlocks.forEach((rec, id) => {
      const i = state.padlocks.findIndex((p) => p.id === id);
      if (i >= 0) state.padlocks[i] = rec;
    });
    photoOps.forEach((val, id) => { if (val === null) delete padlockPhotos[id]; else padlockPhotos[id] = val; });
    toast("Backup restored: " + incomingPadlocks.size + " padlock(s), " + photoPuts + " photo(s)", "success");
  } catch (err) {
    console.error(err);
    toast("The backup could not be saved to this device, so nothing was changed. Check free storage and try again.", "error");
  }
  renderSheet();
  renderRegister();
}

/* ------------------------------ platform: storage, network, install, offline ------------------------------ */
async function checkPersistence() {
  let persisted = false;
  try {
    if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted();
    if (!persisted && navigator.storage && navigator.storage.persist) persisted = await navigator.storage.persist();
  } catch (_) { persisted = false; }
  state.persisted = !!persisted;
  $("#persist-banner").hidden = state.persisted;
  renderHeader();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("service-worker.js").then(() => navigator.serviceWorker.ready).then(() => {
    if (!hadController) toast("IbACE is saved on this device and works offline.", "success");
  }).catch((err) => {
    console.error(err);
    toast("Offline mode could not be set up. Open IbACE from an https address the device trusts.", "error");
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) toast("IbACE was updated. Close and reopen the app to use the new version.", "info");
  });
}

/** The header menu: Sync, Export, PDF report, Settings (and Install when the browser offers it). */
function toggleMenu(open) {
  const menu = $("#app-menu"), btn = $("#btn-menu");
  const show = open === undefined ? menu.hidden : !!open;
  if (show) $("#btn-sync span").textContent = syncStatusLine(); // sync.js
  menu.hidden = !show;
  btn.setAttribute("aria-expanded", String(show));
}

function bindUI() {
  const splash = document.getElementById("splash"); // fades by itself (styles.css); take it out of the page once it has
  if (splash) { splash.addEventListener("animationend", (e) => { if (e.target === splash) splash.remove(); }); setTimeout(() => splash.remove(), 2500); }
  $("#btn-export").addEventListener("click", openExportPanel);
  $("#btn-send").addEventListener("click", openSendPanel);
  $("#btn-sync").addEventListener("click", () => openSyncPanel()); // sync.js
  $("#btn-report").addEventListener("click", () => openReportPanel()); // defined in report.js
  $("#btn-settings").addEventListener("click", () => openSettingsPanel()); // settings.js (Change operator lives there)
  $("#btn-menu").addEventListener("click", () => toggleMenu());
  document.addEventListener("click", (e) => { if (!$("#app-menu").hidden && !e.target.closest("#app-menu, #btn-menu")) toggleMenu(false); });
  $("#app-menu").addEventListener("click", (e) => { if (e.target.closest("button")) toggleMenu(false); });
  $("#btn-banner-dismiss").addEventListener("click", () => { $("#persist-banner").hidden = true; });
  $("#search").addEventListener("input", (e) => { state.filters.q = e.target.value; renderGrid(); });

  // Sheet: tap on the dimmed backdrop, or Escape, closes it (edits are saved first).
  $("#sheet").addEventListener("mousedown", (e) => { if (e.target === e.currentTarget) closeSheet(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.openId && !document.querySelector(".overlay-dialog, .overlay-viewer")) closeSheet();
  });

  window.addEventListener("online", renderHeader);
  window.addEventListener("offline", renderHeader);

  // Last-chance save if the app is backgrounded or closed mid-edit.
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushFields().catch(() => {}); });
  window.addEventListener("pagehide", () => { flushFields().catch(() => {}); });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPromptEvent = e;
    $("#btn-install").hidden = false;
    if (license.key) installOffer(); // license.js
  });
  $("#btn-install").addEventListener("click", async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    try { await installPromptEvent.userChoice; } catch (_) { /* ignore */ }
    installPromptEvent = null;
    $("#btn-install").hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    $("#btn-install").hidden = true;
    $("#install-banner").hidden = true;
    toast("IbACE installed", "success");
    checkPersistence(); // browsers often grant persistence once installed
  });
}

async function init() {
  bindUI();
  try {
    db = await openDB();
    db.onversionchange = () => { db.close(); };
    await loadAll();
    await opsLoad(); // ops.js
    await syncLoad(); // sync.js
    await meLoad(); // me.js
    await adminLoad(); // admin.js
  } catch (err) {
    console.error(err);
    $("#grid").replaceChildren(h("div", { class: "empty" },
      h("p", { text: "IbACE could not open its storage on this device, so nothing can be saved." }),
      h("p", { class: "hint", text: "Turn off private browsing, close other IbACE tabs, then reload. (" + (err && err.message ? err.message : "Unknown error") + ")" })));
    return;
  }
  renderHeader();
  opsInit(); // ops.js
  renderRegister();
  checkPersistence();
  registerServiceWorker();
  installBind(); // license.js
  await licenseGate(); // license.js: nothing below runs until this device holds a genuine key
  installOffer();
  if (!state.operator) await firstRunPrompt();
}

document.addEventListener("DOMContentLoaded", init);

/* ------------------------------ end of shift: send to admin on WhatsApp ------------------------------ */
/* Same method as OIM Assist: copy the report text, open the admin's chat (https://wa.me/<number>, no text in
   the link), and the operator pastes and sends. A WhatsApp link cannot attach files, so the two export files
   are attached by hand in the same chat. */
function adminReportText() {
  const c = countBy(state.padlocks);
  const oc = opsCounts();
  const today = todayLocal();
  const out = state.padlocks.filter((p) => p.status !== "available");
  const returned = state.padlocks.reduce((n, p) => n + p.log.filter((e) => String(e.returnedAt || "").startsWith(today)).length, 0);
  const inuse = opsState.locks.filter((l) => l.status === "inuse");
  const detail = (who, what, where, since) => [who || "name not recorded", what, where].filter(Boolean).join(", ") + " (since " + fmtTime(since) + ")";
  const lines = [
    "*IbACE: end-of-shift report*",
    fmtTime(nowLocalISO()),
    "Operator: " + (state.operator || "unknown") + (state.device ? " (" + state.device + ")" : ""),
    "License: " + license.name + " (" + license.id + ")",
    "",
    "*OIM padlocks*",
    c.available + " available, " + c.issued + " issued, " + c.locked + " locked",
    "Returned today: " + returned
  ];
  if (out.length) {
    lines.push("Out now:");
    out.forEach((p) => lines.push("- " + p.id + " " + STATUS_META[p.status].label.toUpperCase() + ": " + detail(p.issuedTo, p.isolationDesc, p.location, p.issuedAt) +
      (p.status === "locked" && !padlockPhotos[p.id] ? " NO PHOTO" : "")));
  } else lines.push("Nothing is out.");
  lines.push("", "*Operator locks*", oc.available + " available, " + oc.inuse + " in use");
  inuse.forEach((l) => lines.push("- " + l.id + ": " + detail(l.usedBy, l.isolationDesc, l.location, l.takenAt)));
  return lines.join("\n");
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = h("textarea", { class: "visually-hidden", "aria-hidden": "true" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (ok) resolve(); else reject(new Error("copy failed"));
  });
}

function markAdminExport() {
  const t = nowLocalISO();
  state.lastAdminExport = t;
  saveMeta({ lastAdminExport: t }).catch((err) => console.error(err));
  opsRenderTabs(); // refreshes the Home card
}

function openSendPanel() {
  const prevFocus = document.activeElement;
  const exp = buildExport();
  const canShare = !!shareableFiles(exp);
  const chatUrl = "https://wa.me/" + ADMIN_WHATSAPP;

  const msg = h("textarea", { id: "send-text", class: "input send-text", rows: 9, spellcheck: "false" });
  msg.value = adminReportText();
  const chatLink = h("a", { class: "btn btn-block", id: "send-chat", href: chatUrl, target: "_blank", rel: "noopener", hidden: true }, "Open admin's WhatsApp chat");

  async function copyAndOpen() {
    const text = msg.value;
    if (!text.trim()) { toast("There is no message to send.", "error"); return; }
    let copied = true;
    try { await copyText(text); } catch (err) { console.error(err); copied = false; }
    const win = window.open(chatUrl, "_blank");
    if (!win) chatLink.hidden = false; // the browser blocked the new window: offer a plain link instead
    markAdminExport();
    if (copied) toast(win ? "Report copied. In WhatsApp, press and hold the message box, tap Paste, then send." : "Report copied. Tap “Open admin's WhatsApp chat”, then paste and send.", "success");
    else { msg.focus(); msg.select(); toast("The report could not be copied automatically. Copy the message yourself, then paste it in WhatsApp.", "error"); }
  }
  async function shareNow() {
    const files = shareableFiles(buildExport()); // built synchronously inside the tap
    if (!files) { toast("Sharing is not available here. Use the download buttons instead.", "error"); return; }
    try {
      await navigator.share({ files, title: "IbACE export" });
      markAdminExport();
      toast("Files handed to the share screen", "success");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      console.error(err);
      toast("Sharing did not work. Use the download buttons instead.", "error");
    }
  }
  const dl = (which, label) => h("button", { type: "button", class: "btn", onclick: () => { downloadFile(buildExport()[which]); markAdminExport(); toast(label + " downloaded", "success"); } }, "Download " + label.toLowerCase());

  const panel = h("div", { class: "dlg dlg-wide", role: "dialog", "aria-modal": "true", "aria-labelledby": "send-title" }, [
    h("div", { class: "dlg-head" },
      h("h2", { id: "send-title", text: "Send to admin" }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    h("p", { class: "dlg-message", text: "End of every shift, to the admin on WhatsApp: " + ADMIN_WHATSAPP_DISPLAY + "." }),
    h("h3", { text: "1. Send the report" }),
    h("div", { class: "field" }, h("label", { for: "send-text", text: "Message (you can edit it)" }), msg),
    h("button", { type: "button", class: "btn btn-wa btn-big btn-block", id: "send-copy", onclick: copyAndOpen }, "Copy and open WhatsApp"),
    chatLink,
    h("p", { class: "hint", text: "The report is copied and the admin's chat opens. Press and hold the message box, tap Paste, then send." }),
    h("hr"),
    h("h3", { text: "2. Attach the two export files" }),
    h("ul", { class: "file-list" },
      h("li", null, h("strong", { text: exp.data.name }), h("span", { text: exp.data.count + (exp.data.count === 1 ? " padlock" : " padlocks") + " (active, or with history)" })),
      h("li", null, h("strong", { text: exp.photos.name }), h("span", { text: exp.photos.count + (exp.photos.count === 1 ? " photo" : " photos") + " (locked padlocks)" }))),
    canShare ? h("button", { type: "button", class: "btn btn-block", id: "send-share", onclick: shareNow }, "Share both files") : null,
    h("div", { class: "btn-row" }, dl("data", "Data file"), dl("photos", "Photos file")),
    h("p", { class: "hint", text: "WhatsApp cannot receive files from a link, so attach them yourself: in the admin's chat tap the paperclip (Android) or + (iPhone), choose Document, pick the files from Downloads, then send." })
  ].filter(Boolean));

  const overlay = h("div", { class: "overlay overlay-dialog" }, panel);
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
  function close() {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (prevFocus && document.contains(prevFocus) && prevFocus.focus) prevFocus.focus();
  }
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  document.getElementById("send-copy").focus();
}
