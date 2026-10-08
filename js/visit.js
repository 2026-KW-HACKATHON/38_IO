/* 처음 화면의 영수증 인증 창: 영수증을 찍어 가게 방문을 확인하고, 그 매장의 낚시 · 리뷰 작성 단추를 보여 줌
   로그인 없이 확인만 되고, 로그인한 상태면 서버에도 남김. 인증한 영수증은 이 탭에 기억해서 낚시 · 리뷰에 씀 */
(function () {
  "use strict";
  var about = document.getElementById('about'), win = document.getElementById('visit');
  var body = document.getElementById('vBody'), pick = document.getElementById('vPick');
  var now = null, prog = null, turn = 0;   // 지금 상태 (읽는 중 · 결과 · 오류), 진행 막대, 읽기 차례 (뒤로 가면 늘려서 앞 결과를 버림)
  var NAMES = { spot: '가게', time: '결제 시각', age: '기한', pay: '결제 정보' };

  if (window.loadSpots) window.loadSpots(window.Core && Core.sb);

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, fn, main) {
    var b = el('button', 'xbtn' + (main ? ' def' : ''), text); b.type = 'button';
    b.addEventListener('click', fn); return b;
  }
  function btns(list) { var r = el('div', 'abtns'); list.forEach(function (b) { r.appendChild(b); }); return r; }
  function shot() { pick.value = ''; pick.click(); }

  function draw() {
    body.innerHTML = ''; prog = null;
    if (!now) {
      body.appendChild(el('p', '', '결제 후 ' + Receipt.MINS + '분 안에 영수증을 밝은 곳에서 평평하게 펴고 화면에 꽉 차게 찍어 주십시오.'));
      body.appendChild(el('p', 'fine', '글자는 이 기기 안에서 읽고, 사진은 서버에 올리지 않습니다.'));
      body.appendChild(btns([button('영수증 찍기', shot, true)]));
      return;
    }
    if (now.busy) {
      var box = el('div', 'vwait'), bar = el('div', 'xprog'), fill = el('i'), txt = el('p', 'fine', '준비하는 중…');
      bar.appendChild(fill); box.appendChild(bar); box.appendChild(txt); body.appendChild(box);
      prog = { fill: fill, txt: txt };
      return;
    }
    if (now.err) {
      body.appendChild(el('p', 'vbad', now.err));
      body.appendChild(btns([button('다시 찍기', shot, true)]));
      return;
    }
    if (now.v.ok) {
      body.appendChild(el('p', 'vdone', '\'' + shopName(now.info) + '\' 방문 인증되었습니다.'));
      if (now.note) body.appendChild(el('p', 'fine', now.note));
      var id = now.info.spot && now.info.spot.id;
      if (FISHING[id]) {
        remember(id);
        body.appendChild(el('p', 'fine', '낚시는 매장 안에서만 할 수 있습니다.'));
        body.appendChild(btns([
          button('리뷰 작성', function () { location.href = 'reef.html?spot=' + id; }),
          button('낚시', function () { location.href = 'reef.html?spot=' + id + '&mode=fish'; }, true)
        ]));
      } else body.appendChild(el('p', 'fine', '이 매장은 아직 어항이 없습니다.'));
      return;
    }
    // 인증 실패: 네 가지 확인 결과를 보여 주고 다시 찍기
    var kv = el('dl', 'vchk');
    now.v.checks.forEach(function (c) {
      kv.appendChild(el('dt', '', NAMES[c.key]));
      kv.appendChild(el('dd', c.ok ? 'ok' : 'no', (c.ok ? '✔ ' : '✖ ') + c.text));
    });
    body.appendChild(kv);
    body.appendChild(el('p', 'fine', '✖ 칸이 있으면 흔들리지 않게, 글자가 잘 보이도록 다시 찍어 주십시오.'));
    body.appendChild(btns([button('다시 찍기', shot, true)]));
  }

  // 낚시 · 리뷰를 할 수 있는 매장
  var FISHING = { juana: 1, cord: 1 };
  // 인증한 영수증을 이 탭에 기억 (장소 어항 화면이 낚시 · 영수증 리뷰에 씀)
  function remember(id) {
    var i = now.info;
    try {
      sessionStorage.setItem('qrium.receipt', JSON.stringify({ spot: id, shop: i.spot.name, approval: i.approval || null,
        amount: i.amount || null, biz: i.biz || null, paid: now.v.at ? now.v.at.toISOString() : null }));
    } catch (e) {}
  }

  // 가게 이름: 지도에 있는 가게면 그 이름, 아니면 영수증에서 읽은 이름
  function shopName(info) {
    return info.spot ? info.spot.name : info.shop || '사업자번호 ' + info.biz;
  }

  // 로그인한 상태면 서버에도 남김 (실패해도 인증 화면은 그대로, 아래에 이유만 적음)
  function save(my) {
    if (!Core.ready || !Core.state.user) return;
    Receipt.submit(now.info).then(function (res) {
      if (my !== turn) return;
      if (res.error) { now.note = '기록을 남기지 못했습니다. ' + (res.error.message || ''); draw(); return; }
      Core.log('receipt_ok', { spot: now.info.spot ? now.info.spot.id : now.info.shop, with: !!(res.data && res.data.lead === false) });
    });
  }

  pick.addEventListener('change', function () {
    var f = pick.files && pick.files[0];
    if (!f) return;
    var my = ++turn;
    now = { busy: true }; draw();
    Receipt.read(f, function (p, msg) {
      if (my !== turn || !prog) return;
      prog.fill.style.width = Math.round(p * 100) + '%'; prog.txt.textContent = msg;
    }).then(function (r) {
      if (my !== turn) return;
      now = { info: r.info, v: Receipt.judge(r.info, Core.can('tester')) }; draw();
      if (now.v.ok) save(my);
    }, function () {
      if (my !== turn) return;
      now = { err: '영수증을 읽지 못했습니다. 인터넷 연결을 확인하고 다시 해 주십시오.' }; draw();
    });
  });

  window.Visit = {
    // 영수증 창 열기
    open: function () { now = null; turn++; draw(); about.classList.add('hidden'); win.classList.remove('hidden'); },
    // 처음 화면 창으로 되돌림
    close: function () { now = null; turn++; win.classList.add('hidden'); about.classList.remove('hidden'); },
    // 뒤로: 결과 · 읽는 중이면 찍기 전으로 돌리고 참, 이미 찍기 전이면 거짓
    back: function () { if (!now) return false; now = null; turn++; draw(); return true; }
  };
})();
