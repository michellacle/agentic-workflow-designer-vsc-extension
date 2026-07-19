const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Compile TypeScript
const srcDir = path.join(__dirname, '..', 'webview', 'src');
const distDir = path.join(__dirname, '..', 'webview', 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Compile TypeScript
console.log('Compiling webview TypeScript...');
try {
    execSync('npx tsc -p ./webview/src/tsconfig.json', {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
    });
} catch (e) {
    console.error('TypeScript compilation failed!');
    process.exit(1);
}

// Copy CSS (not compiled by TypeScript)
const cssSrc = path.join(srcDir, 'designer.css');
const cssDest = path.join(distDir, 'designer.css');
if (fs.existsSync(cssSrc)) {
    fs.copyFileSync(cssSrc, cssDest);
    console.log(`Copied designer.css to dist/`);
}

console.log('Webview build complete!');
