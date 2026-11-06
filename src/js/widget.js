(async function () {
  const { invoke, listen, countdown, describeDate } = window.SD;

  const $ = (id) => document.getElementById(id);
  const widget = $('widget');
  const stack = $('stack');

  const STEAM_REFRESH_MS = 6 * 60 * 60 * 1000;

  let state = await window.SD.loadState();
  let shown = false;

  // Game id -> its card. The empty-list card lives under EMPTY.
  const EMPTY = '';
  const cards = new Map();

  const pad = (n) => String(n).padStart(2, '0');

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function createCard() {
    const el = document.createElement('section');
    el.className = 'game';
    el.innerHTML = `
      <div class="art"></div>
      <div class="text">
        <div class="count">—</div>
        <h2 class="title"></h2>
        <div class="date"></div>
      </div>`;
    return {
      el,
      art: el.querySelector('.art'),
      count: el.querySelector('.count'),
      title: el.querySelector('.title'),
      date: el.querySelector('.date'),
      game: null,
      currentArt: undefined,
    };
  }

  function setArt(card, url) {
    url = url || null;
    const { art } = card;
    if (url === card.currentArt) return;
    card.currentArt = url;
    art.classList.add('fade');
    const apply = () => {
      if (card.currentArt !== url) return;
      art.classList.toggle('placeholder', !url);
      art.style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : '';
      art.classList.remove('fade');
    };
    if (!url) return setTimeout(apply, 150);
    const img = new Image();
    img.onload = () => setTimeout(apply, 150);
    img.onerror = () => {
      if (card.currentArt === url) {
        art.classList.add('placeholder');
        art.style.backgroundImage = '';
        art.classList.remove('fade');
      }
    };
    img.src = url;
  }

  // Cards are reused between renders so a state change doesn't re-fade art
  // that hasn't changed.
  function renderStatic() {
    const wanted = state.games.length ? state.games.map((g) => g.id) : [EMPTY];

    for (const [id, card] of cards) {
      if (wanted.includes(id)) continue;
      card.el.remove();
      cards.delete(id);
    }

    wanted.forEach((id, i) => {
      let card = cards.get(id);
      if (!card) {
        card = createCard();
        cards.set(id, card);
      }
      if (stack.children[i] !== card.el) stack.insertBefore(card.el, stack.children[i] || null);

      if (id === EMPTY) {
        card.game = null;
        setArt(card, null);
        card.count.textContent = '000:00:00:00';
        card.title.textContent = 'No games yet';
        card.date.textContent = 'Double-click to add one';
        return;
      }
      const game = state.games[i];
      card.game = game;
      card.title.textContent = game.name;
      card.date.textContent = describeDate(game);
      setArt(card, game.art);
    });

    tick();
  }

  // DDD:HH:MM:SS, or a word when there's nothing to count.
  function tick() {
    for (const card of cards.values()) {
      if (!card.game) continue;
      const c = countdown(card.game);
      if (!c) {
        card.count.textContent = 'TBA';
      } else if (c.released) {
        card.count.textContent = 'OUT NOW';
      } else {
        card.count.textContent =
          `${c.approximate ? '~' : ''}${c.days}:${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`;
      }
    }
  }

  // Keep the window exactly as big as the widget.
  let fitted = '';
  function fit() {
    const r = widget.getBoundingClientRect();
    const size = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`;
    if (size === fitted) return;
    fitted = size;
    invoke('fit_widget', { width: Math.ceil(r.width), height: Math.ceil(r.height) });
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  widget.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !state.lockPosition) invoke('start_drag');
  });
  widget.addEventListener('dblclick', () => invoke('open_settings'));
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    invoke('show_context_menu');
  });

  listen('state-changed', (next) => {
    state = window.SD.normalizeState(next);
    renderStatic();
  });

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  renderStatic();
  await document.fonts.ready;
  fit();
  new ResizeObserver(fit).observe(widget);

  // Tick on the second boundary so the seconds don't drift visibly.
  (function loop() {
    tick();
    setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
  })();

  // Not requestAnimationFrame: the window starts hidden and hidden webviews
  // don't run animation frames, so it would never get shown.
  if (!shown) {
    shown = true;
    invoke('show_widget');
    // Brand-new install: take her straight to adding a game.
    if (state.firstRun) {
      state.firstRun = false;
      window.SD.saveState(state);
      if (!state.games.length) invoke('open_settings');
    }
  }

  async function maybeRefreshSteam() {
    const last = state.lastSteamRefresh ? Date.parse(state.lastSteamRefresh) : 0;
    const hasSteamGames = state.games.some((g) => g.steamAppId && g.dateSource === 'steam');
    if (hasSteamGames && Date.now() - last > STEAM_REFRESH_MS) {
      try {
        await window.SD.refreshSteamDates();
      } catch (err) {
        console.warn('Steam refresh failed', err);
      }
    }
  }
  setTimeout(maybeRefreshSteam, 8000);
  setInterval(maybeRefreshSteam, 30 * 60 * 1000);
})();
