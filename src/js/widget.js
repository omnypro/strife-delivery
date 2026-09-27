(async function () {
  const { invoke, listen, SIZES, countdown, describeDate, escapeHtml } = window.SD;

  const $ = (id) => document.getElementById(id);
  const card = $('card');
  const art = $('art');

  const STEAM_REFRESH_MS = 6 * 60 * 60 * 1000;

  let state = await window.SD.loadState();
  let index = Math.max(0, state.games.findIndex((g) => g.id === state.activeId));
  let currentArt;
  let rotateTimer;
  let shown = false;

  const currentGame = () => state.games[index] || null;

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function applyAppearance() {
    const size = SIZES[state.size] || SIZES.m;
    document.body.className = `size-${state.size}`;
    document.documentElement.style.setProperty('--accent', state.accent || window.SD.DEFAULT_ACCENT);
    document.documentElement.style.setProperty('--opacity', String(state.opacity ?? 1));
    invoke('resize_widget', { width: size.width, height: size.height });
  }

  function setArt(game) {
    const url = game && game.art;
    if (url === currentArt) return;
    currentArt = url;
    art.classList.add('fade');
    const apply = () => {
      if (currentArt !== url) return;
      art.classList.toggle('placeholder', !url);
      art.style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : '';
      art.classList.remove('fade');
    };
    if (!url) return setTimeout(apply, 150);
    const img = new Image();
    img.onload = () => setTimeout(apply, 150);
    img.onerror = () => {
      if (currentArt === url) {
        art.classList.add('placeholder');
        art.style.backgroundImage = '';
        art.classList.remove('fade');
      }
    };
    img.src = url;
  }

  // Show the game's transparent logo instead of the text title when the art
  // doesn't already have it; fall back to text if the logo fails to load.
  function setLogo(game) {
    const logo = $('logo');
    const title = $('title');
    const want = window.SD.showsLogo(game) ? game.logo : null;
    if (!want) {
      logo.hidden = true;
      logo.removeAttribute('src');
      title.classList.remove('sr-only');
      return;
    }
    if (logo.getAttribute('src') === want && !logo.hidden) return;
    logo.onload = () => {
      if (logo.getAttribute('src') !== want) return;
      logo.hidden = false;
      title.classList.add('sr-only');
    };
    logo.onerror = () => {
      logo.hidden = true;
      title.classList.remove('sr-only');
    };
    logo.setAttribute('src', want);
  }

  function renderDots() {
    const dots = $('dots');
    const many = state.games.length > 1;
    $('prev').hidden = !many;
    $('next').hidden = !many;
    dots.innerHTML = many
      ? state.games
          .map((g, i) => `<button class="dot${i === index ? ' on' : ''}" data-i="${i}" title="${escapeHtml(g.name)}"></button>`)
          .join('')
      : '';
  }

  function renderStatic() {
    const game = currentGame();
    const empty = !game;
    card.classList.toggle('is-empty', empty);
    $('empty').hidden = !empty;
    renderDots();
    if (empty) {
      setArt(null);
      return;
    }
    $('title').textContent = game.name;
    setLogo(game);
    $('date').textContent = describeDate(game);
    setArt(game);
    tick();
  }

  function tick() {
    const game = currentGame();
    if (!game) return;
    const c = countdown(game);
    const num = $('num');
    const unit = $('unit');
    const clock = $('clock');
    const eyebrow = $('eyebrow');
    card.classList.toggle('released', !!(c && c.released));
    num.classList.remove('small');

    if (!c) {
      eyebrow.textContent = 'Release date';
      num.textContent = 'TBA';
      unit.textContent = '';
      clock.textContent = 'Waiting on a release date';
      return;
    }

    if (c.released) {
      eyebrow.textContent = 'Delivered';
      num.textContent = 'Out now';
      num.classList.add('small');
      unit.textContent = '';
      clock.textContent = c.days === 0 ? 'Released today — go play!' : `Released ${c.days} day${c.days === 1 ? '' : 's'} ago`;
      return;
    }

    eyebrow.textContent = c.approximate ? 'Countdown · earliest' : 'Countdown';
    const secs = state.showSeconds
      ? `<b>${String(c.seconds).padStart(2, '0')}</b><i>s</i>`
      : '';
    if (c.days > 0) {
      num.textContent = (c.approximate ? '~' : '') + c.days.toLocaleString();
      unit.textContent = c.days === 1 ? 'day' : 'days';
      clock.innerHTML =
        `<b>${String(c.hours).padStart(2, '0')}</b><i>h</i>` +
        `<b>${String(c.minutes).padStart(2, '0')}</b><i>m</i>` + secs;
    } else {
      // Final day: the clock becomes the headline.
      num.textContent = state.showSeconds
        ? `${c.hours}:${String(c.minutes).padStart(2, '0')}:${String(c.seconds).padStart(2, '0')}`
        : `${c.hours}:${String(c.minutes).padStart(2, '0')}`;
      num.classList.add('small');
      unit.textContent = '';
      clock.textContent = 'Almost here…';
    }
  }

  // -------------------------------------------------------------------------
  // Navigation / rotation
  // -------------------------------------------------------------------------

  function go(i, persist) {
    if (!state.games.length) return;
    index = (i + state.games.length) % state.games.length;
    renderStatic();
    if (persist) {
      state.activeId = state.games[index].id;
      window.SD.saveState(state);
    }
    scheduleRotate();
  }

  function scheduleRotate() {
    clearInterval(rotateTimer);
    if (state.rotate && state.games.length > 1) {
      const every = Math.max(5, Number(state.rotateSeconds) || 15) * 1000;
      rotateTimer = setInterval(() => go(index + 1, false), every);
    }
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  card.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    if (!state.lockPosition) invoke('start_drag');
  });
  card.addEventListener('dblclick', (e) => {
    if (!e.target.closest('button')) invoke('open_settings');
  });
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    invoke('show_context_menu');
  });
  $('prev').addEventListener('click', () => go(index - 1, true));
  $('next').addEventListener('click', () => go(index + 1, true));
  $('settings').addEventListener('click', () => invoke('open_settings'));
  $('empty').addEventListener('click', () => invoke('open_settings'));
  $('dots').addEventListener('click', (e) => {
    const dot = e.target.closest('.dot');
    if (dot) go(Number(dot.dataset.i), true);
  });

  listen('next-game', () => go(index + 1, true));
  listen('state-changed', (next) => {
    state = window.SD.normalizeState(next);
    const active = state.games.findIndex((g) => g.id === state.activeId);
    if (active >= 0) index = active;
    else index = Math.min(index, Math.max(0, state.games.length - 1));
    applyAppearance();
    renderStatic();
    scheduleRotate();
  });

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  applyAppearance();
  renderStatic();
  scheduleRotate();

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
