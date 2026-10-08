/* reef-model.js
   3D 모델(GLB) 물고기들을 불러와서 여러 페이지가 같이 씀
   - reef-data.json에서 kind가 'model'인 reef 설정 찾기
   - 물고기 종류마다 파일 하나씩 불러와서 한 떼로 모으기 + 헤엄 + 화면에 맞는 크기 재기
   - 누른 자리에서 가장 가까운 물고기 찾기 (이름표용)
   쓰는 법: ReefModel.load(THREE, cfg.fish).then(function (s) { scene.add(s.holder); 매 프레임 s.update(dt); })
   cfg.fish 한 줄:
     { id, name, model, color(대표 색), swim: 'school' | 'path', count(떼 물고기를 몇 마리 보일지, 기본 1),
       size(혼자 헤엄치는 물고기 길이, 떼 물고기 한 마리 길이 대비), speed(혼자 헤엄치는 빠르기 배수), says(할 말), forward(머리 방향 '+x' '-z' 등), upright(해마처럼 서서 헤엄) }
     school: 같은 떼에서 나눈 파일이라 자리와 헤엄이 파일 안에 들어 있음
     path:   혼자 있는 모델이라 여기서 고리 모양 길을 따라 헤엄치게 함
*/
(function (root) {
  "use strict";
  var LOADER_URL = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
  var loaderReady = null;

  function script(src) {
    return new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s);
    });
  }
  function needLoader(THREE) {
    if (THREE.GLTFLoader) return Promise.resolve();
    if (!loaderReady) loaderReady = script(LOADER_URL);
    return loaderReady;
  }

  // 데이터에서 모델 reef 고르기 (id가 없으면 첫 번째 모델 reef)
  function reef(data, id) {
    var list = (data && data.reefs) || [];
    for (var i = 0; i < list.length; i++) if (list[i].kind === 'model' && (!id || list[i].id === id)) return list[i];
    return null;
  }

  // 뼈 이름 앞부분 (예: Clown1head6_10 → Clown1): 떼 안의 물고기 한 마리
  function who(name) { var m = /^([A-Za-z_]+?\d+)/.exec(name || ''); return m ? m[1] : ''; }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }

  function gltf(THREE, url) { return new Promise(function (ok, no) { new THREE.GLTFLoader().load(url, ok, null, no); }); }

  /* ── 떼 물고기: 동작이 붙은 뼈만 그 종류의 뼈. 한 마리씩 나눠서 count 마리만 보임 ── */
  function loadSchool(THREE, f) {
    return gltf(THREE, f.model).then(function (g) {
      var scene = g.scene, mixer = null, clip = g.animations[0] || null, mine = {};
      if (clip) {
        mixer = new THREE.AnimationMixer(scene);
        g.animations.forEach(function (a) { mixer.clipAction(a).play(); });
        clip.tracks.forEach(function (t) { var k = who(t.name.split('.')[0]); if (k) mine[k] = 1; });
      }
      var each = {};   // 한 마리 → { bones, head, roots }
      scene.traverse(function (o) {
        if (o.isMesh) o.frustumCulled = false;   // 뼈로 움직여서 화면 밖으로 잘못 잘리는 것 방지
        var k = who(o.name);
        if (!o.isBone || !mine[k]) return;
        var e = each[k] || (each[k] = { bones: [], head: null, roots: [] });
        e.bones.push(o);
        if (!e.head && /head(?!_?End)/i.test(o.name.slice(k.length))) e.head = o;
        if (!(o.parent && o.parent.isBone && who(o.parent.name) === k)) e.roots.push(o);
      });
      var names = Object.keys(each).sort(function (a, b) { return num(a.replace(/\D/g, ''), 0) - num(b.replace(/\D/g, ''), 0); });
      var count = Math.max(1, Math.round(num(f.count, 1)));
      var shown = names.slice(0, count), hiddenRoots = [];
      names.slice(count).forEach(function (k) { hiddenRoots = hiddenRoots.concat(each[k].roots); });
      var bones = [], heads = [];
      shown.forEach(function (k) { bones = bones.concat(each[k].bones); if (each[k].head) heads.push(each[k].head); });
      function hide() { hiddenRoots.forEach(function (b) { b.scale.setScalar(1e-4); }); }
      hide();
      return { kind: 'school', id: f.id, name: f.name || f.id, color: f.color || '', obj: scene, mixer: mixer, clip: clip,
               bones: bones, heads: heads, hide: hide, says: f.says || [] };
    });
  }

  /* ── 혼자 헤엄치는 물고기: 머리를 +x로 돌리고 길이를 맞춘 뒤 고리 길을 따라 움직임 ── */
  var TURN = { '+x': 0, '-x': Math.PI, '+z': Math.PI / 2, '-z': -Math.PI / 2 };
  function loadPath(THREE, f) {
    return gltf(THREE, f.model).then(function (g) {
      var model = g.scene, mixer = null;
      model.traverse(function (o) { if (o.isMesh) o.frustumCulled = false; });
      if (g.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        g.animations.forEach(function (a) { mixer.clipAction(a).play(); });
      }
      var turn = new THREE.Group(), pivot = new THREE.Group();
      turn.add(model); pivot.add(turn);
      turn.rotation.y = TURN[f.forward] || 0;
      // 가운데로 옮기고 머리 방향(+x) 길이를 잼
      var box = new THREE.Box3().setFromObject(turn), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      model.position.sub(c.applyAxisAngle(new THREE.Vector3(0, 1, 0), -turn.rotation.y));
      var len = f.upright ? s.y : s.x;
      var head = new THREE.Object3D(); pivot.add(head);   // 머리 자리 (이름표용, 크기 정한 뒤 옮김)
      return { kind: 'path', id: f.id, name: f.name || f.id, color: f.color || '', obj: pivot, mixer: mixer,
               len: len || 1, inner: turn, heads: [head], upright: !!f.upright, sizeK: num(f.size, 1.3), speedK: num(f.speed, 1),
               says: f.says || [] };
    });
  }

  // 헤엄치는 동안 뼈가 지나가는 자리를 모아서 크기와 가운데를 잼 (멈춘 모습만 재면 작게 나옴)
  function measure(THREE, parts) {
    var box = new THREE.Box3(), v = new THREE.Vector3(), len = 0, ref = 0;
    parts.forEach(function (p) { if (p.clip) len = Math.max(len, p.clip.duration); });
    for (var k = 0; k <= 20; k++) {
      parts.forEach(function (p) {
        if (p.mixer) p.mixer.setTime(len * k / 20);
        p.hide();
        p.obj.updateMatrixWorld(true);
        p.bones.forEach(function (b) { box.expandByPoint(b.getWorldPosition(v)); });
        // 맨 처음 모습에서 떼 물고기 한 마리 길이 (혼자 헤엄치는 물고기 크기 기준)
        if (k === 0 && !ref && p.bones.length){
          var one = new THREE.Box3(), first = who(p.bones[0].name);
          // 뿌리 뼈는 떼 가운데에 있어서 빼고 잼
          p.bones.forEach(function (b) { if (who(b.name) === first && !/root/i.test(b.name)) one.expandByPoint(b.getWorldPosition(v)); });
          var sz = one.getSize(new THREE.Vector3()); ref = Math.max(sz.x, sz.y, sz.z);
        }
      });
    }
    parts.forEach(function (p) { if (p.mixer) { p.mixer.setTime(0); p.hide(); } });
    if (box.isEmpty()) return { center: new THREE.Vector3(), size: 1, ref: 0.15 };
    var S = box.getSize(new THREE.Vector3()).length() || 1;
    return { center: box.getCenter(new THREE.Vector3()), size: S, ref: ref || S * 0.15 };
  }

  // 물고기들 불러오기: holder(가운데가 원점, 지름 = size) 안에 모두 들어 있음
  function load(THREE, list) {
    list = (list || []).filter(function (f) { return f && f.model; });
    return needLoader(THREE).then(function () {
      return Promise.all(list.map(function (f) { return f.swim === 'path' ? loadPath(THREE, f) : loadSchool(THREE, f); }));
    }).then(function (parts) {
      var holder = new THREE.Group(), inner = new THREE.Group(), speed = 1, t = 0;
      holder.add(inner);
      var school = parts.filter(function (p) { return p.kind === 'school'; }), solo = parts.filter(function (p) { return p.kind === 'path'; });
      school.forEach(function (p) { inner.add(p.obj); });
      var m = measure(THREE, school), S = m.size;
      inner.position.sub(m.center);
      // 혼자 헤엄치는 물고기: 떼 크기에 맞춰 길이와 길을 정함
      solo.forEach(function (p, i) {
        var L = p.sizeK * m.ref;
        p.inner.scale.setScalar(L / p.len);
        p.heads[0].position.set(p.upright ? 0 : L * 0.4, p.upright ? L * 0.35 : 0, 0);
        // 큰 물고기는 더 넓게 돌고, 빠르기는 각도 대신 실제로 가는 거리 기준 (멀리 돌아도 빨라 보이지 않게)
        var rx = S * (0.26 + 0.05 * (i % 2)) + L * 0.4, rz = S * (0.2 + 0.04 * ((i + 1) % 2)) + L * 0.3;
        p.lane = { rx: rx, rz: rz, y: S * (0.1 * (i - (solo.length - 1) / 2)),
                   sp: (p.upright ? 0.35 : 0.9) * L / ((rx + rz) / 2) * p.speedK, ph: i * 2.1, dir: i % 2 ? -1 : 1 };
        holder.add(p.obj);
      });
      function lane(p, time, out) {
        var L = p.lane, a = L.dir * time * L.sp + L.ph;
        return out.set(Math.cos(a) * L.rx, L.y + Math.sin(a * 1.7) * S * (p.upright ? 0.04 : 0.02), Math.sin(a) * L.rz);
      }
      var a = new THREE.Vector3(), b = new THREE.Vector3(), v = new THREE.Vector3();
      function step(dt) {
        t += dt * speed;
        parts.forEach(function (p) { if (p.mixer) p.mixer.update(dt * speed); if (p.hide) p.hide(); });
        solo.forEach(function (p) {
          lane(p, t, a); lane(p, t + 0.05, b);
          p.obj.position.copy(a);
          p.obj.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x) + (p.upright ? 0 : Math.sin(t * 4 * p.speedK + p.lane.ph) * 0.1);
          if (!p.upright) p.obj.rotation.z = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)) * 0.6;
        });
      }
      step(0);
      return {
        holder: holder, size: S, ref: m.ref, fish: parts,   // ref: 떼 물고기 한 마리 길이
        setSpeed: function (s) { speed = s == null ? 1 : +s; },
        update: step,
        // 크기를 맞춤: 지름이 d가 되게
        fit: function (d) { holder.scale.setScalar(d / S); },
        show: function (id, on) { parts.forEach(function (p) { if (p.id === id) p.obj.visible = on; }); },
        // 화면 좌표(x, y 픽셀)에서 가장 가까운 물고기 머리 (r 픽셀 안)
        nearest: function (camera, x, y, w, h, r, onlyId) {
          var best = null, bd = r || 48;
          parts.forEach(function (p) {
            if (!p.obj.visible || (onlyId && p.id !== onlyId)) return;
            p.heads.forEach(function (hd) {
              hd.getWorldPosition(v).project(camera);
              if (v.z > 1) return;
              var sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h, d = Math.hypot(sx - x, sy - y);
              if (d < bd) { bd = d; best = { fish: p, bone: hd }; }
            });
          });
          return best;
        }
      };
    });
  }

  root.ReefModel = { reef: reef, load: load };
})(window);
