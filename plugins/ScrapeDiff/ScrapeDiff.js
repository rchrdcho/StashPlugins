(() => {
  "use strict";

  console.log("[ScrapeDiff] loaded");

  // ── Constants ───────────────────────────────────────────────────────────────

  const POLL_INTERVAL_MS = 100;
  const DEBOUNCE_MS = 150;

  // ── Diff computation ────────────────────────────────────────────────────────

  function wordDiff(oldText, newText) {
    const tokenize = (str) => str.split(/(\s+)/);
    const a = tokenize(oldText), b = tokenize(newText);
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    const ops = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
        ops.unshift({ text: a[i - 1], type: "same" }); i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.unshift({ text: b[j - 1], type: "added" }); j--;
      } else {
        ops.unshift({ text: a[i - 1], type: "removed" }); i--;
      }
    }
    return ops;
  }

  // ── DOM rendering ───────────────────────────────────────────────────────────

  function renderDiff(el, tokens, side) {
    const fragment = document.createDocumentFragment();
    for (const t of tokens) {
      if (side === "old" && t.type === "added") continue;
      if (side === "new" && t.type === "removed") continue;

      if (t.type === "same") {
        fragment.appendChild(document.createTextNode(t.text));
        continue;
      }

      const span = document.createElement("span");
      span.textContent = t.text;
      span.className = t.type;
      fragment.appendChild(span);
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

    // Keep the text cursor visible on the editable (scraped) side.
    if (side === "new") ta.style.caretColor = cs.color;

    return wrapper;
  }

  // ── Overlay DOM ─────────────────────────────────────────────────────────────

  function createOverlayDOM(ta) {
    // font-kerning must be disabled on the textarea before measuring clientWidth,
    // so the content div's width is calculated from the same kerning state.
    ta.style.fontKerning = "none";

    const cs = window.getComputedStyle(ta);

    // Clip div: constrains diff highlights to the textarea's visual boundary.
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

    // Content div: mirrors textarea typography so tokens land on the same pixels.
    const content = document.createElement("div");
    const contentWidth = ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    content.className = "scrape-diff-content";
    content.style.top = cs.paddingTop;
    content.style.left = cs.paddingLeft;
    content.style.width = `${contentWidth}px`;
    for (const prop of [
      "fontFamily", "fontSize", "fontWeight", "fontStyle",
      "lineHeight", "letterSpacing", "wordSpacing", "tabSize", "wordBreak",
    ]) {
      content.style[prop] = cs[prop];
    }

    clip.appendChild(content);
    return { clip, content };
  }

  function syncContentWidth(ta, content) {
    const cs = window.getComputedStyle(ta);
    const pureWidth = ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    content.style.width = `${pureWidth}px`;
  }

  // ── Orchestration ───────────────────────────────────────────────────────────

  let pollId = null;

  function trySetup() {
    // Locate targets — bail out if modal or required fields are absent
    const modal = document.querySelector(".modal-content");
    if (!modal) return false;

    const detailsField = modal.querySelector("[data-field='details'], [data-field='synopsis']");
    if (!detailsField) return false;

    const cols = [...detailsField.querySelectorAll("div.col-lg-6")];
    if (cols.length < 2) return false;

    const existingTA = cols[0].querySelector("textarea");
    const scrapedTA = cols[1].querySelector("textarea");
    if (!existingTA || !scrapedTA || existingTA.dataset.diffInitialized) return false;

    existingTA.dataset.diffInitialized = "true";
    scrapedTA.dataset.diffInitialized = "true";

    // Mount: wrap textareas, create overlays, attach to wrappers
    const oldWrapper = setupTextarea(existingTA, "old");
    const newWrapper = setupTextarea(scrapedTA, "new");

    const { clip: oldClip, content: oldContent } = createOverlayDOM(existingTA);
    const { clip: newClip, content: newContent } = createOverlayDOM(scrapedTA);
    oldWrapper.appendChild(oldClip);
    newWrapper.appendChild(newClip);

    // Initial render: sync widths then render first diff
    syncContentWidth(existingTA, oldContent);
    syncContentWidth(scrapedTA, newContent);

    function update() {
      if (!existingTA.value) return;
      const tokens = wordDiff(existingTA.value, scrapedTA.value);
      renderDiff(oldContent, tokens, "old");
      renderDiff(newContent, tokens, "new");
    }
    update();

    // Input: re-render diff after user stops typing
    let debounceId = null;
    const onInput = () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(update, DEBOUNCE_MS);
    };

    // Scroll: sync overlay position via transform (clip-path ≠ scroll container)
    const onExistingScroll = () => { oldContent.style.transform = `translateY(-${existingTA.scrollTop}px)`; };
    const onScrapedScroll = () => { newContent.style.transform = `translateY(-${scrapedTA.scrollTop}px)`; };

    scrapedTA.addEventListener("input", onInput);
    existingTA.addEventListener("scroll", onExistingScroll);
    scrapedTA.addEventListener("scroll", onScrapedScroll);

    // Resize: sync overlay widths and mirror height between the two panes
    let isSyncing = false;
    const ro = new ResizeObserver((entries) => {
      syncContentWidth(existingTA, oldContent);
      syncContentWidth(scrapedTA, newContent);

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

    // Cleanup: disconnect observers and remove listeners when modal closes
    function cleanup() {
      ro.disconnect();
      clearTimeout(debounceId);
      scrapedTA.removeEventListener("input", onInput);
      existingTA.removeEventListener("scroll", onExistingScroll);
      scrapedTA.removeEventListener("scroll", onScrapedScroll);
    }
    const closeObserver = new MutationObserver(() => {
      if (!modal.isConnected) {
        cleanup();
        closeObserver.disconnect();
      }
    });
    closeObserver.observe(document.body, { childList: true });

    console.log("[ScrapeDiff] ready");
    return true;
  }

  function startPolling() {
    if (pollId) return;
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
