# Guitar Tuner

A web-based tuner for guitar and ukulele with real-time pitch detection.

## Features

- **Pitch Detection** — YIN algorithm for accurate frequency detection from microphone input
- **Dual Instrument** — Switch between Guitar (E-A-D-G-B-E) and Ukulele (G-C-E-A)
- **Visual Meter** — Semicircular gauge showing cents deviation with color-coded zones
- **Waveform Display** — Real-time audio waveform visualization
- **Dark/Light Theme** — Auto-follows system preference, manual toggle available
- **Auto-start** — Remembers microphone permission, starts listening automatically
- **Mobile-first** — Responsive layout optimized for phones

## Tech Stack

- Vanilla HTML/CSS/JavaScript (no framework)
- Web Audio API for microphone capture
- Canvas API for visual rendering
- Vite for development

## Getting Started

```bash
npm install
npm run dev
```

Open the displayed URL in Chrome/Edge and grant microphone access.

## Build

```bash
npm run build
npm run preview
```

## License

MIT
