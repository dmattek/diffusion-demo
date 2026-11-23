# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a self-contained molecular diffusion simulator for teaching systems biology that demonstrates Brownian motion and diffusion physics through interactive visualization.

## File Structure

- `index.html`: Main HTML structure with canvas elements and controls
- `styles.css`: All styling for the application
- `app.js`: JavaScript logic for physics simulation and visualization
- `build.sh`: Builds the single-file distributable `dist/diff_simulator.html` by inlining `styles.css` and `app.js` into `index.html`
- `dist/`: Build output (git-ignored; regenerate with `./build.sh`, never edit by hand)
- `make_gif.sh`: Regenerates `docs/diffusion.gif` (shown in README.md) via headless Chrome screenshots of a patched copy of the built page (seeded RNG, runs N steps from the URL hash, draws one frame). It patches the `resize(); initParticles('center'); animate();` block at the end of `app.js`; if that block changes, update the script
- `README.md`: Project description, GIF and link to the hosted demo

## Architecture

**Modular structure**: The application is split into HTML, CSS, and JavaScript files for better organization. There are no dependencies or external libraries; the only build step is the optional `build.sh` (needs `python3`).

**Three-canvas visualization**:
- `boxCanvas`: 2D particle simulation box showing particles diffusing in real-time
- `histCanvas`: Probability density histogram P(x) along x, overlaid with the theoretical density (Gaussian of variance 2Dt plus boundary images, integrated per bin)
- `msdCanvas`: 1D mean squared displacement ⟨Δx²⟩ vs free theory (2Dt) and, for reflective walls, the exact confined-box theory

**Physics simulation**:
- Particles undergo Brownian motion using Gaussian random walk: `stepX = gaussianRandom() * sqrt(2 * D * dt)`
- Two boundary conditions: reflective (particles bounce) or periodic (particles wrap around)
- MSD: reflective uses the real displacement `p.x - p.x0` (saturates at the box size); periodic uses the unwrapped position `p.ux - p.x0`
- `freeVar` accumulates ∫2D dt, so theory stays correct when D is changed mid-run
- Confined MSD theory: cosine-series solution with time-independent coefficients precomputed in `precomputeConfinedSeries()`
- Changing N, boundary type or window size restarts the run (`initParticles()`)
- `stepsPerFrame` slider runs several simulation steps per animation frame

**State management**:
- Global variables track simulation state: `particles[]` (`{x, y, x0, ux}`), `time`, `freeVar`, `msdHistory[]`, `recordStride`, `initMode`, `boundaryType`, `isRunning`
- `msdHistory` is thinned (every other point dropped, `recordStride` doubled) instead of truncated, so the MSD plot always starts at t = 0
- Animation loop runs continuously via `requestAnimationFrame`, updating only when `isRunning === true`
- Responsive canvas sizing with device pixel ratio scaling for crisp rendering

## Running the Application

Simply open `index.html` in a web browser. No build step or server required for development.

To produce a single HTML file for distribution (e-mail, ILIAS/Moodle upload, student download), run `./build.sh`; the output is `dist/diff_simulator.html`. If you add another stylesheet or script to `index.html`, add it to the inline list in `build.sh` too. Otherwise the built file silently keeps an external reference and breaks when distributed alone. (The build only fails in the other direction: a file listed in `build.sh` whose tag isn't in `index.html` exactly once.)

## Key Implementation Details

**Canvas scaling**: All three canvases use `devicePixelRatio` scaling for high-DPI displays (see `setupCanvas()`)

**MSD calculation**: Only the x-direction displacement is tracked (1D MSD, theory 2Dt, not 4Dt)

**Histogram normalization**: Measured density is `b / (total * binWidth)` (1/px); theory uses the same units and the plot shares one scale
