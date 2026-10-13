const SVG_NS = "http://www.w3.org/2000/svg";

function createSvgElement<T extends keyof SVGElementTagNameMap>(tag: T): SVGElementTagNameMap[T] {
  return document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[T];
}

interface CountdownDom {
  findSendButton: () => HTMLElement | null;
  findComposerInput: () => HTMLElement | null;
}

export function createCountdownUi({ findSendButton, findComposerInput }: CountdownDom) {
  let countdownRoot: HTMLElement | null = null;
  let countdownRing: SVGCircleElement | null = null;
  let countdownDigit: HTMLElement | null = null;

  const ensureCountdownStyle = () => {
    if (document.getElementById("tm-autosend-style")) return;
    const style = document.createElement("style");
    style.id = "tm-autosend-style";
    style.textContent = `
      #tm-autosend-countdown {
        width: 36px;
        height: 36px;
        position: relative;
        display: none;
        pointer-events: auto;
        cursor: pointer;
        color: var(--text-secondary, var(--text-color-secondary, #9ca3af));
        opacity: 0.95;
        flex: 0 0 36px;
      }
      #tm-autosend-countdown .tm-autosend-svg {
        width: 36px;
        height: 36px;
        transform: rotate(-90deg);
      }
      #tm-autosend-countdown .tm-autosend-track {
        fill: none;
        stroke: color-mix(in srgb, currentColor 28%, transparent);
        stroke-width: 2;
      }
      #tm-autosend-countdown .tm-autosend-progress {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.5;
        stroke-linecap: round;
        transition: stroke-dashoffset 80ms linear;
      }
      #tm-autosend-countdown .tm-autosend-digit {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        font-size: 12px;
        font-weight: 600;
        color: currentColor;
      }
    `;
    document.head.appendChild(style);
  };

  const ensureCountdownUi = () => {
    if (countdownRoot && document.contains(countdownRoot)) return countdownRoot;

    ensureCountdownStyle();

    const sendBtn = findSendButton();
    const isCountdownContainerSafe = (el: HTMLElement | null) => {
      if (!el) return false;
      if (!document.contains(el)) return false;

      let current: HTMLElement | null = el;
      while (current && current !== document.body) {
        const styles = getComputedStyle(current);
        if (styles.display === "none") return false;
        if (styles.visibility === "hidden") return false;
        if (styles.opacity === "0") return false;

        const hidesOverflow =
          styles.overflow === "hidden" ||
          styles.overflowX === "hidden" ||
          styles.overflowY === "hidden" ||
          styles.overflow === "clip" ||
          styles.overflowX === "clip" ||
          styles.overflowY === "clip";
        const rect = current.getBoundingClientRect();
        if (hidesOverflow && rect.width > 0 && rect.width < 36) return false;
        if (hidesOverflow && rect.height > 0 && rect.height < 36) return false;

        current = current.parentElement;
      }

      return true;
    };

    const composerInput = findComposerInput();
    const composerSelectors = [
      '[data-testid="composer-footer-actions"]',
      '[data-testid="composer-action-buttons"]',
      '[data-testid="composer"]',
      '[data-testid="composer-form"]',
      "form"
    ];
    const candidates: HTMLElement[] = [];
    const pushCandidate = (candidate: HTMLElement | null) => {
      if (!candidate || candidates.includes(candidate)) return;
      candidates.push(candidate);
    };

    pushCandidate(sendBtn?.parentElement ?? null);
    for (const selector of composerSelectors) {
      pushCandidate(sendBtn?.closest<HTMLElement>(selector) ?? null);
    }

    pushCandidate(document.querySelector<HTMLElement>('[data-testid="composer-footer-actions"]'));
    pushCandidate(document.querySelector<HTMLElement>('[data-testid="composer-action-buttons"]'));

    for (const selector of composerSelectors) {
      pushCandidate(composerInput?.closest<HTMLElement>(selector) ?? null);
    }
    pushCandidate(composerInput?.parentElement ?? null);

    const container = candidates.find((candidate) => isCountdownContainerSafe(candidate)) ?? null;
    const preferredContainer = sendBtn?.parentElement;
    if (!container) return null;

    const existing = document.getElementById("tm-autosend-countdown") as HTMLElement | null;
    if (existing) {
      countdownRoot = existing;
      countdownRing = existing.querySelector<SVGCircleElement>(".tm-autosend-progress");
      countdownDigit = existing.querySelector<HTMLElement>(".tm-autosend-digit");
      return countdownRoot;
    }

    const root = document.createElement("div");
    root.id = "tm-autosend-countdown";
    root.setAttribute("role", "button");
    root.setAttribute("aria-label", "Cancel pending auto-send");
    root.setAttribute("title", "Cancel pending auto-send");

    const svg = createSvgElement("svg");
    svg.setAttribute("class", "tm-autosend-svg");
    svg.setAttribute("viewBox", "0 0 36 36");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    const track = createSvgElement("circle");
    track.setAttribute("class", "tm-autosend-track");
    track.setAttribute("cx", "18");
    track.setAttribute("cy", "18");
    track.setAttribute("r", "15");

    const progress = createSvgElement("circle");
    progress.setAttribute("class", "tm-autosend-progress");
    progress.setAttribute("cx", "18");
    progress.setAttribute("cy", "18");
    progress.setAttribute("r", "15");

    svg.append(track, progress);

    const digit = document.createElement("div");
    digit.className = "tm-autosend-digit";
    digit.textContent = "3";

    root.append(svg, digit);

    if (preferredContainer && container === preferredContainer) {
      container.insertBefore(root, container.firstChild);
    } else {
      container.appendChild(root);
    }

    countdownRoot = root;
    countdownRing = progress;
    countdownDigit = digit;
    return countdownRoot;
  };

  const showCountdown = () => {
    const root = ensureCountdownUi();
    if (!root) return;
    root.style.display = "block";
  };

  const updateCountdown = (remainingMs: number, totalMs: number) => {
    const root = ensureCountdownUi();
    if (!root) return;

    const ring = countdownRing;
    const digit = countdownDigit;
    const clampedRemaining = Math.max(0, Math.min(totalMs, remainingMs));
    const progress = totalMs > 0 ? 1 - clampedRemaining / totalMs : 1;

    if (ring) {
      const radius = Number(ring.getAttribute("r") || "15");
      const circumference = 2 * Math.PI * radius;
      ring.style.strokeDasharray = String(circumference);
      ring.style.strokeDashoffset = String(circumference * (1 - progress));
    }

    if (digit) {
      const seconds = Math.max(1, Math.ceil(clampedRemaining / 1000));
      digit.textContent = String(seconds);
    }
  };

  const hideCountdown = () => {
    if (!countdownRoot) return;
    countdownRoot.style.display = "none";
  };

  const cleanupCountdownUi = () => {
    if (countdownRoot) countdownRoot.remove();
    countdownRoot = null;
    countdownRing = null;
    countdownDigit = null;
  };

  return { ensureCountdownUi, showCountdown, updateCountdown, hideCountdown, cleanupCountdownUi };
}
