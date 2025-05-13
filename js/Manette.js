// js/Manette.js
// Input mapping system (Keyboard + Gamepad -> Actions)

class Manette {
    constructor(scene) {
        this.scene = scene;
        this.actions = {
            jump: false,
            rotateCounterClockwise: false,
            rotateClockwise: false,
            // Future actions can be added here
        };

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

    update() {
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
                
                // Jump with bottom face button (typically A on Xbox, X on PlayStation)
                this.actions.jump = this.actions.jump || this.gamepad.buttons[0].pressed;
            }
        }
        
        // Note: Keyboard inputs are handled by event listeners, not in the update loop
    }

    // Helper to get action states
    isActionActive(actionName) {
        return this.actions[actionName] || false;
    }

    // Helper to consume an action (e.g., for single presses like jump)
    consumeAction(actionName) {
        const isActive = this.actions[actionName];
        if (isActive) {
            this.actions[actionName] = false; // Reset after consuming
        }
        return isActive;
    }

    // Helper to set up keyboard controls
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
        
        // Map SPACE key to jump
        keyboard.on('keydown-SPACE', () => {
            this.actions.jump = true;
        });
        keyboard.on('keyup-SPACE', () => {
            this.actions.jump = false;
        });
    }
    
    // Helper to set up gamepad controls
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
    
    // Check and update gamepad connection status
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

// Instantiated by GameScene