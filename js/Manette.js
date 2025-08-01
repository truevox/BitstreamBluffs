// js/Manette.js
// Input mapping system (Keyboard + Gamepad -> Actions)
// ------------------------------------------------------

// Import physics configuration
import PhysicsConfig from './config/physics-config.js';

/**
 * Input mapping system for Bitstream Bluffs.
 * Maps keyboard and gamepad inputs to game actions and manages walk/sled mode.
 */
export default class Manette {
    /**
     * Constructs the Manette input manager.
     *
     * @param {Phaser.Scene} scene - The Phaser scene using this input manager.
     */
    constructor(scene) {
        this.scene = scene;
        this.actions = {
            jump: false,
            rotateCounterClockwise: false,
            rotateClockwise: false,
            trickAction: false,
            brakeAction: false,
            toggleWalkMode: false,
            walkLeft: false,
            walkRight: false,
            // Future actions can be added here
        };
        
        // Track if we're in walk mode
        this.walkMode = false;

        // Track gamepad state
        this.gamepad = null;
        this.gamepadConnected = false;
        
        // Register keyboard listeners
        this.setupKeyboardControls();
        
        // Register gamepad listeners (only if available)
        // Check if Phaser has gamepad support enabled first
        if (this.scene.input.gamepad) {
            this.setupGamepadControls();
        } else {
            console.log("Gamepad support not available");
        }
        
        console.log("Manette input manager initialized");
    }

    /**
     * Updates the action states based on current keyboard and gamepad input.
     * Should be called once per frame.
     *
     * @returns {Object} The updated actions object.
     */
    update() {
        // Reset edge-triggered actions
        this.actions.toggleWalkMode = false;
        
        // Tab key is now handled via the window event listener
        // toggle action is reset each frame unless toggled this frame
        if (!this.tabToggled) {
            this.actions.toggleWalkMode = false;
        }
        this.tabToggled = false;
        
        // Check for gamepad connections/disconnections (if gamepad API is available)
        if (this.scene.input.gamepad) {
            this.updateGamepadConnection();
            
            // Update gamepad inputs if connected
            if (this.gamepadConnected && this.gamepad) {
                // Left stick vertical for rotation
                const leftStickY = this.gamepad.leftStick.y;
                
                // Up on left stick (negative Y value)
                this.actions.rotateCounterClockwise = this.actions.rotateCounterClockwise || (leftStickY < -0.2);
                
                // Down on left stick (positive Y value)
                this.actions.rotateClockwise = this.actions.rotateClockwise || (leftStickY > 0.2);
                
                // Right on left stick (positive X value) for trick action (tuck/parachute)
                const leftStickX = this.gamepad.leftStick.x;
                this.actions.trickAction = this.actions.trickAction || (leftStickX > 0.2);
                
                // Left on left stick (negative X value) for brake action (drag/airbrake) or walking left
                if (this.walkMode) {
                    this.actions.walkLeft = leftStickX < -0.2;
                } else {
                    this.actions.brakeAction = this.actions.brakeAction || (leftStickX < -0.2);
                }
                
                // Right on left stick (positive X value) for trick action or walking right
                if (this.walkMode) {
                    this.actions.walkRight = leftStickX > 0.2;
                } else {
                    this.actions.trickAction = this.actions.trickAction || (leftStickX > 0.2);
                }
                
                // Jump with bottom face button (A on Xbox, X on PlayStation) OR right trigger (R2)
                this.actions.jump = this.actions.jump || 
                                   this.gamepad.buttons[0].pressed || // Bottom face button
                                   this.gamepad.buttons[7].pressed;   // Right trigger (R2)
                                   
                // Toggle walk mode with L1/LB button
                if (!this.prevL1Pressed && this.gamepad.buttons[4].pressed) {
                    this.walkMode = !this.walkMode;
                    this.actions.toggleWalkMode = true;
                    this.tabToggled = true; // Mark that we toggled this frame
                    console.log(`Walk mode ${this.walkMode ? 'enabled' : 'disabled'}`);
                    
                    // Immediately update the HUD in the active game scene (was GameScene, now ModularGameScene)
                    if (this.scene && this.scene.updateHudText) {
                        this.scene.updateHudText();
                    }
                } else {
                    // Only reset if we didn't toggle this frame
                    if (!this.tabToggled) {
                        this.actions.toggleWalkMode = false;
                    }
                }
                
                // Track previous L1 state to detect edges
                this.prevL1Pressed = this.gamepad.buttons[4].pressed;
            }
        }
        
        // Note: Keyboard inputs are handled by event listeners, not in the update loop
    }

    /**
     * Returns whether a given action is currently active.
     *
     * @param {string} actionName - The action name to check.
     * @returns {boolean} True if the action is active.
     */
    isActionActive(actionName) {
        return this.actions[actionName] || false;
    }
    
    /**
     * Returns whether the player is currently in walking mode.
     *
     * @returns {boolean} True if in walking mode.
     */
    isWalkMode() {
        return this.walkMode;
    }
    
    /**
     * Programmatically toggles walking mode on or off.
     */
    toggleWalkMode() {
        this.walkMode = !this.walkMode;
        
        // If we're attached to a ModularGameScene, notify it to update the HUD
        if (this.scene && this.scene.updateHudText) {
            this.scene.updateHudText();
        }
        
        return this.walkMode;
    }

    /**
     * Consumes an action (sets it to false) for one-time actions like jump.
     *
     * @param {string} actionName - The action to consume.
     */
    consumeAction(actionName) {
        const isActive = this.actions[actionName];
        if (isActive) {
            this.actions[actionName] = false; // Reset after consuming
        }
        return isActive;
    }

    /**
     * Sets up keyboard controls and listeners for all mapped actions.
     */
    setupKeyboardControls() {
        // Get keyboard manager
        const keyboard = this.scene.input.keyboard;
        
        // Map W key to rotate counter-clockwise
        keyboard.on('keydown-W', () => {
            this.actions.rotateCounterClockwise = true;
        });
        keyboard.on('keyup-W', () => {
            this.actions.rotateCounterClockwise = false;
        });
        
        // Map S key to rotate clockwise
        keyboard.on('keydown-S', () => {
            this.actions.rotateClockwise = true;
        });
        keyboard.on('keyup-S', () => {
            this.actions.rotateClockwise = false;
        });
        
        // Map D key to perform trick action (tuck on ground / parachute in air)
        keyboard.on('keydown-D', () => {
            this.actions.trickAction = true;
        });
        keyboard.on('keyup-D', () => {
            this.actions.trickAction = false;
        });
        
        // Map A key based on current mode
        keyboard.on('keydown-A', () => {
            if (this.walkMode) {
                this.actions.walkLeft = true;
            } else {
                this.actions.brakeAction = true;
            }
        });
        keyboard.on('keyup-A', () => {
            this.actions.walkLeft = false;
            this.actions.brakeAction = false;
        });
        
        // Map D key based on current mode
        keyboard.on('keydown-D', () => {
            if (this.walkMode) {
                this.actions.walkRight = true;
            } else {
                this.actions.trickAction = true;
            }
        });
        keyboard.on('keyup-D', () => {
            this.actions.walkRight = false;
            this.actions.trickAction = false;
        });
        
        // Prevent Tab key from changing focus and directly handle it here
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Tab') {
                // Prevent default tab behavior
                event.preventDefault();
                
                // Only toggle if we haven't already toggled recently (debounce)
                if (!this.tabDebounce) {
                    // Toggle walk mode
                    this.walkMode = !this.walkMode;
                    this.actions.toggleWalkMode = true;
                    this.tabToggled = true; // Mark that we toggled this frame
                    console.log(`[DEBUG] Tab pressed. walkMode is now:`, this.walkMode);
                    
                    // Directly update sled visibility when walk mode is toggled
                    if (this.scene && this.scene.sled) {
                        this.scene.sled.visible = !this.walkMode; // Show only in sledding mode
                        
                        // Adjust sled position based on mode
                        if (this.walkMode) {
                            // Hide behind player in walking mode
                            this.scene.sled.x = -this.scene.sledDistance; 
                        } else {
                            // Restore original position in sledding mode
                            this.scene.sled.x = this.scene.sledOriginalX;
                            this.scene.sled.y = this.scene.sledOriginalY;
                        }
                    }
                    
                    // Adjust rider position based on mode
                    if (this.scene && this.scene.rider && this.scene.riderOriginalY !== undefined) {
                        if (this.walkMode) {
                            // Move rider down by the configured amount in walking mode
                            this.scene.rider.y = this.scene.riderOriginalY + PhysicsConfig.walkMode.riderYOffset;
                        } else {
                            // Move rider back to original position in sledding mode
                            this.scene.rider.y = this.scene.riderOriginalY;
                        }
                    }
                    
                    // Immediately update the HUD in the active game scene (was GameScene, now ModularGameScene)
                    if (this.scene && this.scene.updateHudText) {
                        this.scene.updateHudText();
                    }
                    
                    // Set debounce for 200ms to prevent accidental double toggles
                    this.tabDebounce = true;
                    setTimeout(() => {
                        this.tabDebounce = false;
                    }, 200);
                } else {
                    console.log('[DEBUG] Tab debounce active, toggle ignored.');
                }
            }
        });
        
        // Initialize debounce flag
        this.tabDebounce = false;
        
        // Map SPACE key to jump
        keyboard.on('keydown-SPACE', () => {
            this.actions.jump = true;
        });
        keyboard.on('keyup-SPACE', () => {
            this.actions.jump = false;
        });
    }
    
    /**
     * Sets up gamepad controls and listeners for all mapped actions.
     */
    setupGamepadControls() {
        if (!this.scene.input.gamepad) {
            return; // Exit if gamepad API not available
        }
        
        // Listen for gamepad connection
        this.scene.input.gamepad.on('connected', (pad) => {
            this.gamepad = pad;
            this.gamepadConnected = true;
            console.log('Gamepad connected:', pad.id);
        });
        
        // Listen for gamepad disconnection
        this.scene.input.gamepad.on('disconnected', (pad) => {
            this.gamepad = null;
            this.gamepadConnected = false;
            console.log('Gamepad disconnected');
        });
    }
    
    /**
     * Checks and updates the gamepad connection status.
     * Connects to the first available gamepad if not already connected.
     */
    updateGamepadConnection() {
        // Skip if gamepad API not available
        if (!this.scene.input.gamepad) {
            return;
        }
        
        if (!this.gamepadConnected && this.scene.input.gamepad.total > 0) {
            this.gamepad = this.scene.input.gamepad.getPad(0);
            this.gamepadConnected = true;
            console.log('Gamepad found:', this.gamepad.id);
        }
    }
}

// Now properly exported as ES module