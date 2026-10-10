'use strict';

/* =====================================================================
   IbACE — Tools tab
   Health Declaration link, the OT calculator, and the twelve engineering
   calculators carried over from Offshore Smart Hub.

   The twelve calculators use the SAME formulas, constants, rounding and
   result wording as Offshore Smart Hub's app.js. They were copied, not
   reviewed: treat every result as an estimate and confirm it before
   acting on it.
   Loaded after sync.js; uses helpers from app.js.
   ===================================================================== */

ICONS.home = '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>';
ICONS.tools = '<path d="M14.5 5.5a4 4 0 0 0 5 5L11 19a2.1 2.1 0 0 1-3-3z"/><path d="M5 5l3 3"/>';
ICONS.back = ICONS.back || '<path d="M15 6l-6 6 6 6"/>';
ICONS.next = '<path d="M9 6l6 6-6 6"/>';
ICONS.link = '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>';

const HEALTH_DECLARATION_URL = "https://osis.petronas.com/health-declaration/form";

/** A dialog with a title, any content, and a close button. Returns { panel, close }. */
function openPanel(title, kids, opts) {
  const o = opts || {}, prevFocus = document.activeElement;
  const panel = h("div", { class: "dlg dlg-wide", role: "dialog", "aria-modal": "true", "aria-labelledby": o.id || "panel-title" },
    h("div", { class: "dlg-head" }, h("h2", { id: o.id || "panel-title", text: title }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => close() }, icon("close"))),
    kids);
  const overlay = h("div", { class: "overlay overlay-dialog" }, panel);
  function onKey(e) { const all = document.querySelectorAll(".overlay-dialog"); if (e.key === "Escape" && all[all.length - 1] === overlay) { e.stopPropagation(); close(); } }
  function close() {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (o.onClose) o.onClose();
    if (prevFocus && document.contains(prevFocus) && prevFocus.focus) prevFocus.focus();
  }
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  panel.querySelector(".icon-btn").focus();
  return { panel, close };
}

/* ------------------------------ the twelve calculators ------------------------------ */
const num = (v) => parseFloat(v);
const sel = (options) => ({ type: "select", options });

const CALCULATORS = [
  {
    id: "volume", title: "1. Volume Conversion",
    fields: [
      { name: "volumeInput", label: "Value" },
      Object.assign({ name: "volumeType", label: "Conversion Type" }, sel([["kld_kbd", "KLD → KBD"], ["kbd_kld", "KBD → KLD"]])),
      { name: "shrinkageFactor", label: "Shrinkage Factor", value: "0.881", step: "0.001" }
    ],
    run(v) {
      const val = num(v.volumeInput), type = v.volumeType, shrinkage = num(v.shrinkageFactor) || 0.881;
      if (isNaN(val)) return "Invalid value";
      let resultWithout, resultWith;
      if (type === "kld_kbd") {
        resultWithout = (val * 6.293 / 1000);
        resultWith = resultWithout * shrinkage;
        return { head: "Results:", lines: ["Without Shrinkage: " + resultWithout.toFixed(4) + " KBD", "With Shrinkage: " + resultWith.toFixed(4) + " KBD"] };
      }
      resultWithout = (val / (6.293 / 1000));
      resultWith = resultWithout / shrinkage;
      return { head: "Results:", lines: ["Without Shrinkage: " + resultWithout.toFixed(4) + " KLD", "With Shrinkage: " + resultWith.toFixed(4) + " KLD"] };
    }
  },
  {
    id: "universal", title: "2. Universal Unit Converter", action: "Convert",
    fields: (() => {
      const units = [["kpa", "kPa"], ["psi", "PSI"], ["bar", "Bar"], ["celsius", "°C"], ["fahrenheit", "°F"], ["inches", "Inches"], ["cm", "cm"], ["feet", "Feet"], ["meters", "Meters"]];
      return [
        Object.assign({ name: "fromUnit", label: "From Unit", value: "kpa" }, sel(units)),
        Object.assign({ name: "toUnit", label: "To Unit", value: "psi" }, sel(units)),
        { name: "universalValue", label: "Value" }
      ];
    })(),
    run(v) {
      const val = num(v.universalValue), fromUnit = v.fromUnit, toUnit = v.toUnit;
      if (isNaN(val)) return "Invalid value";
      if (fromUnit === toUnit) return "Same units selected";
      const conversions = {
        kpa: { psi: 0.145038, bar: 0.01 },
        psi: { kpa: 6.89476, bar: 0.0689476 },
        bar: { kpa: 100, psi: 14.5038 },
        celsius: { fahrenheit: (x) => x * 9 / 5 + 32 },
        fahrenheit: { celsius: (x) => (x - 32) * 5 / 9 },
        inches: { cm: 2.54, feet: 0.0833333, meters: 0.0254 },
        cm: { inches: 0.393701, feet: 0.0328084, meters: 0.01 },
        feet: { inches: 12, cm: 30.48, meters: 0.3048 },
        meters: { inches: 39.3701, cm: 100, feet: 3.28084 }
      };
      const conv = conversions[fromUnit];
      if (!conv || !conv[toUnit]) return "Conversion not available";
      const result = typeof conv[toUnit] === "function" ? conv[toUnit](val) : val * conv[toUnit];
      return { head: "Result:", lines: [val + " " + fromUnit + " = " + result.toFixed(4) + " " + toUnit] };
    }
  },
  {
    id: "gas", title: "3. Gas Flow Conversion", action: "Convert",
    fields: [
      { name: "gasInput", label: "Value" },
      Object.assign({ name: "gasType", label: "Conversion Type" }, sel([["km3_mmscf", "km³/d → mmscf/d"], ["mmscf_km3", "mmscf/d → km³/d"]]))
    ],
    run(v) {
      const val = num(v.gasInput), type = v.gasType;
      if (isNaN(val)) return "Invalid value";
      const result = type === "km3_mmscf" ? val * 0.035373 : val / 0.035373;
      const unit = type === "km3_mmscf" ? "mmscf/d" : "km³/d";
      return { head: "Gas Conversion:", lines: [val + " = " + result.toFixed(4) + " " + unit] };
    }
  },
  {
    id: "dropleak", title: "4. Crude Oil Leak (Drop Rate)",
    fields: [
      { name: "dropRate", label: "Drops per Minute" },
      { name: "dropDuration", label: "Duration (minutes)" },
      Object.assign({ name: "dropSize", label: "Drop Size" }, sel([["0.05", "Small (~0.05ml)"], ["0.1", "Medium (~0.1ml)"], ["0.2", "Large (~0.2ml)"]]))
    ],
    run(v) {
      const dropRate = num(v.dropRate), duration = num(v.dropDuration), dropSize = num(v.dropSize);
      if (isNaN(dropRate) || isNaN(duration)) return "Invalid values";
      const totalDrops = dropRate * duration;
      const totalVolumeL = totalDrops * dropSize / 1000;
      const ratePerHour = dropRate * 60 * dropSize / 1000;
      return { head: "Drop Leak Analysis:", lines: ["Rate: " + ratePerHour.toFixed(3) + " L/hr", "Total Volume: " + totalVolumeL.toFixed(3) + " L", "Total Drops: " + totalDrops.toFixed(0)] };
    }
  },
  {
    id: "gasleak", title: "5. Natural Gas Leak",
    fields: [
      { name: "gasHoleDiameter", label: "Diameter (mm)" },
      { name: "gasPressure", label: "Pressure (bar)" },
      { name: "gasDuration", label: "Duration (min)" },
      { name: "gasTemperature", label: "Temperature (°C)", value: "35" }
    ],
    run(v) {
      const diameter = num(v.gasHoleDiameter), pressure = num(v.gasPressure), duration = num(v.gasDuration), temperature = num(v.gasTemperature) || 35;
      if (isNaN(diameter) || isNaN(pressure) || isNaN(duration)) return "Invalid values";
      const area = Math.PI * Math.pow(diameter / 2000, 2);
      const MW = 20; const R = 8.314; const Z = 0.9; const T = temperature + 273.15;
      const leakRate = 0.3 * area * pressure * 100000 * Math.sqrt(MW / (Z * R * T));
      const totalKg = leakRate * duration * 60;
      return { head: "Gas Leak Analysis:", lines: ["Leak Rate: " + leakRate.toFixed(4) + " kg/s", "Total Amount: " + totalKg.toFixed(2) + " kg", "Duration: " + duration + " minutes"] };
    }
  },
  {
    id: "oilleak", title: "6. Crude Oil Leak (Pin Hole)",
    fields: [
      { name: "oilHoleDiameter", label: "Diameter (mm)" },
      { name: "oilPressure", label: "Pressure (bar)" },
      { name: "oilDuration", label: "Duration (min)" },
      { name: "oilDensity", label: "Density (kg/m³)", value: "700" }
    ],
    run(v) {
      const diameter = num(v.oilHoleDiameter), pressure = num(v.oilPressure), duration = num(v.oilDuration), density = num(v.oilDensity) || 700;
      if (isNaN(diameter) || isNaN(pressure) || isNaN(duration)) return "Invalid values";
      const radius = diameter / 2;
      const areaCm2 = Math.PI * Math.pow(radius / 10, 2);
      const deltaP = pressure - 1.01325;
      const leakRate = 0.044721 * 0.62 * areaCm2 * Math.sqrt(density * deltaP);
      const totalKg = leakRate * duration * 60;
      const totalLiters = totalKg / density * 1000;
      let classification = "Below Threshold", tone = "ok";
      if (totalKg >= 2000) { classification = "Tier 1 - Major"; tone = "bad"; }
      else if (totalKg >= 200) { classification = "Tier 2 - Reportable"; tone = "warn"; }
      else if (totalKg >= 100) { classification = "Minor Reportable"; tone = "info"; }
      else if (totalLiters >= 10) { classification = "Reportable (≥10L)"; tone = "info"; }
      return { head: "Oil Leak Analysis:", lines: ["Leak Rate: " + leakRate.toFixed(4) + " kg/s", "Total Amount: " + totalKg.toFixed(2) + " kg (" + totalLiters.toFixed(2) + " L)", "Duration: " + duration + " minutes"],
        flag: { label: "Classification:", text: classification, tone } };
    }
  },
  {
    id: "prodloss", title: "7. Production Volume Loss",
    fields: [
      { name: "shutdownHours", label: "Shutdown Hours", value: "0" },
      { name: "shutdownMinutes", label: "Shutdown Minutes", value: "0" },
      { name: "normalProduction", label: "Normal Production (KBD)" }
    ],
    run(v) {
      const hours = num(v.shutdownHours) || 0, minutes = num(v.shutdownMinutes) || 0, production = num(v.normalProduction);
      if (isNaN(production)) return "Invalid production rate";
      const totalHours = hours + minutes / 60;
      const lostBarrels = production * totalHours / 24;
      return { head: "Production Loss:", lines: ["Duration: " + hours + "h " + minutes + "m", "Volume Lost: " + lostBarrels.toFixed(2) + " barrels"] };
    }
  },
  {
    id: "chemical", title: "8. Chemical Injection Rate",
    fields: [
      { name: "injectionRate", label: "Injection Rate (L/hr)" },
      { name: "chemPPM", label: "Concentration (PPM)" },
      Object.assign({ name: "drumSize", label: "Drum Size", redraw: true }, sel([["159", "159L Drum"], ["210", "210L Drum"], ["259", "259L Drum"], ["custom", "Custom Size"]])),
      { name: "customDrumSize", label: "Custom Drum Size (L)", when: (v) => v.drumSize === "custom" }
    ],
    run(v) {
      const rate = num(v.injectionRate), ppm = num(v.chemPPM), drumType = v.drumSize;
      if (isNaN(rate) || isNaN(ppm)) return "Invalid values";
      const drumSize = drumType === "custom" ? num(v.customDrumSize) : num(drumType);
      if (isNaN(drumSize)) return "Invalid drum size";
      const dailyVolume = rate * 24;
      const weeklyVolume = dailyVolume * 7;
      const drumsNeeded = Math.ceil(weeklyVolume / drumSize);
      return { head: "Chemical Injection:", lines: ["Daily: " + dailyVolume.toFixed(1) + " L/day", "Weekly: " + weeklyVolume.toFixed(1) + " L/week", "Drums Needed: " + drumsNeeded + " x " + drumSize + "L"] };
    }
  },
  {
    id: "dropobject", title: "9. Drop Object Calculator",
    fields: [
      { name: "objectWeight", label: "Object Weight (kg)" },
      { name: "dropHeight", label: "Drop Height (m)" },
      Object.assign({ name: "ppeLevel", label: "PPE Level", redraw: true }, sel([["1", "Basic (Hard Hat)"], ["0.7", "Enhanced (+ Safety Vest)"], ["0.5", "Full PPE"], ["custom", "Custom Factor"]])),
      { name: "customPPEFactor", label: "Custom PPE Factor", step: "0.1", when: (v) => v.ppeLevel === "custom" }
    ],
    run(v) {
      const weight = num(v.objectWeight), height = num(v.dropHeight), ppeSelection = v.ppeLevel;
      if (isNaN(weight) || isNaN(height)) return "Invalid values";
      let ppe;
      if (ppeSelection === "custom") { ppe = num(v.customPPEFactor); if (isNaN(ppe)) return "Enter custom PPE factor"; }
      else ppe = num(ppeSelection);
      const energy = weight * 9.81 * height;
      const adjustedEnergy = energy * ppe;
      let riskLevel, tone;
      if (adjustedEnergy < 50) { riskLevel = "Low Risk"; tone = "ok"; }
      else if (adjustedEnergy < 200) { riskLevel = "Medium Risk"; tone = "warn"; }
      else if (adjustedEnergy < 500) { riskLevel = "High Risk"; tone = "bad"; }
      else { riskLevel = "Fatal Risk"; tone = "bad"; }
      return { head: "Drop Object:", lines: ["Impact Energy: " + energy.toFixed(0) + " J", "With PPE: " + adjustedEnergy.toFixed(0) + " J"], flag: { label: "", text: "Risk: " + riskLevel, tone } };
    }
  },
  {
    id: "crane", title: "10. Crane Lifting Calculator",
    fields: [
      { name: "loadWeight", label: "Load Weight (tonnes)" },
      { name: "boomLength", label: "Boom Length (m)" },
      // option keys are unique so two cranes with the same capacity can both be listed; the capacity is the number before the colon
      Object.assign({ name: "craneType", label: "Crane Type", redraw: true }, sel([["40:iba450", "40T (IbA - ME 450)"], ["9:iba400", "9T (IbA - ME 400)"], ["13:ibb290", "13T (IbB - ME 290)"], ["13:ibc290", "13T (IbC - ME 290)"], ["custom", "Custom Capacity"]])),
      { name: "customCraneCapacity", label: "Custom Capacity (tonnes)", when: (v) => v.craneType === "custom" }
    ],
    run(v) {
      const load = num(v.loadWeight), boom = num(v.boomLength), craneType = v.craneType;
      if (isNaN(load) || isNaN(boom)) return "Invalid values";
      let capacity;
      if (craneType === "custom") { capacity = num(v.customCraneCapacity); if (isNaN(capacity)) return "Invalid crane capacity"; }
      else capacity = num(craneType);
      const capacityAtBoom = capacity * (20 / boom);
      const safeLoad = capacityAtBoom * 0.8;
      const safe = load <= safeLoad;
      return { head: "Crane Analysis:", lines: ["Capacity at " + boom + "m: " + capacityAtBoom.toFixed(1) + "T", "Safe Load: " + safeLoad.toFixed(1) + "T"], flag: { label: "Status:", text: safe ? "SAFE" : "UNSAFE", tone: safe ? "ok" : "bad" } };
    }
  },
  {
    id: "fuel", title: "11. Fuel Consumption",
    fields: [
      Object.assign({ name: "turbineType", label: "Turbine Type", redraw: true }, sel([["saturn20", "Saturn 20 (1.2MW)"], ["centaur40", "Centaur 40 (4.0MW)"], ["centaur50", "Centaur 50 (5.0MW)"], ["taurus60", "Taurus 60 (4.8MW)"],
        ["taurus70", "Taurus 70 (7.7MW)"], ["mars90", "Mars 90 (9.8MW)"], ["mars100", "Mars 100 (12MW)"], ["titan130", "Titan 130 (13.5MW)"], ["rb211", "RB211"], ["kongsberg", "Kongsberg Engine"], ["custom", "Custom Turbine"]])),
      { name: "customTurbineRate", label: "Custom Fuel Rate (L/hr)", when: (v) => v.turbineType === "custom" },
      { name: "turbineLoad", label: "Load Percentage (%)" },
      { name: "operatingHours", label: "Operating Hours" }
    ],
    run(v) {
      const type = v.turbineType, load = num(v.turbineLoad), hours = num(v.operatingHours);
      if (isNaN(load) || isNaN(hours)) return "Invalid values";
      let baseRate;
      if (type === "custom") { baseRate = num(v.customTurbineRate); if (isNaN(baseRate)) return "Enter fuel rate"; }
      else {
        const baseConsumption = { saturn20: 320, centaur40: 1100, centaur50: 1380, taurus60: 1320, taurus70: 2100, mars90: 2700, mars100: 3300, titan130: 3700, rb211: 2500, kongsberg: 2200 };
        baseRate = baseConsumption[type];
      }
      const consumption = baseRate * load / 100 * hours / 24;
      return { head: "Fuel Consumption:", lines: ["Base Rate: " + baseRate + " L/hr", "Load: " + load + "% for " + hours + "hrs", "Required: " + consumption.toFixed(1) + " L/day"] };
    }
  },
  {
    id: "weather", title: "12. Weather Impact",
    fields: [
      { name: "windSpeed", label: "Wind Speed (knots)" },
      { name: "waveHeight", label: "Wave Height (m)" },
      Object.assign({ name: "operationType", label: "Operation Type", redraw: true }, sel([["heli", "Helicopter Ops"], ["boat", "Boat Transfer"], ["crane", "Crane Operations"], ["diving", "Diving Operations"], ["custom", "Custom Operation"]])),
      { name: "customWindLimit", label: "Custom Wind Limit (knots)", when: (v) => v.operationType === "custom" },
      { name: "customWaveLimit", label: "Custom Wave Limit (m)", when: (v) => v.operationType === "custom" }
    ],
    run(v) {
      const wind = num(v.windSpeed), wave = num(v.waveHeight), operation = v.operationType;
      if (isNaN(wind) || isNaN(wave)) return "Invalid values";
      let limit;
      if (operation === "custom") {
        const customWind = num(v.customWindLimit), customWave = num(v.customWaveLimit);
        if (isNaN(customWind) || isNaN(customWave)) return "Enter limits";
        limit = { wind: customWind, wave: customWave };
      } else {
        const limits = { heli: { wind: 35, wave: 3 }, boat: { wind: 25, wave: 2.5 }, crane: { wind: 20, wave: 2 }, diving: { wind: 15, wave: 1.5 } };
        limit = limits[operation];
      }
      const windOk = wind <= limit.wind, waveOk = wave <= limit.wave;
      return { head: "Weather Impact:", lines: ["Wind: " + wind + " kts (" + limit.wind + ") " + (windOk ? "OK" : "EXCEED"), "Wave: " + wave + " m (" + limit.wave + ") " + (waveOk ? "OK" : "EXCEED")] };
    }
  }
];

/* ------------------------------ OT calculator ------------------------------ */
/* Two ways of working out overtime, chosen by the person:
   Staff      hourly rate = (12 x monthly wages) / (52 x Y), Y = 39 or 42 working hours a week;
              overtime at 1.5 times; wages above RM4,000 are counted as RM4,000.
   Non-staff  Employment Act 1955: hourly rate = monthly salary / 26 / 8;
              normal day x1.5, rest day x2, public holiday x3. */
const OT_STAFF_CEILING = 4000;
const OT_CALCULATOR = {
  id: "ot", title: "OT calculator",
  note: "Staff: hourly rate = (12 \u00d7 monthly wages) \u00f7 (52 \u00d7 weekly hours), paid at 1.5 times, with wages above RM4,000 counted as RM4,000. Enter whole hours: when the month's overtime is totalled, a balance of more than 15 minutes counts as one hour. Non-staff: hourly rate = monthly salary \u00f7 26 \u00f7 8, paid at 1.5 times on a normal day, 2 times on a rest day and 3 times on a public holiday. Your figures are kept on this phone only. This is an estimate; your payslip decides the real figure.",
  fields: [
    { name: "type", label: "I am", type: "select", redraw: true, options: [["staff", "Staff"], ["nonstaff", "Non-staff (Employment Act)"]] },
    { name: "salary", label: "Monthly wages (RM)", step: "0.01" },
    { name: "weekHours", label: "Working hours per week", type: "select", options: [["42", "42 hours"], ["39", "39 hours"]], when: (v) => v.type === "staff" },
    { name: "hours", label: "Overtime hours", value: "0", step: "1", when: (v) => v.type === "staff" },
    { name: "normal", label: "OT hours, normal day", value: "0", step: "0.5", when: (v) => v.type !== "staff" },
    { name: "rest", label: "OT hours, rest day", value: "0", step: "0.5", when: (v) => v.type !== "staff" },
    { name: "holiday", label: "OT hours, public holiday", value: "0", step: "0.5", when: (v) => v.type !== "staff" }
  ],
  run(v) {
    const salary = num(v.salary), rm = (x) => "RM " + x.toFixed(2);
    if (isNaN(salary) || salary <= 0) return "Enter your monthly wages";
    if (v.type === "staff") {
      const y = v.weekHours === "39" ? 39 : 42, hours = num(v.hours) || 0;
      if (hours < 0) return "Hours cannot be negative";
      const counted = Math.min(salary, OT_STAFF_CEILING);
      const rate = (12 * counted) / (52 * y);
      const lines = ["Hourly rate: " + rm(rate) + " (12 \u00d7 " + rm(counted) + " \u00f7 (52 \u00d7 " + y + "))", hours + " h at 1.5: " + rm(hours * rate * 1.5)];
      if (salary > OT_STAFF_CEILING) lines.unshift("Wages above RM4,000 are counted as RM4,000.");
      return { head: "Overtime estimate, staff:", lines, flag: { label: "Total:", text: rm(hours * rate * 1.5), tone: "info" } };
    }
    const n = num(v.normal) || 0, r = num(v.rest) || 0, p = num(v.holiday) || 0;
    if (n < 0 || r < 0 || p < 0) return "Hours cannot be negative";
    const rate = salary / 26 / 8;
    const a = n * rate * 1.5, b = r * rate * 2, c = p * rate * 3;
    return { head: "Overtime estimate, non-staff:", lines: ["Hourly rate: " + rm(rate), "Normal day, " + n + " h at 1.5: " + rm(a), "Rest day, " + r + " h at 2: " + rm(b), "Public holiday, " + p + " h at 3: " + rm(c)],
      flag: { label: "Total:", text: rm(a + b + c), tone: "info" } };
  }
};

/* ------------------------------ one calculator, in a dialog ------------------------------ */
function openCalculator(calc) {
  const values = {};
  calc.fields.forEach((f) => { values[f.name] = f.value != null ? f.value : f.type === "select" ? f.options[0][0] : ""; });
  if (calc.id === "ot" && me.ot) ["salary", "type", "weekHours"].forEach((k) => { if (me.ot[k]) values[k] = me.ot[k]; }); // me.js
  const body = h("div", { class: "dlg-body" }), result = h("div", { class: "calc-result", id: "calc-result", role: "status", hidden: true });
  const read = () => { body.querySelectorAll("[data-f]").forEach((el) => { values[el.getAttribute("data-f")] = el.value; }); };
  const draw = () => {
    body.replaceChildren(...calc.fields.filter((f) => !f.when || f.when(values)).map((f) => {
      const id = "calc-" + f.name;
      let el;
      if (f.type === "select") {
        el = h("select", { id, class: "input", "data-f": f.name }, f.options.map(([value, label]) => h("option", { value }, label)));
        if (f.redraw) el.addEventListener("change", () => { read(); draw(); });
      } else el = h("input", { id, class: "input", type: "number", step: f.step || "any", inputmode: "decimal", "data-f": f.name, autocomplete: "off" });
      el.value = values[f.name];
      return h("div", { class: "field" }, h("label", { for: id, text: f.label }), el);
    }));
  };
  draw();
  function calculate(e) {
    e.preventDefault();
    read();
    const out = calc.run(values);
    if (typeof out === "string") { result.hidden = true; toast(out, "error"); return; }
    if (calc.id === "ot") meSaveOt(values); // me.js: remembered on this phone only
    result.replaceChildren(...[h("strong", { text: out.head })].concat(out.lines.map((l) => h("p", { text: l })),
      out.flag ? [h("p", { class: "calc-flag is-" + out.flag.tone }, out.flag.label ? h("span", { text: out.flag.label + " " }) : null, h("strong", { text: out.flag.text }))] : []));
    result.hidden = false;
    buzz("ok");
    result.scrollIntoView({ block: "nearest" });
  }
  const form = h("form", { class: "calc-form", novalidate: true, onsubmit: calculate }, body,
    h("button", { type: "submit", class: "btn btn-primary btn-block", id: "calc-run" }, calc.action || "Calculate"), result,
    h("p", { class: "hint", text: calc.note || "An estimate from the same formula as Offshore Smart Hub. Confirm it before you act on it." }));
  openPanel(calc.title, form, { id: "calc-title" });
}

/* ------------------------------ screen ------------------------------ */
let toolsShowCalcs = false;
function toolsRender() {
  const root = $("#view-tools");
  if (!root) return;
  const card = (o) => h(o.href ? "a" : "button", Object.assign({ class: "tcard" + (o.open ? " is-open" : ""), id: o.id },
    o.href ? { href: o.href, target: "_blank", rel: "noopener noreferrer" } : { type: "button", onclick: o.onclick, "aria-expanded": o.open == null ? null : String(o.open) }),
    h("span", { class: "tcard-icon", "aria-hidden": "true" }, icon(o.icon)), h("strong", { text: o.title }), h("span", { class: "tcard-sub", text: o.sub }));
  const calcCard = (calc) => { const m = /^(\d+)\.\s*(.*)$/.exec(calc.title); return h("button", { type: "button", class: "tcard tcard-calc", id: "tool-" + calc.id, onclick: () => openCalculator(calc) },
    h("span", { class: "tcard-num", "aria-hidden": "true", text: m ? m[1] : "" }), h("strong", { text: m ? m[2] : calc.title })); };
  root.replaceChildren(...[
    h("div", { class: "tcards tcards-main" },
      card({ id: "tool-health", icon: "link", title: "Health Declaration", sub: "Opens in the browser. Needs internet.", href: HEALTH_DECLARATION_URL }),
      card({ id: "tool-ot", icon: "clock", title: "OT calculator", sub: "Staff or non-staff", onclick: () => openCalculator(OT_CALCULATOR) }),
      card({ id: "tool-calcs", icon: "tools", title: "Calculators", sub: toolsShowCalcs ? "Tap to hide" : CALCULATORS.length + " engineering calculators", open: toolsShowCalcs, onclick: () => { toolsShowCalcs = !toolsShowCalcs; toolsRender(); } })),
    toolsShowCalcs ? h("h2", { class: "tools-head", text: "Calculators" }) : null,
    toolsShowCalcs ? h("div", { class: "tcards", id: "tool-list" }, CALCULATORS.map(calcCard)) : null,
    toolsShowCalcs ? h("p", { class: "hint tools-note", text: "The calculators give estimates. Confirm a result before you act on it." }) : null
  ].filter(Boolean));
}
