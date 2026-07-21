const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.join(__dirname, '..');
const srcDir = path.join(rootDir, 'webview', 'src');
const distDir = path.join(rootDir, 'webview', 'dist');
const cssSrc = path.join(srcDir, 'designer.css');
const cssDest = path.join(distDir, 'designer.css');

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

function copyCss() {
    if (fs.existsSync(cssSrc)) {
        fs.copyFileSync(cssSrc, cssDest);
        console.log('[watch-webview] Copied designer.css');
    }
}

copyCss();

const tsc = spawn('npx', ['tsc', '-p', './webview/src/tsconfig.json', '--watch', '--preserveWatchOutput'], {
    cwd: rootDir,
    stdio: 'inherit'
});

tsc.on('error', (error) => {
    console.error('[watch-webview] Failed to start tsc watch:', error);
    process.exit(1);
});

tsc.on('exit', (code) => {
    console.log(`[watch-webview] tsc watch exited with code ${code ?? 'unknown'}`);
    process.exit(code ?? 1);
});

// Mirror CSS changes without consuming extra OS file-watch handles.
let lastCssMtimeMs = fs.existsSync(cssSrc) ? fs.statSync(cssSrc).mtimeMs : 0;
const cssPollInterval = setInterval(() => {
    try {
        if (!fs.existsSync(cssSrc)) return;
        const nextMtime = fs.statSync(cssSrc).mtimeMs;
        if (nextMtime !== lastCssMtimeMs) {
            lastCssMtimeMs = nextMtime;
            copyCss();
        }
    } catch (error) {
        console.error('[watch-webview] CSS poll failed:', error);
    }
}, 750);

process.on('SIGINT', () => {
    clearInterval(cssPollInterval);
    tsc.kill('SIGINT');
    process.exit(0);
});

process.on('SIGTERM', () => {
    clearInterval(cssPollInterval);
    tsc.kill('SIGTERM');
    process.exit(0);
});
