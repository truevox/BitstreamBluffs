// physics-config.js
// Configuration parameters for the game physics and player movement
// Adjust these values to fine-tune the game feel

const PhysicsConfig = {
    // Player physics body properties
    player: {
        restitution: 0.1,     // Bounciness (0 = no bounce, 1 = full bounce)
        friction: 0.000001,   // Surface friction (lower = more sliding)
        frictionAir: 0.001,   // Air resistance (lower = less slowdown in air)
        density: 0.18,        // Mass density (lower = lighter)
    },
    
    // Movement forces and velocities
    movement: {
        // Force applied when pressing left/right
        pushForce: 0.0035,        // Base push force for left/right movement
        airPushMultiplier: 0.5,   // Multiplier for push force when in air
        
        // Constant bias to help with hill movement
        downhillBiasForce: 0.0005, // Subtle force applied downhill
        
        // Passive speed boost parameters
        minBoostStrength: 0.00015, // Minimum boost always applied when on ground
        speedBoostThreshold: 0.3,  // Minimum speed needed for multiplier boost
        speedBoostFactor: 0.0003,  // How much speed boost scales with multiplier
    },
    
    // Rotation velocities
    rotation: {
        groundRotationVel: 0.05,   // Rotation speed on ground (radians)
        airRotationVel: 0.10,      // Rotation speed in air (radians)
        slopeAlignmentFactor: 0.2, // How quickly player aligns to slopes (0-1)
    },
    
    // Jump parameters
    jump: {
        jumpVelocity: -10,         // Initial upward velocity on jump
        walkJumpVelocity: -3,      // Jump velocity in walk mode
    },
    
    // Speed adjustments for trick landings
    tricks: {
        wobbleLandingSpeedFactor: 0.7, // Speed retention on wobble landing (0-1)
        cleanLandingMultiplierMax: 2.5, // Maximum speed multiplier for clean landings
    },
    
    // Extra lives system
    extraLives: {
        initialLives: 1,               // Starting number of lives
        maxLives: 3,                   // Maximum number of lives
        minTimeToNextLife: 30000,      // Minimum ms between life spawns (30 sec)
        maxTimeToNextLife: 120000,     // Maximum ms between life spawns (2 min)
        spawnDistance: 600,            // How far ahead lives spawn
        collectibleRadius: 20,         // Collision radius for collectibles
    }
};

// Export the config
export default PhysicsConfig;
