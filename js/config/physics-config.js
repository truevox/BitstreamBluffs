// physics-config.js
// Configuration parameters for the game physics and player movement
// Adjust these values to fine-tune the game feel

/**
 * Configuration parameters for the game physics and player movement.
 * Adjust these values to fine-tune the game feel.
 * @namespace PhysicsConfig
 */
const PhysicsConfig = {
    bluePoints: 1, // Points per tick on blue terrain
    blueSpeedThreshold: 3, // Minimum speed offset for blue points
    groundBufferHeight: 10, // Max px above terrain to still count as "on ground" (buffered detection)

    // Core physics system properties
    physics: {
        gravityY: 1.0,       // Default gravity (Matter.js uses 1 by default)
    },
    
    // Player physics body properties
    player: {
        restitution: 0,     // Bounciness (0 = no bounce, 1 = full bounce)
        friction: 0.04,   // Surface friction (lower = more sliding)
        frictionAir: 0.002,   // Air resistance (lower = less slowdown in air)
        density: 0.98,        // Mass density (lower = lighter)
    },
    
    // Movement forces and velocities
    movement: {
        // Force applied when pressing left/right
        pushForce: 0,        // Base push force for left/right movement
        airPushMultiplier: 0,   // Multiplier for push force when in air
        
        // Constant bias to help with hill movement
        downhillBiasForce: 0.5, // Subtle force applied downhill
        
        // Passive speed boost parameters
        minBoostStrength: 0.0000075, // less natural speed gain
        speedBoostThreshold: 0.3,  // Minimum speed needed for multiplier boost (unchanged)
        speedBoostFactor: 0.000015,  // less trick boost strength
    },
    
    // Rotation velocities
    rotation: {
        groundRotationVel: 0.05,   // Rotation speed on ground (radians)
        airRotationVel: 0.10,      // Rotation speed in air (radians)
        slopeAlignmentFactor: 0.2, // How quickly player aligns to slopes (0-1)
    },
    
    // Jump parameters
    jump: {
        jumpVelocity: -10,         // Initial upward velocity on jump (maximum, at top speed)
        walkJumpVelocity: -3,      // Jump velocity in walk mode
        minSpeedForMaxJump: 40,    // Speed (pixels/frame) at which jump is full height
        minJumpVelocity: -4,       // Minimum jump velocity at zero speed
        // Above minSpeedForMaxJump, jump is always max; below, it lerps to minJumpVelocity
    },
    
    // Walking mode parameters
    walkMode: {
        riderYOffset: 10,          // How many pixels to move the rider down in walking mode
    },
    
    // Speed adjustments for trick landings
    tricks: {
        wobbleLandingSpeedFactor: 0.7, // Speed retention on wobble landing (0-1)
        cleanLandingMultiplierMax: 2.5, // Maximum speed multiplier for clean landings
    },
    
    // Extra lives system
    extraLives: {
        initialLives: 2,               // Starting number of lives
        maxLives: 5,                   // Maximum number of lives
        minTimeToNextLife: 30000,      // Minimum ms between life spawns (30 sec)
        maxTimeToNextLife: 120000,     // Maximum ms between life spawns (2 min)
        spawnDistance: 600,            // How far ahead lives spawn
        collectibleRadius: 20,         // Collision radius for collectibles
    }
};

/**
 * Exported physics configuration object for use throughout the game.
 * @type {PhysicsConfig}
 */
export default PhysicsConfig;
