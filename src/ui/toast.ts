type ToastKind = 'info' | 'success' | 'error';

let host: HTMLDivElement | null = null;

function ensureHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement('div');
    host.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:1000;display:flex;flex-direction:column;gap:6px;align-items:flex-end;pointer-events:none;font:12px/1.4 var(--font-ui, sans-serif);max-width:min(360px, calc(100vw - 16px));';
    document.body.appendChild(host);
  }
  return host;
}

const COLORS: Record<ToastKind, string> = {
  info: '#8fc',
  success: '#6c6',
  error: '#f66',
};

export function showToast(text: string, kind: ToastKind = 'info'): void {
  const el = document.createElement('div');
  el.style.cssText =
    `background:rgba(0,0,0,.75);color:${COLORS[kind]};padding:6px 10px;` +
    'border-radius:4px;border:1px solid rgba(255,255,255,.15);white-space:pre-wrap;' +
    'opacity:0;transition:opacity .2s;';
  el.textContent = text;
  ensureHost().appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
  });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 2500);
}
