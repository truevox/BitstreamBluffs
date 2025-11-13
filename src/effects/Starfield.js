/**
 * Starfield - Parallax scrolling star background
 * Creates a neon-colored star field for visual depth
 */

export default class Starfield {
    constructor(scene, numStars = 100) {
        this.scene = scene;
        this.stars = [];

        // Neon star colors
        this.colors = [0x00ffff, 0xff00ff, 0x00ff88, 0xffaa00, 0x8888ff];

        // Create stars at random positions
        for (let i = 0; i < numStars; i++) {
            this.createStar();
        }
    }

    createStar() {
        const x = Math.random() * 480;
        const y = Math.random() * 10000; // Spread across whole game world
        const depth = Math.random(); // 0 = far, 1 = near
        const color = this.colors[Math.floor(Math.random() * this.colors.length)];
        const size = depth * 2 + 0.5;

        const star = this.scene.add.circle(x, y, size, color, 0.3 + depth * 0.7);
        star.setDepth(-10);
        star.setScrollFactor(0.1 + depth * 0.3); // Parallax effect

        // Add twinkle
        this.scene.tweens.add({
            targets: star,
            alpha: 0.2 + depth * 0.3,
            duration: 1000 + Math.random() * 2000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        this.stars.push({
            graphic: star,
            depth: depth,
            initialY: y
        });
    }

    update(cameraY) {
        // Recycle stars that go off screen
        for (let star of this.stars) {
            const screenY = star.graphic.y - cameraY * star.graphic.scrollFactorY;

            // If star is way above camera, move it below
            if (screenY < cameraY - 500) {
                star.graphic.y = cameraY + 500 + Math.random() * 1000;
            }
        }
    }

    destroy() {
        this.stars.forEach(star => star.graphic.destroy());
        this.stars = [];
    }
}
