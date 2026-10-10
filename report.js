'use strict';

/* =====================================================================
   IbACE — PDF report
   Writes a real .pdf file in plain JavaScript (no libraries, works
   offline). Uses the PDF built-in Helvetica fonts and embeds proof
   photos as JPEG. Loaded after app.js and uses its state and helpers.
   ===================================================================== */

const PDF_PAGE = { w: 595.28, h: 841.89, margin: 40 }; // A4 portrait, points
const REPORT_PHOTO_EDGE = { small: 480, large: 1280 }; // px, longest edge stored in the PDF

// Helvetica / Helvetica-Bold advance widths for characters 32..126 (per 1000 units).
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
  667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
  278,278,278,469,556,333,
  556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
  334,260,334,584];
const HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,
  722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
  333,278,333,584,556,333,
  556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,
  389,280,389,584];

// Common punctuation outside Latin-1, mapped to the PDF WinAnsi code page.
const PDF_CHAR_MAP = { 0x2018: 145, 0x2019: 146, 0x201C: 147, 0x201D: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2026: 133, 0x20AC: 128 };

function pdfCode(ch) {
  const c = ch.codePointAt(0);
  if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255)) return c;
  if (c === 9 || c === 10 || c === 13) return 32;
  return PDF_CHAR_MAP[c] || 63; // anything the built-in fonts cannot draw becomes "?"
}
function pdfCodes(s) { return Array.from(String(s == null ? "" : s)).map(pdfCode); }
function pdfString(s) {
  let out = "";
  for (const c of pdfCodes(s)) {
    if (c === 40 || c === 41 || c === 92) out += "\\" + String.fromCharCode(c);
    else if (c >= 32 && c <= 126) out += String.fromCharCode(c);
    else out += "\\" + c.toString(8).padStart(3, "0");
  }
  return out;
}
function textWidth(s, size, bold) {
  const table = bold ? HELV_B : HELV;
  let w = 0;
  for (const c of pdfCodes(s)) w += c <= 126 ? table[c - 32] : (bold ? 611 : 556);
  return (w * size) / 1000;
}
function wrapText(s, size, bold, maxW) {
  const out = [];
  for (const para of String(s == null ? "" : s).split(/\r?\n/)) {
    let line = "";
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (textWidth(word, size, bold) > maxW && word.length > 1) { // break a word longer than the column
        let cut = 1;
        while (cut < word.length - 1 && textWidth(word.slice(0, cut + 1), size, bold) <= maxW) cut++;
        if (line) { out.push(line); line = ""; }
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const trial = line ? line + " " + word : word;
      if (textWidth(trial, size, bold) <= maxW || !line) line = trial;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

/* ------------------------------ minimal PDF writer ------------------------------ */
function PdfWriter() {
  this.pages = [];
  this.images = [];
  this.cur = null;
}
const n2 = (v) => (Math.round(v * 100) / 100).toString();
const rgb = (c) => c.map((v) => (Math.round(v * 1000) / 1000).toString()).join(" ");
PdfWriter.prototype.addPage = function () { this.cur = { ops: [] }; this.pages.push(this.cur); };
/** y is measured from the top of the page; for text it is the baseline. */
PdfWriter.prototype.text = function (x, y, s, o) {
  const str = pdfString(s);
  if (!str) return;
  this.cur.ops.push("BT /" + (o.bold ? "F2" : "F1") + " " + n2(o.size) + " Tf " + rgb(o.color || [0, 0, 0]) + " rg " +
    n2(x) + " " + n2(PDF_PAGE.h - y) + " Td (" + str + ") Tj ET");
};
PdfWriter.prototype.rect = function (x, y, w, ht, color) {
  this.cur.ops.push(rgb(color) + " rg " + n2(x) + " " + n2(PDF_PAGE.h - y - ht) + " " + n2(w) + " " + n2(ht) + " re f");
};
PdfWriter.prototype.line = function (x1, y1, x2, y2, color, width) {
  this.cur.ops.push(rgb(color) + " RG " + n2(width) + " w " + n2(x1) + " " + n2(PDF_PAGE.h - y1) + " m " + n2(x2) + " " + n2(PDF_PAGE.h - y2) + " l S");
};
PdfWriter.prototype.addImage = function (img) { this.images.push(img); return this.images.length - 1; };
PdfWriter.prototype.image = function (index, x, y, w, ht) {
  this.cur.ops.push("q " + n2(w) + " 0 0 " + n2(ht) + " " + n2(x) + " " + n2(PDF_PAGE.h - y - ht) + " cm /Im" + index + " Do Q");
};
PdfWriter.prototype.build = function (info) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const put = (d) => {
    let bytes = d;
    if (typeof d === "string") {
      bytes = new Uint8Array(d.length);
      for (let i = 0; i < d.length; i++) bytes[i] = d.charCodeAt(i) & 0xff;
    }
    chunks.push(bytes);
    length += bytes.length;
  };
  const begin = (n) => { offsets[n] = length; put(n + " 0 obj\n"); };
  const end = () => put("\nendobj\n");

  const firstImage = 6;
  const firstPage = firstImage + this.images.length;
  const total = firstPage + this.pages.length * 2; // object numbers 1 .. total-1

  put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  begin(1); put("<< /Type /Catalog /Pages 2 0 R >>"); end();
  begin(2); put("<< /Type /Pages /Count " + this.pages.length + " /Kids [" +
    this.pages.map((_, i) => (firstPage + i * 2) + " 0 R").join(" ") + "] >>"); end();
  begin(3); put("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"); end();
  begin(4); put("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"); end();
  begin(5); put("<< /Title (" + pdfString(info.title) + ") /Author (" + pdfString(info.author) + ") /Producer (IbACE) /CreationDate (D:" + info.stamp + ") >>"); end();

  this.images.forEach((img, i) => {
    begin(firstImage + i);
    put("<< /Type /XObject /Subtype /Image /Width " + img.w + " /Height " + img.h +
      " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + img.bytes.length + " >>\nstream\n");
    put(img.bytes);
    put("\nendstream");
    end();
  });

  const xobjects = this.images.length
    ? " /XObject << " + this.images.map((_, i) => "/Im" + i + " " + (firstImage + i) + " 0 R").join(" ") + " >>"
    : "";
  this.pages.forEach((page, i) => {
    const content = page.ops.join("\n");
    begin(firstPage + i * 2);
    put("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PDF_PAGE.w + " " + PDF_PAGE.h + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>" +
      xobjects + " >> /Contents " + (firstPage + i * 2 + 1) + " 0 R >>");
    end();
    begin(firstPage + i * 2 + 1);
    put("<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream");
    end();
  });

  const xref = length;
  let table = "xref\n0 " + total + "\n0000000000 65535 f \n";
  for (let n = 1; n < total; n++) table += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
  put(table + "trailer\n<< /Size " + total + " /Root 1 0 R /Info 5 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
};

/* ------------------------------ photos for the PDF ------------------------------ */
function dataUrlBytes(url) {
  const bin = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
/** Read width, height and colour components from a JPEG's frame header. */
function jpegInfo(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if ((m >= 0xd0 && m <= 0xd9) || m === 0x01) { i += 2; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], comps: b[i + 9] };
    }
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  return null;
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("unreadable photo"));
    img.src = src;
  });
}
/** Returns { bytes, w, h } as an RGB JPEG no larger than maxEdge. */
async function preparePhoto(dataUrl, maxEdge) {
  if (/^data:image\/jpeg;base64,/.test(dataUrl)) {
    const bytes = dataUrlBytes(dataUrl);
    const info = jpegInfo(bytes);
    if (info && info.comps === 3 && info.w > 0 && info.h > 0 && Math.max(info.w, info.h) <= maxEdge) {
      return { bytes, w: info.w, h: info.h }; // already the right size: embed untouched
    }
  }
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { bytes: dataUrlBytes(canvas.toDataURL("image/jpeg", 0.7)), w: canvas.width, h: canvas.height };
}

/* ------------------------------ report layout ------------------------------ */
const REPORT_PERIODS = { all: "all time", today: "today", "7": "last 7 days", "30": "last 30 days" };

function periodCutoff(period) {
  if (period === "all") return "";
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period !== "today") d.setDate(d.getDate() - (Number(period) - 1));
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "T00:00";
}

/** opts: { summary, active, register, history, period, photos: "none"|"small"|"large" } ; photoMap: { id: {bytes,w,h} } */
function buildReportPdf(opts, photoMap, generatedAt, logo) {
  const W = PDF_PAGE.w, M = PDF_PAGE.margin, CW = W - 2 * M;
  const BOTTOM = PDF_PAGE.h - M - 18; // room for the footer
  const C = {
    ink: [0.06, 0.15, 0.17], mute: [0.36, 0.44, 0.47], line: [0.78, 0.83, 0.85], head: [0.9, 0.94, 0.95], hull: [0.11, 0.31, 0.85],
    available: [0.07, 0.42, 0.22], issued: [0.6, 0.36, 0], locked: [0.72, 0.15, 0.11]
  };
  const pdf = new PdfWriter();
  let y = 0;
  const newPage = () => { pdf.addPage(); y = M; };
  const ensure = (ht) => { if (y + ht > BOTTOM) newPage(); };
  const heading = (title) => {
    ensure(70);
    y += 10;
    pdf.text(M, y + 11, title, { size: 13, bold: true, color: C.hull });
    y += 17;
    pdf.line(M, y, M + CW, y, C.hull, 1);
    y += 8;
  };
  const note = (text) => { ensure(16); pdf.text(M, y + 9, text, { size: 9.5, color: C.mute }); y += 18; };
  const statusCell = (s) => ({ text: STATUS_META[s].label, bold: true, color: C[s] });

  function table(cols, rows) {
    const size = 8.5, lh = 10.5, pad = 4;
    const drawHead = () => {
      const ht = lh + 2 * pad - 1;
      pdf.rect(M, y, CW, ht, C.head);
      let x = M;
      cols.forEach((c) => { pdf.text(x + pad, y + pad + 7.5, c.title, { size, bold: true, color: C.ink }); x += c.w; });
      y += ht;
    };
    ensure(2 * lh + 4 * pad);
    drawHead();
    rows.forEach((row) => {
      const cells = row.map((cell, i) => {
        const o = cell && typeof cell === "object" ? cell : { text: cell };
        return { o, lines: wrapText(o.text, size, !!o.bold, cols[i].w - 2 * pad) };
      });
      const ht = Math.max.apply(null, cells.map((c) => c.lines.length)) * lh + 2 * pad - 2;
      if (y + ht > BOTTOM) { newPage(); drawHead(); }
      let x = M;
      cells.forEach((c, i) => {
        c.lines.forEach((ln, k) => pdf.text(x + pad, y + pad + 7 + k * lh, ln, { size, bold: !!c.o.bold, color: c.o.color || C.ink }));
        x += cols[i].w;
      });
      y += ht;
      pdf.line(M, y, M + CW, y, C.line, 0.5);
    });
    y += 8;
  }

  /* ---- title ---- */
  newPage();
  const tx0 = logo ? M + 54 : M; // text starts after the logo when there is one
  if (logo) pdf.image(logo.index, M, y - 2, 44, 44);
  pdf.text(tx0, y + 18, "OIM Padlock Report", { size: 20, bold: true, color: C.hull });
  y += 30;
  pdf.text(tx0, y + 8, "Generated " + fmtTime(generatedAt) + " by " + (state.operator || "unknown operator") +
    (state.device ? " on " + state.device : ""), { size: 9.5, color: C.mute });
  y += 16;
  pdf.line(M, y, M + CW, y, C.hull, 2);
  y += 8;

  /* ---- summary ---- */
  if (opts.summary) {
    heading("Summary");
    const all = countBy(state.padlocks);
    const rows = CATEGORIES.map((cat) => {
      const list = state.padlocks.filter((p) => p.category === cat);
      const c = countBy(list);
      return [cat, String(c.available), String(c.issued), String(c.locked), String(list.length)];
    });
    rows.push([{ text: "All padlocks", bold: true },
      { text: String(all.available), bold: true, color: C.available },
      { text: String(all.issued), bold: true, color: C.issued },
      { text: String(all.locked), bold: true, color: C.locked },
      { text: String(state.padlocks.length), bold: true }]);
    table([{ title: "Category", w: 155.28 }, { title: "Available", w: 90 }, { title: "Issued", w: 90 }, { title: "Locked", w: 90 }, { title: "Total", w: 90 }], rows);
  }

  /* ---- active padlocks ---- */
  if (opts.active) {
    const active = state.padlocks.filter((p) => p.status !== "available");
    heading("Active padlocks (" + active.length + ")");
    if (!active.length) note("No padlocks are issued or locked.");
    active.forEach((p) => {
      const photo = photoMap[p.id];
      const hasPhoto = !!padlockPhotos[p.id];
      const big = opts.photos === "large";
      let photoText = hasPhoto ? "Yes" : (p.status === "issued" ? "Not taken yet" : "No");
      if (p.photoOverride) photoText = (hasPhoto ? "Yes, added after OIM override: " : "No, OIM override: ") + (p.overrideReason || "no reason recorded");
      const facts = [
        ["Issued to", p.issuedTo || "Not recorded"],
        ["Isolation", p.isolationDesc || "Not recorded"],
        ["Location", p.location || "Not recorded"],
        ["Issued", fmtTime(p.issuedAt) + (p.issuedBy ? " by " + p.issuedBy : "")],
        p.status === "locked" ? ["Locked", fmtTime(p.lockedAt) + (p.lockedBy ? " by " + p.lockedBy : "")] : null,
        ["Proof photo", photoText],
        p.remarks ? ["Remarks", p.remarks] : null
      ].filter(Boolean);

      const inset = 12, labelW = 70, size = 9.5, lh = 12;
      let pw = 0, ph = 0;
      if (photo) {
        const maxW = big ? CW - inset - 4 : 150, maxH = big ? 330 : 112;
        const k = Math.min(maxW / photo.w, maxH / photo.h);
        pw = photo.w * k; ph = photo.h * k;
      }
      const sideW = photo && !big ? 150 + 12 : 0;
      const valueW = CW - inset - labelW - sideW - 4;
      const lines = facts.map((f) => wrapText(f[1], size, false, valueW));
      const textH = 22 + lines.reduce((sum, l) => sum + l.length * lh + 2, 0);
      const blockH = Math.max(textH + (photo && big ? ph + 10 : 0), photo && !big ? ph + 26 : 0) + 4;

      ensure(blockH + 10);
      pdf.rect(M, y, 4, blockH, C[p.status]); // status rail, like the tag in the app
      pdf.text(M + inset, y + 13, p.id, { size: 13, bold: true, color: C.ink });
      const idW = textWidth(p.id, 13, true);
      pdf.text(M + inset + idW + 10, y + 13, p.category, { size: 9.5, color: C.mute });
      pdf.text(M + inset + idW + 10 + textWidth(p.category, 9.5, false) + 10, y + 13, STATUS_META[p.status].label, { size: 9.5, bold: true, color: C[p.status] });
      let ty = y + 22;
      facts.forEach((f, i) => {
        pdf.text(M + inset, ty + 9, f[0], { size, color: C.mute });
        lines[i].forEach((ln, k) => pdf.text(M + inset + labelW, ty + 9 + k * lh, ln, { size, color: C.ink }));
        ty += lines[i].length * lh + 2;
      });
      if (photo && big) pdf.image(photo.index, M + inset, ty + 6, pw, ph);
      else if (photo) pdf.image(photo.index, M + CW - pw, y + 22, pw, ph);
      y += blockH;
      pdf.line(M, y + 5, M + CW, y + 5, C.line, 0.5);
      y += 10;
    });
  }

  /* ---- full register ---- */
  if (opts.register) {
    heading("Full register (" + state.padlocks.length + " padlocks)");
    table(
      [{ title: "Padlock", w: 52 }, { title: "Category", w: 55 }, { title: "Status", w: 55 }, { title: "Issued to", w: 105 },
        { title: "Location", w: 98.28 }, { title: "Issued", w: 75 }, { title: "Locked", w: 75 }],
      state.padlocks.map((p) => [{ text: p.id, bold: true }, p.category, statusCell(p.status), p.issuedTo, p.location, fmtTime(p.issuedAt), fmtTime(p.lockedAt)]));
  }

  /* ---- return history ---- */
  if (opts.history) {
    const cutoff = periodCutoff(opts.period);
    const entries = [];
    state.padlocks.forEach((p) => (Array.isArray(p.log) ? p.log : []).forEach((e) => {
      if (!cutoff || String(e.returnedAt || "") >= cutoff) entries.push({ id: p.id, e });
    }));
    entries.sort((a, b) => (a.e.returnedAt < b.e.returnedAt ? 1 : a.e.returnedAt > b.e.returnedAt ? -1 : idNumber(a.id) - idNumber(b.id)));
    heading("Return history, " + REPORT_PERIODS[opts.period] + " (" + entries.length + ")");
    if (!entries.length) note("No padlocks were returned in this period.");
    else {
      table(
        [{ title: "Padlock", w: 46 }, { title: "Technician", w: 82 }, { title: "Isolation / location", w: 104.28 }, { title: "Issued", w: 60 },
          { title: "Locked", w: 60 }, { title: "Returned", w: 60 }, { title: "Photo", w: 48 }, { title: "Returned by", w: 55 }],
        entries.map(({ id, e }) => [
          { text: id, bold: true }, e.issuedTo,
          [e.isolationDesc, e.location].filter(Boolean).join("\n"),
          fmtTime(e.issuedAt), e.lockedAt ? fmtTime(e.lockedAt) : "Not locked", e.syncConflict ? "Replaced in sync" : fmtTime(e.returnedAt),
          e.hadPhoto ? "Yes" : { text: e.photoOverride ? "No (override)" : "No", color: e.lockedAt ? C.locked : C.ink },
          e.operator || e.returnedBy || ""
        ]));
    }
  }

  /* ---- operator locks (own record, not part of OIM Assist) ---- */
  if (opts.ops) {
    const oc = opsCounts();
    heading("Operator locks (" + oc.inuse + " of " + oc.total + " in use)");
    note(oc.available + " available, " + oc.inuse + " in use, " + oc.total + " total. Operator locks are the operators' own record and are not part of OIM Assist.");
    const inuse = opsState.locks.filter((l) => l.status === "inuse");
    if (inuse.length) {
      table(
        [{ title: "Lock", w: 55 }, { title: "Used by", w: 95 }, { title: "Isolation", w: 120.28 }, { title: "Location", w: 85 },
          { title: "Taken", w: 65 }, { title: "Photo", w: 35 }, { title: "Remarks", w: 60 }],
        inuse.map((l) => [{ text: l.id, bold: true }, l.usedBy, l.isolationDesc, l.location, fmtTime(l.takenAt), opsPhotos[l.id] ? "Yes" : "No", l.remarks]));
    }
    const cutoff = periodCutoff(opts.period);
    const entries = [];
    opsState.locks.forEach((l) => l.log.forEach((e) => { if (!cutoff || String(e.returnedAt || "") >= cutoff) entries.push({ id: l.id, e }); }));
    entries.sort((a, b) => (a.e.returnedAt < b.e.returnedAt ? 1 : a.e.returnedAt > b.e.returnedAt ? -1 : opsOrder(a.id) - opsOrder(b.id)));
    heading("Operator lock history, " + REPORT_PERIODS[opts.period] + " (" + entries.length + ")");
    if (!entries.length) note("No operator locks were returned in this period.");
    else {
      table(
        [{ title: "Lock", w: 55 }, { title: "Used by", w: 95 }, { title: "Isolation / location", w: 140.28 }, { title: "Taken", w: 65 },
          { title: "Returned", w: 65 }, { title: "Photo", w: 35 }, { title: "Returned by", w: 60 }],
        entries.map(({ id, e }) => [{ text: id, bold: true }, e.usedBy, [e.isolationDesc, e.location].filter(Boolean).join("\n"),
          fmtTime(e.takenAt), e.syncConflict ? "Replaced in sync" : fmtTime(e.returnedAt), e.hadPhoto ? "Yes" : "No", e.returnedBy || ""]));
    }
  }


  /* ---- footers ---- */
  const footY = PDF_PAGE.h - M + 4;
  pdf.pages.forEach((page, i) => {
    pdf.cur = page;
    pdf.line(M, footY - 12, M + CW, footY - 12, C.line, 0.5);
    pdf.text(M, footY, "IbACE: OIM Padlock Report, generated " + fmtTime(generatedAt), { size: 8, color: C.mute });
    const label = "Page " + (i + 1) + " of " + pdf.pages.length;
    pdf.text(M + CW - textWidth(label, 8, false), footY, label, { size: 8, color: C.mute });
  });

  return { pdf, pages: pdf.pages.length };
}

async function makeReport(opts) {
  const generatedAt = nowLocalISO();
  const photoMap = {};
  const images = [];
  let photosFailed = 0;
  if (opts.active && opts.photos !== "none") {
    for (const p of state.padlocks) {
      if (p.status === "available" || !padlockPhotos[p.id]) continue;
      try {
        const img = await preparePhoto(padlockPhotos[p.id], REPORT_PHOTO_EDGE[opts.photos]);
        photoMap[p.id] = Object.assign({ index: images.length }, img);
        images.push(img);
      } catch (err) { console.error(err); photosFailed++; }
    }
  }
  let logo = null;
  try { // the logo comes from the offline cache; the report is still made if it cannot be read
    const res = await fetch("icons/logo-report.jpg");
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const info = jpegInfo(bytes);
      if (info && info.comps === 3) { logo = { index: images.length, bytes, w: info.w, h: info.h }; images.push(logo); }
    }
  } catch (err) { console.warn("Report logo not available", err); }
  const built = buildReportPdf(opts, photoMap, generatedAt, logo);
  images.forEach((img) => built.pdf.addImage(img));
  const bytes = built.pdf.build({
    title: "OIM Padlock Report " + generatedAt.replace("T", " "),
    author: state.operator || "IbACE",
    stamp: generatedAt.replace(/[-T:]/g, "") + "00"
  });
  return {
    bytes, pages: built.pages, photos: images.length - (logo ? 1 : 0), photosFailed,
    name: "OIM_Padlock_Report_" + generatedAt.slice(0, 10) + "_" + generatedAt.slice(11).replace(":", "") + ".pdf"
  };
}

/* ------------------------------ report panel ------------------------------ */
function openReportPanel() {
  const prevFocus = document.activeElement;
  const check = (id, label, hint) => {
    const input = h("input", { type: "checkbox", id });
    input.checked = true;
    return { input, row: h("label", { class: "opt", for: id }, input, h("span", null, label, hint ? h("small", { text: hint }) : null)) };
  };
  const radio = (value, label, hint, checked) => {
    const input = h("input", { type: "radio", name: "rp-photos", id: "rp-photos-" + value, value });
    input.checked = !!checked;
    return { input, row: h("label", { class: "opt", for: "rp-photos-" + value }, input, h("span", null, label, hint ? h("small", { text: hint }) : null)) };
  };

  const active = state.padlocks.filter((p) => p.status !== "available");
  const photoCount = active.filter((p) => padlockPhotos[p.id]).length;
  const sSummary = check("rp-summary", "Summary counts", "Available, issued and locked, by category");
  const sActive = check("rp-active", "Active padlocks", active.length + " issued or locked, with full details");
  const sRegister = check("rp-register", "Full register", "All " + state.padlocks.length + " padlocks in one table");
  const sHistory = check("rp-history", "Return history", "Completed cycles from every padlock");
  const oc = opsCounts();
  const sOps = check("rp-ops", "Operator locks", oc.inuse + " of " + oc.total + " in use, with their history (no photos)");
  const period = h("select", { id: "rp-period", class: "input" },
    ["all", "today", "7", "30"].map((k) => h("option", { value: k }, k === "all" ? "All time" : REPORT_PERIODS[k].charAt(0).toUpperCase() + REPORT_PERIODS[k].slice(1))));
  const photos = [
    radio("none", "No photos", "Smallest file"),
    radio("small", "Small photos", "Thumbnail beside each active padlock", true),
    radio("large", "Large photos", "Full-width photo under each active padlock; bigger file")
  ];

  const errEl = h("p", { class: "dlg-error", role: "alert", hidden: true });
  const createBtn = h("button", { type: "button", class: "btn btn-primary btn-big btn-block", onclick: create }, "Create PDF");
  const body = h("div", { class: "dlg-body" },
    h("fieldset", { class: "optset" }, h("legend", { text: "Include in the report" }),
      sSummary.row, sActive.row, sRegister.row, sHistory.row, sOps.row,
      h("div", { class: "field opt-sub" }, h("label", { for: "rp-period", text: "History period" }), period)),
    h("fieldset", { class: "optset" }, h("legend", { text: "Proof photos (" + photoCount + " available)" }), photos.map((r) => r.row)),
    errEl, createBtn);

  const panel = h("div", { class: "dlg dlg-wide", role: "dialog", "aria-modal": "true", "aria-labelledby": "rp-title" },
    h("div", { class: "dlg-head" },
      h("h2", { id: "rp-title", text: "PDF report" }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    body);
  const overlay = h("div", { class: "overlay overlay-dialog" }, panel);

  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
  function close() {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (prevFocus && document.contains(prevFocus) && prevFocus.focus) prevFocus.focus();
  }
  const syncPeriod = () => { period.disabled = !sHistory.input.checked && !sOps.input.checked; };
  const syncPhotos = () => { photos.forEach((r) => { r.input.disabled = !sActive.input.checked; }); };
  sHistory.input.addEventListener("change", syncPeriod);
  sOps.input.addEventListener("change", syncPeriod);
  sActive.input.addEventListener("change", syncPhotos);

  async function create() {
    const opts = {
      summary: sSummary.input.checked, active: sActive.input.checked, register: sRegister.input.checked, history: sHistory.input.checked, ops: sOps.input.checked,
      period: period.value,
      photos: (photos.find((r) => r.input.checked) || photos[0]).input.value
    };
    errEl.hidden = true;
    if (!opts.summary && !opts.active && !opts.register && !opts.history && !opts.ops) {
      errEl.textContent = "Choose at least one section to include.";
      errEl.hidden = false;
      return;
    }
    createBtn.disabled = true;
    createBtn.textContent = "Creating PDF…";
    try {
      showResult(await makeReport(opts));
    } catch (err) {
      console.error(err);
      createBtn.disabled = false;
      createBtn.textContent = "Create PDF";
      errEl.textContent = "The PDF could not be created. Try again with small photos or no photos.";
      errEl.hidden = false;
    }
  }

  function showResult(report) {
    const makeFile = () => new File([report.bytes], report.name, { type: "application/pdf" });
    let canShare = false;
    try { canShare = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [makeFile()] })); } catch (_) { canShare = false; }
    const kb = report.bytes.length / 1024;
    const sizeText = kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(kb)) + " KB";

    const download = () => {
      const url = URL.createObjectURL(new Blob([report.bytes], { type: "application/pdf" }));
      const a = h("a", { href: url, download: report.name, class: "visually-hidden" });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      toast("Report downloaded", "success");
    };
    const share = async () => {
      try {
        await navigator.share({ files: [makeFile()], title: "OIM Padlock Report" });
        toast("Report shared", "success");
      } catch (err) {
        if (err && err.name === "AbortError") return;
        console.error(err);
        toast("Sharing did not work. Use Download PDF instead.", "error");
      }
    };

    body.replaceChildren(...[
      h("ul", { class: "file-list" }, h("li", null,
        h("strong", { text: report.name }),
        h("span", { text: report.pages + (report.pages === 1 ? " page, " : " pages, ") + report.photos + (report.photos === 1 ? " photo, " : " photos, ") + sizeText }))),
      report.photosFailed ? h("p", { class: "notice notice-warn" }, icon("warn"),
        h("span", { text: report.photosFailed + " photo(s) could not be read and were left out." })) : null,
      canShare ? h("button", { type: "button", class: "btn btn-primary btn-big btn-block", onclick: share }, "Share PDF") : null,
      h("button", { type: "button", class: "btn btn-big btn-block" + (canShare ? "" : " btn-primary"), onclick: download }, "Download PDF"),
      h("p", { class: "hint", text: "The report is a snapshot of this device at the time shown. It is not saved inside IbACE; create it again whenever you need a fresh one." })
    ].filter(Boolean));
    body.querySelector("button").focus();
  }

  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  syncPeriod();
  syncPhotos();
  createBtn.focus();
}
