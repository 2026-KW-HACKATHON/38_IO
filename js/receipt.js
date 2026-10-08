/* 영수증 인증: 사진 속 글자를 이 기기 안에서 읽고(외부 서비스 비용 없음) 가게 · 결제 시각 · 승인번호를 뽑아 확인
   사진은 서버에 올리지 않고, 읽어 낸 값만 서버에 남김 (같은 영수증은 한 번만) */
(function () {
  "use strict";
  var LIB = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var LANG = 'assets/ocr';   // 한글 · 영문 글자 자료 (사이트에 같이 올려 둠)
  var MINS = 15;             // 결제 시각이 적힌 영수증은 결제 후 몇 분 안에만 받음 (supabase/schema.sql 11번과 같게)
  var DAYS = 30;             // 시각 없이 날짜만 적힌 영수증은 며칠 안에만 받음 (위와 같음)
  var SIDE = 2000;           // 사진의 긴 쪽을 이 크기까지 줄여서 읽음

  /* ── 글자 읽는 도구: 처음 쓸 때 한 번만 불러옴 ── */
  var ready = null, onStep = null;
  function loadLib() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise(function (ok, no) {
      var sc = document.createElement('script'); sc.src = LIB; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc);
    });
  }
  function engine() {
    if (!ready) {
      ready = loadLib().then(function () {
        return Tesseract.createWorker(['kor', 'eng'], 1, {
          langPath: new URL(LANG, location.href).href,
          logger: function (m) { if (onStep) onStep(m); }
        });
      });
      ready.catch(function () { ready = null; });
    }
    return ready;
  }

  /* ── 사진 다듬기: 크기를 줄이고 흑백으로 바꾼 뒤 밝기 차이를 키움 ── */
  function prepare(file) {
    var pic = window.createImageBitmap ? createImageBitmap(file) : new Promise(function (ok, no) {
      var im = new Image(); im.onload = function () { ok(im); }; im.onerror = no; im.src = URL.createObjectURL(file);
    });
    return pic.then(function (im) {
      var k = Math.min(1, SIDE / Math.max(im.width, im.height));
      var cv = document.createElement('canvas');
      cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      var cx = cv.getContext('2d');
      cx.drawImage(im, 0, 0, cv.width, cv.height);
      var px = cx.getImageData(0, 0, cv.width, cv.height), d = px.data, lo = 255, hi = 0, i, g;
      for (i = 0; i < d.length; i += 4) {
        g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        d[i] = g; if (g < lo) lo = g; if (g > hi) hi = g;
      }
      var span = Math.max(1, hi - lo);
      for (i = 0; i < d.length; i += 4) { g = (d[i] - lo) * 255 / span; d[i] = d[i + 1] = d[i + 2] = g; }
      cx.putImageData(px, 0, 0);
      return cv;
    });
  }

  /* ── 읽기: step(진행 정도 0~1, 안내 글)로 진행 상황을 알려 줌 ── */
  function read(file, step) {
    var say = step || function () {};
    say(0, '글자 읽는 도구를 준비하는 중…');
    onStep = function (m) {
      if (m.status === 'recognizing text') say(m.progress, '글자를 읽는 중…');
      else if (/load|initializ/.test(m.status)) say(0, '글자 읽는 도구를 준비하는 중…');
    };
    return Promise.all([engine(), prepare(file)]).then(function (r) {
      return r[0].recognize(r[1]);
    }).then(function (res) {
      onStep = null;
      var text = (res.data && res.data.text) || '';
      return { text: text, info: parse(text) };
    }, function (e) { onStep = null; throw e; });
  }

  /* ── 읽은 글에서 값 뽑기 ── */
  function squash(s) { return s.replace(/\s+/g, '').toLowerCase(); }
  // 숫자 옆에서 잘못 읽기 쉬운 글자(O, l, I 등)를 숫자로 고침
  function fixNum(s) {
    for (var n = 0; n < 2; n++) {
      s = s.replace(/(\d)[Oo○]/g, '$10').replace(/[Oo○](\d)/g, '0$1')
           .replace(/(\d)[lI|]/g, '$11').replace(/[lI|](\d)/g, '1$1');
    }
    return s;
  }
  var DATE_KEY = /거래일|결제일|승인일|판매일|매출일|발행일|일시|일자|날짜|date/i;
  var SUM_KEY = /합계|총액|결제금액|받을금액|승인금액|총결제|판매금액|청구금액|카드결제|total/i;

  function parse(text) {
    var lines = fixNum(text).split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    return { spot: findSpot(lines), shop: findShop(lines), paidAt: findTime(lines), approval: findApproval(lines), biz: findBiz(lines), amount: findAmount(lines) };
  }

  // 결제 시각: 날짜가 적힌 줄(날짜 머리말이 있는 줄 먼저) + 같은 줄이나 다음 줄의 시각
  function findTime(lines) {
    var best = null;
    lines.forEach(function (ln, i) {
      var d = pickDate(ln);
      if (!d) return;
      var t = pickTime(ln.slice(d.end), true) || pickTime(lines[i + 1] || '') || pickTime(lines[i - 1] || '');
      var score = (DATE_KEY.test(squash(ln)) ? 2 : 0) + (t ? 1 : 0);
      if (!best || score > best.score) best = { d: d, t: t, score: score };
    });
    if (!best) return null;
    var t = best.t || { h: 0, m: 0, s: 0, none: true };
    return { y: best.d.y, mo: best.d.mo, d: best.d.d, h: t.h, mi: t.m, s: t.s, noTime: !!t.none };
  }
  // 날짜 모양이 여러 개면 달 · 날이 말이 되는 첫 번째 것
  function pickDate(s) {
    var forms = [/(?:^|[^\d])(20\d{2}|\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})(?!\d)/g, /(?:^|[^\d])(20\d{2})(\d{2})(\d{2})(?!\d)/g];
    for (var f = 0; f < forms.length; f++) {
      var m;
      while ((m = forms[f].exec(s))) {
        var y = +m[1] < 100 ? 2000 + +m[1] : +m[1], mo = +m[2], d = +m[3];
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { y: y, mo: mo, d: d, end: m.index + m[0].length };
      }
    }
    return null;
  }
  // near가 참이면 날짜 바로 뒤라서 '093011'처럼 붙여 쓴 시각도 받음
  function pickTime(s, near) {
    var m = /(오전|오후|AM|PM)?\s*(\d{1,2})\s*[:시]\s*(\d{2})(?:\s*[:분]\s*(\d{2}))?/i.exec(s) ||
            (near && /^\s*()([01]\d|2[0-3])([0-5]\d)([0-5]\d)?(?!\d)/.exec(s));
    if (!m) return null;
    var h = +m[2], mi = +m[3], sec = +(m[4] || 0);
    if (m[1] && /오후|pm/i.test(m[1]) && h < 12) h += 12;
    if (m[1] && /오전|am/i.test(m[1]) && h === 12) h = 0;
    if (h > 23 || mi > 59 || sec > 59) return null;
    return { h: h, m: mi, s: sec };
  }

  // 승인번호: '승인' 뒤의 숫자 6~12자리 (승인일시 · 승인금액은 빼고)
  function findApproval(lines) {
    for (var i = 0; i < lines.length; i++) {
      var s = squash(lines[i]);
      var m = /승인(?:번호|no\.?|#)?[:.]?(\d{6,12})(?!\d)/.exec(s.replace(/승인(일시|일자|금액|일)/g, ''));
      if (m) return m[1];
      if (/승인번호/.test(s)) { var n = /(\d{6,12})/.exec(squash(lines[i + 1] || '')); if (n) return n[1]; }
    }
    return '';
  }

  // 사업자번호: 000-00-00000
  function findBiz(lines) {
    var all = lines.join('\n');
    var m = /(\d{3})\s*-\s*(\d{2})\s*-\s*(\d{5})/.exec(all);
    if (!m) { var k = /사업자[^\n]*?(\d{10})(?!\d)/.exec(all.replace(/[ -]/g, '')); if (k) return k[1].replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3'); return ''; }
    return m[1] + '-' + m[2] + '-' + m[3];
  }

  // 결제 금액: 합계 · 결제금액 같은 머리말이 있는 줄의 마지막 금액 중 가장 큰 값
  function findAmount(lines) {
    var best = 0;
    lines.forEach(function (ln) {
      if (!SUM_KEY.test(squash(ln))) return;
      var nums = ln.match(/\d{1,3}(?:[,.]\d{3})+|\d{3,8}/g);
      if (!nums) return;
      var v = +nums[nums.length - 1].replace(/[,.]/g, '');
      if (v > best && v < 100000000) best = v;
    });
    return best;
  }

  // 가게: 사업자번호가 같거나, 이름 · 다른 이름이 글 안에 있거나, 글자 조각이 거의 다 겹치면 그 가게
  function pairs(s) { var out = []; for (var i = 0; i < s.length - 1; i++) out.push(s.substr(i, 2)); return out; }
  function findSpot(lines) {
    var spots = window.SPOTS || [], all = squash(lines.join(''));
    var biz = findBiz(lines), best = null;
    spots.forEach(function (sp) {
      if (sp.biz && biz && sp.biz === biz) { best = { spot: sp, score: 2 }; return; }
      [sp.name].concat(sp.alias || []).forEach(function (nm) {
        var key = squash(nm);
        if (key.length < 2) return;
        var score = all.indexOf(key) >= 0 ? 1 : 0;
        if (!score) {
          var want = pairs(key);
          lines.forEach(function (ln) {
            var have = pairs(squash(ln)), hit = want.filter(function (p) { return have.indexOf(p) >= 0; }).length;
            score = Math.max(score, hit / want.length * 0.9);
          });
        }
        if (score >= 0.6 && (!best || score > best.score)) best = { spot: sp, score: score };
      });
    });
    return best ? best.spot : null;
  }

  // 지도에 없는 가게용 이름: '상호 · 가맹점명' 같은 머리말 뒤의 글, 없으면 맨 위 몇 줄 중 글자가 있는 첫 줄
  var SHOP_KEY = /^(?:상호명?|가맹점명?|매장명|점포명|업체명|가게명?)\s*[:：]?\s*/;
  var NOT_SHOP = /영수증|전표|신용|카드|receipt|사업자|대표|주소|tel|전화|\d{2,}[-./]\d/i;
  function findShop(lines) {
    var name = '';
    lines.some(function (ln) { var m = SHOP_KEY.exec(ln); if (m && ln.length > m[0].length) { name = ln.slice(m[0].length); return true; } });
    if (!name) lines.slice(0, 4).some(function (ln) {
      if (NOT_SHOP.test(ln) || SUM_KEY.test(squash(ln)) || DATE_KEY.test(squash(ln)) || /승인|\d,\d{3}/.test(ln) || (ln.match(/[가-힣a-zA-Z]/g) || []).length < 2) return false;
      name = ln; return true;
    });
    return name.replace(/사업자.*$/, '').replace(/[\[\]()<>*=_~|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  /* ── 판정: 가게 · 결제 시각 · 기한 · 결제 정보 네 가지를 확인 (free가 참이면 기한을 보지 않음: 베타테스터) ── */
  function when(t) { return t ? new Date(Date.UTC(t.y, t.mo - 1, t.d, t.h - 9, t.mi, t.s)) : null; }   // 영수증 시각은 한국 시간
  function judge(info, free) {
    var at = when(info.paidAt), timed = !!(info.paidAt && !info.paidAt.noTime);
    var mins = at ? (Date.now() - at.getTime()) / 60000 : null, limit = timed ? MINS : DAYS * 1440;
    var shop = info.spot ? info.spot.name : info.shop ? info.shop + ' (지도에 없는 가게)' : info.biz ? '사업자번호 ' + info.biz + ' (지도에 없는 가게)' : '';
    var checks = [
      { key: 'spot', ok: !!shop, text: shop || '가게 이름을 찾지 못함' },
      { key: 'time', ok: !!at, text: at ? show(info.paidAt) : '결제 날짜를 찾지 못함' },
      { key: 'age', ok: mins != null && mins >= -10 && (free || mins <= limit),
        text: mins == null ? '-' : mins < -10 ? '앞으로의 날짜라 받을 수 없음'
          : free ? '시간 제한 없음 (베타테스터)'
          : mins > limit ? '결제한 지 ' + (timed ? MINS + '분' : DAYS + '일') + '이 지남'
          : timed ? Math.max(0, Math.floor(mins)) + '분 전 결제' : Math.floor(mins / 1440) + '일 전 결제 (시각 없음)' },
      { key: 'pay', ok: !!(info.approval || info.biz || info.amount),
        text: [info.approval && '승인 ' + info.approval, info.amount && info.amount.toLocaleString('ko-KR') + '원'].filter(Boolean).join(' · ') || (info.biz ? '사업자번호 ' + info.biz : '승인번호 · 금액을 찾지 못함') }
    ];
    return { ok: checks.every(function (c) { return c.ok; }), checks: checks, at: at };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function show(t) {
    return t.y + '.' + pad(t.mo) + '.' + pad(t.d) + (t.noTime ? '' : ' ' + pad(t.h) + ':' + pad(t.mi));
  }

  /* ── 서버에 남기기: 같은 영수증을 먼저 올린 사람이 있으면 동행으로 묶임 (같은 사람이 두 번은 안 됨) ── */
  function submit(info) {
    return Core.sb.rpc('submit_receipt', {
      shop_id: info.spot ? info.spot.id : null, shop_name: info.spot ? info.spot.name : info.shop || null,
      paid: when(info.paidAt).toISOString(), has_time: !info.paidAt.noTime,
      approval_no: info.approval || null, total: info.amount || null, biz_no: info.biz || null
    });
  }
  function mine() { return Core.sb.rpc('my_receipts'); }

  window.Receipt = { read: read, parse: parse, judge: judge, submit: submit, mine: mine, MINS: MINS, DAYS: DAYS };
})();
