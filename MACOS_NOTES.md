# macOS Installation Guide - Clip Assassin

## Quick Start

1. **Download and extract** the Clip_Assassin_v1.0 folder
2. **Open Terminal** (Applications → Utilities → Terminal)
3. **Navigate to folder:**
   ```bash
   cd ~/Downloads/Clip_Assassin_v1.0
   ```
4. **Make installer executable:**
   ```bash
   chmod +x INSTALL.sh
   ```
5. **Run installer:**
   ```bash
   ./INSTALL.sh
   ```
6. **Restart Premiere Pro**

---

## Manual Installation

If the automatic installer doesn't work, follow these steps:

### Step 1: Enable Debug Mode

```bash
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
```

Verify it worked:
```bash
defaults read com.adobe.CSXS.12 PlayerDebugMode
```
Should return: `1`

### Step 2: Copy Plugin

```bash
# Create extensions directory if it doesn't exist
mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions/

# Copy plugin folder
cp -R clip_assassin ~/Library/Application\ Support/Adobe/CEP/extensions/

# Set proper permissions
chmod -R 755 ~/Library/Application\ Support/Adobe/CEP/extensions/clip_assassin
```

### Step 3: Restart Premiere Pro

Completely quit and restart Adobe Premiere Pro 2025.

---

## Troubleshooting

### Plugin doesn't show up?

1. **Verify debug mode:**
   ```bash
   defaults read com.adobe.CSXS.12 PlayerDebugMode
   ```
   Should return `1`. If not, run:
   ```bash
   defaults write com.adobe.CSXS.12 PlayerDebugMode 1
   ```

2. **Check plugin location:**
   ```bash
   ls -la ~/Library/Application\ Support/Adobe/CEP/extensions/clip_assassin
   ```
   Should show the plugin files.

3. **Check permissions:**
   ```bash
   chmod -R 755 ~/Library/Application\ Support/Adobe/CEP/extensions/clip_assassin
   ```

4. **Restart Mac** (not just Premiere)

### Security & Privacy Issues

If macOS blocks the plugin:

1. **System Preferences** → **Security & Privacy**
2. Check the **General** tab for any blocks
3. Click **"Allow"** if Clip Assassin is listed

### Still not working?

Try alternative debug mode setting using PlistBuddy:

```bash
/usr/libexec/PlistBuddy -c "Add :PlayerDebugMode string 1" \
  ~/Library/Preferences/com.adobe.CSXS.12.plist
```

Or manually edit the plist:
```bash
open ~/Library/Preferences/com.adobe.CSXS.12.plist
```
Add:
```xml
<key>PlayerDebugMode</key>
<string>1</string>
```

---

## Uninstallation

To remove Clip Assassin:

```bash
# Remove plugin
rm -rf ~/Library/Application\ Support/Adobe/CEP/extensions/clip_assassin

# (Optional) Remove debug mode
defaults delete com.adobe.CSXS.12 PlayerDebugMode
```

---

## Version Compatibility

- **macOS:** 10.12 (Sierra) or later
- **Premiere Pro:** 2025 (CEP 12)
- **Architecture:** Intel & Apple Silicon (M1/M2/M3) compatible

---

## Notes

- The plugin is the **same code** for both Windows and macOS
- CEP (Common Extensibility Platform) is cross-platform
- ExtendScript (JSX) works identically on both platforms
- No compilation or building required

---

*Cuts. Without mercy.*
