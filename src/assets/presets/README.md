# 프리셋 에셋 포맷

프리셋 캐릭터는 **부위별 아트 + 리그 설정(JSON)** 으로 구성한다. 이 포맷을 따르면
나중에 직접 그린 아트를 그대로 끼워 넣을 수 있다.

```
presets/
  <presetId>/
    rig.json        # 골격 종류 + 슬롯별 아트(색/이미지/테두리)
    head.png        # (선택) 부위별 이미지 — rig.json 의 slots.<slot>.image 에서 참조
    torso.png
    ...
```

## rig.json 필드

| 필드 | 설명 |
|------|------|
| `id` | 프리셋 식별자 |
| `name` | 표시 이름 |
| `skeletonId` | 골격 종류. 현재는 `"bipedal"` 고정 |
| `slots` | 슬롯(head/torso/arm/hand/leg/foot)별 표현 |

각 슬롯:

| 필드 | 설명 |
|------|------|
| `color` | 플레이스홀더 색(아트가 없을 때) |
| `image` | 부위 이미지 경로 또는 data URI. 넣으면 색 대신 이미지로 렌더 |
| `border` | (선택) 테두리 CSS |
| `radius` | (선택) 사각 부위의 모서리 둥글기(px) |

## 골격(본 계층 · 회전 중심점 · z-순서)

본 계층, 관절 회전 중심점(pivot), z-순서는 **공통 골격 정의**
(`src/renderer/shared/skeleton.js`)에 있다. 애니메이션(11개 시퀀스)은 이 골격에
대해 만들어져 있으므로, 같은 `skeletonId` 를 쓰는 어떤 캐릭터에도 그대로 적용된다.

> 이번 빌드의 프리셋 3종은 색 플레이스홀더다. 최종 아트는 각 슬롯의 `image` 를
> 채워 교체한다. 런타임 로더는 `src/renderer/shared/presets.js` 이며, 이 rig.json
> 들은 동일 포맷의 참조본이다.
