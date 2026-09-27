# 월계아쿠아 QRium

물고기·아이템·이펙트·말풍선은 **reef-data.json 한 파일**로 관리하고, 모든 페이지가 같은 폴더(레포 맨 위)에서 이 파일을 읽어요.
물고기를 고치고 싶으면 **all-reefs.html** 한 곳에서만 고치면 돼요.

## 파일

### 물고기 관리 (한 곳)
- all-reefs.html — 관리 앱. 물고기를 고치고 "깃허브에 올리기"를 누르면 reef-data.json이 바뀌어요
- reef-data.json — 물고기 목록과 각 reef 설정 (모든 페이지가 읽는 파일, 딱 하나)
- reef-kit.js — 도트를 3D로 만들고 헤엄치게 하는 공용 코드 (딱 하나)

### 물고기를 보여주는 페이지 (모두 위 두 파일을 읽음)
- index.html — 로그인 + AR 화면 (js/, css/ 사용)
- viewer.html — QR로 여는 뷰어 (scenes.json에서 장면을 읽음)
- voxel-reef.html, charged-reef.html — 전시형 reef
- marker-test.html — 벽에 붙인 4cm 형광 큐브 마커 AR 테스트 (#preview = 카메라 없이 미리보기, #sim = 가짜 카메라로 인식 시험, #preview-space = 나의 공간 창 모양)
- cord-jr-reef.html — CORD jr 거북이 (reef-data.json의 cord-jr 설정을 읽음)

### 나의 공간 (두 가지 꾸밈)
- aero_web.html — 파란 하늘 옛날 창 모양 (주소: /aero_web)
- y2k_web.html — Y2K 플레이어 모양 (주소: /y2k_web)
- 두 페이지 안의 '나의 어항', '리뷰 관리' 창은 위 reef 페이지를 그대로 띄워서, All Reefs에서 고치면 같이 바뀌어요
- assets/ — 나의 공간과 reef 페이지가 쓰는 그림·글꼴

### 그 밖
- reef-console.html — QR 카드 / scenes.json 만드는 콘솔
- cord-jr.html — CORD jr 원본 (손대지 않고 보관, 데이터가 페이지 안에 들어 있음)
- scenes.json — viewer.html이 읽는 장면 목록
- admin.html — 계정·활동 기록 관리자 화면
- qr.html — 모바일 접속 QR
- supabase/schema.sql — 로그인·기록용 데이터베이스 설정
- vercel.json — 주소 끝의 .html을 빼도 열리게 함 (/aero_web, /y2k_web)

## 물고기 고치는 법
1. 깃허브 페이지 주소/all-reefs.html 을 열어요.
2. 깃허브 메뉴에서 레포와 토큰(Contents: Read and write)을 넣어요. **폴더 칸은 비워 두세요** (레포 맨 위).
3. 물고기를 고친 뒤 "깃허브에 올리기"를 누르면 1분쯤 뒤 모든 페이지가 바뀌어요. 열려 있는 페이지도 30초마다 확인해서 스스로 바뀌어요.

## 지켜 주세요
- reef-data.json, reef-kit.js를 다른 폴더에 복사하지 마세요. 복사본이 생기면 페이지마다 다른 물고기가 나와요.
- 새 페이지도 이 폴더에 두고 `<script src="reef-kit.js"></script>`로 읽어요.
