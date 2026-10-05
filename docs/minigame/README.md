# 미니게임 분석 문서

게임마다 원본 동작 분석과 웹 포팅 명세를 한 문서(`hsmgNNN.md`)로 둔다.

- 작성 형식은 [../분석.txt](../분석.txt)의 11절 구성을 따른다.
- 분류·플래그·팩·조작 원문은 [../../../analysis/minigame_catalog.tsv](../../../analysis/minigame_catalog.tsv)에 있다. 열 정의는 [../analysis/03_game_structure.md](../analysis/03_game_structure.md) 4절.
- ID는 원본 MINIGAME_ID(= `hs_mglist.csv` 행 순서)다. 401이 0번이다.
- 분류: 4인 대전 / 2 vs 2 / 1 vs 3 / 2 vs 2 스포츠 / 대전 퍼즐 / 듀얼(1 vs 1) / 아이템. `·코인`은 코인 미니게임, `·쿠파`는 쿠파 미니게임 플래그다.
- 9xx 아이템 미니게임은 한·영 이름이 없다. 일본어 디버그 이름을 괄호로 적었다.

| 코드 | ID | 이름 | 영어 이름 | 분류 | 문서 | 상태 |
|---|---|---|---|---|---|---|
| hsmg101 | 49 | 웨이브 웨이브 | Tidal Toss | 1 vs 3 | — | 미분석 |
| hsmg102 | 50 | 데굴데굴 바위 굴리기 | Boulder Ball | 1 vs 3 | — | 미분석 |
| hsmg103 | 51 | 아슬아슬 야자열매 | Coconut Conk | 1 vs 3 | — | 미분석 |
| hsmg104 | 52 | 쥐라기 뻐끔 | Piranha's Pursuit | 1 vs 3 | — | 미분석 |
| hsmg105 | 53 | 위험한 줄다리기 | Tug o' War | 1 vs 3 | — | 미분석 |
| hsmg106 | 54 | 서치라이트를 비춰라! | Spotlight Swim | 1 vs 3 | — | 미분석 |
| hsmg107 | 55 | 데굴데굴 꽈당! | Squared Away | 1 vs 3 | — | 미분석 |
| hsmg108 | 56 | 설산의 추격전 | Tube It or Lose It | 1 vs 3 | — | 미분석 |
| hsmg109 | 57 | 빙그르르 점핑 | Pogo-a-Go-Go | 1 vs 3 | — | 미분석 |
| hsmg110 | 58 | 공을 갖고 튀어라! | Tackle Takedown | 1 vs 3 | — | 미분석 |
| hsmg111 | 59 | 과녁을 향해 샷! | Archer-ival | 1 vs 3 | — | 미분석 |
| hsmg112 | 60 | 골, 골, 골! | GOOOOOOOAL!! | 1 vs 3 | — | 미분석 |
| hsmg113 | 61 | 위험한 가시기둥 | Skewer Scurry | 1 vs 3 | — | 미분석 |
| hsmg114 | 62 | 꼭꼭 숨어라 | Hide-and-Sneak | 1 vs 3 | — | 미분석 |
| hsmg115 | 63 | 참참참! | Look Away | 1 vs 3 | — | 미분석 |
| hsmg201 | 64 | 줄줄이 GO! GO! | Dungeon Dash | 2 vs 2 | — | 미분석 |
| hsmg202 | 65 | 우걱우걱 빅 피자 | Eatsa Pizza | 2 vs 2 | — | 미분석 |
| hsmg203 | 66 | 페어 레이스 | Dungeon Duos | 2 vs 2 | — | 미분석 |
| hsmg204 | 67 | 스피드 하키 | Speed Hockey | 2 vs 2 | — | 미분석 |
| hsmg205 | 68 | 케이크 팩토리 | Cake Factory | 2 vs 2 | — | 미분석 |
| hsmg206 | 69 | 봅슬레이 슬라이드 | Bobsled Run | 2 vs 2 | — | 미분석 |
| hsmg207 | 70 | 광차 레이스 | Handcar Havoc | 2 vs 2 | — | 미분석 |
| hsmg208 | 71 | 크레용으로 감싸라! | Etch 'n' Catch | 2 vs 2 | — | 미분석 |
| hsmg209 | 72 | 체리 캐치 | Picking Panic | 2 vs 2 | — | 미분석 |
| hsmg210 | 73 | 더블 쿠파 풍선 | Balloon Burst | 2 vs 2 | — | 미분석 |
| hsmg211 | 74 | 오락가락 폭탄병 | Revers-a-Bomb | 2 vs 2 | — | 미분석 |
| hsmg212 | 75 | 위험한 도깨비 방망이 | Burnstile | 2 vs 2 | — | 미분석 |
| hsmg213 | 76 | 해안가 드라이빙 | Rocky Road | 2 vs 2 | — | 미분석 |
| hsmg214 | 77 | 페인트 굼바 | Paint Misbehavin' | 2 vs 2 | — | 미분석 |
| hsmg215 | 78 | 플라잉 레이스 | Sky Pilots | 2 vs 2 | — | 미분석 |
| hsmg401 | 0 | 컬러풀 버섯 | Mushroom Mix-Up | 4인 대전 | — | 미분석 |
| hsmg402 | 1 | 데굴데굴 눈덩이 | Snowball Summit | 4인 대전 | [hsmg402.md](hsmg402.md) | 분석 1차 완료(판독·재구현 계산, 원본 실행 없음). 웹 구현(로직·화면·소리·UI·재질·조명·이펙트), 로직 시험 290 통과, 헤드리스 완주(키 K=B 만들기, J=A 날리기, WASD 스틱) |
| hsmg403 | 2 | 어질어질 레코드 | Dizzy Dancing | 4인 대전 | — | 미분석 |
| hsmg404 | 3 | 세어라! 하나 둘 셋 | Roll Call | 4인 대전 | — | 미분석 |
| hsmg405 | 4 | 가시돌이 크래시 | Ice-Rink Risk | 4인 대전 | — | 미분석 |
| hsmg406 | 5 | 공 위의 곡예사 | Bumper Balls | 4인 대전 | — | 미분석 |
| hsmg407 | 6 | 불타는 줄넘기 | Hot Rope Jump | 4인 대전 | — | 미분석 |
| hsmg408 | 7 | 바운스 배틀 | Bounce 'n' Trounce | 4인 대전 | — | 미분석 |
| hsmg409 | 8 | 허슬 배팅 | Dinger Derby | 4인 대전 | — | 미분석 |
| hsmg410 | 9 | 콩나무 점프 | Leaf Leap | 4인 대전 | — | 미분석 |
| hsmg411 | 10 | 쪼르뚜의 복수 | Monty's Revenge | 4인 대전 | — | 미분석 |
| hsmg412 | 11 | 헤이호와 깃발 | Shy Guy Says | 4인 대전 | — | 미분석 |
| hsmg413 | 12 | 드릴 발굴단 | Crazy Cutters | 4인 대전 | — | 미분석 |
| hsmg414 | 13 | 엉금엉금 미끌미끌 | Tipsy Tourney | 4인 대전 | — | 미분석 |
| hsmg415 | 14 | 크레용 따라 그리기 | Trace Race | 4인 대전 | — | 미분석 |
| hsmg416 | 15 | 아슬아슬 멍멍이 | Night-Light Fright | 4인 대전 | — | 미분석 |
| hsmg417 | 16 | 태엽 헤이호 레이스 | Mecha Marathon | 4인 대전 | — | 미분석 |
| hsmg418 | 17 | 선인을 연타하라! | Pokey Pummel | 4인 대전 | — | 미분석 |
| hsmg419 | 18 | 둥실둥실 아일랜드 | Bombs Away | 4인 대전 | — | 미분석 |
| hsmg420 | 19 | 비를 쫓는 뻐끔 | Storm Chasers | 4인 대전 | — | 미분석 |
| hsmg421 | 20 | 찾아라! 거대버섯 | Mush Pit | 4인 대전 | — | 미분석 |
| hsmg422 | 21 | 펭귄 대행진 | Pushy Penguins | 4인 대전 | — | 미분석 |
| hsmg423 | 22 | 아이스크림 캐치 | Coney Island | 4인 대전 | — | 미분석 |
| hsmg424 | 23 | 편지를 주워라! | Catch You Letter | 4인 대전 | — | 미분석 |
| hsmg425 | 24 | 책 속의 대소동 | Booksquirm | 4인 대전 | — | 미분석 |
| hsmg426 | 25 | 위험! 꼬불꼬불 로드 | Paths of Peril | 4인 대전 | — | 미분석 |
| hsmg427 | 26 | 쾅쾅 전차 | Tread Carefully | 4인 대전 | — | 미분석 |
| hsmg428 | 27 | 쿠파 대폭발 | Bowser's Big Blast | 4인 대전 | — | 미분석 |
| hsmg429 | 28 | 윙윙 벌집 | Honeycomb Havoc | 4인 대전 | — | 미분석 |
| hsmg430 | 29 | 그 자리 그대로 | Messy Memory | 4인 대전 | — | 미분석 |
| hsmg431 | 30 | 천의 얼굴 쿠파 | Face-Lift | 4인 대전·쿠파 | — | 미분석 |
| hsmg432 | 31 | 찔러라! 벌룬카 | Bumper Balloon Cars | 4인 대전 | — | 미분석 |
| hsmg433 | 32 | 배고픈 거대뽀꾸뽀꾸 | Cheep Cheep Chase | 4인 대전 | — | 미분석 |
| hsmg434 | 33 | 빙글빙글 대포 | Bill Blasters | 4인 대전 | — | 미분석 |
| hsmg435 | 34 | 어둠 속의 대마왕 | Dark 'n' Crispy | 4인 대전·쿠파 | — | 미분석 |
| hsmg436 | 35 | 철퇴를 던지는 대마왕 | Pit Boss | 4인 대전·쿠파 | — | 미분석 |
| hsmg437 | 36 | 추락 주의! 계곡에서의 배틀 | The Final Countdown | 4인 대전 | — | 미분석 |
| hsmg438 | 37 | 오케이, 김치~! | Flash Forward | 4인 대전 | — | 미분석 |
| hsmg439 | 38 | 꾸벅꾸벅 멍멍이 | Sneak 'n' Snore | 4인 대전 | — | 미분석 |
| hsmg440 | 39 | 트랙 위의 질주 | Slot-Car Derby | 4인 대전 | — | 미분석 |
| hsmg441 | 40 | 니어 핀 대결 | Chip-Shot Challenge | 4인 대전 | — | 미분석 |
| hsmg442 | 41 | 굼바 포획 작전 | Trap Ease Artist | 4인 대전 | — | 미분석 |
| hsmg443 | 42 | 펄럭펄럭 점프 | What Goes Up... | 4인 대전 | — | 미분석 |
| hsmg444 | 43 | 스핀 스노보드 | Snow Whirled | 4인 대전 | — | 미분석 |
| hsmg445 | 44 | GO! GO! 목마 | Rockin' Raceway | 4인 대전 | — | 미분석 |
| hsmg446 | 45 | 쇼트 트랙 레이스 | Later Skater | 4인 대전 | — | 미분석 |
| hsmg447 | 46 | 호버 보드 레이스 | Rapid River Race | 4인 대전 | — | 미분석 |
| hsmg448 | 47 | 호러 맨션 | Manor of Escape | 4인 대전 | — | 미분석 |
| hsmg449 | 48 | 굼바를 세어라! | Goomba Spotting | 4인 대전 | — | 미분석 |
| hsmg501 | 94 | 뜨거운 비치 발리볼 | Beach Volley Folly | 2 vs 2 스포츠 | — | 미분석 |
| hsmg502 | 95 | 아이스하키 대결 | Ice Hockey | 2 vs 2 스포츠 | — | 미분석 |
| hsmg503 | 96 | 등껍질 축구 | Shell Soccer | 2 vs 2 스포츠 | — | 미분석 |
| hsmg601 | 97 | 쿵쿵 퍼즐 | Mario's Puzzle Party | 4인 대전 | — | 미분석 |
| hsmg602 | 98 | 블록 연결 | Block Star | 대전 퍼즐 | — | 미분석 |
| hsmg603 | 99 | 회전 구슬 퍼즐 | Stick and Spin | 대전 퍼즐 | — | 미분석 |
| hsmg701 | 79 | 빙빙 시계 | Ticktock Hop | 듀얼(1 vs 1) | — | 미분석 |
| hsmg702 | 80 | 덩굴 레이스 | Vine with Me | 듀얼(1 vs 1) | — | 미분석 |
| hsmg703 | 81 | 스핀 로드 | Spin Doctor | 듀얼(1 vs 1) | — | 미분석 |
| hsmg704 | 82 | 감전볼코스터 | Motor Rooter | 듀얼(1 vs 1) | — | 미분석 |
| hsmg705 | 83 | 아슬아슬 우주 유영 | Mass Meteor | 듀얼(1 vs 1) | — | 미분석 |
| hsmg801 | 84 | 해머브러스의 선물 | Hammer Drop | 4인 대전·코인 | — | 미분석 |
| hsmg802 | 85 | 파라솔 낙하 | Parasol Plummet | 4인 대전·코인 | — | 미분석 |
| hsmg803 | 86 | 보물 낚시 | Cast Aways | 4인 대전·코인 | — | 미분석 |
| hsmg804 | 87 | 엑스레이 컨베이어 | X-Ray Payday | 4인 대전·코인 | — | 미분석 |
| hsmg805 | 88 | 위험! 개미지옥 | Quicksand Cache | 1 vs 3·코인 | — | 미분석 |
| hsmg806 | 89 | 모아라! 코인 리버 | River Raiders | 1 vs 3·코인 | — | 미분석 |
| hsmg807 | 90 | GOGO! 컨베이어 | Money Belts | 1 vs 3·코인 | — | 미분석 |
| hsmg808 | 91 | 코인 쟁탈전 | Winner or Dinner | 2 vs 2·코인 | — | 미분석 |
| hsmg809 | 92 | 시소를 타고 코인 모으기 | Cashapult | 2 vs 2·코인 | — | 미분석 |
| hsmg810 | 93 | 뗏목 위에서 코인 모으기 | Puddle Paddle | 2 vs 2·코인 | — | 미분석 |
| hsmg901 | 100 | (シャトルハンマー) | — | 아이템 | — | 미분석 |
| hsmg902 | 101 | (ねらってバルーン) | — | 아이템 | — | 미분석 |
| hsmg903 | 102 | (アイテムルーレット) | — | 아이템 | — | 미분석 |
| hsmg904 | 103 | (タルタルブランコ) | — | 아이템 | — | 미분석 |
| hsmg905 | 104 | (たるたるゴロゴロ) | — | 아이템 | — | 미분석 |
