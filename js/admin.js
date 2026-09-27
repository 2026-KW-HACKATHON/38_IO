/* 관리자 화면: 계정 목록, 활동 기록 보기, 계정 삭제 */
(function () {
  "use strict";
  var main = document.getElementById('main');
  var authBox = document.getElementById('auth');
  var users = [], picked = null, timer = null, sureId = null;

  var EVENT_NAMES = {
    login: '로그인', logout: '로그아웃', visit: '접속', ar_start: 'AR 시작',
    reef_switch: 'reef 전환', location: '위치 확인', photo: '촬영 저장'
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function when(s) {
    if (!s) return '-';
    var d = new Date(s), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function detail(ev, meta) {
    meta = meta || {};
    if (ev === 'reef_switch') return meta.reef || '';
    if (ev === 'location') return meta.lat + ', ' + meta.lng;
    if (ev === 'ar_start') return (meta.camera ? '카메라 ' : '카메라 없음 ') + (meta.motion ? '센서' : '');
    return '';
  }

  /* ── 로그인 영역 ── */
  function drawAuth(state) {
    authBox.innerHTML = '';
    if (state.user) {
      var o = el('button', 'pill', '로그아웃'); o.type = 'button'; o.addEventListener('click', Core.logout); authBox.appendChild(o);
    }
  }

  /* ── 상태별 화면 ── */
  function render(state) {
    drawAuth(state);
    clearInterval(timer);
    main.innerHTML = '';
    if (!Core.ready) {
      var c = el('div', 'card');
      c.appendChild(el('p', 'muted', '서버 설정이 아직 비어 있어요. js/config.js에 Supabase 주소와 키를 넣어 주세요.'));
      main.appendChild(c); return;
    }
    if (!state.loaded) { main.appendChild(el('p', 'muted', '불러오는 중…')); return; }
    if (!state.user) {
      var c2 = el('div', 'card center');
      c2.appendChild(el('p', 'muted', '관리자 계정으로 로그인해 주세요.'));
      var b = el('button', 'kakao', '카카오 로그인'); b.type = 'button'; b.addEventListener('click', Core.login);
      c2.appendChild(b); main.appendChild(c2); return;
    }
    if (!Core.isAdmin()) {
      var c3 = el('div', 'card');
      c3.appendChild(el('p', 'muted', '여기서 뭐하세요 :('));
      main.appendChild(c3); return;
    }
    drawDashboard();
  }

  /* ── 관리자 화면 ── */
  function drawDashboard() {
    var stats = el('div', 'stats'); stats.id = 'stats';
    var uCard = el('div', 'card'); uCard.appendChild(el('h2', null, '계정'));
    var uWrap = el('div', 'scroll'); uWrap.id = 'users'; uCard.appendChild(uWrap);
    var lCard = el('div', 'card'); lCard.id = 'logCard';
    main.appendChild(stats); main.appendChild(uCard); main.appendChild(lCard);
    refresh();
    timer = setInterval(refresh, 8000);   // 8초마다 새로 불러옴
  }

  function refresh() {
    if (document.hidden) return;
    Core.sb.rpc('admin_user_summary').then(function (r) {
      if (r.error) { Core.toast('계정 목록 오류: ' + r.error.message); return; }
      users = r.data || [];
      drawStats(); drawUsers();
    });
    loadLogs();
  }

  function drawStats() {
    var box = document.getElementById('stats'); if (!box) return;
    var since = Date.now() - 24 * 3600 * 1000;
    var active = users.filter(function (u) { return u.last_active && new Date(u.last_active).getTime() > since; }).length;
    var total = users.reduce(function (a, u) { return a + Number(u.log_count || 0); }, 0);
    box.innerHTML = '';
    [['전체 계정', users.length], ['최근 24시간 활동 계정', active], ['전체 활동 기록', total]].forEach(function (s) {
      var d = el('div', 'stat'); d.appendChild(el('b', null, String(s[1]))); d.appendChild(el('span', null, s[0])); box.appendChild(d);
    });
  }

  function drawUsers() {
    var wrap = document.getElementById('users'); if (!wrap) return;
    var t = el('table');
    var head = el('tr'); ['계정', '가입', '마지막 활동', '기록', ''].forEach(function (h) { head.appendChild(el('th', null, h)); });
    t.appendChild(head);
    users.forEach(function (u) {
      var tr = el('tr', u.id === picked ? 'pick' : '');
      tr.style.cursor = 'pointer';
      var td = el('td');
      if (u.avatar_url) { var im = el('img', 'avatar'); im.src = u.avatar_url; im.alt = ''; td.appendChild(im); }
      td.appendChild(document.createTextNode(u.nickname || '(이름 없음)'));
      if (u.is_admin) td.appendChild(el('span', 'tag', '관리자'));
      tr.appendChild(td);
      tr.appendChild(el('td', 'hide-sm', when(u.created_at)));
      tr.appendChild(el('td', null, when(u.last_active)));
      tr.appendChild(el('td', null, String(u.log_count)));
      var act = el('td');
      if (!u.is_admin) {
        var del = el('button', 'danger' + (sureId === u.id ? ' sure' : ''), sureId === u.id ? '정말 삭제' : '삭제');
        del.type = 'button';
        del.addEventListener('click', function (e) { e.stopPropagation(); removeUser(u); });
        act.appendChild(del);
      }
      tr.appendChild(act);
      tr.addEventListener('click', function () { picked = (picked === u.id ? null : u.id); drawUsers(); loadLogs(); });
      t.appendChild(tr);
    });
    wrap.innerHTML = ''; wrap.appendChild(t);
  }

  // 삭제 버튼: 한 번 누르면 "정말 삭제"로 바뀌고, 한 번 더 눌러야 삭제됨
  function removeUser(u) {
    if (sureId !== u.id) { sureId = u.id; drawUsers(); setTimeout(function () { if (sureId === u.id) { sureId = null; drawUsers(); } }, 4000); return; }
    sureId = null;
    Core.sb.rpc('admin_delete_user', { target: u.id }).then(function (r) {
      if (r.error) { Core.toast('삭제 실패: ' + r.error.message); return; }
      if (picked === u.id) picked = null;
      Core.toast((u.nickname || '계정') + ' 삭제 완료');
      refresh();
    });
  }

  // 선택한 계정의 기록, 선택이 없으면 전체 최근 기록
  function loadLogs() {
    var card = document.getElementById('logCard'); if (!card) return;
    var q = Core.sb.from('activity_logs').select('id,event,meta,created_at,user_id,profiles(nickname)')
      .order('created_at', { ascending: false }).limit(150);
    if (picked) q = q.eq('user_id', picked);
    q.then(function (r) {
      if (r.error) { Core.toast('기록 오류: ' + r.error.message); return; }
      var who = picked ? (users.filter(function (u) { return u.id === picked; })[0] || {}).nickname : null;
      card.innerHTML = '';
      card.appendChild(el('h2', null, who ? who + ' 님의 활동' : '전체 최근 활동'));
      var wrap = el('div', 'scroll'), t = el('table');
      var head = el('tr'); ['시간', '계정', '활동', '내용'].forEach(function (h) { head.appendChild(el('th', null, h)); });
      t.appendChild(head);
      (r.data || []).forEach(function (l) {
        var tr = el('tr');
        tr.appendChild(el('td', null, when(l.created_at)));
        tr.appendChild(el('td', null, (l.profiles && l.profiles.nickname) || ''));
        tr.appendChild(el('td', null, EVENT_NAMES[l.event] || l.event));
        tr.appendChild(el('td', 'muted', detail(l.event, l.meta)));
        t.appendChild(tr);
      });
      wrap.appendChild(t); card.appendChild(wrap);
      if (!(r.data || []).length) card.appendChild(el('p', 'muted', '아직 기록이 없어요.'));
    });
  }

  Core.onChange(render);
  Core.start();
})();
