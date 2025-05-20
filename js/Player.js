// js/Player.js
import PhysicsConfig from './config/physics-config.js';

export default class Player extends Phaser.Physics.Matter.Sprite {
    constructor(scene, x, y) {
        // Create the visual components (rider and sled)
        const playerBodyWidth = 30;
        const riderX = 12; // DO NOT TOUCH
        const sledHeight = 15;
        const playerBodyHeight = 50;
        const riderHeight = playerBodyHeight - sledHeight;
        const riderY = -sledHeight - (riderHeight - 120 / 2); // DO NOT TOUCH

        const rider = scene.add.triangle(
            riderX, riderY,
            0, -riderHeight / 2,
            -playerBodyWidth / 2, riderHeight / 2,
            playerBodyWidth / 2, riderHeight / 2,
            scene.neonYellow // Assuming neonYellow is defined in GameScene or passed
        );

        const sledX = 0;
        const sledY = (playerBodyHeight / 2) - (sledHeight / 2);
        const sled = scene.add.rectangle(
            sledX, sledY,
            playerBodyWidth + 10,
            sledHeight,
            scene.neonRed // Assuming neonRed is defined in GameScene or passed
        );

        // Now call the super constructor with the scene, x, y
        super(scene.matter.world, x, y, null, null, {
            label: 'player',
            restitution: PhysicsConfig.player.restitution,
            friction: PhysicsConfig.player.friction,
            frictionAir: PhysicsConfig.player.frictionAir,
            density: PhysicsConfig.player.density
        });
        
        // Add to scene but make invisible since we're using our own visuals
        scene.add.existing(this);
        this.setVisible(false);
        
        // Create visible components and add directly to scene
        // They'll be positioned relative to the physics body in updateVisuals()
        this.rider = rider; 
        this.sled = sled;
        
        // Add rider and sled directly to scene for better control
        scene.add.existing(this.rider);
        scene.add.existing(this.sled);

        // Setup physics body (circular)
        const circleRadius = Math.max(playerBodyWidth, sledHeight) / 1.5;
        const Bodies = Phaser.Physics.Matter.Matter.Bodies;
        const playerBody = Bodies.circle(0, 0, circleRadius, { // x,y are relative to the sprite's center
            restitution: PhysicsConfig.player.restitution,
            friction: PhysicsConfig.player.friction,
            frictionAir: PhysicsConfig.player.frictionAir,
            density: PhysicsConfig.player.density
        });

        this.setExistingBody(playerBody)
            .setFixedRotation(false) // Allow spins for tricks
            .setPosition(x, y);

        // Store original positions for tricks and visualization
        this.riderX = riderX;
        this.riderY = riderY;
        this.sledOriginalX = sledX;
        this.sledOriginalY = sledY;

        // Constants for walk mode
        this.sledDistance = 40; // distance between player and sled when walking

        console.log('Player class instantiated');
    }

    // Method to update the visual components' position to match the physics body
    updateVisuals() {
        if (this.body) {
            // Position rider and sled at the physics body position
            if (this.rider) {
                this.rider.x = this.x + Math.cos(this.rotation) * this.riderX - Math.sin(this.rotation) * this.riderY;
                this.rider.y = this.y + Math.sin(this.rotation) * this.riderX + Math.cos(this.rotation) * this.riderY;
                this.rider.rotation = this.rotation;
            }
            
            if (this.sled) {
                this.sled.x = this.x + Math.cos(this.rotation) * this.sledOriginalX - Math.sin(this.rotation) * this.sledOriginalY;
                this.sled.y = this.y + Math.sin(this.rotation) * this.sledOriginalX + Math.cos(this.rotation) * this.sledOriginalY;
                this.sled.rotation = this.rotation;
            }
        }
    }

    // Add other player-specific methods here later, e.g., for walk mode, tricks
    getSled() {
        return this.sled;
    }

    getRider() {
        return this.rider;
    }

    getOriginalSledX() {
        return this.sledOriginalX;
    }

    getOriginalSledY() {
        return this.sledOriginalY;
    }

    getSledDistance() {
        return this.sledDistance;
    }
}
