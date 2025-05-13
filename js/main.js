// js/main.js
window.onload = () => {
    const config = {
        type: Phaser.AUTO,          // WebGL if available, otherwise Canvas
        width: 1000,
        height: 700,
        parent: 'game-container',
        backgroundColor: '#000000',

        // ───────────────────────────────────────────
        //  PHYSICS: switch from Arcade → Matter
        // ───────────────────────────────────────────
        physics: {
            default: 'matter',
            matter: {
                gravity: { y: 1 },  // ≈ 1000 px/s²; tweak to taste
                debug: true         // green wireframes; set false for production
            }
        },

        scene: [ BootScene, PreloadScene, GameScene ]
    };

    new Phaser.Game(config);
};
