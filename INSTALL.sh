#!/bin/bash

echo "========================================"
echo "  CLIP ASSASSIN - Installation"
echo "  Cuts. Without mercy."
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SOURCE="${SCRIPT_DIR}/clip_assassin"
TARGET="${HOME}/Library/Application Support/Adobe/CEP/extensions/clip_assassin"

echo "[1/3] Setting up PlayerDebugMode..."

# Create plist file for debug mode
PLIST_FILE="${HOME}/Library/Preferences/com.adobe.CSXS.12.plist"

# Check if PlistBuddy is available (it should be on all macOS systems)
if command -v /usr/libexec/PlistBuddy &> /dev/null; then
    # Create or modify the plist file
    if [ ! -f "$PLIST_FILE" ]; then
        # Create new plist
        /usr/libexec/PlistBuddy -c "Add :PlayerDebugMode string 1" "$PLIST_FILE" 2>/dev/null
    else
        # Try to modify existing key, if it fails, add it
        /usr/libexec/PlistBuddy -c "Set :PlayerDebugMode 1" "$PLIST_FILE" 2>/dev/null || \
        /usr/libexec/PlistBuddy -c "Add :PlayerDebugMode string 1" "$PLIST_FILE" 2>/dev/null
    fi

    if [ $? -eq 0 ]; then
        echo -e "   ${GREEN}✓${NC} Debug mode enabled"
    else
        echo -e "   ${YELLOW}⚠${NC} Could not set debug mode (might need manual setup)"
    fi
else
    echo -e "   ${YELLOW}⚠${NC} PlistBuddy not found - will try defaults command"
    defaults write com.adobe.CSXS.12 PlayerDebugMode 1
    if [ $? -eq 0 ]; then
        echo -e "   ${GREEN}✓${NC} Debug mode enabled"
    else
        echo -e "   ${YELLOW}⚠${NC} Could not set debug mode"
    fi
fi

echo ""
echo "[2/3] Installing plugin..."

# Check if source folder exists
if [ ! -d "$SOURCE" ]; then
    echo -e "   ${RED}✗${NC} ERROR - clip_assassin folder not found!"
    echo "   Expected location: $SOURCE"
    exit 1
fi

# Create extensions directory if it doesn't exist
mkdir -p "$(dirname "$TARGET")"

# Remove old version if exists
if [ -d "$TARGET" ]; then
    echo "   Removing old version..."
    rm -rf "$TARGET"
fi

# Copy plugin files
echo "   Copying files..."
cp -R "$SOURCE" "$TARGET"

if [ $? -eq 0 ]; then
    echo -e "   ${GREEN}✓${NC} Plugin installed"
else
    echo -e "   ${RED}✗${NC} ERROR - Failed to copy files"
    exit 1
fi

# Set proper permissions
chmod -R 755 "$TARGET"

echo ""
echo "[3/3] Finalizing installation..."
echo -e "   ${GREEN}✓${NC} Done"

echo ""
echo "========================================"
echo "  INSTALLATION COMPLETE!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Restart Adobe Premiere Pro"
echo "  2. Go to: Window → Extensions → Clip Assassin"
echo "  3. Mark your targets and execute!"
echo ""
echo "Ready to eliminate unwanted footage!"
echo ""
echo "Note: If the plugin doesn't appear:"
echo "  - Make sure Premiere Pro is completely closed"
echo "  - Restart your Mac"
echo "  - Check System Preferences → Security & Privacy"
echo ""
