// js/utils/config-loader.js
/**
 * Loads and parses the external config.txt file
 * Used to control debugging settings without modifying source code
 */
class ConfigLoader {
    constructor() {
        this.config = {
            debuggingOn: 0 // Default to debugging off
        };
        this.loadConfig();
    }

    /**
     * Loads the config.txt file and parses it for configuration settings
     * File format expected to be simple key=value pairs, one per line
     * e.g., debuggingOn=1
     */
    loadConfig() {
        try {
            // Create an XMLHttpRequest to load the config file
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'config.txt', false); // Synchronous request
            xhr.send();
            
            if (xhr.status === 200) {
                // Parse the config file
                const configText = xhr.responseText;
                const lines = configText.split('\n');
                
                for (const line of lines) {
                    const [key, value] = line.split('=').map(part => part.trim());
                    if (key && value !== undefined) {
                        this.config[key] = parseInt(value, 10);
                    }
                }
                
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
    isDebuggingEnabled() {
        return this.config.debuggingOn === 1;
    }
}

// Create a singleton instance
const configLoader = new ConfigLoader();
