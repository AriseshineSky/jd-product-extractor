/**
 * Bezier-curve mouse movement + realistic click sequence for pagination etc.
 */
(function (global) {
  let lastX = null;
  let lastY = null;

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
  };

  function getStartPoint() {
    if (lastX != null && lastY != null) {
      return { x: lastX, y: lastY };
    }
    return {
      x: rand(window.innerWidth * 0.25, window.innerWidth * 0.75),
      y: rand(window.innerHeight * 0.2, window.innerHeight * 0.55),
    };
  }

  function pointOnCubic(t, p0, p1, p2, p3) {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  }

  function buildPath(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const spread = Math.max(40, Math.hypot(dx, dy) * 0.35);
    return {
      p0: from,
      p1: {
        x: from.x + dx * rand(0.15, 0.45) + rand(-spread, spread),
        y: from.y + dy * rand(0.05, 0.35) + rand(-spread * 0.6, spread * 0.6),
      },
      p2: {
        x: to.x - dx * rand(0.1, 0.4) + rand(-spread * 0.5, spread * 0.5),
        y: to.y - dy * rand(0.05, 0.35) + rand(-spread * 0.5, spread * 0.5),
      },
      p3: to,
    };
  }

  function targetAtElement(el, options = {}) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      return { x: rect.left, y: rect.top };
    }
    const marginX = Math.min(8, rect.width * 0.15);
    const marginY = Math.min(6, rect.height * 0.15);
    return {
      x: rect.left + marginX + rand(0, rect.width - marginX * 2),
      y: rect.top + marginY + rand(0, rect.height - marginY * 2),
    };
  }

  function resolveClickTarget(el) {
    if (!el) return null;
    const inner = el.querySelector?.("a, button");
    if (inner && el.contains(inner)) return inner;
    return el.closest?.('a, button, [role="button"]') || el;
  }

  function elementUnderPoint(x, y) {
    return document.elementFromPoint(x, y) || document.body;
  }

  function dispatchMouse(type, x, y, target, extra = {}) {
    const el = target || elementUnderPoint(x, y);
    const common = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: window.screenX + x,
      screenY: window.screenY + y,
      button: extra.button ?? 0,
      buttons: extra.buttons ?? (type === "mousedown" ? 1 : 0),
      relatedTarget: null,
      ctrlKey: !!extra.ctrlKey,
      metaKey: !!extra.metaKey,
      shiftKey: !!extra.shiftKey,
      altKey: !!extra.altKey,
    };

    try {
      el.dispatchEvent(
        new PointerEvent(type, {
          ...common,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        })
      );
    } catch (_) {
      /* PointerEvent may be unavailable in some contexts */
    }

    el.dispatchEvent(new MouseEvent(type, common));
    return el;
  }

  async function moveMouseAlongBezier(from, to, options = {}) {
    const path = buildPath(from, to);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.min(50, Math.max(18, Math.round(distance / 14)));
    const durationMs = options.durationMs || rand(520, Math.min(1400, 380 + distance * 1.1));
    const easing = options.easing || EASINGS.human;
    const stepDelay = durationMs / steps;

    for (let i = 1; i <= steps; i++) {
      const t = easing(i / steps);
      const pt = pointOnCubic(t, path.p0, path.p1, path.p2, path.p3);
      const jitterX = i < steps ? rand(-0.6, 0.6) : 0;
      const jitterY = i < steps ? rand(-0.6, 0.6) : 0;
      const x = pt.x + jitterX;
      const y = pt.y + jitterY;
      dispatchMouse("mousemove", x, y);
      lastX = x;
      lastY = y;
      await sleep(stepDelay + rand(-4, 8));
    }

    lastX = to.x;
    lastY = to.y;
  }

  /**
   * 贝塞尔移动鼠标到元素内随机点并触发完整点击事件链。
   */
  async function humanClick(element, options = {}) {
    const target = resolveClickTarget(element);
    if (!target) throw new Error("无法解析点击目标");

    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    await sleep(options.beforeMoveMs ?? rand(180, 380));

    const from = getStartPoint();
    const to = targetAtElement(target, options);
    await moveMouseAlongBezier(from, to, options.move || {});

    await sleep(options.beforeClickMs ?? rand(60, 160));

    const hoverEl = elementUnderPoint(to.x, to.y);
    const mod = {
      ctrlKey: !!options.ctrlKey,
      metaKey: !!options.metaKey,
      shiftKey: !!options.shiftKey,
    };
    dispatchMouse("mouseenter", to.x, to.y, hoverEl, mod);
    dispatchMouse("mouseover", to.x, to.y, hoverEl, mod);
    await sleep(rand(40, 100));
    dispatchMouse("mousedown", to.x, to.y, hoverEl, mod);
    await sleep(rand(55, 130));
    dispatchMouse("mouseup", to.x, to.y, hoverEl, mod);
    dispatchMouse("click", to.x, to.y, hoverEl, mod);

    if (!options.skipNativeClick && typeof target.click === "function") {
      try {
        target.click();
      } catch (_) {
        /* ignore */
      }
    }

    lastX = to.x;
    lastY = to.y;
    await sleep(options.afterClickMs ?? rand(120, 280));
    return target;
  }

  async function humanHover(element, options = {}) {
    const target = resolveClickTarget(element);
    if (!target) throw new Error("无法解析悬停目标");

    target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    await sleep(options.beforeMoveMs ?? rand(120, 260));

    const from = getStartPoint();
    const to = targetAtElement(target, options);
    await moveMouseAlongBezier(from, to, options.move || { durationMs: rand(420, 900) });

    const hoverEl = elementUnderPoint(to.x, to.y);
    dispatchMouse("mouseenter", to.x, to.y, hoverEl);
    dispatchMouse("mouseover", to.x, to.y, hoverEl);
    lastX = to.x;
    lastY = to.y;
    await sleep(options.afterHoverMs ?? rand(180, 420));
    return target;
  }

  async function humanClickWithModifiers(element, options = {}) {
    const target = resolveClickTarget(element);
    if (!target) throw new Error("无法解析点击目标");

    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    await sleep(options.beforeMoveMs ?? rand(180, 380));

    const from = getStartPoint();
    const to = targetAtElement(target, options);
    await moveMouseAlongBezier(from, to, options.move || {});

    await sleep(options.beforeClickMs ?? rand(60, 160));

    const hoverEl = elementUnderPoint(to.x, to.y);
    const mod = {
      ctrlKey: !!options.ctrlKey,
      metaKey: !!options.metaKey,
      shiftKey: !!options.shiftKey,
      button: options.button ?? 0,
      buttons: options.buttons ?? (options.button === 1 ? 4 : 1),
    };
    dispatchMouse("mouseenter", to.x, to.y, hoverEl, mod);
    dispatchMouse("mouseover", to.x, to.y, hoverEl, mod);
    await sleep(rand(40, 100));
    dispatchMouse("mousedown", to.x, to.y, hoverEl, mod);
    await sleep(rand(55, 130));
    dispatchMouse("mouseup", to.x, to.y, hoverEl, mod);
    dispatchMouse("click", to.x, to.y, hoverEl, mod);
    if (options.button === 1) {
      try {
        hoverEl.dispatchEvent(
          new MouseEvent("auxclick", {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: to.x,
            clientY: to.y,
            button: 1,
          })
        );
      } catch (_) {
        /* ignore */
      }
    }

    if (!options.skipNativeClick && typeof target.click === "function") {
      try {
        target.click();
      } catch (_) {
        /* ignore */
      }
    }

    lastX = to.x;
    lastY = to.y;
    await sleep(options.afterClickMs ?? rand(120, 280));
    return target;
  }

  /**
   * 模拟用户 Ctrl/Cmd+点击在新标签打开商品（仅一次，不用 target=_blank 避免双开）。
   */
  async function humanClickOpenInNewTab(element, options = {}) {
    const target = resolveClickTarget(element);
    if (!target) throw new Error("无法解析点击目标");
    const href = target.href || target.getAttribute?.("href");
    if (!href) throw new Error("商品链接无效");
    const absolute = new URL(href, location.href).href;
    const isApple = /Mac|iPhone|iPad/i.test(navigator.platform || "");

    await humanHover(target, options.hover || {});

    await humanClickWithModifiers(target, {
      ...options,
      skipNativeClick: true,
      ctrlKey: !isApple,
      metaKey: isApple,
    });

    return { target, url: absolute, mode: "ctrl_click" };
  }

  const api = {
    humanClick,
    humanHover,
    humanClickWithModifiers,
    humanClickOpenInNewTab,
    moveMouseAlongBezier,
    getLastPosition: () => ({ x: lastX, y: lastY }),
    resetPosition: () => {
      lastX = null;
      lastY = null;
    },
    EASINGS,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JdHumanMouse = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
