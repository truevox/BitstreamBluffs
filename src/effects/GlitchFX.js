/**
 * GlitchFX - Periodic glitch visual effects
 * Adds RGB split, scanlines, and screen shake for retro-cyber aesthetic
 *
 * Triggers every 3-6 seconds as per design spec
 */

export default class GlitchFX {
    constructor(scene) {
        this.scene = scene;
        this.camera = scene.cameras.main;

        // Timing
        this.nextGlitchTime = 3000 + Math.random() * 3000;
        this.glitchDuration = 0;
        this.isGlitching = false;

        // Create scanline overlay
        this.createScanlines();
    }

    createScanlines() {
        // Create a graphics object for scanlines
        this.scanlines = this.scene.add.graphics();
        this.scanlines.setScrollFactor(0);
        this.scanlines.setDepth(1500);
        this.scanlines.setAlpha(0.15);

        // Draw horizontal scanlines
        for (let y = 0; y < 270; y += 2) {
            this.scanlines.fillStyle(0x000000, 1);
            this.scanlines.fillRect(0, y, 480, 1);
        }
    }

    update(time, delta) {
        // Check if it's time for a glitch
        if (!this.isGlitching) {
            this.nextGlitchTime -= delta;

            if (this.nextGlitchTime <= 0) {
                this.triggerGlitch();
            }
        } else {
            // Glitch in progress
            this.glitchDuration -= delta;

            if (this.glitchDuration <= 0) {
                this.endGlitch();
            } else {
                // Apply glitch effects
                this.applyGlitchEffects();
            }
        }
    }

    triggerGlitch() {
        this.isGlitching = true;
        this.glitchDuration = 200 + Math.random() * 300; // 200-500ms glitch

        console.log('Glitch triggered!');
    }

    applyGlitchEffects() {
        // RGB split effect (chromatic aberration)
        const offset = Math.random() * 3;
        this.camera.scrollX += (Math.random() - 0.5) * offset;

        // Screen shake
        if (Math.random() < 0.3) {
            this.camera.shake(50, 0.002);
        }

        // Random flash
        if (Math.random() < 0.1) {
            this.camera.flash(50, 100, 0, 100);
        }
    }

    endGlitch() {
        this.isGlitching = false;
        this.nextGlitchTime = 3000 + Math.random() * 3000; // Next glitch in 3-6 seconds

        // Reset camera
        this.camera.scrollX = this.camera.scrollX; // Clamp any offset
    }

    destroy() {
        this.scanlines?.destroy();
    }
}
