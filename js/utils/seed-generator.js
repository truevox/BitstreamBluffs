// js/utils/seed-generator.js
// Utility for generating and managing game seeds for Bitstream Bluffs
// ----------------------------------------------------------------

/**
 * Generates a deterministic game seed using the current time and Math.random
 * Uses SHA-256 when available, with fallback to FNV-1a
 * 
 * @returns {string} A hash string to use as the game seed
 */
export function generateGameSeed() {
    // If we have an early generated seed, use it
    if (earlyGenerationComplete && earlyGeneratedSeed) {
        console.log('Using pre-computed seed:', earlyGeneratedSeed);
        return earlyGeneratedSeed;
    }
    
    // Otherwise generate a new seed
    const timestamp = new Date().toISOString();
    const randomValue = Math.random().toString(36).substring(2);
    const seedSource = `${timestamp}-${randomValue}`;
    
    // Try SHA-256 first, fallback to FNV-1a
    return sha256WithFallback(seedSource);
}

/**
 * Initialize the random number generator with a specific seed string
 * Makes terrain generation and other random elements deterministic
 * 
 * @param {string} seedString - The seed string to initialize the RNG with
 * @returns {function} A seeded random function that returns values between 0-1
 */
export function initializeRandomWithSeed(seedString) {
    // Convert seed string to numeric value for the algorithm
    let numericSeed = stringToNumericSeed(seedString);
    
    // Return a mulberry32 algorithm implementation - fast and with good distribution
    return function() {
        // Mulberry32 algorithm provides excellent statistical properties
        numericSeed += 0x6D2B79F5;
        let t = numericSeed;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/**
 * Converts a string to a numeric seed value
 * 
 * @param {string} str - Input string to convert to numeric seed
 * @returns {number} Numeric seed value suitable for PRNG initialization
 */
function stringToNumericSeed(str) {
    let hash = 1779033703 ^ str.length;  // Use a prime number for better distribution
    
    for(let i = 0; i < str.length; i++) {
        hash = Math.imul(hash ^ str.charCodeAt(i), 3432918353);
        hash = hash << 13 | hash >>> 19;
    }
    
    // Return positive integer
    return hash >>> 0;
}

// Flag to indicate whether SHA-256 is available
let sha256Available = false;

// Cached seed value - updated when SHA-256 is computed
let cachedSeed = null;
let initialSeedSource = null;

// Early-generated seed for faster startup
let earlyGeneratedSeed = null;
let earlyGenerationComplete = false;

// Start early generation if the flag is set
if (typeof window !== 'undefined' && window.earlySeedGeneration) {
    console.log('Starting early seed generation...');
    // Start computing a seed immediately
    const timestamp = new Date().toISOString();
    const randomValue = Math.random().toString(36).substring(2);
    const seedSource = `${timestamp}-${randomValue}`;
    
    // Start SHA-256 calculation in the background
    if (window.crypto && window.crypto.subtle && window.isSecureContext) {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(seedSource);
            
            window.crypto.subtle.digest('SHA-256', data)
                .then(hashBuffer => {
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                    console.log('Early SHA-256 seed generated:', hashHex);
                    
                    // Store the early generated seed
                    earlyGeneratedSeed = hashHex;
                    initialSeedSource = seedSource; // Store the source for consistency
                    earlyGenerationComplete = true;
                    sha256Available = true;
                })
                .catch(error => {
                    console.error('Early SHA-256 generation failed:', error);
                    // Fall back to FNV-1a
                    earlyGeneratedSeed = fnv1aHash(seedSource);
                    initialSeedSource = seedSource;
                    earlyGenerationComplete = true;
                });
        } catch (err) {
            console.warn('Early seed generation error:', err);
        }
    }
}

/**
 * Hash using SHA-256 when available, with fallback to FNV-1a
 *
 * @param {string} input - Input string to hash
 * @returns {string} Hexadecimal hash string
 */
function sha256WithFallback(input) {
    // Store the initial seed source for potential later use
    initialSeedSource = input;
    
    // Check if we can use the Web Crypto API
    if (window.crypto && window.crypto.subtle && window.isSecureContext) {
        try {
            // Since we have Web Crypto API, attempt to use it for SHA-256
            const encoder = new TextEncoder();
            const data = encoder.encode(input);
            
            // Create and return a promise that resolves to the SHA-256 hash
            const promise = window.crypto.subtle.digest('SHA-256', data)
                .then(hashBuffer => {
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                    console.log('Generated SHA-256 seed:', hashHex);
                    
                    // Update the cached seed and indicate SHA-256 is available
                    cachedSeed = hashHex;
                    sha256Available = true;
                    
                    // Update the displayed seed if possible
                    updateDisplayedSeed(hashHex);
                    
                    return hashHex;
                })
                .catch(error => {
                    console.error('SHA-256 failed, using FNV-1a fallback:', error);
                    return fnv1aHash(input);
                });
            
            // For now, return the FNV-1a hash, but the real SHA-256 will replace it soon
            // This is necessary because Web Crypto API is asynchronous
            cachedSeed = fnv1aHash(input);
            return cachedSeed;
        } catch (err) {
            console.warn('Web Crypto API error, using FNV-1a:', err);
            cachedSeed = fnv1aHash(input);
            return cachedSeed;
        }
    } else {
        // Fallback to FNV-1a if Web Crypto isn't available
        console.log('Web Crypto not available, using FNV-1a');
        cachedSeed = fnv1aHash(input);
        return cachedSeed;
    }
}

/**
 * Updates the displayed seed in the UI if the game has started
 * This is called when SHA-256 calculation completes
 */
function updateDisplayedSeed(newSeed) {
    // Store the seed in the global space
    window.gameSeed = newSeed;
    
    // Find any active Phaser scene that might be displaying the seed
    if (window.game && window.game.scene) {
        const startScene = window.game.scene.getScene('StartScene');
        if (startScene && startScene.seed) {
            // Update the seed in the StartScene
            startScene.seed = newSeed;
            
            // Try to find and update the seed display text
            startScene.children?.list?.forEach(child => {
                if (child.text && child.text.includes('SEED:')) {
                    child.setText('SEED: ' + newSeed);
                }
            });
        }
    }
}

/**
 * Simple FNV-1a hash implementation
 * Fast and sufficient for game seeds when SHA-256 isn't available
 * 
 * @param {string} input - Input string to hash
 * @returns {string} Hexadecimal hash string
 */
function fnv1aHash(input) {
    // Use the FNV-1a algorithm for simplicity and speed
    let hash = 2166136261; // FNV offset basis
    
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    
    // Format like SHA-256 for consistency (pad to 64 chars)
    // Put zeros AFTER the hash value as requested
    const hashHex = (hash >>> 0).toString(16);
    return hashHex + '0'.repeat(64 - hashHex.length);
}
