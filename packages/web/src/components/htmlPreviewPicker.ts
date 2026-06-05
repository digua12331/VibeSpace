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
 *
 * Edit mode (in-place HTML editing):
 * - The parent posts {__aiCmd__:'enter-edit'|'exit-edit'|'request-save'} via
 *   postMessage. enter-edit turns the body contentEditable on and suspends the
 *   picker (no hover outline, no click-to-pick); exit-edit reverses it.
 * - request-save clones the live document, strips the injected picker script
 *   (id=__ai_picker__) and any contenteditable attributes, then posts the
 *   serialized HTML back as {__aiSave__:true, html}. Serializing happens INSIDE
 *   the iframe on purpose so the sandbox stays at allow-scripts only (no
 *   allow-same-origin) — the parent never reads contentDocument directly.
 */
export const HTML_PREVIEW_PICKER_SCRIPT = `
(function () {
  if (window.__aiPickerInstalled__) return;
  window.__aiPickerInstalled__ = true;

  var editMode = false;
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
    el.style.outline = '2px solid rgb(var(--color-accent))';
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
    if (editMode) return;
    setHover(e.target);
  }, true);

  document.addEventListener('mouseout', function (e) {
    if (e.target === prevEl) clearHover();
  }, true);

  document.addEventListener('click', function (e) {
    // In edit mode let the browser place the caret — don't preventDefault or
    // hijack the click as an element pick.
    if (editMode) return;
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

  document.addEventListener('input', function () {
    if (!editMode) return;
    try { window.parent.postMessage({ __aiDirty__: true }, '*'); } catch (err) {}
  }, true);

  function serializeClean() {
    var docEl = document.documentElement.cloneNode(true);
    var inj = docEl.querySelector('#__ai_picker__');
    if (inj && inj.parentNode) inj.parentNode.removeChild(inj);
    var eds = docEl.querySelectorAll('[contenteditable]');
    for (var i = 0; i < eds.length; i++) eds[i].removeAttribute('contenteditable');
    var doctype = document.doctype ? '<!DOCTYPE ' + document.doctype.name + '>\\n' : '';
    return doctype + docEl.outerHTML;
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var data = e.data;
    if (!data || typeof data.__aiCmd__ !== 'string') return;
    if (data.__aiCmd__ === 'enter-edit') {
      editMode = true;
      clearHover();
      if (document.body) document.body.contentEditable = 'true';
    } else if (data.__aiCmd__ === 'exit-edit') {
      editMode = false;
      if (document.body) document.body.removeAttribute('contenteditable');
    } else if (data.__aiCmd__ === 'request-save') {
      var html;
      try {
        html = serializeClean();
      } catch (err) {
        try { window.parent.postMessage({ __aiSave__: true, error: String(err) }, '*'); } catch (e2) {}
        return;
      }
      try { window.parent.postMessage({ __aiSave__: true, html: html }, '*'); } catch (e3) {}
    }
  });
})();
`
