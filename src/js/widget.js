(async function () {
  const { invoke, listen, countdown, describeDate } = window.SD;

  const $ = (id) => document.getElementById(id);
  const widget = $('widget');
  const art = $('art');

  const STEAM_REFRESH_MS = 6 * 60 * 60 * 1000;

  let state = await window.SD.loadState();
  let index = Math.max(0, state.games.findIndex((g) => g.id === state.activeId));
  let currentArt;
  let shown = false;

  const currentGame = () => state.games[index] || null;
  const pad = (n) => String(n).padStart(2, '0');

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

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

  function renderStatic() {
    const game = currentGame();
    if (!game) {
      setArt(null);
      $('count').textContent = '000:00:00:00';
      $('title').textContent = 'No games yet';
      $('date').textContent = 'Double-click to add one';
      return;
    }
    $('title').textContent = game.name;
    $('date').textContent = describeDate(game);
    setArt(game);
    tick();
  }

  // DDD:HH:MM:SS, or a word when there's nothing to count.
  function tick() {
    const game = currentGame();
    if (!game) return;
    const c = countdown(game);
    if (!c) {
      $('count').textContent = 'TBA';
    } else if (c.released) {
      $('count').textContent = 'OUT NOW';
    } else {
      $('count').textContent =
        `${c.approximate ? '~' : ''}${c.days}:${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`;
    }
  }

  function go(i) {
    if (!state.games.length) return;
    index = (i + state.games.length) % state.games.length;
    renderStatic();
    state.activeId = state.games[index].id;
    window.SD.saveState(state);
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

  listen('next-game', () => go(index + 1));
  listen('state-changed', (next) => {
    state = window.SD.normalizeState(next);
    const active = state.games.findIndex((g) => g.id === state.activeId);
    if (active >= 0) index = active;
    else index = Math.min(index, Math.max(0, state.games.length - 1));
    renderStatic();
  });

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  renderStatic();

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
