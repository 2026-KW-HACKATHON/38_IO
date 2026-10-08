/* 친구 관리 창 (나의 공간): XP 속성 창 모양 (위 탭 + 흰 판 + 아래 확인 단추)
   탭: 친구 목록 · 받은 요청 · 초대 · 선물함
   - 초대: 카카오톡으로 내 초대 링크를 보냄 (xp_web.html?invite=코드), 받은 사람이 열고 수락하면 친구
   - 친구마다: 어항 구경, 선물 보내기(내 재고에서 하나), 이름 따로 붙이기, 친구 삭제
   서버 함수는 supabase/schema.sql 13번 */
(function () {
  "use strict";
  var KAKAO_SDK = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';
  var KIND = { fish: '물고기', item: '아이템', effect: '이펙트' };
  var ui = null, names = null;

  // 재고 이름: reef-data.json의 물고기 · 아이템 · 이펙트 이름 (없으면 id 그대로)
  function loadNames() {
    if (names) return names;
    names = fetch('reef-data.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var out = { fish: {}, item: {}, effect: {} };
      (d.reefs || []).forEach(function (r) { ((r.config || {}).fish || []).forEach(function (f) { out.fish[f.id] = f.name || f.id; }); });
      (d.items || []).forEach(function (x) { out.item[x.id] = x.label || x.name || x.id; });
      (d.effects || []).forEach(function (x) { out.effect[x.id] = x.label || x.name || x.id; });
      return out;
    }, function () { names = null; return { fish: {}, item: {}, effect: {} }; });
    return names;
  }
  function stockName(n, kind, ref) { return (n[kind] && n[kind][ref]) || ref; }

  function nameOf(f) { return f.alias || f.nickname || '카카오 사용자'; }
  function pic(src, cls) {
    var im = ui.el('img', cls || 'fpic'); im.alt = ''; im.src = src || 'assets/space/xp/icon-account.png';
    im.onerror = function () { im.onerror = null; im.src = 'assets/space/xp/icon-account.png'; };
    return im;
  }
  function rpc(name, args) {
    return Core.sb.rpc(name, args || {}).then(function (r) {
      if (r.error) { Core.toast(ui.errText(r.error)); throw r.error; }
      return r.data;
    });
  }

  /* ── 창 만들기 ── */
  function build(entry, helpers) {
    ui = helpers;
    var body = entry.body;
    body.innerHTML = '<div class="ptabs" role="tablist"></div><div class="ppanel" role="tabpanel"></div>' +
      '<div class="pfoot"><button type="button" class="xbtn">확인</button></div>';
    var tabs = body.querySelector('.ptabs'), panel = body.querySelector('.ppanel'), cur = 'list';
    var picked = null;   // 친구 목록에서 고른 친구 id
    [['list', '친구 목록'], ['req', '받은 요청'], ['invite', '초대'], ['gift', '선물함']].forEach(function (t) {
      var b = ui.el('button', 'ptab', t[1]); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.tab = t[0];
      b.addEventListener('click', function () { cur = t[0]; draw(); });
      tabs.appendChild(b);
    });
    body.querySelector('.pfoot .xbtn').addEventListener('click', function () { entry.close(); });

    function draw() {
      tabs.querySelectorAll('.ptab').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === cur ? 'true' : 'false'); });
      panel.innerHTML = '';
      var st = Core.state;
      if (!Core.ready) { panel.appendChild(ui.el('p', 'empty', '서버 설정 전이라 쓸 수 없습니다.')); return; }
      if (!st.user) {
        panel.appendChild(ui.el('p', 'empty', '카카오로 로그인하면 쓸 수 있습니다.'));
        panel.appendChild(ui.button('카카오로 로그인', function () { Core.login(); }));
        return;
      }
      ({ list: drawList, req: drawReq, invite: drawInvite, gift: drawGift })[cur](panel);
    }
    entry.redraw = draw;

    // 친구 목록: 고른 친구로 할 일 단추
    function drawList(panel) {
      var g = ui.group('친구'), box = ui.el('div', 'flist'), acts = ui.el('div', 'prow');
      g.appendChild(box); g.appendChild(acts); panel.appendChild(g);
      box.appendChild(ui.el('p', 'empty', '불러오는 중…'));
      rpc('my_friends').then(function (list) {
        var mine = list.filter(function (f) { return f.state === 'friend'; });
        box.innerHTML = '';
        if (!mine.length) { box.appendChild(ui.el('p', 'empty', '아직 친구가 없습니다. ‘초대’ 탭에서 카카오톡으로 초대해 보십시오.')); }
        if (!mine.some(function (f) { return f.id === picked; })) picked = null;
        mine.forEach(function (f) {
          var row = ui.el('div', 'frow' + (f.id === picked ? ' on' : ''));
          row.appendChild(pic(f.photo));
          var t = ui.el('span', 'fname'); t.appendChild(ui.el('b', '', nameOf(f)));
          if (f.alias) t.appendChild(ui.el('span', 'fsub', f.nickname || ''));
          row.appendChild(t);
          row.addEventListener('click', function () { picked = f.id; box.querySelectorAll('.frow').forEach(function (r) { r.classList.toggle('on', r === row); }); sync(); });
          row.addEventListener('dblclick', function () { ui.openTank(f); });
          box.appendChild(row);
        });
        function sel() { return mine.filter(function (f) { return f.id === picked; })[0]; }
        var bs = [
          ui.button('어항 구경', function () { if (sel()) ui.openTank(sel()); }),
          ui.button('선물 보내기', function () { if (sel()) sendGift(sel()); }),
          ui.button('이름 바꾸기', function () { if (sel()) rename(sel(), draw); }),
          ui.button('친구 삭제', function () { if (sel()) unfriend(sel(), draw); })
        ];
        bs.forEach(function (b) { acts.appendChild(b); });
        function sync() { bs.forEach(function (b) { b.disabled = !sel(); }); }
        sync();
        panel.appendChild(ui.el('p', 'note', '친구를 두 번 누르면 그 친구의 어항을 구경합니다. 친구에게는 나의 계정에서 정한 프로필 사진이 보입니다.'));
      }, function () { box.innerHTML = ''; box.appendChild(ui.el('p', 'empty', '친구 목록을 불러오지 못했습니다.')); });
    }

    // 받은 요청 (수락 · 거절), 보낸 요청 (취소)
    function drawReq(panel) {
      var g1 = ui.group('받은 요청'), g2 = ui.group('보낸 요청');
      panel.appendChild(g1); panel.appendChild(g2);
      g1.appendChild(ui.el('p', 'empty', '불러오는 중…'));
      rpc('my_friends').then(function (list) {
        g1.querySelector('.empty').remove();
        function rows(g, state, btns) {
          var some = list.filter(function (f) { return f.state === state; });
          if (!some.length) g.appendChild(ui.el('p', 'empty', state === 'got' ? '받은 요청이 없습니다.' : '보낸 요청이 없습니다.'));
          some.forEach(function (f) {
            var row = ui.el('div', 'role'), t = ui.el('div', 'rtxt');
            t.appendChild(pic(f.photo)); t.appendChild(ui.el('span', '', nameOf(f)));
            row.appendChild(t);
            var r = ui.el('div', 'nrow'); btns(f).forEach(function (b) { r.appendChild(b); }); row.appendChild(r);
            g.appendChild(row);
          });
        }
        rows(g1, 'got', function (f) {
          return [ui.button('수락', function () { rpc('friend_accept', { target: f.id }).then(function () { Core.toast(nameOf(f) + '님과 친구가 되었습니다.'); draw(); }); }),
                  ui.button('거절', function () { rpc('friend_remove', { target: f.id }).then(draw); })];
        });
        rows(g2, 'sent', function (f) {
          return [ui.button('취소', function () { rpc('friend_remove', { target: f.id }).then(draw); })];
        });
      }, function () {});
      panel.appendChild(ui.el('p', 'note', '내 초대 링크를 연 사람은 ‘보낸 요청’에 보이고, 그 사람이 수락하면 친구가 됩니다.'));
    }

    // 초대: 카카오톡으로 보내기, 링크 복사, 내 코드, 코드로 친구 추가
    function drawInvite(panel) {
      var g = ui.group('카카오톡으로 초대');
      g.appendChild(ui.el('p', 'note', '카카오톡 친구에게 내 초대 링크를 보냅니다. 받은 친구가 링크를 열고 수락하면 친구가 됩니다.'));
      var r = ui.el('div', 'prow'); g.appendChild(r); panel.appendChild(g);
      var c = ui.group('내 초대 코드'), code = ui.el('div', 'fcode', '…'), r2 = ui.el('div', 'prow');
      c.appendChild(code); c.appendChild(r2); panel.appendChild(c);
      var mine = '';
      function link() { return location.origin + location.pathname + '?invite=' + mine; }
      var share = ui.button('카카오톡으로 초대', function () { if (mine) kakaoInvite(link()); });
      var copy = ui.button('링크 복사', function () { if (mine) ui.copyText(link()).then(function (ok) { Core.toast(ok ? '초대 링크를 복사했습니다.' : '복사하지 못했습니다.'); }); });
      r.appendChild(share); r.appendChild(copy);
      r2.appendChild(ui.button('새 코드 만들기', function () {
        rpc('my_invite', { renew: true }).then(function (v) { mine = v; code.textContent = v; Core.toast('새 코드를 만들었습니다. 예전 링크는 더 이상 쓸 수 없습니다.'); });
      }));
      rpc('my_invite', { renew: false }).then(function (v) { mine = v; code.textContent = v; }, function () { code.textContent = '-'; });

      var a = ui.group('코드로 친구 추가'), nr = ui.el('div', 'nrow');
      var inp = ui.el('input', 'gin'); inp.type = 'text'; inp.maxLength = 12; inp.placeholder = '친구의 초대 코드'; inp.autocapitalize = 'off'; inp.spellcheck = false;
      nr.appendChild(inp); nr.appendChild(ui.button('확인', function () { if (inp.value.trim()) join(inp.value.trim(), draw); }));
      a.appendChild(nr); panel.appendChild(a);
    }

    // 선물함: 내 재고, 받은 선물
    function drawGift(panel) {
      var g1 = ui.group('내 재고'), g2 = ui.group('받은 선물');
      panel.appendChild(g1); panel.appendChild(g2);
      Promise.all([rpc('my_stock'), rpc('my_gifts'), loadNames()]).then(function (v) {
        var stock = v[0], gifts = v[1], n = v[2];
        if (!stock.length) g1.appendChild(ui.el('p', 'empty', '재고가 없습니다.'));
        var kv = ui.el('dl', 'kv');
        stock.forEach(function (s) { kv.appendChild(ui.el('dt', '', KIND[s.kind] || s.kind)); kv.appendChild(ui.el('dd', '', stockName(n, s.kind, s.ref) + ' × ' + s.qty)); });
        g1.appendChild(kv);
        if (!gifts.length) g2.appendChild(ui.el('p', 'empty', '받은 선물이 없습니다.'));
        gifts.forEach(function (x) {
          var row = ui.el('div', 'role'), t = ui.el('span', 'rtxt');
          t.appendChild(ui.el('b', '', x.from_name)); t.appendChild(ui.el('span', '', (KIND[x.kind] || x.kind) + ' · ' + stockName(n, x.kind, x.ref)));
          row.appendChild(t); row.appendChild(ui.el('span', 'note', new Date(x.created_at).toLocaleDateString('ko-KR')));
          g2.appendChild(row);
        });
      }, function () {});
    }

    // 선물 보내기: 내 재고에서 하나 골라 보냄
    function sendGift(f) {
      var box = ui.msgBox(nameOf(f) + '에게 선물', 'icon-gift.png'), close = function () { box.el.remove(); };
      box.el.classList.add('wide');
      box.say('불러오는 중…', [['취소', close]]);
      Promise.all([rpc('my_stock'), loadNames()]).then(function (v) {
        var stock = v[0], n = v[1];
        if (!stock.length) { box.say('보낼 재고가 없습니다.', [['확인', close]]); return; }
        var wrap = ui.el('div', 'sform'), lab = ui.el('label', '', '보낼 것'), sel = ui.el('select', 'xsel');
        lab.htmlFor = 'gift-pick'; sel.id = 'gift-pick';
        stock.forEach(function (s, i) {
          var o = ui.el('option', '', (KIND[s.kind] || s.kind) + ' · ' + stockName(n, s.kind, s.ref) + ' (' + s.qty + '개)'); o.value = i; sel.appendChild(o);
        });
        wrap.appendChild(lab); wrap.appendChild(sel);
        box.say('', [['보내기', function () {
          var s = stock[+sel.value];
          rpc('gift_send', { target: f.id, gkind: s.kind, gref: s.ref }).then(function () {
            close(); Core.toast(nameOf(f) + '님에게 ' + stockName(n, s.kind, s.ref) + '을(를) 보냈습니다.');
          }, function () {});
        }], ['취소', close]]);
        box.put(wrap);
      }, close);
    }

    if (Core) Core.onChange(function () { if (entry.isOpen()) draw(); });
    draw();
  }

  // 친구 이름 따로 붙이기
  function rename(f, done) {
    var box = ui.msgBox('친구 이름', 'icon-friends.png'), close = function () { box.el.remove(); };
    var wrap = ui.el('div', 'sform'), lab = ui.el('label', '', '이름'), inp = ui.el('input', 'gin');
    lab.htmlFor = 'friend-alias'; inp.id = 'friend-alias'; inp.type = 'text'; inp.maxLength = 20; inp.value = f.alias || ''; inp.placeholder = f.nickname || '';
    wrap.appendChild(lab); wrap.appendChild(inp);
    function ok() { rpc('friend_alias', { target: f.id, name: inp.value }).then(function () { close(); done(); }, function () {}); }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') ok(); });
    box.say('', [['확인', ok], ['취소', close]]); box.put(wrap);
    box.el.querySelector('.mtx').appendChild(ui.el('p', 'note', '비워 두면 친구의 닉네임으로 보입니다.'));
    inp.focus();
  }
  function unfriend(f, done) {
    var box = ui.msgBox('친구 삭제', 'icon-friends.png'), close = function () { box.el.remove(); };
    box.say(nameOf(f) + '님을 친구에서 삭제하시겠습니까?', [['삭제', function () {
      rpc('friend_remove', { target: f.id }).then(function () { close(); done(); }, close);
    }], ['취소', close]]);
  }

  // 초대 코드 확인: 코드 주인과 친구가 될지 묻고 수락하면 친구
  function join(code, done) {
    return rpc('friend_join', { code: code }).then(function (f) {
      var box = ui.msgBox('친구 초대', 'icon-friends.png'), close = function () { box.el.remove(); if (done) done(); };
      var who = ui.el('div', 'rtxt'); who.appendChild(pic(f.photo, 'fpic big'));
      if (f.state === 'friend') {
        who.appendChild(ui.el('span', '', (f.nickname || '카카오 사용자') + '님과 이미 친구입니다.'));
        box.say('', [['확인', close]]); box.put(who); return;
      }
      if (f.state === 'sent') {
        who.appendChild(ui.el('span', '', (f.nickname || '카카오 사용자') + '님에게 이미 요청을 보냈습니다.'));
        box.say('', [['확인', close]]); box.put(who); return;
      }
      who.appendChild(ui.el('span', '', (f.nickname || '카카오 사용자') + '님이 친구 초대를 보냈습니다.'));
      box.say('', [
        ['수락', function () { rpc('friend_accept', { target: f.id }).then(function () { Core.toast('친구가 되었습니다.'); close(); }, close); }],
        ['나중에', close],
        ['거절', function () { rpc('friend_remove', { target: f.id }).then(close, close); }]
      ]);
      box.put(who);
    }, function () {});
  }

  // 카카오톡 공유로 초대 링크 보내기 (안 되면 기기 공유, 그것도 없으면 복사)
  var sdk = null;
  function kakaoInvite(url) {
    var key = (window.APP_CONFIG || {}).KAKAO_MAP_KEY, nick = (Core.state.profile && Core.state.profile.nickname) || '친구';
    function fallback() {
      if (navigator.share) { navigator.share({ title: '월계 아쿠아 친구 초대', text: nick + '님이 월계 아쿠아 친구로 초대했습니다.', url: url }).catch(function () {}); return; }
      ui.copyText(url).then(function (ok) { Core.toast(ok ? '카카오톡을 열 수 없어 초대 링크를 복사했습니다.' : '복사하지 못했습니다.'); });
    }
    if (!key) { fallback(); return; }
    if (!sdk) sdk = window.Kakao ? Promise.resolve() : ui.loadScript(KAKAO_SDK);
    sdk.then(function () {
      if (!window.Kakao || !Kakao.Share) { fallback(); return; }
      if (!Kakao.isInitialized()) Kakao.init(key);
      Kakao.Share.sendDefault({
        objectType: 'feed',
        content: {
          title: '월계 아쿠아 친구 초대',
          description: nick + '님이 월계 아쿠아 친구로 초대했습니다.',
          imageUrl: location.origin + location.pathname.replace(/[^\/]*$/, '') + 'assets/start/invite.jpg',
          link: { mobileWebUrl: url, webUrl: url }
        },
        buttons: [{ title: '초대 받기', link: { mobileWebUrl: url, webUrl: url } }]
      });
    }, function () { sdk = null; fallback(); });
  }

  /* ── 초대 링크로 들어온 경우 (?invite=코드): 로그인 뒤 수락할지 물음 (로그인하러 다녀와도 기억) ── */
  var KEY = 'qrium.invite';
  function checkInvite(helpers) {
    ui = ui || helpers;
    var q = new URLSearchParams(location.search).get('invite');
    if (q) {
      try { localStorage.setItem(KEY, q); } catch (e) {}
      history.replaceState(null, '', location.pathname);   // 주소창에서 코드를 지움
    }
    var asked = false;
    Core.onChange(function (st) {
      var code = null;
      try { code = localStorage.getItem(KEY); } catch (e) {}
      if (!code || !st.loaded || asked) return;
      asked = true;
      if (!st.user) {
        var box = ui.msgBox('친구 초대', 'icon-friends.png'), close = function () { box.el.remove(); };
        box.say('친구 초대를 받았습니다.\n카카오로 로그인하면 수락할 수 있습니다.',
          Core.ready ? [['카카오 로그인', function () { Core.login(); }], ['닫기', close]] : [['닫기', close]]);
        return;
      }
      try { localStorage.removeItem(KEY); } catch (e) {}
      join(code);
    });
  }

  window.XPFriends = { build: build, checkInvite: checkInvite };
})();
