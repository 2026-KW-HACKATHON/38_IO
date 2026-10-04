/* reef-kit.js
   모든 reef가 같이 쓰는 도구 모음
   - reef-data.json 읽기 (못 읽으면 페이지 안에 넣어둔 예비 데이터로)
   - 도트 그림 → 3D 물고기/아이템 모양 만들기
   - 헤엄 경로, 꼬리 흔들기, 거북 노젓기
   - 이펙트 (전기, 빛, 거품, 반짝이)
   - 말풍선과 글꼴
   쓰는 법: var kit = ReefKit(THREE);
*/
(function (root) {
  "use strict";

  function ReefKit(THREE) {
    var kit = {};
    kit.version = 1;
    var PI2 = Math.PI * 2;

    /* ───────── 작은 도구들 ───────── */
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function num(v, d) { v = +v; return isFinite(v) ? v : d; }
    function hexRgb(h) {
      h = String(h || '#ff00ff').replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h.slice(0, 6), 16);
      if (!isFinite(n)) n = 0xff00ff;
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function rgbHex(c) {
      return '#' + c.map(function (v) { v = clamp(Math.round(v), 0, 255); return (v < 16 ? '0' : '') + v.toString(16); }).join('');
    }
    // 글자를 숫자 하나로 바꾸기 (같은 글자면 같은 숫자)
    function hashStr(s) {
      var h = 2166136261;
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    }
    // 씨앗이 같으면 매번 같은 순서로 나오는 난수
    function seeded(seed) {
      var a = seed >>> 0;
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        var t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    kit.hash = hashStr; kit.seeded = seeded; kit.hexRgb = hexRgb; kit.rgbHex = rgbHex; kit.clone = clone;

    // 색을 화면에 맞게 바꿔서 THREE 색으로
    kit.color = function (hex) { return new THREE.Color(hex).convertSRGBToLinear(); };

    /* ───────── 데이터 정리 ───────── */
    var ROLES = ['head', 'body', 'stock', 'caudal', 'pect', 'flipF', 'flipB', 'still', 'jaw'];
    var KINDS = ['box', 'plane', 'free'];
    var SHAPES = ['box', 'cylinder', 'cone', 'sphere', 'wedge', 'mesh'];
    var MOTIONS = ['fish', 'turtle', 'float', 'spin', 'still'];
    kit.ROLES = ROLES; kit.KINDS = KINDS; kit.SHAPES = SHAPES; kit.MOTIONS = MOTIONS;

    function pad(s, n) { s = String(s == null ? '' : s); while (s.length < n) s += '.'; return s.slice(0, n); }
    function vec3(a, d) {
      a = Array.isArray(a) ? a : [];
      return [num(a[0], d[0]), num(a[1], d[1]), num(a[2], d[2])];
    }

    function normPart(p, i) {
      p = p || {};
      if (KINDS.indexOf(p.kind) < 0) p.kind = 'box';
      if (ROLES.indexOf(p.role) < 0) p.role = 'body';
      if (!p.id) p.id = p.kind + (i + 1);
      p.opacity = clamp(num(p.opacity, 1), 0.05, 1);
      p.shine = clamp(num(p.shine, 0), 0, 1);
      if (p.kind === 'free') {
        if (SHAPES.indexOf(p.shape) < 0) p.shape = 'box';
        p.size = vec3(p.size, [1, 1, 1]);
        p.pos = vec3(p.pos, [0, 0, 0]);
        p.rot = vec3(p.rot, [0, 0, 0]);
        if (!p.color) p.color = '#888888';
      } else {
        p.x = Math.round(num(p.x, 0)); p.y = Math.round(num(p.y, 0));
        p.w = Math.max(1, Math.round(num(p.w, 1))); p.h = Math.max(1, Math.round(num(p.h, 1)));
        p.z = num(p.z, 0);
        if (p.kind === 'box') p.d = Math.max(1, Math.round(num(p.d, 3)));
        if (p.kind === 'plane' && ['z', 'y', 'x'].indexOf(p.axis) < 0) p.axis = 'z';
        if (p.rot) p.rot = vec3(p.rot, [0, 0, 0]);
        // 흔들기: pivot 모서리를 축으로 amp도만큼 왔다 갔다 (alt=1 이면 왼쪽·오른쪽이 엇갈림)
        if (p.swing) p.swing = { axis: ['x', 'y', 'z'].indexOf(p.swing.axis) >= 0 ? p.swing.axis : 'x', amp: num(p.swing.amp, 12),
                                 rate: num(p.swing.rate, 0.8), phase: num(p.swing.phase, 0), alt: num(p.swing.alt, 0),
                                 min: p.swing.min == null ? null : num(p.swing.min, 0), max: p.swing.max == null ? null : num(p.swing.max, 0) };
        if (p.paint && !Array.isArray(p.paint)) delete p.paint;
        if (p.paint) p.paint = p.paint.map(function (r) { return pad(r, p.w); }).slice(0, p.h);
        if (p.paint) while (p.paint.length < p.h) p.paint.push(pad('', p.w));
        // 칠한 칸이 하나도 없는 부위 도트는 없는 것으로 (옆모습을 따라감)
        if (p.paint && !p.paint.join('').replace(/[.\s]/g, '')) delete p.paint;
      }
      return p;
    }

    function normModel(src) {
      var m = clone(src || {});
      m.id = String(m.id || ('m' + Date.now().toString(36)));
      m.name = String(m.name || m.id);
      if (!m.palette || typeof m.palette !== 'object') m.palette = {};
      if (!Array.isArray(m.side) || !m.side.length) m.side = ['...'];
      var W = 1;
      m.side.forEach(function (r) { W = Math.max(W, String(r).length); });
      m.side = m.side.map(function (r) { return pad(r, W); });
      if (Array.isArray(m.top) && m.top.length) m.top = m.top.map(function (r) { return pad(r, W); });
      else delete m.top;
      if (MOTIONS.indexOf(m.motion) < 0) m.motion = 'fish';
      m.scale = clamp(num(m.scale, 0.5), 0.02, 20);
      var sw = m.swim || {};
      m.swim = {
        speed: num(sw.speed, 1), beat: num(sw.beat, 0.6), wag: num(sw.wag, 0.55), bend: num(sw.bend, 0.5),
        pect: num(sw.pect, 1), bob: num(sw.bob, 0.2), roll: num(sw.roll, 1), pectAmp: num(sw.pectAmp, 1)
      };
      m.parts = (Array.isArray(m.parts) ? m.parts : []).map(normPart);
      m.says = (Array.isArray(m.says) ? m.says : []).map(String);
      // 턱: open = 기본으로 벌린 각도, amp = 더 벌어지는 폭(도), rate = 1초에 몇 번
      if (m.jaw) m.jaw = { open: num(m.jaw.open, 4), amp: num(m.jaw.amp, 8), rate: num(m.jaw.rate, 0.15), pivot: Array.isArray(m.jaw.pivot) ? m.jaw.pivot : null,
                           close: m.jaw.close == null ? null : clamp(num(m.jaw.close, 0.5), 0.05, 0.95) };
      m.variants = Array.isArray(m.variants) ? m.variants : [];
      m.effects = Array.isArray(m.effects) ? m.effects : [];
      return m;
    }

    function normalize(d) {
      d = clone(d || {});
      d.v = 1;
      d.style = d.style || {};
      d.style.font = Object.assign({ family: 'system-ui, sans-serif', google: [], cssUrl: '' }, d.style.font || {});
      d.style.bubble = Object.assign({
        bg: '#FFFDF8', ink: '#3B3350', border: '#3B3350', px: 1, size: 14, pad: 8,
        maxWidth: 190, tail: true, pixel: true, duration: 3.2, anim: 'pop'
      }, d.style.bubble || {});
      d.style.title = Object.assign({ family: '', google: [] }, d.style.title || {});
      d.species = (d.species || []).map(normModel);
      d.items = (d.items || []).map(function (m) {
        m = normModel(m);
        if (m.motion === 'fish' || m.motion === 'turtle') m.motion = 'float';
        return m;
      });
      d.effects = (d.effects || []).map(function (e, i) {
        e = e || {};
        e.id = String(e.id || ('fx' + i));
        e.name = String(e.name || e.id);
        e.type = e.type || 'charge';
        e.params = e.params || {};
        return e;
      });
      d.reefs = (d.reefs || []).map(function (r) { r.config = r.config || {}; return r; });
      if (typeof d.guide !== 'string') d.guide = '';
      return d;
    }
    kit.normalize = normalize; kit.normModel = normModel; kit.normPart = normPart;

    kit.find = function (data, id) {
      var i;
      for (i = 0; i < data.species.length; i++) if (data.species[i].id === id) return data.species[i];
      for (i = 0; i < data.items.length; i++) if (data.items[i].id === id) return data.items[i];
      return null;
    };
    kit.effect = function (data, id) {
      for (var i = 0; i < data.effects.length; i++) if (data.effects[i].id === id) return data.effects[i];
      return null;
    };
    kit.reef = function (data, id) {
      for (var i = 0; i < data.reefs.length; i++) if (data.reefs[i].id === id) return data.reefs[i];
      return null;
    };

    /* ───────── 데이터 읽기 ───────── */
    function bust(url) { return url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(); }

    kit.source = 'none';
    kit.loadData = function (opts) {
      opts = opts || {};
      var url = opts.url || 'reef-data.json';
      return fetch(bust(url), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) { kit.source = 'file'; return normalize(d); })
        .catch(function (e) {
          if (root.REEF_DATA) { kit.source = 'built-in'; return normalize(root.REEF_DATA); }
          throw e;
        });
    };

    // 올려둔 파일이 바뀌었는지 가끔 확인해서, 바뀌면 새 데이터로 다시 그리게 함
    kit.watchData = function (since, cb, ms) {
      var last = since || '';
      var url = 'reef-data.json';
      return setInterval(function () {
        if (document.hidden || kit.source !== 'file') return;
        fetch(bust(url), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            if (!d) return;
            var u = String(d.updated || '');
            if (u && u !== last) { last = u; cb(normalize(d)); }
          })
          .catch(function () {});
      }, ms || 30000);
    };

    // All Reefs 안의 미리보기 창으로 열렸을 때, 수정 중인 데이터를 바로 받기
    kit.onLiveData = function (cb) {
      if (root.parent === root) return;
      root.addEventListener('message', function (e) {
        if (e.source !== root.parent) return;
        var m = e.data;
        if (m && m.type === 'reef-data' && m.data) cb(normalize(m.data), m);
      });
      try { root.parent.postMessage({ type: 'reef-ready', reef: document.body.getAttribute('data-reef') }, '*'); } catch (err) {}
    };

    /* ───────── 색 바꾸기 (같은 종 안에서 살짝 다른 색) ───────── */
    function rgbToHsl(c) {
      var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), h = 0, s = 0, l = (mx + mn) / 2, d = mx - mn;
      if (d) {
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
        h /= 6;
      }
      return [h, s, l];
    }
    function hslToRgb(h, s, l) {
      if (!s) return [l * 255, l * 255, l * 255];
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      function f(t) {
        t = (t % 1 + 1) % 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      }
      return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
    }
    // variant: {h: 색상 이동(도), s: 채도 배수, v: 밝기 배수}, lift: 등/배 밝기 차이
    function tint(hex, variant, lift) {
      var c = hexRgb(hex);
      if (!variant && !lift) return c;
      var hsl = rgbToHsl(c), V = variant || { h: 0, s: 1, v: 1 };
      return hslToRgb(
        (hsl[0] + num(V.h, 0) / 360 + 1) % 1,
        clamp(hsl[1] * num(V.s, 1), 0, 1),
        clamp((hsl[2] + (lift || 0)) * num(V.v, 1), 0.03, 0.97)
      );
    }
    kit.tint = function (hex, variant) { return rgbHex(tint(hex, variant, 0)); };

    /* ───────── 도트 읽는 도구 ───────── */
    function Sampler(m) {
      var side = m.side, H = side.length, W = side[0].length;
      var top = m.top || null, D = top ? top.length : 0;
      function empty(ch) { return !ch || ch === '.' || ch === ' '; }
      this.W = W; this.H = H; this.D = D;
      this.side = function (c, r) {
        if (r < 0 || r >= H || c < 0 || c >= W) return null;
        var ch = side[r].charAt(c); return empty(ch) ? null : ch;
      };
      this.top = function (c, zr) {
        if (!top || zr < 0 || zr >= D || c < 0 || c >= W) return null;
        var ch = top[zr].charAt(c); return empty(ch) ? null : ch;
      };
      this.fx = function (col) { return col - W / 2 + 0.5; };
      this.fy = function (row) { return H / 2 - row - 0.5; };
      this.zr = function (z) { return Math.floor(z + D / 2); };
      this.empty = empty;
    }
    kit.Sampler = Sampler;

    // 부위 자체 도트(paint) 한 칸 읽기. 'X'는 부위 색(color)
    function paintAt(p, i, j) {
      if (!p.paint) return null;
      var row = p.paint[j]; if (!row) return null;
      var ch = row.charAt(i);
      if (!ch || ch === '.' || ch === ' ') return null;
      return ch === 'X' ? (p.color || 'X') : ch;
    }

    // 박스 한 개가 덮는 칸들. 빈칸은 가까운 색으로 메워서 박스에 구멍이 안 나게
    function boxCells(S, m, p) {
      var w = p.w, h = p.h, g = [], queue = [], i, j;
      for (j = 0; j < h; j++) {
        g.push([]);
        for (i = 0; i < w; i++) {
          var ch = (p.paint && paintAt(p, i, j)) || S.side(p.x + i, p.y + j);
          if (ch && !(ch in m.palette) && ch.charAt(0) !== '#') ch = null;
          g[j].push(ch);
          if (ch) queue.push([i, j]);
        }
      }
      if (!queue.length) {
        var fillCh = p.color || Object.keys(m.palette)[0] || null;
        for (j = 0; j < h; j++) for (i = 0; i < w; i++) g[j][i] = fillCh;
      } else {
        var head = 0;
        while (head < queue.length) {
          var q = queue[head++], ch2 = g[q[1]][q[0]];
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
            var a = q[0] + d[0], b = q[1] + d[1];
            if (a < 0 || b < 0 || a >= w || b >= h || g[b][a]) return;
            g[b][a] = ch2; queue.push([a, b]);
          });
        }
      }
      return function (a, b) { return g[clamp(b, 0, h - 1)][clamp(a, 0, w - 1)]; };
    }

    /* ───────── 겉 그림 굽기 ─────────
       모든 박스 면과 평면의 도트를 그림 한 장에 모아 그림 */
    function packRects(rects) {
      var maxW = 1, i;
      for (i = 0; i < rects.length; i++) maxW = Math.max(maxW, rects[i].w);
      var AW = 64; while (AW < maxW) AW *= 2;
      var order = rects.map(function (r, k) { return k; }).sort(function (a, b) { return rects[b].h - rects[a].h; });
      var x = 0, y = 0, rowH = 0;
      order.forEach(function (k) {
        var r = rects[k];
        if (x + r.w > AW) { x = 0; y += rowH; rowH = 0; }
        r.u = x; r.v = y; x += r.w; rowH = Math.max(rowH, r.h);
      });
      var AH = 16; while (AH < y + rowH) AH *= 2;
      return { AW: AW, AH: AH };
    }

    var SKINS = {}, skinCount = 0;
    function skinFor(m, variant) {
      var key = hashStr(JSON.stringify(m)) + '|' + JSON.stringify(variant || null);
      if (SKINS[key]) return SKINS[key];
      if (++skinCount > 80) { SKINS = {}; skinCount = 1; }
      return (SKINS[key] = bake(m, variant));
    }

    // 칸 자리로 정해지는 0~1 값 (그레인용)
    function cellNoise(a, b, c) {
      var h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
      h = (h ^ (h >>> 13)) * 1274126177 | 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    }

    function bake(m, variant) {
      var S = new Sampler(m), pal = m.palette, shade = num(m.shade, 0.06);
      var vpal = (variant && variant.palette) || null;
      var colorCache = {};
      var grain = clamp(num(m.grain, 0), 0, 0.5);
      // 글자 하나 → 색 (위쪽일수록 살짝 어둡고 아래쪽일수록 살짝 밝게)
      function col(ch, rowFrac) {
        if (!ch) return null;
        var hex = (vpal && vpal[ch]) || pal[ch] || (ch.charAt(0) === '#' ? ch : null);
        if (!hex) return null;
        var lift = (rowFrac == null) ? 0 : (rowFrac - 0.5) * shade;
        var key = hex + '|' + Math.round(lift * 1000);
        return colorCache[key] || (colorCache[key] = tint(hex, variant, lift));
      }
      var rects = [], faces = [];
      m.parts.forEach(function (p, k) {
        var list = [];
        if (p.kind === 'box') {
          var cells = boxCells(S, m, p), H = S.H;
          var rf = function (j) { return (p.y + j) / Math.max(1, H - 1); };
          var topFn = function (i, j) {
            if (p.useTop && S.D && !p.paint) {
              var zr = S.zr(p.z - p.d / 2 + j + 0.5), t = S.top(p.x + i, zr);
              if (t) return col(t, null);
            }
            return col(cells(i, 0), rf(0) - 0.08);
          };
          list = [
            { w: p.d, h: p.h, f: function (i, j) { return col(cells(p.w - 1, j), rf(j)); } },
            { w: p.d, h: p.h, f: function (i, j) { return col(cells(0, j), rf(j)); } },
            { w: p.w, h: p.d, f: topFn },
            { w: p.w, h: p.d, f: function (i) { return col(cells(i, p.h - 1), rf(p.h - 1) + 0.08); } },
            { w: p.w, h: p.h, f: function (i, j) { return col(cells(i, j), rf(j)); } },
            { w: p.w, h: p.h, f: function (i, j) { return col(cells(p.w - 1 - i, j), rf(j)); } }
          ];
          // faces가 있으면 그 면은 따로 칠함 (없는 칸은 원래대로)
          if (p.faces) {
            var FC = p.faces;
            var fget = function (g, i, j) {
              if (!Array.isArray(g) || !g.length) return null;
              var r = String(g[clamp(j, 0, g.length - 1)] || ''), ch = r.charAt(clamp(i, 0, r.length - 1));
              return S.empty(ch) || !(ch in pal || ch.charAt(0) === '#') ? null : ch;
            };
            [['front', 0, function (j) { return rf(j); }], ['back', 1, function (j) { return rf(j); }],
             ['top', 2, function () { return rf(0) - 0.08; }], ['bottom', 3, function () { return rf(p.h - 1) + 0.08; }]
            ].forEach(function (q) {
              if (!FC[q[0]]) return;
              var old = list[q[1]].f, g = FC[q[0]], lf = q[2];
              list[q[1]].f = function (i, j) { var ch = fget(g, i, j); return ch ? col(ch, lf(j)) : old(i, j); };
            });
          }
        } else if (p.kind === 'plane') {
          var fn;
          if (p.paint) fn = function (i, j) { return col(paintAt(p, i, j), null); };
          else if (p.axis === 'y') fn = function (i, j) { return col(S.top(p.x + i, S.zr(p.z - p.h / 2 + j + 0.5)), null); };
          else if (p.axis === 'x') fn = function (i, j) { return col(S.side(p.x, p.y + j), (p.y + j) / S.H); };
          else fn = function (i, j) { return col(S.side(p.x + i, p.y + j), (p.y + j) / S.H); };
          list = [{ w: p.w, h: p.h, f: fn }];
          if (p.alphaGrad) {
            var ag = p.alphaGrad, an = num(ag.near, 1), af = num(ag.far, 0.7);
            list[0].a = function (i) { return af + (an - af) * (i + 0.5) / p.w; };   // 몸 쪽으로 갈수록 진하게
          }
        }
        list.forEach(function (r) { rects.push(r); });
        faces[k] = list;
      });
      var size = packRects(rects.length ? rects : [{ w: 1, h: 1 }]);
      var AW = size.AW, AH = size.AH;
      var cv = document.createElement('canvas'); cv.width = AW; cv.height = AH;
      var ctx = cv.getContext('2d'), img = ctx.createImageData(AW, AH), d = img.data;
      var mk = document.createElement('canvas'); mk.width = AW; mk.height = AH;
      var mctx = mk.getContext('2d'), mimg = mctx.createImageData(AW, AH), md = mimg.data;
      rects.forEach(function (r, ri) {
        for (var j = 0; j < r.h; j++) for (var i = 0; i < r.w; i++) {
          var c = r.f(i, j); if (!c) continue;
          if (grain) {
            var gk = 1 + grain * (cellNoise(ri, i, j) * 2 - 1);
            c = [clamp(Math.round(c[0] * gk), 0, 255), clamp(Math.round(c[1] * gk), 0, 255), clamp(Math.round(c[2] * gk), 0, 255)];
          }
          var o = ((r.v + j) * AW + r.u + i) * 4;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = r.a ? Math.round(255 * clamp(r.a(i, j), 0, 1)) : 255;
          md[o] = md[o + 1] = md[o + 2] = md[o + 3] = 255;
        }
      });
      ctx.putImageData(img, 0, 0); mctx.putImageData(mimg, 0, 0);
      function makeTex(c, srgb) {
        var t = new THREE.CanvasTexture(c);
        t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
        if (srgb) t.encoding = THREE.sRGBEncoding;
        return t;
      }
      return {
        S: S, AW: AW, AH: AH, faces: faces, canvas: cv, col: col,
        tex: makeTex(cv, true), mask: makeTex(mk, false), geo: {}, mats: {}
      };
    }

    /* ───────── 3D 모양 ───────── */
    function setUV(uv, idx, r, AW, AH, sx, sy) {
      var u0 = r.u / AW * sx, u1 = (r.u + r.w) / AW * sx;
      var v1 = (1 - r.v / AH) * sy, v0 = (1 - (r.v + r.h) / AH) * sy;
      uv.setXY(idx, u0, v1); uv.setXY(idx + 1, u1, v1);
      uv.setXY(idx + 2, u0, v0); uv.setXY(idx + 3, u1, v0);
    }
    // aura=true면 전기 무늬용: 한 칸이 무늬 한 칸이 되도록 그림을 늘려 붙임
    function boxGeo(skin, k, p, inflate, aura) {
      var key = 'b' + k + '|' + (inflate || 0) + (aura ? 'a' : '');
      if (skin.geo[key]) return skin.geo[key];
      var e = inflate || 0;
      var g = new THREE.BoxBufferGeometry(p.w + e * 2, p.h + e * 2, p.d + e * 2);
      var uv = g.attributes.uv, sx = aura ? skin.AW / 64 : 1, sy = aura ? skin.AH / 64 : 1;
      skin.faces[k].forEach(function (r, fi) { setUV(uv, fi * 4, r, skin.AW, skin.AH, sx, sy); });
      uv.needsUpdate = true;
      return (skin.geo[key] = g);
    }
    function planeGeo(skin, k, p, inflate, aura) {
      var key = 'p' + k + '|' + (inflate || 0) + (aura ? 'a' : '');
      if (skin.geo[key]) return skin.geo[key];
      var e = inflate || 0;
      var g = new THREE.PlaneBufferGeometry(p.w + e * 2, p.h + e * 2);
      var sx = aura ? skin.AW / 64 : 1, sy = aura ? skin.AH / 64 : 1;
      setUV(g.attributes.uv, 0, skin.faces[k][0], skin.AW, skin.AH, sx, sy);
      g.attributes.uv.needsUpdate = true;
      return (skin.geo[key] = g);
    }
    function freeGeo(p) {
      var s = p.size;
      switch (p.shape) {
        case 'cylinder': return new THREE.CylinderBufferGeometry(s[0] / 2, s[0] / 2, s[1], 8);
        case 'cone': return new THREE.ConeBufferGeometry(s[0] / 2, s[1], 8);
        case 'sphere': {
          var g = new THREE.SphereBufferGeometry(0.5, 8, 6); g.scale(s[0], s[1], s[2]); return g;
        }
        case 'wedge': {
          // 옆에서 보면 직각삼각형인 쐐기
          var sh = new THREE.Shape();
          sh.moveTo(-s[0] / 2, -s[1] / 2); sh.lineTo(s[0] / 2, -s[1] / 2); sh.lineTo(-s[0] / 2, s[1] / 2); sh.lineTo(-s[0] / 2, -s[1] / 2);
          var wg = new THREE.ExtrudeBufferGeometry(sh, { depth: s[2], bevelEnabled: false });
          wg.translate(0, 0, -s[2] / 2); return wg;
        }
        case 'mesh': {
          var mg = new THREE.BufferGeometry(), v = (p.mesh && p.mesh.v) || [], f = (p.mesh && p.mesh.f) || [], pos = [];
          f.forEach(function (tri) {
            for (var q = 0; q < 3; q++) {
              var vv = v[tri[q]] || [0, 0, 0];
              pos.push(num(vv[0], 0) * s[0], num(vv[1], 0) * s[1], num(vv[2], 0) * s[2]);
            }
          });
          if (!pos.length) return new THREE.BoxBufferGeometry(s[0], s[1], s[2]);
          mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          mg.computeVertexNormals(); return mg;
        }
        default: return new THREE.BoxBufferGeometry(s[0], s[1], s[2]);
      }
    }

    /* ───────── 재질 ───────── */
    // 광택: 빛을 정면으로 받는 면일수록 sheen 색이 피부 위에 더해짐 (따로 띄운 껍질 없음)
    // sheen은 한 겹 {color, strength, power} 또는 여러 겹 배열.
    // 겹마다 rect:[열0,행0,열1,행1] (그 칸 안에서만) 또는 center:[열,행]+radius (가운데서 번지며 옅어짐)
    function f4(v) { return (+v).toFixed(4); }
    function sheenMat(o, sh, S) {
      var layers = Array.isArray(sh) ? sh : [sh];
      o.specular = new THREE.Color(0, 0, 0); o.shininess = 1;
      var mt = new THREE.MeshPhongMaterial(o), off = new THREE.Vector3();
      mt.userData.sheenOff = off;
      var body = '';
      layers.forEach(function (L) {
        var c = kit.color(L.color || '#C8B4FF'), mask = '1.0';
        // 칸 사각형 [열0,행0,열1,행1] 안이면 1, 밖이면 0
        var inRect = function (R) {
          var x0 = R[0] - S.W / 2, x1 = R[2] - S.W / 2, y1 = S.H / 2 - R[1], y0 = S.H / 2 - R[3];
          return 'step(' + f4(x0) + ', sp.x) * step(sp.x, ' + f4(x1) + ') * step(' + f4(y0) + ', sp.y) * step(sp.y, ' + f4(y1) + ')';
        };
        if (Array.isArray(L.rect)) {
          mask = inRect(L.rect);
        } else if (Array.isArray(L.center)) {
          var cx = L.center[0] - S.W / 2, cy = S.H / 2 - L.center[1];
          mask = 'pow(clamp(1.0 - length(sp.xy - vec2(' + f4(cx) + ', ' + f4(cy) + ')) / ' + f4(num(L.radius, 4)) + ', 0.0, 1.0), 1.5)';
        }
        if (Array.isArray(L.exclude)) L.exclude.forEach(function (R) { mask = '(' + mask + ') * (1.0 - ' + inRect(R) + ')'; });
        var amt = '(' + f4(num(L.strength, 0.5)) + ' * ' + mask + ') * pow(nl, ' + f4(num(L.power, 3)) + ')';
        var cv = 'vec3(' + f4(c.r) + ', ' + f4(c.g) + ', ' + f4(c.b) + ')';
        if (L.mode === 'tint') body += '    tn = mix(tn, tn * ' + cv + ', clamp(' + amt + ', 0.0, 1.0));\n';
        else body += '    sh += ' + cv + ' * ' + amt + ';\n';
      });
      mt.onBeforeCompile = function (shader) {
        shader.uniforms.sheenOff = { value: off };
        shader.vertexShader = 'varying vec3 vSheenLocal;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSheenLocal = position;');
        shader.fragmentShader = 'uniform vec3 sheenOff;\nvarying vec3 vSheenLocal;\n' +
          shader.fragmentShader.replace('#include <lights_fragment_end>',
            '#include <lights_fragment_end>\n#if NUM_DIR_LIGHTS > 0\n{\n  vec3 sp = vSheenLocal + sheenOff;\n  vec3 tn = vec3(1.0);\n  for (int si = 0; si < NUM_DIR_LIGHTS; si++) {\n' +
            '    float nl = clamp(dot(normal, directionalLights[si].direction), 0.0, 1.0);\n    vec3 sh = vec3(0.0);\n' + body +
            '    reflectedLight.directSpecular += sh * directionalLights[si].color;\n  }\n' +
            '  reflectedLight.directDiffuse *= tn; reflectedLight.indirectDiffuse *= tn;\n}\n#endif');
      };
      mt.customProgramCacheKey = function () { return 'sheen|' + body; };
      return mt;
    }
    function matFor(skin, p, isPlane) {
      var key = (isPlane ? 'P' : 'B') + '|' + p.opacity + '|' + p.shine + '|' + (p.sheen ? p.id + JSON.stringify(p.sheen) : '') + (p.alphaGrad ? '|ag' : '');
      if (skin.mats[key]) return skin.mats[key];
      var o = { map: skin.tex };
      if (isPlane) { o.side = THREE.DoubleSide; o.alphaTest = 0.5; }
      if (p.opacity < 1) { o.transparent = true; o.opacity = p.opacity; if (isPlane) o.depthWrite = false; }
      if (p.alphaGrad) { o.transparent = true; if (isPlane) o.depthWrite = false; }
      if (p.sheen) return (skin.mats[key] = sheenMat(o, p.sheen, skin.S));
      var mt;
      if (p.shine > 0) {
        o.shininess = 4 + p.shine * 60;
        o.specular = new THREE.Color(0.06 * p.shine + 0.02, 0.07 * p.shine + 0.02, 0.07 * p.shine + 0.02);
        mt = new THREE.MeshPhongMaterial(o);
      } else mt = new THREE.MeshLambertMaterial(o);
      return (skin.mats[key] = mt);
    }
    function freeMat(skin, m, p, variant) {
      var hex = (variant && variant.palette && variant.palette[p.color]) || m.palette[p.color] || (String(p.color).charAt(0) === '#' ? p.color : '#888888');
      var c = kit.color(rgbHex(tint(hex, variant, 0)));
      var o = { color: c };
      if (p.opacity < 1) { o.transparent = true; o.opacity = p.opacity; }
      if (p.shine > 0) { o.shininess = 4 + p.shine * 60; o.specular = new THREE.Color(0.1 * p.shine, 0.1 * p.shine, 0.1 * p.shine); o.flatShading = true; return new THREE.MeshPhongMaterial(o); }
      return new THREE.MeshLambertMaterial(o);
    }

    /* ───────── 뼈대 위치 (머리|몸통, 몸통|꼬리자루, 꼬리 경첩) ───────── */
    function joints(m, S) {
      var W = S.W, hb = null, bs = null, sc = null, bodyRight = null, stockLeft = null;
      m.parts.forEach(function (p) {
        if (p.kind === 'free') return;
        var L = p.x - W / 2, R = p.x + p.w - W / 2;
        if (p.role === 'head') hb = hb === null ? L : Math.min(hb, L);
        if (p.role === 'body') { bs = bs === null ? L : Math.min(bs, L); bodyRight = bodyRight === null ? R : Math.max(bodyRight, R); }
        if (p.role === 'stock') stockLeft = stockLeft === null ? L : Math.min(stockLeft, L);
        if (p.role === 'caudal') sc = sc === null ? R : Math.max(sc, R);
      });
      if (hb === null) hb = bodyRight !== null ? bodyRight : 0;
      if (bs === null) bs = hb - 1;
      if (sc === null) sc = stockLeft !== null ? stockLeft : bs - 1;
      if (bs > hb) bs = hb;
      if (sc > bs) sc = bs;
      return { hb: hb, bs: bs, sc: sc };
    }
    kit.joints = function (m) { return joints(m, new Sampler(m)); };

    /* ───────── 물고기/아이템 만들기 ─────────
       opts.variant: 색 변형, opts.effects: 붙일 이펙트들, opts.phase: 여러 마리가 박자 안 맞게 */
    kit.build = function (m, opts) {
      opts = opts || {};
      var variant = opts.variant || null;
      var skin = skinFor(m, variant), S = skin.S;
      var obj = new THREE.Group();
      obj.rotation.order = 'YZX';
      var swimRoot = new THREE.Object3D(); obj.add(swimRoot);
      var bob = new THREE.Object3D(); swimRoot.add(bob);
      var J = joints(m, S);
      var head = new THREE.Object3D(); bob.add(head);
      var body = new THREE.Object3D(); body.position.x = J.hb; head.add(body);
      var stock = new THREE.Object3D(); stock.position.x = J.bs - J.hb; body.add(stock);
      var caudal = new THREE.Object3D(); caudal.position.x = J.sc - J.bs; stock.add(caudal);
      var bones = { head: head, body: body, stock: stock, caudal: caudal, still: bob };
      var boneX = { head: 0, body: J.hb, stock: J.bs, caudal: J.sc, still: 0 };
      // 턱: 턱 부위들의 뒤쪽 위 모서리(또는 jaw.pivot)를 축으로 머리에 붙임
      var jawY = 0, jawParts = m.parts.filter(function (p) { return p.role === 'jaw' && p.kind !== 'free'; });
      if (jawParts.length) {
        var jl = Infinity, jt = -Infinity;
        jawParts.forEach(function (p) { jl = Math.min(jl, p.x - S.W / 2); jt = Math.max(jt, S.H / 2 - p.y); });
        var jp = (m.jaw && m.jaw.pivot) ? [m.jaw.pivot[0] - S.W / 2, S.H / 2 - m.jaw.pivot[1]] : [jl, jt];
        var jawBone = new THREE.Object3D(); jawBone.position.set(jp[0], jp[1], 0); head.add(jawBone);
        bones.jaw = jawBone; boneX.jaw = jp[0]; jawY = jp[1];
      }
      var pects = [], flips = [], meshes = [], swings = [], halfH = S.H / 2;

      m.parts.forEach(function (p, k) {
        var role = p.role;
        var mirror = role === 'pect' || role === 'flipF' || role === 'flipB' || !!p.mirror;
        var boneName = role === 'pect' ? 'body' : (role === 'flipF' || role === 'flipB') ? 'still' : role;
        var parent = bones[boneName] || bob, bx = boneX[boneName] || 0;
        var geo, mat, cx, cy, cz, isPlane = p.kind === 'plane', halfLen = 0.5, halfDepth = 0.5;
        if (p.kind === 'box') {
          geo = boxGeo(skin, k, p); mat = matFor(skin, p, false);
          cx = p.x + p.w / 2 - S.W / 2; cy = S.H / 2 - (p.y + p.h / 2); cz = p.z;
          halfLen = p.w / 2; halfDepth = p.d / 2;
        } else if (isPlane) {
          geo = planeGeo(skin, k, p); mat = matFor(skin, p, true);
          if (p.axis === 'y') { cx = p.x + p.w / 2 - S.W / 2; cy = S.fy(p.y); halfLen = p.w / 2; halfDepth = p.h / 2; }
          else if (p.axis === 'x') { cx = S.fx(p.x); cy = S.H / 2 - (p.y + p.h / 2); halfLen = 0.5; halfDepth = p.w / 2; }
          else { cx = p.x + p.w / 2 - S.W / 2; cy = S.H / 2 - (p.y + p.h / 2); halfLen = p.w / 2; halfDepth = 0.05; }
          cz = p.z;
        } else {
          geo = freeGeo(p); mat = freeMat(skin, m, p, variant);
          cx = S.fx(p.pos[0]); cy = S.fy(p.pos[1]); cz = p.pos[2];
          halfLen = p.size[0] / 2; halfDepth = p.size[2] / 2;
        }
        if (mat && mat.userData && mat.userData.sheenOff) mat.userData.sheenOff.set(cx, cy, cz);
        var s0 = cz < 0 ? -1 : 1;
        (mirror ? [1, -1] : [1]).forEach(function (side) {
          var mesh = new THREE.Mesh(geo, mat);
          var holder = new THREE.Object3D();
          if (isPlane && p.axis === 'y') mesh.rotation.x = -Math.PI / 2;
          if (isPlane && p.axis === 'x') mesh.rotation.y = Math.PI / 2;
          if (p.kind === 'free') {
            var r = p.rot;
            mesh.rotation.set(r[0] * Math.PI / 180 * side, r[1] * Math.PI / 180 * side, r[2] * Math.PI / 180);
          }
          // 기울인 판/상자: pivot 모서리를 축으로 rot만큼 돌려 둠 (반대쪽은 거울로)
          var tilt = null, po = [0, 0];
          if (p.kind !== 'free' && (p.rot || p.swing || (p.pivot && p.pivot !== 'center'))) {
            var r3 = p.rot || [0, 0, 0];
            tilt = new THREE.Object3D();
            tilt.rotation.set(r3[0] * Math.PI / 180 * side, r3[1] * Math.PI / 180 * side, r3[2] * Math.PI / 180);
            var pw = (isPlane && p.axis === 'x') ? 0 : p.w, ph = (isPlane && p.axis === 'y') ? 0 : p.h;
            po = { top: [0, ph / 2], bottom: [0, -ph / 2], front: [pw / 2, 0], back: [-pw / 2, 0] }[p.pivot] || [0, 0];
          }
          var jy = role === 'jaw' ? jawY : 0;
          if (role === 'pect') {
            // 가슴지느러미: 앞쪽 끝을 축으로 부채질
            holder.position.set(cx + halfLen - bx, cy + po[1], side * cz);
            mesh.position.x = -halfLen; mesh.position.y = -po[1];
            holder.userData.side = side;
            pects.push(holder);
          } else if (role === 'flipF' || role === 'flipB') {
            // 거북 발: 몸에 붙은 쪽을 축으로 노젓기
            holder.position.set(cx - bx, cy, side * (cz - s0 * halfDepth));
            mesh.position.z = side * s0 * halfDepth;
            flips.push({ holder: holder, dir: side * s0, front: role === 'flipF' });
          } else {
            holder.position.set(cx - bx + po[0], cy - jy + po[1], side * cz);
            mesh.position.x -= po[0]; mesh.position.y -= po[1];
          }
          if (tilt) { holder.add(tilt); tilt.add(mesh); } else holder.add(mesh);
          if (tilt && p.swing) {
            var sw = p.swing;
            swings.push({ n: tilt, axis: sw.axis, base: tilt.rotation[sw.axis], amp: sw.amp * Math.PI / 180, rate: sw.rate,
                          lo: sw.min == null ? null : sw.min * Math.PI / 180, hi: sw.max == null ? null : sw.max * Math.PI / 180,
                          ph: sw.phase + (side < 0 ? Math.PI * sw.alt : 0), sg: sw.axis === 'z' ? 1 : side });
          }
          parent.add(holder);
          if (p.kind !== 'free') meshes.push({ mesh: mesh, k: k, part: p, plane: isPlane });
          else meshes.push({ mesh: mesh, k: k, part: p, free: true });
        });
      });

      obj.userData = {
        reef: true, model: m, skin: skin, swimRoot: swimRoot, bob: bob, bones: bones,
        pects: pects, flips: flips, meshes: meshes, swings: swings, fx: [], halfH: halfH, halfW: S.W / 2,
        phase: num(opts.phase, 0), roll: 0
      };
      obj.scale.setScalar(m.scale * num(opts.scale, 1));
      (opts.effects || []).forEach(function (e) { if (e) attachEffect(obj, e); });
      return obj;
    };

    /* ───────── 움직임 ───────── */
    // 헤엄 경로 위치. lane.path: loop(8자 고리) / wander(떠돌기) / still(제자리)
    var WP = new WeakMap();
    function waypoints(lane) {
      var got = WP.get(lane);
      var sig = [lane.cx, lane.cy, lane.cz, lane.rx, lane.ry, lane.rz, lane.seed, lane.ph].join(',');
      if (got && got.sig === sig) return got.pts;
      var rnd = seeded(hashStr('wp' + sig)), pts = [];
      for (var i = 0; i < 7; i++) {
        var a = i / 7 * PI2 + (rnd() - 0.5) * 0.9, r = 0.45 + rnd() * 0.55;
        pts.push([num(lane.cx, 0) + Math.cos(a) * r * num(lane.rx, 8),
                  num(lane.cy, 0) + (rnd() * 2 - 1) * num(lane.ry, 2),
                  num(lane.cz, 0) + Math.sin(a) * r * num(lane.rz, 6)]);
      }
      WP.set(lane, { sig: sig, pts: pts });
      return pts;
    }
    function cr(p0, p1, p2, p3, t) {
      var t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    }
    kit.lanePos = function (lane, time, out) {
      var ph = num(lane.ph, 0), a = time * num(lane.sp, 0.2) + ph;
      var cx = num(lane.cx, 0), cy = num(lane.cy, 0), cz = num(lane.cz, 0);
      if (lane.path === 'still') return out.set(cx, cy, cz);
      if (lane.path === 'wander') {
        var pts = waypoints(lane), N = pts.length, u = a * N / PI2 * 0.8;
        var i = Math.floor(u), f = u - i;
        var P = function (k) { return pts[((i + k) % N + N) % N]; };
        return out.set(cr(P(-1)[0], P(0)[0], P(1)[0], P(2)[0], f),
                       cr(P(-1)[1], P(0)[1], P(1)[1], P(2)[1], f),
                       cr(P(-1)[2], P(0)[2], P(1)[2], P(2)[2], f));
      }
      return out.set(cx + Math.sin(a) * num(lane.rx, 8),
                     cy + Math.sin(a * 1.7 + ph) * num(lane.ry, 2),
                     cz + Math.cos(a * 0.82) * num(lane.rz, 6));
    };

    // 경로를 따라 놓고, 가는 방향을 보게 하고, 돌 때 살짝 기울이기
    var _tmp = new THREE.Vector3();
    kit.steer = function (obj, lane, time) {
      var u = obj.userData, m = u.model;
      var st = time * m.swim.speed;
      kit.lanePos(lane, st, obj.position);
      kit.lanePos(lane, st + 0.05, _tmp);
      var d = _tmp.sub(obj.position);
      var flat = Math.hypot(d.x, d.z);
      if (flat < 1e-5 && Math.abs(d.y) < 1e-5) return;
      obj.rotation.y = Math.atan2(-d.z, d.x);
      obj.rotation.z = Math.atan2(d.y, flat || 1e-4) * (m.motion === 'turtle' ? 0.6 : 0.75);
      var yaw = obj.rotation.y;
      if (u.prevYaw !== undefined) {
        var dy = Math.atan2(Math.sin(yaw - u.prevYaw), Math.cos(yaw - u.prevYaw));
        u.roll = u.roll * 0.9 + dy * 8;
      }
      u.prevYaw = yaw;
      var lim = 0.4 * m.swim.roll;
      obj.rotation.x = clamp(u.roll, -lim, lim);
    };

    // 무리짓기: 앞 물고기가 지나온 길을 몸길이 몇 배만큼 뒤에서 따라감
    // lane.follow: 따라갈 앞 물고기 순서, lane.gap: 몸길이 몇 배 뒤, lane.side: 옆으로 비킬 정도 (-1 왼쪽 ~ 1 오른쪽)
    // lane.sway: 앞뒤로 밀고 당기는 정도 (몸길이 배수), 박자가 다르면 서로 앞서거니 뒤서거니 함
    // lane.rise: 위아래로 비킬 정도 (몸길이 배수, + 위 / - 아래)
    var _bp = new THREE.Vector3(), _bq = new THREE.Vector3(), _ahead = new THREE.Vector3();
    function bodyLen(obj) {
      var u = obj.userData;
      if (!u.bodyLen) {
        var box = new THREE.Box3().setFromObject(obj), sz = box.getSize(new THREE.Vector3());
        u.bodyLen = Math.max(0.5, Math.max(sz.x, sz.z));
      }
      return u.bodyLen;
    }
    // 길 위에서 st 시점보다 거리 dist만큼 뒤 (앞 물고기가 그만큼 전에 있던 곳)
    function behind(lane, st, dist, out) {
      kit.lanePos(lane, st, _bp);
      var went = 0, step = 0.01, k = st;
      for (var i = 0; i < 4000 && went < dist; i++) {
        k -= step;
        kit.lanePos(lane, k, _bq);
        went += _bq.distanceTo(_bp);
        _bp.copy(_bq);
      }
      return out.copy(_bp);
    }
    kit.follow = function (obj, leader, time, t) {
      var lane = obj.userData.lane || {}, lead = leader.userData, m = lead.model;
      var L = bodyLen(leader), st = time * m.swim.speed;
      var gap = num(lane.gap, 1.2) * L + Math.sin(t * 0.6 + num(lane.ph, 0)) * num(lane.sway, 0.4) * L;
      behind(lead.lane, st, Math.max(0.6 * L, gap), obj.position);
      behind(lead.lane, st, Math.max(0.6 * L, gap) - 0.3, _ahead);
      var d = _ahead.sub(obj.position), flat = Math.hypot(d.x, d.z) || 1e-4;
      // 가는 방향의 옆쪽으로 살짝 비켜서 겹치지 않게
      var sx = -d.z / flat, sz = d.x / flat, off = num(lane.side, 0) * L * 0.45;
      obj.position.x += sx * off; obj.position.z += sz * off;
      // 높이 차이: lane.rise(몸길이 배수)만큼 위아래로 비키고, 천천히 오르내림
      obj.position.y += (num(lane.rise, 0) + Math.sin(t * 0.5 + num(lane.ph, 0)) * 0.18) * L;
      obj.rotation.y = Math.atan2(-d.z, d.x);
      obj.rotation.z = Math.atan2(d.y, flat) * 0.75;
      var u = obj.userData, yaw = obj.rotation.y;
      if (u.prevYaw !== undefined) u.roll = u.roll * 0.9 + Math.atan2(Math.sin(yaw - u.prevYaw), Math.cos(yaw - u.prevYaw)) * 8;
      u.prevYaw = yaw;
      var lim = 0.4 * u.model.swim.roll;
      obj.rotation.x = clamp(u.roll, -lim, lim);
    };

    // 몸 움직임: 꼬리 흔들기, 지느러미, 거북 발, 둥실둥실
    kit.animate = function (obj, t, mul) {
      mul = mul || {};
      var flap = mul.flap == null ? 1 : mul.flap;
      var u = obj.userData, m = u.model, s = m.swim, ph = u.phase, k;
      if (m.motion === 'fish') {
        var beat = t * s.beat * PI2 * flap + ph * 3, wag = s.wag, bend = s.bend;
        u.swimRoot.rotation.y = Math.sin(beat + 0.4) * wag * bend * 0.17;
        u.bones.body.rotation.y = Math.sin(beat - 0.9) * wag * bend * 0.43;
        u.bones.stock.rotation.y = Math.sin(beat - 1.9) * wag * (0.25 + 0.6 * bend);
        u.bones.caudal.rotation.y = Math.sin(beat - 2.7) * wag * 0.95;
        u.bob.position.y = Math.sin(beat * 0.25) * s.bob * 0.3;
      } else if (m.motion === 'turtle') {
        var tb = t * s.beat * PI2 * flap + ph * 2;
        u.bob.position.y = Math.sin(tb * 0.8) * s.bob;
        u.bob.rotation.z = Math.sin(tb * 0.6 + 1.2) * 0.05;
        var amp = s.wag / 0.5;
        for (k = 0; k < u.flips.length; k++) {
          var g = u.flips[k];
          g.holder.rotation.x = g.dir * Math.sin(tb + (g.front ? 0 : Math.PI * 0.9)) * (g.front ? 0.5 : 0.32) * amp;
          g.holder.rotation.y = Math.sin(tb * 0.5 + (g.front ? 0 : 2.8)) * 0.12;
        }
      } else if (m.motion === 'float') {
        u.bob.position.y = Math.sin(t * s.beat * PI2 + ph) * s.bob * 2;
        u.bob.rotation.z = Math.sin(t * s.beat * PI2 * 0.7 + ph) * 0.06;
      } else if (m.motion === 'spin') {
        u.swimRoot.rotation.y = t * s.beat * PI2 * 0.5 + ph;
        u.bob.position.y = Math.sin(t * s.beat * PI2 + ph) * s.bob * 2;
      }
      if (m.motion !== 'turtle' && u.flips.length) {
        var tb2 = t * s.beat * PI2 * flap + ph;
        for (k = 0; k < u.flips.length; k++) {
          var g2 = u.flips[k];
          g2.holder.rotation.x = g2.dir * Math.sin(tb2 + (g2.front ? 0 : 2.8)) * 0.4;
        }
      }
      if (u.pects.length && s.pect > 0) {
        var pf = t * 5.0 * flap * s.pect + ph;
        for (k = 0; k < u.pects.length; k++) {
          var pv = u.pects[k];
          pv.rotation.y = pv.userData.side * (0.42 + Math.sin(pf + k * 0.7) * 0.42) * s.pectAmp;
          pv.rotation.z = Math.sin(pf * 0.7 + k) * 0.16 * s.pectAmp;
        }
      }
      // 턱을 천천히 벌렸다 닫기
      // 흔들리는 지느러미 (FINS 슬라이더 만큼 크게)
      if (u.swings) for (var si = 0; si < u.swings.length; si++) {
        var sv = u.swings[si];
        var sw0 = Math.sin(t * sv.rate * PI2 + ph + sv.ph);
        // min/max가 있으면 그 사이를 오감 (z축: -는 뒤로, +는 앞으로)
        var off = sv.lo == null ? sv.amp * sw0 : sv.lo + (sv.hi - sv.lo) * (0.5 + 0.5 * sw0);
        sv.n.rotation[sv.axis] = sv.base + sv.sg * off * flap;
      }
      if (u.bones.jaw && m.jaw) {
        var jw = m.jaw, jk;
        if (jw.close == null) jk = 0.5 + 0.5 * Math.sin(t * jw.rate * PI2 + ph);
        else {
          // 천천히 벌리고 빠르게 닫기
          var ju = ((t * jw.rate + ph / PI2) % 1 + 1) % 1, jo = 1 - jw.close;
          jk = ju < jo ? 0.5 - 0.5 * Math.cos(Math.PI * ju / jo) : 0.5 + 0.5 * Math.cos(Math.PI * (ju - jo) / jw.close);
        }
        var ja = jw.open + jw.amp * jk;
        u.bones.jaw.rotation.z = -ja * Math.PI / 180;
      }
      var dt = u.lastT == null ? 0 : clamp(t - u.lastT, 0, 0.1);
      u.lastT = t;
      for (k = 0; k < u.fx.length; k++) u.fx[k].update(t, dt, mul);
    };

    /* ───────── 이펙트 ───────── */
    var SWIRLS = {};
    // 전기 무늬 그림: 구불구불한 선을 이어서 그림. 가장자리가 이어져서 반복해도 티가 안 남
    function swirlFor(e) {
      var P = e.params || {};
      var key = e.id + '|' + P.color + '|' + P.density;
      if (SWIRLS[key]) { SWIRLS[key].speed = num(P.speed, 0.08); return SWIRLS[key].tex; }
      var W = 64, H = 64, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
      var base = hexRgb(P.color || '#4E38FF');
      var SH = [0.28, 0.5, 0.75, 1].map(function (k, i) {
        var c = base.map(function (v) { return v * k; });
        if (i === 3) c = c.map(function (v) { return v + (255 - v) * 0.2; });
        return { c: c, a: [60, 120, 185, 232][i] };
      });
      var rnd = seeded(hashStr(key));
      function stamp(x, y, s) {
        x = ((x % W) + W) % W; y = ((y % H) + H) % H;
        var o = ((y | 0) * W + (x | 0)) * 4;
        if (s.a <= d[o + 3]) return;
        d[o] = s.c[0]; d[o + 1] = s.c[1]; d[o + 2] = s.c[2]; d[o + 3] = s.a;
      }
      var lines = Math.round(num(P.density, 20));
      for (var f = 0; f < lines; f++) {
        var x = rnd() * W, y = rnd() * H, ang = rnd() * PI2, len = 18 + rnd() * 32;
        for (var s = 0; s < len; s++) {
          ang += (rnd() - 0.5) * 1.5; x += Math.cos(ang); y += Math.sin(ang);
          stamp(x, y, SH[3]);
          if (rnd() < 0.58) stamp(x + (rnd() < 0.5 ? -1 : 1), y, SH[2]);
          if (rnd() < 0.32) stamp(x, y + (rnd() < 0.5 ? -1 : 1), SH[1]);
          if (rnd() < 0.17) stamp(x + (rnd() < 0.5 ? -1 : 1), y + (rnd() < 0.5 ? -1 : 1), SH[0]);
          if (rnd() < 0.06) {
            var bx = x, by = y, ba = ang + (rnd() - 0.5) * 2.4;
            for (var q = 0; q < 6; q++) { bx += Math.cos(ba); by += Math.sin(ba); stamp(bx, by, SH[2]); }
          }
        }
      }
      for (var p = 0; p < lines * 3; p++) stamp(rnd() * W, rnd() * H, SH[rnd() < 0.3 ? 3 : 1]);
      ctx.putImageData(img, 0, 0);
      var tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
      tex.encoding = THREE.sRGBEncoding;
      SWIRLS[key] = { tex: tex, speed: num(P.speed, 0.08) };
      return tex;
    }

    // 화면 한 번 그릴 때마다 한 번: 전기 무늬를 흘러가게
    kit.tick = function (t, mul) {
      var k = (mul && mul.charge != null) ? mul.charge : 1;
      Object.keys(SWIRLS).forEach(function (key) {
        var s = SWIRLS[key];
        s.tex.offset.x = (t * s.speed * k) % 1;
        s.tex.offset.y = (t * s.speed * 0.64 * k) % 1;
      });
    };

    function attachEffect(obj, e) {
      var u = obj.userData, P = e.params || {}, ph = u.phase || 0, fx = null;
      if (e.type === 'charge') {
        var tex = swirlFor(e), inflate = num(P.inflate, 0.3), op = num(P.opacity, 0.55), fl = num(P.flicker, 0.22);
        var mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: op });
        var finMat = new THREE.MeshBasicMaterial({ map: tex, alphaMap: u.skin.mask, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: op });
        var shells = [];
        u.meshes.forEach(function (it) {
          if (it.free) return;
          var g = it.plane ? planeGeo(u.skin, it.k, it.part, inflate * 0.8, true) : boxGeo(u.skin, it.k, it.part, inflate, true);
          var a = new THREE.Mesh(g, it.plane ? finMat : mat);
          a.position.copy(it.mesh.position); a.rotation.copy(it.mesh.rotation);
          a.renderOrder = 2;
          it.mesh.parent.add(a);
          if (!it.plane) shells.push(a);
        });
        fx = {
          type: 'charge', parts: [], mats: [mat, finMat],
          update: function (t, dt, mul) {
            var k = (mul && mul.charge != null) ? mul.charge : 1;
            var o = op * (1 - fl + fl * Math.sin(t * 14.3 + ph * 5)) * Math.min(1, k + 0.001);
            mat.opacity = finMat.opacity = o;
            var s = 1 + 0.025 * Math.sin(t * 6.2 + ph);
            for (var i = 0; i < shells.length; i++) shells[i].scale.setScalar(s);
          }
        };
      } else if (e.type === 'glow') {
        var gc = kit.color(P.color || '#FFB070'), st = num(P.strength, 0.35), rate = num(P.rate, 1.2), glowMats = [], halos = [];
        var only = Array.isArray(P.parts) && P.parts.length ? P.parts : null;
        var hs = num(P.halo, 0), hop = num(P.haloOpacity, 0.3);
        u.meshes.forEach(function (it) {
          if (only && only.indexOf(it.part.id) < 0) return;
          it.mesh.material = it.mesh.material.clone();
          it.mesh.material.emissive = gc.clone();
          glowMats.push(it.mesh.material);
          // 상자 둘레에 빛 껍질 두 겹
          if (hs > 0 && !it.plane && !it.free) {
            [1, 2.2].forEach(function (k2, n) {
              var hm = new THREE.MeshBasicMaterial({ color: gc.clone(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
              var e2 = hs * k2, hg = new THREE.BoxBufferGeometry(it.part.w + e2 * 2, it.part.h + e2 * 2, it.part.d + e2 * 2);
              var h1 = new THREE.Mesh(hg, hm);
              h1.position.copy(it.mesh.position); h1.rotation.copy(it.mesh.rotation); h1.renderOrder = 3;
              it.mesh.parent.add(h1); halos.push({ m: hm, k: n ? 0.45 : 1 });
            });
          }
        });
        fx = {
          type: 'glow', mats: glowMats,
          update: function (t) {
            var w = 0.5 + 0.5 * Math.sin(t * rate * PI2 + ph);
            var v = st * (0.55 + 0.45 * w);
            for (var i = 0; i < glowMats.length; i++) glowMats[i].emissiveIntensity = v;
            for (var j = 0; j < halos.length; j++) halos[j].m.opacity = hop * halos[j].k * (0.35 + 0.65 * w);
          }
        };
      } else if (e.type === 'bubbles') {
        var bmat = new THREE.MeshLambertMaterial({ color: kit.color(P.color || '#DDF4FF'), transparent: true, opacity: 0.75 });
        var bgeo = new THREE.BoxBufferGeometry(1, 1, 1), group = new THREE.Group(), pool = [], acc = 0;
        var life = num(P.life, 2.4), rateB = num(P.rate, 1.5), size = num(P.size, 0.4), rise = num(P.rise, 3);
        var mouth = new THREE.Vector3(u.halfW, 0, 0), wp = new THREE.Vector3();
        for (var i = 0; i < 12; i++) { var bm = new THREE.Mesh(bgeo, bmat); bm.visible = false; group.add(bm); pool.push({ m: bm, age: 99, wob: i * 1.7 }); }
        fx = {
          type: 'bubbles', group: group,
          update: function (t, dt) {
            if (!obj.parent) return;
            if (group.parent !== obj.parent) obj.parent.add(group);
            acc += dt * rateB;
            while (acc >= 1) {
              acc -= 1;
              for (var q = 0; q < pool.length; q++) if (pool[q].age >= life) {
                obj.localToWorld(wp.copy(mouth)); obj.parent.worldToLocal(wp);
                pool[q].m.position.copy(wp); pool[q].age = 0; pool[q].m.visible = true; break;
              }
            }
            var sc = obj.scale.x * size;
            for (var r = 0; r < pool.length; r++) {
              var b = pool[r]; if (b.age >= life) { b.m.visible = false; continue; }
              b.age += dt;
              b.m.position.y += rise * obj.scale.x * dt;
              b.m.position.x += Math.sin(t * 3 + b.wob) * 0.4 * obj.scale.x * dt;
              b.m.scale.setScalar(sc * (0.6 + 0.4 * Math.min(1, b.age * 2)) * (1 - 0.5 * b.age / life));
            }
          },
          dispose: function () { if (group.parent) group.parent.remove(group); }
        };
      } else if (e.type === 'sparkle') {
        var smat = new THREE.MeshBasicMaterial({ color: kit.color(P.color || '#FFF1A8'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
        var sgeo = new THREE.BoxBufferGeometry(1, 1, 1), sp = [], rndS = seeded(hashStr(e.id + ph));
        var cnt = Math.round(num(P.count, 8)), rad = num(P.radius, 1.4), rateS = num(P.rate, 2), ss = num(P.size, 0.5);
        for (var j = 0; j < cnt; j++) {
          var sm = new THREE.Mesh(sgeo, smat);
          var a1 = rndS() * PI2, a2 = (rndS() - 0.5) * Math.PI;
          sm.position.set(Math.cos(a1) * Math.cos(a2) * u.halfW * rad, Math.sin(a2) * u.halfH * rad, Math.sin(a1) * Math.cos(a2) * u.halfH * rad);
          u.swimRoot.add(sm); sp.push({ m: sm, o: rndS() * PI2 });
        }
        fx = {
          type: 'sparkle',
          update: function (t) {
            for (var i = 0; i < sp.length; i++) {
              var v = Math.sin(t * rateS * PI2 * 0.5 + sp[i].o);
              sp[i].m.scale.setScalar(v > 0 ? v * ss : 0.0001);
            }
          }
        };
      }
      if (fx) { fx.id = e.id; u.fx.push(fx); }
      return fx;
    }
    kit.attachEffect = attachEffect;

    kit.setEffectVisible = function (obj, type, on) {
      (obj.userData.fx || []).forEach(function (f) {
        if (f.type === type && f.mats) f.mats.forEach(function (m) { m.visible = on; });
      });
    };

    // 장면에서 빼기 (거품처럼 따로 붙은 것도 같이)
    kit.dispose = function (obj) {
      (obj.userData.fx || []).forEach(function (f) { if (f.dispose) f.dispose(); });
      if (obj.parent) obj.parent.remove(obj);
    };

    /* ───────── 조명 ───────── */
    kit.lights = function (scene) {
      scene.add(new THREE.HemisphereLight(0xE8EFFF, 0xFFE6D6, 1.0));
      var key = new THREE.DirectionalLight(0xFFFFFF, 0.62); key.position.set(1.0, 1.5, 0.9); scene.add(key);
      var fill = new THREE.DirectionalLight(0xD2DEFF, 0.3); fill.position.set(-1.1, -0.3, -0.8); scene.add(fill);
    };

    /* ───────── 손가락으로 누른 물고기 찾기 ───────── */
    var ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    kit.pick = function (camera, nx, ny, roots) {
      ndc.set(nx, ny); ray.setFromCamera(ndc, camera);
      var hits = ray.intersectObjects(roots, true);
      for (var i = 0; i < hits.length; i++) {
        var o = hits[i].object;
        while (o && !(o.userData && o.userData.reef)) o = o.parent;
        if (o) return o;
      }
      return null;
    };

    /* ───────── 작은 미리보기 그림 (옆모습) ───────── */
    kit.thumb = function (m, px, variant) {
      px = px || 3;
      var S = new Sampler(m), cv = document.createElement('canvas');
      cv.width = S.W * px; cv.height = S.H * px;
      var c = cv.getContext('2d');
      for (var r = 0; r < S.H; r++) for (var q = 0; q < S.W; q++) {
        var ch = S.side(q, r); if (!ch) continue;
        c.fillStyle = rgbHex(tint(m.palette[ch] || '#ff00ff', variant, 0));
        c.fillRect(q * px, r * px, px, px);
      }
      m.parts.forEach(function (p) {
        if (p.kind === 'plane' && p.paint && (p.axis || 'z') === 'z') {
          for (var j = 0; j < p.h; j++) for (var i = 0; i < p.w; i++) {
            var ch2 = paintAt(p, i, j); if (!ch2) continue;
            c.fillStyle = rgbHex(tint(m.palette[ch2] || ch2, variant, 0));
            c.fillRect((p.x + i) * px, (p.y + j) * px, px, px);
          }
        }
      });
      return cv;
    };

    /* ───────── 말풍선과 글꼴 ───────── */
    function addLink(href, id) {
      if (!href || document.getElementById(id)) return;
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.id = id;
      document.head.appendChild(l);
    }
    function googleHref(list) {
      list = (list || []).filter(Boolean);
      if (!list.length) return '';
      return 'https://fonts.googleapis.com/css2?' + list.map(function (f) {
        return 'family=' + encodeURIComponent(f).replace(/%20/g, '+').replace(/%3A/gi, ':').replace(/%3B/gi, ';').replace(/%40/gi, '@');
      }).join('&') + '&display=swap';
    }
    kit.googleHref = googleHref;

    kit.bubbleCss = function (b, family) {
      var B = Math.max(1, Math.round(num(b.px, 3))), bg = b.bg, bd = b.border;
      var edge = b.pixel
        ? 'box-shadow:0 -' + B + 'px 0 0 ' + bd + ',0 ' + B + 'px 0 0 ' + bd + ',-' + B + 'px 0 0 0 ' + bd + ',' + B + 'px 0 0 0 ' + bd + ';border-radius:0;'
        : 'border:' + B + 'px solid ' + bd + ';border-radius:' + (B * 4) + 'px;';
      var T = Math.max(B, 3);   // 꼬리 크기 (테두리가 얇아도 꼬리는 보이게)
      var tail = b.tail
        ? '.reef-say::after{content:"";position:absolute;left:12px;bottom:-' + (T * 2 + B) + 'px;width:' + (T * 2) + 'px;height:' + (T * 2) + 'px;background:' + bg + ';' +
          'box-shadow:' + B + 'px 0 0 0 ' + bd + ',-' + B + 'px 0 0 0 ' + bd + ',0 ' + B + 'px 0 0 ' + bd + ';}'
        : '';
      return '.reef-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:4}' +
        '.reef-say{position:absolute;left:0;top:0;max-width:' + num(b.maxWidth, 190) + 'px;padding:' + num(b.pad, 8) + 'px ' + (num(b.pad, 8) + 2) + 'px;' +
        'background:' + bg + ';color:' + b.ink + ';font-family:' + (family || 'system-ui,sans-serif') + ';font-size:' + num(b.size, 14) + 'px;line-height:1.35;' +
        'white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;width:max-content;' + edge + '}' +
        '.reef-say .in{display:block}' +
        (b.anim === 'pop' ? '.reef-say .in{animation:reefPop .22s steps(4,end)}@keyframes reefPop{from{transform:scale(.55);opacity:0}to{transform:none;opacity:1}}' : '') +
        '.reef-say.out{opacity:0;transition:opacity .25s}' + tail;
    };

    kit.applyStyle = function (style) {
      style = style || {};
      var f = style.font || {}, t = style.title || {};
      addLink(googleHref(f.google), 'reef-font-' + hashStr(JSON.stringify(f.google || [])));
      addLink(googleHref(t.google), 'reef-tfont-' + hashStr(JSON.stringify(t.google || [])));
      if (f.cssUrl) addLink(f.cssUrl, 'reef-fcss-' + hashStr(f.cssUrl));
      var el = document.getElementById('reef-say-style');
      if (!el) { el = document.createElement('style'); el.id = 'reef-say-style'; document.head.appendChild(el); }
      el.textContent = kit.bubbleCss(style.bubble || {}, f.family);
      if (t.family) document.documentElement.style.setProperty('--reef-title-font', t.family);
    };

    // 말풍선 관리: say(물고기, 말) 하면 물고기 머리 위에 떠 있다가 사라짐
    kit.Talk = function (container, camera, style) {
      var layer = document.createElement('div'); layer.className = 'reef-layer';
      container.appendChild(layer);
      var list = [], v = new THREE.Vector3(), secs = num(style && style.bubble && style.bubble.duration, 3.2);
      function say(obj, text, sec) {
        if (!obj || !text) return;
        for (var i = list.length - 1; i >= 0; i--) if (list[i].obj === obj) { list[i].el.remove(); list.splice(i, 1); }
        var el = document.createElement('div'); el.className = 'reef-say';
        var inner = document.createElement('span'); inner.className = 'in'; inner.textContent = text;
        el.appendChild(inner); layer.appendChild(el);
        list.push({ obj: obj, el: el, until: performance.now() + (sec || secs) * 1000 });
      }
      function update() {
        var now = performance.now(), W = container.clientWidth, H = container.clientHeight;
        for (var i = list.length - 1; i >= 0; i--) {
          var it = list[i];
          if (now > it.until + 300 || !it.obj.parent) { it.el.remove(); list.splice(i, 1); continue; }
          if (now > it.until) it.el.classList.add('out');
          var u = it.obj.userData;
          v.set(0, (u.halfH || 4) + 1.5, 0);
          it.obj.localToWorld(v);
          v.project(camera);
          if (v.z > 1 || v.z < -1) { it.el.style.visibility = 'hidden'; continue; }
          it.el.style.visibility = 'visible';
          var x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
          it.el.style.left = Math.round(x - 18) + 'px';
          it.el.style.top = Math.round(y - it.el.offsetHeight - 10) + 'px';
        }
      }
      function clear() { list.forEach(function (it) { it.el.remove(); }); list = []; }
      function setStyle(st) { secs = num(st && st.bubble && st.bubble.duration, 3.2); }
      return { say: say, update: update, clear: clear, setStyle: setStyle, layer: layer };
    };

    // 물고기가 할 말 고르기: 경로에 적힌 말 → 없으면 종의 기본 말
    kit.linesFor = function (obj) {
      var u = obj.userData, lane = u.lane || {};
      var L = (lane.says && lane.says.length) ? lane.says : (lane.say && lane.say.length ? lane.say : u.model.says);
      return (L || []).filter(function (s) { return String(s).trim(); });
    };
    kit.nextLine = function (obj) {
      var L = kit.linesFor(obj); if (!L.length) return '';
      var u = obj.userData; u.sayIdx = ((u.sayIdx == null ? -1 : u.sayIdx) + 1) % L.length;
      return L[u.sayIdx];
    };

    return kit;
  }

  root.ReefKit = ReefKit;
})(window);
