# CareerAdapt AI Quick Start Script
# Usage: .\scripts\quick-start.ps1

Write-Host "=== CareerAdapt AI Quick Start ===" -ForegroundColor Cyan

# Check Node.js
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "Error: Node.js not found. Please install Node.js >= 18" -ForegroundColor Red
    exit 1
}
Write-Host "Node.js version: $nodeVersion" -ForegroundColor Green

# Check pnpm
$pnpmVersion = pnpm --version 2>$null
if (-not $pnpmVersion) {
    Write-Host "Error: pnpm not found. Please install pnpm >= 8" -ForegroundColor Red
    exit 1
}
Write-Host "pnpm version: $pnpmVersion" -ForegroundColor Green

# Install dependencies
Write-Host "`nInstalling dependencies..." -ForegroundColor Yellow
pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Failed to install dependencies" -ForegroundColor Red
    exit 1
}

# Run verification
Write-Host "`nRunning verification..." -ForegroundColor Yellow
pnpm verify
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: Verification failed. Check the output above." -ForegroundColor Yellow
} else {
    Write-Host "Verification passed!" -ForegroundColor Green
}

# Start dev server
Write-Host "`nStarting development server..." -ForegroundColor Yellow
Write-Host "Open http://localhost:3000 in your browser" -ForegroundColor Cyan
pnpm dev
