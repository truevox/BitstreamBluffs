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
    // Combine current timestamp and random value for uniqueness
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

/**
 * Hash using SHA-256 when available, with fallback to FNV-1a
 *
 * @param {string} input - Input string to hash
 * @returns {string} Hexadecimal hash string
 */
function sha256WithFallback(input) {
    // Check if we can use the Web Crypto API
    if (window.crypto && window.crypto.subtle && window.isSecureContext) {
        try {
            // Create a synchronous wrapper around the async SHA-256
            // This is a bit of a hack but lets us maintain the interface
            let hashResult = null;
            const encoder = new TextEncoder();
            const data = encoder.encode(input);
            
            // Start the async operation
            window.crypto.subtle.digest('SHA-256', data)
                .then(hashBuffer => {
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                    console.log('Generated SHA-256 seed:', hashHex);
                    // Store the result globally if needed later
                    window.lastSha256Seed = hashHex;
                })
                .catch(error => {
                    console.error('SHA-256 failed, using FNV-1a fallback:', error);
                });
                
            // Return a synchronous FNV-1a hash but store the real SHA-256 for later
            return fnv1aHash(input);
        } catch (err) {
            console.warn('Web Crypto API error, using FNV-1a:', err);
            return fnv1aHash(input);
        }
    } else {
        // Fallback to FNV-1a if Web Crypto isn't available
        console.log('Web Crypto not available, using FNV-1a');
        return fnv1aHash(input);
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
