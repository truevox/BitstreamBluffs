// js/lib/InputController.js
// Handles all game input (keyboard and gamepad)
// ------------------------------------------------------

import Manette from '../Manette.js';

export default class InputController {
    constructor(scene) {
        this.scene = scene;
        this.cursors = null;
        this.manette = null;
        
        // Input state tracking - these get updated each frame
        this.left = false;
        this.right = false;
        this.up = false;
        this.down = false;
        this.jump = false;
        this.tuck = false;
        this.drag = false;
        this.airBrake = false;
        this.parachute = false;
        this.toggleWalkMode = false;
        
        // State tracking for "just pressed" detection
        this.prevState = {
            jump: false,
            walkMode: false
        };
        
        // Initialize input systems
        this.init();
    }
    
    init() {
        // Initialize cursor keys
        this.cursors = this.scene.input.keyboard.createCursorKeys();
        
        // Initialize Manette controller for unified input handling
        this.manette = new Manette(this.scene);
        
        // Map actions to input events - using the same mapping as GameScene
        this.manette.mapAction('left', ['LEFT', 'A', 'a']);
        this.manette.mapAction('right', ['RIGHT', 'D', 'd']);
        this.manette.mapAction('up', ['UP', 'W', 'w']);
        this.manette.mapAction('down', ['DOWN', 'S', 's']);
        this.manette.mapAction('jump', ['SPACE', 'W', 'w', 'UP']);
        this.manette.mapAction('tuck', ['SHIFT', 'CTRL', 'T', 't']);
        this.manette.mapAction('drag', ['DOWN', 'S', 's']);
        this.manette.mapAction('brakeAction', ['LEFT', 'A', 'a']);
        this.manette.mapAction('trickAction', ['RIGHT', 'D', 'd']);
        this.manette.mapAction('airBrake', ['DOWN', 'S', 's']);
        this.manette.mapAction('parachute', ['P', 'p']);
        this.manette.mapAction('toggleWalkMode', ['TAB']); 
    }
    
    update() {
        // First, update Manette controller
        this.manette.update();
        
        // Store previous jump state for "just pressed" detection
        this.prevState.jump = this.jump;
        this.prevState.walkMode = this.isWalkMode();
        
        // Update input state
        this.left = this.manette.isActionActive('left') || this.cursors.left.isDown;
        this.right = this.manette.isActionActive('right') || this.cursors.right.isDown;
        this.up = this.manette.isActionActive('up') || this.cursors.up.isDown;
        this.down = this.manette.isActionActive('down') || this.cursors.down.isDown;
        this.jump = this.manette.isActionActive('jump') || this.cursors.up.isDown || this.cursors.space.isDown;
        this.tuck = this.manette.isActionActive('tuck') || 
                   this.scene.input.keyboard.checkDown(this.scene.input.keyboard.addKey('SHIFT')) || 
                   this.scene.input.keyboard.checkDown(this.scene.input.keyboard.addKey('CTRL'));
        this.drag = this.manette.isActionActive('drag') || this.cursors.down.isDown;
        this.airBrake = this.manette.isActionActive('airBrake') || this.cursors.down.isDown;
        this.parachute = this.manette.isActionActive('parachute') || 
                        this.scene.input.keyboard.checkDown(this.scene.input.keyboard.addKey('P'));
        this.toggleWalkMode = this.manette.isActionJustPressed('toggleWalkMode');
        
        // Return current input state object - useful for debugging and testing
        return {
            left: this.left,
            right: this.right,
            up: this.up,
            down: this.down,
            jump: this.jump,
            tuck: this.tuck,
            drag: this.drag,
            airBrake: this.airBrake,
            parachute: this.parachute,
            toggleWalkMode: this.toggleWalkMode,
            justPressedJump: this.isJumpJustPressed()
        };
    }
    
    // Check if walk mode is active (delegate to Manette for compatibility)
    isWalkMode() {
        return this.manette.walkMode;
    }
    
    // Check if an action was just initiated this frame
    isActionJustPressed(action) {
        return this.manette.isActionJustPressed(action);
    }
    
    // Utility methods to check specific inputs
    isLeftPressed() {
        return this.left;
    }
    
    isRightPressed() {
        return this.right;
    }
    
    isUpPressed() {
        return this.up;
    }
    
    isDownPressed() {
        return this.down;
    }
    
    isJumpPressed() {
        return this.jump;
    }
    
    isJumpJustPressed() {
        // Check if jump was just pressed this frame
        return this.jump && !this.prevState.jump;
    }
    
    isTuckPressed() {
        return this.tuck;
    }
    
    isDragPressed() {
        return this.drag;
    }
    
    isAirBrakePressed() {
        return this.airBrake;
    }
    
    isParachutePressed() {
        return this.parachute;
    }
    
    isWalkModeToggled() {
        return this.toggleWalkMode;
    }
    
    // Clean up event listeners and resources
    destroy() {
        if (this.manette) {
            this.manette.destroy();
            this.manette = null;
        }
        
        this.cursors = null;
        this.scene = null;
    }
}
