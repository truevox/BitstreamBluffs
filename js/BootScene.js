// js/BootScene.js
// Boot scene for initial game loading
// ------------------------------------------------------

/**
 * Boot scene for initial game loading and setup.
 * Used to prepare the game before assets are loaded in PreloadScene.
 *
 * @extends Phaser.Scene
 */
export default class BootScene extends Phaser.Scene {
    /**
     * Constructs the BootScene and sets the scene key.
     */
    constructor() {
        super('BootScene');
    }

    /**
     * Preloads minimal assets needed for PreloadScene.
     * Currently, this is a stub as all assets are loaded in PreloadScene.
     */
    preload() {
        // console.log("BootScene: preload");
        // Load minimal assets needed for the PreloadScene (e.g., logo, progress bar background)
        // For now, we don't have any, so we'll go straight to PreloadScene
    }

    /**
     * Starts the PreloadScene after booting is complete.
     */
    create() {
        // console.log("BootScene: create");
        this.scene.start('PreloadScene');
    }
}
