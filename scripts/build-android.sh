#!/bin/bash
# WeHouse Android Build Script
# Usage: ./scripts/build-android.sh [debug|release]

set -e

MODE="${1:-debug}"
echo "=========================================="
echo "  WeHouse Android Build ($MODE)"
echo "=========================================="

# 1. Build web assets
echo "[1/4] Building web assets..."
npm run build

# 2. Sync Capacitor
echo "[2/4] Syncing Capacitor..."
npx cap sync android

# 3. Build APK
echo "[3/4] Building Android APK ($MODE)..."
cd android
if [ "$MODE" = "release" ]; then
    ./gradlew assembleRelease
    echo ""
    echo "=========================================="
    echo "  RELEASE APK BUILT!"
    echo "  Location: android/app/build/outputs/apk/release/app-release-unsigned.apk"
    echo "  Sign with: jarsigner -keystore my.keystore app-release-unsigned.apk alias"
    echo "=========================================="
else
    ./gradlew assembleDebug
    echo ""
    echo "=========================================="
    echo "  DEBUG APK BUILT!"
    echo "  Location: android/app/build/outputs/apk/debug/app-debug.apk"
    echo "  Install: adb install android/app/build/outputs/apk/debug/app-debug.apk"
    echo "=========================================="
fi

cd ..

# 4. Done
echo "[4/4] Build complete!"
