'use strict';

/* =====================================================================
   IbACE — license key and install prompt

   LICENSE KEY
   The whole app is locked until a license key is entered once on the
   device. A key is made for one named person, with the key maker that is
   kept OFF this public code (see README). A key is the person's name, a
   key ID, the issue date and a licence number, signed with a private key that only the
   owner holds. This file has only the matching public key, so reading
   this code does not let anyone make a working key.

   What it is not: the check runs on the device, so someone who edits a
   copy of this code can take the check out, and a key that is passed on
   works on another phone too. It keeps ordinary people out and puts a
   name on every installation. It is not copy protection.

   INSTALL PROMPT
   A banner at the top offers to install the app: an Install button where
   the browser allows it (Android, desktop Chrome and Edge), or the steps
   for iPhone and iPad, where only the person can add it from Share.

   Loaded after app.js; uses helpers from app.js.
   ===================================================================== */

const LICENSE_PUBLIC_KEY = {"kty":"EC","crv":"P-256","x":"vAa5IGAKr4W8CPGJUEkUys2ZyBPY_5vmpok7DrbyfIs","y":"nag2jzVJhTa5haVqXiSydIE_9U5XROBnt08Yxw2j6ys"};
/** Key IDs that must stop working. Add the ID here, then release an update; it takes effect on a phone when that phone updates. */
const LICENSE_REVOKED = ["NK3LH2", "T9GMV8"]; // these two were made while building and testing

/** The most licences there can be. Every key carries a number from 1 to this; a key with a higher number is refused. */
const LICENSE_MAX = 1000;
/** Keys made before keys were numbered, and the number each one counts as. */
const LICENSE_LEGACY = { QJJG3T: 1 };

const license = { key: "", name: "", id: "", issued: "", serial: 0 };

function licenseBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/"), bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Finds the key in whatever was pasted: the key alone (even broken over lines), or a whole message with the key inside it. */
function licenseFind(text) {
  const raw = String(text || "");
  const pattern = /IBACE1\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{80,90}/;
  const joined = raw.replace(/\s+/g, "");
  if (/^IBACE1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(joined)) return joined;
  const m = pattern.exec(raw);
  return m ? m[0] : "";
}

/** Returns { key, name, id, issued, serial } for a genuine key, or { error } saying why it was refused. */
async function licenseCheck(text) {
  const key = licenseFind(text);
  const m = /^IBACE1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(key);
  if (!m) return { error: "That is not an IbACE license key. Paste the whole key, starting with IBACE1." };
  if (!(window.crypto && crypto.subtle)) return { error: "This browser cannot check the key here. Open IbACE from its https address." };
  try {
    const payload = licenseBytes(m[1]), sig = licenseBytes(m[2]);
    const pub = await crypto.subtle.importKey("jwk", LICENSE_PUBLIC_KEY, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    if (!(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, sig, payload))) return { error: "That license key is not valid. Check that all of it was copied." };
    const [name, id, issued, number] = new TextDecoder().decode(payload).split("|");
    if (!name || !id) return { error: "That license key is not valid." };
    if (LICENSE_REVOKED.includes(id)) return { error: "That license key has been cancelled. Ask the admin for a new one." };
    const serial = /^\d{1,6}$/.test(number || "") ? Number(number) : (LICENSE_LEGACY[id] || 0);
    if (serial < 1 || serial > LICENSE_MAX) return { error: "That license key is outside the " + LICENSE_MAX + " licences this version allows. Ask the admin." };
    return { key, name, id, issued: issued || "", serial };
  } catch (err) {
    console.error(err);
    return { error: "That license key is not valid. Check that all of it was copied." };
  }
}

/** Resolves once this device holds a genuine key. Until then the app stays behind a screen that cannot be closed. */
async function licenseGate() {
  let stored = "";
  await tx(["meta"], "readonly", (t) => { t.objectStore("meta").get("license").onsuccess = (e) => { stored = typeof e.target.result === "string" ? e.target.result : ""; }; });
  let problem = "";
  if (stored) {
    const r = await licenseCheck(stored);
    if (!r.error) { Object.assign(license, r); return; }
    problem = r.error;
  }

  await new Promise((resolve) => {
    const box = h("textarea", { class: "input lic-key", id: "lic-key", rows: 4, autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: "IBACE1…" });
    const err = h("p", { class: "dlg-error", id: "lic-error", role: "alert", hidden: !problem, text: problem });
    const go = h("button", { type: "submit", class: "btn btn-primary btn-big btn-block", id: "lic-go" }, "Activate");
    const form = h("form", { class: "dlg lic-dlg", novalidate: true, role: "dialog", "aria-modal": "true", "aria-labelledby": "lic-title" },
      h("img", { class: "lic-logo", src: "icons/icon-192.png", alt: "", width: 72, height: 72 }),
      h("h2", { id: "lic-title", text: "Enter your license key" }),
      h("p", { class: "dlg-message", text: "IbACE needs a license key before it can be used on this device. Copy the key the admin sent you and paste it here. You do this once." }),
      h("div", { class: "field" }, h("label", { for: "lic-key", text: "License key" }), box),
      err, go,
      h("p", { class: "hint", text: "No key? Ask the admin on WhatsApp: " + ADMIN_WHATSAPP_DISPLAY + ". Each key is made for one named person." }));
    const overlay = h("div", { class: "overlay overlay-dialog lic-overlay", id: "lic-gate" }, form);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      go.disabled = true;
      const r = await licenseCheck(box.value);
      go.disabled = false;
      if (r.error) { err.textContent = r.error; err.hidden = false; box.focus(); buzz("error"); return; }
      try { await saveMeta({ license: r.key }); } catch (e2) { console.error(e2); err.textContent = "The key is valid but could not be saved on this device. Check free storage and try again."; err.hidden = false; return; }
      Object.assign(license, r);
      overlay.remove();
      toast("Licensed to " + r.name, "success");
      resolve();
    });
    document.body.append(overlay);
    box.focus();
  });
}

/* ------------------------------ install prompt ------------------------------ */
function installIsStandalone() { return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true; }
function installIsApple() { const ua = navigator.userAgent || ""; return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); }

/** Shows the install banner when it applies. Called at start-up and again when the browser says an install is possible. */
function installOffer() {
  const bar = $("#install-banner");
  if (!bar || installIsStandalone() || state.installDismissed) { if (bar) bar.hidden = true; return; }
  const apple = installIsApple();
  if (!installPromptEvent && !apple) { bar.hidden = true; return; } // this browser offers no way to install
  $("#install-text").replaceChildren(...(apple
    ? [h("strong", { text: "Install IbACE on this device. " }), "Tap the Share button in Safari, then ", h("strong", { text: "Add to Home Screen" }), ". It then opens like an app and works with no connection."]
    : [h("strong", { text: "Install IbACE on this device. " }), "It then opens like an app and works with no connection."]));
  $("#install-go").hidden = apple;
  bar.hidden = false;
}
function installBind() {
  $("#install-go").addEventListener("click", async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    try { await installPromptEvent.userChoice; } catch (_) { /* ignore */ }
    installPromptEvent = null;
    $("#btn-install").hidden = true;
    $("#install-banner").hidden = true;
  });
  $("#install-later").addEventListener("click", () => {
    state.installDismissed = true;
    $("#install-banner").hidden = true;
    saveMeta({ installDismissed: true }).catch((err) => console.error(err));
  });
}
