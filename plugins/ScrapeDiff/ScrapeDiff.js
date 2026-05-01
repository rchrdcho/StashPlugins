(() => {
  "use strict";

  console.log("[ScrapeDiff] v1.3.0 loaded");

  // ── Constants ───────────────────────────────────────────────────────────────

  const POLL_INTERVAL_MS = 100;
  const DEBOUNCE_MS = 150;

  // ── Debug system ────────────────────────────────────────────────────────────

  // Use window.__scrapeDiffDebug = true to turn on debug mode
  let _debug = false;
  Object.defineProperty(window, "__scrapeDiffDebug", {
    get: () => _debug,
    set: (v) => {
      _debug = !!v;
      for (const el of document.querySelectorAll(".scrape-diff-content"))
        el.classList.toggle("sd-debug-content", _debug);
      console.log(`[ScrapeDiff] debug mode ${_debug ? "ON" : "OFF"}`);
    },
    configurable: true,
  });

  function log(tag, ...args) {
    if (_debug) console.log(`[ScrapeDiff] ${tag}:`, ...args);
  }

  function time(label) {
    if (_debug) console.time(`[ScrapeDiff] ${label}`);
  }

  function timeEnd(label) {
    if (_debug) console.timeEnd(`[ScrapeDiff] ${label}`);
  }

  function stats(tokens) {
    if (!_debug) return;
    const counts = tokens.reduce(
      (acc, t) => { acc[t.type]++; return acc; },
      { same: 0, added: 0, removed: 0 }
    );
    console.table([{ ...counts, total: tokens.length }]);
  }

  // ── Diff computation ────────────────────────────────────────────────────────

  function tokenize(str) {
    return str.split(/(\s+)/);
  }

  function wordDiff(oldText, newText) {
    const a = tokenize(oldText), b = tokenize(newText);

    // Skip common prefix
    let lo = 0;
    while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;

    // Skip common suffix (never crosses the prefix boundary)
    let hiA = a.length, hiB = b.length;
    while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) {
      hiA--;
      hiB--;
    }

    const ca = a.slice(lo, hiA), cb = b.slice(lo, hiB);
    const cm = ca.length, cn = cb.length;

    const prefix = a.slice(0, lo).map((t) => ({ text: t, type: "same" }));
    const suffix = a.slice(hiA).map((t) => ({ text: t, type: "same" }));

    if (cm === 0 && cn === 0) return [...prefix, ...suffix];

    // LCS only on the differing core
    const dp = Array.from({ length: cm + 1 }, () => new Int32Array(cn + 1));
    for (let i = 1; i <= cm; i++)
      for (let j = 1; j <= cn; j++)
        dp[i][j] = ca[i - 1] === cb[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

    // Traceback with push+reverse avoids O(n²) cost of repeated unshift
    const ops = [];
    let i = cm, j = cn;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && ca[i - 1] === cb[j - 1]) {
        ops.push({ text: ca[i - 1], type: "same" });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.push({ text: cb[j - 1], type: "added" });
        j--;
      } else {
        ops.push({ text: ca[i - 1], type: "removed" });
        i--;
      }
    }
    ops.reverse();

    return [...prefix, ...ops, ...suffix];
  }

  // ── DOM rendering ───────────────────────────────────────────────────────────

  function renderDiff(el, tokens, side) {
    const fragment = document.createDocumentFragment();
    let sameBuf = "";
    for (const t of tokens) {
      if (side === "existing" && t.type === "added") continue;
      if (side === "scraped" && t.type === "removed") continue;

      if (t.type === "same") {
        sameBuf += t.text;
        continue;
      }

      if (sameBuf) {
        fragment.appendChild(document.createTextNode(sameBuf));
        sameBuf = "";
      }
      const span = document.createElement("span");
      span.textContent = t.text;
      span.className = t.type;
      fragment.appendChild(span);
    }
    if (sameBuf) {
      fragment.appendChild(document.createTextNode(sameBuf));
    }
    el.replaceChildren(fragment);
  }

  // ── Textarea setup ──────────────────────────────────────────────────────────

  function setupTextarea(ta, side) {
    const cs = window.getComputedStyle(ta);

    // Wrapper takes over the visual background role so the textarea can be
    // made transparent without revealing the modal backdrop behind it.
    const wrapper = document.createElement("div");
    wrapper.className = "scrape-diff-wrapper";
    wrapper.style.backgroundColor = cs.backgroundColor;
    wrapper.style.borderRadius = cs.borderRadius;
    ta.parentNode.insertBefore(wrapper, ta);
    wrapper.appendChild(ta);

    if (side === "scraped") ta.style.caretColor = cs.color;

    return wrapper;
  }

  // ── Overlay DOM ─────────────────────────────────────────────────────────────

  function createOverlay(ta) {
    // font-kerning must be disabled on the textarea before measuring clientWidth,
    // so the content div's width is calculated from the same kerning state.
    ta.style.fontKerning = "none";

    const cs = window.getComputedStyle(ta);
    const padLeft  = parseFloat(cs.paddingLeft);
    const padRight = parseFloat(cs.paddingRight);

    // clip-path instead of overflow:hidden to avoid creating a scroll container.
    const clip = document.createElement("div");
    clip.className = "scrape-diff-clip";
    clip.style.cssText = [
      `border-top:${cs.borderTopWidth} solid transparent`,
      `border-right:${cs.borderRightWidth} solid transparent`,
      `border-bottom:${cs.borderBottomWidth} solid transparent`,
      `border-left:${cs.borderLeftWidth} solid transparent`,
      `clip-path:inset(0 round ${cs.borderTopLeftRadius} ${cs.borderTopRightRadius} ${cs.borderBottomRightRadius} ${cs.borderBottomLeftRadius})`,
    ].join(";");

    const content = document.createElement("div");
    content.className = "scrape-diff-content";
    content.style.top   = cs.paddingTop;
    content.style.left  = cs.paddingLeft;
    const frac = ta.getBoundingClientRect().width - ta.offsetWidth;
    content.style.width = `${ta.clientWidth - padLeft - padRight + frac}px`;
    for (const prop of [
      "fontFamily", "fontSize", "fontWeight", "fontStyle",
      "lineHeight", "letterSpacing", "wordSpacing", "tabSize", "wordBreak",
    ]) {
      content.style[prop] = cs[prop];
    }

    clip.appendChild(content);
    return { clip, content, totalPadding: padLeft + padRight };
  }

  function syncContentWidth(ta, content, totalPadding) {
    const frac = ta.getBoundingClientRect().width - ta.offsetWidth;
    content.style.width = `${ta.clientWidth - totalPadding + frac}px`;
  }

  // ── Tag diff ────────────────────────────────────────────────────────────────

  function getNamedChips(col) {
    return [...col.querySelectorAll(".react-select__multi-value")]
      .map((chip) => ({
        chip,
        name: chip.querySelector(".react-select__multi-value__label span")?.textContent.trim() || "",
      }))
      .filter((e) => e.name);
  }

  function applyTagDiff(existingCol, scrapedCol) {
    const existingEntries = getNamedChips(existingCol);
    const scrapedEntries  = getNamedChips(scrapedCol);

    if (!existingEntries.length) {
      for (const { chip } of scrapedEntries)
        chip.classList.remove("sd-tag-added");
      return;
    }

    const existingNames = new Set(existingEntries.map((e) => e.name));
    const scrapedNames  = new Set(scrapedEntries.map((e) => e.name));

    for (const { chip, name } of existingEntries)
      chip.classList.toggle("sd-tag-removed", !scrapedNames.has(name));
    for (const { chip, name } of scrapedEntries)
      chip.classList.toggle("sd-tag-added", !existingNames.has(name));
  }

  function setupTagDiff(tagsField, cleanupFns) {
    const tagSelects = [...tagsField.querySelectorAll(".tag-select")];
    if (tagSelects.length < 2) return;

    const [existingCol, scrapedCol] = tagSelects;

    applyTagDiff(existingCol, scrapedCol);

    // Re-apply whenever either side changes (late chip render or scraped tag removed by user)
    const mo = new MutationObserver(() => applyTagDiff(existingCol, scrapedCol));
    mo.observe(existingCol, { childList: true, subtree: true });
    mo.observe(scrapedCol,  { childList: true, subtree: true });
    cleanupFns.push(() => {
      log("cleanup", "tag diff");
      mo.disconnect();
    });
  }

  // ── Text diff ───────────────────────────────────────────────────────────────

  function setupTextDiff(detailsField, cleanupFns) {
    const textareas = [...detailsField.querySelectorAll("textarea")];
    if (textareas.length < 2) return;

    const existingTA = textareas[0];
    const scrapedTA  = textareas[1];

    const existingWrapper = setupTextarea(existingTA, "existing");
    const scrapedWrapper  = setupTextarea(scrapedTA, "scraped");

    const { clip: existingClip, content: existingContent, totalPadding: existingPad } = createOverlay(existingTA);
    const { clip: scrapedClip,  content: scrapedContent,  totalPadding: scrapedPad  } = createOverlay(scrapedTA);
    existingWrapper.appendChild(existingClip);
    scrapedWrapper.appendChild(scrapedClip);

    if (_debug) {
      existingContent.classList.add("sd-debug-content");
      scrapedContent.classList.add("sd-debug-content");
    }

    syncContentWidth(existingTA, existingContent, existingPad);
    syncContentWidth(scrapedTA,  scrapedContent,  scrapedPad);

    const update = () => {
      time("diff");
      if (!existingTA.value) {
        timeEnd("diff");
        return;
      }
      const tokens = wordDiff(existingTA.value, scrapedTA.value);
      log("diff:computed", tokens.length, "tokens");
      renderDiff(existingContent, tokens, "existing");
      renderDiff(scrapedContent,  tokens, "scraped");
      stats(tokens);
      timeEnd("diff");
    };
    update();

    let debounceId = null;
    const onInput = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(update, DEBOUNCE_MS);
    };

    const onExistingScroll = () => { existingContent.style.transform = `translateY(-${existingTA.scrollTop}px)`; };
    const onScrapedScroll  = () => { scrapedContent.style.transform  = `translateY(-${scrapedTA.scrollTop}px)`; };

    scrapedTA.addEventListener("input", onInput);
    existingTA.addEventListener("scroll", onExistingScroll);
    scrapedTA.addEventListener("scroll", onScrapedScroll);

    let isSyncing = false;
    const ro = new ResizeObserver((entries) => {
      syncContentWidth(existingTA, existingContent, existingPad);
      syncContentWidth(scrapedTA,  scrapedContent,  scrapedPad);
      if (!isSyncing) {
        isSyncing = true;
        for (const entry of entries) {
          if (entry.target === existingTA) scrapedTA.style.height = `${existingTA.offsetHeight}px`;
          else if (entry.target === scrapedTA) existingTA.style.height = `${scrapedTA.offsetHeight}px`;
        }
        isSyncing = false;
      }
    });
    ro.observe(existingTA);
    ro.observe(scrapedTA);

    cleanupFns.push(() => {
      log("cleanup", "text diff");
      ro.disconnect();
      clearTimeout(debounceId);
      scrapedTA.removeEventListener("input", onInput);
      existingTA.removeEventListener("scroll", onExistingScroll);
      scrapedTA.removeEventListener("scroll", onScrapedScroll);
    });
  }

  // ── Orchestration ───────────────────────────────────────────────────────────

  let pollId = null;

  function trySetup() {
    const modal = document.querySelector(".modal-content");
    if (!modal) return false;

    const detailsField = modal.querySelector("[data-field='details'], [data-field='synopsis']");
    const tagsField    = modal.querySelector("[data-field='tags']");
    if (!detailsField && !tagsField) return false;

    // Already initialized — signal success so polling stops
    if (modal.dataset.scrapeDiffInitialized) return true;
    modal.dataset.scrapeDiffInitialized = "true";

    log("modal:detected");
    time("setup");
    const cleanupFns = [];
    if (detailsField) {
      log("setup:field", "details/synopsis");
      setupTextDiff(detailsField, cleanupFns);
    }
    if (tagsField) {
      log("setup:field", "tags");
      setupTagDiff(tagsField, cleanupFns);
    }

    const closeObserver = new MutationObserver(() => {
      if (!modal.isConnected) {
        for (const fn of cleanupFns) fn();
        closeObserver.disconnect();
      }
    });
    closeObserver.observe(document.body, { childList: true });

    log("setup:complete");
    timeEnd("setup");
    console.log("[ScrapeDiff] ready");
    return true;
  }

  function startPolling() {
    if (pollId) return;
    log("poll:start");
    pollId = setInterval(() => {
      if (trySetup()) {
        clearInterval(pollId);
        pollId = null;
      }
    }, POLL_INTERVAL_MS);
  }

  new MutationObserver(() => {
    if (!pollId && document.querySelector(".modal-content")) startPolling();
  }).observe(document.body, { childList: true });
})();
