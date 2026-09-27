# Strife Delivery

A little desktop widget that counts down to the games you're waiting on.
Built for Heather, who wanted a countdown to **Final Fantasy VII Revelation**
that just *sits on the desktop* so she can't forget about it.

- Lives on the desktop like a macOS widget: transparent, frameless, sits
  *behind* your windows, no taskbar button.
- Drag it anywhere; it remembers where you put it (or lock it in place).
- Add games by searching Steam (release date + art filled in automatically), or
  add anything manually (console exclusives, games not on Steam yet).
- Art is picked automatically: Steam's library cover when it exists (and it
  upgrades itself when Steam adds it near launch), falling back to store art.
  Or pick from store art, backgrounds and screenshots, or upload your own.
- Steam release dates are re-checked every few hours, so delays show up on
  their own.
- Understands vague dates ("Q2 2027", "April 2027", "Coming soon").
- Starts when you log in (on by default, toggle in the tray menu).

## Using it

| Do this | To |
| --- | --- |
| Drag the widget | Move it |
| Double-click the widget | Open **Manage games** |
| Right-click the widget or tray icon | Menu: manage, next game, lock position, start at login, reset position, quit |
| Left-click the tray icon | Open **Manage games** |

If the widget ever goes missing (e.g. after unplugging a monitor), use
**Reset widget position** from the tray menu.

> **Heads-up:** Windows' "Show desktop" (Win+D) hides the widget along with
> everything else. Click the tray icon → **Show widget** to bring it back.

## Installing (Windows)

Grab the `…_x64-setup.exe` from the latest
[release](../../releases/latest) and run it. It installs per-user (no admin).
The app isn't code-signed, so SmartScreen will say it's unrecognised; click
**More info → Run anyway**.

## Developing

Requirements: [Bun](https://bun.sh), Rust (stable), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```sh
bun install
bun run dev      # run the app
bun run build    # build installers for the current OS
bun run icons    # regenerate icons from assets/icon.svg
```

The frontend is plain HTML/CSS/JS in `src/` (no bundler). The countdown is set
in [Sometype Mono](https://github.com/googlefonts/sometype-mono) and the text in
[Optician Sans](https://github.com/anewtypeofinterference/Optician-Sans), both
bundled under the SIL Open Font License. The Manage window
is built on [`src/fluent/`](src/fluent/README.md), a small reusable
Windows 11-style component kit (open `src/fluent/gallery.html` to browse it). The Rust side in
`src-tauri/` handles the tray, menus, Steam requests (to avoid CORS), start at
login, and saving state to `state.json` in the app config folder.

### Updates

The app never updates itself on its own. It quietly *checks* GitHub Releases
at startup and every 12 hours; if there's a newer version the tray menu's
**Check for updates…** turns into **Update available (vX)…** and the About
page shows an **Install and restart** button. Updates are signed; the public
key lives in `src-tauri/tauri.conf.json`.

CI needs two repository secrets to produce signed updates:

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password |

Without them CI still builds installers, just without update files. **Never
commit the private key.** If it's lost, existing installs can't verify new
updates, so keep a backup somewhere safe (e.g. a password manager).

The updater reads `releases/latest/download/latest.json`, so the repository
(or at least its releases) must be public.

### Releasing

CI builds on every push (Windows + macOS installers are attached to the
workflow run as artifacts). Push a `v*` tag to publish a GitHub Release:

```sh
# bump "version" in package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json first
git tag v0.1.0 && git push origin v0.1.0
```

Release dates come from Steam's public store API. Not affiliated with Valve or
Square Enix.
