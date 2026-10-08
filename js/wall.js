/* 후아나 방문자 첫 화면: 위치(또는 영수증)로 방문을 확인하고, 물고기 · 아이템 · 한 줄 평을 남기면 어항에 풀어 줌
   서버(submit_wall_review)가 위치를 다시 확인하고, 2분 안에 남긴 리뷰는 같은 무리로 묶음
   관리자는 '관리자 모드'로 위치와 상관없이 남기고, 리뷰를 지울 수 있음 */
(function () {
  "use strict";
  var SPOT = 'juana';
  var MAX_FISH = 24;                  // 어항에 동시에 띄우는 물고기 수 (최근 것부터)
  var POLL = 15000;                   // 새 리뷰 확인 간격
  // 고를 수 있는 물고기: reef-data.json의 id → 화면에 보일 이름 (이 순서대로 보임)
  var NAMES = {
    'clownfish': '흰동가리', 'blue-tang': '블루탱', 'ryukin-goldfish': '금붕어', 'emperor-angelfish': '엔젤피쉬',
    'powder-blue-tang': '파우더블루', 'yellow-tang': '옐로탱', 'moorish-idol': '깃대돔', 'discus': '디스커스',
    'seahorse': '해마', 'sea-turtle': '바다거북', 'shark': '상어', 'manta-ray': '만타가오리',
    'tomato-clownfish': '토마토클라운', 'percula-clownfish': '퍼큘라클라운', 'domino-clownfish': '도미노클라운', 'snowflake-clownfish': '스노우플레이크'
  };
  var SIZE = { 'shark': 0.6, 'sea-turtle': 0.45, 'manta-ray': 0.6 };   // 어항 속 물고기 길이 (없으면 0.32)
  var kit = ReefKit(THREE);
  var $ = function (id) { return document.getElementById(id); };
  var sb = window.Core && Core.sb;

  function toast(t) { Core.toast(t); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function button(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function spot() { return (window.SPOTS || []).filter(function (o) { return o.id === SPOT; })[0]; }

  /* ══ 1. 방문 확인: 위치 → 안 되면 영수증 (관리자는 관리자 모드) ══ */
  var proof = null, adminMode = false;   // proof: { kind: 'gps' | 'receipt' | 'admin', ... }
  var gstat = $('gstat'), form = $('form');

  function show(msg, sub, cls, buttons, extra) {
    gstat.innerHTML = '';
    var m = el('div', 'msg ' + (cls || '')); m.appendChild(el('b', '', msg)); if (sub) m.appendChild(document.createTextNode(sub));
    if (extra) m.appendChild(extra);
    gstat.appendChild(m);
    if (buttons && buttons.length) { var r = el('div', 'row'); buttons.forEach(function (b) { r.appendChild(b); }); gstat.appendChild(r); }
    form.classList.add('hidden');
  }
  function verified(p) {
    proof = p;
    gstat.innerHTML = '';
    gstat.appendChild(el('div', 'msg ok', p.kind === 'gps' ? '후아나에서 확인됐어요' : p.kind === 'admin' ? '관리자 모드 (위치 확인 없음)' : '영수증으로 확인됐어요'));
    form.classList.remove('hidden');
  }
  function receiptBtn() { return button('영수증으로 인증하기', 'vbtn', function () { $('rcpt').value = ''; $('rcpt').click(); }); }
  function retryBtn() { return button('위치 다시 확인', 'vbtn', checkGeo); }

  function checkGeo() {
    proof = null;
    show('위치를 확인하는 중…', '위치 권한을 허용해 주세요', '', []);
    if (!navigator.geolocation) { show('위치를 쓸 수 없어요', '영수증으로 대신 인증할 수 있어요', 'bad', [receiptBtn()]); return; }
    navigator.geolocation.getCurrentPosition(function (p) {
      if (adminMode) return;
      var sp = spot(), lat = p.coords.latitude, lng = p.coords.longitude;
      if (!sp || !sp.box) { show('매장 정보를 불러오지 못했어요', '잠시 뒤 다시 해 주세요', 'bad', [retryBtn()]); return; }
      var d = Math.round(window.spotDistance(sp, lat, lng));
      if (d <= window.SPOT_MARGIN_M) verified({ kind: 'gps', lat: lat, lng: lng });
      else show('후아나에서 ' + d + 'm 떨어져 있어요', '매장 안이나 바로 앞에서 남길 수 있어요', 'bad', [retryBtn(), receiptBtn()]);
    }, function (e) {
      if (adminMode) return;
      if (e && e.code === 1) show('위치 권한이 꺼져 있어요', '영수증이 있으면 영수증으로 인증할 수 있어요', 'bad', [receiptBtn(), retryBtn()]);
      else show('위치를 찾지 못했어요', '잠시 뒤 다시 하거나 영수증으로 인증해 주세요', 'bad', [retryBtn(), receiptBtn()]);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 });
  }

  // 영수증 사진을 읽어 후아나 영수증인지 확인 (글자는 이 기기 안에서 읽음)
  $('rcpt').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var fill = el('i'), bar = el('div', 'bar'), txt = el('span', '', '준비하는 중…');
    bar.appendChild(fill);
    var wrap = el('div'); wrap.appendChild(bar); wrap.appendChild(txt);
    show('영수증을 읽는 중…', '', '', [], wrap);
    Receipt.read(f, function (p, m) { fill.style.width = Math.round(p * 100) + '%'; txt.textContent = m; }).then(function (r) {
      var v = Receipt.judge(r.info, false), isMine = !!(r.info.spot && r.info.spot.id === SPOT);
      if (v.ok && isMine) {
        verified({ kind: 'receipt', receipt: { approval: r.info.approval || null, amount: r.info.amount || null, biz: r.info.biz || null,
          paid: v.at ? v.at.toISOString() : null, shop: r.info.spot.name } });
        return;
      }
      var why = !isMine ? '후아나 영수증이 아니에요' : v.checks.filter(function (c) { return !c.ok; }).map(function (c) { return c.text; }).join(' · ');
      show('인증하지 못했어요', why, 'bad', [receiptBtn(), retryBtn()]);
    }, function () { show('영수증을 읽지 못했어요', '인터넷 연결을 확인하고 다시 해 주세요', 'bad', [receiptBtn(), retryBtn()]); });
  });

  // 관리자 모드: 위치와 상관없이 남기고 리뷰를 지울 수 있음 (서버도 관리자인지 다시 확인)
  function setAdmin(on) {
    adminMode = on && Core.isAdmin();
    $('bAdmin').classList.toggle('on', adminMode);
    $('bAdmin').textContent = adminMode ? '관리자 모드 끄기' : '관리자 모드';
    if (adminMode) verified({ kind: 'admin' }); else checkGeo();
    drawList();
  }
  $('bAdmin').addEventListener('click', function () { setAdmin(!adminMode); });

  /* ══ 2. 어항 ══ */
  var renderer = new THREE.WebGLRenderer({ canvas: $('gl'), alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputEncoding = THREE.sRGBEncoding;
  var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
  scene.add(new THREE.HemisphereLight(0xdff6ff, 0x1a3a5a, 1.1));
  var sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(3, 6, 4); scene.add(sun);
  var world = new THREE.Group(); scene.add(world);
  var talk = null, speciesCfg = {}, speciesIds = [], itemsCfg = [];

  var tank = $('tank'), camT = 0;
  function resize() {
    var w = tank.clientWidth || innerWidth, h = tank.clientHeight || 300;
    renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(tank);
  resize();

  // 무리 자리: 무리마다 어항 속 한 곳을 정해 그 둘레를 같이 돎
  var SLOTS = [[0, 0.1, 0], [-0.55, 0.28, -0.1], [0.55, -0.22, 0.1], [-0.5, -0.25, 0.25], [0.5, 0.3, -0.2], [0, -0.32, -0.3], [0, 0.4, 0.3], [-0.2, 0, 0.5]];
  var groups = {}, slotN = 0;
  function groupOf(g) {
    if (groups[g]) return groups[g];
    var s = slotN++, base = SLOTS[s % SLOTS.length], lap = Math.floor(s / SLOTS.length);
    return (groups[g] = { n: 0, c: [base[0] + lap * 0.12, base[1], base[2] - lap * 0.18], rx: 0.2 + (s % 3) * 0.04, rz: 0.16 + (s % 2) * 0.05, dir: s % 2 ? -1 : 1 });
  }

  var fishes = [], byId = {}, queue = Promise.resolve();
  // 리뷰 하나 → 물고기 한 마리 (모델은 한 마리씩 차례로 불러옴)
  function addFish(r) {
    if (byId[r.id]) return;
    byId[r.id] = { r: r, pending: true };
    var cfg = speciesCfg[r.fish] || speciesCfg[speciesIds[0]];
    if (!cfg) return;
    queue = queue.then(function () {
      if (!byId[r.id]) return;   // 불러오는 사이 지워진 리뷰
      return ReefModel.load(THREE, [cfg]).then(function (m) {
        if (!byId[r.id]) return;
        var p = m.fish[0], g = groupOf(r.grp), k = g.n++, len;
        m.holder.position.set(g.c[0], g.c[1], g.c[2]);
        if (p.kind === 'path') {
          // 혼자 헤엄치는 물고기: 같은 무리는 같은 고리 길을 조금씩 간격을 두고 돎
          len = SIZE[r.fish] || 0.32;
          p.obj.scale.setScalar(len / (p.sizeK * m.ref));
          p.lane = { rx: g.rx, rz: g.rz, y: ((k % 3) - 1) * 0.035, sp: 0.25 * p.speedK / ((g.rx + g.rz) / 2), ph: k * 0.6 + g.c[0], dir: g.dir };
        } else {
          // 떼 물고기: 파일에 들어 있는 길을 돎. 어항 크기에 맞추고 같은 무리끼리는 시작 시각을 달리함
          var sc = Math.min(0.3 / m.ref, 0.8 / m.size);
          m.holder.scale.setScalar(sc); len = m.ref * sc;
          m.update(k * 1.7);
        }
        p.heads[0].userData.halfH = -1.5;
        world.add(m.holder);
        var f = { r: r, m: m, p: p, len: len };
        fishes.push(f); byId[r.id] = f;
        wear(f);
        while (fishes.length > MAX_FISH) dropFish(fishes[0]);
        $('empty').classList.add('hidden');
        if (r.fresh) say(f, 5);
      }).catch(function () { delete byId[r.id]; }).then(function () {
        return new Promise(function (ok) { setTimeout(ok, 40); });   // 한 마리 넣고 쉬어서 화면이 멈추지 않게
      });
    });
  }
  function dropFish(f) {
    world.remove(f.m.holder);
    if (f.worn) world.remove(f.worn.obj);
    fishes.splice(fishes.indexOf(f), 1); delete byId[f.r.id];
  }

  /* ── 아이템: 머리 위에 띄움 (튀기 · 빛나기 · 둥실) ── */
  var itemScenes = {}, haloTex = null;
  function itemScene(url) {
    return itemScenes[url] || (itemScenes[url] = new Promise(function (ok, no) { new THREE.GLTFLoader().load(url, function (g) { ok(g.scene); }, null, no); }));
  }
  function halo() {
    if (haloTex) return haloTex;
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,230,150,1)'); g.addColorStop(0.4, 'rgba(255,210,100,.45)'); g.addColorStop(1, 'rgba(255,200,80,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return (haloTex = new THREE.CanvasTexture(c));
  }
  function wear(f) {
    var it = f.r.item && itemsCfg.filter(function (x) { return x.id === f.r.item; })[0];
    if (!it || !it.model) return;
    itemScene(it.model).then(function (sc) {
      if (byId[f.r.id] !== f) return;
      var o = sc.clone(true), wrap = new THREE.Group();
      var box = new THREE.Box3().setFromObject(o), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      o.position.sub(c); wrap.add(o);
      var w = { obj: wrap, wear: it.wear, ph: Math.random() * 6, lit: [] };
      if (it.wear === 'glow') {   // 비치는 유리 부분만 빛나게 하고 빛 번짐을 붙임
        var gb = new THREE.Box3(); wrap.updateMatrixWorld(true);
        o.traverse(function (m) {
          if (!m.isMesh || !m.material.transparent) return;
          m.material = m.material.clone(); m.material.emissive = new THREE.Color(0xffd36a); w.lit.push(m.material); gb.expandByObject(m);
        });
        if (w.lit.length) {
          w.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
          gb.getCenter(w.halo.position); w.halo.scale.setScalar(Math.max.apply(null, gb.getSize(new THREE.Vector3()).toArray()) * 2); wrap.add(w.halo);
        }
      }
      w.d = f.len * (+it.size || 0.4) * 1.1;
      wrap.scale.setScalar(w.d / (Math.max(sz.x, sz.y, sz.z) || 1));
      world.add(wrap); f.worn = w;
    }).catch(function () {});
  }
  var wv = new THREE.Vector3();
  function wearTick(t) {
    fishes.forEach(function (f) {
      var w = f.worn; if (!w) return;
      f.p.heads[0].getWorldPosition(wv);
      var hop = 0, a = t + w.ph;
      if (w.wear === 'bounce') { hop = Math.abs(Math.sin(a * 3.2)) * w.d * 1.2; w.obj.rotation.y = a * 1.5; }
      else if (w.wear === 'glow') {
        hop = Math.sin(a * 1.4) * w.d * 0.08; w.obj.rotation.set(0, a * 0.4, Math.sin(a * 1.3) * 0.15);
        var k = Math.max(0, Math.sin(a * 1.8)), on = k * k;
        w.lit.forEach(function (m) { m.emissiveIntensity = on * 1.6; });
        if (w.halo) w.halo.material.opacity = on * 0.7;
      } else if (w.wear === 'float') { hop = (Math.sin(a * 1.6) + 1) * w.d * 0.15; w.obj.rotation.set(Math.sin(a * 1.1) * 0.12, a * 0.6, 0); }
      else w.obj.rotation.y = a * 1.5;
      w.obj.position.set(wv.x, wv.y + w.d * 0.9 + hop, wv.z);
    });
  }

  function say(f, sec) {
    if (!talk || !f || !f.p) return;
    talk.say(f.p.heads[0], (f.r.nick ? f.r.nick + ': ' : '') + f.r.body, sec);
  }

  // 누른 자리에서 가장 가까운 물고기가 자기 리뷰를 말함
  var v3 = new THREE.Vector3(), cv = $('gl'), down = null;
  function nearest(x, y) {
    var r = cv.getBoundingClientRect(), best = null, bd = 56;
    fishes.forEach(function (f) {
      f.p.heads[0].getWorldPosition(v3).project(camera);
      if (v3.z > 1) return;
      var d = Math.hypot((v3.x + 1) / 2 * r.width - (x - r.left), (1 - v3.y) / 2 * r.height - (y - r.top));
      if (d < bd) { bd = d; best = f; }
    });
    return best;
  }
  /* 손가락 하나로 끌면 돌려보기, 두 손가락으로 벌리면 확대 · 비틀면 돌리기, 휠로 확대. 잠깐 누르면 물고기가 말함 */
  var view = { theta: 0, phi: Math.PI / 2, zoom: 1, idle: 9 }, pts = {}, pinch = null;
  function two() { var k = Object.keys(pts); return k.length === 2 ? [pts[k[0]], pts[k[1]]] : null; }
  cv.addEventListener('pointerdown', function (e) {
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { cv.setPointerCapture(e.pointerId); } catch (er) {}
    down = Object.keys(pts).length === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    pinch = null; view.idle = 0;
  });
  cv.addEventListener('pointermove', function (e) {
    var p = pts[e.pointerId]; if (!p) return;
    var dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY; view.idle = 0;
    var t = two();
    if (t) {
      var d = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y), a = Math.atan2(t[1].y - t[0].y, t[1].x - t[0].x);
      if (pinch) {
        view.zoom = Math.max(0.35, Math.min(2.2, view.zoom * pinch.d / Math.max(1, d)));
        var da = a - pinch.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
        view.theta -= da;
      }
      pinch = { d: d, a: a };
    } else if (Object.keys(pts).length === 1) {
      view.theta -= dx * 0.008;
      view.phi = Math.max(0.35, Math.min(Math.PI - 0.35, view.phi - dy * 0.006));
    }
  });
  function lift(e) {
    if (e.type === 'pointerup' && down && Object.keys(pts).length === 1 &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < 14 && performance.now() - down.t < 600) say(nearest(e.clientX, e.clientY), 4);
    delete pts[e.pointerId]; down = null; pinch = null;
  }
  cv.addEventListener('pointerup', lift); cv.addEventListener('pointercancel', lift);
  cv.addEventListener('wheel', function (e) {
    e.preventDefault(); view.idle = 0;
    view.zoom = Math.max(0.35, Math.min(2.2, view.zoom * Math.exp(e.deltaY * 0.0012)));
  }, { passive: false });
  // 가만히 있어도 가끔 물고기가 한마디씩 함
  setInterval(function () { if (fishes.length && !document.hidden) say(fishes[Math.floor(Math.random() * fishes.length)]); }, 3600);

  var clock = new THREE.Clock();
  (function frame() {
    requestAnimationFrame(frame);
    var dt = Math.min(clock.getDelta(), 0.05);
    fishes.forEach(function (f) { f.m.update(dt); });
    wearTick(clock.elapsedTime);
    // 화면이 좁으면 뒤로 물러나 무리가 다 보이게. 손대지 않은 지 4초가 지나면 천천히 흔들림
    camT += dt; view.idle += dt;
    var dist = Math.max(2.3, 0.9 / (Math.tan(20 * Math.PI / 180) * camera.aspect)) * view.zoom;
    var sway = Math.min(1, Math.max(0, view.idle - 4) / 2);
    var th = view.theta + Math.sin(camT * 0.2) * 0.15 * sway, ph = view.phi - Math.sin(camT * 0.13) * 0.035 * sway;
    camera.position.set(dist * Math.sin(ph) * Math.sin(th), dist * Math.cos(ph), dist * Math.sin(ph) * Math.cos(th));
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    if (talk) {
      talk.update();
      // 말풍선이 화면 오른쪽으로 잘리지 않게 안쪽으로 당김
      var W = tank.clientWidth;
      [].forEach.call(tank.querySelectorAll('.reef-say'), function (b) {
        var x = parseFloat(b.style.left) || 0;
        if (x + b.offsetWidth > W - 6) b.style.left = Math.max(6, W - 6 - b.offsetWidth) + 'px';
      });
    }
  })();

  /* ══ 3. 물고기 · 아이템 고르기 (작은 그림은 모델을 한 번씩 그려서 만듦) ══ */
  var picks = $('picks'), chosen = '', chosenItem = '', thumbs = {}, btns = {};
  function drawPicks() {
    picks.innerHTML = ''; btns = {};
    speciesIds.forEach(function (id) {
      var b = el('button', 'pick' + (id === chosen ? ' on' : '')); b.type = 'button';
      var ph = el('div', 'ph'); ph.style.background = speciesCfg[id].color || '#8cc';
      b.appendChild(ph); b.appendChild(el('span', '', NAMES[id] || speciesCfg[id].name || id));
      b.addEventListener('click', function () {
        chosen = id;
        Object.keys(btns).forEach(function (k) { btns[k].classList.toggle('on', k === chosen); });
      });
      btns[id] = b; picks.appendChild(b);
    });
  }
  // 아이템: 비스타 동그라미 단추 (하나만 고름)
  function drawItems() {
    var box = $('items'); box.innerHTML = '';
    [{ id: '', name: '없음' }].concat(itemsCfg).forEach(function (it) {
      var l = el('label', 'rb'), r = el('input');
      r.type = 'radio'; r.name = 'item'; r.value = it.id; r.checked = it.id === chosenItem;
      r.addEventListener('change', function () { chosenItem = it.id; });
      l.appendChild(r); l.appendChild(el('span', '', it.name || it.id)); box.appendChild(l);
    });
  }
  var THUMB_DIR = 'assets/thumbs/';
  function setThumb(id, src) {
    thumbs[id] = src;
    var img = el('img'); img.alt = ''; img.src = src;
    var b = btns[id]; if (b) b.replaceChild(img, b.firstChild);
  }
  // 미리 만들어 둔 그림(assets/thumbs/물고기 id.png)을 쓰고, 없는 것만 모델을 그려서 만듦
  function loadThumbs() {
    var missing = [];
    Promise.all(speciesIds.map(function (id) {
      return new Promise(function (ok) {
        var im = new Image();
        im.onload = function () { setThumb(id, im.src); ok(); };
        im.onerror = function () { missing.push(id); ok(); };
        im.src = THUMB_DIR + id + '.png';
      });
    })).then(function () { drawList(); if (missing.length) makeThumbs(missing); });
  }
  function makeThumbs(ids) {
    var r2 = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    r2.setPixelRatio(1); r2.setSize(168, 168); r2.outputEncoding = THREE.sRGBEncoding;
    var sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x446688, 1.2)); var l = new THREE.DirectionalLight(0xffffff, 1.1); l.position.set(2, 3, 4); sc.add(l);
    cam.position.set(0, 0, 3.4);
    // 한 번 그려 보고 물고기가 그려진 자리를 재서, 그림 가운데에 알맞은 크기로 오게 옮김
    var N = 168, u = 2 * 3.4 * Math.tan(15 * Math.PI / 180) / N, c2 = document.createElement('canvas'), x2 = c2.getContext('2d');
    c2.width = c2.height = N;
    function fitShot(h) {
      r2.render(sc, cam);
      x2.clearRect(0, 0, N, N); x2.drawImage(r2.domElement, 0, 0);
      var d = x2.getImageData(0, 0, N, N).data, x0 = N, y0 = N, x1 = -1, y1 = -1;
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 < 0) return;
      var k = 0.84 * N / Math.max(x1 - x0 + 1, y1 - y0 + 1);
      if (x0 <= 0 || y0 <= 0 || x1 >= N - 1 || y1 >= N - 1) k = Math.min(k, 0.5);   // 가장자리에 잘렸으면 일단 줄임
      var cx = ((x0 + x1) / 2 - N / 2) * u, cy = -((y0 + y1) / 2 - N / 2) * u;
      h.scale.multiplyScalar(k);
      h.position.set(-k * (cx - h.position.x), -k * (cy - h.position.y), h.position.z * k);
    }
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        return ReefModel.load(THREE, [speciesCfg[id]]).then(function (m) {
          var p = m.fish[0], v = new THREE.Vector3();
          m.update(0.4);
          if (p.kind === 'path') {
            p.obj.position.set(0, 0, 0); p.obj.rotation.set(0, -0.5, 0);
            m.holder.scale.setScalar(1.5 / (p.sizeK * m.ref));
          } else {   // 떼 물고기: 머리가 가운데 오게 옮김
            m.holder.scale.setScalar(2.2 / m.ref); m.holder.updateMatrixWorld(true);
            p.heads[0].getWorldPosition(v); m.holder.position.sub(v);
          }
          sc.add(m.holder);
          for (var n = 0; n < 4; n++) fitShot(m.holder);
          r2.render(sc, cam);
          setThumb(id, r2.domElement.toDataURL('image/png'));
          sc.remove(m.holder);
          drawList();
        }).catch(function () {});
      });
    });
    chain.then(function () { r2.dispose(); });
  }

  /* ══ 4. 남기기 ══ */
  var sending = false;
  $('send').addEventListener('click', function () {
    var body = $('body').value.trim(), nick = $('nick').value.trim();
    if (!body) { toast('한 줄 평을 적어 주세요'); $('body').focus(); return; }
    if (!proof || sending) return;
    if (!sb) { toast('서버 설정 전이라 남길 수 없어요'); return; }
    sending = true; $('send').disabled = true;
    sb.rpc('submit_wall_review', {
      spot_id: SPOT, nick: nick || null, body: body, fish_id: chosen, item_id: chosenItem || null,
      lat: proof.kind === 'gps' ? proof.lat : null, lng: proof.kind === 'gps' ? proof.lng : null,
      proof: proof.kind, receipt: proof.kind === 'receipt' ? proof.receipt : null
    }).then(function (res) {
      sending = false; $('send').disabled = false;
      if (res.error) {
        var m = res.error.message || '';
        toast(/function|schema cache|does not exist/i.test(m) ? '서버 준비가 안 됐어요. 잠시 뒤 다시 해 주세요' : m || '잠시 뒤 다시 해 주세요');
        return;
      }
      $('body').value = '';
      var d = res.data || {};
      pushReview({ id: d.id, grp: d.grp, nick: nick || null, body: body, fish: chosen, item: chosenItem || null, created_at: new Date().toISOString(), fresh: true });
      toast('물고기가 어항에 풀려났어요 🐟');
      Core.log('wall_review', { spot: SPOT, proof: proof.kind });
    }, function () { sending = false; $('send').disabled = false; toast('인터넷 연결을 확인해 주세요'); });
  });
  $('body').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('send').click(); });

  /* ══ 5. 리뷰 불러오기 · 목록 · 삭제 ══ */
  var reviews = [];                   // 새것이 앞
  function pushReview(r) {
    if (reviews.some(function (x) { return x.id === r.id; })) return;
    reviews.unshift(r); reviews.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    addFish(r); drawList();
  }
  function removeReview(id) {
    reviews = reviews.filter(function (x) { return x.id !== id; });
    var f = byId[id]; if (f && f.m) dropFish(f); else delete byId[id];
    if (!reviews.length) $('empty').classList.remove('hidden');
    drawList();
  }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return '방금'; if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전'; return Math.floor(s / 86400) + '일 전';
  }
  function itemName(id) { var it = itemsCfg.filter(function (x) { return x.id === id; })[0]; return it ? it.name || it.id : ''; }
  function drawList() {
    $('cnt').textContent = reviews.length ? '(' + reviews.length + ')' : '';
    if ($('pList').classList.contains('hidden')) return;
    var box = $('list'); box.innerHTML = '';
    if (!reviews.length) { box.appendChild(el('p', 'none', '아직 리뷰가 없어요')); return; }
    var size = {}; reviews.forEach(function (r) { size[r.grp] = (size[r.grp] || 0) + 1; });
    reviews.forEach(function (r) {
      var it = el('div', 'it');
      var img = el('img'); img.alt = ''; if (thumbs[r.fish]) img.src = thumbs[r.fish];
      var tx = el('div', 'tx'), b = el('b', '', r.body), sm = el('small', '', (r.nick || '익명') + ' · ' + ago(r.created_at));
      if (size[r.grp] > 1) sm.appendChild(el('span', 'tag', '무리 ' + size[r.grp]));
      if (r.item && itemName(r.item)) sm.appendChild(el('span', 'tag', itemName(r.item)));
      tx.appendChild(b); tx.appendChild(sm); it.appendChild(img); it.appendChild(tx);
      it.addEventListener('click', function () { showTab(false); say(byId[r.id], 4); });
      if (adminMode) {
        it.appendChild(button('삭제', 'vbtn del', function (e) {
          e.stopPropagation();
          if (!window.confirm('이 리뷰를 지울까요?\n"' + r.body + '"')) return;
          sb.from('wall_reviews').delete().eq('id', r.id).select('id').then(function (res) {
            if (res.error || !res.data || !res.data.length) { toast('지우지 못했어요. 관리자 로그인을 확인해 주세요'); return; }
            removeReview(r.id); toast('지웠어요');
          });
        }));
      }
      box.appendChild(it);
    });
  }
  function fetchReviews() {
    if (!sb) return;
    sb.from('wall_reviews').select('id,nick,body,fish,item,grp,created_at').eq('spot', SPOT).order('created_at', { ascending: false }).limit(60)
      .then(function (r) {
        if (r.error || !r.data) return;
        var have = {}; r.data.forEach(function (x) { have[x.id] = 1; });
        // 다른 곳(관리자)에서 지운 리뷰는 어항에서도 뺌 (받은 범위 안에 있어야 할 것만 봄)
        var oldest = r.data.length >= 60 ? new Date(r.data[r.data.length - 1].created_at) : null;
        reviews.slice().forEach(function (x) { if (!have[x.id] && !x.fresh && (!oldest || new Date(x.created_at) >= oldest)) removeReview(x.id); });
        r.data.slice().reverse().forEach(function (x) { pushReview(x); });
        if (!reviews.length) $('empty').classList.remove('hidden');
      });
  }
  setInterval(function () { if (!document.hidden) fetchReviews(); }, POLL);

  function showTab(list) {
    $('pWrite').classList.toggle('hidden', list); $('pList').classList.toggle('hidden', !list);
    $('tWrite').classList.toggle('on', !list); $('tList').classList.toggle('on', list);
    if (list) drawList();
  }
  $('tWrite').addEventListener('click', function () { showTab(false); });
  $('tList').addEventListener('click', function () { showTab(true); });

  /* ══ 키보드: 폰 키보드가 올라오면 화면을 보이는 영역에 맞추고, 글 칸과 '물고기 풀어주기' 단추가 보이게 올림 ══ */
  var vv = window.visualViewport, app = $('app');
  function fitView() {
    if (!vv) return;
    // 화면 전체를 손가락으로 확대한 중이면 건드리지 않음 (키보드일 때만 맞춤)
    if (Math.abs(vv.scale - 1) > 0.01) { app.style.height = app.style.top = app.style.bottom = ''; document.body.classList.remove('kb'); return; }
    var kb = vv.height < window.innerHeight - 120;
    document.body.classList.toggle('kb', kb);
    if (!kb) { app.style.height = app.style.top = app.style.bottom = ''; return; }
    app.style.bottom = 'auto'; app.style.height = vv.height + 'px'; app.style.top = vv.offsetTop + 'px';
  }
  if (vv) { vv.addEventListener('resize', fitView); vv.addEventListener('scroll', fitView); fitView(); }
  ['nick', 'body'].forEach(function (id) {
    $(id).addEventListener('focus', function () {
      setTimeout(function () { fitView(); $('send').scrollIntoView({ block: 'end', behavior: 'smooth' }); }, 350);
    });
  });

  /* ══ 6. 로그인 · 관리자 단추 (작게) ══ */
  Core.onChange(function (st) {
    var b = $('bLogin');
    b.textContent = st.user ? '로그아웃' : '카카오 로그인';
    b.onclick = st.user ? Core.logout : function () { Core.login(); };
    if (!Core.ready) b.classList.add('hidden');
    $('bAdmin').classList.toggle('hidden', !Core.isAdmin());
    if (adminMode && !Core.isAdmin()) setAdmin(false);
  });
  Core.start();

  /* ══ 시작 ══ */
  var spotsReady = window.loadSpots ? window.loadSpots(sb) : Promise.resolve();
  kit.loadData().then(function (d) {
    var r = ReefModel.reef(d);
    ((r && r.config.fish) || []).forEach(function (f) { speciesCfg[f.id] = f; });
    var order = Object.keys(NAMES).filter(function (id) { return speciesCfg[id]; });
    Object.keys(speciesCfg).forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    speciesIds = order; itemsCfg = (d.items || []).filter(function (x) { return x && x.id; });
    chosen = speciesIds[Math.floor(Math.random() * speciesIds.length)] || '';
    kit.applyStyle(d.style); talk = kit.Talk(tank, camera, d.style);
    drawPicks(); drawItems(); loadThumbs(); fetchReviews();
  }).catch(function () { toast('물고기 정보를 읽지 못했어요'); });
  spotsReady.then(checkGeo);
})();
