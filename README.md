# 🎯 BULLSEYE — Darts Scoring Arena

A live darts scorer with a real-time 3D dartboard (WebGL, falling back to a hand-built SVG board). Tap exactly where each dart lands. BULLSEYE scores it, suggests checkouts, calls the big moments and keeps lifetime stats.

## Features

- **8 game modes:** 501 · 301 · 701 (optional double-out), Cricket, Around the Clock, Shanghai, Killer, High Score
- **Formats:** single game, legs & sets (rotating starter), knockout tournament with byes and a live bracket
- **Two ways to score:** tap the board (hover/drag-to-aim preview with a touch loupe) or use the S/D/T keypad
- **Checkout routes** for every finish up to 170, aware of how many darts are left
- **Undo anything:** darts, turns, even a leg-winning dart
- **Callouts:** 180, ton-plus, bust, game shot, Shanghai, Killer, plus confetti, synthesised sound effects and an optional caller voice
- **6 arenas:** Championship, Neon Night, Old Tavern, Daylight, Carbon Blaze and Candy Royale. Each restyles the room and the board.
- **Stats:** 3-dart average with a per-leg trend chart, checkout % (darts at a double), head-to-head records, recent form, 180s / 140+ / 100+, best turn, top checkout, treble rate, time per turn, a landing heatmap, favourite beds and match history
- **Back up & restore:** save players, photos, stats and history to a file and load them on any device
- **Player photos:** tap an avatar to add a photo (or take one on a phone); it shows on the scoreboard, results, stats and winner banner
- **Hebrew (RTL) and English**, mobile-first layout, fullscreen, autosave and resume

## Run it

It is a static site with no build step. three.js is vendored in `vendor/three` (MIT), so nothing loads from a CDN:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. To deploy, enable GitHub Pages on the branch, or drop the folder on any static host.

## Tests

The rules engine has a test suite (Node 18+, no dependencies). GitHub runs it on every push and pull request.

```bash
npm test
```

## Code map

| File | What it does |
| --- | --- |
| `js/engine.js` | Pure rules engine: board geometry, all game modes, checkouts, legs/sets, brackets |
| `js/board3d.js` | 3D board (three.js): PBR sisal and chrome spider, LED surround, spotlights with beams, cached shadows, adaptive resolution, flying 3D darts |
| `js/hand.js` | Rigged hand for the winning-dart cinematic, posed into a dart grip with forward kinematics and a small IK pinch |
| `js/board.js` | 2D SVG board: fallback without WebGL, and the stats heatmap |
| `js/app.js` | Screens (lobby, live game, results, stats) and game flow |
| `js/fx.js` | Web Audio sound effects, caller voice, confetti, callouts |
| `js/storage.js` | localStorage persistence and lifetime player stats |
| `js/i18n.js` | Hebrew / English strings |
| `tests/engine.test.mjs` | Rules-engine tests: board geometry, checkouts, every game mode, formats, undo safety |
| `tests/storage.test.mjs` | Checkout %, head-to-head, backup round trip, and cleaning of hostile backup files |
| `css/styles.css` | Themes, layout and motion |

## Credits

- [three.js](https://threejs.org) (MIT), vendored in `vendor/three`.
- Hand model: `generic-hand` from the [WebXR Input Profiles](https://github.com/immersive-web/webxr-input-profiles) project (MIT, © Amazon), in `assets/hand` with its licence.
- "Olé" sound clip from the original Darts Arena site.
