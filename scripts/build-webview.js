const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'webview', 'src');
const distDir = path.join(root, 'webview', 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

// Compile TypeScript first (type checking + .js output)
console.log('Compiling webview TypeScript...');
try {
    execSync('npx tsc -p ./webview/src/tsconfig.json', {
        cwd: root,
        stdio: 'inherit'
    });
} catch (e) {
    console.error('TypeScript compilation failed!');
    process.exit(1);
}

// Bundle with esbuild for VS Code webview (single IIFE file)
console.log('Bundling with esbuild...');
esbuild.build({
    entryPoints: [path.join(srcDir, 'designer.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'WorkflowDesigner',
    outfile: path.join(distDir, 'designer.js'),
    target: ['es2020'],
    minify: false,
    sourcemap: false,
    platform: 'browser',
}).catch((err) => {
    console.error('esbuild bundling failed!', err);
    process.exit(1);
});

// Copy CSS (not compiled by TypeScript)
const cssSrc = path.join(srcDir, 'designer.css');
const cssDest = path.join(distDir, 'designer.css');
if (fs.existsSync(cssSrc)) {
    fs.copyFileSync(cssSrc, cssDest);
    console.log(`Copied designer.css to dist/`);
}

console.log('Webview build complete!');
