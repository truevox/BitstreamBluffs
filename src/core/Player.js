/**
 * Player - Sled/Walking character controller
 * Handles two modes: Sled (default) and Walking (TAB toggle)
 *
 * Sled Mode:
 *   - W/S: Rotate counterclockwise/clockwise (tricks in air)
 *   - A: Drag (ground) / Air Brake (air)
 *   - D: Tuck (ground) / Parachute (air)
 *   - SPACE: Jump
 *
 * Walking Mode:
 *   - A/D: Move left/right
 *   - SPACE: Small jump
 *   - W/S: No effect
 */

import Phaser from 'phaser';

export default class Player {
    constructor(scene, x, y) {
        this.scene = scene;

        // Mode state
        this.isWalkingMode = false;

        // Create player sprite and physics body
        this.sprite = scene.matter.add.sprite(x, y, 'sled');
        this.sprite.setFixedRotation(false);
        this.sprite.setFrictionAir(0.01);
        this.sprite.setFriction(0.3);
        this.sprite.setMass(2);
        this.sprite.setBounce(0.2);

        // Set collision category
        this.sprite.setCollisionCategory(0x0001);
        this.sprite.setCollidesWith([0x0002]); // Collide with terrain

        // Physics state
        this.onGround = false;
        this.groundCheckTimer = 0;

        // Trick state
        this.isRotating = false;
        this.rotationDirection = 0; // -1 = CCW, 1 = CW
        this.rotationStartAngle = 0;
        this.totalRotation = 0;

        this.isTucking = false;
        this.isDragging = false;
        this.isAirBraking = false;
        this.isParachuting = false;

        // Trick cooldowns
        this.airBrakeCooldown = 0;
        this.parachuteCooldown = 0;

        // Visual effects
        this.trail = null;
        this.createTrailEffect();

        // Listen for collisions
        this.sprite.setOnCollide((pair) => {
            this.handleCollision(pair);
        });
    }

    createTrailEffect() {
        // Create a simple particle trail using Phaser 3.60+ API
        this.trail = this.scene.add.particles(0, 0, 'particle-cyan', {
            follow: this.sprite,
            speed: { min: 10, max: 30 },
            scale: { start: 1, end: 0 },
            alpha: { start: 0.8, end: 0 },
            lifespan: 300,
            frequency: 50,
            tint: 0x00ffff,
            emitting: false  // Start stopped
        });
    }

    update(keys, delta) {
        const deltaSeconds = delta / 1000;

        // Update ground check
        this.updateGroundCheck(deltaSeconds);

        // Update cooldowns
        this.airBrakeCooldown = Math.max(0, this.airBrakeCooldown - deltaSeconds);
        this.parachuteCooldown = Math.max(0, this.parachuteCooldown - deltaSeconds);

        // Handle mode toggle
        if (Phaser.Input.Keyboard.JustDown(keys.tab)) {
            this.toggleMode();
        }

        // Handle input based on mode
        if (this.isWalkingMode) {
            this.handleWalkingInput(keys, deltaSeconds);
        } else {
            this.handleSledInput(keys, deltaSeconds);
        }

        // Update visual effects
        this.updateVisuals();
    }

    updateGroundCheck(deltaSeconds) {
        // Simple ground check based on vertical velocity
        const velocity = this.sprite.body.velocity;
        const angularVelocity = Math.abs(this.sprite.body.angularVelocity);

        // Consider grounded if moving slowly vertically and not spinning much
        const wasOnGround = this.onGround;
        this.onGround = Math.abs(velocity.y) < 2 && angularVelocity < 0.5;

        // Detect landing (transition from air to ground)
        if (!wasOnGround && this.onGround) {
            this.onLanded();
        }
    }

    handleSledInput(keys, deltaSeconds) {
        const onGround = this.onGround;
        const body = this.sprite.body;

        // W/S - Rotation (tricks in air, less effective on ground)
        if (keys.w.isDown) {
            if (!onGround) {
                // Start rotation trick
                if (!this.isRotating) {
                    this.startRotation(-1); // Counter-clockwise
                }
                this.sprite.setAngularVelocity(-0.15);
            } else {
                // Minimal effect on ground
                this.sprite.setAngularVelocity(-0.05);
            }
        } else if (keys.s.isDown) {
            if (!onGround) {
                // Start rotation trick
                if (!this.isRotating) {
                    this.startRotation(1); // Clockwise
                }
                this.sprite.setAngularVelocity(0.15);
            } else {
                // Minimal effect on ground
                this.sprite.setAngularVelocity(0.05);
            }
        }

        // A - Drag (ground) / Air Brake (air)
        if (keys.a.isDown) {
            if (onGround) {
                // Drag to slow down
                this.isDragging = true;
                this.sprite.setFrictionAir(0.05);
                this.sprite.setVelocityX(body.velocity.x * 0.95);
            } else if (this.airBrakeCooldown === 0) {
                // Air Brake trick (slow horizontal, boost vertical)
                this.isAirBraking = true;
                this.sprite.setVelocityX(body.velocity.x * 0.7);
                this.sprite.setVelocityY(body.velocity.y - 2); // Slight upward boost
                this.airBrakeCooldown = 0.5;

                // Notify trick system
                this.scene.trickSystem?.onAirBrake();
            }
        } else {
            this.isDragging = false;
            this.isAirBraking = false;
            this.sprite.setFrictionAir(0.01);
        }

        // D - Tuck (ground) / Parachute (air)
        if (keys.d.isDown) {
            if (onGround) {
                // Tuck to accelerate
                this.isTucking = true;
                this.sprite.setFrictionAir(0.005);
                // Add slight forward force
                const angle = this.sprite.rotation;
                this.sprite.applyForce({
                    x: Math.cos(angle) * 0.01,
                    y: Math.sin(angle) * 0.01
                });
            } else if (this.parachuteCooldown === 0) {
                // Parachute trick (slower descent, more horizontal travel)
                this.isParachuting = true;
                this.sprite.setVelocityY(body.velocity.y * 0.5);
                this.parachuteCooldown = 1.0;

                // Notify trick system
                this.scene.trickSystem?.onParachute();
            }
        } else {
            this.isTucking = false;
            this.isParachuting = false;
            if (!this.isDragging) {
                this.sprite.setFrictionAir(0.01);
            }
        }

        // SPACE - Jump
        if (Phaser.Input.Keyboard.JustDown(keys.space) && onGround) {
            this.jump(8);
        }
    }

    handleWalkingInput(keys, deltaSeconds) {
        const walkSpeed = 2;
        const body = this.sprite.body;

        // A/D - Move left/right
        if (keys.a.isDown) {
            this.sprite.setVelocityX(-walkSpeed);
        } else if (keys.d.isDown) {
            this.sprite.setVelocityX(walkSpeed);
        } else {
            // Slow down when not moving
            this.sprite.setVelocityX(body.velocity.x * 0.9);
        }

        // SPACE - Small jump
        if (Phaser.Input.Keyboard.JustDown(keys.space) && this.onGround) {
            this.jump(4);
        }

        // Keep upright in walking mode
        this.sprite.setAngularVelocity(0);
        const targetAngle = 0;
        const currentAngle = this.sprite.rotation;
        const angleDiff = Phaser.Math.Angle.Wrap(targetAngle - currentAngle);
        this.sprite.setRotation(currentAngle + angleDiff * 0.1);
    }

    jump(power) {
        this.sprite.setVelocityY(-power);
        this.onGround = false;
    }

    startRotation(direction) {
        this.isRotating = true;
        this.rotationDirection = direction;
        this.rotationStartAngle = this.sprite.rotation;
        this.totalRotation = 0;
    }

    onLanded() {
        // Check if we completed a rotation trick
        if (this.isRotating) {
            const rotationAmount = Math.abs(this.totalRotation);
            if (rotationAmount > Math.PI / 2) { // At least 90 degrees
                this.scene.trickSystem?.onRotationComplete(rotationAmount);
            }
            this.isRotating = false;
            this.totalRotation = 0;
        }

        // Reset trick states
        this.isAirBraking = false;
        this.isParachuting = false;

        // Notify trick system of landing
        this.scene.trickSystem?.onLanding();
    }

    toggleMode() {
        this.isWalkingMode = !this.isWalkingMode;

        if (this.isWalkingMode) {
            // Switch to walking mode
            this.sprite.setMass(1);
            this.sprite.setFriction(0.8);
        } else {
            // Switch to sled mode
            this.sprite.setMass(2);
            this.sprite.setFriction(0.3);
        }

        console.log(`Mode: ${this.isWalkingMode ? 'Walking' : 'Sled'}`);
    }

    updateVisuals() {
        // Update trail based on speed
        const speed = Math.sqrt(
            Math.pow(this.sprite.body.velocity.x, 2) +
            Math.pow(this.sprite.body.velocity.y, 2)
        );

        if (speed > 5 && !this.isWalkingMode) {
            this.trail.start();
            this.trail.setFrequency(Math.max(20, 100 - speed));
        } else {
            this.trail.stop();
        }

        // Change trail color based on tricks
        if (this.isAirBraking) {
            this.trail.setTint(0xff00ff); // Magenta
        } else if (this.isParachuting) {
            this.trail.setTint(0xffaa00); // Amber
        } else {
            this.trail.setTint(0x00ffff); // Cyan
        }
    }

    handleCollision(pair) {
        // Handle terrain collision
        // This will be expanded when we add terrain types
    }
}
