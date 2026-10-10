'use strict';

/* =====================================================================
   IbACE — the owner's key maker (hidden)

   Makes license keys on the owner's own phones. Opened by tapping
   "Version" in Settings five times. Each device has its own block of
   numbers: four phones with 150 each (1 to 600) and two laptops with
   200 each (601 to 1000).

   Nothing secret is in this file. Keys are signed with a private key
   that is NOT part of the app. The owner brings it to this one phone as
   an "admin code": the private key locked with a passphrase the owner
   chose (PBKDF2-SHA256, 600,000 rounds, then AES-GCM), made by the Key
   Maker page on the owner's computer. The phone stores only that locked
   code, and the passphrase is asked for every time the key maker is
   opened. Without both the admin code and the passphrase, this screen
   can do nothing.

   Loaded after license.js; uses helpers from app.js and license.js.
   ===================================================================== */

const ADMIN_PREFIX = "IBACEADMIN1.";
const ADMIN_ROUNDS = 600000;
/** Each of the owner's devices hands out its own block of numbers, so two devices can never give the same number even if their lists are never merged. */
const ADMIN_RANGES = {
  phone1: { label: "Phone 1", from: 1, to: 150 }, phone2: { label: "Phone 2", from: 151, to: 300 },
  phone3: { label: "Phone 3", from: 301, to: 450 }, phone4: { label: "Phone 4", from: 451, to: 600 }
}; // Laptop 1 has 601 to 800 and Laptop 2 has 801 to 1000 (RANGES in the Key Maker page)
const adminState = { blob: "", device: "", rows: [], removed: [] }; // rows: { key, name, id, issued, serial }; removed: { id, serial, name, burn, done } keys taken off the list (burn: the number is not given out again)

function adminB64(bytes) { let s = ""; new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

/** Reads what a key says (name, ID, date, number) without checking its signature. Null when it is not a key. */
function adminParse(key) {
  const m = /^IBACE1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(key || "").trim());
  if (!m) return null;
  try {
    const [name, id, issued, number] = new TextDecoder().decode(licenseBytes(m[1])).split("|");
    if (!name || !id) return null;
    return { key: m[0], name, id, issued: issued || "", serial: /^\d{1,6}$/.test(number || "") ? Number(number) : (LICENSE_LEGACY[id] || 0) };
  } catch (_) { return null; }
}

async function adminLoad() {
  await tx(["meta"], "readonly", (t) => {
    const s = t.objectStore("meta");
    s.get("admin:blob").onsuccess = (e) => { adminState.blob = typeof e.target.result === "string" ? e.target.result : ""; };
    s.get("admin:device").onsuccess = (e) => { adminState.device = ADMIN_RANGES[e.target.result] ? e.target.result : ""; };
    s.get("admin:removed").onsuccess = (e) => { adminState.removed = Array.isArray(e.target.result) ? e.target.result : []; };
    s.get("admin:keys").onsuccess = (e) => { adminState.rows = []; adminMerge(Array.isArray(e.target.result) ? e.target.result : []); };
  });
}
/** Reset all data clears the store; this puts the key maker and its list back inside the same transaction. */
function adminKeep(store) {
  if (adminState.blob) store.put(adminState.blob, "admin:blob");
  if (adminState.device) store.put(adminState.device, "admin:device");
  if (adminState.rows.length) store.put(adminState.rows.map((r) => r.key), "admin:keys");
  if (adminState.removed.length) store.put(adminState.removed, "admin:removed");
}
/** Adds keys (as text) to the list, skipping any already there. Returns how many were new. */
function adminMerge(keys) {
  const seen = new Set(adminState.rows.map((r) => r.id));
  adminState.removed.forEach((r) => seen.add(r.id)); // a removed key does not come back when an old list is loaded
  let added = 0;
  keys.forEach((k) => { const r = adminParse(k); if (r && !seen.has(r.id)) { seen.add(r.id); adminState.rows.push(r); added++; } });
  adminState.rows.sort((a, b) => (a.issued < b.issued ? 1 : a.issued > b.issued ? -1 : b.serial - a.serial));
  return added;
}
function adminSave() { return saveMeta({ "admin:keys": adminState.rows.map((r) => r.key), "admin:removed": adminState.removed }); }
/** Takes keys off the list. burn: their numbers are not given out again. The keys themselves keep working until cancelled in license.js. */
function adminTakeOff(list, burn) {
  const ids = new Set(list.map((r) => r.id));
  list.forEach((r) => adminState.removed.push({ id: r.id, serial: r.serial, name: r.name, burn }));
  adminState.rows = adminState.rows.filter((r) => !ids.has(r.id));
  return adminSave();
}
/** Asks before removing. Resolves with "burn", "reuse" or null. word: the person must type RESET. */
function adminAsk(title, text, word, label) {
  return new Promise((resolve) => {
    const radio = (value, strong, rest, checked) => h("label", { class: "adm-choice" }, h("input", { type: "radio", name: "adm-numbers", value, checked }), h("span", null, h("strong", { text: strong }), " " + rest));
    const typed = h("input", { type: "text", class: "input", id: "adm-word", autocomplete: "off", autocapitalize: "characters", spellcheck: "false" });
    const err = h("p", { class: "dlg-error", role: "alert", hidden: true });
    const form = h("form", { class: "dlg", novalidate: true, role: "dialog", "aria-modal": "true", "aria-labelledby": "adm-ask-title" },
      h("h2", { id: "adm-ask-title", text: title }),
      h("p", { class: "dlg-message", text }),
      radio("burn", "Do not use the old number again.", "The next key continues after it. Choose this if the key was sent to anyone.", true),
      radio("reuse", "Use the number again.", "Choose this if the key never left your hands (a test, or a misspelt name).", false),
      word ? h("div", { class: "field" }, h("label", { for: "adm-word", text: "Type RESET to confirm" }), typed) : null,
      err,
      h("div", { class: "dlg-actions" }, h("button", { type: "button", class: "btn", id: "adm-ask-cancel", onclick: () => done(null) }, "Cancel"), h("button", { type: "submit", class: "btn btn-danger", id: "adm-ask-go" }, label)));
    const overlay = h("div", { class: "overlay overlay-dialog", id: "adm-ask" }, form);
    function done(v) { overlay.remove(); resolve(v); }
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (word && typed.value.trim() !== "RESET") { err.textContent = "Type RESET in capital letters to confirm."; err.hidden = false; typed.focus(); return; }
      done(form.querySelector("input[name=adm-numbers]:checked").value);
    });
    document.body.append(overlay);
  });
}
/** Numbers already taken, as far as this phone knows: every key on its list, and keys made before keys were numbered. */
function adminUsed() {
  const used = new Set(adminState.rows.map((r) => r.serial));
  Object.values(LICENSE_LEGACY).forEach((n) => used.add(n));
  adminState.removed.forEach((r) => { if (r.burn) used.add(r.serial); });
  return used;
}
/** The lowest free number in this device's own block, or 0 when the block is full. */
function adminNextSerial() {
  const range = ADMIN_RANGES[adminState.device], used = adminUsed();
  if (!range) return 0;
  for (let n = range.from; n <= Math.min(range.to, LICENSE_MAX); n++) if (!used.has(n)) return n;
  return 0;
}
/** How many numbers of this device's block are taken. */
function adminRangeUsed() {
  const range = ADMIN_RANGES[adminState.device], used = adminUsed();
  let n = 0;
  if (range) used.forEach((s) => { if (s >= range.from && s <= range.to) n++; });
  return n;
}

/** Opens the admin code with the passphrase. Resolves with a signing key, or throws. */
async function adminUnlock(code, passphrase) {
  const text = String(code || "").replace(/\s+/g, "");
  if (!text.startsWith(ADMIN_PREFIX)) throw new Error("That is not an IbACE admin code.");
  const raw = licenseBytes(text.slice(ADMIN_PREFIX.length));
  const salt = raw.slice(0, 16), iv = raw.slice(16, 28), data = raw.slice(28);
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const aes = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ADMIN_ROUNDS, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  let jwk;
  try { jwk = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, data))); }
  catch (_) { throw new Error("That passphrase is not correct."); }
  if (jwk.x !== LICENSE_PUBLIC_KEY.x || jwk.y !== LICENSE_PUBLIC_KEY.y) throw new Error("That admin code is for a different app.");
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

function adminMessage(r) {
  return "IbACE license key for " + r.name + ".\n\n1. Open " + location.href.split(/[?#]/)[0] + " with internet.\n2. Copy this whole message and paste it into \"Enter your license key\", then tap Activate.\n\n" + r.key;
}

function adminOpen() {
  const prevFocus = document.activeElement;
  let signer = null, shown = null;
  const body = h("div", { class: "adm-body" });
  const panel = h("div", { class: "dlg dlg-wide", role: "dialog", "aria-modal": "true", "aria-labelledby": "adm-title" },
    h("div", { class: "dlg-head" },
      h("h2", { id: "adm-title", text: "Key maker" }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    body);
  const overlay = h("div", { class: "overlay overlay-dialog", id: "adm-panel" }, panel);
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
  function close() {
    signer = null; // the unlocked key is dropped as soon as the screen closes
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (prevFocus && document.contains(prevFocus) && prevFocus.focus) prevFocus.focus();
  }

  const err = h("p", { class: "dlg-error", id: "adm-error", role: "alert", hidden: true });
  const fail = (msg) => { err.textContent = msg; err.hidden = false; buzz("error"); };

  function drawLocked() {
    const needCode = !adminState.blob, first = needCode || !adminState.device;
    const device = h("select", { class: "input", id: "adm-device" }, h("option", { value: "" }, "Choose…"), Object.entries(ADMIN_RANGES).map(([k, r]) => h("option", { value: k }, r.label + " (numbers " + r.from + " to " + r.to + ")")));
    const code = h("textarea", { class: "input lic-key", id: "adm-code", rows: 4, autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "IBACEADMIN1…" });
    const pass = h("input", { type: "password", class: "input", id: "adm-pass", autocomplete: "off" });
    const go = h("button", { type: "submit", class: "btn btn-primary btn-block", id: "adm-unlock" }, first ? "Set up on this phone" : "Unlock");
    err.hidden = true;
    const form = h("form", { class: "block", novalidate: true },
      h("p", { class: "hint", text: first && !needCode ? "Say which of your phones this is, then enter your passphrase."
        : first
        ? "For the owner of IbACE only. To make license keys on this phone, paste the admin code from the Key Maker page on your computer and enter the passphrase you chose there."
        : "Enter your passphrase to make license keys. This is " + ADMIN_RANGES[adminState.device].label + ": numbers " + ADMIN_RANGES[adminState.device].from + " to " + ADMIN_RANGES[adminState.device].to + "." }),
      needCode ? h("div", { class: "field" }, h("label", { for: "adm-code", text: "Admin code" }), code) : null,
      first ? h("div", { class: "field" }, h("label", { for: "adm-device", text: "This phone is" }), device, h("p", { class: "hint", text: "Each of your devices gives out its own numbers. Give every phone a different one: two phones set as the same Phone would give two people the same number." })) : null,
      h("div", { class: "field" }, h("label", { for: "adm-pass", text: "Passphrase" }), pass),
      err, go,
      first ? null : h("button", { type: "button", class: "btn btn-danger", id: "adm-remove", onclick: remove }, "Remove the key maker from this phone"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (!(window.crypto && crypto.subtle)) { fail("This browser cannot do this here. Open IbACE from its https address."); return; }
      if (first && !ADMIN_RANGES[device.value]) { fail("Choose which of your phones this is."); device.focus(); return; }
      const blob = needCode ? code.value.replace(/\s+/g, "") : adminState.blob;
      go.disabled = true; go.textContent = "Checking…";
      try {
        signer = await adminUnlock(blob, pass.value);
        if (first) { await saveMeta({ "admin:blob": blob, "admin:device": device.value }); adminState.blob = blob; adminState.device = device.value; toast("Key maker set up on this phone.", "success"); }
        drawOpen();
      } catch (ex) { go.disabled = false; go.textContent = first ? "Set up on this phone" : "Unlock"; pass.value = ""; fail(ex.message || "That did not work."); }
    });
    body.replaceChildren(form);
    (needCode ? code : pass).focus();
  }

  async function remove() {
    if (!(await confirmDialog({ title: "Remove the key maker from this phone?", message: "The admin code and the list of keys made here are erased from this phone. Keys already given out keep working. Download the list first if you have not.", confirmLabel: "Remove", danger: true }))) return;
    await tx(["meta"], "readwrite", (t) => { ["admin:blob", "admin:device", "admin:keys", "admin:removed"].forEach((k) => t.objectStore("meta").delete(k)); });
    adminState.blob = ""; adminState.device = ""; adminState.rows = []; adminState.removed = [];
    toast("Key maker removed from this phone.", "success");
    close();
  }

  function drawOpen() {
    const name = h("input", { type: "text", class: "input", id: "adm-name", maxlength: 60, autocomplete: "off", placeholder: "Ali bin Hassan" });
    const made = h("p", { class: "notice notice-ok", id: "adm-made" });
    const keyBox = h("textarea", { class: "input lic-key", id: "adm-key", rows: 4, readonly: true });
    const result = h("div", { class: "adm-result", hidden: true }, made, keyBox,
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn btn-primary", id: "adm-wa", onclick: () => { if (shown) window.open("https://wa.me/?text=" + encodeURIComponent(adminMessage(shown)), "_blank", "noopener"); } }, "Send by WhatsApp"),
        h("button", { type: "button", class: "btn", id: "adm-copy", onclick: () => { if (shown) copyText(adminMessage(shown)).then(() => toast("Message with the key copied.", "success"), () => toast("Could not copy. Select the key and copy it by hand.", "error")); } }, "Copy message"),
        h("button", { type: "button", class: "btn", id: "adm-copy-key", onclick: () => { if (shown) copyText(shown.key).then(() => toast("Key copied.", "success"), () => toast("Could not copy. Select the key and copy it by hand.", "error")); } }, "Copy key only")));
    const count = h("h3", { id: "adm-count" });
    const mine = h("p", { class: "adm-mine", id: "adm-mine" });
    const range = ADMIN_RANGES[adminState.device];
    const dup = h("p", { class: "dlg-error", id: "adm-dup", hidden: true });
    const list = h("ul", { class: "adm-list", id: "adm-list" });
    const file = h("input", { type: "file", accept: ".csv,text/csv,text/plain", class: "visually-hidden", tabindex: "-1", "aria-hidden": "true" });
    const csv = () => {
      const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
      downloadFile({ name: "ibace-keys-" + todayLocal() + ".csv", text: "number,date,id,name,key\n" + adminState.rows.map((r) => [r.serial, r.issued, r.id, r.name, r.key].map(q).join(",")).join("\n") + "\n" });
    };
    const own = (r) => Object.prototype.hasOwnProperty.call(LICENSE_LEGACY, r.id); // the owner's own key is never removed
    const revCount = h("h3", { id: "adm-removed-count" });
    const revLine = h("textarea", { class: "input lic-key", id: "adm-revoke-line", rows: 3, readonly: true });
    const revNote = h("p", { class: "hint", id: "adm-burnt-note" });
    const revoke = h("section", { class: "block", id: "adm-revoke", hidden: true }, revCount,
      h("p", { class: "dlg-error", text: "Removing a key from the list does NOT stop it working. It still opens the app until its Key ID is cancelled in the app." }),
      h("p", { class: "hint", text: "To cancel every removed key: on the computer, open license.js in the app folder, replace the line that starts const LICENSE_REVOKED with the line below, raise the version and upload to GitHub. A phone stops accepting the key when it next updates." }),
      revLine,
      h("div", { class: "btn-row" },
        h("button", { type: "button", class: "btn btn-primary", id: "adm-copy-revoke", onclick: () => copyText(revLine.value).then(() => toast("Line copied.", "success"), () => toast("Could not copy. Select the line and copy it by hand.", "error")) }, "Copy this line"),
        h("button", { type: "button", class: "btn", id: "adm-forget", onclick: async () => { adminState.removed.forEach((r) => { r.done = true; }); await adminSave(); drawList(); } }, "I have cancelled them: clear this box")),
      revNote);
    const removeOne = async (r) => {
      const v = await adminAsk("Remove " + r.name + " from the list?", "Key ID " + r.id + ", no. " + r.serial + ". This only takes it off your list. The key keeps working until you cancel it in the app.", false, "Remove");
      if (!v) return;
      await adminTakeOff([r], v === "burn");
      if (shown && shown.id === r.id) { shown = null; result.hidden = true; }
      drawList();
    };
    const resetList = async () => {
      const mine = adminState.rows.filter((r) => !own(r));
      if (!mine.length && !adminState.removed.some((r) => r.burn)) { toast("There is nothing to reset.", "error"); return; }
      const v = await adminAsk("Reset the list?", mine.length + " key(s) will be taken off this phone's list. A backup of the list is downloaded first. The keys keep working until you cancel them in the app.", true, "Reset list");
      if (!v) return;
      if (mine.length) csv();
      if (v === "reuse") adminState.removed.forEach((r) => { r.burn = false; }); // start again from the beginning of the block
      await adminTakeOff(mine, v === "burn");
      shown = null; result.hidden = true;
      drawList();
      toast("List reset. " + mine.length + " key(s) removed.", "success");
    };
    const show = (r, isNew) => { shown = r; made.textContent = (isNew ? "Key made for " : "Key for ") + r.name + ". Key ID " + r.id + ", no. " + r.serial + "."; keyBox.value = r.key; result.hidden = false; err.hidden = true; };
    const drawList = () => {
      const n = adminState.rows.length;
      count.textContent = "Keys on this list: " + n + " of " + LICENSE_MAX;
      mine.textContent = range.label + ": " + adminRangeUsed() + " of " + (range.to - range.from + 1) + " numbers used (" + range.from + " to " + range.to + ").";
      const seen = new Set(), twice = new Set();
      adminState.rows.forEach((r) => { if (seen.has(r.serial)) twice.add(r.serial); seen.add(r.serial); });
      dup.hidden = !twice.size;
      dup.textContent = twice.size ? "Two keys share the same number: " + [...twice].join(", ") + ". Both work, but they count as one of the " + LICENSE_MAX + "." : "";
      list.replaceChildren(...adminState.rows.map((r) => h("li", null,
        h("span", { class: "adm-who" }, h("strong", { text: r.name }), h("span", { class: "hint", text: "No. " + r.serial + " · " + r.id + " · " + r.issued })),
        h("button", { type: "button", class: "btn btn-small", onclick: () => { show(r, false); result.scrollIntoView({ block: "nearest" }); } }, "Show"),
        own(r) ? null : h("button", { type: "button", class: "btn btn-small adm-remove-row", "aria-label": "Remove " + r.name, onclick: () => removeOne(r) }, "Remove"))));
      const open = adminState.removed.filter((r) => !r.done);
      revoke.hidden = !open.length;
      revCount.textContent = "Removed from the list: " + open.length;
      revLine.value = "const LICENSE_REVOKED = " + JSON.stringify(LICENSE_REVOKED.concat(open.map((r) => r.id).filter((id) => !LICENSE_REVOKED.includes(id)))).replace(/,/g, ", ") + ";";
      const burnt = adminState.removed.filter((r) => r.burn && r.serial >= range.from && r.serial <= range.to).length;
      revNote.textContent = burnt ? burnt + " of this phone's numbers will not be given out again." : "The numbers of the removed keys can be given out again.";
    };
    const makeBtn = h("button", { type: "submit", class: "btn btn-primary btn-block", id: "adm-make" }, "Make key");
    err.hidden = true;
    const form = h("form", { class: "block", novalidate: true },
      h("h3", { text: "Make a key" }),
      h("div", { class: "field" }, h("label", { for: "adm-name", text: "Person's name" }), name),
      makeBtn, err, result);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.hidden = true;
      const who = name.value.trim().replace(/[|\r\n]/g, " ").replace(/\s+/g, " ");
      if (!who) { fail("Enter the person's name."); name.focus(); return; }
      const serial = adminNextSerial();
      if (!serial) { fail("All of " + range.label + "'s numbers (" + range.from + " to " + range.to + ") have been used. Make the key on another of your devices."); return; }
      try {
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
        let id = ""; crypto.getRandomValues(new Uint8Array(6)).forEach((b) => { id += alphabet[b % alphabet.length]; });
        const payload = new TextEncoder().encode([who, id, todayLocal(), serial].join("|"));
        const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer, payload);
        const key = "IBACE1." + adminB64(payload) + "." + adminB64(sig);
        adminMerge([key]);
        await adminSave();
        name.value = "";
        show(adminState.rows.find((r) => r.id === id), true);
        drawList();
      } catch (ex) { console.error(ex); fail("The key could not be made."); }
    });
    file.addEventListener("change", async () => {
      const f = file.files[0]; file.value = "";
      if (!f) return;
      const found = (await f.text()).match(/IBACE1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
      const added = adminMerge(found);
      await adminSave();
      drawList();
      toast(found.length ? added + " key(s) added to the list from that file." : "No keys were found in that file.", found.length ? "success" : "error");
    });
    body.replaceChildren(form,
      h("section", { class: "block" }, count, mine, dup,
        h("p", { class: "hint", text: "Every device has its own numbers, so no two give the same one. Phone 1: 1 to 150 (number 1 is your own key). Phone 2: 151 to 300. Phone 3: 301 to 450. Phone 4: 451 to 600. Laptop 1: 601 to 800. Laptop 2: 801 to 1000. To see every key in one place, download the list here and load it on the others now and then." }),
        h("div", { class: "btn-row" },
          h("button", { type: "button", class: "btn", id: "adm-download", onclick: csv }, "Download list (CSV)"),
          h("button", { type: "button", class: "btn", id: "adm-load", onclick: () => file.click() }, "Load a list"), file,
          h("button", { type: "button", class: "btn btn-danger", id: "adm-reset", onclick: resetList }, "Reset list")),
        list),
      revoke);
    drawList();
    name.focus();
  }

  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  drawLocked();
}
