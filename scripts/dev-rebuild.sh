#!/bin/bash
# Quick rebuild script for development
# Usage: ./scripts/dev-rebuild.sh

cd "$(dirname "$0")/.."

echo "🔨 Rebuilding extension..."

# Compile TypeScript
npm run compile > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ TypeScript compilation failed"
    npm run compile
    exit 1
fi

# Build webview
npm run build-webview > /dev/null 2>&1

echo "✅ Rebuild complete! Press Ctrl+Shift+P → 'Developer: Reload Window' in VS Code"
