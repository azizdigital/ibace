'use strict';

/* =====================================================================
   IbACE — Home screen
   Live dashboard: how many locks are out, who holds each one and for how
   long, plus big cards into each part of the app. Read-only: it changes
   no data. Loaded after app.js and ops.js and uses their state and helpers.
   ===================================================================== */

ICONS.report = '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>';
ICONS.share = '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>';
ICONS.send = '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>';
ICONS.sync = '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15"/><path d="M4 20v-5h5"/>';
ICONS.clock = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';

/* ------------------------------ how long a lock has been out ------------------------------ */
function parseLocalTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : NaN;
}
function fmtDuration(since) {
  const t = parseLocalTime(since);
  if (isNaN(t)) return "";
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return min + " min";
  const hours = Math.floor(min / 60);
  if (hours < 24) return hours + " h" + (min % 60 ? " " + (min % 60) + " min" : "");
  return Math.floor(hours / 24) + " d" + (hours % 24 ? " " + (hours % 24) + " h" : "");
}
/** A label that keeps counting while the screen is open. */
function ageEl(since, cls) {
  const text = fmtDuration(since);
  if (!text) return null;
  return h("span", { class: "age" + (cls ? " " + cls : ""), "data-since": since, title: "Out since " + fmtTime(since) }, icon("clock"), h("span", { class: "age-text", text }));
}
function tickAges() {
  document.querySelectorAll("[data-since]").forEach((el) => {
    const t = el.querySelector(".age-text");
    if (t) t.textContent = fmtDuration(el.getAttribute("data-since"));
  });
}
setInterval(tickAges, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) tickAges(); });

/* ------------------------------ ring chart ------------------------------ */
/** parts: [{ value, status, label }]. Part of a whole, with the count that is out in the middle. */
function ringChart(parts, centerValue, centerLabel) {
  const R = 40, C = 2 * Math.PI * R;
  const total = parts.reduce((s, p) => s + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  const gap = shown.length > 1 ? 2.5 : 0; // surface gap between segments
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "ring-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", parts.map((p) => p.value + " " + p.label).join(", "));
  const circle = (cls) => {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", "50"); c.setAttribute("cy", "50"); c.setAttribute("r", String(R));
    c.setAttribute("class", cls);
    return c;
  };
  svg.append(circle("ring-track"));
  let offset = 0;
  shown.forEach((p) => {
    const len = total ? (p.value / total) * C : 0;
    const c = circle("ring-seg st-" + p.status);
    c.setAttribute("stroke-dasharray", Math.max(0.5, len - gap).toFixed(2) + " " + (C - Math.max(0.5, len - gap)).toFixed(2));
    c.setAttribute("stroke-dashoffset", (-offset - gap / 2).toFixed(2));
    c.setAttribute("transform", "rotate(-90 50 50)");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = p.label + ": " + p.value + " of " + total;
    c.append(title);
    svg.append(c);
    offset += len;
  });
  return h("div", { class: "ring" }, svg,
    h("div", { class: "ring-center", "aria-hidden": "true" }, h("span", { class: "ring-num", text: String(centerValue) }), h("span", { class: "ring-label", text: centerLabel })));
}

/* ------------------------------ home screen ------------------------------ */
function homeGoTo(view, status) {
  if (view === "oim") state.filters = { category: "All", status, q: "" };
  else opsState.filters = { status, q: "" };
  const box = $(view === "oim" ? "#search" : "#ops-search");
  if (box) box.value = "";
  opsSetView(view);
}

function homeRegisterCard(o) {
  return h("section", { class: "reg-card st-" + o.worst, "aria-label": o.title },
    h("div", { class: "reg-head" }, h("h2", { text: o.title }), h("p", { class: "hint", text: o.sub })),
    h("div", { class: "reg-body" },
      ringChart(o.parts, o.out, o.outLabel),
      h("ul", { class: "legend" }, o.parts.map((p) => h("li", null, h("button", {
        type: "button", class: "legend-row", "aria-label": p.value + " " + p.label + ". Show these locks",
        onclick: () => homeGoTo(o.view, p.status)
      }, h("span", { class: "legend-dot st-" + p.status, "aria-hidden": "true" }), h("span", { class: "legend-label", text: p.label }), h("span", { class: "legend-num", text: String(p.value) })))))),
    h("button", { type: "button", class: "btn btn-primary btn-block", onclick: () => homeGoTo(o.view, "All") }, o.openLabel));
}

/** Which Home tiles are open. Kept while the app is open so a redraw does not close them. */
const homeOpen = { oim: false, ops: false, boxes: false, locks: false };

/** A compact tile: title, two numbers, and (when it has a list) a list that opens underneath on tap. */
function homeTile(o) {
  const open = !!o.list && homeOpen[o.key] && o.list.length > 0;
  const btn = h("button", {
    type: "button", class: "htile st-" + o.tone, id: "home-tile-" + o.key,
    "aria-expanded": o.list ? String(open) : null, "aria-label": o.title + ": " + o.nums.map((n) => n.value + " " + n.label).join(", ") + (o.hint ? ". " + o.hint : ""),
    onclick: o.onclick || (() => { if (!o.list.length) { toast(o.emptyText, "success"); return; } homeOpen[o.key] = !homeOpen[o.key]; homeRender(); })
  },
    h("span", { class: "htile-title", text: o.title }),
    h("span", { class: "htile-nums" }, o.nums.map((n) => h("span", { class: "htile-num" + (n.tone ? " is-" + n.tone : "") }, h("strong", { text: String(n.value) }), h("span", { text: n.label })))),
    h("span", { class: "htile-go", "aria-hidden": "true", text: o.list ? (open ? "Hide" : "Show") : "Open" }));
  return h("div", { class: "htile-wrap", id: "home-" + o.key }, btn, o.extra || null, open ? h("ul", { class: "out-list" }, o.list) : null);
}

function homeOutRow(r) {
  return h("li", null, h("button", {
    type: "button", class: "out-row st-" + r.status,
    "aria-label": r.id + ", " + r.label + (r.who ? ", " + r.who : "") + ", out for " + fmtDuration(r.since),
    onclick: r.open
  },
    h("span", { class: "out-id", text: r.id }),
    h("span", { class: "out-main" },
      h("span", { class: "out-who", text: r.who || "Name not recorded" }),
      h("span", { class: "out-where", text: [r.kind, r.where].filter(Boolean).join(", ") })),
    h("span", { class: "out-side" }, h("span", { class: "pill st-" + r.status }, icon(r.iconName), r.label), ageEl(r.since))));
}

/** Two tiles, OIM padlocks and operator locks: how many are in use and available. Tap one to list the locks in use, longest out first. */
function homeOutTiles() {
  const bySince = (a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0);
  const oim = state.padlocks.filter((p) => p.status !== "available").map((p) => ({ id: p.id, status: p.status, label: STATUS_META[p.status].label, iconName: STATUS_META[p.status].icon,
    who: p.issuedTo, where: [p.lockBox, p.location].filter(Boolean).join(", "), since: p.issuedAt, kind: p.category + " padlock", open: () => openPadlock(p.id) })).sort(bySince);
  const ops = opsState.locks.filter((l) => l.status === "inuse").map((l) => ({ id: l.id, status: "inuse", label: OPS_STATUS.inuse.label, iconName: OPS_STATUS.inuse.icon,
    who: l.usedBy, where: [l.lockBox, l.location].filter(Boolean).join(", "), since: l.takenAt, kind: "Operator lock", open: () => opsOpen(l.id) })).sort(bySince);
  const tile = (key, title, rows, total, locked) => homeTile({
    key, title, tone: locked ? "locked" : rows.length ? "issued" : "available", list: rows.map(homeOutRow), emptyText: "No " + title.toLowerCase() + " are in use.",
    nums: [{ value: rows.length, label: "in use", tone: rows.length ? "warn" : "" }, { value: total - rows.length, label: "available", tone: "ok" }]
  });
  return h("section", { class: "htiles", "aria-label": "Locks in use" },
    tile("oim", "OIM padlocks", oim, state.padlocks.length, oim.some((r) => r.status === "locked")),
    tile("ops", "Prod locks", ops, opsState.locks.length, false));
}

/** One card for every lock that is out, OIM and Prod together. Tap to list them, longest out first. Warnings stay visible without a tap. */
function homeLocksCard() {
  const bySince = (a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0);
  const rows = state.padlocks.filter((p) => p.status !== "available").map((p) => ({ id: p.id, status: p.status, label: STATUS_META[p.status].label, iconName: STATUS_META[p.status].icon,
    who: p.issuedTo, where: [p.lockBox, p.location].filter(Boolean).join(", "), since: p.issuedAt, kind: p.category + " padlock", open: () => openPadlock(p.id) }))
    .concat(opsState.locks.filter((l) => l.status === "inuse").map((l) => ({ id: l.id, status: "inuse", label: OPS_STATUS.inuse.label, iconName: OPS_STATUS.inuse.icon,
      who: l.usedBy, where: [l.lockBox, l.location].filter(Boolean).join(", "), since: l.takenAt, kind: "Prod lock", open: () => opsOpen(l.id) }))).sort(bySince);
  const oim = rows.filter((r) => r.status !== "inuse").length, prod = rows.length - oim, boxes = lbMap().size; // lockbox.js
  const conflicts = lbConflicts(), missing = lbMissing();
  const tone = conflicts.length || rows.some((r) => r.status === "locked") ? "locked" : rows.length ? "issued" : "available";
  const open = homeOpen.locks && rows.length > 0;
  const warn = (text) => h("p", { class: "notice notice-warn" }, icon("warn"), h("span", { text }));
  const n = (count, one, many) => count + " " + (count === 1 ? one : many);
  return h("section", { class: "htile-wrap", id: "home-locks-wrap", "aria-label": "Locks in use" },
    h("button", { type: "button", class: "hlocks st-" + tone, id: "home-locks", "aria-expanded": String(open),
      onclick: () => { if (!rows.length) { opsSetView(opsState.lockView || "oim"); return; } homeOpen.locks = !homeOpen.locks; homeRender(); } },
      h("span", { class: "hlocks-icon", "aria-hidden": "true" }, icon(rows.length ? "lock" : "unlock")),
      h("span", { class: "hlocks-text" },
        h("strong", { text: rows.length ? n(rows.length, "lock", "locks") + " in use" : "No locks in use" }),
        h("span", { text: rows.length ? oim + " OIM, " + prod + " Prod, in " + n(boxes, "lock box", "lock boxes") : "All 40 OIM padlocks and 30 Prod locks are available" })),
      h("span", { class: "htile-go", "aria-hidden": "true", text: rows.length ? (open ? "Hide" : "Show") : "Open" })),
    conflicts.map((c) => warn(c.box + " holds " + c.ids.join(" and ") + ". Move one to another box.")),
    missing.length ? warn("No lock box recorded: " + missing.join(", ")) : null,
    open ? h("ul", { class: "out-list", id: "home-locks-list" }, rows.map(homeOutRow)) : null);
}

function homeShortcuts() {
  const card = (id, iconName, label, onclick, href) => h(href ? "a" : "button", Object.assign({ class: "hshort", id: "short-" + id }, href ? { href, target: "_blank", rel: "noopener noreferrer" } : { type: "button", onclick }),
    h("span", { class: "tcard-icon", "aria-hidden": "true" }, icon(iconName)), h("span", { text: label }));
  const drafts = meReportList().filter((r) => r.status !== "sent").length; // me.js
  return h("section", { "aria-label": "Shortcuts", class: "hshort-wrap" },
    h("h2", { class: "tools-head", text: "Shortcuts" }),
    h("div", { class: "hshorts" },
      card("lock", "lock", "Issue a lock", () => opsSetView(opsState.lockView || "oim")),
      card("report", "warn", "Report a concern" + (drafts ? " (" + drafts + " draft" + (drafts === 1 ? "" : "s") + ")" : ""), () => meOpenReport(null)),
      card("log", "report", "Daily log", () => { opsSetView("me"); setTimeout(() => { const el = document.getElementById("log-today"); if (el) { el.scrollIntoView({ block: "center" }); el.focus(); } }, 0); }),
      card("ot", "clock", "OT calculator", () => openCalculator(OT_CALCULATOR)), // tools.js
      card("calc", "tools", "Calculators", () => { toolsShowCalcs = true; opsSetView("tools"); }),
      card("health", "link", "Health Declaration", null, HEALTH_DECLARATION_URL)));
}

function homeRender() {
  const root = $("#view-home");
  if (!root) return;
  root.replaceChildren(
    meRotationCard(), // me.js
    homeLocksCard(),
    homeShortcuts(),
    h("button", { type: "button", class: "btn btn-primary btn-big btn-block", id: "home-send", onclick: () => openSendPanel() }, "Send to admin"),
    h("p", { class: "hint home-last", text: state.lastAdminExport ? "Last sent or exported for admin: " + fmtTime(state.lastAdminExport) : "Nothing sent to admin from this device yet" }));
}
