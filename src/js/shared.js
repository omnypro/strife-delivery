// Shared helpers for the widget and settings windows.
// Loaded as a plain script; everything hangs off window.SD.
(function () {
  const tauri = window.__TAURI__;
  const invoke = (cmd, args) => tauri.core.invoke(cmd, args);
  const listen = (event, cb) => tauri.event.listen(event, (e) => cb(e.payload));

  const SIZES = {
    s: { width: 320, height: 190, label: 'Small' },
    m: { width: 404, height: 239, label: 'Medium' },
    l: { width: 500, height: 294, label: 'Large' },
  };

  const DEFAULT_ACCENT = '#5ef0b8';

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function defaultState() {
    return {
      version: 1,
      games: [],
      activeId: null,
      size: 'm',
      opacity: 1,
      accent: DEFAULT_ACCENT,
      showSeconds: true,
      rotate: false,
      rotateSeconds: 15,
      lockPosition: false,
      lastSteamRefresh: null,
    };
  }

  function normalizeState(s) {
    const base = defaultState();
    if (!s || typeof s !== 'object') return base;
    const out = { ...base, ...s };
    if (!Array.isArray(out.games)) out.games = [];
    for (const g of out.games) {
      if (!g.artChoice) g.artChoice = g.customArt ? 'custom' : 'auto';
      delete g.customArt;
    }
    if (!SIZES[out.size]) out.size = 'm';
    if (out.games.length && !out.games.some((g) => g.id === out.activeId)) {
      out.activeId = out.games[0].id;
    }
    return out;
  }

  async function loadState() {
    const raw = await invoke('load_state');
    const state = normalizeState(raw);
    if (!raw) {
      state.firstRun = true;
      await invoke('save_state', { state });
    }
    return state;
  }

  const saveState = (state) => invoke('save_state', { state });

  // ---------------------------------------------------------------------
  // Dates
  // ---------------------------------------------------------------------

  const MONTHS = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];

  function monthIndex(word) {
    const w = word.toLowerCase().replace(/\.$/, '');
    if (w.length < 3) return -1;
    return MONTHS.findIndex((m) => m.startsWith(w) || (w === 'sept' && m === 'september'));
  }

  const pad = (n) => String(n).padStart(2, '0');
  const isoLocal = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}T00:00`;

  /**
   * Turn a Steam release-date string into { releaseDate, precision }.
   * Handles "Apr 8, 2027", "8 Apr, 2027", "April 2027", "Q2 2027",
   * "2027", and "Coming soon"/"To be announced" (precision "unknown").
   * Non-exact dates point at the earliest possible day.
   */
  function parseSteamDate(input) {
    const s = String(input || '').trim().replace(/\s+/g, ' ');
    let m;

    if ((m = s.match(/^([A-Za-z]+)\.? (\d{1,2}),? (\d{4})$/))) {
      const mi = monthIndex(m[1]);
      if (mi >= 0) return { releaseDate: isoLocal(+m[3], mi, +m[2]), precision: 'day' };
    }
    if ((m = s.match(/^(\d{1,2}) ([A-Za-z]+)\.?,? (\d{4})$/))) {
      const mi = monthIndex(m[2]);
      if (mi >= 0) return { releaseDate: isoLocal(+m[3], mi, +m[1]), precision: 'day' };
    }
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
      return { releaseDate: isoLocal(+m[1], +m[2] - 1, +m[3]), precision: 'day' };
    }
    if ((m = s.match(/^([A-Za-z]+),? (\d{4})$/))) {
      const mi = monthIndex(m[1]);
      if (mi >= 0) return { releaseDate: isoLocal(+m[2], mi, 1), precision: 'month' };
    }
    if ((m = s.match(/^Q([1-4]),? (\d{4})$/i))) {
      return { releaseDate: isoLocal(+m[2], (+m[1] - 1) * 3, 1), precision: 'quarter' };
    }
    if ((m = s.match(/^(\d{4})$/))) {
      return { releaseDate: isoLocal(+m[1], 0, 1), precision: 'year' };
    }
    return { releaseDate: null, precision: 'unknown' };
  }

  // "2027-04-08T00:00" -> local Date (no timezone shifting).
  function toDate(iso) {
    if (!iso) return null;
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  }

  function describeDate(game) {
    const d = toDate(game.releaseDate);
    if (!d || game.precision === 'unknown') return game.rawDate || 'Date TBA';
    switch (game.precision) {
      case 'month':
        return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      case 'quarter':
        return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
      case 'year':
        return String(d.getFullYear());
      default: {
        const opts = { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' };
        const hasTime = d.getHours() || d.getMinutes();
        const date = d.toLocaleDateString(undefined, opts);
        return hasTime
          ? `${date} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
          : date;
      }
    }
  }

  /** Remaining time until release, or null if there's no usable date. */
  function countdown(game, now = new Date()) {
    const d = toDate(game.releaseDate);
    if (!d || game.precision === 'unknown') return null;
    const ms = d - now;
    const released = ms <= 0;
    const abs = Math.abs(ms);
    const total = Math.floor(abs / 1000);
    return {
      released,
      approximate: game.precision !== 'day',
      days: Math.floor(total / 86400),
      hours: Math.floor((total % 86400) / 3600),
      minutes: Math.floor((total % 3600) / 60),
      seconds: total % 60,
    };
  }

  // ---------------------------------------------------------------------
  // Steam
  // ---------------------------------------------------------------------

  async function steamGame(appid) {
    const details = await invoke('steam_details', { appid: Number(appid) });
    const rel = details.releaseDate || {};
    const parsed = parseSteamDate(rel.date);
    return {
      name: details.name,
      steamAppId: Number(appid),
      rawDate: rel.date || (rel.coming_soon ? 'Coming soon' : ''),
      details,
      ...parsed,
    };
  }

  // ---------------------------------------------------------------------
  // Steam art
  //
  // The store API only hands out the small header (460x215), screenshots and
  // page backgrounds. The nicer library art (wide hero, transparent logo, big
  // capsule) lives at predictable CDN paths *for most games*, but newer
  // uploads sit behind hashed paths and unreleased games often don't have
  // library art yet, so every guess is probed and we fall back gracefully.
  // ---------------------------------------------------------------------

  const CDN_BASES = [
    'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps',
    'https://cdn.akamai.steamstatic.com/steam/apps',
  ];

  // Art kinds that don't already have the game's logo painted on them, so the
  // widget overlays the transparent logo instead of the plain-text title.
  const LOGO_FRIENDLY = new Set(['hero', 'background', 'screenshot']);
  const showsLogo = (game) => !!(game && game.logo && LOGO_FRIENDLY.has(game.artKind));

  /** Resolve with {width, height} if the image loads, else null. */
  function probeImage(url, timeoutMs = 8000) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      const timer = setTimeout(() => { img.src = ''; resolve(null); }, timeoutMs);
      img.onload = () => { clearTimeout(timer); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = url;
    });
  }

  /** First CDN URL for `file` that actually loads (and is at least minWidth wide). */
  async function findCdnAsset(appid, file, minWidth = 1) {
    for (const base of CDN_BASES) {
      const url = `${base}/${appid}/${file}`;
      const size = await probeImage(url);
      if (size && size.width >= minWidth) return url;
    }
    return null;
  }

  /** Every usable image for a Steam game, best first. */
  async function steamArtOptions(appid, details) {
    const [hero, capsule, logo] = await Promise.all([
      findCdnAsset(appid, 'library_hero.jpg', 900),
      findCdnAsset(appid, 'capsule_616x353.jpg', 600),
      findCdnAsset(appid, 'logo.png'),
    ]);
    const options = [];
    if (hero) options.push({ kind: 'hero', label: 'Library art', url: hero, thumb: hero });
    if (capsule) options.push({ kind: 'capsule', label: 'Store capsule', url: capsule, thumb: capsule });
    if (details.headerImage) {
      options.push({ kind: 'header', label: 'Store header', url: details.headerImage, thumb: details.headerImage });
    }
    const bgs = [
      ['backgroundRaw', 'Store background'],
      ['background', 'Store background (tinted)'],
    ];
    for (const [key, label] of bgs) {
      if (details[key] && (await probeImage(details[key]))) {
        options.push({ kind: 'background', label, url: details[key], thumb: details[key] });
      }
    }
    (details.screenshots || []).forEach((shot, i) => {
      if (shot && shot.full) {
        options.push({ kind: 'screenshot', label: `Screenshot ${i + 1}`, url: shot.full, thumb: shot.thumb || shot.full });
      }
    });
    return { options, logo };
  }

  /** The automatic pick: library hero, then big capsule, then the header. */
  async function bestSteamArt(appid, details) {
    const [hero, logo] = await Promise.all([
      findCdnAsset(appid, 'library_hero.jpg', 900),
      findCdnAsset(appid, 'logo.png'),
    ]);
    if (hero) return { art: hero, artKind: 'hero', logo };
    const capsule = await findCdnAsset(appid, 'capsule_616x353.jpg', 600);
    if (capsule) return { art: capsule, artKind: 'capsule', logo };
    if (details.headerImage) return { art: details.headerImage, artKind: 'header', logo };
    return { art: null, artKind: null, logo };
  }

  /**
   * Re-check Steam for every Steam game: release dates (if the game follows
   * Steam) and art (if it's on "Automatic", so library art that shows up near
   * launch gets picked up). Returns true if anything changed.
   */
  async function refreshSteamDates() {
    const snapshot = normalizeState(await invoke('load_state'));
    const updates = new Map();
    for (const game of snapshot.games) {
      if (!game.steamAppId) continue;
      const followsDate = game.dateSource === 'steam';
      const autoArt = (game.artChoice || 'auto') === 'auto';
      if (!followsDate && !autoArt) continue;
      try {
        const fresh = await steamGame(game.steamAppId);
        const upd = {};
        if (followsDate && fresh.rawDate && fresh.rawDate !== game.rawDate) {
          Object.assign(upd, { rawDate: fresh.rawDate, releaseDate: fresh.releaseDate, precision: fresh.precision });
        }
        if (autoArt) {
          const art = await bestSteamArt(game.steamAppId, fresh.details);
          if (art.art && (art.art !== game.art || art.logo !== game.logo)) Object.assign(upd, art);
        }
        if (Object.keys(upd).length) updates.set(game.id, upd);
      } catch (err) {
        console.warn('Steam refresh failed for', game.name, err);
      }
    }
    // Re-read so we don't clobber edits made while we were fetching, and
    // only apply what the user hasn't since taken control of.
    const latest = normalizeState(await invoke('load_state'));
    for (const g of latest.games) {
      const upd = updates.get(g.id);
      if (!upd) continue;
      if (g.dateSource === 'steam' && 'rawDate' in upd) {
        Object.assign(g, { rawDate: upd.rawDate, releaseDate: upd.releaseDate, precision: upd.precision });
      }
      if ((g.artChoice || 'auto') === 'auto' && 'art' in upd) {
        Object.assign(g, { art: upd.art, artKind: upd.artKind, logo: upd.logo });
      }
    }
    latest.lastSteamRefresh = new Date().toISOString();
    await saveState(latest);
    return updates.size > 0;
  }

  // ---------------------------------------------------------------------
  // Images
  // ---------------------------------------------------------------------

  /** Read an uploaded image and shrink it so state.json stays small. */
  function imageFileToDataUrl(file, maxSide = 1000) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Couldn't read that file"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("That doesn't look like an image"));
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          let url = canvas.toDataURL('image/webp', 0.88);
          if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.88);
          resolve(url);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  window.SD = {
    invoke, listen, SIZES, DEFAULT_ACCENT, uid,
    defaultState, normalizeState, loadState, saveState,
    parseSteamDate, toDate, describeDate, countdown,
    steamGame, steamArtOptions, bestSteamArt, showsLogo, probeImage,
    refreshSteamDates, imageFileToDataUrl, escapeHtml,
  };
})();
