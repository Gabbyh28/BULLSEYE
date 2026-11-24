# 🎯 BULLSEYE — Darts Scoring Arena

A live darts scorer with a hand-built, animated dartboard. Tap exactly where each dart lands. BULLSEYE scores it, suggests checkouts, calls the big moments and keeps lifetime stats.

## Features

- **8 game modes:** 501 · 301 · 701 (optional double-out), Cricket, Around the Clock, Shanghai, Killer, High Score
- **Formats:** single game, legs & sets (rotating starter), knockout tournament with byes and a live bracket
- **Two ways to score:** tap the board (hover/drag-to-aim preview with a touch loupe) or use the S/D/T keypad
- **Checkout routes** for every finish up to 170, aware of how many darts are left
- **Undo anything:** darts, turns, even a leg-winning dart
- **Callouts:** 180, ton-plus, bust, game shot, Shanghai, Killer, plus confetti, synthesised sound effects and an optional caller voice
- **6 arenas:** Championship, Neon Night, Old Tavern, Daylight, Carbon Blaze and Candy Royale. Each restyles the room and the board.
- **Stats:** 3-dart average, 180s / 140+ / 100+, best turn, top checkout, treble rate, time per turn, a landing heatmap, favourite beds and match history
- **Hebrew (RTL) and English**, mobile-first layout, fullscreen, autosave and resume

## Run it

It is a static site with no build step and no dependencies:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. To deploy, enable GitHub Pages on the branch, or drop the folder on any static host.

## Code map

| File | What it does |
| --- | --- |
| `js/engine.js` | Pure rules engine: board geometry, all game modes, checkouts, legs/sets, brackets |
| `js/board.js` | SVG dartboard: sisal texture, raised wires, lighting, dart flight animation, heatmap |
| `js/app.js` | Screens (lobby, live game, results, stats) and game flow |
| `js/fx.js` | Web Audio sound effects, caller voice, confetti, callouts |
| `js/storage.js` | localStorage persistence and lifetime player stats |
| `js/i18n.js` | Hebrew / English strings |
| `css/styles.css` | Themes, layout and motion |
