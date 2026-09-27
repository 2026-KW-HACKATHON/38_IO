# All Reefs

물고기·아이템·이펙트·말풍선을 reef-data.json 한 파일로 관리하고, 같은 폴더의 모든 reef 페이지가 그 파일을 읽어요.

## 파일
- all-reefs.html — 관리 앱 (여기서 고치고 "깃허브에 올리기")
- reef-data.json — 물고기 목록과 각 reef 설정 (모든 페이지가 읽는 한 곳)
- reef-kit.js — 도트를 3D로 만들고 헤엄치게 하는 공용 코드
- voxel-reef.html, charged-reef.html — 전시형 reef
- reef-console.html — QR 카드 / scenes.json 만드는 콘솔
- marker-test.html — 벽에 붙인 4cm 형광 큐브 마커 AR 테스트 (#preview = 카메라 없이 미리보기, #sim = 가짜 카메라로 인식 시험)

## 올리는 법
1. 이 파일들을 viewer.html이 있는 레포 폴더에 그대로 올려요.
2. 깃허브 페이지 주소/all-reefs.html 을 열고, 깃허브 메뉴에서 레포와 토큰(Contents: Read and write)을 넣어요.
3. 물고기를 고친 뒤 "깃허브에 올리기"를 누르면 1분쯤 뒤 모든 reef가 바뀌어요. 열려 있는 reef 페이지도 30초마다 확인해서 스스로 바뀌어요.

## viewer.html
viewer.html은 아직 예전 거북 코드를 쓰고 있어요. VIEWER-SETUP.md를 보고 몇 줄만 바꾸면 여기 물고기를 그대로 보여줘요.
