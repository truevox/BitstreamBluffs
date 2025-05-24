// StarfieldParallax.js - Player-Following Starfield
// Parallax star background for Bitstream Bluffs & SledHEAD scenes
// Constantly generates stars around player position, always keeping the screen filled
//
// Usage: Instantiate in your scene, call update() in scene's update.
//
// PLAYER-FOLLOWING IMPLEMENTATION:
// Stars are continuously generated and removed in a grid around the player's current position.
// As the player moves, new stars are created ahead of them and old ones behind them are removed.
// This ensures the starfield is always visible no matter how far the player travels.


/**
 * Player-following starfield background for Phaser scenes.
 * Stars are always generated around player position, ensuring consistent density.
 */
/**
 * Player-following starfield background for Phaser scenes.
 * Stars are always generated around player position, ensuring consistent density.
 */
export default class StarfieldParallax {
  /**
   * @param {Phaser.Scene} scene - The parent scene
   * @param {object} [opts]
   * @param {number} [opts.width=scene.scale.width]
   * @param {number} [opts.height=scene.scale.height]
   * @param {number} [opts.density=1.5] - Stars per 1000×1000 pixel area (higher = more stars)
   * @param {number} [opts.layers=3] - Number of parallax layers
   * @param {number[]} [opts.sizes=[3,5,7]] - Star sizes per layer
   * @param {string[][]} [opts.colors] - Array of hex color strings per layer
   * @param {number[]} [opts.speeds=[0.05,0.1,0.25]] - Parallax speed factors (0=static, 1=full scroll)
   * @param {number} [opts.depth=-100] - Phaser depth (z-order)
   * @param {number} [opts.cellSize=500] - Size of each cell in the grid
   * @param {number} [opts.visibleBuffer=2] - Number of cells beyond visible area to fill with stars
   */
  /**
   * @param {Phaser.Scene} scene - The parent scene
   * @param {object} [opts]
   * @param {number} [opts.width=scene.scale.width]
   * @param {number} [opts.height=scene.scale.height]
   * @param {number} [opts.density=1.5] - Stars per 1000×1000 pixel area (higher = more stars)
   * @param {number} [opts.layers=3] - Number of parallax layers
   * @param {number[]} [opts.sizes=[3,5,7]] - Star sizes per layer
   * @param {string[][]} [opts.colors] - Array of hex color strings per layer
   * @param {number[]} [opts.speeds=[0.05,0.1,0.25]] - Parallax speed factors (0=static, 1=full scroll)
   * @param {number} [opts.depth=-100] - Phaser depth (z-order)
   * @param {number} [opts.cellSize=500] - Size of each cell in the grid
   * @param {number} [opts.visibleBuffer=2] - Number of cells beyond visible area to fill with stars
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    
    // Configuration
    this.width = opts.width || scene.scale.width;
    this.height = opts.height || scene.scale.height;
    this.density = opts.density || 1.5; // Stars per 1000×1000 pixel area
    this.layers = opts.layers || 3;
    this.sizes = opts.sizes || [3, 5, 7];
    this.cellSize = opts.cellSize || 500; // Size of each cell in pixels
    this.visibleBuffer = opts.visibleBuffer || 2; // Extra cells beyond visible area
    this.colors = opts.colors || [
      ['#ffe066', '#fffbe6'], // Layer 0: yellow/white
      ['#00eaff', '#82f7ff'], // Layer 1: cyan/blue
      ['#d500f9', '#ff57e6'], // Layer 2: magenta/pink
    ];
    this.speeds = opts.speeds || [0.05, 0.1, 0.25];
    this.depthValue = opts.depth !== undefined ? opts.depth : -100;
    
    // Create star textures
    this.starTextures = this.createStarTextures();
    
    // Map of active star cells: { 'x,y': [sprites] }
    this.activeCells = new Map();
    
    // Stars per cell based on density and cell size
    this.starsPerCell = Math.ceil(this.density * (this.cellSize * this.cellSize) / 1000000);
    
    // Track last player position to identify when to update cells
    this.lastPlayerPos = { x: -999999, y: -999999 };
    
    // Initialize with (0,0) as center - will be updated on first update() call
    this.updateVisibleCells(0, 0);
    
    console.log(`Created player-following starfield with ${this.starsPerCell} stars per ${this.cellSize}×${this.cellSize} cell`);
  }
  
  /**
   * Create stars for a specific cell
   * @param {number} cellX - Cell X coordinate
   * @param {number} cellY - Cell Y coordinate
   * @private
   */
  /**
   * Create stars for a specific cell.
   * @param {number} cellX - Cell X coordinate
   * @param {number} cellY - Cell Y coordinate
   * @private
   */
  _createStarsForCell(cellX, cellY) {
    // Check if cell already exists
    const cellKey = `${cellX},${cellY}`;
    if (this.activeCells.has(cellKey)) {
      return;
    }
    
    // Create stars for this cell
    const cellStars = [];
    const starsPerLayer = Math.ceil(this.starsPerCell / this.layers);
    
    // Calculate cell's world position (top-left corner)
    const cellWorldX = cellX * this.cellSize;
    const cellWorldY = cellY * this.cellSize;
    
    for (let layer = 0; layer < this.layers; layer++) {
      const colors = this.colors[layer % this.colors.length];
      const size = this.sizes[layer % this.sizes.length];
      const starTexture = this.starTextures[size];
      
      for (let i = 0; i < starsPerLayer; i++) {
        // Position randomly within this cell
        const offsetX = Math.random() * this.cellSize;
        const offsetY = Math.random() * this.cellSize;
        const x = cellWorldX + offsetX;
        const y = cellWorldY + offsetY;
        
        // Random color from layer's palette
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        // Create sprite with the right texture and set its properties
        const star = this.scene.add.sprite(x, y, starTexture);
        star.setDepth(this.depthValue);
        star.setTint(Phaser.Display.Color.HexStringToColor(color).color);
        star.layer = layer; // Store layer for parallax
        star.cellKey = cellKey; // Track which cell this star belongs to
        star.worldX = x; // Original world position
        star.worldY = y;
        
        cellStars.push(star);
      }
    }
    
    // Store the cell stars
    this.activeCells.set(cellKey, cellStars);
    
    // Log occasionally
    if (Math.random() < 0.1) {
      let totalStars = 0;
      this.activeCells.forEach(stars => totalStars += stars.length);
      console.log(`Added cell (${cellX},${cellY}) - Total cells: ${this.activeCells.size}, Total stars: ${totalStars}`);
    }
  }
  
  /**
   * Create circle textures for different star sizes
   * @returns {Object} Map of star sizes to texture keys
   */
  /**
   * Create circle textures for different star sizes.
   * @returns {Object} Map of star sizes to texture keys
   */
  createStarTextures() {
    const textures = {};
    
    // Create textures for each star size
    for (const size of this.sizes) {
      const textureKey = `star${size}`;
      
      // Skip if texture already exists
      if (this.scene.textures.exists(textureKey)) {
        textures[size] = textureKey;
        continue;
      }
      
      // Create canvas for this size
      const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });
      
      // Draw white circle (will be tinted later) with slight glow
      graphics.fillStyle(0xffffff, 0.8);
      graphics.fillCircle(size + 1, size + 1, size);
      graphics.fillStyle(0xffffff, 0.4);
      graphics.fillCircle(size + 1, size + 1, size + 1);
      
      // Generate texture from canvas
      graphics.generateTexture(textureKey, (size + 1) * 2 + 2, (size + 1) * 2 + 2);
      graphics.destroy();
      
      textures[size] = textureKey;
    }
    
    return textures;
  }

  /**
   * Update which cells are visible based on player position
   * @param {number} playerX - Player's world X position
   * @param {number} playerY - Player's world Y position 
   */
  /**
   * Update which cells are visible based on player position.
   * @param {number} playerX - Player's world X position
   * @param {number} playerY - Player's world Y position
   */
  updateVisibleCells(playerX, playerY) {
    // Get current cell coordinates
    const currentCellX = Math.floor(playerX / this.cellSize);
    const currentCellY = Math.floor(playerY / this.cellSize);
    
    // Only update if player moved to a new cell
    const sameCell = currentCellX === Math.floor(this.lastPlayerPos.x / this.cellSize) && 
                     currentCellY === Math.floor(this.lastPlayerPos.y / this.cellSize);
    
    if (sameCell) return;
    
    // Calculate visible range based on player position and viewport size
    const visibleCellsX = Math.ceil(this.width / this.cellSize) + this.visibleBuffer * 2;
    const visibleCellsY = Math.ceil(this.height / this.cellSize) + this.visibleBuffer * 2;
    
    const minCellX = currentCellX - Math.floor(visibleCellsX / 2);
    const maxCellX = currentCellX + Math.ceil(visibleCellsX / 2);
    const minCellY = currentCellY - Math.floor(visibleCellsY / 2);
    const maxCellY = currentCellY + Math.ceil(visibleCellsY / 2);
    
    // Remember cells we need to keep (in visible range)
    const neededCells = new Set();
    
    // Create stars for all cells in the visible range
    for (let x = minCellX; x <= maxCellX; x++) {
      for (let y = minCellY; y <= maxCellY; y++) {
        const cellKey = `${x},${y}`;
        neededCells.add(cellKey);
        this._createStarsForCell(x, y);
      }
    }
    
    // Remove cells that are no longer visible
    const cellsToRemove = [];
    this.activeCells.forEach((stars, cellKey) => {
      if (!neededCells.has(cellKey)) {
        cellsToRemove.push(cellKey);
      }
    });
    
    for (const cellKey of cellsToRemove) {
      const stars = this.activeCells.get(cellKey);
      // Destroy each sprite
      for (const star of stars) {
        star.destroy();
      }
      this.activeCells.delete(cellKey);
    }
    
    // Update player position
    this.lastPlayerPos.x = playerX;
    this.lastPlayerPos.y = playerY;
    
    // Occasional debug logging
    if (cellsToRemove.length > 0 && Math.random() < 0.2) {
      let totalStars = 0;
      this.activeCells.forEach(stars => totalStars += stars.length);
      console.log(`Updated cells: Added ${neededCells.size - (this.activeCells.size - cellsToRemove.length)}, Removed ${cellsToRemove.length}`);
      console.log(`Active cells: ${this.activeCells.size}, Total stars: ${totalStars}`);
    }
  }
  
  /**
   * Position all stars with parallax effect
   * @param {number} camX - Camera X position
   * @param {number} camY - Camera Y position
   */
  /**
   * Position all stars with parallax effect.
   * @param {number} camX - Camera X position
   * @param {number} camY - Camera Y position
   */
  updateStarPositions(camX, camY) {
    let visibleStars = 0;
    const viewWidth = this.width;
    const viewHeight = this.height;
    
    // Update all stars from all active cells
    this.activeCells.forEach(stars => {
      for (const star of stars) {
        // Apply parallax effect based on layer
        const parallaxFactor = this.speeds[star.layer % this.speeds.length];
        
        // Set new position relative to camera with parallax
        star.x = (star.worldX - camX) + camX; // Readd parallax someday when I can get it working right
        star.y = (star.worldY - camY) + camY; // Readd parallax someday when I can get it working right

        
        // Count stars in visible area
        if (star.x >= 0 && star.x <= viewWidth && 
            star.y >= 0 && star.y <= viewHeight) {
          visibleStars++;
        }
      }
    });
    
    // Debug info (occasional logging)
    if (Math.random() < 0.01) {
      let totalStars = 0;
      this.activeCells.forEach(stars => totalStars += stars.length);
      console.log(`Stars visible: ${visibleStars}/${totalStars} at cam (${Math.floor(camX)},${Math.floor(camY)})`);
    }
  }

  /**
   * Call this in your scene's update(), passing the camera and player position
   * @param {Phaser.Cameras.Scene2D.Camera} [camera]
   * @param {Phaser.GameObjects.GameObject} [player] - The player object (used for position)
   */
  /**
   * Call this in your scene's update(), passing the camera and player position.
   * @param {Phaser.Cameras.Scene2D.Camera} [camera]
   * @param {Phaser.GameObjects.GameObject} [player] - The player object (used for position)
   */
  update(camera, player) {
    // Get camera position, defaulting to (0,0) if camera not provided
    let camX = 0, camY = 0;
    let playerX = 0, playerY = 0;
    
    if (camera) {
      camX = camera.scrollX;
      camY = camera.scrollY;
    } else if (this.scene && this.scene.cameras && this.scene.cameras.main) {
      const mainCam = this.scene.cameras.main;
      camX = mainCam.scrollX;
      camY = mainCam.scrollY;
    }
    
    // Get player position if provided
    if (player) {
      playerX = player.x;
      playerY = player.y;
    } else {
      // If no player provided, use camera center as player position
      playerX = camX + this.width / 2;
      playerY = camY + this.height / 2;
    }
    
    // Update which cells are visible based on camera center (not player), so stars always fill the visible screen
    const camCenterX = camX + this.width / 2;
    const camCenterY = camY + this.height / 2;
    this.updateVisibleCells(camCenterX, camCenterY);
    
    // Update star positions based on camera
    this.updateStarPositions(camX, camY);
  }
  
  /**
   * Set depth (z-index) for all stars
   * @param {number} depth - Depth value
   */
  /**
   * Set depth (z-index) for all stars.
   * @param {number} depth - Depth value
   * @returns {StarfieldParallax} This instance for chaining
   */
  setDepth(depth) {
    this.depthValue = depth;
    
    // Update all stars in all cells
    this.activeCells.forEach(stars => {
      for (const star of stars) {
        star.setDepth(depth);
      }
    });
    
    return this;
  }
  
  /**
   * Clean up all stars when no longer needed
   */
  /**
   * Clean up all stars when no longer needed.
   */
  destroy() {
    // Destroy all stars in all cells
    this.activeCells.forEach(stars => {
      for (const star of stars) {
        star.destroy();
      }
    });
    
    this.activeCells.clear();
    console.log('Starfield destroyed');
  }
}
