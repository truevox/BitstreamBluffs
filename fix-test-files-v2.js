/**
 * Improved script to fix Jest test files for ES Module compatibility
 * 
 * Focuses on properly handling jest.mock statements
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
    
    // Create a backup before modifications
    await fs.writeFile(`${filePath}.bak-orig`, content);
    
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
    
    // 2. Fix the jest.mock statements - this is the critical part
    // Look for broken jest.mock calls with syntax errors
    const mockRegex = /jest\.mock\(['"]([^'"]+)['"]\s*,\s*\(\)\s*\n+\s*\/\/\s*Get the mocked modules\s*\n+\s*const\s+([A-Za-z0-9_]+)\s*=\s*jest\.requireMock\(['"][^'"]+['"]\);\s*\n+\s*=>/g;
    
    if (mockRegex.test(content)) {
      // Reset regex to start from beginning
      mockRegex.lastIndex = 0;
      
      // Replace the broken mock statements with corrected versions
      content = content.replace(mockRegex, (match, mockPath, varName) => {
        return `jest.mock('${mockPath}', () => ({`;
      });
      
      modified = true;
    }
    
    // 3. Fix the PhysicsConfig reference issues in functions
    // Replace: const PhysicsConfig = PhysicsConfig;
    content = content.replace(/const\s+PhysicsConfig\s*=\s*PhysicsConfig;/g, '');
    
    // 4. Update jest.setTimeout to use a reasonable default (5000ms)
    if (content.includes('jest.setTimeout(')) {
      content = content.replace(/jest\.setTimeout\(\d+\)/g, 'jest.setTimeout(5000)');
      modified = true;
    }
    
    // 5. Add the proper requireMock statements after all jest.mock statements
    // First, collect all the mock paths
    const allMockPaths = [];
    const basicMockRegex = /jest\.mock\(['"]([^'"]+)['"]/g;
    let match;
    
    while ((match = basicMockRegex.exec(content)) !== null) {
      allMockPaths.push(match[1]);
    }
    
    // If we have mocks but no requireMock statements, add them
    if (allMockPaths.length > 0 && !content.includes('jest.requireMock(')) {
      let requireStatements = '\n\n// Get the mocked modules\n';
      
      allMockPaths.forEach(mockPath => {
        // Extract the variable name from path
        const parts = mockPath.split('/');
        const lastPart = parts[parts.length - 1].replace('.js', '');
        // Convert kebab-case to camelCase or PascalCase as appropriate
        let varName = lastPart.split('-').map((part, index) => {
          if (lastPart.includes('config') && lastPart.includes('-config')) {
            // For config files, use PascalCase
            return part.charAt(0).toUpperCase() + part.slice(1);
          } else {
            // For other files, use camelCase
            return index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1);
          }
        }).join('');
        
        requireStatements += `const ${varName} = jest.requireMock('${mockPath}');\n`;
      });
      
      // Find the last jest.mock call to insert after
      const lastMockIndex = content.lastIndexOf('jest.mock(');
      if (lastMockIndex !== -1) {
        // Find the end of the mock block
        let endIndex = content.indexOf(');', lastMockIndex);
        if (endIndex !== -1) {
          endIndex += 2; // Include the ');'
          
          // Add the require statements
          content = 
            content.substring(0, endIndex) + 
            requireStatements + 
            content.substring(endIndex);
          
          modified = true;
        }
      }
    }
    
    // Save changes if modified
    if (modified) {
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
