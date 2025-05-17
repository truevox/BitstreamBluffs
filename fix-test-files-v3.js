/**
 * Fix Jest test files script (v3)
 * 
 * Focuses specifically on the duplicate brackets issue in mock statements
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
    await fs.writeFile(`${filePath}.bak-v3`, content);
    
    // Track if file was modified
    let modified = false;
    
    // 1. Fix the "=> ({ ({" syntax error in jest.mock calls
    const brokenMockRegex = /jest\.mock\(['"]([^'"]+)['"]\s*,\s*\(\)\s*=>\s*\(\{\s*\(\{/g;
    if (brokenMockRegex.test(content)) {
      content = content.replace(brokenMockRegex, "jest.mock('$1', () => ({");
      modified = true;
    }
    
    // 2. Another variation of the broken mock pattern
    const brokenMockRegex2 = /jest\.mock\(['"]([^'"]+)['"]\s*,\s*\(\)/g;
    if (brokenMockRegex2.test(content) && content.includes("=> ({ ({")) {
      content = content.replace(/\(\)\s*\n+\s*\/\/\s*Get the mocked modules[\s\S]*?=>\s*\(\{\s*\(\{/g, "() => ({");
      modified = true;
    }
    
    // 3. Remove "const PhysicsConfig = PhysicsConfig;" lines
    if (content.includes("const PhysicsConfig = PhysicsConfig;")) {
      content = content.replace(/const\s+PhysicsConfig\s*=\s*PhysicsConfig;/g, "");
      modified = true;
    }
    
    // 4. Update jest.setTimeout to use a reasonable default (5000ms)
    if (content.includes('jest.setTimeout(')) {
      content = content.replace(/jest\.setTimeout\(\d+\)/g, 'jest.setTimeout(5000)');
      modified = true;
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
