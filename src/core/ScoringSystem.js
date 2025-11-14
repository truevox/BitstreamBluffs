/**
 * ScoringSystem - Manages score calculation and tracking
 *
 * Scoring sources:
 * - Distance: +1 point per meter traveled downward
 * - Tricks: Variable points based on trick type and combo
 * - Terrain bonus: Blue terrain awards points over time
 */

export default class ScoringSystem {
    constructor(scene) {
        this.scene = scene;

        // Score components
        this.totalScore = 0;
        this.distanceScore = 0;
        this.trickScore = 0;
        this.terrainBonusScore = 0;

        // Distance tracking
        this.lastDistance = 0;

        // Terrain bonus tracking
        this.blueTerrainTimer = 0;
        this.blueTerrainPointsPerSecond = 10;
    }

    updateDistance(currentDistance) {
        // Award points for distance traveled
        const distanceTraveled = currentDistance - this.lastDistance;

        if (distanceTraveled > 0) {
            this.distanceScore += distanceTraveled;
            this.updateTotal();
        }

        this.lastDistance = currentDistance;
    }

    addTrickScore(points) {
        this.trickScore += points;
        this.updateTotal();
    }

    updateTerrainBonus(terrainType, deltaSeconds) {
        // Award bonus points for riding on blue terrain
        if (terrainType === 'blue') {
            this.blueTerrainTimer += deltaSeconds;

            // Award points every second
            if (this.blueTerrainTimer >= 1.0) {
                const bonusPoints = this.blueTerrainPointsPerSecond;
                this.terrainBonusScore += bonusPoints;
                this.updateTotal();
                this.blueTerrainTimer = 0;

                // Show feedback
                this.showBonusFeedback(bonusPoints);
            }
        } else {
            this.blueTerrainTimer = 0;
        }
    }

    showBonusFeedback(points) {
        const player = this.scene.player.sprite;
        const x = player.x + 20;
        const y = player.y - 10;

        const text = this.scene.add.text(x, y, `+${points}`, {
            fontFamily: 'Courier New',
            fontSize: '8px',
            color: '#0088ff',
            stroke: '#000000',
            strokeThickness: 1
        }).setOrigin(0.5);

        // Animate
        this.scene.tweens.add({
            targets: text,
            y: y - 15,
            alpha: 0,
            duration: 600,
            ease: 'Power2',
            onComplete: () => text.destroy()
        });
    }

    updateTotal() {
        this.totalScore = this.distanceScore + this.trickScore + this.terrainBonusScore;
    }

    reset() {
        this.totalScore = 0;
        this.distanceScore = 0;
        this.trickScore = 0;
        this.terrainBonusScore = 0;
        this.lastDistance = 0;
        this.blueTerrainTimer = 0;
    }
}
