// Helper function to manage extra lives in GameScene
// This will be added to the GameScene prototype

// Function to manage the spawning of extra lives
GameScene.prototype.manageExtraLives = function(time) {
    // Initialize if not already done
    if (!this.extraLivesGroup) {
        this.extraLivesGroup = this.add.group();
        this.lastExtraLifeTime = time;
        this.nextExtraLifeTime = time + Phaser.Math.Between(
            PhysicsConfig.extraLives.minTimeToNextLife,
            PhysicsConfig.extraLives.maxTimeToNextLife
        );
        console.log(`Next extra life will spawn in ${((this.nextExtraLifeTime - time)/1000).toFixed(1)} seconds`);
    }
    
    // Check if it's time to spawn a new extra life
    if (time > this.nextExtraLifeTime && this.lives < PhysicsConfig.extraLives.maxLives) {
        // Spawn an extra life ahead of the player
        this.spawnExtraLife();
        
        // Set the next spawn time
        this.lastExtraLifeTime = time;
        this.nextExtraLifeTime = time + Phaser.Math.Between(
            PhysicsConfig.extraLives.minTimeToNextLife,
            PhysicsConfig.extraLives.maxTimeToNextLife
        );
        console.log(`Next extra life will spawn in ${((this.nextExtraLifeTime - time)/1000).toFixed(1)} seconds`);
    }
    
    // Check for collisions with extra lives
    if (this.extraLivesGroup && this.extraLivesGroup.getChildren().length > 0) {
        const extraLives = this.extraLivesGroup.getChildren();
        for (let i = 0; i < extraLives.length; i++) {
            const extraLife = extraLives[i];
            
            // Check distance to player for collection
            const distance = Phaser.Math.Distance.Between(
                this.player.x, this.player.y,
                extraLife.x, extraLife.y
            );
            
            if (distance < PhysicsConfig.extraLives.collectibleRadius) {
                // Player collected the extra life
                this.collectExtraLife(extraLife);
            }
            
            // Remove if too far behind player
            if (extraLife.x < this.player.x - 800) {
                extraLife.destroy();
            }
        }
    }
};

// Function to spawn an extra life ahead of the player
GameScene.prototype.spawnExtraLife = function() {
    // Calculate spawn position ahead of player
    const spawnX = this.player.x + PhysicsConfig.extraLives.spawnDistance;
    
    // Get a Y position near the terrain height at that X
    let spawnY = this.getTerrainHeightAtX(spawnX) - 100; // Spawn above terrain
    
    // Create the extra life sprite
    const extraLife = this.add.sprite(spawnX, spawnY, 'extraLife');
    extraLife.setScale(0.8);
    
    // Add to group for easy management
    this.extraLivesGroup.add(extraLife);
    
    // Visual effects for the new extra life
    this.tweens.add({
        targets: extraLife,
        y: spawnY - 20,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
    });
    
    console.log(`Spawned extra life at (${spawnX}, ${spawnY})`);
};

// Function to collect an extra life
GameScene.prototype.collectExtraLife = function(extraLife) {
    // Add life if below max
    if (this.lives < PhysicsConfig.extraLives.maxLives) {
        this.lives++;
        this.updateLivesDisplay();
        
        // Visual and audio feedback
        this.cameras.main.flash(500, 255, 255, 0);
        
        console.log(`Collected extra life! Lives: ${this.lives}`);
    }
    
    // Create a collection animation
    this.tweens.add({
        targets: extraLife,
        scale: 1.5,
        alpha: 0,
        duration: 300,
        onComplete: () => extraLife.destroy()
    });
};

// Helper function to estimate terrain height at a given X position
GameScene.prototype.getTerrainHeightAtX = function(x) {
    // Find the terrain segment containing x
    for (let i = 0; i < this.terrainSegments.length; i++) {
        const segment = this.terrainSegments[i];
        if (x >= segment.x1 && x <= segment.x2) {
            // Interpolate height within this segment
            const t = (x - segment.x1) / (segment.x2 - segment.x1);
            return segment.y1 + t * (segment.y2 - segment.y1);
        }
    }
    
    // If we can't find a specific segment, return a reasonable fallback
    return this.lastTerrainY || 500;
};
