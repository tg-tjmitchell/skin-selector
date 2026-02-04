# League Skin Selector - TODO

## 🐛 Bug Fixes

- [x] **Fix HTML structure** - Missing closing `</div>` tags in `index.html` (monitor-section not properly closed, malformed closing structure at bottom)
- [x] **Remove duplicate `getErrorMessage` function** - Renderer has its own copy instead of importing from shared

## 🔧 Code Quality Improvements

- [x] **Replace dynamic `require()` with ES6 imports** - `server.ts` uses `require("express")` inside methods instead of static imports
- [x] **Remove unused `_onReconnect` parameter** - `connect()` method in `lcu-client.ts` has unused parameter
- [x] **Use logger consistently** - `server.ts` mixes `console.log` and `this.logger`
- [x] **Add error handling for `startServer()`** - `index.ts` doesn't handle potential rejection from `void startServer()`

## 🚀 Feature Enhancements

- [x] **Add skin favorites/preferences** - Store user's favorite skins per champion in localStorage or config file. Auto-pick now picks from favorites only when enabled and is greyed out when no favorites exist.
- [ ] **Add skin search/filter** - Allow filtering skins by name in the UI
- [x] **Add keyboard shortcuts** - Quick skin selection with number keys
- [x] **Add skin preview enlargement** - Click to see full-size skin loading art

## 🏗️ Architecture Improvements

- [x] **Add shared TypeScript types for API** - Create shared types between client and server for API payloads
- [ ] **Add environment configuration** - Use `.env` file for configurable options (port, auto-connect delay, etc.)
- [x] **Improve shutdown handling** - Make `electron-main.ts` shutdown logic more robust

## 🎨 UI/UX Improvements

- [ ] **Add loading states** - Show skeleton loaders while skins are being fetched
- [ ] **Add skin selection confirmation** - Visual feedback when a skin is successfully applied
- [ ] **Improve mobile responsiveness** - QR code feature suggests mobile access, ensure UI works well on small screens
- [ ] **Add dark/light theme toggle** - User preference for UI theme

## 📦 Build & Configuration

- [ ] **Complete electron-builder config** - Add icons, app name, and other metadata in `package.json`
- [x] **Add pre-commit hooks** - Add husky + lint-staged for automated linting before commits
- [ ] **Add unit tests** - Set up Jest or Vitest for testing
