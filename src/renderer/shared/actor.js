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
    rangeX: 260, rangeY: 0,
    // 신호 재생이 끝났다는 연락이 안 올 때 강제로 대기로 되돌리기까지의 여유(ms).
    // 실제 대기는 (동작 예상 길이 × 2 + 이 값) 이다. 정상 재생을 자르지 않을 만큼
    // 넉넉해야 하고, 멈춘 채로 오래 두지 않을 만큼은 짧아야 한다.
    // 이게 없으면 캐릭터가 'gesture' 상태에 갇혀 영영 멈춘다(검사에서는 짧게 준다).
    gestureGraceMs: 4000
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

      let done = false;
      function finish() {
        if (done) return;                       // 감시 타이머와 onDone 이 겹쳐도 한 번만
        done = true;
        clearTimer();
        // ★ **상태를 먼저 내린다.** decide() 는 state === 'gesture' 면 그냥 돌아간다.
        // 예전에는 gesture 인 채로 decide() 를 불러서, 신호가 끝나도 아무 일도
        // 일어나지 않았다 — 다음 예약도 없고 이동 루프도 walk 가 아니라
        // **캐릭터가 그 자리에서 영영 멈췄다.** 신호를 한 번 받으면 그걸로 끝이었다.
        state = 'idle';
        if (queued) {
          const next = queued; queued = null;
          playGesture(next);
          return;
        }
        decide();                               // 끝나면 대기/걷기로 복귀
      }

      const started = player.play(gid, { onDone: finish });

      // ★ 'gesture' 상태에서 빠져나오지 못하면 캐릭터가 **영영 멈춘다.**
      // decide() 는 gesture 중이면 그냥 돌아가고, 이동 루프도 walk 가 아니면 아무것도
      // 안 하므로, 복귀 신호를 한 번 놓치는 순간 그대로 정지 화면이 된다.
      // 빠져나오지 못하는 길이 둘 있었다.
      //   1) 재생기가 그 동작을 모르면 play() 가 **false 만 돌려주고 onDone 을 안 부른다.**
      //   2) 재생 중 창이 가려져 rAF 가 멈추면 onDone 이 오지 않는다.
      // 그래서 (1)은 즉시 되돌리고, (2)는 감시 타이머로 받아 낸다.
      if (!started) { finish(); return; }

      // 감시 타이머 — 예상 길이보다 넉넉히 지나도 안 끝나면 강제로 복귀시킨다.
      // setTimeout 은 rAF 와 달리 창이 가려져도(백그라운드 절약을 꺼 둔 상태에서는)
      // 밀릴지언정 결국 도착한다.
      const expected = (player.cycleMs && player.cycleMs()) || 0;
      timer = setTimeout(finish, expected * 2 + cfg.gestureGraceMs);
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
