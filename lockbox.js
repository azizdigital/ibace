'use strict';

/* =====================================================================
   IbACE — lock boxes
   Every lock that goes out is put in a lock box. The boxes are shared by
   the two registers, and one box holds at most ONE OIM padlock and ONE
   operator (Prod) lock, both for the same isolation.
     - choosing a box is required to Issue (OIM) or Take (operator lock)
     - an OIM padlock normally goes into a box that already holds an
       operator lock; without one it can still be issued, with a reason
     - a box is free again once the lock in that slot is returned
     - changing the box of an OIM padlock that is out needs the OIM password
   Nothing is stored separately: the box is a field on each lock record
   (lockBox), so it travels with exports, backups and Sync as it is.
   Loaded after ops.js; uses helpers from app.js and ops.js.
   ===================================================================== */

const LB_RANGES = { IbA: 60, IbB: 20, IbC: 20 };
const LB_PLATFORMS = Object.keys(LB_RANGES);
const lbName = (platform, n) => platform + "-GB" + String(n).padStart(2, "0");
const lbPlatformOf = (box) => (LB_PLATFORMS.includes(String(box || "").split("-")[0]) ? String(box).split("-")[0] : "");
const lbOut = (kind, rec) => (kind === "oim" ? rec.status !== "available" : rec.status === "inuse");
const lbGet = (kind, id) => (kind === "oim" ? getPadlock(id) : opsGet(id));

/** What the operator has picked for a lock that is not out yet: { id, box, platform } per register. */
const lbDraft = { oim: { id: null, box: "", platform: "" }, ops: { id: null, box: "", platform: "" } };
function lbDraftFor(kind, id) {
  if (lbDraft[kind].id !== id) lbDraft[kind] = { id, box: "", platform: "" };
  return lbDraft[kind];
}

/** Who is in every box right now: Map(box -> { oim: [padlock], ops: [lock] }). */
function lbMap() {
  const map = new Map();
  const at = (box) => { if (!map.has(box)) map.set(box, { oim: [], ops: [] }); return map.get(box); };
  state.padlocks.forEach((p) => { if (p.status !== "available" && p.lockBox) at(p.lockBox).oim.push(p); });
  opsState.locks.forEach((l) => { if (l.status === "inuse" && l.lockBox) at(l.lockBox).ops.push(l); });
  return map;
}
function lbUse(box) { return lbMap().get(box) || { oim: [], ops: [] }; }
/** Boxes holding two locks of the same kind. Only happens when two phones used the same box before syncing. */
function lbConflicts() {
  const out = [];
  lbMap().forEach((u, box) => { if (u.oim.length > 1 || u.ops.length > 1) out.push({ box, ids: (u.oim.length > 1 ? u.oim : []).concat(u.ops.length > 1 ? u.ops : []).map((r) => r.id) }); });
  return out.sort((a, b) => (a.box < b.box ? -1 : 1));
}
function lbMissing() {
  return state.padlocks.filter((p) => p.status !== "available" && !p.lockBox).map((p) => p.id)
    .concat(opsState.locks.filter((l) => l.status === "inuse" && !l.lockBox).map((l) => l.id));
}
function lbTrail(rec, from, to) {
  const line = (from || "no lock box") + " to " + to + ", " + fmtTime(nowLocalISO()) + " by " + state.operator;
  return rec.boxChanges ? rec.boxChanges + "; " + line : line;
}

/** Small line for a register card. */
function lbCardLine(kind, rec) {
  if (!lbOut(kind, rec)) return null;
  if (!rec.lockBox) return h("span", { class: "card-box is-missing", text: "No lock box" });
  const u = lbUse(rec.lockBox);
  return h("span", { class: "card-box" + ((kind === "oim" ? u.oim : u.ops).length > 1 ? " is-conflict" : ""), text: rec.lockBox });
}

/** Copies Location and Isolation from the other lock in the box into this sheet, where they are still empty. */
function lbFillFromPartner(kind, box) {
  const u = lbUse(box), partner = kind === "oim" ? u.ops[0] : u.oim[0];
  if (!partner) return;
  const prefix = kind === "oim" ? "f-" : "o-";
  let filled = false;
  ["isolationDesc", "location"].forEach((k) => {
    const el = document.getElementById(prefix + k);
    if (el && !el.value.trim() && partner[k]) { el.value = partner[k]; filled = true; }
  });
  if (!filled) return;
  if (kind === "oim") onFieldInput(); // operator-lock details are saved when the lock is taken
  toast("Location and isolation copied from " + partner.id, "success");
}

/** For a lock that is already out: the other lock's Location and Isolation, for the fields this one has empty. */
function lbPartnerFields(kind, rec, box) {
  const u = lbUse(box), partner = kind === "oim" ? u.ops[0] : u.oim[0], out = {};
  if (partner) ["isolationDesc", "location"].forEach((k) => { if (!String(rec[k] || "").trim() && partner[k]) out[k] = partner[k]; });
  return out;
}

/* ------------------------------ the picker at the top of a lock's sheet ------------------------------ */
function lbSection(kind, rec) {
  const out = lbOut(kind, rec), draft = lbDraftFor(kind, rec.id), map = lbMap();
  const current = out ? (rec.lockBox || "") : draft.box;
  const platform = draft.platform || lbPlatformOf(current) || "IbA";
  const mine = kind === "oim" ? "oim" : "ops", other = kind === "oim" ? "ops" : "oim";
  const others = (box, slot) => ((map.get(box) || { oim: [], ops: [] })[slot]).filter((r) => r.id !== rec.id);

  const pSel = h("select", { class: "input", id: "lb-" + kind + "-platform", "aria-label": "Platform" }, LB_PLATFORMS.map((p) => h("option", { value: p }, p)));
  pSel.value = platform;
  const bSel = h("select", { class: "input", id: "lb-" + kind + "-box", "aria-label": "Lock box" }, h("option", { value: "" }, "Select lock box"));
  for (let n = 1; n <= LB_RANGES[platform]; n++) {
    const box = lbName(platform, n), taken = others(box, mine), partner = others(box, other);
    const full = taken.length > 0 && box !== current;
    const note = full ? "in use by " + taken[0].id : partner.length ? "with " + partner[0].id : kind === "oim" ? "no Prod lock" : "";
    bSel.append(h("option", { value: box, disabled: full ? "" : null }, box + (note ? " (" + note + ")" : "")));
  }
  bSel.value = current && lbPlatformOf(current) === platform ? current : "";

  const redraw = () => { const el = document.getElementById("lb-" + kind); if (el) el.replaceWith(lbSection(kind, lbGet(kind, rec.id) || rec)); };
  pSel.addEventListener("change", () => { draft.platform = pSel.value; redraw(); const el = document.getElementById("lb-" + kind + "-box"); if (el) el.focus(); });
  bSel.addEventListener("change", () => {
    const box = bSel.value;
    if (out) { if (box && box !== current) lbChange(kind, rec.id, box); else redraw(); return; }
    draft.box = box; draft.platform = platform;
    redraw();
    if (box) lbFillFromPartner(kind, box);
  });

  const notes = [];
  const warn = (text) => notes.push(h("p", { class: "notice notice-warn" }, icon("warn"), h("span", { text })));
  if (current) {
    const same = others(current, mine), partner = others(current, other);
    if (same.length) warn(current + " also holds " + same.map((r) => r.id).join(", ") + ". Two phones used the same box before syncing. Move one of them to another box.");
    if (partner.length) notes.push(h("p", { class: "hint", text: "Also in " + current + ": " + partner.map((r) => r.id + (r.issuedTo || r.usedBy ? " (" + (r.issuedTo || r.usedBy) + ")" : "")).join(", ") + "." }));
    else if (kind === "oim") notes.push(h("p", { class: "hint", text: out ? "No operator (Prod) lock is in " + current + "." : "No operator (Prod) lock is in " + current + ". You will be asked for a reason when you issue." }));
  } else if (out) warn("No lock box recorded for this lock. Choose one.");
  if (out && rec.boxOverride) notes.push(h("p", { class: "hint", text: "Issued without a Prod lock in the box. Reason: " + rec.boxOverride }));
  if (out && rec.boxChanges) notes.push(h("p", { class: "hint", text: "Box changed: " + rec.boxChanges }));
  if (out && kind === "oim" && rec.lockBox) notes.push(h("p", { class: "hint", text: "Changing the lock box needs the OIM password." }));

  return h("section", { class: "block block-box", id: "lb-" + kind },
    h("h3", { text: "Lock box" + (out ? "" : " (required)") }),
    h("div", { class: "lb-pick" }, pSel, bSel),
    notes);
}

/* ------------------------------ rules, used by Issue and Take ------------------------------ */
/** Returns the box picked for a lock that is about to go out, or "" after telling the operator to choose. */
function lbRequire(kind, id) {
  const box = lbDraftFor(kind, id).box;
  if (box) return box;
  toast("Choose the lock box first.", "error");
  setTimeout(() => { const el = document.getElementById("lb-" + kind + "-box"); if (el) { el.classList.add("is-invalid"); el.focus(); } }, 0);
  return "";
}
/** True when another lock of the same kind already holds the box. */
function lbTaken(kind, id, box) {
  const taken = lbUse(box)[kind === "oim" ? "oim" : "ops"].filter((r) => r.id !== id);
  if (!taken.length) return false;
  toast(box + " already holds " + taken[0].id + ". Choose another lock box.", "error");
  return true;
}
/** OIM padlock into a box with no operator lock: asks for a reason. Returns the reason, "" when not needed, or null when cancelled. */
async function lbOimReason(id, box, verb, extraFields, validate) {
  const needReason = !lbUse(box).ops.length;
  const fields = (needReason ? [{ name: "reason", label: "Reason", type: "textarea", required: true, maxlength: 300, autocapitalize: "sentences", requiredMessage: "Enter the reason." }] : []).concat(extraFields || []);
  if (!fields.length) return "";
  const v = await formDialog({
    title: needReason ? "No Prod lock in " + box : "Change the lock box of " + id + "?",
    message: needReason
      ? ["An OIM padlock normally goes into a lock box that already holds an operator (Prod) lock. " + box + " has none.", "To " + verb + " anyway, give the reason. It is saved with the padlock's record."]
      : "Moves " + id + " to " + box + ". The change is saved in its record.",
    fields, confirmLabel: needReason ? (verb === "issue" ? "Issue anyway" : "Move anyway") : "Change lock box", validate
  });
  if (!v) return null;
  return needReason ? v.reason.trim() : "";
}

/** A lock that is already out moves to another box (or gets one for the first time). */
function lbChange(kind, id, box) {
  const redraw = () => { if (kind === "oim") renderSheet(); else opsRenderSheet(); };
  lbDraftFor(kind, id).platform = ""; // whatever happens next, the picker goes back to showing the box the lock is really in
  if (kind === "oim") {
    return runAction(async () => {
      await flushFields();
      let p = getPadlock(id);
      if (!p || p.status === "available" || lbTaken("oim", id, box)) return;
      const reason = await lbOimReason(id, box, "move", p.lockBox ? [PASSWORD_FIELD] : [], p.lockBox ? checkPassword : null);
      if (reason === null) return;
      p = getPadlock(id);
      if (!p || p.status === "available" || lbTaken("oim", id, box)) return;
      const now = nowLocalISO();
      await commit(Object.assign({}, p, lbPartnerFields("oim", p, box), { lockBox: box, boxOverride: reason, boxChanges: lbTrail(p, p.lockBox, box), updatedAt: now, updatedBy: state.operator }));
      lbDraft.oim = { id, box: "", platform: "" };
      toast(id + " is now in " + box, "success");
    });
  }
  return opsRun(async () => {
    await opsFlush();
    const l = opsGet(id);
    if (!l || l.status !== "inuse" || lbTaken("ops", id, box)) { redraw(); return; }
    await opsCommit(Object.assign({}, l, lbPartnerFields("ops", l, box), { lockBox: box, boxChanges: lbTrail(l, l.lockBox, box) }));
    lbDraft.ops = { id, box: "", platform: "" };
    toast(id + " is now in " + box, "success");
  });
}

/* ------------------------------ Home card ------------------------------ */
function homeLockBoxCard() {
  const map = lbMap(), conflicts = lbConflicts(), missing = lbMissing();
  const total = LB_PLATFORMS.reduce((n, p) => n + LB_RANGES[p], 0);
  const used = Array.from(map.keys()).sort();
  let oimOnly = 0;
  map.forEach((u) => { if (u.oim.length && !u.ops.length) oimOnly++; });
  const warn = (text) => h("p", { class: "notice notice-warn" }, icon("warn"), h("span", { text }));
  const row = (box) => {
    const u = map.get(box), all = u.oim.concat(u.ops), bad = u.oim.length > 1 || u.ops.length > 1;
    const first = all[0], kind = u.oim.includes(first) ? "oim" : "ops";
    return h("li", null, h("button", {
      type: "button", class: "out-row st-" + (bad ? "locked" : "issued"), "aria-label": box + ", holds " + all.map((r) => r.id).join(" and "),
      onclick: () => (kind === "oim" ? openPadlock(first.id) : opsOpen(first.id))
    },
      h("span", { class: "out-id", text: box }),
      h("span", { class: "out-main" },
        h("span", { class: "out-who", text: all.map((r) => r.id).join(" + ") }),
        h("span", { class: "out-where", text: [first.issuedTo || first.usedBy, first.location].filter(Boolean).join(", ") || "No details" })),
      h("span", { class: "out-side" }, h("span", { class: "hint", text: bad ? "Conflict" : !u.ops.length ? "No Prod lock" : !u.oim.length ? "Prod only" : "OIM + Prod" }))));
  };
  const notes = conflicts.map((c) => warn(c.box + " holds " + c.ids.join(" and ") + ". Move one to another box."))
    .concat(missing.length ? [warn("No lock box recorded: " + missing.join(", "))] : [])
    .concat(oimOnly ? [h("p", { class: "hint htile-note", text: oimOnly + (oimOnly === 1 ? " box holds" : " boxes hold") + " an OIM padlock with no operator lock." })] : []);
  return homeTile({ // home.js
    key: "boxes", title: "Lock boxes", tone: conflicts.length ? "locked" : used.length ? "issued" : "available", list: used.map(row), emptyText: "No lock boxes are in use.",
    nums: [{ value: used.length, label: "in use", tone: used.length ? "warn" : "" }, { value: total - used.length, label: "available", tone: "ok" }],
    extra: notes.length ? h("div", { class: "htile-extra" }, notes) : null
  });
}
