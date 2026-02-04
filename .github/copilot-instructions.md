# League Skin Selector - AI Agent Instructions

## Project Overview
**League Skin Selector** is an Electron desktop app + Express web server that interfaces with the League Client Update (LCU) API to enable in-game skin selection during champion select. The app monitors real-time game state and provides a UI for browsing and selecting skins/chromas.

### Architecture: Three-Layer Stack
1. **Electron Main** (`src/main/electron-main.ts`) - Window management, native app integration, auto-updates
2. **Express Server** (`src/main/server.ts`) - REST API, LCU orchestration, static file serving
3. **Browser Renderer** (`src/renderer/client.ts`) - React-less vanilla JS UI (DOM-driven, no build tools for renderer)

## Essential Patterns & Workflows

### Build & Run Commands
- **Development**: `npm run dev` (runs Express server with hot reload via `tsx`)
- **Full App**: `npm run electron` (builds everything, launches Electron window)
- **Production Build**: `npm run dist` (creates NSIS installer + portable exe via electron-builder)
- **Build Steps** (invoked by `npm run electron`):
  - `npm run build:main` - TypeScript compile to `dist/main/`
  - `npm run build:renderer` - esbuild bundles `src/renderer/client.ts` to single IIFE for browser
  - `npm run copy:static` - Copies HTML/CSS to `dist/renderer/`

### Architecture Decisions
- **No Module Bundler for Renderer**: Renderer uses esbuild (single IIFE bundle), NOT webpack/vite. If adding vendor deps to renderer, update the build step to include them in the esbuild config.
- **TypeScript Configs**: Three tsconfigs serve different purposes—`tsconfig.json` compiles main process, `tsconfig.client.json` compiles renderer (browser environment), `tsconfig.base.json` shares common settings.
- **Shared Type Definitions**: `src/shared/api-types.ts` defines all REST request/response payloads. Always add types here when modifying API endpoints.
- **LCU Connection**: Abstracted in `LCUConnector` class (`src/main/lcu-client.ts`). Uses `@hasagi/core` library which wraps Riot's LCU socket protocol. Connection lifecycle: auto-retry on disconnect via timer.
- **Graceful Shutdown**: Both Electron (`electron-main.ts`) and Express (`index.ts`) handle SIGINT/SIGTERM with cleanup routines (window state save, LCU disconnect).

### Code Location Conventions
- **Main Process Logic**: `src/main/` (all Node.js, has fs/path/electron access)
- **Renderer Logic**: `src/renderer/` (browser code, NO Node.js modules, IPC via `electronAPI`)
- **Shared (Browser + Node)**: `src/shared/` (TypeScript types, error handling, logging)
- **API Contracts**: `src/shared/api-types.ts` (REST payload shapes)
- **IPC Bridge**: `src/preload/preload.ts` (isolated context exposing `electronAPI` to renderer with methods for window control, file dialogs, and app updates—never expose dangerous APIs directly)

### LCU API Integration Details
- **Connection Mechanism**: `LCUConnector` parses League client process + connects via WebSocket to local LCU socket
- **Champion Data Flow**: 
  1. Fetches champion list on init (maps champion keys via DDragon API)
  2. Listens for champ-select state changes via LCU event subscriptions
  3. On selection, retrieves owned skins + chromas from LCU data dragon cache
  4. Exposes via REST `/api/skins/:championId`
- **Skin Selection**: POST `/api/select-skin` writes to LCU champ-select session object (modifies local `mySelection.selectedSkinId`)

### Testing & Validation
- **Linting**: `npm run lint` (ESLint + TypeScript checks). Use `npm run lint:fix` for auto-fixes.
- **Pre-commit Hooks**: Configured via husky + lint-staged in `package.json` - auto-lints *.ts/*.js and HTML files before commit.
- **No Unit Tests**: Project currently lacks Jest/Vitest setup. If adding tests, create `src/tests/` and update tsconfig.

## Common Pitfalls
- **THIS IS A TYPESCRIPT/JAVASCRIPT PROJECT - DO NOT USE PYTHON TOOLS** - No Python is used anywhere. Use Node.js tools and npm commands only.
- **Use `this.logger` not `console.log`** in `server.ts` for consistency
- **Don't add Node.js imports** in `src/renderer/` code—use IPC via `electronAPI`
- **Always update `api-types.ts`** when adding or modifying API endpoints
- **Test HTML closing tags** in `index.html`—previous bugs found with mismatched `</div>`
- **Avoid dynamic `require()`** in `server.ts`—use static ES6 imports at the top

## Anti-Patterns to Avoid
- Don't use webpack/vite for renderer—only esbuild (single-file bundle)
- Don't add React/Vue—vanilla JS only for renderer
- Don't call LCU directly from renderer code—route through Express API endpoints
- Don't modify `package.json` scripts without understanding the three-layer build process
- Don't expose sensitive `electronAPI` methods (like unchecked file system access) in preload

## Common Workflows

### Adding a New API Endpoint
1. Define request/response types in `src/shared/api-types.ts`
2. Add route handler in `src/main/server.ts` (use `this.logger` not `console.log`)
3. Call from renderer via `fetch('/api/endpoint-name')` in `src/renderer/client.ts`

### Modifying Renderer UI
- Edit `src/renderer/client.ts` (single-file UI controller) and `src/renderer/index.html`
- Build with `npm run build:renderer` (produces single JS bundle, no bundler config needed)
- No CSS framework used - plain CSS in `src/renderer/style.css`

### Handling LCU Disconnections
- Monitor `LCUConnector.isConnected()` status polling (server does `/api/status` polling)
- Renderer polls status every 2000ms (`STATUS_POLL_INTERVAL_MS`)
- Auto-reconnect handled by `LCUConnector` timer-based retry logic

## Known Issues & Constraints
- **HTML Structure**: Ensure closing `</div>` tags match opening in `index.html` (previous bugs found here)
- **Error Message Deduplication**: `getErrorMessage()` defined in both `src/shared/errors.ts` and renderer - import from shared when modifying
- **Console vs Logger**: Prefer `this.logger` in `server.ts` over `console.log` for consistency
- **Dynamic Requires**: Avoid `require()` inside methods in `server.ts` - use static ES6 imports at top

## Performance & Key Metrics
- Status polling interval: 2000ms (configurable via `STATUS_POLL_INTERVAL_MS`)
- LCU connection retry: 5000ms between attempts
- Auto-select delay: 500ms (`AUTO_SELECT_DELAY_MS`)
- Electron window minimum size: 900x640 (enforced)

## Dependencies to Know
- **@hasagi/core**: LCU API wrapper - used for all League client communication
- **axios**: HTTP client for DDragon API calls (champion/skin data)
- **express**: Web server framework
- **electron-updater**: Auto-update mechanism for desktop app
- **esbuild**: Renderer bundler (not webpack - single-file output)

## File Structure Reference
```
src/main/
  ├─ electron-main.ts    → Electron window lifecycle, IPC handlers
  ├─ index.ts            → Server startup + graceful shutdown
  ├─ server.ts           → Express app, REST endpoints, QR code generation
  ├─ lcu-client.ts       → LCU connection abstraction, champion/skin queries
  └─ portable-updater.ts → Portable EXE auto-update logic

src/renderer/
  ├─ client.ts           → Vanilla JS UI controller
  ├─ index.html          → Single-page app template
  └─ style.css           → App styling

src/shared/
  ├─ api-types.ts        → REST API type definitions
  ├─ errors.ts           → Error utility functions (errors.js is a build artifact)
  └─ logger.ts           → Logging abstraction
```
