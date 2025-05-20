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
    
    /**
     * Checks if walk mode is currently active
     * @returns {boolean} True if walk mode is active
     */
    isWalkMode() {
        return this.manette.walkMode;
    }
    
    /**
     * Checks if an action was just initiated this frame
     * @param {string} action - The action to check
     * @returns {boolean} True if the action was just pressed
     */
    isActionJustPressed(action) {
        return this.manette.isActionJustPressed(action);
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
