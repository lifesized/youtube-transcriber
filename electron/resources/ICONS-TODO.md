# Icon Assets

Design's friends-beta icons are committed here.

## Tray (menu bar)

Template images (black + alpha, `Template` suffix so macOS tints them):

- `trayTemplate.png` / `trayTemplate@2x.png` — running (18×18 pt)
- `trayStartingTemplate.png` / `trayStartingTemplate@2x.png` — starting
- `trayAlertTemplate.png` / `trayAlertTemplate@2x.png` — port in use / stopped / move

`scripts/generate-tray-icons.js` is obsolete and must not overwrite these.

## App icon

- `icon.icns` — `Transcriber.icns` from Design (dark tile + gold dot)
- `icon.png` — 1024 px PNG for dialogs and notifications in dev

`DARK_APP_ICON` in `electron/product-defaults.js` records this choice.
