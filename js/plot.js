/*
 * A small canvas line chart: raw + filtered trace, drag to zoom,
 * double-click to reset, hover read-out. Drawn to look like a chart
 * from an early-2000s lab program rather than a modern web widget.
 */
(function (root) {
  "use strict";

  const FONT = '11px Tahoma, "Segoe UI", Verdana, sans-serif';
  const BOLD = 'bold 12px Tahoma, "Segoe UI", Verdana, sans-serif';
  const RAW = "#7f9db9";
  const FILT = "#d40000";

  function niceStep(span, target) {
    const raw = span / Math.max(target, 1);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    const m = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return m * mag;
  }

  function ticks(lo, hi, target) {
    if (!(hi > lo)) return [lo];
    const step = niceStep(hi - lo, target);
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
  }

  function Plot(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.data = null;
    this.view = null; // [x0, x1] when zoomed
    this.drag = null;
    this.hover = null;
    this.showRaw = true;
    this.margin = { l: 58, r: 14, t: 30, b: 34 };

    new ResizeObserver(() => this.draw()).observe(canvas);

    canvas.addEventListener("pointerdown", (e) => {
      if (!this.data || e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.drag = { a: this.px(e), b: this.px(e) };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.data) return;
      const x = this.px(e);
      if (this.drag) this.drag.b = x;
      this.hover = x;
      this.draw();
    });
    canvas.addEventListener("pointerup", () => {
      if (!this.drag) return;
      const a = Math.min(this.drag.a, this.drag.b);
      const b = Math.max(this.drag.a, this.drag.b);
      this.drag = null;
      if (b - a > 6) {
        const x0 = this.toX(a);
        const x1 = this.toX(b);
        this.view = [x0, x1];
      }
      this.draw();
    });
    canvas.addEventListener("pointerleave", () => { this.hover = null; this.draw(); });
    canvas.addEventListener("dblclick", () => this.resetZoom());
  }

  Plot.prototype.px = function (e) {
    const r = this.canvas.getBoundingClientRect();
    return e.clientX - r.left;
  };

  Plot.prototype.setData = function (d) {
    this.data = d;
    this.view = null;
    this.draw();
  };

  Plot.prototype.resetZoom = function () {
    this.view = null;
    this.draw();
  };

  Plot.prototype.xRange = function () {
    const x = this.data.x;
    return this.view || [x[0], x[x.length - 1]];
  };

  Plot.prototype.toX = function (px) {
    const [x0, x1] = this._xr;
    const w = this._w - this.margin.l - this.margin.r;
    const t = Math.min(Math.max((px - this.margin.l) / w, 0), 1);
    return x0 + t * (x1 - x0);
  };

  Plot.prototype.draw = function () {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    this._w = W;
    if (!this.data) return;

    const { x, raw, filt, title } = this.data;
    const m = this.margin;
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    if (pw < 40 || ph < 40) return;

    const [x0, x1] = (this._xr = this.xRange());

    // y range from the visible part
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < x.length; i++) {
      if (x[i] < x0 || x[i] > x1) continue;
      const a = this.showRaw ? raw[i] : filt[i];
      const b = filt[i];
      lo = Math.min(lo, a, b);
      hi = Math.max(hi, a, b);
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.06 || 1;
    lo -= pad;
    hi += pad;

    const sx = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * pw;
    const sy = (v) => m.t + (1 - (v - lo) / (hi - lo)) * ph;

    // plot area
    g.fillStyle = "#fff";
    g.fillRect(m.l, m.t, pw, ph);

    g.font = FONT;
    g.fillStyle = "#000";
    g.strokeStyle = "#d4d0c8";
    g.lineWidth = 1;
    g.setLineDash([2, 2]);

    const xt = ticks(x0, x1, Math.max(2, Math.floor(pw / 80)));
    const yt = ticks(lo, hi, Math.max(2, Math.floor(ph / 40)));
    g.textAlign = "center";
    g.textBaseline = "top";
    for (const v of xt) {
      const X = Math.round(sx(v)) + 0.5;
      g.beginPath(); g.moveTo(X, m.t); g.lineTo(X, m.t + ph); g.stroke();
      g.fillText(String(v), X, m.t + ph + 5);
    }
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (const v of yt) {
      const Y = Math.round(sy(v)) + 0.5;
      g.beginPath(); g.moveTo(m.l, Y); g.lineTo(m.l + pw, Y); g.stroke();
      g.fillText(String(v), m.l - 6, Y);
    }
    g.setLineDash([]);

    // axis titles
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.fillStyle = "#333";
    g.fillText("Frame", m.l + pw / 2, H - 2);
    g.save();
    g.translate(12, m.t + ph / 2);
    g.rotate(-Math.PI / 2);
    g.textBaseline = "middle";
    g.fillText("Mean intensity", 0, 0);
    g.restore();

    // traces, clipped
    g.save();
    g.beginPath();
    g.rect(m.l, m.t, pw, ph);
    g.clip();
    const line = (ys, color, width) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = "round";
      g.beginPath();
      let started = false;
      for (let i = 0; i < x.length; i++) {
        if (x[i] < x0 - 1 || x[i] > x1 + 1) continue;
        const X = sx(x[i]);
        const Y = sy(ys[i]);
        if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y);
      }
      g.stroke();
    };
    if (this.showRaw) line(raw, RAW, 1);
    line(filt, FILT, 2);

    // zoom rectangle
    if (this.drag) {
      const a = Math.min(this.drag.a, this.drag.b);
      const b = Math.max(this.drag.a, this.drag.b);
      g.fillStyle = "rgba(49,106,197,.18)";
      g.fillRect(a, m.t, b - a, ph);
      g.strokeStyle = "#316ac5";
      g.lineWidth = 1;
      g.strokeRect(Math.round(a) + 0.5, m.t + 0.5, Math.round(b - a), ph - 1);
    }

    // hover read-out
    if (this.hover !== null && !this.drag && this.hover >= m.l && this.hover <= m.l + pw) {
      const fx = this.toX(this.hover);
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < x.length; i++) {
        const d = Math.abs(x[i] - fx);
        if (d < bd) { bd = d; best = i; }
      }
      const X = Math.round(sx(x[best])) + 0.5;
      g.strokeStyle = "rgba(0,0,0,.35)";
      g.beginPath(); g.moveTo(X, m.t); g.lineTo(X, m.t + ph); g.stroke();
      g.fillStyle = FILT;
      g.beginPath(); g.arc(X, sy(filt[best]), 3, 0, Math.PI * 2); g.fill();
      this.onHover && this.onHover({ frame: x[best], raw: raw[best], filt: filt[best] });
    } else if (this.onHover) {
      this.onHover(null);
    }
    g.restore();

    // frame around plot area
    g.strokeStyle = "#808080";
    g.lineWidth = 1;
    g.strokeRect(m.l + 0.5, m.t + 0.5, pw - 1, ph - 1);

    // title
    g.font = BOLD;
    g.fillStyle = "#000";
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(title, m.l, m.t / 2 + 1);
    const titleW = g.measureText(title).width;
    if (this.view) {
      g.font = FONT;
      g.fillStyle = "#555";
      g.fillText("zoomed: double-click to reset", m.l + titleW + 10, m.t / 2 + 1);
    }

    // legend
    g.font = FONT;
    const items = [];
    if (this.showRaw) items.push(["raw", RAW, 1]);
    items.push(["TV filtered", FILT, 2]);
    let lx = m.l + pw;
    g.textAlign = "left";
    for (let i = items.length - 1; i >= 0; i--) {
      const [label, color, wdt] = items[i];
      const tw = g.measureText(label).width;
      lx -= tw + 30;
      g.strokeStyle = color;
      g.lineWidth = wdt;
      g.beginPath(); g.moveTo(lx, m.t / 2 + 1); g.lineTo(lx + 20, m.t / 2 + 1); g.stroke();
      g.fillStyle = "#000";
      g.fillText(label, lx + 24, m.t / 2 + 1);
    }
  };

  root.Plot = Plot;
})(window);
