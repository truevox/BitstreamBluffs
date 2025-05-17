// config-loader.js
// Central configuration loading system for Bitstream Bluffs
// Handles loading of various config files and provides access to them

class ConfigLoader {
    constructor() {
        this.debuggingOn = this.isDebuggingEnabled();
        this.configLoaded = false;
        
        console.log('Config loaded successfully:', {
            debuggingOn: this.debuggingOn
        });
    }
    
    // Detects if we're in debug mode based on URL parameters
    isDebuggingEnabled() {
        // First check URL parameters
        if (typeof window !== 'undefined' && window.location) {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('debug')) {
                return true;
            }
        }
        
        // Default to off in production, on in development
        const host = window.location.hostname;
        return host === 'localhost' || host === '127.0.0.1';
    }
}

// Create a singleton instance
const configLoader = new ConfigLoader();

// Export the singleton
export default configLoader;
