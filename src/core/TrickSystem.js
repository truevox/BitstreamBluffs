/**
 * TrickSystem - Manages tricks, combos, and trick scoring
 *
 * Three primary tricks:
 * - Rotation: 100-300 points (based on rotation amount)
 * - Air Brake: 150 points
 * - Parachute: 200 points
 *
 * Combo System:
 * - Starts at 1.0x
 * - Increases by 0.25x for each unique trick in current air session
 * - Resets on landing
 */

export default class TrickSystem {
    constructor(scene) {
        this.scene = scene;

        // Current combo state
        this.comboMultiplier = 1.0;
        this.tricksInCombo = new Set(); // Track unique tricks

        // Trick scores
        this.baseScores = {
            rotation: 200,
            airBrake: 150,
            parachute: 200
        };

        // Current session points (not yet awarded)
        this.pendingScore = 0;
        this.lastTrickText = null;
    }

    update(player, delta) {
        // Update trick tracking based on player rotation
        if (player.isRotating) {
            const previousRotation = player.totalRotation;
            const currentAngle = player.sprite.rotation;
            const angleDiff = Phaser.Math.Angle.Wrap(currentAngle - player.rotationStartAngle);

            player.totalRotation = angleDiff;

            // Detect full rotations
            const prevFullRotations = Math.floor(Math.abs(previousRotation) / (Math.PI * 2));
            const currentFullRotations = Math.floor(Math.abs(player.totalRotation) / (Math.PI * 2));

            if (currentFullRotations > prevFullRotations) {
                console.log(`Full rotation #${currentFullRotations}!`);
            }
        }
    }

    onRotationComplete(rotationAmount) {
        // Calculate points based on rotation
        const rotations = rotationAmount / (Math.PI * 2);
        let points = this.baseScores.rotation * rotations;

        // Add to combo
        this.tricksInCombo.add('rotation');
        this.updateComboMultiplier();

        // Apply combo multiplier
        points *= this.comboMultiplier;

        this.pendingScore += points;
        this.showTrickFeedback('ROTATION', points);

        console.log(`Rotation: ${(rotations * 360).toFixed(0)}° = ${points.toFixed(0)} pts (${this.comboMultiplier.toFixed(2)}x)`);
    }

    onAirBrake() {
        if (this.tricksInCombo.has('airBrake')) {
            return; // Already did this trick in current combo
        }

        let points = this.baseScores.airBrake;

        this.tricksInCombo.add('airBrake');
        this.updateComboMultiplier();

        points *= this.comboMultiplier;

        this.pendingScore += points;
        this.showTrickFeedback('AIR BRAKE', points);

        console.log(`Air Brake: ${points.toFixed(0)} pts (${this.comboMultiplier.toFixed(2)}x)`);
    }

    onParachute() {
        if (this.tricksInCombo.has('parachute')) {
            return; // Already did this trick in current combo
        }

        let points = this.baseScores.parachute;

        this.tricksInCombo.add('parachute');
        this.updateComboMultiplier();

        points *= this.comboMultiplier;

        this.pendingScore += points;
        this.showTrickFeedback('PARACHUTE', points);

        console.log(`Parachute: ${points.toFixed(0)} pts (${this.comboMultiplier.toFixed(2)}x)`);
    }

    updateComboMultiplier() {
        // Combo increases by 0.25x for each unique trick
        this.comboMultiplier = 1.0 + (this.tricksInCombo.size - 1) * 0.25;
    }

    onLanding() {
        // Award pending points
        if (this.pendingScore > 0) {
            this.scene.scoring?.addTrickScore(this.pendingScore);

            // Show landing bonus if perfect
            // TODO: Add perfect landing detection
            const landingBonus = 0;
            if (landingBonus > 0) {
                this.showTrickFeedback('PERFECT LANDING!', landingBonus);
            }
        }

        // Reset combo
        this.comboMultiplier = 1.0;
        this.tricksInCombo.clear();
        this.pendingScore = 0;

        console.log('Combo reset on landing');
    }

    showTrickFeedback(trickName, points) {
        // Remove previous trick text if still visible
        if (this.lastTrickText) {
            this.lastTrickText.destroy();
        }

        // Create floating text near player
        const player = this.scene.player.sprite;
        const x = player.x;
        const y = player.y - 30;

        this.lastTrickText = this.scene.add.text(x, y, `${trickName}\n+${Math.floor(points)}`, {
            fontFamily: 'Courier New',
            fontSize: '10px',
            color: '#ffaa00',
            stroke: '#000000',
            strokeThickness: 2,
            align: 'center'
        }).setOrigin(0.5);

        // Animate text
        this.scene.tweens.add({
            targets: this.lastTrickText,
            y: y - 20,
            alpha: 0,
            duration: 1000,
            ease: 'Power2',
            onComplete: () => {
                this.lastTrickText?.destroy();
                this.lastTrickText = null;
            }
        });
    }
}
