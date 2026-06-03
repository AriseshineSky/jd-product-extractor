/**
 * Human-like smooth scroll — supports window + inner overflow containers (JD 新版详情页).
 */
(function (global) {
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function cubicBezier(x1, y1, x2, y2) {
    return function ease(t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      let u = t;
      for (let i = 0; i < 8; i++) {
        const cx = 3 * x1 * u * (1 - u) * (1 - u) + 3 * x2 * u * u * (1 - u) + u * u * u;
        const dx = 3 * x1 * (1 - u) * (1 - 3 * u) + 3 * x2 * (2 - 3 * u) * u + 3 * u * u;
        if (Math.abs(dx) < 1e-6) break;
        u -= (cx - t) / dx;
        u = Math.max(0, Math.min(1, u));
      }
      return 3 * y1 * u * (1 - u) * (1 - u) + 3 * y2 * u * u * (1 - u) + u * u * u;
    };
  }

  const EASINGS = {
    human: cubicBezier(0.25, 0.1, 0.25, 1),
    read: cubicBezier(0.22, 0.61, 0.36, 1),
    land: cubicBezier(0.16, 1, 0.3, 1),
    easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },
  };

  function windowMaxScrollY() {
    const doc = document.documentElement;
    const body = document.body;
    return Math.max(
      0,
      Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0) - window.innerHeight
    );
  }

  function createWindowTarget() {
    return {
      kind: "window",
      getY() {
        return window.scrollY || docScrollTop();
      },
      setY(y) {
        const top = Math.max(0, y);
        window.scrollTo({ top, left: 0, behavior: "instant" });
        document.documentElement.scrollTop = top;
        if (document.body) document.body.scrollTop = top;
      },
      maxY() {
        return windowMaxScrollY();
      },
    };
  }

  function docScrollTop() {
    return document.documentElement.scrollTop || document.body?.scrollTop || 0;
  }

  function createElementTarget(el) {
    return {
      kind: "element",
      el,
      getY() {
        return el.scrollTop;
      },
      setY(y) {
        el.scrollTop = Math.max(0, y);
      },
      maxY() {
        return Math.max(0, el.scrollHeight - el.clientHeight);
      },
    };
  }

  function isScrollableElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const range = el.scrollHeight - el.clientHeight;
    if (range < 60) return false;
    const style = getComputedStyle(el);
    const oy = style.overflowY;
    const o = style.overflow;
    if (/(auto|scroll|overlay)/.test(oy) || /(auto|scroll|overlay)/.test(o)) return true;
    return range > 200;
  }

  /** 发现所有可滚动区域（京东新版常在 #root 内层 div 滚动） */
  function discoverScrollTargets() {
    const targets = [];
    const seen = new Set();

    function add(el) {
      if (!el || seen.has(el)) return;
      seen.add(el);
      const t = createElementTarget(el);
      if (t.maxY() > 30) targets.push(t);
    }

    const win = createWindowTarget();
    if (win.maxY() > 30) targets.push(win);

    const scrollingEl = document.scrollingElement;
    if (scrollingEl && scrollingEl !== document.body) add(scrollingEl);

    const seeds = [
      document.querySelector("#root"),
      document.querySelector("main"),
      document.querySelector('[class*="item"]'),
      document.querySelector('[class*="detail"]'),
      document.body,
    ].filter(Boolean);

    for (const seed of seeds) {
      add(seed);
      if (seed.querySelectorAll) {
        seed.querySelectorAll("div, section, main, article").forEach((el) => {
          if (isScrollableElement(el)) add(el);
        });
      }
    }

    targets.sort((a, b) => b.maxY() - a.maxY());
    const deduped = [];
    for (const t of targets) {
      if (t.kind === "element" && deduped.some((d) => d.el && d.el.contains(t.el))) continue;
      deduped.push(t);
    }
    return deduped.length ? deduped.slice(0, 4) : [createWindowTarget()];
  }

  function pickEasing(segmentIndex, totalSegments) {
    if (segmentIndex === totalSegments - 1) return EASINGS.land;
    if (segmentIndex === 0) return EASINGS.human;
    const r = Math.random();
    if (r < 0.45) return EASINGS.human;
    if (r < 0.8) return EASINGS.read;
    return EASINGS.easeInOutCubic;
  }

  function animateTargetY(target, fromY, toY, durationMs, easing) {
    const startY = Math.max(0, Math.min(fromY, target.maxY()));
    const endY = Math.max(0, Math.min(toY, target.maxY()));
    const distance = endY - startY;
    if (Math.abs(distance) < 2) return Promise.resolve();

    const duration = Math.max(320, durationMs);

    return new Promise((resolve) => {
      const t0 = performance.now();

      function frame(now) {
        const elapsed = now - t0;
        const t = Math.min(1, elapsed / duration);
        target.setY(startY + distance * easing(t));
        if (t < 1) requestAnimationFrame(frame);
        else {
          target.setY(endY);
          resolve();
        }
      }

      requestAnimationFrame(frame);
    });
  }

  async function scrollTargetSegment(target, deltaY, options = {}) {
    const fromY = target.getY();
    const toY = Math.min(fromY + deltaY, target.maxY());
    const easing = options.easing || EASINGS.human;
    const durationMs =
      options.durationMs ||
      rand(520, 1100) + Math.min(Math.abs(toY - fromY) * 0.35, 900);
    await animateTargetY(target, fromY, toY, durationMs, easing);
  }

  async function maybeOvershootTarget(target, targetY, options = {}) {
    const y = Math.min(targetY, target.maxY());
    if (options.overshoot === false || Math.random() > 0.35) {
      await animateTargetY(target, target.getY(), y, rand(500, 900), EASINGS.land);
      return;
    }
    const overshoot = rand(24, 72);
    const past = Math.min(y + overshoot, target.maxY());
    await animateTargetY(target, target.getY(), past, rand(320, 520), EASINGS.read);
    await sleep(rand(80, 180));
    await animateTargetY(target, target.getY(), y, rand(380, 650), EASINGS.land);
  }

  function viewportHeight() {
    return window.innerHeight || document.documentElement.clientHeight || 800;
  }

  function scrollElementIntoView(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: "start", behavior: "instant" });
    } catch (_) {
      el.scrollIntoView(true);
    }
  }

  /** 分段滚到元素附近，模拟用户浏览列表后再点击 */
  async function scrollElementIntoViewHuman(el, options = {}) {
    if (!el) return;
    await scrollGate(options);

    const rect = el.getBoundingClientRect();
    const viewport = viewportHeight();
    const marginTop = Number(options.marginTop) || rand(80, 140);
    const marginBottom = Number(options.marginBottom) || rand(100, 180);
    const idealTop = marginTop;
    const idealBottom = viewport - marginBottom;

    if (rect.top >= idealTop && rect.bottom <= idealBottom) {
      await sleep(rand(180, 360));
      return;
    }

    const targets = discoverScrollTargets();
    const deltaWindow = rect.top - idealTop - rand(-20, 30);

    for (const target of targets) {
      if (target.kind !== "window") continue;
      const fromY = target.getY();
      const toY = Math.max(0, Math.min(fromY + deltaWindow, target.maxY()));
      if (Math.abs(toY - fromY) < 6) continue;
      await scrollGate(options);
      await animateTargetY(target, fromY, toY, rand(650, 1100), EASINGS.read);
      break;
    }

    await scrollGate(options);
    await sleep(rand(220, 420));
  }

  /**
   * 对所有可滚动容器分段滚到底（可见窗口会跟着动）。
   */
  async function scrollGate(options) {
    const api = global.JdScrollPause;
    if (api?.gateScroll) await api.gateScroll(options);
  }

  async function scrollPageToBottom(options = {}) {
    const maxRounds = Number(options.maxRounds) || 28;
    const pauseMin = Number(options.pauseMinMs) || 120;
    const pauseMax = Number(options.pauseMaxMs) || 480;
    let stableRounds = 0;

    await scrollGate(options);

    for (let round = 0; round < maxRounds; round++) {
      await scrollGate(options);
      const targets = discoverScrollTargets();
      const viewport = viewportHeight();
      let anyMoved = false;

      for (const target of targets) {
        const limitY = target.maxY();
        const currentY = target.getY();
        const remaining = limitY - currentY;
        if (remaining <= 8) continue;

        anyMoved = true;
        stableRounds = 0;
        const chunkRatio = rand(0.42, 0.78);
        const segmentDelta = Math.min(remaining, viewport * chunkRatio);

        await scrollGate(options);
        await scrollTargetSegment(target, segmentDelta, {
          easing: pickEasing(round, maxRounds),
          durationMs: rand(600, 1300) + segmentDelta * 0.25,
        });
      }

      if (!anyMoved) {
        stableRounds += 1;
        if (stableRounds >= 2) break;
        await sleep(rand(200, 400));
        continue;
      }

      await scrollGate(options);
      await sleep(rand(pauseMin, pauseMax));
    }

    await scrollGate(options);
    const targets = discoverScrollTargets();
    for (const target of targets) {
      if (target.maxY() > 0) {
        await scrollGate(options);
        await maybeOvershootTarget(target, target.maxY(), options);
      }
    }
    await scrollGate(options);
    await sleep(rand(250, 500));

    const detail =
      document.querySelector("#detail-main") ||
      document.querySelector("#detail") ||
      document.querySelector(".detail-content");

    if (detail) {
      await scrollGate(options);
      scrollElementIntoView(detail);
      await sleep(rand(300, 500));

      const targets2 = discoverScrollTargets();
      for (const target of targets2) {
        await scrollGate(options);
        const rect = detail.getBoundingClientRect();
        if (target.kind === "window") {
          const detailTop = Math.max(0, window.scrollY + rect.top - rand(60, 100));
          await animateTargetY(target, target.getY(), detailTop, rand(700, 1100), EASINGS.read);
        } else if (target.el?.contains?.(detail) || detail.contains?.(target.el)) {
          const innerDelta = Math.min(
            rect.height * rand(0.35, 0.65),
            target.maxY() - target.getY()
          );
          if (innerDelta > 40) {
            await scrollTargetSegment(target, innerDelta, {
              easing: EASINGS.land,
              durationMs: rand(800, 1200),
            });
          }
        }
      }
      await sleep(rand(350, 650));
    }

    for (const target of discoverScrollTargets()) {
      await scrollGate(options);
      if (target.maxY() > target.getY() + 5) {
        await animateTargetY(target, target.getY(), target.maxY(), rand(600, 900), EASINGS.land);
      }
    }
    await scrollGate(options);
  }

  const api = {
    scrollPageToBottom,
    scrollElementIntoViewHuman,
    discoverScrollTargets,
    animateTargetY,
    cubicBezier,
    EASINGS,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JdHumanScroll = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
