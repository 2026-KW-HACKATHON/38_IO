/*!
 * reef-items.js — REEF 아이템 묶음 (한 파일)
 * 들어 있는 것 (각 부분은 원래 파일 내용 그대로)
 *   1. ReefBinary   — 0·1 꼬리 흔적 · 인공지능융합대학
 *   2. ReefElectric — 감전 · 전자정보공과대학
 *   3. ReefPencil   — 연필
 *   4. ReefAtom     — 원자 궤도 · 자연과학대학
 *   5. ReefItems    — 위 아이템들을 물고기 크기에 맞춰 붙이는 연결판
 * 쓰는 법: 페이지에서 reef-kit.js 다음에 reef-items.js 를 script 태그로 불러오면 됨
 * 새 아이템: 이 파일 맨 아래(5번 앞)에 같은 모양으로 한 덩어리 붙이고 ReefItems.register({...})
 */

/* ═════════════════ 1. 0·1 꼬리 흔적 ═════════════════ */
/*!
 * reef-binary.js — REEF 바이너리 꼬리 흔적(trail) 이펙트 · 인공지능융합대학 테마
 * 물고기 코드와 완전히 분리된 모듈. three.js(r128+) 전역 THREE 만 있으면 됨.
 *
 * 방식: 물고기가 헤엄친 거리만큼 꼬리 끝에서 픽셀 글꼴 0/1 을 하나씩 떨어뜨린다.
 *       막 나온 글자는 흰 초록으로 밝고, 시간이 지나면 초록 → 어두운 초록으로 식으며
 *       아래로 천천히 흘러내리다(매트릭스 비) 사라진다. 가끔 0↔1 이 바뀌어 깜빡인다.
 *       글자들은 물고기가 아니라 장면(scene)에 남기 때문에 헤엄 경로가 코드로 그려진다.
 *
 * 사용법
 *   const fx = ReefBinary.attach(fishObject3D, scene, ReefBinary.PRESETS["trail-ai"]);
 *   // 매 프레임:  fx.update(시간초);
 *   // 제거:       fx.dispose();
 *
 * reef-data.json 최상위 effects 배열에 PRESETS["trail-ai"] 를 넣고,
 * lane.effects 에 "trail-ai" 를 쓰면 됨.
 */
(function (root) {
  'use strict';

  const PRESETS = {
    'trail-ai': {
      id: 'trail-ai',
      type: 'trail',
      label: '인공지능융합대학',
      colors: {
        lead: '#E4FFEF',    // 막 나온 글자 (흰 초록)
        main: '#3CF08E',    // 기본 초록
        dim: '#138A4E'      // 식어가는 초록
      },
      glyphs: '01',         // 떨어뜨릴 글자 (픽셀 글꼴에 있는 것: 0 1)
      size: 1.6,            // 글자 높이 (물고기 칸 단위 · 물고기 scale 반영)
      spacing: 0.7,         // 이만큼 헤엄칠 때마다 한 글자 (칸 단위)
      idle: 3,              // 가만히 있어도 초당 떨어지는 글자 수
      column: 0.3,          // 한 번에 세로로 2~3글자 줄을 흘릴 확률
      life: [1.4, 2.4],     // 글자 수명(초) 최소, 최대
      fall: [0.5, 1.1],     // 흘러내리는 속도 (칸/초)
      spread: 0.9,          // 꼬리 둘레로 흩어지는 폭 (칸)
      flip: 3,              // 초당 0↔1 바뀔 확률 배수
      max: 90,              // 물고기 한 마리당 최대 글자 수
      opacity: 1
    }
  };

  // ── 5x7 픽셀 글꼴 ──
  const FONT = {
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.']
  };
  const texCache = {};
  function glyphTexture(ch) {
    if (texCache[ch]) return texCache[ch];
    const THREE = root.THREE, rows = FONT[ch] || FONT['0'];
    const c = document.createElement('canvas'); c.width = 7; c.height = 9;   // 1px 여백
    const g = c.getContext('2d'); g.fillStyle = '#fff';
    rows.forEach((r, y) => [...r].forEach((v, x) => { if (v === '#') g.fillRect(x + 1, y + 1, 1, 1); }));
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return (texCache[ch] = t);
  }

  function attach(target, scene, preset, o = {}) {
    const THREE = root.THREE;
    const opt = Object.assign({}, PRESETS['trail-ai'], preset || {});
    opt.colors = Object.assign({}, PRESETS['trail-ai'].colors, (preset || {}).colors || {});
    const cLead = new THREE.Color(opt.colors.lead), cMain = new THREE.Color(opt.colors.main), cDim = new THREE.Color(opt.colors.dim);

    // 꼬리 끝 위치 (물고기 자기 좌표). 머리는 +x 방향이라는 REEF 규칙 사용.
    let tail;
    if (o.tail) tail = new THREE.Vector3(...o.tail);
    else {
      target.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(target.matrixWorld).invert();
      const box = new THREE.Box3().setFromObject(target).applyMatrix4(inv);
      tail = new THREE.Vector3(box.min.x, (box.min.y + box.max.y) / 2, 0);
    }
    const ws = new THREE.Vector3(); target.getWorldScale(ws);
    const unit = o.unit || 1;                     // 1칸이 월드에서 몇인지 (물고기 scale)

    const group = new THREE.Group(); scene.add(group);
    const pool = [], live = [];
    for (let i = 0; i < opt.max; i++) {
      const m = new THREE.SpriteMaterial({ map: glyphTexture('0'), transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(m); s.visible = false; group.add(s);
      pool.push({ s, m, age: 0, life: 1, vy: 0, vx: 0, vz: 0, ch: '0' });
    }
    const gw = opt.size * unit * 7 / 9, gh = opt.size * unit;

    const wp = new THREE.Vector3(), last = new THREE.Vector3();
    let started = false, acc = 0, idleAcc = 0, lastT = null, enabled = true;

    function spawn(pos, t, offsetY) {
      const p = pool.find(p => !p.s.visible);
      if (!p) return;
      const sp = opt.spread * unit;
      p.s.position.set(pos.x + (Math.random() - 0.5) * sp * 0.6, pos.y + (Math.random() - 0.5) * sp + (offsetY || 0), pos.z + (Math.random() - 0.5) * sp);
      p.age = 0;
      p.life = opt.life[0] + Math.random() * (opt.life[1] - opt.life[0]);
      p.vy = -(opt.fall[0] + Math.random() * (opt.fall[1] - opt.fall[0])) * unit;
      p.vx = (Math.random() - 0.5) * 0.15 * unit; p.vz = (Math.random() - 0.5) * 0.15 * unit;
      p.ch = opt.glyphs[(Math.random() * opt.glyphs.length) | 0];
      p.m.map = glyphTexture(p.ch); p.m.needsUpdate = true;
      p.s.scale.set(gw, gh, 1);
      p.s.visible = true; live.push(p);
    }
    function emit(pos, t) {
      if (Math.random() < opt.column) {
        const n = 2 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) spawn(pos, t, i * gh * 1.1);
      } else spawn(pos, t, 0);
    }

    return {
      group, options: opt,
      update(t) {
        const dt = lastT == null ? 0 : Math.min(0.1, t - lastT); lastT = t;
        target.updateMatrixWorld();
        wp.copy(tail).applyMatrix4(target.matrixWorld);
        if (!started) { last.copy(wp); started = true; }
        if (enabled) {
          // 헤엄친 거리만큼 글자 떨어뜨리기 → 경로가 코드로 남음
          acc += wp.distanceTo(last);
          const step = opt.spacing * unit;
          if (acc > step * 6) acc = step;            // 순간이동 방지
          const dir = new THREE.Vector3().subVectors(wp, last);
          const d = dir.length();
          while (acc >= step) {
            acc -= step;
            const k = d > 0 ? Math.max(0, 1 - acc / d) : 1;   // 이동한 선 위 위치에 찍기
            emit(new THREE.Vector3().copy(last).addScaledVector(dir, k), t);
          }
          idleAcc += dt * opt.idle;
          while (idleAcc >= 1) { idleAcc -= 1; emit(wp, t); }
        }
        last.copy(wp);

        // 글자들 늙히기
        for (let i = live.length - 1; i >= 0; i--) {
          const p = live[i];
          p.age += dt;
          const u = p.age / p.life;
          if (u >= 1) { p.s.visible = false; p.m.opacity = 0; live.splice(i, 1); continue; }
          p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
          // 색: 흰 초록(처음 12%) → 초록 → 어두운 초록
          if (u < 0.12) p.m.color.copy(cLead).lerp(cMain, u / 0.12);
          else p.m.color.copy(cMain).lerp(cDim, (u - 0.12) / 0.88);
          p.m.opacity = opt.opacity * (u < 0.08 ? u / 0.08 : Math.pow(1 - (u - 0.08) / 0.92, 0.8));
          // 가끔 0↔1 깜빡
          if (Math.random() < opt.flip * dt * 0.5) {
            p.ch = p.ch === '0' ? '1' : '0';
            p.m.map = glyphTexture(p.ch);
          }
        }
      },
      setEnabled(v) { enabled = !!v; },
      clear() { live.forEach(p => { p.s.visible = false; p.m.opacity = 0; }); live.length = 0; },
      dispose() { scene.remove(group); pool.forEach(p => p.m.dispose()); }
    };
  }

  root.ReefBinary = { PRESETS, attach, FONT };
})(typeof window !== 'undefined' ? window : globalThis);


/* ═════════════════ 2. 감전 ═════════════════ */
/*!
 * reef-electric.js — REEF 감전(charge) 이펙트 · 전자정보공과대학 테마
 * 물고기 코드와 완전히 분리된 모듈. three.js(r128+) 전역 THREE 만 있으면 됨.
 *
 * 방식: 저해상도 캔버스에 픽셀 번개(지그재그 선 + 꺾이는 곳마다 흰 불꽃)를 그리고,
 *       그 캔버스를 물고기를 감싸는 빌보드(Sprite)로 띄운다. 초당 ~12번 새로 그려서
 *       "지지직" 끊기는 느낌을 내고, 터짐 → 잦아듦 → 잠잠 주기를 반복한다.
 *
 * 사용법
 *   const fx = ReefElectric.attach(fishObject3D, ReefElectric.PRESETS["charge-eee"]);
 *   // 매 프레임:  fx.update(시간초);
 *   // 제거:       fx.dispose();
 *
 * reef-data.json 최상위 effects 배열에 PRESETS["charge-eee"] 를 그대로 넣고,
 * lane.effects 에 "charge-eee" 를 쓰면 됨.
 */
(function (root) {
  'use strict';

  const PRESETS = {
    'charge-eee': {
      id: 'charge-eee',
      type: 'charge',
      label: '전자정보공과대학',
      colors: {
        arc: '#FFD447',     // 기본 번개 선 (노랑)
        arc2: '#FFEA85',    // 밝은 레몬 섞임
        deep: '#FF9E2C',    // 끝부분 주황
        core: '#FFFDF0',    // 꺾이는 곳 흰 불꽃 (살짝 크림)
        glow: '#FFD95C'     // 번개 주변 번짐 빛
      },
      glow: {
        strength: 0.9,      // 번짐 세기 (0이면 끔)
        blur: 10,           // 번짐 반경 (글로우 텍스처 픽셀)
        speed: 22,          // 깜빡이는 속도 (Hz, 클수록 빠름)
        light: 1.4          // 물고기 몸을 비추는 점광원 세기 (0이면 끔)
      },
      res: 64,              // 텍스처 가로 픽셀 수 (작을수록 도트가 굵어짐)
      pad: 1.45,            // 물고기 크기 대비 번개 영역 배수
      fps: 12,              // 초당 다시 그리는 횟수
      arcs: [2, 5],         // 한 번에 보이는 번개 줄기 수 (최소, 최대)
      jag: 0.55,            // 지그재그 거칠기 (0~1)
      branch: 0.35,         // 가지 칠 확률
      spark: 0.5,           // 꺾임마다 흰 불꽃 찍을 확률
      cycle: 2.4,           // 터짐→잦아듦→잠잠 한 주기(초)
      quiet: 0.25,          // 주기 중 완전히 잠잠한 비율
      opacity: 1
    }
  };
  PRESETS['charge-blue'] = PRESETS['charge-eee'];

  // ── 시드 난수 ──
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  // ── 픽셀 한 칸 / 선 (Bresenham) ──
  function px(img, W, H, x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; img[i + 3] = 255;
  }
  function line(img, W, H, x0, y0, x1, y1, pick, dissolve, r) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      if (r() >= dissolve) px(img, W, H, x0, y0, pick());
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  function hex(h) { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); }

  // ── 번개 한 줄기: 두 점 사이를 여러 번 꺾은 지그재그 ──
  function bolt(a, b, jag, r) {
    const pts = [a];
    const n = 4 + Math.floor(r() * 5);
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const off = (r() - 0.5) * 2 * jag * len * 0.35;
      pts.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off]);
    }
    pts.push(b);
    return pts;
  }

  /**
   * 2D 캔버스에 한 프레임 그리기 (3D 없이도 사용 가능)
   * @param ctx    CanvasRenderingContext2D (캔버스 크기 = 픽셀 해상도)
   * @param opt    프리셋
   * @param seed   프레임 시드
   * @param power  0~1 세기 (주기에 따라 변함)
   */
  function drawFrame(ctx, opt, seed, power) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const data = ctx.createImageData(W, H), img = data.data;
    const r = rng(seed);
    if (power > 0.02) {
      const C = opt.colors, arc = hex(C.arc), arc2 = hex(C.arc2), deep = hex(C.deep), core = hex(C.core);
      const pick = () => { const v = r(); return v < 0.62 ? arc : v < 0.88 ? arc2 : deep; };
      const dissolve = Math.max(0, 0.75 - power) * 0.9;           // 약할수록 선이 끊겨 보임
      const count = Math.max(1, Math.round(opt.arcs[0] + (opt.arcs[1] - opt.arcs[0]) * power * r()));
      const cx = W / 2, cy = H / 2, rx = W * 0.40, ry = H * 0.38;
      const onRing = (ang, k) => [cx + Math.cos(ang) * rx * k, cy + Math.sin(ang) * ry * k];
      for (let i = 0; i < count; i++) {
        // 물고기 둘레 타원 위 두 점 → 몸을 가로지르거나 둘레를 타는 번개
        const a0 = r() * Math.PI * 2;
        const span = (0.5 + r() * 1.6) * (r() < 0.5 ? 1 : -1);
        const k0 = 0.75 + r() * 0.35, k1 = 0.75 + r() * 0.35;
        const pts = bolt(onRing(a0, k0), onRing(a0 + span, k1), opt.jag, r);
        for (let j = 0; j < pts.length - 1; j++) {
          line(img, W, H, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1], pick, dissolve, r);
        }
        for (let j = 1; j < pts.length - 1; j++) {
          const p = pts[j];
          // 꺾이는 곳 흰 불꽃 (2x2 + 뾰족한 끝)
          if (r() < opt.spark * (0.4 + power)) {
            px(img, W, H, p[0], p[1], core); px(img, W, H, p[0] + 1, p[1], core);
            px(img, W, H, p[0], p[1] - 1, core);
            if (r() < 0.5) px(img, W, H, p[0] - 1, p[1] + 1, core);
          }
          // 짧은 가지
          if (r() < opt.branch * power) {
            const ang = r() * Math.PI * 2, L = 3 + r() * 7;
            const q = bolt(p, [p[0] + Math.cos(ang) * L, p[1] + Math.sin(ang) * L], opt.jag, r);
            for (let k = 0; k < q.length - 1; k++) line(img, W, H, q[k][0], q[k][1], q[k + 1][0], q[k + 1][1], pick, dissolve, r);
          }
        }
      }
      // 잔불: 흩어진 불티 몇 개
      const dots = Math.round(power * 6 * r());
      for (let i = 0; i < dots; i++) px(img, W, H, cx + (r() - 0.5) * rx * 2.2, cy + (r() - 0.5) * ry * 2.2, r() < 0.5 ? deep : arc2);
    }
    ctx.putImageData(data, 0, 0);
  }

  // 주기에 따른 세기: 번쩍 터졌다가 잦아들고, 잠깐 잠잠
  function powerAt(t, opt, phase) {
    const u = ((t / opt.cycle) + phase) % 1;
    const active = 1 - opt.quiet;
    if (u > active) return 0;
    const k = u / active;
    return k < 0.12 ? 1 : Math.pow(1 - (k - 0.12) / 0.88, 1.3);
  }

  /**
   * 3D 물고기에 붙이기
   * @param target  THREE.Object3D (물고기 최상위 그룹)
   * @param preset  PRESETS 중 하나 또는 같은 형태의 객체
   * @param o       { phase: 0~1 주기 어긋남, size: [w,h] 직접 지정 }
   */
  function attach(target, preset, o = {}) {
    const THREE = root.THREE;
    const opt = Object.assign({}, PRESETS['charge-eee'], preset || {});
    opt.colors = Object.assign({}, PRESETS['charge-eee'].colors, (preset || {}).colors || {});
    opt.glow = Object.assign({}, PRESETS['charge-eee'].glow, (preset || {}).glow || {});

    // 물고기 크기 측정 (자기 좌표계 기준)
    let w, h;
    if (o.size) { [w, h] = o.size; }
    else {
      const box = new THREE.Box3().setFromObject(target), s = new THREE.Vector3();
      box.getSize(s);
      const ws = new THREE.Vector3(); target.getWorldScale(ws);
      w = Math.max(s.x, s.z) / ws.x; h = s.y / ws.y;
    }
    w *= opt.pad; h *= opt.pad;

    const res = opt.res, resH = Math.max(16, Math.round(res * h / w));
    const cv = document.createElement('canvas'); cv.width = res; cv.height = resH;
    const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: opt.opacity });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(w, h, 1);
    sprite.renderOrder = 999;
    target.add(sprite);

    // ── 글로우: 번개 그림을 부드럽게 번지게 한 텍스처를 더하기(Additive) 블렌딩으로 겹침 ──
    const G = opt.glow, GS = 4;
    const gcv = document.createElement('canvas'); gcv.width = res * GS; gcv.height = resH * GS;
    const gctx = gcv.getContext('2d');
    const gtex = new THREE.CanvasTexture(gcv);
    const gmat = new THREE.SpriteMaterial({ map: gtex, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0 });
    const gsprite = new THREE.Sprite(gmat);
    gsprite.scale.set(w * 1.06, h * 1.06, 1);
    gsprite.renderOrder = 998;
    if (G.strength > 0) target.add(gsprite);
    let light = null;
    if (G.light > 0) { light = new THREE.PointLight(opt.colors.glow, 0, Math.max(w, h) * 1.2, 2); target.add(light); }
    function drawGlow() {
      gctx.clearRect(0, 0, gcv.width, gcv.height);
      gctx.imageSmoothingEnabled = true;
      gctx.shadowColor = opt.colors.glow;
      gctx.shadowBlur = G.blur * GS * 0.5;
      const m = gcv.width * 0.03, mh = gcv.height * 0.03;   // 1.06배 스프라이트에 맞춰 살짝 안쪽에 그림
      for (let i = 0; i < 2; i++) gctx.drawImage(cv, m, mh, gcv.width - 2 * m, gcv.height - 2 * mh);
      gtex.needsUpdate = true;
    }

    const phase = o.phase != null ? o.phase : Math.random();
    let lastTick = -1, enabled = true, power = 0;
    return {
      sprite, glowSprite: gsprite, light, canvas: cv, options: opt,
      update(t) {
        if (!enabled) { sprite.visible = gsprite.visible = false; if (light) light.intensity = 0; return; }
        sprite.visible = gsprite.visible = true;
        const tick = Math.floor(t * opt.fps);
        if (tick !== lastTick) {
          lastTick = tick;
          power = powerAt(t, opt, phase);
          drawFrame(ctx, opt, tick * 7919 + ((phase * 1e4) | 0), power);
          tex.needsUpdate = true;
          if (G.strength > 0) drawGlow();
        }
        // 빠른 깜빡임: 매 렌더 프레임마다 세기를 흔듦 (번개 다시 그리기보다 훨씬 빠름)
        const f = G.speed * t * Math.PI * 2;
        const flick = 0.55 + 0.25 * Math.sin(f + phase * 9) + 0.2 * Math.sin(f * 1.73 + 1.3) * Math.sin(f * 0.61);
        const k = power * Math.max(0, Math.min(1, flick + (Math.random() - 0.5) * 0.35));
        gmat.opacity = G.strength * k;
        if (light) light.intensity = G.light * k;
      },
      setEnabled(v) { enabled = !!v; },
      dispose() {
        target.remove(sprite); target.remove(gsprite); if (light) target.remove(light);
        tex.dispose(); mat.dispose(); gtex.dispose(); gmat.dispose();
      }
    };
  }

  root.ReefElectric = { PRESETS, attach, drawFrame, powerAt };
})(typeof window !== 'undefined' ? window : globalThis);


/* ═════════════════ 3. 연필 ═════════════════ */
/*!
 * reef-pencil.js — REEF 연필 아이템 (복셀)
 * 물고기 코드와 분리된 모듈. three.js(r128+) 전역 THREE 만 있으면 됨.
 *
 * 모양: 단면 2x2칸 복셀 연필. 뒤에서부터
 *   지우개(분홍) 1칸 → 금속 띠(은색, 홈 4줄) 2칸 → 노란 몸통 9칸 → 나무 사각뿔 3칸 → 흑연 사각뿔 끝
 *   총 길이 약 16칸 (긴 연필 비율의 1/3).
 * 연필은 +x 방향을 향함(끝이 +x), 1칸 = 1, 원점 = 연필 가운데.
 *
 * 사용법
 *   const pencil = ReefPencil.build(ReefPencil.PRESETS["pencil-yellow"]);   // THREE.Group
 *   어딘가.add(pencil);  pencil.scale.setScalar(물고기scale * 0.5) 등으로 크기 조절
 *   pencil.userData.length  → 전체 길이(칸),  pencil.userData.tip → 끝 좌표
 */
(function (root) {
  'use strict';

  const PRESETS = {
    'pencil-yellow': {
      id: 'pencil-yellow',
      type: 'item',
      label: '연필',
      size: 2,                                // 단면 칸 수 (2 = 2x2)
      lengths: { eraser: 1, ferrule: 2, body: 9, wood: 3, lead: 0.9 },
      leadStart: 0.32,                        // 흑연이 시작되는 굵기 비율 (나무 끝 굵기)
      colors: {
        body: ['#F2B614', '#F5BD1C', '#EDB010', '#F7C428'],   // 노랑 (살짝씩 다른 칸 = grain)
        bodyEdge: '#D99A08',                  // 모서리 쪽 그늘
        ferrule: ['#C9CED5', '#E4E8ED'],      // 은색 (어두운 홈 / 밝은 띠 번갈아)
        ferruleGroove: '#8F969E',
        eraser: ['#F6B8B8', '#F2ABAE'],
        wood: '#E2BE8A',
        lead: '#2B2B2E'
      },
      gloss: 0.03                             // 살짝 광택 (자체 밝기)
    }
  };

  function build(preset) {
    const THREE = root.THREE;
    const opt = Object.assign({}, PRESETS['pencil-yellow'], preset || {});
    opt.lengths = Object.assign({}, PRESETS['pencil-yellow'].lengths, (preset || {}).lengths || {});
    opt.colors = Object.assign({}, PRESETS['pencil-yellow'].colors, (preset || {}).colors || {});
    const C = opt.colors, Ls = opt.lengths, S = opt.size;
    const total = Ls.eraser + Ls.ferrule + Ls.body + Ls.wood + Ls.lead;
    const x0 = -total / 2;
    const g = new THREE.Group();

    // 복셀들을 하나의 메쉬로 합침 (정점 색)
    const pos = [], nor = [], col = [];
    const tmpC = new THREE.Color();
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const P = unit.attributes.position.array, N = unit.attributes.normal.array, I = unit.index.array;
    function vox(x, y, z, sx, hex) {
      tmpC.set(hex);
      for (const i of I) {
        pos.push(P[i * 3] * sx + x, P[i * 3 + 1] + y, P[i * 3 + 2] + z);
        nor.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
        col.push(tmpC.r, tmpC.g, tmpC.b);
      }
    }
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pick = arr => arr[(rnd() * arr.length) | 0];
    const cells = [];
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) cells.push([a - S / 2 + 0.5, b - S / 2 + 0.5]);

    let x = x0;
    // 지우개
    for (let i = 0; i < Ls.eraser; i++, x++) cells.forEach(([y, z]) => vox(x + 0.5, y, z, 1, pick(C.eraser)));
    // 금속 띠: 반 칸씩 밝은 띠 / 어두운 홈 번갈아 → 2번 이미지의 홈 줄무늬
    const fSteps = Ls.ferrule * 2;
    for (let i = 0; i < fSteps; i++) {
      const hex = i % 2 ? C.ferruleGroove : pick(C.ferrule);
      cells.forEach(([y, z]) => vox(x + 0.25, y, z, 0.5, hex));
      x += 0.5;
    }
    // 노란 몸통 (모서리 칸은 가끔 그늘색 → 육각 연필 같은 결)
    for (let i = 0; i < Ls.body; i++, x++) cells.forEach(([y, z]) => vox(x + 0.5, y, z, 1, rnd() < 0.18 ? C.bodyEdge : pick(C.body)));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const voxMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color('#ffffff').multiplyScalar(opt.gloss) });
    g.add(new THREE.Mesh(geo, voxMat));

    // 사각뿔 끝: 나무(잘린 사각뿔) + 흑연(작은 사각뿔). 네 면이 몸통 옆면과 나란하도록 45° 돌림
    const R = S / 2 * Math.SQRT2;                       // 정사각형 외접 반지름
    function pyramid(rBase, rTip, len, hex, at) {
      const cg = new THREE.CylinderGeometry(rTip, rBase, len, 4, 1, false);
      cg.rotateY(Math.PI / 4);                           // 면을 축에 맞춤
      cg.rotateZ(-Math.PI / 2);                          // y축 → +x 방향
      cg.translate(at + len / 2, 0, 0);
      // 면마다 딱 끊기는 음영 (복셀 느낌의 사각뿔)
      const m = new THREE.Mesh(cg, new THREE.MeshPhongMaterial({ color: hex, flatShading: true, shininess: 12,
        specular: 0x1a1a1a, emissive: new THREE.Color(hex).multiplyScalar(opt.gloss) }));
      g.add(m); return m;
    }
    const rMid = R * opt.leadStart;
    pyramid(R, rMid, Ls.wood, C.wood, x); x += Ls.wood;
    pyramid(rMid, 0.0001, Ls.lead, C.lead, x); x += Ls.lead;

    g.userData = { length: total, tip: [x, 0, 0], back: [x0, 0, 0], options: opt };
    g.dispose = () => g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    return g;
  }

  root.ReefPencil = { PRESETS, build };
})(typeof window !== 'undefined' ? window : globalThis);


/* ═════════════════ 4. 원자 궤도 ═════════════════ */
/*!
 * reef-atom.js — REEF 원자 궤도 이펙트 · 자연과학대학 테마
 * 물고기 코드와 분리된 모듈. three.js(r128+) 전역 THREE 만 있으면 됨.
 *
 * 물고기를 원자핵 삼아 비스듬히 겹친 타원 궤도 3개(픽셀 점선)가 천천히 돌고,
 * 그 위를 빛나는 전자가 빙글빙글 돌며 짧은 빛 꼬리를 남긴다.
 * 가끔 전자 자리에서 π Σ ∫ √ ∞ 같은 수학 기호가 톡 튀어나와 떠오르다 사라진다.
 *
 * 좌표 규칙 (REEF 가이드와 동일): 옆모습 1칸 = 1, 머리 +x, 그림 중심이 원점.
 *
 * 사용법
 *   const fx = ReefAtom.attach({
 *     target: 물고기최상위그룹,   // 몸 흔들림 없는 바깥 그룹 권장
 *     spec: ReefAtom.fromSpecies(종데이터),
 *     unit: 물고기scale
 *   }, ReefAtom.PRESETS["atom-sci"]);
 *   // 매 프레임: fx.update(시간초);   제거: fx.dispose();
 */
(function (root) {
  'use strict';

  const BLUE = { electron: '#6CB8FF', core: '#FFFFFF', ring: '#7DBBFF', trail: '#4F9DFF', symbol: '#E2F0FF' };
  const RED = { electron: '#FF6B7A', core: '#FFFFFF', ring: '#FF8A95', trail: '#FF4557', symbol: '#FFE2E6' };

  const PRESETS = {
    'atom-sci': {
      id: 'atom-sci',
      type: 'atom',
      label: '자연과학대학',
      colors: BLUE,
      rings: 3,             // 궤도 수
      electrons: [2, 1, 1], // 궤도별 전자 수
      speed: 2.4,           // 전자 도는 속도 (rad/s)
      precess: 0.25,        // 궤도 전체가 천천히 도는 속도 (rad/s)
      pad: [1.3, 1.1],      // 물고기 크기보다 궤도를 얼마나 크게 (가로, 세로 칸)
      ringOpacity: 0.32,    // 궤도 점선 진하기
      ringSize: 0.22,       // 궤도 점 크기 (칸)
      glow: 1.4,            // 전자 빛 번짐 크기 배수
      brightness: 1.7,      // 전자·꼬리 밝기 배수 (1 = 기본, 클수록 하얗게 타오름)
      halo: 0.45,           // 전자 바깥 넓은 후광 진하기 (0이면 끔)
      pulse: 0.6,           // 전자 밝기 숨쉬기 폭 (0 = 일정, 1 = 거의 꺼졌다 켜짐)
      pulseSpeed: 0.8,      // 숨쉬기 빠르기 (초당 횟수)
      ringDots: 44,         // 궤도 한 바퀴 점 수
      electronSize: 0.7,    // 전자 크기 (칸)
      trail: 14,            // 빛 꼬리 길이 (점 수)
      symbols: 'πΣ∫√∞',     // 가끔 튀어나오는 기호 (빈 문자열이면 끔)
      symbolEvery: 3.2      // 평균 몇 초에 한 번
    }
  };
  PRESETS['atom-sci-red'] = Object.assign({}, PRESETS['atom-sci'], { id: 'atom-sci-red', colors: RED });

  // ── 5x7 픽셀 기호 ──
  const FONT = {
    'π': ['.....', '#####', '.#.#.', '.#.#.', '.#.#.', '.#..#', '#...#'],
    'Σ': ['#####', '#....', '.#...', '..#..', '.#...', '#....', '#####'],
    '∫': ['...##', '..#..', '..#..', '..#..', '..#..', '..#..', '##...'],
    '√': ['..###', '..#..', '..#..', '..#..', '#.#..', '.##..', '..#..'],
    '∞': ['.....', '.....', '##.##', '#.#.#', '##.##', '.....', '.....']
  };

  function fromSpecies(s) {
    const W = s.side[0].length, H = s.side.length, ox = W / 2, oy = H / 2;
    const b = s.parts.filter(p => p.kind === 'box' && p.w > 1 && p.h > 1);
    const x0 = Math.min(...b.map(p => p.x)), x1 = Math.max(...b.map(p => p.x + p.w));
    const y0 = Math.min(...b.map(p => p.y)), y1 = Math.max(...b.map(p => p.y + p.h));
    const d = Math.max(...b.map(p => p.d || 2));
    return { x: (x0 + x1) / 2 - ox, y: oy - (y0 + y1) / 2, len: x1 - x0, hgt: y1 - y0, dep: d };
  }

  function glowTex(THREE) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  }
  function pixTex(THREE, rows) {
    const c = document.createElement('canvas'); c.width = rows[0].length + 2; c.height = rows.length + 2;
    const g = c.getContext('2d'); g.fillStyle = '#fff';
    rows.forEach((r, y) => [...r].forEach((v, x) => { if (v === '#') g.fillRect(x + 1, y + 1, 1, 1); }));
    const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; return t;
  }

  function attach(o, preset) {
    const THREE = root.THREE;
    const opt = Object.assign({}, PRESETS['atom-sci'], preset || {});
    opt.colors = Object.assign({}, BLUE, (preset || {}).colors || {});
    const C = opt.colors, unit = o.unit || 1, sp = o.spec;

    const rig = new THREE.Group();
    rig.scale.setScalar(unit);
    rig.position.set(sp.x * unit, sp.y * unit, 0);
    o.target.add(rig);
    const spin = new THREE.Group(); rig.add(spin);          // 궤도 전체 세차 회전

    const rx = sp.len / 2 + opt.pad[0];
    const rp = Math.max(sp.hgt / 2, sp.dep / 2) + opt.pad[1];
    const tilts = [];
    for (let i = 0; i < opt.rings; i++) tilts.push({ a: (i / opt.rings) * Math.PI, y: (i % 2 ? -1 : 1) * 0.28 });

    // 궤도 위 한 점 (ring i, 각도 th) → rig 좌표
    const tmp = new THREE.Vector3();
    function onRing(i, th, out) {
      const tl = tilts[i];
      out.set(rx * Math.cos(th), rp * Math.sin(th) * Math.cos(tl.a), rp * Math.sin(th) * Math.sin(tl.a));
      return out.applyAxisAngle(new THREE.Vector3(0, 1, 0), tl.y);
    }

    // 궤도 점선 (네모 픽셀 점)
    const ringMat = new THREE.PointsMaterial({ color: C.ring, size: opt.ringSize, transparent: true, opacity: opt.ringOpacity, depthWrite: false });
    const ringObjs = [];
    for (let i = 0; i < opt.rings; i++) {
      const pts = [];
      for (let k = 0; k < opt.ringDots; k++) { onRing(i, k / opt.ringDots * Math.PI * 2, tmp); pts.push(tmp.x, tmp.y, tmp.z); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const p = new THREE.Points(g, ringMat); spin.add(p); ringObjs.push(p);
    }

    // 전자 + 빛 꼬리
    const gtex = glowTex(THREE);
    const coreMat = new THREE.MeshBasicMaterial({ color: C.core });
    const B = opt.brightness || 1;
    const glowMat = new THREE.SpriteMaterial({ map: gtex, color: new THREE.Color(C.electron).multiplyScalar(B), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const haloMat = new THREE.SpriteMaterial({ map: gtex, color: C.electron, transparent: true, opacity: opt.halo || 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const trailMat = new THREE.PointsMaterial({ size: 0.36, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const es = opt.electronSize;
    const electrons = [];
    const tc = new THREE.Color(C.trail);
    for (let i = 0; i < opt.rings; i++) {
      const n = opt.electrons[i] || 1;
      for (let j = 0; j < n; j++) {
        const g = new THREE.Group(); spin.add(g);
        g.add(new THREE.Mesh(new THREE.BoxGeometry(es * 0.55, es * 0.55, es * 0.55), coreMat));
        // 전자마다 재질을 따로 둬서 각자 다른 박자로 밝기가 숨쉬게 함
        const gm = glowMat.clone(), hm = haloMat.clone(), tm = trailMat.clone(), cm = coreMat.clone();
        g.children[0].material = cm;
        const gl = new THREE.Sprite(gm); gl.scale.set(es * 2.6 * opt.glow, es * 2.6 * opt.glow, 1); g.add(gl);
        const gl2 = new THREE.Sprite(gm); gl2.scale.set(es * 1.3, es * 1.3, 1); g.add(gl2);   // 가운데 한 겹 더 → 더 밝게
        let h = null;
        if (opt.halo > 0) { h = new THREE.Sprite(hm); h.scale.set(es * 5, es * 5, 1); g.add(h); }   // 넓은 후광
        const tg = new THREE.BufferGeometry();
        const tp = new Float32Array(opt.trail * 3), tcol = new Float32Array(opt.trail * 3);
        for (let k = 0; k < opt.trail; k++) { const f = 1 - k / opt.trail; const fb = f * B; tcol[k * 3] = tc.r * fb; tcol[k * 3 + 1] = tc.g * fb; tcol[k * 3 + 2] = tc.b * fb; }
        tg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
        tg.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
        const tr = new THREE.Points(tg, tm); spin.add(tr);
        electrons.push({ ring: i, g, tr, tp, gl, h, gm, hm, tm, cm, pph: Math.random() * Math.PI * 2, ph: j / n * Math.PI * 2 + i * 1.3, dir: i % 2 ? -1 : 1, sp: opt.speed * (1 + i * 0.12) });
      }
    }

    // 수학 기호
    const symTex = {}; [...opt.symbols].forEach(ch => { if (FONT[ch]) symTex[ch] = pixTex(THREE, FONT[ch]); });
    const symChars = Object.keys(symTex);
    const syms = [];
    let nextSym = opt.symbolEvery * (0.5 + Math.random());

    let lastT = null, enabled = true;
    const v = new THREE.Vector3();
    return {
      rig, options: opt,
      update(t) {
        const dt = lastT == null ? 0 : Math.min(0.05, t - lastT); lastT = t;
        rig.visible = enabled;
        if (!enabled) return;
        spin.rotation.x = t * opt.precess;
        spin.rotation.y = Math.sin(t * 0.3) * 0.25;
        for (const e of electrons) {
          const th = e.ph + e.dir * e.sp * t;
          onRing(e.ring, th, v); e.g.position.copy(v);
          // 밝기 숨쉬기: 부드럽게 어두워졌다 밝아짐 (전자마다 박자 다름)
          if (opt.pulse > 0) {
            const w = 0.5 + 0.5 * Math.sin(t * opt.pulseSpeed * Math.PI * 2 + e.pph);
            const k = 1 - opt.pulse * (1 - w * w);                 // 밝은 순간이 짧고 또렷하게
            e.gm.opacity = k; e.hm.opacity = (opt.halo || 0) * k * k; e.tm.opacity = 0.35 + 0.65 * k;
            e.cm.color.set(C.core).lerp(e.cmDim || (e.cmDim = new THREE.Color(C.electron)), 1 - k);
            const sc = es * 2.6 * opt.glow * (0.75 + 0.25 * k); e.gl.scale.set(sc, sc, 1);
            if (e.h) e.h.scale.set(es * 5 * (0.8 + 0.2 * k), es * 5 * (0.8 + 0.2 * k), 1);
          }
          // 꼬리: 지나온 각도들
          for (let k = 0; k < opt.trail; k++) {
            onRing(e.ring, th - e.dir * k * 0.07, tmp);
            e.tp[k * 3] = tmp.x; e.tp[k * 3 + 1] = tmp.y; e.tp[k * 3 + 2] = tmp.z;
          }
          e.tr.geometry.attributes.position.needsUpdate = true;
        }
        // 기호 튀어나오기
        if (symChars.length) {
          nextSym -= dt;
          if (nextSym <= 0) {
            nextSym = opt.symbolEvery * (0.6 + Math.random() * 0.8);
            const e = electrons[(Math.random() * electrons.length) | 0];
            const ch = symChars[(Math.random() * symChars.length) | 0];
            const m = new THREE.SpriteMaterial({ map: symTex[ch], color: C.symbol, transparent: true, depthWrite: false });
            const s = new THREE.Sprite(m); s.position.copy(e.g.position); s.scale.set(1.3, 1.3 * 9 / 7, 1);
            spin.add(s); syms.push({ s, m, age: 0 });
          }
        }
        for (let i = syms.length - 1; i >= 0; i--) {
          const q = syms[i]; q.age += dt;
          const u = q.age / 1.4;
          if (u >= 1) { spin.remove(q.s); q.m.dispose(); syms.splice(i, 1); continue; }
          q.s.position.y += dt * 1.1;
          const pop = u < 0.15 ? 0.6 + u / 0.15 * 0.5 : 1.1 - (u - 0.15) * 0.15;
          q.s.scale.set(1.3 * pop, 1.3 * 9 / 7 * pop, 1);
          q.m.opacity = u < 0.1 ? u / 0.1 : 1 - Math.max(0, (u - 0.5) / 0.5);
        }
      },
      setEnabled(on) { enabled = !!on; },
      dispose() {
        o.target.remove(rig);
        rig.traverse(c => c.geometry && c.geometry.dispose());
        [ringMat, coreMat, glowMat, haloMat, trailMat].forEach(m => m.dispose());
        electrons.forEach(e => [e.gm, e.hm, e.tm, e.cm].forEach(m => m.dispose())); gtex.dispose();
        Object.values(symTex).forEach(t => t.dispose()); syms.forEach(q => q.m.dispose());
      }
    };
  }

  root.ReefAtom = { PRESETS, fromSpecies, attach, BLUE, RED, FONT };
})(typeof window !== 'undefined' ? window : globalThis);


/* ═════════════════ 5. 연결판 ═════════════════ */
/*!
 * reef-items.js — REEF 아이템 연결판
 * 따로 만든 아이템·이펙트 파일(0·1 흔적, 감전, 연필, 원자 궤도 …)을
 * 어떤 reef의 어떤 물고기에도 크기와 모양을 맞춰 붙이는 곳.
 *
 * 흐름
 *   1) measure(종)  : 종 데이터(옆모습 칸, 부위)로 몸 길이·높이·두께, 머리 앞, 입, 꼬리 끝 자리를 잰다
 *   2) fit(잰 값)    : 아이템마다 그 물고기에 맞는 크기·자리 값을 계산한다
 *   3) 덮어쓰기      : reef-data.json 의 addons.fit[아이템 id]['*' 또는 종 id] 값이 있으면 그 값으로 바꾼다
 *                      addons.presets[아이템 id] 는 아이템 기본값(색 등)을 바꾼다
 *   4) apply / tick / remove : 물고기에 붙이고, 매 프레임 움직이고, 떼어 낸다
 *
 * 새 아이템 추가: ReefItems.register({ id, label, sub, needs, preset, fit, attach })
 *   needs  : 그 아이템 파일이 만드는 전역 이름 (없으면 목록에서 빠짐)
 *   fit    : function(잰 값, 종) → 이 물고기용 값
 *   attach : function(물고기, 값, ctx) → { update(t), setEnabled(v), dispose() }
 * 좌표 규칙: 옆모습 1칸 = 1, 머리 +x, 그림 가운데가 원점 (reef-kit 과 같음)
 */
(function (root) {
  'use strict';
  var defs = {}, order = [], live = [];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  // 값 합치기: 뒤에 오는 값이 이김 (안쪽 묶음도 합치고, 목록은 통째로 바꿈)
  function merge() {
    var out = {};
    for (var i = 0; i < arguments.length; i++) {
      var s = arguments[i];
      if (!isObj(s)) continue;
      Object.keys(s).forEach(function (k) {
        if (isObj(s[k])) out[k] = merge(isObj(out[k]) ? out[k] : {}, s[k]);
        else out[k] = Array.isArray(s[k]) ? s[k].slice() : s[k];
      });
    }
    return out;
  }

  /* ── 색 맞추기: reef 화면은 색을 한 번 더 밝게 바꿔 내보내서, 아이템 색을 미리 맞춰 둠 ── */
  function toLin(hex) {
    var c = new root.THREE.Color(hex); c.convertSRGBToLinear();
    return '#' + c.getHexString();
  }
  function linColors(preset) {
    var p = merge(preset);
    if (isObj(p.colors)) Object.keys(p.colors).forEach(function (k) {
      var v = p.colors[k];
      if (typeof v === 'string' && v.charAt(0) === '#') p.colors[k] = toLin(v);
    });
    return p;
  }
  function meshToLin(obj) {
    obj.traverse(function (o) {
      if (!o.isMesh) return;
      var ca = o.geometry && o.geometry.attributes.color;
      if (ca) {
        for (var i = 0; i < ca.array.length; i++) {
          var c = ca.array[i];
          ca.array[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        }
        ca.needsUpdate = true;
      }
      if (o.material.color && !o.material.vertexColors) o.material.color.convertSRGBToLinear();
      if (o.material.emissive) o.material.emissive.convertSRGBToLinear();
    });
  }
  function worldScale(o) { var v = new root.THREE.Vector3(); o.getWorldScale(v); return v.x; }

  /* ── 1) 종 데이터로 크기 재기 ── */
  function measure(sp) {
    var W = sp.side[0].length, H = sp.side.length, ox = W / 2, oy = H / 2;
    var parts = (sp.parts || []).filter(function (p) { return p.kind !== 'free'; });
    function bounds(list) {
      if (!list.length) return null;
      var b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      list.forEach(function (p) {
        b.x0 = Math.min(b.x0, p.x); b.x1 = Math.max(b.x1, p.x + p.w);
        b.y0 = Math.min(b.y0, p.y); b.y1 = Math.max(b.y1, p.y + p.h);
      });
      return b;
    }
    var boxes = parts.filter(function (p) { return p.kind === 'box' && p.w > 1 && p.h > 1; });
    var all = bounds(parts) || { x0: 0, x1: W, y0: 0, y1: H };
    var body = bounds(boxes) || all;
    // 머리: 머리 역할 상자 중 한 칸짜리(미끼 같은 것)는 빼고 잼
    var head = bounds(parts.filter(function (p) { return p.kind === 'box' && p.role === 'head' && p.w * p.h > 1; })) || body;
    var tail = bounds(parts.filter(function (p) { return p.role === 'caudal'; })) || all;
    var dep = Math.max.apply(null, boxes.map(function (p) { return p.d || 2; }).concat([1]));
    // 칸 자리(열, 행) → 물고기 좌표(x, y)
    function at(col, row) { return [col - ox, oy - row]; }
    return {
      W: W, H: H, at: at,
      len: body.x1 - body.x0, hgt: body.y1 - body.y0, dep: dep,
      allLen: all.x1 - all.x0, allHgt: all.y1 - all.y0,
      center: at((all.x0 + all.x1) / 2, (all.y0 + all.y1) / 2),
      headH: head.y1 - head.y0,
      mouth: at(head.x1, head.y0 + (head.y1 - head.y0) * 0.62),
      back: at((body.x0 + body.x1) / 2, body.y0),
      tail: at(tail.x0, (tail.y0 + tail.y1) / 2)
    };
  }

  /* ── 2) 아이템 등록 ── */
  function register(def) { if (!defs[def.id]) order.push(def.id); defs[def.id] = def; }
  function available(id) { var d = defs[id]; return !!d && (!d.needs || !!root[d.needs]); }
  function list() {
    return order.filter(available).map(function (id) { var d = defs[id]; return { id: id, label: d.label, sub: d.sub || '' }; });
  }

  /* ── 3) 이 물고기용 값: 자동 계산 → '*' 덮어쓰기 → 종별 덮어쓰기 → 물고기별 덮어쓰기 ── */
  function params(id, sp, data, extra) {
    var def = defs[id], g = measure(sp), add = (data && data.addons) || {};
    var table = (add.fit && add.fit[id]) || {};
    var p = merge(def.fit(g, sp), table['*'], table[sp.id], extra);
    p.preset = merge(def.preset ? def.preset() : {}, add.presets && add.presets[id], p.preset);
    p._g = g;
    return p;
  }

  /* ── 4) 붙이기 / 떼기 / 매 프레임 ── */
  function find(fish, id) {
    for (var i = 0; i < live.length; i++) if (live[i].fish === fish && live[i].id === id) return i;
    return -1;
  }
  function apply(fish, id, ctx, extra) {
    if (!available(id) || find(fish, id) >= 0 || !fish.userData.model) return null;
    ctx = ctx || {};
    var h = defs[id].attach(fish, params(id, fish.userData.model, ctx.data, extra), ctx);
    live.push({ fish: fish, id: id, h: h, on: true });
    return h;
  }
  function remove(fish, id) {
    var i = find(fish, id);
    if (i < 0) return;
    live[i].h.dispose(); live.splice(i, 1);
  }
  // 물고기 하나(또는 전부)에 붙은 아이템 모두 떼기
  function clear(fish) {
    for (var i = live.length - 1; i >= 0; i--) {
      if (fish && live[i].fish !== fish) continue;
      live[i].h.dispose(); live.splice(i, 1);
    }
  }
  function active(fish) { return live.filter(function (e) { return e.fish === fish; }).map(function (e) { return e.id; }); }
  function shown(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
  // 매 프레임: 물고기가 숨겨져 있으면 아이템도 멈추고 숨김
  function tick(t) {
    live.forEach(function (e) {
      var vis = shown(e.fish);
      if (vis !== e.on) { e.on = vis; e.h.setEnabled(vis); }
      e.h.update(t);
    });
  }

  /* ───────── 기본 아이템 4가지 ───────── */

  // 0·1 꼬리 흔적 (인공지능융합대학): 꼬리 끝 자리와 글자 크기를 몸 크기에 맞춤
  register({
    id: 'trail-ai', label: '0·1 흔적', sub: '인공지능융합대학', needs: 'ReefBinary',
    preset: function () { return root.ReefBinary.PRESETS['trail-ai']; },
    fit: function (g) {
      return {
        tailAt: null,                                   // [열, 행] 으로 꼬리 끝을 직접 정할 수 있음
        preset: {
          size: clamp(g.hgt * 0.3, 1.0, 2.4),           // 글자 높이: 몸 높이의 30%
          spacing: clamp(g.len * 0.09, 0.5, 1.3),       // 긴 물고기는 글자 사이를 넓게
          spread: clamp(g.hgt * 0.22, 0.6, 1.8),
          max: Math.round(clamp(50 + g.len * 3, 60, 150))
        }
      };
    },
    attach: function (fish, P, ctx) {
      var g = P._g, t = P.tailAt ? g.at(P.tailAt[0], P.tailAt[1]) : [g.tail[0] - 0.3, g.tail[1]];
      var h = root.ReefBinary.attach(fish, ctx.scene, ctx.srgb ? linColors(P.preset) : P.preset,
        { tail: [t[0], t[1], 0], unit: worldScale(fish) });
      return {
        update: h.update,
        setEnabled: function (v) { h.setEnabled(v); if (!v) h.clear(); h.group.visible = v; },
        dispose: h.dispose
      };
    }
  });

  // 감전 (전자정보공과대학): 지느러미까지 포함한 전체 크기에 맞춰 번개 판을 씌움
  register({
    id: 'charge-eee', label: '감전', sub: '전자정보공과대학', needs: 'ReefElectric',
    preset: function () { return root.ReefElectric.PRESETS['charge-eee']; },
    fit: function (g) {
      return {
        preset: {
          pad: g.allLen < 12 ? 1.5 : 1.35,              // 작은 물고기는 번개 판을 조금 더 크게
          res: Math.round(clamp(40 + g.allLen * 2, 48, 96)),   // 큰 물고기는 도트를 더 잘게
          glow: { light: clamp(0.8 + g.len * 0.04, 0.8, 1.8), blur: clamp(6 + g.hgt, 6, 14) }
        }
      };
    },
    attach: function (fish, P, ctx) {
      var g = P._g;
      var h = root.ReefElectric.attach(fish, P.preset, { size: [g.allLen, g.allHgt], phase: Math.random() });
      // 번개 판 가운데를 물고기 그림 가운데에 맞춤
      [h.sprite, h.glowSprite, h.light].forEach(function (o) { if (o) o.position.set(g.center[0], g.center[1], 0); });
      if (ctx.srgb) [h.sprite, h.glowSprite].forEach(function (s) { s.material.map.encoding = root.THREE.sRGBEncoding; s.material.needsUpdate = true; });
      return { update: h.update, setEnabled: h.setEnabled, dispose: h.dispose };
    }
  });

  // 연필: 머리 크기에 맞춰 굵기, 몸 길이에 맞춰 노란 몸통 칸 수를 바꿔서 입에 가로로 물림
  register({
    id: 'pencil-yellow', label: '연필', sub: '', needs: 'ReefPencil',
    preset: function () { return root.ReefPencil.PRESETS['pencil-yellow']; },
    fit: function (g) {
      var thick = clamp(g.headH * 0.3, 0.8, 1.8);         // 연필 굵기 (칸)
      var want = clamp(g.len * 0.9, 7, 20);               // 연필 전체 길이 (칸)
      var k = thick / 2;                                  // 연필 단면이 2칸이라서 굵기에 맞춘 배율
      return {
        pose: 'mouth',                                    // mouth: 입에 가로로 / forward: 입에서 앞으로 / back: 등에 얹기
        thick: thick,
        mouthAt: null,                                    // [열, 행] 으로 입 자리를 직접 정할 수 있음
        preset: { lengths: { body: Math.round(clamp(want / k - 6.9, 3, 12)) } }
      };
    },
    attach: function (fish, P, ctx) {
      var g = P._g, pen = root.ReefPencil.build(P.preset), k = P.thick / 2;
      if (ctx.srgb) meshToLin(pen);
      pen.scale.setScalar(k);
      var bones = fish.userData.bones || {}, parent = bones.head || fish;   // 머리를 따라 움직이게
      var m = P.mouthAt ? g.at(P.mouthAt[0], P.mouthAt[1]) : g.mouth, L = pen.userData.length * k;
      if (P.pose === 'forward') pen.position.set(m[0] + L / 2 - P.thick * 0.5, m[1], 0);
      else if (P.pose === 'back') pen.position.set(g.back[0], g.back[1] + P.thick * 0.5 + 0.05, 0);
      else { pen.rotation.y = Math.PI / 2; pen.position.set(m[0] - P.thick * 0.25, m[1], 0); }
      parent.add(pen);
      return {
        update: function () {},
        setEnabled: function (v) { pen.visible = v; },
        dispose: function () { parent.remove(pen); pen.dispose(); }
      };
    }
  });

  // 원자 궤도 (자연과학대학): 몸 길이·높이에 맞춰 궤도 여유와 전자 크기를 바꿈
  register({
    id: 'atom-sci', label: '원자 궤도', sub: '자연과학대학', needs: 'ReefAtom',
    preset: function () { return root.ReefAtom.PRESETS['atom-sci']; },
    fit: function (g) {
      return {
        preset: {
          pad: [clamp(g.len * 0.12, 1, 2.6), clamp(g.hgt * 0.22, 0.8, 2.2)],
          electronSize: clamp(g.hgt * 0.13, 0.45, 1.1),
          ringSize: clamp(g.hgt * 0.04, 0.14, 0.34),
          ringDots: Math.round(clamp(30 + g.len * 1.6, 36, 80)),
          trail: Math.round(clamp(10 + g.len * 0.4, 12, 22))
        }
      };
    },
    attach: function (fish, P, ctx) {
      var pre = ctx.srgb ? linColors(P.preset) : merge(P.preset);
      pre.ringSize *= worldScale(fish);                   // 점 크기는 화면 기준이라 물고기 크기만큼 줄임
      var h = root.ReefAtom.attach({ target: fish, spec: root.ReefAtom.fromSpecies(fish.userData.model), unit: 1 }, pre);
      return { update: h.update, setEnabled: h.setEnabled, dispose: h.dispose };
    }
  });

  root.ReefItems = {
    register: register, list: list, measure: measure, params: params,
    apply: apply, remove: remove, clear: clear, active: active, tick: tick,
    merge: merge, clamp: clamp
  };
})(typeof window !== 'undefined' ? window : globalThis);

