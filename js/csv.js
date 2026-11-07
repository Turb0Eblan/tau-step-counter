/*
 * Reading ImageJ / Fiji "Multi Measure" tables and the labels CSV.
 */
(function (root) {
  "use strict";

  function splitLine(line, sep) {
    if (line.indexOf('"') === -1) return line.split(sep);
    const out = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === sep) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }

  function parseTable(text) {
    const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
    if (lines.length === 0) return { header: [], rows: [] };
    // ImageJ writes commas into .csv and tabs into .xls / .txt
    const first = lines[0];
    const sep = first.split("\t").length > first.split(",").length ? "\t" : ",";
    const header = splitLine(first, sep).map((h) => h.trim());
    const rows = lines.slice(1).map((l) => splitLine(l, sep));
    return { header, rows };
  }

  function toNumber(s) {
    if (s === undefined) return NaN;
    const t = String(s).trim();
    if (t === "" || /^nan$/i.test(t)) return NaN;
    const v = Number(t);
    return Number.isFinite(v) ? v : NaN;
  }

  /*
   * Returns { frames, rois: [{ name, frames, y }], source }.
   * Same rules as the Python script: intensity columns start with "Mean",
   * the first column is the frame axis if it is fully numeric.
   */
  function parseTraces(text) {
    const { header, rows } = parseTable(text);
    const meanIdx = [];
    header.forEach((h, i) => { if (h.startsWith("Mean")) meanIdx.push(i); });
    if (meanIdx.length === 0) {
      throw new Error("No ROI columns found. Expected columns named Mean(1), Mean(2), ... as exported by ImageJ Multi Measure.");
    }
    if (rows.length === 0) throw new Error("The file has a header but no data rows.");

    let frames = rows.map((r) => toNumber(r[0]));
    if (!frames.every(Number.isFinite)) frames = rows.map((_, i) => i + 1);

    const labelIdx = header.indexOf("Label");
    const source = labelIdx >= 0 && rows[0][labelIdx] ? rows[0][labelIdx].trim() : "";

    const rois = meanIdx.map((col) => {
      const xs = [];
      const ys = [];
      for (let r = 0; r < rows.length; r++) {
        const v = toNumber(rows[r][col]);
        if (Number.isFinite(v) && Number.isFinite(frames[r])) {
          xs.push(frames[r]);
          ys.push(v);
        }
      }
      return { name: header[col], frames: Float64Array.from(xs), y: Float64Array.from(ys) };
    });
    return { rois, source, nFrames: rows.length };
  }

  /* Labels file written by this app or by python/parse_tau.py */
  function parseLabels(text) {
    const { header, rows } = parseTable(text);
    const col = (n) => header.indexOf(n);
    const iRoi = col("roi_column");
    const iLab = col("label");
    if (iRoi < 0 || iLab < 0) throw new Error("This does not look like a labels file (needs roi_column and label columns).");
    const iW = col("tv_weight");
    const iS = col("noise_std");
    const iN = col("n_points");
    const out = new Map();
    for (const r of rows) {
      const name = (r[iRoi] || "").trim();
      if (!name) continue;
      out.set(name, {
        label: (r[iLab] || "").trim(),
        tv_weight: iW >= 0 ? toNumber(r[iW]) : NaN,
        noise_std: iS >= 0 ? toNumber(r[iS]) : NaN,
        n_points: iN >= 0 ? toNumber(r[iN]) : NaN,
      });
    }
    return out;
  }

  function fmt(v) {
    if (!Number.isFinite(v)) return "";
    return String(Math.round(v * 1e6) / 1e6);
  }

  function field(s) {
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* Same columns and rounding as the Python script, so files are interchangeable. */
  function writeLabels(order, labels) {
    const lines = ["roi_column,label,tv_weight,noise_std,n_points"];
    for (const name of order) {
      const l = labels.get(name);
      if (!l) continue;
      lines.push([field(name), field(l.label), fmt(l.tv_weight), fmt(l.noise_std), Number.isFinite(l.n_points) ? l.n_points : ""].join(","));
    }
    return lines.join("\n") + "\n";
  }

  const api = { parseTable, parseTraces, parseLabels, writeLabels };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CSV = api;
})(typeof window !== "undefined" ? window : globalThis);
