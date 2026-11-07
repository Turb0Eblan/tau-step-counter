/*
 * Tau Step Counter: app logic and the little window manager.
 */
(function () {
  "use strict";

  const REPO_URL = "https://github.com/Turb0Eblan/tau-step-counter";
  const SAMPLE_URL = "examples/Frame1_IntensityTraces_film_3.csv";
  const DEFAULTS = { mult: 1.5, minWeight: 1.0, maxIter: 200 };
  const LABEL_TEXT = { m: "M", d: "D", "d+": "D+", too_short: "too short" };

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  // ------------------------------------------------------------------
  // storage (best effort: private windows may refuse it)

  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    },
    del(key) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
  };

  // ------------------------------------------------------------------
  // state

  const state = {
    file: null,       // display name
    source: "",       // .tif name from the Label column
    rois: [],
    labels: new Map(),
    history: [],
    index: 0,
    cache: new Map(),
    settings: Object.assign({}, DEFAULTS, store.get("tsc:settings") || {}),
  };

  const plot = new Plot($("#plot"));

  const storageKey = () => `tsc:labels:${state.file}:${state.rois.length}`;
  const saveLabels = () => store.set(storageKey(), { labels: [...state.labels], index: state.index });

  function processed(roi) {
    let p = state.cache.get(roi.name);
    if (!p) {
      const s = state.settings;
      const noise = Signal.estimateNoiseStd(roi.y);
      const weight = Math.max(s.mult * noise, s.minWeight);
      const filt = Signal.tvDenoise(roi.y, weight, 1e-6, s.maxIter);
      p = { noise, weight, filt };
      state.cache.set(roi.name, p);
    }
    return p;
  }

  // ------------------------------------------------------------------
  // loading

  function loadTraces(text, fileName) {
    let parsed;
    try {
      parsed = CSV.parseTraces(text);
    } catch (err) {
      msgBox({ title: "Cannot open file", icon: "error", text: `<b>${esc(fileName)}</b><br><br>${esc(err.message)}` });
      return;
    }

    state.file = fileName;
    state.source = parsed.source;
    state.rois = parsed.rois;
    state.labels = new Map();
    state.history = [];
    state.cache.clear();
    state.index = 0;

    const saved = store.get(storageKey());
    let restored = 0;
    if (saved && Array.isArray(saved.labels)) {
      const names = new Set(state.rois.map((r) => r.name));
      for (const [k, v] of saved.labels) if (names.has(k)) state.labels.set(k, v);
      restored = state.labels.size;
    }

    // same as the Python script: traces with fewer than 3 points are not shown
    for (const roi of state.rois) {
      if (roi.y.length < 3 && !state.labels.has(roi.name)) {
        state.labels.set(roi.name, { label: "too_short", tv_weight: NaN, noise_std: NaN, n_points: roi.y.length });
      }
    }

    buildList();
    setHasData(true);
    $("#empty-state").hidden = true;
    $("#status-file").textContent = fileName;
    $("#main-title").textContent = `${fileName} - Tau Step Counter`;
    $("#task-title").textContent = fileName;
    restoreMain();

    const first = nextUnlabeled(-1);
    show(first >= 0 ? first : 0);

    const what = `${state.rois.length} ROIs, ${parsed.nFrames} frames`;
    if (restored) balloon("Session restored", `${what}. ${restored} labels from your last visit were kept.`);
    else balloon("File opened", `${what}${state.source ? " from " + state.source : ""}.`);
    status(`Opened ${fileName}`);
  }

  function readFile(file, then) {
    const r = new FileReader();
    r.onload = () => then(String(r.result), file.name);
    r.onerror = () => msgBox({ title: "Cannot open file", icon: "error", text: "The file could not be read." });
    r.readAsText(file);
  }

  async function loadSample() {
    status("Loading sample...");
    try {
      const res = await fetch(SAMPLE_URL);
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      loadTraces(await res.text(), "Frame1_IntensityTraces_film_3.csv");
    } catch (err) {
      status("Ready");
      msgBox({
        title: "Sample not available",
        icon: "warn",
        text: "The browser blocked loading the sample file. This happens when index.html is opened straight from disk.<br><br>" +
              "Open <b>examples/Frame1_IntensityTraces_film_3.csv</b> with File &rsaquo; Open instead, or use the online version.",
      });
    }
  }

  function importLabels(text, fileName) {
    let map;
    try {
      map = CSV.parseLabels(text);
    } catch (err) {
      msgBox({ title: "Cannot import labels", icon: "error", text: esc(err.message) });
      return;
    }
    const names = new Set(state.rois.map((r) => r.name));
    let n = 0;
    for (const [k, v] of map) if (names.has(k)) { state.labels.set(k, v); n++; }
    state.history = [];
    saveLabels();
    refreshList();
    show(state.index);
    const skipped = map.size - n;
    balloon("Labels imported", `${n} labels taken from ${fileName}.` + (skipped ? ` ${skipped} did not match any ROI here.` : ""));
  }

  // ------------------------------------------------------------------
  // view

  function buildList() {
    const tb = $("#roi-list tbody");
    tb.innerHTML = "";
    const frag = document.createDocumentFragment();
    state.rois.forEach((roi, i) => {
      const tr = document.createElement("tr");
      tr.dataset.i = i;
      tr.innerHTML = `<td>${esc(roi.name)}</td><td></td>`;
      frag.appendChild(tr);
    });
    tb.appendChild(frag);
    refreshList();
  }

  function labelClass(l) {
    return l === "m" ? "lbl-m" : l === "d" ? "lbl-d" : l === "d+" ? "lbl-dp" : "lbl-x";
  }

  function refreshRow(i) {
    const tr = $(`#roi-list tbody tr[data-i="${i}"]`);
    if (!tr) return;
    const l = state.labels.get(state.rois[i].name);
    const td = tr.children[1];
    td.textContent = l ? LABEL_TEXT[l.label] || l.label : "";
    td.className = l ? labelClass(l.label) : "";
  }

  function refreshList() {
    state.rois.forEach((_, i) => refreshRow(i));
    refreshSummary();
  }

  function refreshSummary() {
    const c = { m: 0, d: 0, "d+": 0 };
    for (const l of state.labels.values()) if (l.label in c) c[l.label]++;
    const counted = c.m + c.d + c["d+"];
    const total = state.rois.length;
    const done = state.labels.size;
    const rows = [["M", "m", "bar-m"], ["D", "d", "bar-d"], ["D+", "d+", "bar-dp"]];
    $("#summary-bars").innerHTML = rows.map(([t, k, cls]) => {
      const pct = counted ? (100 * c[k]) / counted : 0;
      return `<div class="bar-row ${cls}"><span>${t}</span><span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span>` +
             `<span class="n">${c[k]} (${pct.toFixed(0)}%)</span></div>`;
    }).join("");
    $("#progress-fill").style.width = total ? `${(100 * done) / total}%` : "0";
    $("#summary-line").textContent = total ? `${done} of ${total} labeled` : "No file loaded";
  }

  function show(i) {
    if (!state.rois.length) return;
    i = Math.max(0, Math.min(state.rois.length - 1, i));
    state.index = i;
    const roi = state.rois[i];

    $$("#roi-list tr.current").forEach((tr) => tr.classList.remove("current"));
    const tr = $(`#roi-list tbody tr[data-i="${i}"]`);
    if (tr) {
      tr.classList.add("current");
      tr.scrollIntoView({ block: "nearest" });
    }

    const saved = state.labels.get(roi.name);
    $$(".label-group [data-label]").forEach((b) => b.classList.toggle("chosen", !!saved && b.dataset.label === saved.label));

    if (roi.y.length < 3) {
      plot.setData(null);
      plot.draw();
      $("#info-noise").textContent = "-";
      $("#info-weight").textContent = "-";
    } else {
      const p = processed(roi);
      plot.setData({ x: roi.frames, raw: roi.y, filt: p.filt, title: roi.name });
      $("#info-noise").textContent = p.noise.toFixed(2);
      $("#info-weight").textContent = p.weight.toFixed(2);
    }
    $("#info-n").textContent = roi.y.length;
    $("#info-label").textContent = saved ? LABEL_TEXT[saved.label] || saved.label : "not yet";
    posStatus();
    saveLabels();
  }

  function posStatus() {
    $("#status-pos").textContent = state.rois.length ? `ROI ${state.index + 1} of ${state.rois.length}` : " ";
  }

  plot.onHover = (h) => {
    if (!h) return posStatus();
    $("#status-pos").textContent = `Frame ${h.frame}   raw ${h.raw.toFixed(1)}   TV ${h.filt.toFixed(1)}`;
  };

  function nextUnlabeled(from) {
    const n = state.rois.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (!state.labels.has(state.rois[i].name)) return i;
    }
    return -1;
  }

  // ------------------------------------------------------------------
  // actions

  function setLabel(label) {
    if (!state.rois.length) return;
    const roi = state.rois[state.index];
    if (roi.y.length < 3) return;
    const p = processed(roi);
    state.history.push({ name: roi.name, index: state.index, prev: state.labels.get(roi.name) || null });
    state.labels.set(roi.name, {
      label,
      tv_weight: Math.round(p.weight * 1e6) / 1e6,
      noise_std: Math.round(p.noise * 1e6) / 1e6,
      n_points: roi.y.length,
    });
    refreshRow(state.index);
    refreshSummary();
    status(`${roi.name} saved as ${LABEL_TEXT[label]}`);

    const next = nextUnlabeled(state.index);
    if (next < 0) {
      show(state.index);
      balloon("All done", "Every ROI has a label. Use File › Export labels to save the CSV.");
    } else {
      show(next);
    }
  }

  function undo() {
    const h = state.history.pop();
    if (!h) { status("Nothing to undo"); return; }
    if (h.prev) state.labels.set(h.name, h.prev);
    else state.labels.delete(h.name);
    refreshRow(h.index);
    refreshSummary();
    show(h.index);
    status(`Undid label for ${h.name}`);
  }

  function exportLabels() {
    if (!state.rois.length) return;
    const text = CSV.writeLabels(state.rois.map((r) => r.name), state.labels);
    const blob = new Blob([text], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "roi_classification.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    status(`Exported ${state.labels.size} labels`);
  }

  async function resetLabels() {
    const ok = await msgBox({
      title: "Clear all labels",
      icon: "warn",
      text: `Remove all ${state.labels.size} labels for <b>${esc(state.file)}</b>?<br>This cannot be undone. Export first if you want to keep them.`,
      buttons: [{ label: "Yes", value: true }, { label: "No", value: false, default: true }],
    });
    if (!ok) return;
    state.labels.clear();
    state.history = [];
    for (const roi of state.rois) {
      if (roi.y.length < 3) state.labels.set(roi.name, { label: "too_short", tv_weight: NaN, noise_std: NaN, n_points: roi.y.length });
    }
    refreshList();
    show(0);
    status("All labels cleared");
  }

  function openOptions() {
    const f = $("#options-form");
    for (const k of Object.keys(DEFAULTS)) f.elements[k].value = state.settings[k];
    openDialog("#dlg-options");
    f.elements.mult.focus();
    f.elements.mult.select();
  }

  $("#options-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const next = {
      mult: parseFloat(f.elements.mult.value),
      minWeight: parseFloat(f.elements.minWeight.value),
      maxIter: parseInt(f.elements.maxIter.value, 10),
    };
    if (!(next.mult > 0) || !(next.minWeight >= 0) || !(next.maxIter >= 1)) {
      msgBox({ title: "Filter Options", icon: "error", text: "Please enter positive numbers." });
      return;
    }
    state.settings = next;
    store.set("tsc:settings", next);
    state.cache.clear();
    closeDialog($("#dlg-options"));
    if (state.rois.length) show(state.index);
    status(`Filter: weight = max(${next.mult} × σ, ${next.minWeight}), ${next.maxIter} iterations`);
  });

  function setHasData(on) {
    $$("[data-needs-data]").forEach((el) => { el.disabled = !on; });
  }

  // ------------------------------------------------------------------
  // window manager

  let zTop = 10;

  function focusWindow(win) {
    $$(".window").forEach((w) => w.classList.toggle("inactive", w !== win));
    win.style.zIndex = ++zTop;
  }

  function openDialog(sel) {
    const win = typeof sel === "string" ? $(sel) : sel;
    win.hidden = false;
    const d = $("#desktop").getBoundingClientRect();
    const r = win.getBoundingClientRect();
    win.style.left = `${Math.max(0, (d.width - r.width) / 2)}px`;
    win.style.top = `${Math.max(0, (d.height - r.height) / 2.4)}px`;
    focusWindow(win);
    return win;
  }

  function closeDialog(win) {
    win.hidden = true;
    const open = $$(".window.dialog:not([hidden])");
    focusWindow(open.length ? open[open.length - 1] : $("#main-window"));
    if (win.id === "dlg-msg" && win._resolve) {
      const r = win._resolve;
      win._resolve = null;
      r(win._value);
    }
  }

  function topDialog() {
    const open = $$(".window.dialog:not([hidden])");
    open.sort((a, b) => (+b.style.zIndex || 0) - (+a.style.zIndex || 0));
    return open[0] || null;
  }

  function msgBox({ title, text, icon = "info", buttons = [{ label: "OK", value: true, default: true }] }) {
    const win = $("#dlg-msg");
    $("#msg-title").textContent = title;
    $("#msg-text").innerHTML = text;
    $("#msg-icon use").setAttribute("href", `#i-${icon}`);
    const box = $("#msg-buttons");
    box.innerHTML = "";
    let def = null;
    for (const b of buttons) {
      const el = document.createElement("button");
      el.className = "xp";
      el.textContent = b.label;
      el.addEventListener("click", () => { win._value = b.value; closeDialog(win); });
      box.appendChild(el);
      if (b.default) def = el;
    }
    return new Promise((resolve) => {
      if (win._resolve) win._resolve(undefined);
      win._resolve = resolve;
      win._value = buttons.find((b) => b.default)?.value;
      openDialog(win);
      (def || box.firstChild).focus();
    });
  }

  // dragging windows by the title bar
  document.addEventListener("pointerdown", (e) => {
    const win = e.target.closest(".window");
    if (win) focusWindow(win);
    const bar = e.target.closest(".title-bar");
    if (!bar || e.target.closest("button") || e.button !== 0) return;
    if (win.classList.contains("maximized") || window.innerWidth <= 760) return;

    const d = $("#desktop").getBoundingClientRect();
    const r = win.getBoundingClientRect();
    // switch from inset positioning to explicit size so it can move
    Object.assign(win.style, {
      left: `${r.left - d.left}px`, top: `${r.top - d.top}px`,
      width: `${r.width}px`, height: win.classList.contains("dialog") ? "" : `${r.height}px`,
      right: "auto", bottom: "auto",
    });
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const x = Math.min(Math.max(ev.clientX - dx - d.left, -r.width + 80), d.width - 80);
      const y = Math.min(Math.max(ev.clientY - dy - d.top, 0), d.height - 30);
      win.style.left = `${x}px`;
      win.style.top = `${y}px`;
    };
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  });

  $("#main-window .title-bar").addEventListener("dblclick", (e) => {
    if (!e.target.closest("button")) toggleMaximize();
  });

  function toggleMaximize() {
    $("#main-window").classList.toggle("maximized");
  }

  function minimizeMain() {
    $("#main-window").hidden = true;
    $(".task-button").classList.remove("active");
  }

  function restoreMain() {
    const w = $("#main-window");
    w.hidden = false;
    $(".task-button").classList.add("active");
    focusWindow(w);
  }

  // menus
  let menuOpen = false;
  $$(".menu > button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const m = btn.parentElement;
      const was = m.classList.contains("open");
      closeMenus();
      if (!was) { m.classList.add("open"); menuOpen = true; }
    });
    btn.addEventListener("mouseenter", () => {
      if (!menuOpen) return;
      closeMenus();
      btn.parentElement.classList.add("open");
      menuOpen = true;
    });
  });

  function closeMenus() {
    $$(".menu.open").forEach((m) => m.classList.remove("open"));
    menuOpen = false;
  }

  function toggleStart(force) {
    const sm = $("#start-menu");
    const show = force !== undefined ? force : sm.hidden;
    sm.hidden = !show;
    $("#start-button").classList.toggle("pressed", show);
  }

  $("#start-button").addEventListener("click", (e) => { e.stopPropagation(); toggleStart(); });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".menu")) closeMenus();
    if (!e.target.closest("#start-menu")) toggleStart(false);
  });

  // ------------------------------------------------------------------
  // balloon + status

  let balloonTimer = 0;
  function balloon(title, text) {
    $("#balloon-title").textContent = title;
    $("#balloon-text").textContent = text;
    $("#balloon").hidden = false;
    clearTimeout(balloonTimer);
    balloonTimer = setTimeout(() => { $("#balloon").hidden = true; }, 6000);
  }
  $("#balloon").addEventListener("click", () => { $("#balloon").hidden = true; });

  function status(text) {
    $("#status-msg").textContent = text;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ------------------------------------------------------------------
  // wiring

  const actions = {
    open: () => $("#file-traces").click(),
    sample: loadSample,
    import: () => $("#file-labels").click(),
    export: exportLabels,
    reset: resetLabels,
    undo,
    prev: () => show(state.index - 1),
    next: () => show(state.index + 1),
    "next-unlabeled": () => {
      const i = nextUnlabeled(state.index);
      if (i < 0) status("Every ROI is labeled"); else show(i);
    },
    "toggle-raw": () => { plot.showRaw = !plot.showRaw; plot.draw(); },
    "zoom-reset": () => plot.resetZoom(),
    options: openOptions,
    "options-defaults": () => {
      const f = $("#options-form");
      for (const k of Object.keys(DEFAULTS)) f.elements[k].value = DEFAULTS[k];
    },
    shortcuts: () => openDialog("#dlg-shortcuts"),
    about: () => openDialog("#dlg-about"),
    readme: () => window.open(REPO_URL, "_blank", "noopener"),
    minimize: minimizeMain,
    maximize: toggleMaximize,
    "restore-main": restoreMain,
    "toggle-main": () => {
      const w = $("#main-window");
      if (w.hidden) restoreMain();
      else if (w.classList.contains("inactive")) focusWindow(w);
      else minimizeMain();
    },
  };

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action], [data-label], [data-close]");
    if (!el || el.disabled) return;
    if (el.tagName === "A") e.preventDefault();
    if (el.closest(".menu-items")) closeMenus();
    if (el.closest("#start-menu")) toggleStart(false);
    if (el.hasAttribute("data-close")) return closeDialog(el.closest(".window"));
    if (el.dataset.label) return setLabel(el.dataset.label);
    const fn = actions[el.dataset.action];
    if (fn) fn();
  });

  // desktop icons open on double-click, like the real thing
  $$(".desktop-icon").forEach((icon) => {
    icon.addEventListener("click", (e) => { e.stopImmediatePropagation(); icon.focus(); }, true);
    icon.addEventListener("dblclick", () => actions[icon.dataset.action]());
    icon.addEventListener("keydown", (e) => { if (e.key === "Enter") actions[icon.dataset.action](); });
  });

  $("#roi-list tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (tr) show(+tr.dataset.i);
  });

  $("#file-traces").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) readFile(f, loadTraces);
    e.target.value = "";
  });
  $("#file-labels").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) readFile(f, importLabels);
    e.target.value = "";
  });

  // drag and drop anywhere
  const box = $("#plot-box");
  document.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("dragover"); });
  document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) box.classList.remove("dragover"); });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    box.classList.remove("dragover");
    const f = e.dataTransfer.files[0];
    if (!f) return;
    readFile(f, (text, name) => {
      // a labels file dropped onto loaded traces is imported, anything else is opened
      if (state.rois.length && /^\s*﻿?roi_column,/.test(text)) importLabels(text, name);
      else loadTraces(text, name);
    });
  });

  document.addEventListener("keydown", (e) => {
    const dlg = topDialog();
    if (e.key === "Escape") {
      if (dlg) { e.preventDefault(); return closeDialog(dlg); }
      closeMenus();
      toggleStart(false);
      return;
    }
    if (e.key === "F1") { e.preventDefault(); return actions.shortcuts(); }
    if (dlg || e.target.matches("input, select, textarea")) return;

    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "o") { e.preventDefault(); return actions.open(); }
    if (!state.rois.length) return;
    if (ctrl && e.key.toLowerCase() === "s") { e.preventDefault(); return exportLabels(); }
    if (ctrl && e.key.toLowerCase() === "z") { e.preventDefault(); return undo(); }
    if (ctrl || e.altKey) return;

    switch (e.key) {
      case "m": case "M": return setLabel("m");
      case "d": case "D": return setLabel("d");
      case "+": case "=": case "3": return setLabel("d+");
      case "ArrowLeft": case "ArrowUp": e.preventDefault(); return actions.prev();
      case "ArrowRight": case "ArrowDown": e.preventDefault(); return actions.next();
      case "n": case "N": return actions["next-unlabeled"]();
      case "r": case "R": return actions["toggle-raw"]();
      case "z": case "Z": return actions["zoom-reset"]();
      case "Backspace": e.preventDefault(); return undo();
    }
  });

  window.addEventListener("beforeunload", () => { if (state.rois.length) saveLabels(); });

  // clock
  function tick() {
    const d = new Date();
    $("#clock").textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  tick();
  setInterval(tick, 15000);

  setHasData(false);
  focusWindow($("#main-window"));
})();
