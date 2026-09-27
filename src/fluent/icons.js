/*
 * Fluent-style line icons (24×24 grid, drawn with a thin stroke so they read
 * like Segoe Fluent Icons at 16–20px).
 *
 *   <i class="f-icon" data-icon="games"></i>
 *   Fluent.hydrate(root?)      fills every [data-icon] under root
 *   Fluent.icon('add', 'lg')   returns an HTML string
 *   Fluent.bindSlider(input)   keeps a .f-slider's filled track in sync
 */
(function () {
  const P = {
    games: '<path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 5.5l-1 4.4a2.3 2.3 0 0 1-4 .9L14.5 16h-5l-1.4 1.8a2.3 2.3 0 0 1-4-.9l-1-4.4A4.5 4.5 0 0 1 7.5 7z"/><path d="M8 10v3M6.5 11.5h3"/><circle cx="15.5" cy="10.8" r=".6"/><circle cx="17" cy="12.6" r=".6"/>',
    widget: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M7 15.5h6M7 12.5h3"/><circle cx="16" cy="9.5" r="1.5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r=".6"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M14.5 5.5l4 4L9 19H5v-4z"/><path d="M13 7l4 4"/>',
    delete: '<path d="M4.5 7h15M10 4h4M6.5 7l.9 11.2A2 2 0 0 0 9.4 20h5.2a2 2 0 0 0 2-1.8L17.5 7M10.5 10.5v6M13.5 10.5v6"/>',
    search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="M14.5 14.5L19.5 19.5"/>',
    chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
    chevronLeft: '<path d="M14.5 6l-6 6 6 6"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.5"/><path d="M4 17l5-4.5 3.5 3 3-2.5L20 17"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    color: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.5-2l-.3-1a1.7 1.7 0 0 1 1.7-2.2h1.6a4 4 0 0 0 4-4A8 8 0 0 0 12 3.5z"/><circle cx="7.8" cy="11" r=".8"/><circle cx="10.5" cy="7.5" r=".8"/><circle cx="15" cy="8" r=".8"/>',
    opacity: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/><path d="M12 6.5h5.5M12 9.5h7.5M12 12.5h8M12 15.5h7M12 18.5h4.5" stroke-width="1"/>',
    resize: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M9 15l6-6M11 9h4v4"/>',
    rotate: '<path d="M19.5 12a7.5 7.5 0 0 1-13.1 5M4.5 12A7.5 7.5 0 0 1 17.6 7"/><path d="M18 3.5V7.5h-4M6 20.5v-4h4"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1"/>',
    power: '<path d="M12 3.5v8"/><path d="M7 6.3a7.5 7.5 0 1 0 10 0"/>',
    sync: '<path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3M4.5 12A7.5 7.5 0 0 1 17.3 6.7"/><path d="M17.5 3.5v3.5H14M6.5 20.5V17H10"/>',
    timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4.5M10 3h4M18.5 6.5l1.2-1.2"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5M12 3.5C9.5 6 8.5 9 8.5 12s1 6 3.5 8.5"/>',
    heart: '<path d="M12 19.5s-7.5-4.3-7.5-9.5A4 4 0 0 1 12 7.5 4 4 0 0 1 19.5 10c0 5.2-7.5 9.5-7.5 9.5z"/>',
    star: '<path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4-3.9-3.8 5.4-.8z"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    open: '<path d="M13.5 4.5h6v6M19.5 4.5L11 13M17.5 14v3.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2H10"/>',
  };

  function icon(name, size) {
    const body = P[name];
    if (!body) return '';
    return `<i class="f-icon${size ? ' ' + size : ''}" aria-hidden="true"><svg viewBox="0 0 24 24">${body}</svg></i>`;
  }

  function hydrate(root) {
    (root || document).querySelectorAll('[data-icon]').forEach((el) => {
      const body = P[el.dataset.icon];
      if (!body) return;
      el.classList.add('f-icon');
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `<svg viewBox="0 0 24 24">${body}</svg>`;
      el.removeAttribute('data-icon');
    });
  }

  function bindSlider(input) {
    const sync = () => {
      const min = Number(input.min || 0);
      const max = Number(input.max || 100);
      const pct = ((Number(input.value) - min) / (max - min)) * 100;
      input.style.setProperty('--f-fill', `${pct}%`);
    };
    input.addEventListener('input', sync);
    sync();
    return sync;
  }

  /** Apply ?backdrop=mica|vibrancy|none from the URL to <body data-backdrop>. */
  function applyBackdrop() {
    const b = new URLSearchParams(location.search).get('backdrop') || 'none';
    document.body.dataset.backdrop = b;
  }

  window.Fluent = { icon, icons: P, hydrate, bindSlider, applyBackdrop };
})();
