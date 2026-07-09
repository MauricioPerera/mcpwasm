// docs/js/main.js — progressive enhancement only. Every section, code block
// and diagram is fully visible in the CSS default state (no-JS baseline);
// this script only adds the scroll-reveal/animation layer on top.
(() => {
  "use strict";

  // i18n runs first (js/i18n.js loads before this script): applies the
  // detected/saved language and injects the language switcher. Guarded so
  // this file still works standalone if i18n.js ever fails to load — the
  // page just stays in its hardcoded English default.
  if (window.MCPWASM_I18N) window.MCPWASM_I18N.init();

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- copy-to-clipboard: independent of motion preference ----
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const block = btn.closest(".code-block");
      const codeEl = block && block.querySelector("code");
      if (!codeEl) return;
      try {
        await navigator.clipboard.writeText(codeEl.textContent);
      } catch {
        // Clipboard API unavailable (e.g. insecure context, older browser):
        // fail silently — the label still flips so the click isn't a no-op,
        // and the text is already selectable/visible for a manual copy.
      }
      const original = btn.textContent;
      const copiedLabel = window.MCPWASM_I18N
        ? window.MCPWASM_I18N.t(document.documentElement.lang, "common.copied")
        : "Copied";
      btn.textContent = copiedLabel;
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("copied");
      }, 1500);
    });
  });

  // ---- benchmark counters ----
  function animateCount(el) {
    const to = Number(el.dataset.countTo);
    const from = el.dataset.from ? Number(el.dataset.from) : 0;
    const suffix = el.dataset.suffix || "";

    if (prefersReducedMotion) {
      el.textContent = to + suffix;
      return;
    }

    const duration = 800;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      el.textContent = Math.round(from + (to - from) * eased) + suffix;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  const statValues = document.querySelectorAll(".stat-value");
  if (statValues.length && "IntersectionObserver" in window) {
    const statObserver = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          animateCount(entry.target);
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.4 }
    );
    statValues.forEach((el) => statObserver.observe(el));
  } else {
    // No IntersectionObserver support: just show the final numbers.
    statValues.forEach((el) => {
      el.textContent = el.dataset.countTo + (el.dataset.suffix || "");
    });
  }

  // ---- scroll-reveal + diagram step animation ----
  // Skipped entirely under reduced motion or without IntersectionObserver:
  // without the `.js` class, CSS renders every section and diagram step in
  // its final, fully-visible state — identical to the no-JS baseline.
  if (prefersReducedMotion || !("IntersectionObserver" in window)) return;

  document.documentElement.classList.add("js");

  const revealObserver = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        obs.unobserve(entry.target);
      });
    },
    { threshold: 0.15 }
  );
  document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

  const diagram = document.getElementById("arch-svg");
  if (diagram) {
    const steps = Array.from(diagram.querySelectorAll(".step"));
    const sandboxNode = document.getElementById("sandbox-node");
    const STEP_DELAY_MS = 260;

    const diagramObserver = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          steps.forEach((stepEl, i) => {
            const order = Number(stepEl.dataset.step) || i + 1;
            setTimeout(() => stepEl.classList.add("is-visible"), order * STEP_DELAY_MS);
          });
          if (sandboxNode) {
            setTimeout(() => sandboxNode.classList.add("is-visible"), 3 * STEP_DELAY_MS);
          }
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.2 }
    );
    diagramObserver.observe(diagram);
  }

  // The spec⇄runtime #bridge-svg diagram animates its numbered steps the same
  // way, independently (no sandbox-node); reveal them as it scrolls into view.
  const bridgeDiagram = document.getElementById("bridge-svg");
  if (bridgeDiagram) {
    const bridgeSteps = Array.from(bridgeDiagram.querySelectorAll(".step"));
    const BRIDGE_STEP_DELAY_MS = 260;

    const bridgeObserver = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          bridgeSteps.forEach((stepEl, i) => {
            const order = Number(stepEl.dataset.step) || i + 1;
            setTimeout(() => stepEl.classList.add("is-visible"), order * BRIDGE_STEP_DELAY_MS);
          });
          obs.unobserve(entry.target);
        });
      },
      { threshold: 0.2 }
    );
    bridgeObserver.observe(bridgeDiagram);
  }
})();
