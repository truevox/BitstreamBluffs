// js/main.js
window.onload = function() {
    const config = {
        type: Phaser.AUTO, // Automatically try WebGL, then Canvas
        width: 1000, // Game width
        height: 700, // Game height
        parent: 'game-container', // ID of the div to contain the game
        backgroundColor: '#000000', // Black background for Phaser canvas
        physics: {
            default: 'arcade',
            arcade: {
                gravity: { y: 0 }, // Global gravity (player has its own)
                debug: true // Set to true for physics body outlines, false for production
            }
        },
        scene: [BootScene, PreloadScene, GameScene]
    };

    const game = new Phaser.Game(config);
};