# Changelog

## [v1.5.0] - 2025-05-21

### :bug: Bugfixes
- Remove invalid `RotationSystem.update(this.player.rotation)` call; now always pass full state object per API

**What:**
- Deleted an incorrect call to `RotationSystem.update` that passed only the player rotation value instead of the required state object.

**Why:**
- Duplicate and invalid API usage could break core game logic, especially flip tracking and landing detection.
- The correct update calls were already handled in the same function, so the extra/bad call was unnecessary and harmful.

**How:**
- Removed the invalid call and verified all remaining usages pass the full required object (`{ grounded, currentAngle, deltaRotation }`).
- Added a note to `llm-notes.md` to prevent similar mistakes in the future.

All notable changes to Bitstream Bluffs will be documented in this file.

## [v1.2.0] - 2025-05-20

### 🏗️ Architecture
- ✨ Feature: Implemented modular architecture for improved maintainability
  - Created four core modules:
    - **InputController**: Unified handling for keyboard and gamepad input
    - **TerrainManager**: Procedural terrain generation and physics
    - **HudDisplay**: UI elements and visual effects management
    - **CollectibleManager**: Item spawning and collection handling
  - Added comprehensive JSDoc documentation for all modules
  - Created unit tests for modular components
  - Added mode selection to switch between original and modular implementations

### 📚 Documentation
- Added MIGRATION_GUIDE.md with detailed instructions for the modular architecture
- Enhanced code documentation with comprehensive JSDoc comments

### 🧪 Testing
- Added unit test framework for testing modules in isolation
- Created basic module integrity tests

## [v1.1.0] - 2025-05-18

### ✅ Added
- Comprehensive gameplay tests (two implementations):
  - **Puppeteer MCP-based tests** (recommended) for direct browser control
  - Standard Puppeteer tests using Mocha (alternative option)
- Advanced test suite covering core game mechanics:
  - Seed-based terrain generation testing
  - Flip detection and scoring verification
  - Altitude drop tracking
  - Physics configuration validation
  - Wobble state and crash detection
  - Extra life timing system validation

### 🔧 Changed
- Updated package.json with new test dependencies
- Added test:gameplay script for running browser-based tests

### 📝 Notes
- Tests cover: game initialization, player movement, trick system, score display, lives management, terrain generation, and responsive design
