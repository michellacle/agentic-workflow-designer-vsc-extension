import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    root: './webview',
    server: {
        port: 5173,
        open: '/standalone.html'
    },
    resolve: {
        alias: {
            // Resolve webview src imports
            '@webview': path.resolve(__dirname, 'webview/src')
        }
    },
    optimizeDeps: {
        exclude: []
    }
});
