/**
 * 파이버 스케줄러 — 원본 게임 코드는 bex::Fiber 위에서 돈다. Update 는 무한 루프이고 bex::Fiber::Wait() 로 한 프레임 쉰다
 * [판독: mg1801 ObjectManImpl::Update / PlayerManImpl::Update].
 * 여기서는 제너레이터 하나가 파이버 하나다. `yield` 한 번 = Wait() 한 번 = 다음 프레임에 이어서 돈다.
 *
 * [미확정] 여러 파이버가 한 프레임에 도는 순서(만든 순서인지, 우선순위가 있는지)는 main 의 bex::Fiber 판독 전이다.
 *          지금은 만든 순서대로 돌린다. 판독되면 이 파일만 고친다.
 */

/** 파이버 본체. yield 값은 쓰지 않는다(한 번 = 한 프레임) */
export type Co = Generator<void, void, unknown>;

export class Fiber {
  /** 끝났거나 kill 됨 */
  dead = false;

  constructor(
    private readonly co: Co,
    /** 디버그·대조용 이름 */
    readonly tag: string,
  ) {}

  /** @internal 다음 Wait 까지 돌린다. 끝났으면 true */
  step(): boolean {
    return this.co.next().done === true;
  }
}

export class Scheduler {
  private readonly fibers: Fiber[] = [];

  spawn(co: Co, tag = ''): Fiber {
    const f = new Fiber(co, tag);
    this.fibers.push(f);
    return f;
  }

  kill(f: Fiber): void {
    f.dead = true;
  }

  /** 한 프레임. 도는 중에 만든 파이버는 다음 프레임부터 돈다 */
  runFrame(): void {
    const n = this.fibers.length;
    for (let i = 0; i < n; i++) {
      const f = this.fibers[i];
      if (!f.dead && f.step()) f.dead = true;
    }
    for (let i = this.fibers.length - 1; i >= 0; i--) if (this.fibers[i].dead) this.fibers.splice(i, 1);
  }

  /** 살아 있는 파이버(디버그·대조용) */
  list(): readonly Fiber[] {
    return this.fibers;
  }
}
