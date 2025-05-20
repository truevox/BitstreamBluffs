// js/lib/InputController.js
// Handles all game input (keyboard and gamepad)
// ------------------------------------------------------

/**
 * @fileoverview InputController module manages all player input from keyboard and gamepad.
 * It provides a unified interface for checking input state regardless of input method (keyboard,
 * gamepad, etc.). This module simplifies the main game logic by abstracting away input handling.
 * 
 * @module InputController
 * @requires Manette
 */

import Manette from '../Manette.js';

/**
 * Handles all input processing for the game, providing a unified interface for
 * detecting player actions from both keyboard and gamepad.
 */
export default class InputController {
    /**
     * Creates a new InputController instance
     * @param {Phaser.Scene} scene - The scene this controller is attached to
     */
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
    
    /**
     * Initializes input handlers including keyboard and gamepad via Manette
     * @private
     */
    init() {
        // Initialize cursor keys
        this.cursors = this.scene.input.keyboard.createCursorKeys();
        
        // Initialize Manette controller for unified input handling
        // The Manette class already sets up key bindings internally
        this.manette = new Manette(this.scene);
        
        // Note: Manette.js already has built-in mappings for all these actions:
        // - rotateCounterClockwise (W key)
        // - rotateClockwise (S key)
        // - trickAction (D key)
        // - brakeAction (A key)
        // - walkLeft (A key in walk mode)
        // - walkRight (D key in walk mode)
        // - toggleWalkMode (Tab key)
        // - jump (Space key)
    }
    
    /**
     * Updates all input states for this frame
     * @returns {Object} Current input state for all actions
     */
    update() {
        // First, update Manette controller
        this.manette.update();
        
        // Store previous jump state for "just pressed" detection
        this.prevState.jump = this.jump;
        this.prevState.walkMode = this.isWalkMode();
        
        // Update input state - mapping from Manette's action names to our interface
        // Using direct keyboard checks as fallbacks since Manette doesn't have all the same action names
        this.left = this.manette.isActionActive('brakeAction') || this.cursors.left.isDown;
        this.right = this.manette.isActionActive('trickAction') || this.cursors.right.isDown;
        this.up = this.manette.isActionActive('rotateCounterClockwise') || this.cursors.up.isDown;
        this.down = this.manette.isActionActive('rotateClockwise') || this.cursors.down.isDown;
        this.jump = this.cursors.space.isDown;  // Manette doesn't directly expose 'jump'
        
        // Check keyboard for tuck (Shift/Ctrl/T)
        this.tuck = this.scene.input.keyboard.checkDown(this.scene.input.keyboard.addKey('SHIFT')) || 
                   this.scene.input.keyboard.checkDown(this.scene.input.keyboard.addKey('CTRL')) ||
                   this.scene.input.keyboard.checkDown(this.scene.input.keyboard.addKey('T'));
                   
        // Drag is down key in non-walk mode
        this.drag = !this.manette.isWalkMode() && this.down;
        
        // Air brake is down key in air
        this.airBrake = this.down;
        
        // Parachute is P key
        this.parachute = this.scene.input.keyboard.checkDown(this.scene.input.keyboard.addKey('P'));
        
        // Toggle walk mode - Manette tracks this internally, we just need to capture the event
        this.toggleWalkMode = this.manette.actions.toggleWalkMode;
        
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
            justPressedJump: this.isJumpJustPressed(),
            walkMode: this.manette.isWalkMode()
        };
    }
    
    /**
     * Checks if walk mode is currently active
     * @returns {boolean} True if walk mode is active
     */
    isWalkMode() {
        return this.manette.isWalkMode();
    }
    
    /**
     * Checks if an action was just initiated this frame
     * @param {string} action - The action to check
     * @returns {boolean} True if the action was just pressed
     */
    isActionJustPressed(action) {
        // The current Manette implementation doesn't have this method
        // For toggleWalkMode, we can use the value directly as it's reset each frame
        if (action === 'toggleWalkMode') {
            return this.manette.actions.toggleWalkMode;
        }
        
        // For other actions, we'd need to implement edge detection ourselves
        // But for now, return false as this is only used for toggleWalkMode
        return false;
    }
    
    /**
     * Checks if left movement is being pressed
     * @returns {boolean} True if left is pressed
     */
    isLeftPressed() {
        return this.left;
    }
    
    /**
     * Checks if right movement is being pressed
     * @returns {boolean} True if right is pressed
     */
    isRightPressed() {
        return this.right;
    }
    
    /**
     * Checks if up movement is being pressed
     * @returns {boolean} True if up is pressed
     */
    isUpPressed() {
        return this.up;
    }
    
    /**
     * Checks if down movement is being pressed
     * @returns {boolean} True if down is pressed
     */
    isDownPressed() {
        return this.down;
    }
    
    /**
     * Checks if jump is being pressed
     * @returns {boolean} True if jump is pressed
     */
    isJumpPressed() {
        return this.jump;
    }
    
    /**
     * Checks if jump was just pressed this frame
     * @returns {boolean} True if jump was just pressed
     */
    isJumpJustPressed() {
        // Check if jump was just pressed this frame
        return this.jump && !this.prevState.jump;
    }
    
    /**
     * Checks if tuck (speed boost) is being pressed
     * @returns {boolean} True if tuck is pressed
     */
    isTuckPressed() {
        return this.tuck;
    }
    
    /**
     * Checks if drag (slow down) is being pressed
     * @returns {boolean} True if drag is pressed
     */
    isDragPressed() {
        return this.drag;
    }
    
    /**
     * Checks if air brake is being pressed
     * @returns {boolean} True if air brake is pressed
     */
    isAirBrakePressed() {
        return this.airBrake;
    }
    
    /**
     * Checks if parachute action is being pressed
     * @returns {boolean} True if parachute is pressed
     */
    isParachutePressed() {
        return this.parachute;
    }
    
    /**
     * Checks if walk mode was toggled this frame
     * @returns {boolean} True if walk mode was toggled
     */
    isWalkModeToggled() {
        return this.toggleWalkMode;
    }
    
    /**
     * Cleans up event listeners and resources
     * Called when the controller is no longer needed
     */
    destroy() {
        if (this.manette) {
            this.manette.destroy();
            this.manette = null;
        }
        
        this.cursors = null;
        this.scene = null;
    }
}
