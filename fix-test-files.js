/**
 * Automated script to fix Jest test files for ES Module compatibility
 * 
 * This script:
 * 1. Adds Jest function imports
 * 2. Fixes mock handling with jest.requireMock()
 * 3. Updates common patterns that cause issues
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test directory to scan
const TEST_DIR = path.join(__dirname, 'tests');

// Get all test files recursively
async function findTestFiles(dir) {
  const files = await fs.readdir(dir, { withFileTypes: true });
  
  const testFiles = await Promise.all(files.map(async (file) => {
    const filePath = path.join(dir, file.name);
    
    if (file.isDirectory()) {
      return findTestFiles(filePath);
    } else if (file.name.endsWith('.test.js')) {
      return filePath;
    } else {
      return [];
    }
  }));
  
  return testFiles.flat();
}

// Process a single test file
async function processTestFile(filePath) {
  console.log(`Processing: ${filePath}`);
  try {
    let content = await fs.readFile(filePath, 'utf8');
    
    // Track if file was modified
    let modified = false;
    
    // 1. Add Jest imports if they're missing
    if (!content.includes('import { jest')) {
      const importStatement = 'import { jest, describe, test, expect } from \'@jest/globals\';\n';
      
      // Find a good place to add the import
      const importLines = content.match(/^import .+ from .+;$/gm) || [];
      
      if (importLines.length > 0) {
        const lastImport = importLines[importLines.length - 1];
        const lastImportIndex = content.indexOf(lastImport) + lastImport.length;
        
        // Insert after the last import
        content = 
          content.substring(0, lastImportIndex) + 
          '\n' + importStatement + 
          content.substring(lastImportIndex);
      } else {
        // No imports found, add to the top (after any comments or pragma)
        const lines = content.split('\n');
        let insertIndex = 0;
        
        // Skip over initial comments
        while (insertIndex < lines.length && 
              (lines[insertIndex].trim().startsWith('//') || 
               lines[insertIndex].trim().startsWith('/*') ||
               lines[insertIndex].trim() === '')) {
          insertIndex++;
        }
        
        lines.splice(insertIndex, 0, importStatement);
        content = lines.join('\n');
      }
      
      modified = true;
    }
    
    // 2. Fix jest.mock calls - ES modules need mocks before imports
    const mockRegex = /jest\.mock\(['"](.*)['"]/g;
    let mockMatches;
    const mockPaths = [];
    
    while ((mockMatches = mockRegex.exec(content)) !== null) {
      mockPaths.push(mockMatches[1]);
    }
    
    // 3. Add requireMock statements for each mock
    if (mockPaths.length > 0 && !content.includes('jest.requireMock(')) {
      let requireStatements = '';
      
      mockPaths.forEach(mockPath => {
        // Extract the variable name from path
        const parts = mockPath.split('/');
        const lastPart = parts[parts.length - 1].replace('.js', '');
        // Convert kebab-case to camelCase
        let varName = lastPart.split('-').map((part, index) => 
          index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
        ).join('');
        
        // Special case for 'config/physics-config.js' -> PhysicsConfig
        if (varName === 'physicsConfig') {
          varName = 'PhysicsConfig';
        }
        
        requireStatements += `const ${varName} = jest.requireMock('${mockPath}');\n`;
      });
      
      // Find a good spot to add requireMock statements
      const lastMockIndex = content.lastIndexOf('jest.mock(');
      if (lastMockIndex !== -1) {
        // Find the end of the mock block
        const endIndex = content.indexOf(')', lastMockIndex) + 1;
        
        // Add a blank line and then the require statements
        content = 
          content.substring(0, endIndex) + 
          '\n\n// Get the mocked modules\n' + requireStatements + 
          content.substring(endIndex);
        
        modified = true;
      }
    }
    
    // 4. Fix common pattern of accessing `require('../path')` directly
    // This pattern doesn't work in ES modules, so replace with the requireMock variable
    mockPaths.forEach(mockPath => {
      const requirePattern = new RegExp(`require\\(['"](${mockPath.replace(/\//g, '\\/').replace(/\./g, '\\.')})['"]\\)`, 'g');
      
      // Extract variable name as we did before
      const parts = mockPath.split('/');
      const lastPart = parts[parts.length - 1].replace('.js', '');
      let varName = lastPart.split('-').map((part, index) => 
        index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
      ).join('');
      
      // Special case for 'config/physics-config.js' -> PhysicsConfig
      if (varName === 'physicsConfig') {
        varName = 'PhysicsConfig';
      }
      
      // Replace require calls with variable reference
      if (content.match(requirePattern)) {
        content = content.replace(requirePattern, varName);
        modified = true;
      }
    });
    
    // 5. Update jest.setTimeout to use a reasonable default (5000ms)
    if (content.includes('jest.setTimeout(')) {
      content = content.replace(/jest\.setTimeout\(\d+\)/g, 'jest.setTimeout(5000)');
      modified = true;
    }
    
    // Save changes if modified
    if (modified) {
      // Create a backup just in case
      await fs.writeFile(`${filePath}.bak`, content);
      await fs.writeFile(filePath, content);
      console.log(`✅ Updated: ${filePath}`);
      return true;
    } else {
      console.log(`⏭️ No changes needed: ${filePath}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error);
    return false;
  }
}

// Main function
async function main() {
  try {
    console.log('🔍 Scanning for test files...');
    const testFiles = await findTestFiles(TEST_DIR);
    console.log(`Found ${testFiles.length} test files`);
    
    let modifiedCount = 0;
    for (const file of testFiles) {
      const wasModified = await processTestFile(file);
      if (wasModified) modifiedCount++;
    }
    
    console.log(`✅ Completed! Modified ${modifiedCount} of ${testFiles.length} files.`);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

main();
