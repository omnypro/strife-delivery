(async function () {
  const SD = window.SD;
  const { invoke, listen, escapeHtml, describeDate, countdown } = SD;
  const { icon } = window.Fluent;
  const $ = (id) => document.getElementById(id);

  Fluent.applyBackdrop();
  Fluent.hydrate();
  const syncOpacitySlider = Fluent.bindSlider($('opacity'));

  let state = await SD.loadState();
  let page = 'games';
  let editingId = null;
  let manualArt = null;

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  let toastTimer;
  function toast(msg, kind = 'success') {
    const t = $('toast');
    t.className = `f-infobar f-toast ${kind}`;
    $('toast-text').textContent = msg;
    requestAnimationFrame(() => t.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
  }

  async function commit(mutate) {
    // Start from what's on disk so we don't clobber the widget's writes.
    state = SD.normalizeState(await invoke('load_state'));
    mutate(state);
    await SD.saveState(state);
    render();
  }

  function artStyle(el, url) {
    el.style.backgroundImage = url ? `url("${String(url).replace(/"/g, '%22')}")` : '';
    el.classList.toggle('placeholder-art', !url);
  }

  function status(game) {
    const c = countdown(game);
    if (!c) return 'No date yet';
    if (c.released) return 'Out now';
    if (c.days === 0) return 'Today!';
    return `${c.approximate ? '~' : ''}${c.days.toLocaleString()} day${c.days === 1 ? '' : 's'} to go`;
  }

  function splitIso(iso) {
    const m = (iso || '').match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
    return m ? { date: m[1], time: m[2] && m[2] !== '00:00' ? m[2] : '' } : { date: '', time: '' };
  }

  const errText = (err) => String((err && err.message) || err);

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  function go(to, id) {
    if (to === 'edit') {
      if (!state.games.some((g) => g.id === id)) to = 'games';
      else editingId = id;
    }
    page = to;
    document.querySelectorAll('[data-page]').forEach((p) => { p.hidden = p.dataset.page !== to; });
    const section = to === 'add' || to === 'edit' ? 'games' : to;
    document.querySelectorAll('[data-nav]').forEach((n) => {
      if (n.dataset.nav === section) n.setAttribute('aria-current', 'page');
      else n.removeAttribute('aria-current');
    });
    $('content').scrollTop = 0;
    render();
    if (to === 'add') setTimeout(() => $('search').focus(), 0);
  }

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) return go(nav.dataset.nav);
    const link = e.target.closest('[data-go]');
    if (link) {
      e.preventDefault();
      go(link.dataset.go);
    }
  });

  // -------------------------------------------------------------------------
  // Games page
  // -------------------------------------------------------------------------

  function renderGames() {
    const list = $('games');
    $('games-empty').hidden = state.games.length > 0;
    list.innerHTML = state.games
      .map((g, i) => {
        const active = g.id === state.activeId;
        return `
          <div class="f-card clickable game" data-id="${g.id}" tabindex="0" role="button" aria-label="Edit ${escapeHtml(g.name)}">
            <div class="f-thumb" ${g.art ? `style="background-image:url('${escapeHtml(g.art).replace(/'/g, '%27')}')"` : ''}></div>
            <div class="f-card-text">
              <span class="f-card-title">${escapeHtml(g.name)}${active ? '<span class="tag on">On widget</span>' : ''}</span>
              <span class="f-card-desc">${escapeHtml(describeDate(g))}<span class="sep">·</span>${escapeHtml(status(g))}${g.dateSource === 'steam' ? '<span class="sep">·</span>Steam' : ''}</span>
            </div>
            <div class="f-card-control">
              ${active ? '' : `<button class="f-btn subtle icon" data-act="show" title="Show on widget" aria-label="Show on widget">${icon('eye')}</button>`}
              <button class="f-btn subtle icon" data-act="up" title="Move up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('arrowUp')}</button>
              <span class="f-card-chevron">${icon('chevronRight')}</span>
            </div>
          </div>`;
      })
      .join('');
  }

  $('games').addEventListener('click', (e) => {
    const card = e.target.closest('.game');
    if (!card) return;
    const id = card.dataset.id;
    const act = e.target.closest('button[data-act]');
    if (!act) return go('edit', id);
    if (act.dataset.act === 'show') commit((s) => { s.activeId = id; });
    if (act.dataset.act === 'up') {
      commit((s) => {
        const i = s.games.findIndex((g) => g.id === id);
        if (i > 0) [s.games[i - 1], s.games[i]] = [s.games[i], s.games[i - 1]];
      });
    }
  });
  $('games').addEventListener('keydown', (e) => {
    const card = e.target.closest('.game');
    if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      go('edit', card.dataset.id);
    }
  });

  // -------------------------------------------------------------------------
  // Add page: Steam
  // -------------------------------------------------------------------------

  const SEARCH_HINT = 'Release date and art are filled in automatically, and kept up to date.';

  $('search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const term = $('search').value.trim();
    if (!term) return;
    $('search-status').innerHTML = '<span class="f-row"><span class="f-spinner"></span>Searching Steam…</span>';
    $('results').innerHTML = '';
    try {
      const items = ((await invoke('steam_search', { term })) || [])
        .filter((it) => it && it.id && it.name)
        .slice(0, 10);
      $('search-status').textContent = items.length
        ? `${items.length} result${items.length === 1 ? '' : 's'}. Pick one to add it.`
        : 'No matches on Steam. If it isn’t on Steam yet, add it below.';
      $('results').innerHTML = items
        .map((it) => {
          const have = state.games.some((g) => g.steamAppId === Number(it.id));
          return `
            <div class="f-card compact result" data-id="${Number(it.id)}">
              <div class="f-thumb" ${it.tiny_image ? `style="background-image:url('${escapeHtml(it.tiny_image).replace(/'/g, '%27')}')"` : ''}></div>
              <div class="f-card-text"><span class="f-card-title">${escapeHtml(it.name)}</span></div>
              <div class="f-card-control">
                ${have
                  ? '<span class="f-secondary">Already added</span>'
                  : `<button class="f-btn" data-add="${Number(it.id)}">${icon('add')}Add</button>`}
              </div>
            </div>`;
        })
        .join('');
    } catch (err) {
      $('search-status').textContent = errText(err);
    }
  });

  $('results').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    const appid = Number(btn.dataset.add);
    btn.disabled = true;
    btn.innerHTML = '<span class="f-spinner"></span>Adding';
    try {
      const info = await SD.steamGame(appid);
      const art = await SD.bestSteamArt(appid, info.details);
      const game = {
        id: SD.uid(),
        name: info.name,
        steamAppId: appid,
        releaseDate: info.releaseDate,
        precision: info.precision,
        rawDate: info.rawDate,
        dateSource: 'steam',
        art: art.art,
        artKind: art.artKind,
        logo: art.logo,
        artChoice: 'auto',
        addedAt: new Date().toISOString(),
      };
      await commit((s) => {
        s.games.push(game);
        s.activeId = game.id;
      });
      $('results').innerHTML = '';
      $('search').value = '';
      $('search-status').textContent = SEARCH_HINT;
      go('games');
      toast(info.precision === 'unknown'
        ? `Added ${info.name}. Steam says “${info.rawDate || 'TBA'}”, so you can set a date yourself.`
        : `Added ${info.name}`);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `${icon('add')}Add`;
      toast(errText(err), 'critical');
    }
  });

  // -------------------------------------------------------------------------
  // Add page: manual
  // -------------------------------------------------------------------------

  $('m-art').addEventListener('change', async () => {
    const file = $('m-art').files[0];
    if (!file) return;
    try {
      manualArt = await SD.imageFileToDataUrl(file);
      artStyle($('m-art-preview'), manualArt);
      $('m-art-clear').hidden = false;
    } catch (err) {
      toast(errText(err), 'critical');
    }
    $('m-art').value = '';
  });
  $('m-art-clear').addEventListener('click', () => {
    manualArt = null;
    artStyle($('m-art-preview'), null);
    $('m-art-clear').hidden = true;
  });

  $('manual').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('m-name').value.trim();
    const date = $('m-date').value;
    if (!name || !date) return;
    const game = {
      id: SD.uid(),
      name,
      steamAppId: null,
      releaseDate: `${date}T${$('m-time').value || '00:00'}`,
      precision: 'day',
      rawDate: '',
      dateSource: 'manual',
      art: manualArt,
      artKind: manualArt ? 'custom' : null,
      logo: null,
      artChoice: manualArt ? 'custom' : 'auto',
      addedAt: new Date().toISOString(),
    };
    await commit((s) => {
      s.games.push(game);
      s.activeId = game.id;
    });
    e.target.reset();
    $('m-art-clear').click();
    go('games');
    toast(`Added ${name}`);
  });

  // -------------------------------------------------------------------------
  // Edit page (changes apply immediately, like Windows Settings)
  // -------------------------------------------------------------------------

  const editing = () => state.games.find((g) => g.id === editingId);

  function renderEdit() {
    const g = editing();
    if (!g) return;
    $('e-crumb').textContent = g.name;
    $('e-hero-name').textContent = g.name;
    $('e-hero-date').textContent = describeDate(g);
    $('e-hero-status').textContent = status(g);
    artStyle($('e-hero-art'), g.art);
    if (document.activeElement !== $('e-name')) $('e-name').value = g.name;

    const follow = g.dateSource === 'steam';
    $('e-follow-card').hidden = !g.steamAppId;
    $('e-follow').checked = follow;
    $('e-steam-date').textContent = g.rawDate ? `Steam currently says: ${g.rawDate}` : '';
    $('e-date-card').hidden = follow;
    const { date, time } = splitIso(g.releaseDate);
    if (document.activeElement !== $('e-date')) $('e-date').value = date;
    if (document.activeElement !== $('e-time')) $('e-time').value = time;

    renderArtPicker(g);
    $('e-show').disabled = g.id === state.activeId;
    $('e-show').textContent = g.id === state.activeId ? 'Showing' : 'Show';
    const del = $('e-delete');
    if (!del.dataset.armed) del.textContent = 'Remove';
  }

  const updateEditing = (fn) => {
    const id = editingId;
    return commit((s) => {
      const g = s.games.find((x) => x.id === id);
      if (g) fn(g);
    });
  };

  $('e-name').addEventListener('change', () => {
    const name = $('e-name').value.trim();
    if (name) updateEditing((g) => { g.name = name; });
  });

  function saveDate() {
    const date = $('e-date').value;
    if (!date) return;
    const time = $('e-time').value || '00:00';
    updateEditing((g) => {
      g.dateSource = 'manual';
      g.releaseDate = `${date}T${time}`;
      g.precision = 'day';
    });
  }
  $('e-date').addEventListener('change', saveDate);
  $('e-time').addEventListener('change', saveDate);

  $('e-follow').addEventListener('change', async () => {
    const g = editing();
    if (!g) return;
    if (!$('e-follow').checked) {
      // Keep whatever date Steam gave us as the starting point.
      return updateEditing((x) => {
        x.dateSource = 'manual';
        if (x.precision === 'unknown') x.releaseDate = null;
      });
    }
    try {
      const info = await SD.steamGame(g.steamAppId);
      await updateEditing((x) => {
        x.dateSource = 'steam';
        x.releaseDate = info.releaseDate;
        x.precision = info.precision;
        x.rawDate = info.rawDate;
      });
    } catch (err) {
      $('e-follow').checked = false;
      toast(errText(err), 'critical');
    }
  });

  // --- Art picker ---------------------------------------------------------

  const artCache = new Map(); // steamAppId -> { loading, options, logo, error }

  function loadArtOptions(g) {
    if (!g.steamAppId || artCache.has(g.steamAppId)) return;
    const entry = { loading: true, options: [], logo: null, error: null };
    artCache.set(g.steamAppId, entry);
    (async () => {
      try {
        const info = await SD.steamGame(g.steamAppId);
        Object.assign(entry, await SD.steamArtOptions(g.steamAppId, info.details));
      } catch (err) {
        entry.error = errText(err);
      }
      entry.loading = false;
      if (page === 'edit') render();
    })();
  }

  // The automatic pick is the first of these that exists (see SD.bestSteamArt).
  const AUTO_KINDS = ['hero', 'capsule', 'header'];

  function tileHtml({ id, label, thumb, logo, kind, checked }) {
    const showLogo = logo && ['hero', 'background', 'screenshot'].includes(kind);
    const bg = thumb ? `style="background-image:url('${escapeHtml(thumb).replace(/'/g, '%27')}')"` : '';
    return `
      <button class="art-tile" role="radio" aria-checked="${checked}" data-tile="${escapeHtml(id)}">
        <span class="art-img${thumb ? '' : ' placeholder-art'}" ${bg}>${showLogo ? `<img src="${escapeHtml(logo)}" alt="">` : ''}</span>
        <span class="art-label">${escapeHtml(label)}</span>
      </button>`;
  }

  function renderArtPicker(g) {
    const grid = $('e-art-grid');
    const choice = g.artChoice || 'auto';
    const tiles = [];
    let status = '';

    if (g.steamAppId) {
      loadArtOptions(g);
      const cache = artCache.get(g.steamAppId);
      const autoOpt = cache.options.find((o) => AUTO_KINDS.includes(o.kind));
      const autoThumb = choice === 'auto' ? g.art : autoOpt && autoOpt.url;
      const autoKind = choice === 'auto' ? g.artKind : autoOpt && autoOpt.kind;
      const autoLabel = { hero: 'Library art', capsule: 'Store capsule', header: 'Store header' }[autoKind];
      tiles.push({
        id: 'auto',
        label: autoLabel ? `Automatic · ${autoLabel}` : 'Automatic',
        thumb: autoThumb,
        logo: g.logo || cache.logo,
        kind: autoKind,
        checked: choice === 'auto',
      });
      cache.options.forEach((o, i) => tiles.push({
        id: `opt:${i}`,
        label: o.label,
        thumb: o.thumb,
        logo: cache.logo,
        kind: o.kind,
        checked: choice === 'picked' && g.art === o.url,
      }));
      if (cache.loading) status = '<span class="f-row"><span class="f-spinner"></span>Looking for art on Steam…</span>';
      else if (cache.error) status = escapeHtml(`Couldn't load Steam art: ${cache.error}`);
      else status = 'Automatic uses Steam library art when it exists and upgrades itself when Steam adds it (often close to launch).';
    } else {
      tiles.push({ id: 'default', label: 'Default', thumb: null, checked: choice !== 'custom' });
    }
    if (choice === 'custom') {
      tiles.push({ id: 'custom', label: 'Your image', thumb: g.art, checked: true });
    }

    const html = tiles.map(tileHtml).join('');
    if (grid.dataset.html !== html) {
      grid.innerHTML = html;
      grid.dataset.html = html;
    }
    $('e-art-status').innerHTML = status;
  }

  $('e-art-grid').addEventListener('click', async (e) => {
    const tile = e.target.closest('[data-tile]');
    const g = editing();
    if (!tile || !g) return;
    const id = tile.dataset.tile;
    if (id === 'custom') return;
    if (id === 'default') {
      return updateEditing((x) => Object.assign(x, { art: null, artKind: null, logo: null, artChoice: 'auto' }));
    }
    const cache = artCache.get(g.steamAppId);
    if (!cache) return;
    if (id === 'auto') {
      const opt = cache.options.find((o) => AUTO_KINDS.includes(o.kind));
      return updateEditing((x) => Object.assign(x, {
        art: opt ? opt.url : x.art,
        artKind: opt ? opt.kind : x.artKind,
        logo: cache.logo,
        artChoice: 'auto',
      }));
    }
    const opt = cache.options[Number(id.slice(4))];
    if (opt) {
      await updateEditing((x) => Object.assign(x, { art: opt.url, artKind: opt.kind, logo: cache.logo, artChoice: 'picked' }));
    }
  });

  $('e-art').addEventListener('change', async () => {
    const file = $('e-art').files[0];
    $('e-art').value = '';
    if (!file) return;
    try {
      const art = await SD.imageFileToDataUrl(file);
      await updateEditing((g) => Object.assign(g, { art, artKind: 'custom', artChoice: 'custom' }));
      toast('Art updated');
    } catch (err) {
      toast(errText(err), 'critical');
    }
  });

  $('e-show').addEventListener('click', () => commit((s) => { s.activeId = editingId; }));

  $('e-delete').addEventListener('click', async () => {
    const del = $('e-delete');
    const g = editing();
    if (!g) return;
    if (!del.dataset.armed) {
      del.dataset.armed = '1';
      del.textContent = 'Click again to remove';
      setTimeout(() => { del.dataset.armed = ''; del.textContent = 'Remove'; }, 4000);
      return;
    }
    del.dataset.armed = '';
    const id = g.id;
    await commit((s) => {
      s.games = s.games.filter((x) => x.id !== id);
      if (s.activeId === id) s.activeId = s.games[0]?.id ?? null;
    });
    go('games');
    toast(`Removed ${g.name}`);
  });

  // -------------------------------------------------------------------------
  // Widget page
  // -------------------------------------------------------------------------

  function renderWidget() {
    $('size').value = state.size;
    $('opacity').value = state.opacity ?? 1;
    syncOpacitySlider();
    $('opacity-value').textContent = `${Math.round((state.opacity ?? 1) * 100)}%`;
    $('accent').value = state.accent || SD.DEFAULT_ACCENT;
    $('seconds').checked = !!state.showSeconds;
    $('rotate').checked = !!state.rotate;
    $('rotate-seconds').value = String(state.rotateSeconds || 15);
    $('rotate-seconds').disabled = !state.rotate;
    $('lock').checked = !!state.lockPosition;
  }

  $('size').addEventListener('change', () => {
    const v = $('size').value;
    commit((s) => { s.size = v; });
  });
  $('opacity').addEventListener('input', () => {
    $('opacity-value').textContent = `${Math.round(Number($('opacity').value) * 100)}%`;
  });
  $('opacity').addEventListener('change', () => {
    const v = Number($('opacity').value);
    commit((s) => { s.opacity = v; });
  });
  $('accent').addEventListener('change', () => {
    const v = $('accent').value;
    commit((s) => { s.accent = v; });
  });
  $('accent-reset').addEventListener('click', () => commit((s) => { s.accent = SD.DEFAULT_ACCENT; }));
  $('seconds').addEventListener('change', () => {
    const v = $('seconds').checked;
    commit((s) => { s.showSeconds = v; });
  });
  $('rotate').addEventListener('change', () => {
    const v = $('rotate').checked;
    commit((s) => { s.rotate = v; });
  });
  $('rotate-seconds').addEventListener('change', () => {
    const v = Number($('rotate-seconds').value);
    commit((s) => { s.rotateSeconds = v; });
  });
  $('lock').addEventListener('change', () => {
    const v = $('lock').checked;
    commit((s) => { s.lockPosition = v; });
  });

  $('autostart').checked = await invoke('get_autostart');
  $('autostart').addEventListener('change', async () => {
    try {
      await invoke('set_autostart', { enabled: $('autostart').checked });
    } catch (err) {
      toast(`Couldn't change that: ${errText(err)}`, 'critical');
      $('autostart').checked = await invoke('get_autostart');
    }
  });
  listen('autostart-changed', (enabled) => { $('autostart').checked = !!enabled; });

  // -------------------------------------------------------------------------
  // About page
  // -------------------------------------------------------------------------

  // --- Updates: only ever installs when she clicks the button ------------

  let update = { currentVersion: '', version: null, notes: null };
  let updateBusy = false;

  function renderUpdate() {
    $('version').textContent = update.currentVersion ? `Version ${update.currentVersion}` : '';
    const btn = $('update-btn');
    const available = !!update.version;
    $('about-dot').hidden = !available;
    $('update-bar').hidden = !available;
    if (available) {
      $('update-title').textContent = `Version ${update.version} is available`;
      $('update-notes').textContent = update.notes ? update.notes.trim() : '';
    }
    if (!updateBusy) {
      btn.disabled = false;
      btn.classList.toggle('accent', available);
      btn.textContent = available ? 'Install and restart' : 'Check for updates';
    }
  }

  async function checkForUpdate({ quiet = false } = {}) {
    if (updateBusy) return;
    updateBusy = true;
    $('update-btn').disabled = true;
    $('update-btn').textContent = 'Checking…';
    $('update-spinner').hidden = false;
    try {
      update = await invoke('check_for_update');
      if (!update.version && !quiet) toast("You're up to date");
    } catch (err) {
      if (!quiet) toast(errText(err), 'critical');
    } finally {
      updateBusy = false;
      $('update-spinner').hidden = true;
      renderUpdate();
    }
  }

  async function installUpdate() {
    if (updateBusy) return;
    updateBusy = true;
    const btn = $('update-btn');
    btn.disabled = true;
    btn.textContent = 'Downloading…';
    $('update-spinner').hidden = false;
    try {
      await invoke('install_update'); // restarts the app on success
    } catch (err) {
      toast(errText(err), 'critical');
      updateBusy = false;
      $('update-spinner').hidden = true;
      renderUpdate();
    }
  }

  $('update-btn').addEventListener('click', () => (update.version ? installUpdate() : checkForUpdate()));
  listen('update-status', (info) => { update = info; renderUpdate(); });
  listen('update-progress', ({ downloaded, total }) => {
    if (total) $('update-btn').textContent = `Downloading… ${Math.round((downloaded / total) * 100)}%`;
  });
  listen('open-page', ({ page: to, check }) => {
    go(to);
    if (check) checkForUpdate();
  });

  try {
    update = await invoke('update_status');
  } catch {
    // Older backend / browser preview: leave the defaults.
  }
  renderUpdate();

  function renderAbout() {
    if (state.lastSteamRefresh) {
      const when = new Date(state.lastSteamRefresh);
      $('refresh-status').textContent = `Last checked ${when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. Checked automatically every few hours.`;
    }
  }

  $('refresh').addEventListener('click', async () => {
    $('refresh').disabled = true;
    $('refresh-spinner').hidden = false;
    try {
      const changed = await SD.refreshSteamDates();
      toast(changed ? 'Release dates updated from Steam' : 'Everything is already up to date');
    } catch (err) {
      toast(errText(err), 'critical');
    } finally {
      $('refresh').disabled = false;
      $('refresh-spinner').hidden = true;
    }
  });

  // -------------------------------------------------------------------------

  function render() {
    if (page === 'games') renderGames();
    if (page === 'edit') renderEdit();
    if (page === 'widget') renderWidget();
    if (page === 'about') renderAbout();
  }

  listen('state-changed', (next) => {
    state = SD.normalizeState(next);
    if (page === 'edit' && !editing()) go('games');
    else render();
  });

  setInterval(() => { if (page === 'games' || page === 'edit') render(); }, 60 * 1000);

  const params = new URLSearchParams(location.search);
  const startPage = params.get('page');
  go(startPage || (state.games.length ? 'games' : 'add'));
  if (params.get('check') === '1') checkForUpdate();
})();
