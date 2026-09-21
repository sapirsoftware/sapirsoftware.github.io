// ContrastForge color math — the single source of truth for parsing,
// WCAG 2.2 luminance/contrast, alpha compositing, and color suggestions.
// Loaded as a plain <script> in popup/options and injected into pages by the
// scan via chrome.scripting. No modules, no dependencies, no network.
// Assigned to window so re-injection never redeclares anything.

window.CFColor = (() => {
  function clamp255(v) { return Math.min(255, Math.max(0, v)); }

  // --- Parsing ---------------------------------------------------------------
  // Returns { r, g, b, a } with channels 0-255 (floats preserved — compositing
  // math must not round early) and alpha 0-1, or null when unparseable.
  function parse(input) {
    if (input == null) return null;
    const str = String(input).trim().toLowerCase();
    if (!str) return null;
    if (str === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

    let m = str.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
    if (m) {
      const h = m[1];
      if (h.length <= 4) {
        return {
          r: parseInt(h[0] + h[0], 16),
          g: parseInt(h[1] + h[1], 16),
          b: parseInt(h[2] + h[2], 16),
          a: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1
        };
      }
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      };
    }

    m = str.match(/^rgba?\((.+)\)$/);
    if (m) {
      const parts = splitFnArgs(m[1]);
      if (parts.length < 3) return null;
      const ch = parts.slice(0, 3).map(parseRgbChannel);
      if (ch.some(v => v == null)) return null;
      const a = parts.length >= 4 ? parseAlpha(parts[3]) : 1;
      if (a == null) return null;
      return { r: ch[0], g: ch[1], b: ch[2], a };
    }

    m = str.match(/^hsla?\((.+)\)$/);
    if (m) {
      const parts = splitFnArgs(m[1]);
      if (parts.length < 3) return null;
      const h = parseHue(parts[0]);
      const s = parsePercent(parts[1]);
      const l = parsePercent(parts[2]);
      if (h == null || s == null || l == null) return null;
      const a = parts.length >= 4 ? parseAlpha(parts[3]) : 1;
      if (a == null) return null;
      const { r, g, b } = hslToRgb(h, s, l);
      return { r, g, b, a };
    }

    return parseNamed(str);
  }

  // "255, 0, 0, .5" or "255 0 0 / 50%" → ["255", "0", "0", ".5"]
  function splitFnArgs(body) {
    body = body.trim();
    if (body.includes(",")) return body.split(",").map(s => s.trim());
    return body.replace("/", " ").split(/\s+/).filter(Boolean);
  }

  function parseRgbChannel(s) {
    if (s.endsWith("%")) {
      const p = parseFloat(s);
      return isNaN(p) ? null : clamp255(p * 2.55);
    }
    const v = parseFloat(s);
    return isNaN(v) ? null : clamp255(v);
  }

  function parsePercent(s) {
    if (!s.endsWith("%")) return null;
    const p = parseFloat(s);
    return isNaN(p) ? null : Math.min(100, Math.max(0, p));
  }

  function parseAlpha(s) {
    if (s.endsWith("%")) {
      const p = parseFloat(s);
      return isNaN(p) ? null : Math.min(1, Math.max(0, p / 100));
    }
    const v = parseFloat(s);
    return isNaN(v) ? null : Math.min(1, Math.max(0, v));
  }

  function parseHue(s) {
    let v;
    if (s.endsWith("turn")) v = parseFloat(s) * 360;
    else if (s.endsWith("rad")) v = parseFloat(s) * 180 / Math.PI;
    else v = parseFloat(s); // deg, or a bare number (CSS treats it as deg)
    return isNaN(v) ? null : v;
  }

  // Named colors: let the browser's own parser resolve them via a canvas
  // fillStyle round-trip. Invalid names leave fillStyle untouched, which the
  // two-sentinel probe detects.
  let _ctx = null;
  function parseNamed(name) {
    if (typeof document === "undefined") return null;
    try {
      if (!_ctx) {
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        _ctx = c.getContext("2d");
      }
      _ctx.fillStyle = "#000";
      _ctx.fillStyle = name;
      const probe1 = _ctx.fillStyle;
      _ctx.fillStyle = "#fff";
      _ctx.fillStyle = name;
      const probe2 = _ctx.fillStyle;
      if (probe1 !== probe2) return null;
      return parse(probe1); // normalized to #rrggbb or rgba(...)
    } catch (e) {
      return null;
    }
  }

  // --- HSL conversion ---------------------------------------------------------
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.min(100, Math.max(0, s)) / 100;
    l = Math.min(100, Math.max(0, l)) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }

  // --- WCAG 2.2 luminance & contrast ------------------------------------------
  function linearChannel(c) {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function luminance({ r, g, b }) {
    return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
  }

  function contrastRatio(c1, c2) {
    const l1 = luminance(c1), l2 = luminance(c2);
    const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // --- Alpha compositing --------------------------------------------------------
  // fg OVER bg: out channel = Cf*Af + Cb*Ab*(1-Af), out alpha = Af + Ab*(1-Af),
  // channels stored un-premultiplied. This is the math incumbents get wrong.
  function over(fg, bg) {
    const a = fg.a + bg.a * (1 - fg.a);
    if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a
    };
  }

  function toHex({ r, g, b }) {
    const h = v => Math.round(clamp255(v)).toString(16).padStart(2, "0");
    return "#" + h(r) + h(g) + h(b);
  }

  // --- Accessible-color suggestion ----------------------------------------------
  // Nudge the foreground's HSL lightness until it passes `target` against bg.
  // Darkening and lightening are both tried; the smaller change wins.
  function suggestForeground(fg, bg, target) {
    const hsl = rgbToHsl(fg.r, fg.g, fg.b);
    let best = null;
    for (const dir of [-1, 1]) {
      for (let step = 1; step <= 100; step++) {
        const l = Math.min(100, Math.max(0, hsl.l + dir * step));
        const rgb = hslToRgb(hsl.h, hsl.s, l);
        const cand = { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 };
        const ratio = contrastRatio(cand, bg);
        if (ratio >= target) {
          if (!best || step < best.steps) {
            best = { color: cand, hex: toHex(cand), ratio, steps: step };
          }
          break;
        }
        if (l === 0 || l === 100) break; // hit the end without passing
      }
    }
    return best;
  }

  return { parse, rgbToHsl, hslToRgb, luminance, contrastRatio, over, toHex, suggestForeground };
})();
