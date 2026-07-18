const fs = require('fs');
const path = require('path');

// Simple build script - copies webview source to dist
const srcDir = path.join(__dirname, '..', 'webview', 'src');
const distDir = path.join(__dirname, '..', 'webview', 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Copy JS and CSS files
for (const file of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(distDir, file);
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied ${file} to dist/`);
}

console.log('Webview build complete!');
