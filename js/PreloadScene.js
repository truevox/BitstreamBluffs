// js/PreloadScene.js
class PreloadScene extends Phaser.Scene {
    constructor() {
        super('PreloadScene');
    }

    preload() {
        // console.log("PreloadScene: preload");

        // Display a loading message
        let width = this.cameras.main.width;
        let height = this.cameras.main.height;
        let loadingText = this.make.text({
            x: width / 2,
            y: height / 2 - 50,
            text: 'Loading...',
            style: {
                font: '20px monospace',
                fill: '#ffffff'
            }
        });
        loadingText.setOrigin(0.5, 0.5);

        let percentText = this.make.text({
            x: width / 2,
            y: height / 2,
            text: '0%',
            style: {
                font: '18px monospace',
                fill: '#ffffff'
            }
        });
        percentText.setOrigin(0.5, 0.5);

        let assetText = this.make.text({
            x: width / 2,
            y: height / 2 + 50,
            text: '',
            style: {
                font: '18px monospace',
                fill: '#ffffff'
            }
        });
        assetText.setOrigin(0.5, 0.5);

        // Listener for loading progress
        this.load.on('progress', function (value) {
            percentText.setText(parseInt(value * 100) + '%');
        });

        // Listener for individual file load
        this.load.on('fileprogress', function (file) {
            assetText.setText('Loading asset: ' + file.key);
        });

        // Listener for load completion
        this.load.on('complete', function () {
            // console.log("PreloadScene: All assets loaded");
            loadingText.destroy();
            percentText.destroy();
            assetText.destroy();
        });

        // Load game assets here
        // For now, we don't have external assets.
        // We'll generate graphics procedurally or use Phaser's built-in shapes.
    }

    create() {
        // console.log("PreloadScene: create");
        // Assets are loaded, start the main game scene
        this.scene.start('GameScene');
    }
}
