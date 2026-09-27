// Tiny DOM helper: h('div.a.b', { onClick }, child, [children], 'text')

export function h(sel, props, ...children) {
  const [, tag, rest] = /^([a-z0-9-]*)(.*)$/i.exec(sel);
  const el = document.createElement(tag || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && !k.includes('-')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function replace(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

export function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}

let toastTimer;
export function toast(text, ms = 2200) {
  document.querySelector('.toast')?.remove();
  const el = h('div.toast', { role: 'status' }, text);
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

// Whether there's an in-app page to go back to (vs. arriving on a shared link).
export const nav = { depth: 0 };

export function navigate(path, { replace: rep = false } = {}) {
  if (path === location.pathname + location.search) return;
  if (!rep) nav.depth++;
  history[rep ? 'replaceState' : 'pushState']({}, '', path);
  window.dispatchEvent(new Event('sesh:navigate'));
}

// <a> that routes client-side.
export function link(href, props, ...children) {
  return h('a', {
    href,
    ...props,
    onClick: (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(href);
    },
  }, ...children);
}
