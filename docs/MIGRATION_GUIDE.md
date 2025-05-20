# Bitstream Bluffs - Migration Guide

## Introduction to the Modular Architecture

This guide details how to migrate from the original monolithic architecture to the new modular system for Bitstream Bluffs. The modular architecture improves code organization, maintainability, and makes adding new features simpler.

## Architectural Overview

The new architecture splits functionality into discrete modules:

### Core Modules

1. **InputController** - `/js/lib/InputController.js`
   - Handles all player input (keyboard, gamepad)
   - Provides a unified interface for checking input state
   - Abstracts away input source details from game logic

2. **TerrainManager** - `/js/lib/TerrainManager.js`
   - Manages procedural terrain generation
   - Handles terrain physics and collision
   - Optimizes performance through efficient segment loading/unloading

3. **HudDisplay** - `/js/lib/HudDisplay.js`
   - Manages UI elements and displays
   - Handles visual effects and notifications
   - Controls screen positioning and responsiveness

4. **CollectibleManager** - `/js/lib/CollectibleManager.js`
   - Manages spawning and collection of items
   - Handles collectible physics integration
   - Controls visual effects for collection events

### Implementation Structure

- **Original Implementation**: `js/GameScene.js`
- **Modular Implementation**: `js/ModularGameScene.js`

## Migration Steps

### Step 1: Choose Your Implementation

The game now supports both implementations without requiring code changes:

- **Runtime Selection**: Players can choose between implementations via the start screen
- **URL Parameter**: Add `?modular=true` to use the modular architecture
- **Default Behavior**: Without parameters, the original implementation is used

### Step 2: Making Changes to Existing Modules

When modifying existing module functionality:

1. Identify the appropriate module for your changes
2. Locate the relevant methods within that module
3. Make your changes in the module, not in the main game scene
4. Update tests to verify your changes work properly

### Step 3: Adding New Modules

To add a new module (e.g., a PowerupManager):

1. Create a new file in `/js/lib/` following the existing module pattern
2. Import and initialize the module in `ModularGameScene.js`
3. Connect the module to existing systems as needed
4. Add corresponding tests in `/js/tests/`

```javascript
// Example module structure
export default class NewModule {
    constructor(scene) {
        this.scene = scene;
        // Initialize state
    }
    
    init() {
        // Setup and initialize resources
    }
    
    update() {
        // Per-frame update logic
    }
    
    destroy() {
        // Clean up resources
    }
}
```

### Step 4: Module Integration Patterns

#### Communication Between Modules

Modules can interact in several ways:

1. **Direct References**: Modules can be passed to each other (e.g., CollectibleManager uses TerrainManager)
2. **Scene Events**: For loose coupling, use the Phaser event system
3. **Global Game State**: For shared state, use scene properties

```javascript
// Example: Module communication via events
// In Module A
this.scene.events.emit('collectible:collected', { type: 'extraLife', position: { x, y } });

// In Module B
this.scene.events.on('collectible:collected', (data) => {
    // React to the collection event
});
```

#### Consistent Lifecycle Management

All modules should implement:

- **Constructor**: Store references and initial state
- **Init**: Setup resources and start systems
- **Update**: Process per-frame logic
- **Destroy**: Clean up all resources

## Best Practices

1. **Responsibility Boundaries**: Each module should have a single, clear purpose
2. **Clean Destruction**: Always release resources in `destroy()` methods
3. **Consistent API**: Follow established patterns for method names and signatures
4. **JSDoc Documentation**: Maintain comprehensive documentation for all modules
5. **Unit Testing**: Write tests for all new functionality

## Common Pitfalls

- **Circular Dependencies**: Avoid having modules depend on each other cyclically
- **Scene Pollution**: Don't add unnecessary properties to the scene object
- **Late Initialization**: Ensure modules are properly initialized before use
- **Event Leakage**: Always remove event listeners in `destroy()` methods

## Appendix: Module Reference

### InputController

```javascript
const input = new InputController(scene);
input.init();

// In update loop
input.update();

// Check input state
if (input.isJumpPressed()) {
    // Handle jump
}
```

### TerrainManager

```javascript
const terrain = new TerrainManager(scene);
terrain.init();

// In update loop
terrain.update(playerX);

// Get terrain information
const height = terrain.findTerrainHeightAt(position.x);
const angle = terrain.getSlopeAngleAt(position.x);
```

### HudDisplay

```javascript
const hud = new HudDisplay(scene);
hud.init();

// In update loop
hud.update(player, score, speed, lives, maxLives);

// Show notifications
hud.showToast('Double Flip! +500', 2000);
```

### CollectibleManager

```javascript
const collectibles = new CollectibleManager(scene, terrainManager);
collectibles.init(physicsConfig);

// In update loop
collectibles.update(currentTime, playerX);

// Handle collection
collectibles.collectExtraLife(colliderBody, () => {
    // Award extra life to player
});
```
