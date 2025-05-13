// js/Manette.js
// Stub for input mapping (Keyboard + Gamepad -> Actions)

class Manette {
    constructor(scene) {
        this.scene = scene;
        this.actions = {
            jump: false,
            leanLeft: false,
            leanRight: false,
            // Add more actions as needed
        };

        // We'll add keyboard and gamepad listeners here later
        console.log("Manette input manager initialized (stub).");

        // Example: Placeholder for keyboard input
        // this.scene.input.keyboard.on('keydown-SPACE', () => {
        //     this.actions.jump = true;
        // });
        // this.scene.input.keyboard.on('keyup-SPACE', () => {
        //     this.actions.jump = false;
        // });
    }

    update() {
        // This method could be called in the scene's update loop
        // to continuously check input states, especially for gamepads.

        // For now, actions are set directly by event handlers.
        // Reset single-press actions if needed, e.g., jump
        // if (this.actions.jump) {
        //     // Could potentially reset jump here after one frame if it's a single press action
        // }
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
}

// Later, we might make this a global object or manage it within Phaser's registry.
// For now, it can be instantiated by the GameScene.