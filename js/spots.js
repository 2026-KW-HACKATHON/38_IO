/* 지도에 사람 아이콘으로 표시할 장소들 (QR 위치 확인에도 같이 씀)
   box: 장소 범위 (n 위쪽 위도, s 아래쪽 위도, w 왼쪽 경도, e 오른쪽 경도). 아이콘은 범위 한가운데에 놓임, icon: 지도 아이콘
   alias: 영수증에 적힐 수 있는 다른 이름, biz: 사업자번호 (적어 두면 영수증 인증 때 이름보다 먼저 맞춰 봄) */
window.SPOTS = [
  { id: 'bima', icon: 'assets/space/xp/pin-bima.png',  name: '광운대학교 비마관', addr: '서울 노원구 광운로 20', alias: ['비마관'], biz: '',
    box: { n: 37.619987483334455, s: 37.6191135141168,  w: 127.05936500409865, e: 127.06055430225365 } },
  { id: 'cord', icon: 'assets/space/xp/pin-cord.png',  name: 'CORD Jr.',          addr: '서울 노원구 석계로13길 40', alias: ['코드주니어', 'CORD JR'], biz: '',
    box: { n: 37.62106796460786,  s: 37.62085396841135, w: 127.06116716658116, e: 127.0613512473039 } },
  { id: 'juana', icon: 'assets/space/xp/pin-juana.png', name: '디저트카페후아나',   addr: '서울 노원구 석계로1길 18', alias: ['후아나', 'JUANA'], biz: '',
    box: { n: 37.61562467460713,  s: 37.61544673714494, w: 127.06366299880865, e: 127.06383011353108 } }
];

/* 범위 둘레에 더 줄 여유 (미터). 0이면 범위 안일 때만 통과 */
window.SPOT_MARGIN_M = 15;

/* 지금 위치가 장소 범위에서 몇 미터 떨어졌는지 (안이면 0) */
window.spotDistance = function (spot, lat, lng) {
  var b = spot.box;
  var dy = Math.max(b.s - lat, 0, lat - b.n) * 111320;                                  // 위도 1도 ≈ 111.3km
  var dx = Math.max(b.w - lng, 0, lng - b.e) * 111320 * Math.cos(lat * Math.PI / 180);  // 경도 1도는 위도에 따라 짧아짐
  return Math.hypot(dx, dy);
};
window.inSpot = function (spot, lat, lng) {
  return window.spotDistance(spot, lat, lng) <= (window.SPOT_MARGIN_M || 0);
};
