'use strict';

/* =====================================================================
   IbACE — Sync with another phone
   Phones have no connection in the field, so two phones are brought into
   line by passing ONE file between them (Quick Share, AirDrop, Bluetooth,
   WhatsApp). Receiving a file MERGES it; it never wipes this phone:
     - each lock follows whichever phone changed it most recently
     - history from both phones is combined, nothing is removed
     - if both phones had the same lock out to different people, the older
       record is kept in that lock's history, marked as replaced
   "Most recently" uses each phone's own clock, so phones with a wrong
   clock can win or lose wrongly. Loaded after app.js, ops.js and home.js.
   ===================================================================== */

const syncState = { lastIn: null, lastOut: "" }; // lastIn: { at, from }

async function syncLoad() {
  await tx(["meta"], "readonly", (t) => {
    const s = t.objectStore("meta");
    s.get("lastSyncIn").onsuccess = (e) => { const v = e.target.result; syncState.lastIn = v && typeof v === "object" ? v : null; };
    s.get("lastSyncOut").onsuccess = (e) => { syncState.lastOut = typeof e.target.result === "string" ? e.target.result : ""; };
  });
}

function syncStatusLine() {
  if (syncState.lastIn) return "Last received: " + fmtTime(syncState.lastIn.at) + (syncState.lastIn.from ? " from " + syncState.lastIn.from : "");
  return "Nothing received from another phone yet";
}

/* ------------------------------ the sync file ------------------------------ */
function syncBuildFile() {
  const at = nowLocalISO();
  const touched = (r) => r.status !== "available" || r.log.length > 0 || Number(r.updatedTs) > 0;
  const who = (state.operator || "phone").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "phone";
  const padlocks = state.padlocks.filter(touched).map(clone);
  const locks = opsState.locks.filter(touched).map(clone);
  const data = {
    exportInfo: { type: "ibace_sync", version: 1, exportedAt: at, exportedTs: Date.now(), operator: state.operator, device: state.device, licensedTo: license.name, licenseId: license.id },
    padlocks, padlockPhotos: Object.assign({}, padlockPhotos),
    operatorLocks: locks, operatorLockPhotos: Object.assign({}, opsPhotos)
  };
  return {
    // .txt on purpose: Android's share screen accepts text files but not .json. The content is JSON.
    name: "IbACE_Sync_" + at.slice(0, 10) + "_" + at.slice(11).replace(":", "") + "_" + who + ".txt",
    text: JSON.stringify(data),
    count: padlocks.length + locks.length,
    photoCount: Object.keys(padlockPhotos).length + Object.keys(opsPhotos).length
  };
}

function syncShareable(file) {
  try {
    if (!navigator.share || !navigator.canShare || typeof File !== "function") return null;
    const files = [new File([file.text], file.name, { type: "text/plain" })];
    return navigator.canShare({ files }) ? files : null;
  } catch (_) { return null; }
}

/* ------------------------------ merging ------------------------------ */
const sStr = (v) => (typeof v === "string" ? v : "");
const sTs = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

function syncOpsEntry(e) {
  return {
    usedBy: sStr(e.usedBy), isolationDesc: sStr(e.isolationDesc), location: sStr(e.location), remarks: sStr(e.remarks),
    takenAt: sStr(e.takenAt), returnedAt: sStr(e.returnedAt), hadPhoto: e.hadPhoto === true,
    recordedBy: sStr(e.recordedBy), returnedBy: sStr(e.returnedBy), device: sStr(e.device), syncConflict: e.syncConflict === true,
    lockBox: sStr(e.lockBox), boxChanges: sStr(e.boxChanges), oimStillInBox: sStr(e.oimStillInBox)
  };
}
function syncMergeOpsLogs(incoming, existing) {
  const seen = new Set();
  return incoming.concat(existing)
    .filter((e) => { const k = opsLogKey(e); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.returnedAt < b.returnedAt ? 1 : a.returnedAt > b.returnedAt ? -1 : 0));
}

/** One OIM padlock: returns { rec, photo, took, newerHere, conflict } or null when nothing changes. */
function syncMergePadlock(local, raw, filePhoto) {
  const inTs = sTs(raw.updatedTs), loTs = sTs(local.updatedTs);
  const incoming = Object.assign(blankPadlock(local.id, local.category), {
    status: STATUSES.includes(raw.status) ? raw.status : "available",
    issuedTo: sStr(raw.issuedTo), isolationDesc: sStr(raw.isolationDesc), location: sStr(raw.location),
    issuedAt: sStr(raw.issuedAt), lockedAt: sStr(raw.lockedAt), remarks: sStr(raw.remarks),
    issuedBy: sStr(raw.issuedBy), lockedBy: sStr(raw.lockedBy),
    photoOverride: raw.photoOverride === true, overrideReason: sStr(raw.overrideReason),
    lockBox: sStr(raw.lockBox), boxOverride: sStr(raw.boxOverride), boxChanges: sStr(raw.boxChanges),
    updatedAt: sStr(raw.updatedAt), updatedBy: sStr(raw.updatedBy), updatedTs: inTs
  });
  const inLog = Array.isArray(raw.log) ? raw.log.filter((e) => e && typeof e === "object" && !Array.isArray(e)).map(sanitizeLogEntry) : [];
  let log = mergeLogs(inLog, local.log);

  const took = inTs > loTs;
  const winner = took ? incoming : local;
  const loser = took ? local : incoming;
  const cycle = (r) => (r.status === "available" ? "" : r.issuedAt + "|" + r.issuedTo);
  let conflict = false;
  if (loser.status !== "available" && cycle(loser) !== cycle(winner) &&
      !log.some((e) => e.issuedAt === loser.issuedAt && e.issuedTo === loser.issuedTo)) {
    conflict = true; // the same padlock was out to someone else on the other phone: keep that record in history
    log = mergeLogs([{
      issuedTo: loser.issuedTo, isolationDesc: loser.isolationDesc, location: loser.location,
      issuedAt: loser.issuedAt, lockedAt: loser.lockedAt, returnedAt: "", hadPhoto: false,
      operator: loser.updatedBy || "", issuedBy: loser.issuedBy || "", lockedBy: loser.lockedBy || "", returnedBy: "",
      remarks: loser.remarks || "", photoOverride: !!loser.photoOverride, overrideReason: loser.overrideReason || "",
      lockBox: loser.lockBox || "", boxOverride: loser.boxOverride || "", boxChanges: loser.boxChanges || "",
      device: "", syncConflict: true
    }], log);
  }
  const differs = ["status", "issuedTo", "isolationDesc", "location", "issuedAt", "lockedAt", "remarks", "lockBox"].some((k) => incoming[k] !== local[k]);
  if (!took && log.length === local.log.length) return differs && loTs > inTs ? { newerHere: true } : null;
  const hasFilePhoto = typeof filePhoto === "string" && filePhoto.startsWith("data:image/");
  return {
    rec: Object.assign({}, winner, { log }),
    photo: !took ? undefined : winner.status === "available" ? (padlockPhotos[local.id] ? null : undefined) : hasFilePhoto ? filePhoto : (padlockPhotos[local.id] ? null : undefined),
    took, conflict, newerHere: !took && differs && loTs > inTs
  };
}

/** One operator lock: same rules. */
function syncMergeOpsLock(local, raw, filePhoto) {
  const inTs = sTs(raw.updatedTs), loTs = sTs(local.updatedTs);
  const incoming = Object.assign(opsBlank(local.id), {
    status: raw.status === "inuse" ? "inuse" : "available",
    usedBy: sStr(raw.usedBy), isolationDesc: sStr(raw.isolationDesc), location: sStr(raw.location), remarks: sStr(raw.remarks),
    takenAt: sStr(raw.takenAt), recordedBy: sStr(raw.recordedBy), lockBox: sStr(raw.lockBox), boxChanges: sStr(raw.boxChanges), updatedTs: inTs
  });
  const inLog = Array.isArray(raw.log) ? raw.log.filter((e) => e && typeof e === "object").map(syncOpsEntry) : [];
  let log = syncMergeOpsLogs(inLog, local.log);

  const took = inTs > loTs;
  const winner = took ? incoming : local;
  const loser = took ? local : incoming;
  const cycle = (r) => (r.status === "inuse" ? r.takenAt + "|" + r.usedBy : "");
  let conflict = false;
  if (loser.status === "inuse" && cycle(loser) !== cycle(winner) && !log.some((e) => e.takenAt === loser.takenAt && e.usedBy === loser.usedBy)) {
    conflict = true;
    log = syncMergeOpsLogs([{
      usedBy: loser.usedBy, isolationDesc: loser.isolationDesc, location: loser.location, remarks: loser.remarks,
      takenAt: loser.takenAt, returnedAt: "", hadPhoto: false, recordedBy: loser.recordedBy || "", returnedBy: "", device: "", syncConflict: true,
      lockBox: loser.lockBox || "", boxChanges: loser.boxChanges || "", oimStillInBox: ""
    }], log);
  }
  const differs = ["status", "usedBy", "isolationDesc", "location", "takenAt", "remarks", "lockBox"].some((k) => incoming[k] !== local[k]);
  if (!took && log.length === local.log.length) return differs && loTs > inTs ? { newerHere: true } : null;
  const hasFilePhoto = typeof filePhoto === "string" && filePhoto.startsWith("data:image/");
  return {
    rec: Object.assign({}, winner, { log }),
    photo: !took ? undefined : winner.status !== "inuse" ? (opsPhotos[local.id] ? null : undefined) : hasFilePhoto ? filePhoto : (opsPhotos[local.id] ? null : undefined),
    took, conflict, newerHere: !took && differs && loTs > inTs
  };
}

function syncPlan(obj) {
  const plan = { oim: [], ops: [], updated: 0, history: 0, conflicts: 0, newerHere: 0, skipped: 0 };
  const run = (list, photos, find, merge, out) => {
    (Array.isArray(list) ? list : []).forEach((raw) => {
      const local = raw && typeof raw.id === "string" ? find(raw.id) : null;
      if (!local) { plan.skipped++; return; }
      const m = merge(local, raw, photos && typeof photos === "object" ? photos[local.id] : undefined);
      if (!m) return;
      if (m.newerHere) plan.newerHere++;
      if (!m.rec) return;
      if (m.took) plan.updated++; else plan.history++;
      if (m.conflict) plan.conflicts++;
      out.push(m);
    });
  };
  run(obj.padlocks, obj.padlockPhotos, getPadlock, syncMergePadlock, plan.oim);
  run(obj.operatorLocks, obj.operatorLockPhotos, opsGet, syncMergeOpsLock, plan.ops);
  return plan;
}

async function syncApply(plan, info) {
  const lastIn = { at: nowLocalISO(), from: [sStr(info.operator), sStr(info.device) ? "(" + sStr(info.device) + ")" : ""].filter(Boolean).join(" ") };
  await tx(["padlocks", "photos", "opsLocks", "opsPhotos", "meta"], "readwrite", (t) => {
    const put = (store, photoStore, m) => {
      t.objectStore(store).put(m.rec);
      if (m.photo === null) t.objectStore(photoStore).delete(m.rec.id);
      else if (typeof m.photo === "string") t.objectStore(photoStore).put(m.photo, m.rec.id);
    };
    plan.oim.forEach((m) => put("padlocks", "photos", m));
    plan.ops.forEach((m) => put("opsLocks", "opsPhotos", m));
    t.objectStore("meta").put(lastIn, "lastSyncIn");
  });
  plan.oim.forEach((m) => {
    const i = state.padlocks.findIndex((p) => p.id === m.rec.id);
    if (i >= 0) state.padlocks[i] = m.rec;
    if (m.photo === null) delete padlockPhotos[m.rec.id]; else if (typeof m.photo === "string") padlockPhotos[m.rec.id] = m.photo;
  });
  plan.ops.forEach((m) => {
    const i = opsState.locks.findIndex((l) => l.id === m.rec.id);
    if (i >= 0) opsState.locks[i] = m.rec;
    if (m.photo === null) delete opsPhotos[m.rec.id]; else if (typeof m.photo === "string") opsPhotos[m.rec.id] = m.photo;
  });
  syncState.lastIn = lastIn;
}

async function syncReceive(file) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (_) { toast(file.name + " is not a IbACE sync file.", "error"); return; }
  if (!obj || !obj.exportInfo || obj.exportInfo.type !== "ibace_sync") { toast(file.name + " is not a IbACE sync file.", "error"); return; }
  const info = obj.exportInfo;
  const plan = syncPlan(obj);
  const from = [sStr(info.operator) || "another phone", sStr(info.device) ? "(" + sStr(info.device) + ")" : ""].filter(Boolean).join(" ");
  const n = (count, one, many) => count + " " + (count === 1 ? one : many);

  if (!plan.oim.length && !plan.ops.length) {
    try { await syncApply(plan, info); } catch (err) { console.error(err); }
    opsRenderTabs();
    toast(plan.newerHere ? "Nothing to take from " + from + ". This phone is newer for " + n(plan.newerHere, "lock", "locks") + ": send your sync file back." : "Already up to date with " + from + ".", "success");
    return;
  }
  const ok = await confirmDialog({
    title: "Merge sync file?",
    message: [
      "From " + from + ", made " + (fmtTime(sStr(info.exportedAt)) || "at an unknown time") + ".",
      n(plan.updated, "lock", "locks") + " will change to the newer record from that phone." +
        (plan.history ? " " + n(plan.history, "lock gets", "locks get") + " extra history only." : ""),
      plan.conflicts ? n(plan.conflicts, "lock was", "locks were") + " out to different people on the two phones. The older record is kept in history, marked as replaced." : "",
      plan.newerHere ? "This phone is newer for " + n(plan.newerHere, "lock", "locks") + "; those stay as they are. Send your sync file back so the other phone gets them." : "",
      "Nothing on this phone is deleted."
    ].filter(Boolean),
    confirmLabel: "Merge"
  });
  if (!ok) return;
  try {
    await syncApply(plan, info);
    toast("Synced with " + from + ": " + n(plan.updated, "lock", "locks") + " updated" + (plan.conflicts ? ", " + n(plan.conflicts, "conflict", "conflicts") + " kept in history" : ""), "success");
  } catch (err) {
    console.error(err);
    toast("The sync file could not be saved to this device, so nothing was changed. Check free storage and try again.", "error");
  }
  renderSheet(); opsRenderSheet();
  renderRegister(); opsRender();
}

/* ------------------------------ panel ------------------------------ */
function openSyncPanel() {
  const prevFocus = document.activeElement;
  const file = syncBuildFile();
  const canShare = !!syncShareable(file);
  const kb = Math.max(1, Math.round(file.text.length / 1024));
  const sent = () => {
    const t = nowLocalISO();
    syncState.lastOut = t;
    saveMeta({ lastSyncOut: t }).catch((err) => console.error(err));
  };

  const input = h("input", { type: "file", accept: ".txt,.json,text/plain,application/json", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
  input.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    close();
    await syncReceive(f);
  });
  async function shareNow() {
    const fresh = syncBuildFile(); // built synchronously inside the tap
    const files = syncShareable(fresh);
    if (!files) { toast("Sharing is not available here. Use Download sync file instead.", "error"); return; }
    try {
      await navigator.share({ files, title: "IbACE sync" });
      sent();
      toast("Sync file handed to the share screen", "success");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      console.error(err);
      toast("Sharing did not work. Use Download sync file instead.", "error");
    }
  }

  const panel = h("div", { class: "dlg dlg-wide", role: "dialog", "aria-modal": "true", "aria-labelledby": "sync-title" }, [
    h("div", { class: "dlg-head" },
      h("h2", { id: "sync-title", text: "Sync with another phone" }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    h("p", { class: "dlg-message", text: "Each phone keeps its own records. To bring two phones into line, send a sync file each way. Receiving merges; it never wipes this phone." }),
    h("h3", { text: "1. Send this phone's records" }),
    h("ul", { class: "file-list" }, h("li", null, h("strong", { text: file.name }),
      h("span", { text: file.count + (file.count === 1 ? " lock, " : " locks, ") + file.photoCount + (file.photoCount === 1 ? " photo, " : " photos, ") + (kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : kb + " KB") }))),
    canShare ? h("button", { type: "button", class: "btn btn-primary btn-big btn-block", id: "sync-share", onclick: shareNow }, "Share sync file") : null,
    h("button", { type: "button", class: "btn btn-block" + (canShare ? "" : " btn-primary btn-big"), id: "sync-download",
      onclick: () => { downloadFile(syncBuildFile()); sent(); toast("Sync file downloaded", "success"); } }, "Download sync file"),
    h("p", { class: "hint", text: "Send it by Quick Share, AirDrop or Bluetooth (these work with no internet), or by WhatsApp when you have a connection." }),
    h("hr"),
    h("h3", { text: "2. Receive another phone's records" }),
    h("button", { type: "button", class: "btn btn-big btn-block", id: "sync-open", onclick: () => input.click() }, "Open a sync file"),
    input,
    h("p", { class: "hint", text: "Each lock follows whichever phone changed it last, by that phone's clock. History from both phones is combined." }),
    h("p", { class: "hint", text: syncStatusLine() + (syncState.lastOut ? ". Last sent: " + fmtTime(syncState.lastOut) : "") + "." })
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
  panel.querySelector("button.btn").focus();
}
