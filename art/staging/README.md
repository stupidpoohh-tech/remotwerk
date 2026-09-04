# 원화 반입 폴더 (staging)

원화 제작 환경에서 만든 그림을 **여기에 놓기만** 하면 된다. 여기 있는 원본은
도구가 절대 수정하지 않는다.

```
art/staging/<characterId>/<clipId>/
    frame-00.png … frame-NN.png      ← 낱장으로 받은 경우
  또는
    sheet.png                        ← 시트로 받은 경우
    sheet.json                       ← {"cols": 4, "rows": 2}
```

## 규격 (docs/animation-bible.md 2·8절과 동일)

- 프레임마다 **512×512 RGBA PNG**, 실제 투명 배경(체크무늬를 그려 넣은 것은 배경이 아니다)
- 기준점 **(256, 470)**. 접지 프레임은 발바닥이 y=470 (±1px)
- 기준 자세 키 **340px**, `displayScale` 0.7059, **모든 프레임 같은 배율**
- 쪼그리는 프레임까지 키를 억지로 맞추지 않는다. 낮아진 자세는 낮은 채로 둔다
- 그림 중심을 매 프레임 자동 정렬하지 않는다 — 그러면 골반 이동이 지워진다

## 반입 절차

```bash
python3 tools/import-clip.py <characterId> <clipId>              # 검사만(아무것도 안 씀)
python3 tools/import-clip.py <characterId> <clipId> --write      # 통과하면 반영
python3 tools/import-clip.py <characterId> <clipId> --write --approve
                                                                  # 눈 검수까지 끝난 뒤에만
python3 tools/build-clip-art.py                                   # 런타임 에셋 생성
```

- 규격을 하나라도 못 넘기면 **아무 파일도 쓰지 않는다.** 기존 정상 에셋을 훼손하지 않기 위해서다.
- `--approve` 없이는 `placeholder` 표시가 유지된다. 파일이 있다는 이유로 풀지 않는다.
- 한 번 승인된 클립은 `tools/bake-placeholder-clips.js` 가 **건너뛴다**(`--force` 로만 덮어씀).

## 검수 방법

```bash
node tools/anim-check/render.js && python3 tools/anim-check/check.py   # 찢어짐·구멍
node tools/anim-check/timeline.js                                      # 재생 시간축
node tools/app-smoke.js                                                # 진짜 앱에서 표시
```

자동 검사를 통과했다고 귀여운 것은 아니다. **이펙트·소리를 끄고 0.5초 안에 그 동작으로
읽히는지는 눈으로 판단한다.**
