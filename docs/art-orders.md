# 아트 제작 지시서 — 물개(`char_seal`)

이 저장소에는 **이미지 생성 도구가 없다.** 그래서 현재 `art/clips/char_seal/` 에 들어 있는
프레임은 원본 5조각을 앱 엔진으로 자세만 잡아 구운 **임시 에셋**이다
(`clip.json` 의 `placeholder: true`). 재생 구조·타이밍·접지를 검증하는 용도이며,
**최종 아트 품질이 아니다.**

아래는 실제 그림을 만들 때 그대로 쓰는 발주서다. 규격은 `docs/animation-bible.md` 2·8절.

---

## 공통 (모든 프레임에 적용)

**보존해야 할 특징** — 하나라도 바뀌면 다른 캐릭터가 된다.

```
회색 물개 치비, 2.2등신, 머리가 전체 높이의 45%.
감고 웃는 눈(위로 볼록한 짧은 호 2개, 흰자·눈동자 없음), 검은 삼각형 코 하나,
좌우 3가닥씩 가는 검은 수염, 벌린 웃는 입(안쪽 분홍 #cb9798).
팔은 손가락 없는 넓적한 지느러미, 다리는 바닥에 붙는 넓적한 발지느러미(발목 없음).
몸 #a19f9d, 배 #c7c3c0, 연두 반바지 #bac836 에 보라 꽃무늬 #8b4cc5 와 흰 끈.
외곽선 진회색 #464644, 굵기 일정. 픽셀아트(계단 픽셀 유지, 안티에일리어싱 최소).
정면 시점 고정. 그림자 없음. 배경 완전 투명.
```

**캔버스 규격**

```
512×512 투명 PNG. 기준점(발 사이 바닥 중앙) = (256, 470).
서 있는 프레임은 발바닥이 y=470 에 닿는다. 정수리는 y≈130 (캐릭터 높이 340px).
발이 뜨는 프레임도 캔버스와 기준점은 그대로 두고 캐릭터만 위로 그린다.
좌우 여백 각 40px 이상. 걷기는 제자리걸음으로 그린다(앞으로 나아가지 않는다).
```

**참조 이미지**: `art/presets/seal-front.png`(정면), `art/presets/seal-back.png`(뒷모습).
생성 도구를 쓸 때 이 두 장을 레퍼런스로 넣고, 위 "보존해야 할 특징"을 프롬프트에 붙인다.

---

## 필요한 그림 목록 (고유 51장 · 파일 42개)

51장은 고유한 자세의 수다. 접합 자세(`idle/frame-00`)처럼 여러 클립이 똑같이 쓰는 그림은
빌드가 내용 해시로 합치기 때문에 실제 파일은 42개가 된다. **그릴 때는 51장을 기준**으로
하되, 접합 자세는 한 번만 그려 재사용하면 된다.

### `idle` — 4장, 루프
| 파일 | 자세 | 유지 |
|---|---|---|
| `frame-00` | **접합 자세.** 정면 차렷, 지느러미 아래로 28° 벌림, 두 발 바닥 | 700ms |
| `frame-01` | 들숨. 가슴 살짝 부풀고 몸 3px 위로, 지느러미 2° 더 벌어짐 | 500ms |
| `frame-02` | 들숨 정점. 6px 위, 머리 살짝 뒤로 | 500ms |
| `frame-03` | 날숨. 2px 아래로 눌림, 지느러미 원위치 | 700ms |

> `frame-00` 은 **모든 클립의 시작·종료 자세**다. 이것부터 확정하고 승인받는다.

### `walk` — 8장, 루프, 제자리걸음
좌우 대칭 2걸음. 한 걸음 = 4장, `stepAdvance = 26` 논리픽셀.

| 파일 | 자세 | 접지 | 유지 |
|---|---|---|---|
| `frame-00` | 왼발 앞으로 내딛는 순간(뒤꿈치 닿음), 몸 살짝 낮음 | L | 160ms |
| `frame-01` | 왼발 완전히 딛고 체중 이동, 골반 왼쪽으로 | L,R | 160ms |
| `frame-02` | 오른발 뒤로 밀며 몸 6px 위로(걸음 정점) | L | 160ms |
| `frame-03` | 오른발 공중, 몸 최고점, 지느러미 반대로 흔들림 | L | 160ms |
| `frame-04`~`07` | 위 4장의 **좌우 반전 동작**(오른발 차례) | R / L,R / R / R | 각 160ms |

> 디딘 발은 그 구간 내내 캔버스 안에서 **1px 도 움직이지 않는다.**

### `g_heart` 보고싶어 — 7장
| 파일 | 자세 | 유지 |
|---|---|---|
| `frame-00` | 접합 자세 | 120ms |
| `frame-01` | **준비**: 눌림(세로 0.90·가로 1.06), 지느러미 뒤로 8° | 200ms |
| `frame-02` | 작게 폴짝(12px 뜸), 지느러미 가슴 앞으로 26° | 200ms |
| `frame-03` | 정점. 17px 뜸, 몸 늘어남, 고개·몸통 3° 갸웃 | 280ms |
| `frame-04` | **하강 사이 그림.** 8px 높이, 지느러미 22° — 정점과 착지 사이가 튀어 추가한 장 | 120ms |
| `frame-05` | 착지 눌림(세로 0.92), 지느러미 12° | 220ms |
| `frame-06` | 접합 자세로 복귀 | 320ms |

하트 이펙트는 앱이 별도 레이어로 띄운다(그림에 넣지 않는다).

> 예산은 6장이었다. 실제로 재생해 보니 정점(03)에서 착지로 바로 넘어갈 때 그림 중심이
> 한 번에 33px 이동해 뚝 끊겨 보였다. 04를 넣어 해결했다.

### `g_cheer` 신나 — 7장
| 파일 | 자세 | 유지 |
|---|---|---|
| `frame-00` | 접합 자세 | 100ms |
| `frame-01` | **준비**: 크게 눌림 9px, 지느러미 뒤로 크게 | 220ms |
| `frame-02` | 도약. 발 뜨고 몸 세로로 늘어남 | 120ms |
| `frame-03` | 정점. 지느러미 만세, 몸 최대 신장 | 260ms |
| `frame-04` | 하강. 발 아래로 뻗음 | 120ms |
| `frame-05` | 착지. 크게 눌림 10px, 지느러미 아래로 퍼짐 | 200ms |
| `frame-06` | 접합 자세로 복귀 | 280ms |

재생은 02~05를 3회 반복한 뒤 06으로 마무리한다(같은 그림 재사용).

### `g_droop` 지쳤어 — 11장
| 파일 | 자세 | 유지 |
|---|---|---|
| `frame-00` | 접합 자세 | 160ms |
| `frame-01` | **준비**: 숨 한 번 들이켜 늘어남(세로 1.04), 고개 뒤로 2° | 240ms |
| `frame-02` | 무너짐. 세로 0.82 로 눌리고 어깨 처짐, 고개 앞으로 7° | 300ms |
| `frame-03` | 왼쪽으로 축 기욺. 몸 −5°, 4px 왼쪽, 왼 지느러미 늘어짐 | 260ms |
| `frame-04` | 왼쪽에서 돌아오는 **사이 그림** (−2.5°) | 160ms |
| `frame-05` | 가운데 통과 (0°) | 160ms |
| `frame-06` | 오른쪽으로 가는 **사이 그림** (+2.5°) | 160ms |
| `frame-07` | 오른쪽으로 축 기욺. 몸 +5°, 4px 오른쪽 | 260ms |
| `frame-08` | 몸이 조금 펴짐(세로 0.88), 기욺 2° | 220ms |
| `frame-09` | 거의 원위치(세로 0.94), 지느러미 4° | 260ms |
| `frame-10` | 접합 자세로 | 300ms |

> 예산은 6장이었다. 좌우로 기우는 구간을 4장(02→03→04→05)으로만 만들면 곁눈질에
> **계단처럼 툭툭 끊겨** 보였다. 좌우 왕복의 사이 그림 4장(04·05·06 과 09)과
> 회복 구간 1장(08)을 더해 11장이 됐다. 여기가 이번 작업에서 예산을 가장 크게 넘긴 곳이다.

### `turn_back` — 3장 / `turn_front` — 3장
| 파일 | 자세 | 유지 |
|---|---|---|
| `turn_back/frame-00` | 정면(접합 자세) | 100ms |
| `turn_back/frame-01` | **3/4 측면.** 얼굴 절반, 몸통 폭 60%, 반바지 옆선 보임 | 100ms |
| `turn_back/frame-02` | 완전한 뒷모습(`seal-back.png` 자세) | 100ms |
| `turn_front/*` | 위 3장을 역순으로. 별도로 그려도 되고 재사용해도 된다 | 각 100ms |

> **3/4 측면 그림이 반드시 필요하다.** 이게 없으면 뒤돌기가 순간이동으로 보인다.
>
> ⚠️ 현재 저장소의 `turn_back/frame-01`·`turn_front/frame-01` 은 **가짜다.** 3/4 측면을
> 그릴 방법이 없어서 정면 그림을 가로로 얇게 눌러 넣었다. 회전하는 부피가 아니라
> 납작해지는 종이로 읽힌다. 이번 발주에서 **우선순위가 가장 높은 그림**이다.

### `twerk_loop` — 8장, 루프, 뒷모습 · **이 클립이 제품의 대표 동작이다**

> **왜 지금 것으로는 안 되는가 (측정 결과)**
>
> 1. **위아래 성분이 통째로 지워지고 있었다.** `tools/bake-placeholder-clips.js` 는 접지
>    프레임의 발바닥을 바닥선(y=470)에 맞추려고 `root.y` 를 도로 뺀다. 트월킹은 8프레임이
>    전부 접지라 골반 8자의 상하 성분이 **100% 상쇄**됐다. → 낮아짐은 `sy`(몸 압축)로
>    주도록 고쳤다. 이제 프레임 높이가 306~320px 로 실제로 변한다.
> 2. **5조각 리그로는 "골반만 움직이고 머리는 가만히" 를 만들 수 없다.** `torso` 조각이
>    머리와 반바지를 **한 덩어리**로 가지고 있다. 골반을 옮기면 머리가 같이 가고,
>    몸통을 돌리면 반대로 머리만 크게 흔들린다. 즉 이 동작은 **새 원화 없이는 불가능**하다.
>    지금 들어 있는 8장은 리듬과 접지만 맞춘 임시 배치이며, 눈으로 보면 여전히
>    **통짜 좌우 미끄러짐**으로 읽힌다.

**연출**: 힐끗 → 궁디 뽁뽁. 골반과 반바지 실루엣이 주연이고 머리·어깨는 조용하다.
**분위기**: 신난 강아지가 엉덩이를 실룩이는 장난스러운 승리 춤. 반바지는 항상 착용,
노출·신체 강조 없이 둥글고 말랑한 실루엣으로만 귀여움을 만든다.

| 파일 | 자세 | 유지 |
|---|---|---|
| `frame-00` | **중앙 준비.** 낮게 앉은 자세, 두 발 벌려 딛고, 지느러미는 가슴 앞에 모음 | 80ms |
| `frame-01` | 골반이 왼쪽으로 가며 **압축**. 발 위치 그대로, 반바지 주름이 왼쪽으로 눌림 | 80ms |
| `frame-02` | **왼쪽 팝 정점.** 둥근 반바지가 왼쪽+살짝 위로 확 밀림, 몸통은 오른쪽으로 반대 곡선 | 160ms |
| `frame-03` | 탄성 반동. 중앙보다 왼쪽·낮게. **머리는 한 박자 늦게** 따라온다 | 80ms |
| `frame-04` | 중앙 낮은 통과 자세(00과 같은 크기·스탠스), 흐름은 오른쪽으로 | 80ms |
| `frame-05` | 골반이 오른쪽으로 가며 압축. 발 위치 동일 | 80ms |
| `frame-06` | **오른쪽 팝 정점.** 반바지가 오른쪽+살짝 위로, 몸통은 왼쪽으로 반대 곡선 | 160ms |
| `frame-07` | 반동 → 00 으로 이어진다 | 80ms |

총 **800ms**. 준비·정점을 느끼게 하고 전환은 빠르게. (Bible 의 40ms 격자 유지)

**수치 기준**
- 골반 좌우 변위: 캐릭터 전체 키의 **8~10%** (340px 기준 ±27~34px)
- 머리 좌우 변위: 골반 변위의 **1/4 이하**
- 두 발은 8장 내내 **같은 x·y**. 발바닥 y=470(±1px)
- 낮아짐은 하체 접힘과 몸통 변형으로. 캐릭터 전체를 아래로 내리지 않는다
- 팔은 T자로 벌리지 않고 몸 가까이 (지금 임시본의 벌린 팔은 **틀린 참고**다)

**시선**: 뒷모습 + 살짝 3/4. 오른쪽 어깨 너머로 고개를 조금 돌려 감고 웃는 눈 한쪽과
볼이 보인다. 이 "힐끗" 이 귀여움의 핵심이다.

**생성 프롬프트** (원본 `art/presets/seal-front.png`·`seal-back.png` 를 정체성 참조로 첨부)

```
Create a NEW 8-frame sprite animation contact sheet, using the two attached images only as
the canonical identity references for the SAME cheerful gray seal mascot. Preserve gray fur,
round head, pale muzzle, tiny whiskers, flipper hands and feet, lime-yellow swim shorts with
the SAME purple flower patches. Do not invent a different mascot.

Output one genuinely transparent RGBA PNG sheet, exactly 4 columns x 2 rows, 8 equal cells,
2048x1024 canvas (512x512 per cell). No grid lines, labels, numbers, scenery, ground shadows,
motion lines or particles. Each cell holds the ENTIRE intact seal with transparent margins,
consistent drawing scale, identical foot baseline at 92% of cell height. Unchanging camera.
Preserve the original pixel-art look, crisp contours, not smooth 3D.

Action: an irresistibly adorable, wholesome mascot butt-wiggle dance, like an excited puppy
wiggling its rear. NOT erotic. Swim shorts fully on and unchanged, no nudity or anatomical
emphasis. Whole body seen from behind at a slight three-quarter angle; head turned a little
toward the viewer over its right shoulder so one happy closed eye and cheek show. Stance low
and springy, stubby feet planted apart, fins tucked close to the chest. The rounded
SHORTS/HIP silhouette leads the dance; do NOT sway the whole rigid body as one piece. Head and
shoulders stay nearly in place while hips shift sideways much more; torso bends organically
and shoulders counterbalance. No separated parts or cutout seams.

Eight consecutive full-body poses forming ONE seamless cycle:
1 centered low preparation, hips centered, shoulders steady.
2 hips travel left with compression, feet anchored.
3 maximum LEFT hip pop, shorts pushed distinctly left and slightly up, torso counter-curves right.
4 elastic rebound left-of-center and down, head follows one beat late.
5 centered low passing pose matching frame 1 scale and stance, flowing right.
6 hips travel right with compression, same foot anchors.
7 maximum RIGHT hip pop, shorts pushed right and slightly up, torso counter-curves left.
8 elastic rebound right-of-center and down, flowing back into frame 1.

Hip displacement about 8-10% of full character height to each side. Head horizontal
displacement no more than a quarter of hip displacement. Feet stay in identical positions.
The eight pictures must be distinct purpose-drawn poses, not rotations or scales of one bitmap.
Keep flower shapes, proportions and pixel texture consistent between frames.
```

**넣는 경로** — 시트를 8장으로 잘라 아래 이름 그대로:

```
art/clips/char_seal/twerk_loop/frame-00.png  …  frame-07.png
```

그다음 `art/clips/char_seal/twerk_loop/clip.json` 에서 **`"placeholder": true` 줄만 지운다.**
(유지 시간은 위 표대로 이미 들어가 있다.) 마지막으로 `python3 tools/build-clip-art.py`.

> ⚠ **주의 두 가지**
> - `node tools/bake-placeholder-clips.js` 를 다시 돌리면 **새 원화를 임시본으로 덮어쓴다.**
>   진짜 그림을 넣은 뒤에는 그 도구를 이 클립에 쓰지 않는다.
> - 개념 시트(`seal-wiggle-concept.png`)는 **그대로 못 쓴다.** 측정해 보니 RGB 모드로
>   알파 채널이 아예 없고, 배경이 242~254 회색 **체크무늬가 그림에 칠해져** 있으며,
>   셀 크기가 443.5px 로 512 격자가 아니다. 포즈·리듬 참고로만 쓴다.

**검수 항목** (이 중 하나라도 걸리면 재작업)
1. 8장을 이어 붙였을 때 발이 미끄러지지 않는가 (발 x·y 동일)
2. 프레임마다 얼굴·꽃무늬가 깜빡이거나 미끄러지지 않는가
3. 머리 변위가 골반 변위의 1/4 이하인가
4. 배경 alpha=0 이고 캐릭터 내부는 불투명한가 (체크무늬 잔여물 없음)
5. 07 → 00 이 튀지 않고 이어지는가
6. `turn_back` 마지막 자세 → `twerk_loop/frame-00` 이 이어지는가
7. `twerk_loop/frame-07` → `turn_front` 첫 자세가 이어지는가
8. **이펙트·소리를 꺼도 0.5초 안에 궁디댄스로 읽히는가** (자동 검사로는 판정 못 한다)

---|---|---|---|
| `frame-00` | 중앙, 약간 위 | 중앙 | 120ms |
| `frame-01` | 왼쪽 아래 | 아직 중앙 | 120ms |
| `frame-02` | 왼쪽 최대, 아래 | 왼쪽으로 따라옴 | 120ms |
| `frame-03` | 중앙으로, 위 | 왼쪽에 남음 | 120ms |
| `frame-04` | 중앙, 위 | 중앙으로 | 120ms |
| `frame-05` | 오른쪽 아래 | 아직 중앙 | 120ms |
| `frame-06` | 오른쪽 최대, 아래 | 오른쪽으로 따라옴 | 120ms |
| `frame-07` | 중앙으로, 위 | 오른쪽에 남음 | 120ms |

> **두 발은 8장 내내 바닥 같은 자리에 고정.** 머리는 거의 안 움직인다.
> 움직이는 것은 골반이고, 상체는 늦게 따라온다. 이 지연이 트월킹의 핵심이다.

---

## 생성 도구를 쓸 때의 프롬프트 틀

```
[참조: art/presets/seal-front.png]
Pixel-art chibi gray seal character, front view, transparent background, 512x512.
<공통 "보존해야 할 특징" 문단 전체를 여기에 붙인다>
Pose: <위 표의 "자세" 칸을 영어로>
The character's feet must touch y=470 in the canvas; character centered on x=256.
Keep the outline weight, palette and face identical to the reference. No shadow, no background.
```

생성 후 반드시 사람이 검수한다. 검수 항목은 `docs/animation-bible.md` 9절 체크리스트.

---

## 넣는 방법

1. 위 경로에 PNG 를 넣고 각 클립 폴더에 `clip.json` 을 규격대로 작성한다
   (임시 에셋의 `clip.json` 을 그대로 복사해 `placeholder` 만 지우면 된다).
2. `python3 tools/build-clip-art.py` 를 실행한다 →
   `src/renderer/shared/clip-art.js` 가 다시 만들어진다.
3. `npm test` 로 규격 검사, `node tools/anim-check/render.js` + `check.py` 로 재생 검사.
4. 앱에서 확인한다. **코드 수정은 필요 없다.**
