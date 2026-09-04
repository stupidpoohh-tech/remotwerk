'use strict';
/* 배우(actor) — **무엇을 재생할지**와 **어디로 갈지**를 결정한다.
 *
 * 재생기(player.js)는 시키는 동작을 그릴 뿐이고, 화면 좌표는 여기서만 바뀐다.
 * 이 분리가 필요한 이유:
 *   예전에는 걷기 클립이 스스로 root.x 를 0→108→0 왕복시키고, 동시에 오버레이의
 *   roam() 이 기준 위치를 순간이동시켰다. 두 이동이 겹쳐 "제자리걸음 + 텔레포트"가 됐다.
 *   이제 그림은 제자리걸음만, 좌표는 여기서 **걸음 주기에 맞춰 연속으로** 움직인다.
 *
 * 상태
 *   idle    멍때리기(루프)
 *   walk    걷기(루프) + 좌표 이동
 *   gesture 신호 동작(1회). 끝나면 idle/walk 로 복귀
 *
 * 신호 정책
 *   - 동작 중에 새 신호가 오면 **하나만** 큐에 담는다(연타로 밀리지 않게).
 *   - 클립이 알려 준 cancelFrom 이후면 즉시 중단하고 새 신호로 넘어간다.
 *   - 타이머가 동작을 무조건 처음부터 재시작하지 않는다. 대기/걷기 예약은
 *     gesture 가 끝난 뒤에만 다시 잡힌다.
 */

(function (root) {
  const RW = (root.RW = root.RW || {});

  const DEFAULTS = {
    // 대기 ↔ 걷기 전환 간격(ms)
    idleMin: 3000, idleMax: 8000,
    walkMin: 2600, walkMax: 6200,
    walkChance: 0.6,
    // 이동 한계(집 위치 기준 논리픽셀)
    // **세로 이동은 하지 않는다.** 캐릭터는 바닥에 선 채 좌우로만 다닌다.
    // (위아래로 떠다니면 "바닥에 선 몸" 이라는 인상이 깨지고, 창 위쪽으로 올라가
    //  작업 화면을 가린다.)
    rangeX: 260, rangeY: 0
  };

  function create(opts) {
    const cfg = Object.assign({}, DEFAULTS, opts || {});
    const player = cfg.player;                 // player.create(...) 결과
    const onMove = cfg.onMove || function () {};
    const isPaused = cfg.isPaused || function () { return false; };

    let state = 'idle';
    let timer = null;
    let queued = null;                         // 대기 중인 신호 1개
    let rafMove = null;
    let lastT = 0;

    // 위치는 "집 위치로부터의 오프셋"이다. 집(사용자가 끌어다 둔 자리)은 건드리지 않는다.
    let x = 0, y = 0;
    let dir = 1;                               // +1 오른쪽, -1 왼쪽
    let speed = 0;                             // 논리픽셀/ms
    let targetX = 0;

    function rand(a, b) { return a + Math.random() * (b - a); }

    // 걷는 속도는 **클립이 알려 준 보폭**에서 나온다.
    //   속도 = stepAdvance(한 걸음 거리) / 한 걸음 시간
    // 이렇게 해야 발이 미끄러지지 않는다.
    function walkSpeed() {
      const adv = player.stepAdvance();
      const cycle = player.cycleMs();
      const anim = RW.animations.get('wander');
      const steps = (anim && anim.steps) || 2;
      if (!adv || !cycle) return 0.055;         // 클립 정보가 없으면 보수적인 기본값
      return adv / (cycle / steps);
    }

    function clearTimer() { clearTimeout(timer); timer = null; }

    function startIdle() {
      state = 'idle';
      speed = 0;
      player.play('idle', {});
      clearTimer();
      timer = setTimeout(decide, rand(cfg.idleMin, cfg.idleMax));
    }

    function startWalk() {
      state = 'walk';
      // 목적지를 먼저 정하고, 그 방향을 본다. 방향 전환은 걸음 시작 전에만 일어난다.
      const span = cfg.rangeX;
      targetX = Math.max(-span, Math.min(span, x + rand(-span, span)));
      dir = targetX >= x ? 1 : -1;
      player.setFlip(dir < 0);
      player.play('wander', {});
      speed = walkSpeed();
      clearTimer();
      timer = setTimeout(decide, rand(cfg.walkMin, cfg.walkMax));
    }

    function decide() {
      if (state === 'gesture') return;          // 동작 중에는 자율 전환하지 않는다
      if (Math.random() < cfg.walkChance) startWalk();
      else startIdle();
    }

    // 신호 재생. 걷기 중이면 그 자리에 멈춘 뒤 연기한다(위치는 튀지 않는다).
    function playGesture(gid) {
      if (isPaused()) return;
      if (state === 'gesture') { queued = gid; return; }
      state = 'gesture';
      speed = 0;
      clearTimer();
      player.setFlip(false);                    // 신호는 항상 정면
      player.play(gid, {
        onDone() {
          if (queued) {
            const next = queued; queued = null;
            state = 'idle';                     // playGesture 의 중복 진입 방지
            playGesture(next);
            return;
          }
          decide();                             // 끝나면 대기/걷기로 복귀
        }
      });
    }

    // ---- 이동 루프 ----
    // 시간 기반으로 위치를 연속 갱신한다. 프레임이 튀어도 거리 계산이 어긋나지 않는다.
    function moveTick(now) {
      if (lastT === 0) lastT = now;
      const dt = Math.min(64, now - lastT);     // 탭 전환 등으로 크게 벌어지면 잘라낸다
      lastT = now;

      if (state === 'walk' && speed > 0) {
        const step = speed * dt * dir;
        const nx = x + step;
        // 목적지에 닿거나 범위를 넘으면 그 자리에서 멈춘다(되돌아 튀지 않는다).
        if ((dir > 0 && nx >= targetX) || (dir < 0 && nx <= targetX)) {
          x = targetX;
          startIdle();
        } else {
          x = Math.max(-cfg.rangeX, Math.min(cfg.rangeX, nx));
          y = 0;      // 수평 이동만. 세로 오프셋은 만들지 않는다.
        }
        onMove(x, y);
      }
      rafMove = requestAnimationFrame(moveTick);
    }

    function start() {
      if (rafMove == null) { lastT = 0; rafMove = requestAnimationFrame(moveTick); }
      startIdle();
    }

    function stop() {
      clearTimer();
      if (rafMove != null) cancelAnimationFrame(rafMove);
      rafMove = null;
      player.stop();
    }

    // 사용자가 캐릭터를 직접 끌면 배회 오프셋을 리셋한다(집이 바뀐 것으로 본다).
    function resetPosition() { x = 0; y = 0; targetX = 0; onMove(x, y); }

    return {
      start, stop, playGesture, resetPosition,
      get state() { return state; },
      get offset() { return { x, y }; },
      get speed() { return speed; }
    };
  }

  RW.actor = { create, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
