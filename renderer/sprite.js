/**
 * 캐릭터 시트 애니메이터.
 *
 * 시트 정의(assets/characters/*.json)는 원본 이미지 위의 프레임 좌표만 담고 있다.
 * 프레임마다 크기가 다르므로, 모든 클립을 감싸는 하나의 기준 칸 안에서
 * "아래-가운데"에 맞춰 그린다. 그래야 앉은 자세와 선 자세의 키 차이가
 * 자연스럽게 유지되고 발이 바닥에 붙는다.
 */
class SpriteAnimator {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} def   시트 정의 JSON
   * @param {HTMLImageElement} image  로드가 끝난 시트 이미지
   */
  constructor(canvas, def, image) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.def = def;
    this.image = image;

    const clips = Object.values(def.clips);
    // 모든 클립을 담을 수 있는 기준 칸 (여기에 맞춰야 상태가 바뀌어도 안 잘린다)
    this.baseW = Math.max(...clips.map((c) => c.cellW));
    this.baseH = Math.max(...clips.map((c) => c.cellH));

    this.clipName = null;
    this.clip = null;
    this.frameIndex = 0;
    this.displayH = 160;
    this.rafId = null;
    this.lastStep = 0;
    this.staticFrame = false; // true면 애니메이션 재생을 멈추고 한 프레임에 고정
  }

  /** 화면에 그릴 높이(px). 기준 칸 높이를 이 값에 맞춘다. */
  setDisplayHeight(h) {
    this.displayH = h;
    const scale = h / this.baseH;
    const cssW = Math.round(this.baseW * scale);
    const dpr = window.devicePixelRatio || 1;

    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${Math.round(h)}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.draw();
  }

  /** 펫 상태(idle/thinking/…)에 맞는 클립으로 전환 */
  setState(state) {
    const name = this.def.states[state] || this.def.states.idle;
    this.setClip(name);
  }

  setClip(name) {
    if (!this.staticFrame && this.clipName === name) return;
    const clip = this.def.clips[name];
    if (!clip) return;
    this.clipName = name;
    this.clip = clip;
    this.frameIndex = 0;
    this.lastStep = 0;
    this.staticFrame = false;
    this.draw();
  }

  /**
   * 애니메이션 재생 없이 특정 클립의 특정 프레임 하나만 고정해서 보여준다.
   * 마우스 각도를 따라가는 시선(lookRight/lookLeft)처럼, "동작"이 아니라
   * "지금 이 각도의 정지 이미지"를 보여줘야 할 때 쓴다.
   */
  setStaticFrame(name, frameIndex) {
    const clip = this.def.clips[name];
    if (!clip) return;
    const n = clip.frames.length;
    const idx = ((frameIndex % n) + n) % n;
    if (this.staticFrame && this.clipName === name && this.frameIndex === idx) return;
    this.clipName = name;
    this.clip = clip;
    this.frameIndex = idx;
    this.staticFrame = true;
    this.draw();
  }

  draw() {
    const { ctx, clip } = this;
    if (!clip) return;
    ctx.clearRect(0, 0, this.baseW, this.baseH);
    const f = clip.frames[this.frameIndex % clip.frames.length];
    // 아래-가운데 정렬
    const dx = (this.baseW - f.w) / 2;
    const dy = this.baseH - f.h;
    ctx.drawImage(this.image, f.x, f.y, f.w, f.h, dx, dy, f.w, f.h);
  }

  start() {
    if (this.rafId !== null) return;
    const tick = (now) => {
      this.rafId = requestAnimationFrame(tick);
      if (!this.clip || this.staticFrame) return;
      const interval = 1000 / (this.clip.fps || 6);
      if (now - this.lastStep < interval) return;
      this.lastStep = now;
      this.frameIndex = (this.frameIndex + 1) % this.clip.frames.length;
      this.draw();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}

/** 시트 정의와 이미지를 함께 불러온다 */
async function loadSprite(canvas, defUrl) {
  const def = await fetch(defUrl).then((r) => r.json());
  const base = defUrl.slice(0, defUrl.lastIndexOf('/') + 1);
  const image = new Image();
  image.src = base + def.image;
  await image.decode();
  return new SpriteAnimator(canvas, def, image);
}

window.loadSprite = loadSprite;
