/* [임시-촬영저장] 파일 전체가 임시 기능
   빼려면 이 파일과 index.html의 "[임시-촬영저장 시작] ~ [임시-촬영저장 끝]" 구간을 지움 (다른 파일과 연결 없음) */
(function () {
  "use strict";
  var btn = document.getElementById('bShot');
  if (!btn) return;

  // 카메라 영상 + 물고기를 한 장의 그림으로 합치기
  function compose() {
    var gl = window.ReefAR.canvas, video = window.ReefAR.video;
    window.ReefAR.renderNow();
    var W = gl.width, H = gl.height;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.fillStyle = '#0B0916'; x.fillRect(0, 0, W, H);
    if (window.ReefAR.isCameraOn() && video.videoWidth) {
      // 화면에 보이는 것과 같은 범위로 잘라서 그림
      var s = Math.max(W / video.videoWidth, H / video.videoHeight);
      var sw = W / s, sh = H / s;
      x.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, W, H);
    }
    x.drawImage(gl, 0, 0, W, H);
    return c;
  }

  function fileName() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'reef-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.png';
  }

  // 폰에서는 공유 창(사진에 저장 가능), 그 외에는 파일 다운로드
  function save(blob) {
    var name = fileName();
    var file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file] }).catch(function (e) {
        if (e && e.name === 'AbortError') return;
        download(blob, name);
      });
    }
    download(blob, name);
    return Promise.resolve();
  }
  function download(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  btn.addEventListener('click', function () {
    compose().toBlob(function (blob) {
      if (!blob) { Core.toast('사진을 만들지 못했습니다'); return; }
      save(blob).then(function () { Core.toast('촬영본을 저장했습니다'); Core.log('photo'); });
    }, 'image/png');
  });
})();
