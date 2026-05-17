let prettyAlertInstalled = false;

function hashText(input) {
  const text = String(input || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function installPrettyAlerts(options = {}) {
  if (prettyAlertInstalled) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const baseUrl = options.baseUrl || '/';
  const queue = [];
  let isShowing = false;
  let counter = 0;

  const gifPool = Array.isArray(options.gifPool) && options.gifPool.length > 0
    ? options.gifPool
    : [
        `${baseUrl}images/pfps/pfp1.webp`,
        `${baseUrl}images/pfps/pfp3.webp`,
        `${baseUrl}images/pfps/pfp6.webp`,
        `${baseUrl}images/pfps/pfp8.webp`,
        `${baseUrl}images/pfps/pfp11.webp`,
        `${baseUrl}images/pfps/pfp14.webp`,
        `${baseUrl}images/pfps/pfp17.webp`
      ];

  const titles = [
    'I hate to do this to you.',
    'Welp, this is embrassing!',
    'This was probably your fault.',
    'Ask Rafi idk',
    'Would not you like to know, weather boy?',
    'You did not cook.',
    'Oh, well.'
  ];

  const style = document.createElement('style');
  style.textContent = `
    .pretty-alert-host {
      position: fixed;
      top: 18px;
      left: 18px;
      z-index: 1200;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: none;
      max-width: min(540px, calc(100vw - 36px));
      font-family: var(--font-family, Arial, sans-serif);
    }

    .pretty-alert-card {
      position: relative;
      pointer-events: auto;
      display: grid;
      grid-template-columns: 98px 1fr auto;
      gap: 14px;
      align-items: center;
      background: rgba(0, 0, 0, 0.68);
      color: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 2px;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);
      padding: 13px;
      animation: pretty-alert-in 180ms ease;
      backdrop-filter: blur(5px);
    }

    .pretty-alert-card::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0));
      pointer-events: none;
    }

    .pretty-alert-card::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 1px;
      background: rgba(255, 255, 255, 0.2);
      pointer-events: none;
    }

    .pretty-alert-gif {
      width: 98px;
      height: 98px;
      object-fit: cover;
      border-radius: 0;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.06);
      box-shadow: none;
    }

    .pretty-alert-copy {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .pretty-alert-title {
      font-size: 1rem;
      font-weight: 600;
      letter-spacing: 0.035em;
      text-transform: lowercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pretty-alert-message {
      font-size: 0.92rem;
      line-height: 1.38;
      color: rgba(255, 255, 255, 0.74);
      word-break: break-word;
      max-height: 7.2em;
      overflow: auto;
      padding-right: 4px;
    }

    .pretty-alert-meta {
      font-size: 0.68rem;
      color: rgba(255, 255, 255, 0.38);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .pretty-alert-close {
      align-self: flex-start;
      border: 0;
      background: transparent;
      color: rgba(255, 255, 255, 0.55);
      border-radius: 0;
      font-size: 1.06rem;
      line-height: 1;
      cursor: pointer;
      padding: 2px 3px;
      border: none;
      opacity: 0.8;
    }

    .pretty-alert-close:hover {
      color: rgba(255, 255, 255, 0.95);
      opacity: 1;
    }

    @keyframes pretty-alert-in {
      from {
        opacity: 0;
        transform: translateY(-8px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    @media (max-width: 720px) {
      .pretty-alert-host {
        left: 10px;
        right: 10px;
        max-width: none;
      }

      .pretty-alert-card {
        grid-template-columns: 74px 1fr auto;
        gap: 10px;
        padding: 10px;
        border-radius: 1px;
      }

      .pretty-alert-gif {
        width: 74px;
        height: 74px;
      }

      .pretty-alert-title {
        font-size: 0.92rem;
      }

      .pretty-alert-message {
        font-size: 0.82rem;
      }
    }

    .pretty-confirm-overlay {
      position: fixed;
      inset: 0;
      z-index: 1300;
      background: rgba(0, 0, 0, 0.52);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 18px;
      backdrop-filter: blur(4px);
    }

    .pretty-confirm-modal {
      width: min(560px, 100%);
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(0, 0, 0, 0.74);
      color: rgba(255, 255, 255, 0.9);
      border-radius: 2px;
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.4);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: relative;
    }

    .pretty-confirm-modal::before {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 1px;
      background: rgba(255, 255, 255, 0.2);
      pointer-events: none;
    }

    .pretty-confirm-title {
      font-size: 0.98rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: lowercase;
      color: rgba(255, 255, 255, 0.9);
    }

    .pretty-confirm-message {
      font-size: 0.88rem;
      line-height: 1.38;
      color: rgba(255, 255, 255, 0.72);
      white-space: pre-wrap;
    }

    .pretty-confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 4px;
    }

    .pretty-confirm-btn {
      border: 1px solid rgba(255, 255, 255, 0.24);
      background: transparent;
      color: rgba(255, 255, 255, 0.72);
      font-family: inherit;
      font-size: 0.82rem;
      letter-spacing: 0.06em;
      text-transform: lowercase;
      cursor: pointer;
      padding: 8px 12px;
      border-radius: 1px;
      min-width: 96px;
    }

    .pretty-confirm-btn:hover {
      color: rgba(255, 255, 255, 0.95);
      border-color: rgba(255, 255, 255, 0.45);
    }

    .pretty-confirm-btn.danger {
      color: rgba(255, 145, 145, 0.92);
      border-color: rgba(255, 145, 145, 0.5);
    }

    .pretty-confirm-btn.danger:hover {
      color: rgba(255, 185, 185, 0.98);
      border-color: rgba(255, 185, 185, 0.78);
    }

    @media (max-width: 720px) {
      .pretty-confirm-overlay {
        padding: 10px;
      }

      .pretty-confirm-modal {
        padding: 14px;
      }

      .pretty-confirm-btn {
        min-width: 86px;
        padding: 7px 10px;
      }
    }
  `;

  document.head.appendChild(style);

  const host = document.createElement('div');
  host.className = 'pretty-alert-host';
  document.body.appendChild(host);

  const renderNext = () => {
    if (isShowing) return;
    const next = queue.shift();
    if (!next) return;
    isShowing = true;

    const message = String(next.message || 'Something went wrong.');
    const msgHash = hashText(message + String(Date.now()));
    const title = titles[msgHash % titles.length];
    const gif = gifPool[msgHash % gifPool.length];
    const stamp = `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} #${(++counter).toString(36)}`;

    const card = document.createElement('div');
    card.className = 'pretty-alert-card';

    const img = document.createElement('img');
    img.className = 'pretty-alert-gif';
    img.src = gif;
    img.alt = 'alert animation';

    const copy = document.createElement('div');
    copy.className = 'pretty-alert-copy';

    const titleEl = document.createElement('div');
    titleEl.className = 'pretty-alert-title';
    titleEl.textContent = title;

    const msgEl = document.createElement('div');
    msgEl.className = 'pretty-alert-message';
    msgEl.textContent = message;

    const metaEl = document.createElement('div');
    metaEl.className = 'pretty-alert-meta';
    metaEl.textContent = stamp;

    const close = document.createElement('button');
    close.className = 'pretty-alert-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'dismiss');
    close.textContent = 'x';

    copy.appendChild(titleEl);
    copy.appendChild(msgEl);
    copy.appendChild(metaEl);

    card.appendChild(img);
    card.appendChild(copy);
    card.appendChild(close);
    host.appendChild(card);

    let closed = false;
    const closeCard = () => {
      if (closed) return;
      closed = true;
      card.remove();
      isShowing = false;
      renderNext();
    };

    close.addEventListener('click', closeCard);
    window.setTimeout(closeCard, next.durationMs || 6400);
  };

  const enqueue = (message, durationMs = 6400) => {
    queue.push({ message, durationMs });
    renderNext();
  };

  const askConfirm = ({
    title = 'are you sure?',
    message = 'This action cannot be undone.',
    confirmLabel = 'continue',
    cancelLabel = 'cancel',
    danger = false
  } = {}) => new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pretty-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'pretty-confirm-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('div');
    titleEl.className = 'pretty-confirm-title';
    titleEl.textContent = title;

    const messageEl = document.createElement('div');
    messageEl.className = 'pretty-confirm-message';
    messageEl.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'pretty-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'pretty-confirm-btn';
    cancelBtn.type = 'button';
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement('button');
    confirmBtn.className = `pretty-confirm-btn${danger ? ' danger' : ''}`;
    confirmBtn.type = 'button';
    confirmBtn.textContent = confirmLabel;

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    modal.appendChild(titleEl);
    modal.appendChild(messageEl);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const finish = (value) => {
      window.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      resolve(value);
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
    cancelBtn.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));
    window.addEventListener('keydown', onKeyDown, true);

    cancelBtn.focus();
  });

  window.__prettyAlert = enqueue;
  window.__prettyConfirm = askConfirm;
  window.alert = (message) => enqueue(message);

  prettyAlertInstalled = true;
}
