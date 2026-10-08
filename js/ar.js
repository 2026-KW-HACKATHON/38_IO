/* AR 화면: 카메라 위에 물고기 띄우기, 권한 요청, 로그인 표시 */
(function () {
  "use strict";

  var kit = ReefKit(THREE);
  var HASH_PREVIEW = /preview/.test(location.hash);

  /* ── 조절값 (숫자만 바꿔서 크기·거리 조정) ── */
  var C = {
    size: 220,       // 물고기 떼 전체 지름
    distance: 150,   // 내 앞쪽으로 얼마나 떨어뜨릴지 (cm 느낌)
    height: -15,     // 눈높이보다 얼마나 아래에 둘지
    fovDeg: 62       // 카메라 시야각
  };

  /* ── 화면 요소 ── */
  var stage = document.getElementById('stage');
  var video = document.getElementById('cam'), glc = document.getElementById('gl');
  var gate = document.getElementById('gate'), bottomBar = document.getElementById('bottom');
  var chipBox = document.getElementById('chips');
  var cCam = document.getElementById('cCam'), cGyro = document.getElementById('cGyro'), cLoc = document.getElementById('cLoc');

  var renderer = new THREE.WebGLRenderer({ canvas: glc, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(60, 1, 1, 4000);
  kit.lights(scene);
  var shoal = new THREE.Group();
  scene.add(shoal);

  var viewMode = 'orbit';         // 'camera'(카메라 위 AR) 또는 'orbit'(손으로 돌려보기)
  var fish = null, cfg = {};
  var cameraOn = false;

  function setChip(el, text, on) { el.textContent = text; el.className = 'chip' + (on === true ? ' on' : on === false ? ' off' : ''); }

  /* ── 물고기 떼 만들기: reef-data.json의 모델 reef ── */
  function build(d) {
    var r = ReefModel.reef(d);
    cfg = r ? r.config : {};
    if (!(cfg.fish || []).length) { Core.toast('보여 줄 물고기 모델이 없습니다'); return; }
    ReefModel.load(THREE, cfg.fish).then(function (m) {
      fish = m; m.fit(C.size); m.setSpeed(cfg.speed);
      shoal.add(m.holder);
    }).catch(function () { Core.toast('물고기 모델을 불러오지 못했습니다'); });
  }


  /* ── 화면 크기에 맞추기 ── */
  function fitCamera() {
    var sw = window.innerWidth, sh = window.innerHeight;
    renderer.setSize(sw, sh, false);
    if (viewMode === 'orbit') {
      camera.clearViewOffset(); camera.fov = 45; camera.aspect = sw / Math.max(1, sh);
      camera.updateProjectionMatrix(); return;
    }
    // 카메라 영상을 화면에 꽉 채워 보일 때와 같은 범위로 맞춤
    var vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
    var fFull = (vw / 2) / Math.tan(C.fovDeg * Math.PI / 360);
    camera.fov = 2 * Math.atan(vh / (2 * fFull)) * 180 / Math.PI;
    camera.aspect = vw / vh;
    var scale = Math.max(sw / vw, sh / vh), cw = sw / scale, ch = sh / scale;
    camera.setViewOffset(vw, vh, (vw - cw) / 2, (vh - ch) / 2, cw, ch);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', fitCamera);
  video.addEventListener('loadedmetadata', fitCamera);

  /* ── 폰 방향 센서 → 카메라 방향 ── */
  var ZEE = new THREE.Vector3(0, 0, 1), Q0 = new THREE.Quaternion();
  var Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  var deviceQuat = new THREE.Quaternion(), eulerTmp = new THREE.Euler();
  var haveOrientation = false, motionDenied = false, firstOrientation = true;
  function rad(d) { return d * Math.PI / 180; }
  function screenAngle() {
    var a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
    return rad(a);
  }
  function onOrientation(e) {
    if (e.alpha == null) return;
    haveOrientation = true;
    eulerTmp.set(rad(e.beta || 0), rad(e.alpha || 0), rad(-(e.gamma || 0)), 'YXZ');
    deviceQuat.setFromEuler(eulerTmp);
    deviceQuat.multiply(Q1);
    deviceQuat.multiply(Q0.setFromAxisAngle(ZEE, -screenAngle()));
    setChip(cGyro, 'GYRO OK', true);
    if (firstOrientation) { firstOrientation = false; recenter(); }
  }

  /* ── 물고기 무리를 내 앞쪽에 놓기 ── */
  var anchor = new THREE.Vector3(0, C.height, -C.distance);
  function recenter() {
    if (viewMode !== 'camera') return;
    var fwd = new THREE.Vector3(0, 0, -1);
    if (haveOrientation) fwd.applyQuaternion(deviceQuat);
    fwd.y = 0;
    if (fwd.lengthSq() < 0.0001) fwd.set(0, 0, -1);
    fwd.normalize().multiplyScalar(C.distance);
    anchor.set(fwd.x, C.height, fwd.z);
  }
  document.getElementById('bRecenter').addEventListener('click', recenter);

  /* ── 손으로 돌려보기 (카메라 없을 때) ── */
  var orbit = { theta: 0.7, phi: 1.3, radius: 230 };
  function applyOrbit() {
    orbit.phi = Math.max(0.15, Math.min(Math.PI - 0.15, orbit.phi));
    orbit.radius = Math.max(60, Math.min(600, orbit.radius));
    var sp = Math.sin(orbit.phi);
    camera.position.set(orbit.radius * sp * Math.sin(orbit.theta), orbit.radius * Math.cos(orbit.phi), orbit.radius * sp * Math.cos(orbit.theta));
    camera.lookAt(0, 0, 0);
  }

  /* ── 터치: 물고기를 누르면 말하기, 돌려보기 모드에서는 드래그로 회전 ── */
  var downAt = null, lastP = null;
  glc.addEventListener('pointerdown', function (e) {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    lastP = { x: e.clientX, y: e.clientY };
    try { glc.setPointerCapture(e.pointerId); } catch (er) {}
  });
  glc.addEventListener('pointermove', function (e) {
    if (viewMode !== 'orbit' || !lastP) return;
    orbit.theta -= (e.clientX - lastP.x) * 0.006; orbit.phi -= (e.clientY - lastP.y) * 0.006;
    lastP = { x: e.clientX, y: e.clientY }; applyOrbit();
  });
  glc.addEventListener('pointerup', function () { downAt = null; lastP = null; });
  glc.addEventListener('wheel', function (e) {
    if (viewMode !== 'orbit') return;
    e.preventDefault(); orbit.radius *= Math.exp(e.deltaY * 0.0013); applyOrbit();
  }, { passive: false });

  /* ── 매 프레임 움직이기 ── */
  var clock = new THREE.Clock(), t = 0;
  var camQuat = new THREE.Quaternion();
  function frame() {
    requestAnimationFrame(frame);
    var dt = Math.min(clock.getDelta(), 0.05);
    t += dt;
    if (viewMode === 'camera') {
      if (haveOrientation) camera.quaternion.copy(deviceQuat); else camera.quaternion.identity();
      camera.position.set(0, 0, 0);
      shoal.position.copy(anchor);
    } else {
      shoal.position.set(0, 0, 0);
    }
    if (fish) fish.update(dt);
    renderer.render(scene, camera);
  }

  /* ── 권한 요청: 움직임 센서 → 카메라 → 위치 ── */
  var loc = null, locLogged = false;
  function logLocationOnce() {
    if (loc && !locLogged && Core.state.user) { locLogged = true; Core.log('location', loc); }
  }
  function askLocation() {
    if (!navigator.geolocation) { setChip(cLoc, 'LOC 없음', false); return; }
    navigator.geolocation.getCurrentPosition(function (p) {
      // 기록에는 대략적인 위치(소수 3자리)만 남김
      loc = { lat: +p.coords.latitude.toFixed(3), lng: +p.coords.longitude.toFixed(3) };
      setChip(cLoc, 'LOC OK', true);
      logLocationOnce();
    }, function () { setChip(cLoc, 'LOC 거부', false); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }

  function enterOrbit() {
    viewMode = 'orbit';
    video.classList.add('hidden');
    gate.classList.add('hidden'); bottomBar.classList.remove('hidden');
    document.getElementById('bRecenter').classList.add('hidden');
    applyOrbit(); fitCamera();
  }

  function startAR() {
    // iOS는 버튼을 누른 그 순간에 센서 권한을 물어봐야 해서 가장 먼저 호출
    var motionAsk = (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
      ? DeviceOrientationEvent.requestPermission() : Promise.resolve('granted');
    motionAsk.then(function (res) {
      if (res !== 'granted') { motionDenied = true; setChip(cGyro, 'GYRO 거부', false); }
      window.addEventListener('deviceorientation', onOrientation, true);
    }).catch(function () { motionDenied = true; setChip(cGyro, 'GYRO 거부', false); });
    chipBox.classList.remove('hidden');
    askLocation();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setChip(cCam, 'CAM 없음', false); Core.toast('이 브라우저는 카메라를 쓸 수 없습니다. 둘러보기로 봅니다');
      enterOrbit(); return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(function (stream) { video.srcObject = stream; return video.play(); })
      .then(function () {
        cameraOn = true; viewMode = 'camera';
        video.classList.remove('hidden'); stage.style.background = '#000';
        gate.classList.add('hidden'); bottomBar.classList.remove('hidden');
        setChip(cCam, 'CAM OK', true);
        fitCamera(); recenter();
        Core.log('ar_start', { camera: true, motion: !motionDenied });
      })
      .catch(function () {
        setChip(cCam, 'CAM 거부', false);
        Core.toast('카메라 권한이 없어서 둘러보기로 봅니다');
        enterOrbit();
        Core.log('ar_start', { camera: false, motion: !motionDenied });
      });
  }
  document.getElementById('go').addEventListener('click', startAR);
  function startOrbit() { enterOrbit(); Core.log('ar_start', { camera: false, motion: false }); }
  document.getElementById('goOrbit').addEventListener('click', startOrbit);
  document.getElementById('gateClose').addEventListener('click', startOrbit);   // 창을 닫으면 카메라 없이 둘러보기

  /* ── 로그인 영역 (위쪽 오른쪽) ── */
  var authBox = document.getElementById('auth');
  var mySpace = document.getElementById('mySpace');
  function drawAuth(state) {
    authBox.innerHTML = '';
    mySpace.classList.toggle('hidden', !state.user);
    if (!Core.ready) return;
    if (!state.user) {
      var b = document.createElement('button'); b.className = 'kakao'; b.type = 'button'; b.textContent = '카카오 로그인';
      b.addEventListener('click', Core.login); authBox.appendChild(b); return;
    }
    var who = document.createElement('span'); who.className = 'who';
    who.textContent = (state.profile && state.profile.nickname) || '로그인됨';
    authBox.appendChild(who);
    if (Core.isAdmin()) {
      var a = document.createElement('a'); a.className = 'mini'; a.href = 'admin.html'; a.textContent = '관리자'; authBox.appendChild(a);
    }
    var o = document.createElement('button'); o.className = 'mini'; o.type = 'button'; o.textContent = '로그아웃';
    o.addEventListener('click', Core.logout); authBox.appendChild(o);
    logLocationOnce();
  }

  /* ── 시작: 데이터 읽고 그리기 ── */
  kit.loadData().then(function (d) {
    build(d); frame();
  }).catch(function (e) {
    Core.toast('reef-data.json을 읽지 못했습니다');
    frame();
  });

  applyOrbit(); fitCamera();
  Core.onChange(drawAuth);
  Core.start();
  if (Core.ready) setTimeout(function () { Core.log('visit'); }, 1200);

  if (HASH_PREVIEW) enterOrbit();

  // 다른 파일(촬영 기능 등)이 필요할 때 빌려 쓰는 창구
  window.ReefAR = {
    canvas: glc, video: video,
    isCameraOn: function () { return cameraOn; },
    renderNow: function () { renderer.render(scene, camera); }
  };
})();
