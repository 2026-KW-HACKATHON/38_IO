/* reef-model.js
   3D 모델(GLB) 물고기들을 불러와서 여러 페이지가 같이 씀
   - reef-data.json에서 kind가 'model'인 reef 설정 찾기
   - 물고기 종류마다 파일 하나씩 불러와서 한 떼로 모으기 + 헤엄 + 화면에 맞는 크기 재기
   - 누른 자리에서 가장 가까운 물고기 찾기 (이름표용)
   쓰는 법: ReefModel.load(THREE, cfg.fish).then(function (s) { scene.add(s.holder); 매 프레임 s.update(dt); })
   cfg.fish 한 줄:
     { id, name, model, color(대표 색), swim: 'school' | 'path', count(떼 물고기를 몇 마리 보일지, 기본 1),
       size(혼자 헤엄치는 물고기 길이, 떼 물고기 한 마리 길이 대비), speed(혼자 헤엄치는 빠르기 배수), says(할 말), forward(머리 방향 '+x' '-z' 등), upright(해마처럼 서서 헤엄), clip(동작 이름, 여러 개일 때), pitch(머리를 숙이는 각도, 도),
       thrust(꼬리 밀기, 아래 참고),
       flutter(지느러미 떨림, 아래 참고) }
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

  /* ── 지느러미 떨림: 모델에 지느러미 동작이 없을 때, 등 뒤로 튀어나온 얇은 판을 옆으로 물결치게 함 ──
     flutter: { y: [아래, 위], back: 등 선, depth: 튀어나온 길이, amp: 흔들림 폭, rate: 빠르기, wave: 물결 촘촘함 }
     좌표는 모델 파일 안쪽 좌표 (압축된 모델은 -1~1). 등 선(back)보다 뒤로 나온 만큼 더 크게 흔들림 */
  var clock = { value: 0 };
  var GET = ['getX', 'getY', 'getZ', 'getW'];
  // 꼭짓점 값 읽기 (압축된 값은 원래 크기로 풂)
  function raw(attr, i, k) {
    var v = attr[GET[k]](i), a = attr.isInterleavedBufferAttribute ? attr.data.array : attr.array;
    if (!attr.normalized) return v;
    return a instanceof Int16Array ? Math.max(v / 32767, -1) : a instanceof Int8Array ? Math.max(v / 127, -1)
         : a instanceof Uint16Array ? v / 65535 : a instanceof Uint8Array ? v / 255 : v;
  }
  function addFlutter(THREE, root, fl) {
    root.traverse(function (o) {
      if (!o.isMesh) return;
      var pos = o.geometry.attributes.position, n = pos.count, w = new Float32Array(n), y0 = fl.y[0], y1 = fl.y[1];
      for (var i = 0; i < n; i++) {
        var y = raw(pos, i, 1), z = raw(pos, i, 2);
        if (y > y0 && y < y1 && z < fl.back) w[i] = Math.min(1, (fl.back - z) / fl.depth);
      }
      o.geometry.setAttribute('finW', new THREE.BufferAttribute(w, 1));
      var m = o.material;
      m.onBeforeCompile = function (sh) {
        sh.uniforms.finT = clock;
        sh.vertexShader = 'attribute float finW;\nuniform float finT;\n' + sh.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed.x += finW * ' + (+fl.amp).toFixed(4) + ' * sin(finT * ' + (+fl.rate).toFixed(3) + ' - position.y * ' + (+fl.wave).toFixed(3) + ');');
      };
      m.customProgramCacheKey = function () { return 'flutter'; };
      m.needsUpdate = true;
    });
  }

  // 뼈로 움직이는 모델은 뼈를 적용한 모양으로 크기를 잼 (파일의 기본 모양과 크기가 다를 수 있음)
  function skinnedBox(THREE, root) {
    root.updateMatrixWorld(true);
    var box = new THREE.Box3(), v = new THREE.Vector3(), skinned = false;
    root.traverse(function (o) {
      if (!o.isSkinnedMesh) return;
      skinned = true;
      o.skeleton.update();
      var g = o.geometry.attributes, n = g.position.count, step = Math.max(1, Math.floor(n / 600));
      var base = new THREE.Vector3(), part = new THREE.Vector3(), mat = new THREE.Matrix4(), bones = o.skeleton.bones;
      for (var i = 0; i < n; i += step) {
        // 압축된 값도 풀어서: 기본 자리 → 뼈마다 움직인 자리를 무게만큼 더함
        base.set(raw(g.position, i, 0), raw(g.position, i, 1), raw(g.position, i, 2)).applyMatrix4(o.bindMatrix);
        v.set(0, 0, 0);
        for (var k = 0; k < 4; k++) {
          var w = raw(g.skinWeight, i, k); if (!w) continue;
          var b = g.skinIndex[GET[k]](i);
          mat.multiplyMatrices(bones[b].matrixWorld, o.skeleton.boneInverses[b]);
          v.addScaledVector(part.copy(base).applyMatrix4(mat), w);
        }
        box.expandByPoint(v.applyMatrix4(o.bindMatrixInverse).applyMatrix4(o.matrixWorld));
      }
    });
    return skinned ? box : new THREE.Box3().setFromObject(root);
  }

  /* ── 꼬리 밀기: 뼈 몇 개를 박자에 맞춰 한 방향으로 확 굽혔다가 천천히 폄 ──
     thrust: { bones: [뼈 이름 앞부분...], axis: 'x'|'y'|'z', amp: 굽는 각도(라디안, 끝 뼈일수록 커짐), rate: 1초에 몇 번 }
     파일 동작이 움직이지 않는 뼈는 매번 처음 자세로 되돌린 뒤 굽힘 */
  function setupThrust(THREE, root, clip, th) {
    var moved = {}, list = [];
    if (clip) clip.tracks.forEach(function (t) { moved[t.name.split('.').slice(0, -1).join('.')] = 1; });
    (th.bones || []).forEach(function (pre, i, all) {
      root.traverse(function (o) {
        if (!o.isBone || o.name.indexOf(pre) !== 0 || list.some(function (x) { return x.b === o; })) return;
        list.push({ b: o, rest: o.quaternion.clone(), anim: !!moved[o.name], k: (i + 1) / all.length });
      });
    });
    var axis = new THREE.Vector3(th.axis === 'x' ? 1 : 0, th.axis === 'y' ? 1 : 0, th.axis === 'z' ? 1 : 0), q = new THREE.Quaternion();
    return function (t) {
      // 빨리 굽히고(앞 25%) 천천히 폄
      var ph = (t * (+th.rate || 1)) % 1, push = ph < 0.25 ? Math.sin(ph / 0.25 * Math.PI / 2) : Math.cos((ph - 0.25) / 0.75 * Math.PI / 2);
      list.forEach(function (x) {
        if (!x.anim) x.b.quaternion.copy(x.rest);
        x.b.quaternion.multiply(q.setFromAxisAngle(axis, push * (+th.amp || 0.3) * x.k));
      });
    };
  }

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
      if (f.flutter && f.flutter.y) addFlutter(THREE, model, f.flutter);
      // 동작이 여러 개면 clip 이름으로 고른 것 하나만 (없으면 첫 번째)
      var clip = g.animations.filter(function (a) { return a.name === f.clip; })[0] || g.animations[0];
      if (clip) { mixer = new THREE.AnimationMixer(model); mixer.clipAction(clip).play(); }
      var thrust = f.thrust && f.thrust.bones ? setupThrust(THREE, model, clip, f.thrust) : null;
      var turn = new THREE.Group(), tilt = new THREE.Group(), pivot = new THREE.Group();
      turn.add(model); tilt.add(turn); pivot.add(tilt);
      turn.rotation.y = TURN[f.forward] || 0;
      // 가운데로 옮기고 머리 방향(+x) 길이를 잼
      var box = skinnedBox(THREE, turn), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      model.position.sub(c.applyAxisAngle(new THREE.Vector3(0, 1, 0), -turn.rotation.y));
      var len = f.upright ? s.y : s.x;
      tilt.rotation.z = -num(f.pitch, 0) * Math.PI / 180;   // 머리 숙이기
      var head = new THREE.Object3D(); pivot.add(head);   // 머리 자리 (이름표용, 크기 정한 뒤 옮김)
      return { kind: 'path', id: f.id, name: f.name || f.id, color: f.color || '', obj: pivot, mixer: mixer,
               thrust: thrust, len: len || 1, inner: turn, heads: [head], upright: !!f.upright, sizeK: num(f.size, 1.3), speedK: num(f.speed, 1),
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
        t += dt * speed; clock.value = t;
        parts.forEach(function (p) { if (p.mixer) p.mixer.update(dt * speed); if (p.thrust) p.thrust(t); if (p.hide) p.hide(); });
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
