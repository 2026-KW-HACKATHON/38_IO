# viewer.html을 All Reefs에 연결하기

scenes.json에는 이제 turtles(예전 모양)와 swimmers(새 모양)가 같이 들어가요. 그래서 viewer.html을 안 고쳐도 예전처럼 거북 3종은 나와요.
All Reefs의 물고기를 쓰려면 아래 네 군데만 바꾸면 돼요.

1. three.js 스크립트 바로 뒤에 한 줄 추가
   <script src="reef-kit.js"></script>

2. 시작할 때 데이터 읽기
   var kit = ReefKit(THREE), reefData = null;
   kit.loadData().then(function(d){ reefData = d; kit.applyStyle(d.style); /* 여기서 장면 만들기 */ });

3. 거북 만드는 부분 (buildTurtle(MORPHS[t.morph]) 같은 곳)을 이렇게
   var list = scene.swimmers || scene.turtles;
   var ids = ['turtle-cream', 'turtle-lime', 'turtle-sundae'];
   var m = kit.find(reefData, t.species || ids[t.morph % 3]);
   var obj = kit.build(m, { scale: (0.30 / 0.52) * (t.sc || 1), phase: t.ph });
   obj.userData.lane = { say: t.say };

4. 매 프레임 움직이는 곳에서 발 움직임 코드 대신
   kit.tick(time);
   kit.animate(obj, time);
   (위치와 방향은 지금 쓰는 place() 그대로 두면 돼요)

말풍선을 All Reefs 스타일로 바꾸고 싶으면:
   var talk = kit.Talk(화면을_감싼_div, camera, reefData.style);
   더블탭한 물고기에게  talk.say(obj, kit.nextLine(obj));
   매 프레임  talk.update();

viewer.html 파일을 대화창에 올려 주면 이 연결을 대신 해 줄 수 있어요.
