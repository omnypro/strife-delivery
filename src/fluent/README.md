# Fluent Kit

A tiny, dependency-free Windows 11 (Fluent 2 / WinUI 3) look-alike for Tauri
and other webview apps. Plain CSS + one small script, no build step.

Designed to be lifted out of this repo as-is: nothing in here knows about
Strife Delivery. Open `gallery.html` in a browser to see every component in
light and dark.

## Files

| File | What it is |
| --- | --- |
| `fluent.css` | Tokens (WinUI colour/type values, light + dark) and components, all prefixed `f-` |
| `icons.js` | Line icons on a 24px grid, plus small helpers (`window.Fluent`) |
| `gallery.html` | Living reference / visual test page |

## Using it

```html
<link rel="stylesheet" href="fluent/fluent.css" />
<body class="f-app">
  …
  <script src="fluent/icons.js"></script>
  <script>
    Fluent.applyBackdrop();  // reads ?backdrop=mica|vibrancy|none
    Fluent.hydrate();        // turns <i data-icon="name"> into SVG icons
  </script>
</body>
```

### Native backdrop (Mica / vibrancy)

The page is transparent when `<body data-backdrop="mica">` or
`"vibrancy"`, so the native material shows through. The window has to
actually have that material. In Tauri v2:

```rust
use tauri::window::{Effect, EffectsBuilder};

WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html?backdrop=mica".into()))
    .transparent(true)
    .effects(EffectsBuilder::new().effect(Effect::Mica).build())
    .build()?;
```

Only enable it where it exists: Mica needs Windows 11 (build ≥ 22000; the
`windows-version` crate is an easy check), vibrancy (`Effect::Sidebar`) needs
macOS plus Tauri's `macos-private-api` feature. Everywhere else pass
`?backdrop=none` and the kit paints a solid Windows background instead.

## Components

- **Shell:** `.f-shell` > `.f-nav` (`.f-nav-header`, `.f-nav-item[aria-current=page]`, `.f-nav-spacer`) + `.f-content` > `.f-page`. Collapses to an icon rail under 760px.
- **Page header:** `.f-page-header` with `.f-title`, or `.f-breadcrumb.f-title` for sub-pages.
- **Setting cards:** `.f-section-title`, `.f-stack` > `.f-card` (`icon`, `.f-card-text` > `.f-card-title` + `.f-card-desc`, `.f-card-control`). Variants: `.clickable`, `.compact`, `.block`.
- **Buttons:** `.f-btn` (+ `.accent`, `.subtle`, `.icon`, `.danger`), `.f-link`.
- **Toggle switch:** `<label class="f-toggle" data-on="On" data-off="Off"><input type="checkbox"><i></i></label>`.
- **Checkbox:** `<label class="f-check"><input type="checkbox">Label</label>`.
- **Inputs:** `.f-input`, `.f-select`, `.f-field` (label + control), `.f-search`, `.f-file`, `.f-color`.
- **Slider:** `<input type="range" class="f-slider">` + `Fluent.bindSlider(el)` for the filled track.
- **Segmented control:** `.f-segmented` > `button[aria-pressed]`.
- **InfoBar:** `.f-infobar` (+ `.success`, `.caution`, `.critical`, `.info`); add `.f-toast` + `.show` for a transient one.
- **Misc:** `.f-thumb`, `.f-spinner`, `.f-row`, `.f-grow`, `.f-divider`, `.f-empty`, type ramp classes.

## Notes

- Colours are the default Windows 11 blue accent. Override `--f-accent*` on
  `:root` to theme it.
- Fonts fall back from Segoe UI Variable → SF Pro → system UI, so it reads
  "native-ish" on macOS/Linux too, but it is unapologetically a Windows look.
- Native right-click and tray menus should stay native (Tauri's `Menu` API),
  not be rebuilt in HTML.
