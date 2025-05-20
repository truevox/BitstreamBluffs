// js/systems/InputController.js
// Handles all game input (keyboard and gamepad)
// ------------------------------------------------------

import Manette from '../Manette.js';

export default class InputController {
    constructor(scene) {
        this.scene = scene;
        this.cursors = null;
        this.manette = null;
        
        // Input state tracking
        this.left = false;
        this.right = false;
        this.up = false;
        this.down = false;
        this.jump = false;
        this.tuck = false;
        this.drag = false;
        this.airBrake = false;
        this.parachute = false;
        
        // Initialize input systems
        this.init();
    }
    
    init() {
        // Initialize cursor keys
        this.cursors = this.scene.input.keyboard.createCursorKeys();
        
        // Initialize Manette controller for unified input handling
        this.manette = new Manette(this.scene);
        
        // Map actions to input events
        this.manette.mapAction('left', ['LEFT', 'A', 'a']);
        this.manette.mapAction('right', ['RIGHT', 'D', 'd']);
        this.manette.mapAction('up', ['UP', 'W', 'w']);
        this.manette.mapAction('down', ['DOWN', 'S', 's']);
        this.manette.mapAction('jump', ['SPACE', 'W', 'w', 'UP']);
        this.manette.mapAction('tuck', ['SHIFT', 'CTRL', 'T', 't']);
        this.manette.mapAction('drag', ['DOWN', 'S', 's']);
        this.manette.mapAction('airBrake', ['DOWN', 'S', 's']);
        this.manette.mapAction('parachute', ['P', 'p']);
    }
    
    update() {
        // Update Manette controller
        this.manette.update();
        
        // Update input state
        this.left = this.manette.isActionActive('left') || this.cursors.left.isDown;
        this.right = this.manette.isActionActive('right') || this.cursors.right.isDown;
        this.up = this.manette.isActionActive('up') || this.cursors.up.isDown;
        this.down = this.manette.isActionActive('down') || this.cursors.down.isDown;
        this.jump = this.manette.isActionActive('jump') || this.cursors.up.isDown || this.cursors.space.isDown;
        this.tuck = this.manette.isActionActive('tuck') || this.scene.input.keyboard.checkDown(this.scene.input.keyboard.addKey('SHIFT')) || this.scene.input.keyboard.checkDown(this.scene.input.keyboard.addKey('CTRL'));
        this.drag = this.manette.isActionActive('drag') || this.cursors.down.isDown;
        this.airBrake = this.manette.isActionActive('airBrake') || this.cursors.down.isDown;
        this.parachute = this.manette.isActionActive('parachute') || this.scene.input.keyboard.checkDown(this.scene.input.keyboard.addKey('P'));
        
        return {
            left: this.left,
            right: this.right,
            up: this.up,
            down: this.down,
            jump: this.jump,
            tuck: this.tuck,
            drag: this.drag,
            airBrake: this.airBrake,
            parachute: this.parachute
        };
    }
    
    // Utility methods to check specific inputs
    isJumpPressed() {
        return this.jump;
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
    
    // Clean up event listeners
    destroy() {
        // Clean up any event listeners here
        if (this.manette) {
            this.manette.destroy();
        }
    }
}
