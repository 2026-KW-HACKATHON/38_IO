/* 모든 페이지가 같이 쓰는 기능: 서버 연결, 카카오 로그인, 활동 기록 */
(function () {
  "use strict";
  var cfg = window.APP_CONFIG || {};
  var sb = null;
  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  var state = { user: null, profile: null, loaded: false };
  var listeners = [];

  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) {} }); }
  function onChange(fn) { listeners.push(fn); if (state.loaded) fn(state); }

  // 화면 아래에 잠깐 뜨는 안내 글
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  // 로그인한 사람의 프로필(닉네임, 관리자 여부) 가져오기
  function loadProfile(user) {
    state.user = user || null;
    if (!user) { state.profile = null; state.loaded = true; emit(); return Promise.resolve(); }
    return sb.from('profiles').select('*').eq('id', user.id).maybeSingle().then(function (r) {
      state.profile = r.data || null;
      state.loaded = true;
      emit();
    });
  }

  // 활동 기록: 로그인한 사람만 남김. 실패해도 화면에는 영향 없음
  function log(event, meta) {
    if (!sb || !state.user) return;
    sb.from('activity_logs').insert({ user_id: state.user.id, event: event, meta: meta || {} })
      .then(function () {}, function () {});
  }

  // other가 참이면 카카오 로그인 화면을 다시 띄워 다른 계정으로 들어갈 수 있게 함
  function login(other) {
    if (!sb) { toast('서버 설정 전이라 로그인을 쓸 수 없습니다'); return; }
    // 카카오 이메일은 사용자가 동의한 경우에만 받아짐
    var opt = { redirectTo: location.origin + location.pathname, scopes: 'profile_nickname profile_image account_email' };
    if (other === true) opt.queryParams = { prompt: 'login' };
    sb.auth.signInWithOAuth({ provider: 'kakao', options: opt });
  }

  function logout() {
    if (!sb) return;
    log('logout');
    // 기록이 먼저 나가도록 잠깐 기다렸다가 로그아웃
    setTimeout(function () { sb.auth.signOut(); }, 250);
  }

  function isAdmin() { return !!(state.profile && state.profile.is_admin); }

  // 권한 목록: 'admin'(관리자), 'owner:가게'(점주), 'tester'(베타테스터). 화면에서 다른 작업을 허락할 때 can('owner:cord')처럼 씀
  function perms() {
    var list = isAdmin() ? ['admin'] : [];
    ((state.profile && state.profile.roles) || []).forEach(function (r) {
      if (r.kind === 'owner') list.push('owner:' + (r.spot || r.code));
      if (r.kind === 'tester') list.push('tester');
    });
    return list;
  }
  function can(p) { return perms().indexOf(p) >= 0; }

  function start() {
    if (!sb) { state.loaded = true; emit(); return; }
    sb.auth.getSession().then(function (r) { loadProfile(r.data.session && r.data.session.user); });
    sb.auth.onAuthStateChange(function (ev, session) {
      // 콜백 안에서 바로 서버 요청을 하면 멈출 수 있어서 한 박자 늦춤
      setTimeout(function () {
        loadProfile(session && session.user).then(function () {
          if (ev === 'SIGNED_IN') {
            var seen = false;
            try { seen = sessionStorage.getItem('reef-login-logged') === '1'; sessionStorage.setItem('reef-login-logged', '1'); } catch (e) {}
            if (!seen) log('login');
          }
          if (ev === 'SIGNED_OUT') { try { sessionStorage.removeItem('reef-login-logged'); } catch (e) {} }
        });
      }, 0);
    });
  }

  window.Core = {
    sb: sb, ready: !!sb, state: state,
    onChange: onChange, toast: toast, log: log,
    login: login, logout: logout, isAdmin: isAdmin, perms: perms, can: can, start: start,
    reload: function () { return loadProfile(state.user); }   // 프로필을 고친 뒤 다시 읽기
  };
})();
