/* reef-model.js
   3D 모델(GLB) 물고기들을 불러와서 여러 페이지가 같이 씀
   - reef-data.json에서 kind가 'model'인 reef 설정 찾기
   - 물고기 종류마다 파일 하나씩 불러와서 한 떼로 모으기 + 헤엄 동작 + 화면에 맞는 크기 재기
   - 누른 자리에서 가장 가까운 물고기 찾기 (이름표용)
   쓰는 법: ReefModel.load(THREE, cfg.fish).then(function (s) { scene.add(s.holder); 매 프레임 s.update(dt); })
     cfg.fish = [{ id: 'clownfish', name: 'Clownfish', model: 'assets/models/clownfish.glb' }, …]
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

  // 뼈 이름 앞부분 (예: Clown1head6_10 → Clown1): 물고기 한 마리
  function who(name) { var m = /^([A-Za-z_]+?\d+)/.exec(name || ''); return m ? m[1] : ''; }

  // 파일 하나 = 물고기 한 종류. 동작이 붙은 뼈만 그 종류의 뼈로 봄 (나머지 뼈는 다른 종류 것이라 안 움직임)
  function loadOne(THREE, f) {
    return new Promise(function (ok, no) { new THREE.GLTFLoader().load(f.model, ok, null, no); }).then(function (gltf) {
      var scene = gltf.scene, mixer = null, clip = gltf.animations[0] || null, mine = {};
      if (clip) {
        mixer = new THREE.AnimationMixer(scene);
        gltf.animations.forEach(function (a) { mixer.clipAction(a).play(); });
        clip.tracks.forEach(function (t) { var k = who(t.name.split('.')[0]); if (k) mine[k] = 1; });
      }
      var bones = [], heads = {};
      scene.traverse(function (o) {
        if (o.isMesh) o.frustumCulled = false;   // 뼈로 움직여서 화면 밖으로 잘못 잘리는 것 방지
        if (!o.isBone || !mine[who(o.name)]) return;
        bones.push(o);
        if (/head(?!_?End)/i.test(o.name.slice(who(o.name).length)) && !heads[who(o.name)]) heads[who(o.name)] = o;
      });
      return { id: f.id, name: f.name || f.id, scene: scene, mixer: mixer, clip: clip, bones: bones,
               heads: Object.keys(heads).map(function (k) { return heads[k]; }) };
    });
  }

  // 헤엄치는 동안 뼈가 지나가는 자리를 모아서 크기와 가운데를 잼 (멈춘 모습만 재면 작게 나옴)
  function measure(THREE, parts) {
    var box = new THREE.Box3(), v = new THREE.Vector3(), len = 0;
    parts.forEach(function (p) { if (p.clip) len = Math.max(len, p.clip.duration); });
    for (var k = 0; k <= 20; k++) {
      parts.forEach(function (p) {
        if (p.mixer) p.mixer.setTime(len * k / 20);
        p.scene.updateMatrixWorld(true);
        p.bones.forEach(function (b) { box.expandByPoint(b.getWorldPosition(v)); });
      });
    }
    parts.forEach(function (p) { if (p.mixer) p.mixer.setTime(0); });
    if (box.isEmpty()) parts.forEach(function (p) { box.expandByObject(p.scene); });
    return { center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()).length() || 1 };
  }

  // 물고기들 불러오기: holder(가운데가 원점, 지름 = size) 안에 모두 들어 있음
  function load(THREE, list) {
    list = (list || []).filter(function (f) { return f && f.model; });
    return needLoader(THREE).then(function () {
      return Promise.all(list.map(function (f) { return loadOne(THREE, f); }));
    }).then(function (parts) {
      var holder = new THREE.Group(), inner = new THREE.Group(), speed = 1;
      holder.add(inner);
      parts.forEach(function (p) { inner.add(p.scene); });
      var m = measure(THREE, parts);
      inner.position.sub(m.center);
      var v = new THREE.Vector3();
      return {
        holder: holder, size: m.size, fish: parts,
        setSpeed: function (s) { speed = s == null ? 1 : +s; },
        update: function (dt) { parts.forEach(function (p) { if (p.mixer) p.mixer.update(dt * speed); }); },
        // 크기를 맞춤: 지름이 d가 되게
        fit: function (d) { holder.scale.setScalar(d / m.size); },
        show: function (id, on) { parts.forEach(function (p) { if (p.id === id) p.scene.visible = on; }); },
        // 화면 좌표(x, y 픽셀)에서 가장 가까운 물고기 머리 (r 픽셀 안)
        nearest: function (camera, x, y, w, h, r) {
          var best = null, bd = r || 48;
          parts.forEach(function (p) {
            if (!p.scene.visible) return;
            p.heads.forEach(function (b) {
              b.getWorldPosition(v).project(camera);
              if (v.z > 1) return;
              var sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h, d = Math.hypot(sx - x, sy - y);
              if (d < bd) { bd = d; best = { fish: p, bone: b }; }
            });
          });
          return best;
        }
      };
    });
  }

  root.ReefModel = { reef: reef, load: load };
})(window);
