// js/utils/config-loader.js
/**
 * Loads and parses the external config.txt file
 * Used to control debugging settings without modifying source code
 */
/**
 * Loads and parses the external config.txt file.
 * Used to control debugging settings without modifying source code.
 */
class ConfigLoader {
    /**
     * Creates a new ConfigLoader instance and loads config.txt.
     */
    constructor() {
        this.config = {
            debuggingOn: 0 // Default to debugging off
        };
        this.configLoaded = false;
        this.loadConfig();
    }

    /**
     * Loads the config.txt file and parses it for configuration settings
     * File format expected to be simple key=value pairs, one per line
     * e.g., debuggingOn=1
     */
    /**
     * Loads the config.txt file and parses it for configuration settings.
     * File format expected to be simple key=value pairs, one per line.
     * e.g., debuggingOn=1
     */
    async loadConfig() {
        try {
            // Using fetch API which works better with modules
            const response = await fetch('config.txt');
            
            if (response.ok) {
                // Parse the config file
                const configText = await response.text();
                const lines = configText.split('\n');
                
                for (const line of lines) {
                    const [key, value] = line.split('=').map(part => part.trim());
                    if (key && value !== undefined) {
                        this.config[key] = parseInt(value, 10);
                    }
                }
                
                this.configLoaded = true;
                console.log('Config loaded successfully:', this.config);
            } else {
                console.log('Config file not found, using default settings');
            }
        } catch (error) {
            console.log('Error loading config file, using default settings:', error);
        }
    }

    /**
     * Gets the debug flag based on the loaded configuration
     * @returns {boolean} True if debugging is enabled, false otherwise
     */
    /**
     * Gets the debug flag based on the loaded configuration.
     * @returns {boolean} True if debugging is enabled, false otherwise.
     */
    isDebuggingEnabled() {
        // Safely return the debug setting, defaulting to false if not loaded
        return this.config.debuggingOn === 1;
    }
}

// Create a singleton instance
const configLoader = new ConfigLoader();
