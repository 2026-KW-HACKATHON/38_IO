/* 후아나 방문자 첫 화면: 위치(또는 영수증)로 방문을 확인하고, 물고기와 한 줄 평을 남기면 어항에 풀어 줌
   서버(submit_wall_review)가 위치를 다시 확인하고, 2분 안에 남긴 리뷰는 같은 무리로 묶음 */
(function () {
  "use strict";
  var SPOT = 'juana';
  var MAX_FISH = 24;                  // 어항에 동시에 띄우는 물고기 수 (최근 것부터)
  var POLL = 15000;                   // 새 리뷰 확인 간격
  // 고를 수 있는 물고기 (reef-data.json의 id) 와 화면에 보일 이름
  var SPECIES = [
    ['blue-tang', '블루탱'], ['ryukin-goldfish', '금붕어'], ['emperor-angelfish', '엔젤피쉬'],
    ['discus', '디스커스'], ['seahorse', '해마'], ['sea-turtle', '바다거북']
  ];
  var kit = ReefKit(THREE);
  var $ = function (id) { return document.getElementById(id); };
  var sb = window.Core && Core.sb;

  function toast(t) { Core.toast(t); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function button(text, cls, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function spot() { return (window.SPOTS || []).filter(function (o) { return o.id === SPOT; })[0]; }

  /* ══ 1. 방문 확인: 위치 → 안 되면 영수증 ══ */
  var proof = null;                   // { kind: 'gps' | 'receipt', lat, lng, receipt }
  var gstat = $('gstat'), form = $('form');

  var lastShow = null;
  function show(msg, sub, cls, buttons, extra) {
    lastShow = extra ? null : [msg, sub, cls, buttons];
    gstat.innerHTML = '';
    var m = el('div', 'msg ' + (cls || '')); m.appendChild(el('b', '', msg)); if (sub) m.appendChild(document.createTextNode(sub));
    if (extra) m.appendChild(extra);
    gstat.appendChild(m);
    var ad = adminBtn(); if (ad && buttons) buttons = buttons.concat([ad]);
    if (buttons && buttons.length) { var r = el('div', 'row'); buttons.forEach(function (b) { r.appendChild(b); }); gstat.appendChild(r); }
    form.classList.add('hidden');
  }
  function verified(p) {
    proof = p;
    gstat.innerHTML = '';
    gstat.appendChild(el('div', 'msg ok', p.kind === 'gps' ? '✔ 후아나에서 확인됐어요' : p.kind === 'admin' ? '✔ 관리자 시험 모드 (위치 확인 없음)' : '✔ 영수증으로 확인됐어요'));
    form.classList.remove('hidden');
  }
  // 관리자는 위치와 상관없이 시험 글을 남길 수 있음 (서버도 관리자인지 다시 확인)
  function adminBtn() { return Core.isAdmin() ? button('관리자로 시험하기', 'sub', function () { verified({ kind: 'admin' }); }) : null; }
  function receiptBtn() { return button('영수증으로 인증하기', 'sub', function () { $('rcpt').value = ''; $('rcpt').click(); }); }
  function retryBtn() { return button('위치 다시 확인', 'sub', checkGeo); }

  function checkGeo() {
    proof = null;
    show('위치를 확인하는 중…', '위치 권한을 허용해 주세요', '', []);
    if (!navigator.geolocation) { show('위치를 쓸 수 없어요', '영수증으로 대신 인증할 수 있어요', 'bad', [receiptBtn()]); return; }
    navigator.geolocation.getCurrentPosition(function (p) {
      var sp = spot(), lat = p.coords.latitude, lng = p.coords.longitude;
      if (!sp || !sp.box) { show('매장 정보를 불러오지 못했어요', '잠시 뒤 다시 해 주세요', 'bad', [retryBtn()]); return; }
      var d = Math.round(window.spotDistance(sp, lat, lng));
      if (d <= window.SPOT_MARGIN_M) verified({ kind: 'gps', lat: lat, lng: lng });
      else show('후아나에서 ' + d + 'm 떨어져 있어요', '매장 안이나 바로 앞에서 남길 수 있어요', 'bad', [retryBtn(), receiptBtn()]);
    }, function (e) {
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

  /* ══ 2. 어항 ══ */
  var renderer = new THREE.WebGLRenderer({ canvas: $('gl'), alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 0.05, 50);
  scene.add(new THREE.HemisphereLight(0xdff6ff, 0x1a3a5a, 1.1));
  var sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(3, 6, 4); scene.add(sun);
  var world = new THREE.Group(); scene.add(world);
  var talk = null, speciesCfg = {}, style = null;

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
    var cfg = speciesCfg[r.fish] || speciesCfg[SPECIES[0][0]];
    if (!cfg) return;
    queue = queue.then(function () {
      return ReefModel.load(THREE, [Object.assign({}, cfg, { swim: 'path', count: null })]).then(function (m) {
        var p = m.fish[0], g = groupOf(r.grp), L = p.sizeK * m.ref, k = g.n++;
        m.holder.position.set(g.c[0], g.c[1], g.c[2]);
        // 같은 무리는 같은 고리 길을 조금씩 간격을 두고 돎
        p.lane = { rx: g.rx, rz: g.rz, y: ((k % 3) - 1) * 0.035, sp: 0.9 * L / ((g.rx + g.rz) / 2) * p.speedK * 1.4, ph: k * 0.6 + g.c[0], dir: g.dir };
        p.heads[0].userData.halfH = -1.5;
        p.obj.scale.setScalar(1.6);   // 어항이 작아서 물고기를 키움
        world.add(m.holder);
        var f = { r: r, m: m, p: p };
        fishes.push(f); byId[r.id] = f;
        while (fishes.length > MAX_FISH) { var old = fishes.shift(); world.remove(old.m.holder); delete byId[old.r.id]; }
        $('empty').classList.add('hidden');
        if (r.fresh) say(f, 5);
      }).catch(function () { delete byId[r.id]; });
    });
  }

  function say(f, sec) {
    if (!talk || !f) return;
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
  cv.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener('pointerup', function (e) {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 14 && performance.now() - down.t < 600) say(nearest(e.clientX, e.clientY), 4);
    down = null;
  });
  // 가만히 있어도 가끔 물고기가 한마디씩 함
  setInterval(function () { if (fishes.length && !document.hidden) say(fishes[Math.floor(Math.random() * fishes.length)]); }, 3600);

  var clock = new THREE.Clock();
  (function frame() {
    requestAnimationFrame(frame);
    var dt = Math.min(clock.getDelta(), 0.05);
    fishes.forEach(function (f) { f.m.update(dt); });
    // 화면이 좁으면 뒤로 물러나 무리가 다 보이게, 카메라는 천천히 흔들림
    camT += dt;
    var dist = Math.max(2.3, 0.9 / (Math.tan(20 * Math.PI / 180) * camera.aspect));
    camera.position.set(Math.sin(camT * 0.2) * 0.35, Math.sin(camT * 0.13) * 0.08, dist);
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

  /* ══ 3. 물고기 고르기 (작은 그림은 모델을 한 번씩 그려서 만듦) ══ */
  var picks = $('picks'), chosen = SPECIES[Math.floor(Math.random() * SPECIES.length)][0], thumbs = {};
  var btns = {};
  function drawPicks() {
    SPECIES.forEach(function (s) {
      var b = el('button', 'pick' + (s[0] === chosen ? ' on' : '')); b.type = 'button';
      var ph = el('div', 'ph'); ph.style.background = (speciesCfg[s[0]] && speciesCfg[s[0]].color) || '#8cc';
      b.appendChild(ph); b.appendChild(el('span', '', s[1]));
      b.addEventListener('click', function () {
        chosen = s[0];
        Object.keys(btns).forEach(function (k) { btns[k].classList.toggle('on', k === chosen); });
      });
      btns[s[0]] = b; picks.appendChild(b);
    });
  }
  function makeThumbs() {
    var r2 = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    r2.setPixelRatio(1); r2.setSize(168, 168); r2.outputEncoding = THREE.sRGBEncoding;
    var sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x446688, 1.2)); var l = new THREE.DirectionalLight(0xffffff, 1.1); l.position.set(2, 3, 4); sc.add(l);
    cam.position.set(0, 0, 3.4);
    var chain = Promise.resolve();
    SPECIES.forEach(function (s) {
      chain = chain.then(function () {
        var cfg = speciesCfg[s[0]]; if (!cfg) return;
        return ReefModel.load(THREE, [Object.assign({}, cfg, { swim: 'path', count: null })]).then(function (m) {
          var p = m.fish[0];
          m.update(0.4);
          p.obj.position.set(0, 0, 0); p.obj.rotation.set(0, -0.5, 0);
          m.holder.scale.setScalar(1.5 / (p.sizeK * m.ref));
          sc.add(m.holder); r2.render(sc, cam);
          thumbs[s[0]] = r2.domElement.toDataURL('image/png');
          sc.remove(m.holder);
          var img = el('img'); img.alt = s[1]; img.src = thumbs[s[0]];
          var b = btns[s[0]]; b.replaceChild(img, b.firstChild);
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
      spot_id: SPOT, nick: nick || null, body: body, fish_id: chosen,
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
      pushReview({ id: d.id, grp: d.grp, nick: nick || null, body: body, fish: chosen, created_at: new Date().toISOString(), fresh: true });
      toast('물고기가 어항에 풀려났어요 🐟');
      Core.log('wall_review', { spot: SPOT, proof: proof.kind });
    }, function () { sending = false; $('send').disabled = false; toast('인터넷 연결을 확인해 주세요'); });
  });
  $('body').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('send').click(); });

  /* ══ 5. 리뷰 불러오기와 목록 ══ */
  var reviews = [];                   // 새것이 앞
  function pushReview(r) {
    if (reviews.some(function (x) { return x.id === r.id; })) return;
    reviews.unshift(r); reviews.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    addFish(r); drawList();
  }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return '방금'; if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전'; return Math.floor(s / 86400) + '일 전';
  }
  function drawList() {
    var box = $('list'); box.innerHTML = '';
    $('cnt').textContent = reviews.length ? '(' + reviews.length + ')' : '';
    if (!reviews.length) { box.appendChild(el('p', 'none', '아직 리뷰가 없어요')); return; }
    var size = {}; reviews.forEach(function (r) { size[r.grp] = (size[r.grp] || 0) + 1; });
    reviews.forEach(function (r) {
      var it = el('div', 'it');
      var img = el('img'); img.alt = ''; if (thumbs[r.fish]) img.src = thumbs[r.fish];
      var tx = el('div', 'tx'), b = el('b', '', r.body), sm = el('small', '', (r.nick || '익명') + ' · ' + ago(r.created_at));
      if (size[r.grp] > 1) sm.appendChild(el('span', 'tag', '무리 ' + size[r.grp]));
      tx.appendChild(b); tx.appendChild(sm); it.appendChild(img); it.appendChild(tx);
      it.addEventListener('click', function () { showTab(false); say(byId[r.id] && byId[r.id].p ? byId[r.id] : null, 4); });
      box.appendChild(it);
    });
  }
  function fetchReviews() {
    if (!sb) return;
    sb.from('wall_reviews').select('id,nick,body,fish,grp,created_at').eq('spot', SPOT).order('created_at', { ascending: false }).limit(60)
      .then(function (r) {
        if (r.error || !r.data) return;
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

  /* ══ 6. 로그인 단추 (작게) ══ */
  Core.onChange(function (st) {
    var b = $('bLogin');
    b.textContent = st.user ? '로그아웃' : '카카오 로그인';
    b.onclick = st.user ? Core.logout : function () { Core.login(); };
    // 관리자 정보가 뒤늦게 도착하면 안내 화면을 다시 그려 '관리자로 시험하기' 단추를 보여 줌
    if (!proof && lastShow && Core.isAdmin()) show.apply(null, lastShow);
    if (!Core.ready) b.classList.add('hidden');
  });
  Core.start();

  /* ══ 시작 ══ */
  drawPicks();
  var spotsReady = window.loadSpots ? window.loadSpots(sb) : Promise.resolve();
  kit.loadData().then(function (d) {
    var r = ReefModel.reef(d);
    ((r && r.config.fish) || []).forEach(function (f) { speciesCfg[f.id] = f; });
    kit.applyStyle(d.style); style = d.style; talk = kit.Talk(tank, camera, d.style);
    SPECIES.forEach(function (s) { if (btns[s[0]] && speciesCfg[s[0]]) btns[s[0]].firstChild.style.background = speciesCfg[s[0]].color || '#8cc'; });
    makeThumbs(); fetchReviews();
  }).catch(function () { toast('물고기 정보를 읽지 못했어요'); });
  spotsReady.then(checkGeo);
})();
