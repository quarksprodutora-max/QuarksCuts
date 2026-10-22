#!/bin/bash

echo "========================================"
echo "  QUARKS CUTS - Instalacao"
echo "  Os cortes da IA, direto na timeline."
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

# Detect OS: no macOS o CEP mora em ~/Library; no Linux/WSL fica no HOME mesmo caminho.
if [[ "$(uname)" == "Darwin" ]]; then
    TARGET="${HOME}/Library/Application Support/Adobe/CEP/extensions/quarks_cuts"
else
    TARGET="${HOME}/.Adobe/CEP/extensions/quarks_cuts"
    echo -e "   ${YELLOW}⚠${NC} Instalação no Linux/WSL — Adobe CEP só é suportado oficialmente no macOS e Windows. No Windows, use INSTALL.bat."
fi

echo "[1/3] Setting up PlayerDebugMode..."

# Create plist file for debug mode (macOS only)
PLIST_FILE="${HOME}/Library/Preferences/com.adobe.CSXS.12.plist"

if [[ "$(uname)" == "Darwin" ]]; then
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

# Limpa da pasta instalada arquivos de desenvolvimento que não pertencem ao
# painel: scripts auxiliares, listas de instalação e backups temporários.
for f in parse_transcript.py fix_mojibake.py list_code.ps1 tree.txt tree_code.txt *.bak *.bak2 *.bak_*; do
    [ -f "$TARGET/../$f" ] && rm -f "$TARGET/../$f"
done

echo -e "   ${GREEN}✓${NC} Done"

echo ""
echo "========================================"
echo "  INSTALLATION COMPLETE!"
echo "========================================"
echo ""
echo "Installed to:"
echo "  $TARGET"
echo ""
echo "Next steps:"
echo "  1. Restart Adobe Premiere Pro"
echo "  2. Go to: Window → Extensions → Quarks Cuts"
echo "  3. Configure your Gemini API key in engine/config.json (see config.example.json)"
echo ""
echo "Note: If the plugin doesn't appear:"
echo "  - Make sure Premiere Pro is completely closed"
echo "  - Restart your Mac"
echo "  - Check System Preferences → Security & Privacy"
echo ""
