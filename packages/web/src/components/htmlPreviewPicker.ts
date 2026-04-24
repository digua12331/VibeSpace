/**
 * Injected into the preview iframe via srcdoc. Runs in the iframe's isolated
 * document; communicates with the parent (HtmlPreview component) purely via
 * `window.parent.postMessage`.
 *
 * Design notes:
 * - Click handler is registered in the capture phase with preventDefault +
 *   stopPropagation so the host page's own handlers / anchor navigations do
 *   not fire while picker mode is active.
 * - Element picker stays active as long as the iframe is alive — the parent
 *   never toggles it off; every click in the iframe = one "element picked"
 *   message.
 * - Hover uses a single injected outline via inline style (no style sheet
 *   injection that could collide with the host page's CSS).
 * - Selector chain walks up until it finds an id, or reaches <body>. Uses
 *   nth-of-type so repeated siblings remain distinguishable.
 */
export const HTML_PREVIEW_PICKER_SCRIPT = `
(function () {
  if (window.__aiPickerInstalled__) return;
  window.__aiPickerInstalled__ = true;

  var prevOutline = null;
  var prevOutlineOffset = null;
  var prevEl = null;

  function clearHover() {
    if (prevEl && prevEl.style) {
      prevEl.style.outline = prevOutline || '';
      prevEl.style.outlineOffset = prevOutlineOffset || '';
    }
    prevEl = null;
    prevOutline = null;
    prevOutlineOffset = null;
  }

  function setHover(el) {
    if (!el || el === prevEl) return;
    clearHover();
    if (!el.style) return;
    prevEl = el;
    prevOutline = el.style.outline;
    prevOutlineOffset = el.style.outlineOffset;
    el.style.outline = '2px solid #3b82f6';
    el.style.outlineOffset = '-2px';
  }

  function computeSelector(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.tagName === 'BODY') return 'body';
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node.tagName !== 'BODY') {
      var tag = node.tagName ? node.tagName.toLowerCase() : null;
      if (!tag) break;
      if (node.id) {
        parts.unshift('#' + node.id);
        break;
      }
      var parent = node.parentNode;
      if (parent && parent.children && parent.children.length > 1) {
        var idx = 1;
        var sib = node;
        while ((sib = sib.previousElementSibling)) {
          if (sib.tagName === node.tagName) idx++;
        }
        parts.unshift(tag + ':nth-of-type(' + idx + ')');
      } else {
        parts.unshift(tag);
      }
      node = parent;
    }
    return parts.join(' > ');
  }

  function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  document.addEventListener('mouseover', function (e) {
    setHover(e.target);
  }, true);

  document.addEventListener('mouseout', function (e) {
    if (e.target === prevEl) clearHover();
  }, true);

  document.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    if (!el || el.nodeType !== 1) return;
    var payload = {
      __aiPicker__: true,
      selector: computeSelector(el),
      outerHTML: truncate(el.outerHTML || '', 500),
      tag: el.tagName ? el.tagName.toLowerCase() : null,
      id: el.id || null,
      classList: el.className ? String(el.className).split(/\\s+/).filter(Boolean) : [],
    };
    try {
      window.parent.postMessage(payload, '*');
    } catch (err) {
      /* swallow — parent may already be gone */
    }
  }, true);

  document.addEventListener('submit', function (e) {
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();
`
