// js/utils/RotationSystem.js
// Handles rotation physics, flip tracking and landing evaluation
// for downhill sledding game with aerial tricks
// ------------------------------------------------------

export default class RotationSystem {
    constructor(config = {}) {
        // Initialize state
        this.isGrounded = true;
        this.currentAngle = 0;
        this.takeoffAngle = 0;
        this.rotationSinceTakeoff = 0;
        this.wasGrounded = true;
        
        // Callbacks
        this.onCleanLandingCallback = config.onCleanLanding || (() => {});
        this.onCrashCallback = config.onCrash || (() => {});
        this.onWobbleCallback = config.onWobble || (() => {});
        this.onFlipCompleteCallback = config.onFlipComplete || (() => {});

        // Angle thresholds (in degrees)
        this.safeAngleRanges = [
            { min: 330, max: 360 },
            { min: 0, max: 30 }
        ];
        this.wobbleAngleRanges = [
            { min: 30, max: 70 },
            { min: 290, max: 330 }
        ];
        this.failAngleRanges = [
            { min: 70, max: 110 },
            { min: 250, max: 290 }
        ];
        this.crashAngleRanges = [
            { min: 110, max: 250 }
        ];
    }

    /**
     * Update the rotation system with the current game state
     * @param {Object} state - Current game state
     * @param {boolean} state.grounded - Whether the player is currently on the ground
     * @param {number} state.currentAngle - Current angle in degrees (0-360)
     * @param {number} state.deltaRotation - Change in rotation since last update (degrees)
     */
    update(state) {
        const { grounded, currentAngle, deltaRotation } = state;
        
        // Store the current angle
        this.currentAngle = this.normalizeAngle(currentAngle);
        
        // Handle ground-to-air transition
        if (grounded !== this.isGrounded) {
            // Takeoff event
            if (!grounded && this.isGrounded) {
                this.handleTakeoff();
            }
            // Landing event
            else if (grounded && !this.isGrounded) {
                this.handleLanding();
            }
            
            // Update grounded state
            this.isGrounded = grounded;
        }
        
        // Track rotation when airborne
        if (!this.isGrounded) {
            this.rotationSinceTakeoff += deltaRotation || 0;
            
            // Check for complete flips (each 360 degrees)
            const flipStats = this.getFlipStats();
            const prevFullFlips = Math.floor((this.rotationSinceTakeoff - deltaRotation) / 360);
            const currentFullFlips = Math.floor(this.rotationSinceTakeoff / 360);
            
            // Trigger flip complete event if we've completed a new full flip
            if (currentFullFlips > prevFullFlips) {
                this.onFlipCompleteCallback(
                    flipStats.fullFlips, 
                    flipStats.partialFlip
                );
            }
        }
    }

    /**
     * Handle takeoff event (transition from grounded to airborne)
     */
    handleTakeoff() {
        this.takeoffAngle = this.currentAngle;
        this.rotationSinceTakeoff = 0;
    }

    /**
     * Handle landing event (transition from airborne to grounded)
     */
    handleLanding() {
        const stabilityState = this.getStabilityState(this.currentAngle);
        const flipStats = this.getFlipStats();
        
        // Handle landing based on stability state
        switch (stabilityState) {
            case 'safe':
                const speedMultiplier = this.getSpeedMultiplier(this.rotationSinceTakeoff);
                this.onCleanLandingCallback(speedMultiplier);
                break;
                
            case 'wobble':
                this.onWobbleCallback();
                break;
                
            case 'fail':
            case 'crash':
                this.onCrashCallback();
                break;
        }
        
        // Reset rotation tracking
        this.rotationSinceTakeoff = 0;
    }

    /**
     * Get statistics about flips performed since takeoff
     * @returns {Object} Flip statistics
     */
    getFlipStats() {
        // Using absolute value to count flips in either direction
        const absoluteRotation = Math.abs(this.rotationSinceTakeoff);
        const fullFlips = Math.floor(absoluteRotation / 360);
        const partialFlip = (absoluteRotation % 360) / 360;
        
        return {
            totalRotation: absoluteRotation,
            fullFlips: fullFlips,
            partialFlip: partialFlip
        };
    }

    /**
     * Calculate speed multiplier based on completed flips
     * @param {number} rotationAmount - Amount of rotation in degrees
     * @returns {number} Speed multiplier value
     */
    getSpeedMultiplier(rotationAmount) {
        const absoluteRotation = Math.abs(rotationAmount);
        const flips = absoluteRotation / 360;
        
        // Import PhysicsConfig if needed (we'll make this class use the config too)
        // Base multiplier calculation with interpolation
        if (flips <= 1) {
            // Linear interpolation between 1.0 (0 flips) and 1.2 (1 flip)
            return 1 + (flips * 0.2);
        } else if (flips <= 1.5) {
            // Linear interpolation between 1.2 (1 flip) and 1.3 (1.5 flips)
            return 1.2 + ((flips - 1) * 0.2);
        } else if (flips <= 2) {
            // Linear interpolation between 1.3 (1.5 flips) and 1.4 (2 flips)
            return 1.3 + ((flips - 1.5) * 0.2);
        } else {
            // Cap at 2.5 for more than 2 flips (increased this for more impact)
            return 2.5;
        }
    }

    /**
     * Check if an angle is within a given range
     * @param {number} angle - Angle to check (0-360 degrees)
     * @param {number} start - Start of range
     * @param {number} end - End of range
     * @returns {boolean} Whether the angle is in the range
     */
    isAngleInRange(angle, start, end) {
        const normalizedAngle = this.normalizeAngle(angle);
        if (start <= end) {
            return normalizedAngle >= start && normalizedAngle <= end;
        } else {
            // Handle wrap-around case (e.g., 350-10 degrees)
            return normalizedAngle >= start || normalizedAngle <= end;
        }
    }

    /**
     * Get the stability state for a given angle
     * @param {number} angle - Angle to evaluate (degrees)
     * @returns {string} Stability state: 'safe', 'wobble', 'fail', or 'crash'
     */
    getStabilityState(angle) {
        const normalizedAngle = this.normalizeAngle(angle);
        
        // Check safe zones
        for (const range of this.safeAngleRanges) {
            if (this.isAngleInRange(normalizedAngle, range.min, range.max)) {
                return 'safe';
            }
        }
        
        // Check wobble zones
        for (const range of this.wobbleAngleRanges) {
            if (this.isAngleInRange(normalizedAngle, range.min, range.max)) {
                return 'wobble';
            }
        }
        
        // Check fail zones
        for (const range of this.failAngleRanges) {
            if (this.isAngleInRange(normalizedAngle, range.min, range.max)) {
                return 'fail';
            }
        }
        
        // Anything else is a crash
        return 'crash';
    }

    /**
     * Normalize an angle to be between 0 and 360 degrees
     * @param {number} angle - Angle to normalize (degrees)
     * @returns {number} Normalized angle (0-360 degrees)
     */
    normalizeAngle(angle) {
        let normalized = angle % 360;
        if (normalized < 0) {
            normalized += 360;
        }
        return normalized;
    }

    /**
     * Set a callback for clean landing events
     * @param {Function} callback - Function to call on clean landing
     */
    setOnCleanLanding(callback) {
        this.onCleanLandingCallback = callback;
    }

    /**
     * Set a callback for crash events
     * @param {Function} callback - Function to call on crash
     */
    setOnCrash(callback) {
        this.onCrashCallback = callback;
    }

    /**
     * Set a callback for wobble events
     * @param {Function} callback - Function to call on wobble
     */
    setOnWobble(callback) {
        this.onWobbleCallback = callback;
    }

    /**
     * Set a callback for flip complete events
     * @param {Function} callback - Function to call when a flip is completed
     */
    setOnFlipComplete(callback) {
        this.onFlipCompleteCallback = callback;
    }
}

// Class is now properly exported using ES modules
