#!/bin/bash
# CareerAdapt AI Quick Start Script
# Usage: bash scripts/quick-start.sh

echo "=== CareerAdapt AI Quick Start ==="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js not found. Please install Node.js >= 18"
    exit 1
fi
echo "Node.js version: $(node --version)"

# Check pnpm
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm not found. Please install pnpm >= 8"
    exit 1
fi
echo "pnpm version: $(pnpm --version)"

# Install dependencies
echo ""
echo "Installing dependencies..."
pnpm install
if [ $? -ne 0 ]; then
    echo "Error: Failed to install dependencies"
    exit 1
fi

# Run verification
echo ""
echo "Running verification..."
pnpm verify
if [ $? -ne 0 ]; then
    echo "Warning: Verification failed. Check the output above."
else
    echo "Verification passed!"
fi

# Start dev server
echo ""
echo "Starting development server..."
echo "Open http://localhost:3000 in your browser"
pnpm dev
