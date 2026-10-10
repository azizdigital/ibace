'use strict';

/* =====================================================================
   IbACE — Settings
   About this device, change operator, check for an update, and the
   OIM-only "Reset all data". Loaded last; uses helpers from app.js.
   ===================================================================== */

const RESET_WORD = "RESET";
const RESET_WAIT_SECONDS = 7;

function settingsCheckUpdate() {
  if (!("serviceWorker" in navigator)) { toast("This browser cannot update the app by itself.", "error"); return; }
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) throw new Error("not installed");
    return reg.update().then(() => {
      if (reg.installing || reg.waiting) toast("A new version is being installed. Close and reopen the app when the update message appears.", "success");
      else toast("This device already has the newest version (" + APP_VERSION + ").", "success");
    });
  }).catch((err) => {
    console.error(err);
    toast("Could not check for an update. This needs an internet connection.", "error");
  });
}

function openSettingsPanel() {
  const prevFocus = document.activeElement;
  const oim = state.padlocks.filter((p) => p.status !== "available").length;
  const oc = opsCounts();
  const row = (label, value) => h("div", { class: "log-line" }, h("dt", { text: label }), h("dd", { text: value }));

  const panel = h("div", { class: "dlg dlg-wide", role: "dialog", "aria-modal": "true", "aria-labelledby": "set-title" },
    h("div", { class: "dlg-head" },
      h("h2", { id: "set-title", text: "Settings" }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    h("section", { class: "block" },
      h("h3", { text: "This device" }),
      h("dl", { class: "set-list" },
        row("Operator", state.operator || "not set"),
        row("Device", state.device || "not named"),
        (() => { // tapping Version five times opens the owner's key maker set-up (admin.js); it is of no use without the owner's admin code
          let taps = 0;
          return h("div", { class: "log-line", id: "set-version", onclick: () => { if (++taps >= 5) { taps = 0; close(); adminOpen(); } } }, h("dt", { text: "Version" }), h("dd", { text: APP_VERSION }));
        })(),
        row("Licensed to", license.name + " (key " + license.id + ", no. " + license.serial + " of " + LICENSE_MAX + ")"),
        row("Storage", state.persisted ? "Protected" : "Not protected: the system may clear data when storage runs low"),
        row("Out now", oim + " OIM, " + oc.inuse + " operator")),
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn", id: "btn-operator", onclick: () => { close(); changeOperator(); } }, "Change operator"),
        h("button", { type: "button", class: "btn", id: "set-update", onclick: settingsCheckUpdate }, "Check for update"),
        adminState.blob ? h("button", { type: "button", class: "btn", id: "set-admin", onclick: () => { close(); adminOpen(); } }, "Key maker") : null),
      h("p", { class: "hint", text: "Changing the operator needs the OIM password. Checking for an update needs an internet connection." })),
    h("section", { class: "block block-danger" },
      h("h3", { text: "Reset all data" }),
      h("p", { class: "hint", text: "Erases everything on this device: OIM padlocks, Prod locks, photos, history, the operator name, and your own rotation, daily log, concern reports and OT figures. For the OIM only." }),
      h("button", { type: "button", class: "btn btn-danger", id: "set-reset", onclick: () => { close(); openResetDialog(); } }, "Reset all data")));

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
  panel.querySelector(".icon-btn").focus();
}

/** Three guards: the OIM password, typing RESET, and a 7-second wait before the button works. */
function openResetDialog() {
  const prevFocus = document.activeElement;
  const withLog = (list) => list.filter((r) => r.status !== "available" || r.log.length).length;
  const photos = Object.keys(padlockPhotos).length + Object.keys(opsPhotos).length;
  let left = RESET_WAIT_SECONDS, timer = null, working = false;

  const pw = h("input", { type: "password", id: "rs-password", class: "input", autocomplete: "off" });
  const word = h("input", { type: "text", id: "rs-word", class: "input", autocomplete: "off", autocapitalize: "characters", spellcheck: "false" });
  const err = h("p", { class: "dlg-error", role: "alert", hidden: true });
  const go = h("button", { type: "submit", class: "btn btn-danger", id: "rs-go", disabled: true });
  const label = () => { go.textContent = left > 0 ? "Erase everything (wait " + left + " s)" : "Erase everything"; go.disabled = left > 0 || working; };
  label();
  timer = setInterval(() => { left--; label(); if (left <= 0) clearInterval(timer); }, 1000);

  const form = h("form", { class: "dlg dlg-wide", novalidate: true, role: "dialog", "aria-modal": "true", "aria-labelledby": "rs-title" },
    h("h2", { id: "rs-title", text: "Reset all data on this device?" }),
    h("p", { class: "notice notice-danger" }, icon("warn"), h("span", { text: "This cannot be undone." })),
    h("ul", { class: "reset-list" },
      h("li", { text: withLog(state.padlocks) + " OIM padlock record(s), with their history" }),
      h("li", { text: withLog(opsState.locks) + " operator lock record(s), with their history" }),
      h("li", { text: photos + " photo(s)" }),
      h("li", { text: "Your own records on this phone: rotation dates, daily log, concern reports and OT figures" }),
      h("li", { text: "Operator name, device name, and the sync and send records" })),
    h("p", { class: "hint", text: "Other phones are not affected. The app stays installed and starts again as new." }),
    h("button", { type: "button", class: "btn btn-block", id: "rs-backup", onclick: () => { downloadFile(syncBuildFile()); toast("Backup downloaded. To bring it back later: Sync, then Open a sync file.", "success"); } }, "Download a backup first"),
    h("div", { class: "field" }, h("label", { for: "rs-password", text: "OIM password" }), pw),
    h("div", { class: "field" }, h("label", { for: "rs-word", text: "Type " + RESET_WORD + " to confirm" }), word),
    err,
    h("div", { class: "dlg-actions" }, h("button", { type: "button", class: "btn", id: "rs-cancel", onclick: () => close() }, "Cancel"), go));
  const overlay = h("div", { class: "overlay overlay-dialog" }, form);

  function onKey(e) { if (e.key === "Escape" && !working) { e.stopPropagation(); close(); } }
  function close() {
    clearInterval(timer);
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (prevFocus && document.contains(prevFocus) && prevFocus.focus) prevFocus.focus();
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (left > 0 || working) return;
    err.hidden = true;
    if (!isOimPassword(pw.value)) { err.textContent = "That OIM password is not correct."; err.hidden = false; pw.value = ""; pw.focus(); return; }
    if (word.value.trim() !== RESET_WORD) { err.textContent = "Type " + RESET_WORD + " in capital letters to confirm."; err.hidden = false; word.focus(); return; }
    working = true; label();
    try {
      await tx(["padlocks", "photos", "opsLocks", "opsPhotos", "meta"], "readwrite", (t) => {
        ["padlocks", "photos", "opsLocks", "opsPhotos", "meta"].forEach((s) => t.objectStore(s).clear());
        if (license.key) t.objectStore("meta").put(license.key, "license"); // the license belongs to the device, not the data: it stays
        adminKeep(t.objectStore("meta")); // admin.js: so does the owner's key maker
      });
      location.reload(); // starts again as a new install: fresh locks, then asks for the operator's name
    } catch (ex) {
      console.error(ex);
      working = false; label();
      err.textContent = "The data could not be erased. Nothing was changed. Close other IbACE tabs and try again.";
      err.hidden = false;
    }
  });
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay && !working) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  pw.focus();
}
