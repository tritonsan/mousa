// Served only inside the isolated preview. It cannot read the Studio or its token.
(() => {
  let nonce = '', enabled = false, marked = null;
  const notify = value => window.parent.postMessage(value, '*');
  const clear = () => { if (marked) { marked.style.outline = marked.dataset.cultureOldOutline || ''; delete marked.dataset.cultureOldOutline; marked = null; } };
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'culture-inspector:init' || !/^[a-f0-9-]{16,80}$/i.test(event.data.nonce || '')) return;
    nonce = event.data.nonce; enabled = event.data.enabled === true;
    if (!enabled) clear();
    notify({ type: 'culture-inspector:ready', nonce });
  });
  document.addEventListener('click', event => {
    if (!enabled || !nonce) return;
    event.preventDefault(); event.stopImmediatePropagation(); clear();
    const clicked = event.target instanceof Element ? event.target : event.target?.parentElement;
    const target = clicked?.closest('section[id], article[id], header[id], nav[id], main[id], footer[id]') || clicked?.closest('[id]');
    const selector = target && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(target.id) && document.querySelectorAll('#' + CSS.escape(target.id)).length === 1 ? '#' + target.id : null;
    if (target) { marked = target; target.dataset.cultureOldOutline = target.style.outline; target.style.outline = '2px solid #bd743c'; }
    const ancestors = []; let ancestor = clicked;
    while (ancestor && ancestors.length < 8) { if (/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(ancestor.id || '')) ancestors.push('#' + ancestor.id); ancestor = ancestor.parentElement; }
    notify({ type: 'culture-inspector:select', nonce, selector, ancestors, tag: (target || clicked)?.tagName?.toLowerCase() || '', text: (clicked?.textContent || '').trim().slice(0, 200) });
  }, true);
  notify({ type: 'culture-inspector:ready' });
})();
