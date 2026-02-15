# Changelog

All notable changes to this project will be documented in this file.

## [1.5.0] - 2026-02-15

### Added
- Skin favorites system with localStorage persistence
- Keyboard shortcuts for quick skin selection (1-9)
- Skin preview modal with full-size loading screen art
- Skeleton loaders while fetching skin data
- QR code generation for mobile access
- Ready check accept button
- Auto-pick random skin feature
- Chroma support and selection
- Mobile-responsive UI improvements

### Fixed
- HTML structure with proper closing tags
- Settings menu icon positioning on mobile (now properly aligned right)
- Duplicate `getErrorMessage` function removed

### Changed
- Improved error handling throughout the application
- Consistent logger usage in server code
- Graceful shutdown handling for Electron and Express
- Shared TypeScript types for API contracts

### Technical
- Migrated to TypeScript across the entire codebase
- Added ESLint with pre-commit hooks (husky + lint-staged)
- Implemented three-layer architecture (Electron + Express + Renderer)
- Integrated @hasagi/core for LCU API communication
- Added electron-updater for automatic updates
