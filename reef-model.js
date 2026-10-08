/* reef-model.js
   3D 모델(GLB) 물고기 떼를 불러와서 여러 페이지가 같이 씀
   - reef-data.json에서 kind가 'model'인 reef 설정 찾기
   - 모델 불러오기 + 헤엄 동작 + 화면에 맞는 크기 재기
   - 출처(라이선스) 글 만들기
   쓰는 법: ReefModel.load(THREE, url).then(function (m) { scene.add(m.holder); 매 프레임 m.update(dt); })
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

  // 헤엄치는 동안 뼈가 지나가는 자리를 모아서 크기와 가운데를 잼 (멈춘 모습만 재면 작게 나옴)
  function measure(THREE, obj, mixer, clip) {
    var box = new THREE.Box3(), v = new THREE.Vector3(), bones = [];
    obj.traverse(function (o) { if (o.isBone) bones.push(o); });
    var len = clip ? clip.duration : 0, steps = bones.length ? 20 : 0;
    for (var k = 0; k <= steps; k++) {
      if (mixer) mixer.setTime(len * k / Math.max(1, steps));
      obj.updateMatrixWorld(true);
      bones.forEach(function (b) { box.expandByPoint(b.getWorldPosition(v)); });
    }
    if (mixer) mixer.setTime(0);
    if (box.isEmpty()) box.setFromObject(obj);
    var center = box.getCenter(new THREE.Vector3());
    return { center: center, size: box.getSize(new THREE.Vector3()).length() || 1 };
  }

  // 모델 불러오기: holder(가운데가 원점, 지름 = size) 안에 모델이 들어 있음
  function load(THREE, url) {
    return needLoader(THREE).then(function () {
      return new Promise(function (ok, no) { new THREE.GLTFLoader().load(url, ok, null, no); });
    }).then(function (gltf) {
      var model = gltf.scene, holder = new THREE.Group(), mixer = null, speed = 1;
      holder.add(model);
      if (gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach(function (a) { mixer.clipAction(a).play(); });
      }
      var m = measure(THREE, model, mixer, gltf.animations[0]);
      model.position.sub(m.center);
      model.traverse(function (o) { if (o.isMesh) o.frustumCulled = false; });   // 뼈로 움직여서 화면 밖으로 잘못 잘리는 것 방지
      return {
        holder: holder, model: model, mixer: mixer, size: m.size, asset: gltf.asset || {},
        setSpeed: function (s) { speed = +s || 1; },
        update: function (dt) { if (mixer) mixer.update(dt * speed); },
        // 크기를 맞춤: 지름이 d가 되게
        fit: function (d) { holder.scale.setScalar(d / m.size); }
      };
    });
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // 출처 글 (CC BY는 제목·만든 사람·라이선스를 꼭 보여야 함)
  function creditHTML(c) {
    if (!c || !c.title) return '';
    var a = function (href, text) { return href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(text) + '</a>' : esc(text); };
    return '"' + a(c.source, c.title) + '" by ' + a(c.authorUrl, c.author) + ' is licensed under ' + a(c.licenseUrl, c.license) + '.' +
      (c.note ? ' <span class="note">(' + esc(c.note) + ')</span>' : '');
  }

  root.ReefModel = { reef: reef, load: load, creditHTML: creditHTML };
})(window);
