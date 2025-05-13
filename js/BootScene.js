// js/BootScene.js
class BootScene extends Phaser.Scene {
    constructor() {
        super('BootScene');
    }

    preload() {
        // console.log("BootScene: preload");
        // Load minimal assets needed for the PreloadScene (e.g., logo, progress bar background)
        // For now, we don't have any, so we'll go straight to PreloadScene
    }

    create() {
        // console.log("BootScene: create");
        this.scene.start('PreloadScene');
    }
}
