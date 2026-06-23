# 🎉 Clip Assassin v1.1.0 - Frame-Perfect Edition

**Release Date:** November 21, 2025

---

## 🌟 What's New

### ⚔️ Professional Timecode Support

Never worry about frame accuracy again! Version 1.1 brings full professional timecode support with frame numbers:

**Non-drop-frame timecode** (`:`)
```
00:01:30:15-00:02:00:20
```
Perfect for 24fps, 25fps, 30fps, and 60fps footage.

**Drop-frame timecode** (`;`)
```
00:01:30;15-00:02:00;20
```
Ideal for 23.976fps, 29.97fps, and 59.94fps footage.

**Frame-accurate cutting** with proper timebase handling - tested and verified on long-form content (1h+).

---

### 🔄 REVERSE BLADES Mode

Introducing the new **⚔️ REVERSE BLADES** button!

Instead of keeping marked sections, **delete them and keep everything else**.

**Perfect for:**
- Removing ads from recordings
- Cutting out unwanted intros/outros
- Eliminating mistakes or dead air
- Cleaning up long interviews

**Example:**
```
Mark: 00:05:00-00:06:00 (ads)
      00:15:00-00:16:00 (ads)

Result: Everything EXCEPT those 2 minutes
```

---

### 🎯 Automatic Framerate Detection

No more manual framerate configuration! The plugin now:
- Automatically detects framerate from your clips
- Handles all common framerates (23.976, 24, 25, 29.97, 30, 50, 59.94, 60 fps)
- Uses proper timebase conversion for professional accuracy
- Maintains frame-perfect accuracy even on 1+ hour videos

---

## ✨ Improvements

- **Frame-accurate timing**: Sub-frame precision (~2ms accuracy)
- **Long video support**: Tested on 1h+ footage with zero drift
- **Mixed format support**: Combine old and new formats in the same session
  ```
  1m30-2m00
  00:03:00:00-00:03:30:15
  5:00-5:30
  ```
- **Better error handling**: Clear messages for invalid inputs

---

## 🐛 Bug Fixes

- Fixed timecode calculation to use proper timebase (60fps timebase for 59.94fps footage)
- Fixed REVERSE BLADES not including the final segment after the last marked range
- Fixed clip duration detection for reliable reverse mode operation
- Improved Time object handling throughout the codebase

---

## 📦 Installation

### Windows:
1. Download and extract `Clip_Assassin_v1.1.zip`
2. Run `INSTALL.bat` as Administrator
3. Restart Premiere Pro
4. Access via: **Window → Extensions → Clip Assassin**

### macOS:
1. Download and extract `Clip_Assassin_v1.1.zip`
2. Open Terminal and navigate to the folder
3. Run: `chmod +x INSTALL.sh && ./INSTALL.sh`
4. Restart Premiere Pro
5. Access via: **Window → Extensions → Clip Assassin**

---

## 📋 Supported Formats

```
✅ 1m57-2m08                      (minutes + seconds)
✅ 1:57-2:08                      (colon format)
✅ 0:02:25-0:02:45                (with hours)
✅ 00:01:30:15-00:02:00:20        (timecode with frames - non-drop) 🆕
✅ 00:01:30;15-00:02:00;20        (timecode with frames - drop-frame) 🆕
✅ Mix any formats together!
```

---

## 🎬 Usage Examples

### Frame-Accurate Cuts
```
00:00:10:00-00:00:20:00
00:01:05:15-00:01:15:30
```
Click: **🗡️ RUN THE BLADES**

### Remove Unwanted Sections
```
00:05:00:00-00:06:00:00
00:15:00:00-00:16:00:00
```
Click: **⚔️ REVERSE BLADES** → Keeps everything EXCEPT marked sections

### Mix Old and New Formats
```
1m30-2m00
00:03:00:15-00:03:30:00
5:00-5:30
```
Click: **🗡️ RUN THE BLADES**

---

## 🧪 Testing

Successfully tested with:
- ✅ 59.94fps footage (1h 14min duration)
- ✅ Frame-accurate cuts (sub-frame precision)
- ✅ Drop-frame and non-drop-frame timecode
- ✅ Reverse mode with multiple segments
- ✅ Mixed format inputs
- ✅ Long video stability (no cumulative errors)

---

## 📖 Documentation

- **Full README**: See `README.md` for complete usage guide
- **Changelog**: See `CHANGELOG.md` for detailed technical changes
- **Troubleshooting**: Check README for common issues and solutions

---

## 💬 Feedback & Support

Found a bug? Have a feature request?

**GitHub Issues**: [Report here](https://github.com/Uhlovic/Clip_Assassin/issues)

---

## ☕ Support the Project

If Clip Assassin saved you time, consider buying me a coffee!

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-yellow?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/Uhlovic)

**[buymeacoffee.com/Uhlovic](https://buymeacoffee.com/Uhlovic)**

---

## 🔗 Related Projects

- [Clip Assassin for DaVinci Resolve](https://github.com/Uhlovic/Clip_Assassin_Resolve) - Python API version

---

*Cuts. Without mercy.*

**Version:** 1.1.0
**Date:** 2025-11-21
**For:** Adobe Premiere Pro 2025 (CEP 12)
**License:** MIT - Free to use and modify
