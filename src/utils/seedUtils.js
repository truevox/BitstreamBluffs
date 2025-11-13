/**
 * Seed utilities for deterministic procedural generation
 * Allows players to share seeds for identical terrain layouts
 */

/**
 * Generate a random seed string (8 alphanumeric characters)
 */
export function generateSeed() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let seed = '';
    for (let i = 0; i < 8; i++) {
        seed += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return seed;
}

/**
 * Convert seed string to a numeric hash
 */
function seedToHash(seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
}

/**
 * Create a seeded pseudo-random number generator
 * Uses a simple Linear Congruential Generator (LCG)
 *
 * @param {string} seed - Seed string
 * @returns {function} Random function that returns 0-1
 */
export function seededRandom(seed) {
    let state = seedToHash(seed);

    return function() {
        // LCG parameters (from Numerical Recipes)
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF;
        return (state >>> 0) / 0xFFFFFFFF;
    };
}

/**
 * Parse a seed from user input (validates format)
 */
export function parseSeed(input) {
    const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length === 8) {
        return cleaned;
    }
    return null; // Invalid seed
}

/**
 * Create a shareable seed URL
 */
export function createSeedURL(seed) {
    const baseURL = window.location.origin + window.location.pathname;
    return `${baseURL}?seed=${seed}`;
}

/**
 * Get seed from URL parameters
 */
export function getSeedFromURL() {
    const params = new URLSearchParams(window.location.search);
    const seed = params.get('seed');
    return seed ? parseSeed(seed) : null;
}
