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
        
        // Update input state - directly mapping inputs to match GameScene.js
        // In walk mode, W/S don't do anything, A/D move left/right
        if (this.manette.isWalkMode()) {
            // Walking mode controls
            this.left = this.manette.isActionActive('walkLeft') || this.cursors.left.isDown;
            this.right = this.manette.isActionActive('walkRight') || this.cursors.right.isDown;
            
            // W/S do nothing in walking mode
            this.rotateCounterClockwise = false;
            this.rotateClockwise = false;
        } else {
            // Sledding mode controls - mimic GameScene exactly
            
            // A key for brake/drag
            this.brakeAction = this.manette.isActionActive('brakeAction') || this.cursors.left.isDown;
            
            // D key for tuck/trick
            this.trickAction = this.manette.isActionActive('trickAction') || this.cursors.right.isDown;
            
            // W key for counter-clockwise rotation
            this.rotateCounterClockwise = this.manette.isActionActive('rotateCounterClockwise') || this.cursors.up.isDown;
            
            // S key for clockwise rotation
            this.rotateClockwise = this.manette.isActionActive('rotateClockwise') || this.cursors.down.isDown;
        }
        
        // Space for jump in both modes
        this.jump = this.manette.isActionActive('jump') || this.cursors.space.isDown;
        
        // Toggle walk mode
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
            rotateCounterClockwise: this.rotateCounterClockwise,
            rotateClockwise: this.rotateClockwise,
            brakeAction: this.brakeAction,
            trickAction: this.trickAction,
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
     * Sets the walk mode state programmatically
     * Used for forcing the player into walking mode when they crash
     * @param {boolean} isWalking - Whether to enable walk mode
     */
    setWalkMode(isWalking) {
        if (this.manette.walkMode !== isWalking) {
            this.manette.walkMode = isWalking;
            this.manette.actions.toggleWalkMode = true; // Trigger the toggle action
            
            // Handle visibility of sled in the scene if available
            if (this.scene && this.scene.sled) {
                this.scene.sled.visible = !isWalking;
            }
        }
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
        // The Manette class doesn't have a destroy method
        // Just nullify the reference to allow garbage collection
        if (this.manette) {
            // Clean up any references to avoid memory leaks
            this.manette.scene = null;
            this.manette.gamepad = null;
            this.manette = null;
        }
        
        this.cursors = null;
        this.scene = null;
    }
}
