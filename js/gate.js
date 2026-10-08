/* 처음 화면: 로그인 표시, 뒤로 가기, 장소 AR (위치를 확인해서 후아나 · CORD Jr. · 비마관 어항으로 보냄)
   영수증 인증 창은 js/visit.js */
(function () {
  "use strict";
  var PLACES = [['juana', '디저트카페 후아나'], ['cord', 'CORD Jr.'], ['bima', '광운대학교 비마관']];
  var $ = function (id) { return document.getElementById(id); };
  var about = $('about'), visit = $('visit'), place = $('place'), pBody = $('pBody'), back = $('bBack');
  var step = 'gate', turn = 0;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function button(text, fn, main) { var b = el('button', 'xbtn' + (main ? ' def' : ''), text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function show(w) {
    [about, visit, place].forEach(function (x) { x.classList.toggle('hidden', x !== w); });
    back.classList.toggle('hidden', w === about);
  }
  function home() { step = 'gate'; turn++; Visit.close(); show(about); }

  // 영수증 인증
  $('goReceipt').addEventListener('click', function () { step = 'receipt'; Visit.open(); show(visit); });

  // 장소 AR: 아이폰은 누르는 순간에만 움직임 센서를 물어볼 수 있어서 여기서 먼저 물어봄
  $('goPlace').addEventListener('click', function () {
    var D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') D.requestPermission().catch(function () {});
    step = 'place'; show(place); locate();
  });

  // 위치 → 장소 안이면 그 장소 어항으로, 아니면 장소마다 거리를 보여 줌
  function draw(main, text, btns, list) {
    pBody.innerHTML = '';
    var p = el('p'); p.appendChild(el('span', 'lead', main)); if (text) { p.appendChild(el('br')); p.appendChild(document.createTextNode(text)); }
    pBody.appendChild(p);
    if (list) pBody.appendChild(list);
    var r = el('div', 'abtns'); (btns || []).forEach(function (b) { r.appendChild(b); }); pBody.appendChild(r);
  }
  function go(id) { location.href = 'reef.html?spot=' + id; }
  function adminRow() {
    if (!(window.Core && Core.isAdmin())) return null;
    var p = el('p', 'fine', '관리자: 위치와 상관없이 열기 ');
    PLACES.forEach(function (x) { p.appendChild(button(x[1], function () { go(x[0]); })); });
    return p;
  }
  function locate() {
    var my = ++turn;
    draw('위치를 확인하는 중…', '위치 권한을 허용해 주세요.', [button('취소', home)], adminRow());
    if (!navigator.geolocation) { draw('위치를 쓸 수 없는 브라우저예요', 'Chrome이나 Safari로 열어 주세요.', [button('처음으로', home, true)], adminRow()); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (my !== turn) return;
      var lat = pos.coords.latitude, lng = pos.coords.longitude, best = null, ul = el('ul', 'fine');
      PLACES.forEach(function (x) {
        var sp = (window.SPOTS || []).filter(function (o) { return o.id === x[0]; })[0];
        if (!sp || !sp.box) return;
        var d = Math.round(window.spotDistance(sp, lat, lng));
        if (!best || d < best.d) best = { id: x[0], name: x[1], d: d };
        ul.appendChild(el('li', '', x[1] + ': ' + (d < 1000 ? d + 'm' : (d / 1000).toFixed(1) + 'km')));
      });
      if (best && best.d <= window.SPOT_MARGIN_M) {
        draw('\'' + best.name + '\' 안이에요', '어항을 여는 중…', [], null);
        setTimeout(function () { if (my === turn) go(best.id); }, 500);
        return;
      }
      var box = el('div'); box.appendChild(ul); var ad = adminRow(); if (ad) box.appendChild(ad);
      draw('등록된 장소 안이 아니에요', '장소 AR은 아래 장소 안에서만 열려요.', [button('처음으로', home), button('다시 확인', locate, true)], box);
    }, function (e) {
      if (my !== turn) return;
      draw(e && e.code === 1 ? '위치 권한이 꺼져 있어요' : '위치를 찾지 못했어요', '설정에서 위치 권한을 켜고 다시 확인해 주세요.',
        [button('처음으로', home), button('다시 확인', locate, true)], adminRow());
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 });
  }

  // 뒤로: 영수증 창은 안쪽 단계부터, 나머지는 처음 화면으로
  back.addEventListener('click', function () {
    if (step === 'receipt' && Visit.back()) return;
    home();
  });

  /* ── 로그인 영역 (위쪽 오른쪽) ── */
  var authBox = $('auth'), mySpace = $('mySpace');
  function drawAuth(state) {
    authBox.innerHTML = '';
    mySpace.classList.toggle('hidden', !state.user);
    if (!Core.ready) return;
    if (!state.user) {
      var b = el('button', 'kakao', '카카오 로그인'); b.type = 'button';
      b.addEventListener('click', function () { Core.login(); }); authBox.appendChild(b); return;
    }
    authBox.appendChild(el('span', 'who', (state.profile && state.profile.nickname) || '로그인됨'));
    if (Core.isAdmin()) { var a = el('a', 'mini', '관리자'); a.href = 'admin.html'; authBox.appendChild(a); }
    var o = el('button', 'mini', '로그아웃'); o.type = 'button'; o.addEventListener('click', Core.logout); authBox.appendChild(o);
  }
  Core.onChange(drawAuth);
  Core.start();
  if (Core.ready) setTimeout(function () { Core.log('visit'); }, 1200);
})();
