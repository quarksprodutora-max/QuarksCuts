> **Histórico.** Changelog do projeto original **Clip Assassin** (upstream,
> [Uhlovic/Clip_Assassin](https://github.com/Uhlovic/Clip_Assassin)), cobrindo as
> versões 1.0 e 1.1 — ponto de partida deste fork antes das mudanças do Quarks Cuts.
> Para o changelog atual, veja [`/CHANGELOG.md`](../../CHANGELOG.md).

# Changelog (Clip Assassin — histórico)

All notable changes to Clip Assassin will be documented in this file.

## [1.1.0] - 2025-11-21

### 🎉 Major Features

#### **Timecode with Frames Support**
- Added support for professional timecode format with frame numbers
- **Non-drop-frame**: `HH:MM:SS:FF` using colon (`:`)
  - Example: `00:01:30:15` = 1 minute, 30 seconds, 15 frames
- **Drop-frame**: `HH:MM:SS;FF` using semicolon (`;`)
  - Example: `00:01:30;15` for 29.97fps and 59.94fps footage
- Frame-accurate cutting with proper timebase handling

#### **Automatic Framerate Detection**
- Plugin now automatically detects framerate from imported clips
- Uses `getFootageInterpretation().frameRate` API
- Supports all common framerates: 23.976, 24, 25, 29.97, 30, 50, 59.94, 60 fps
- Proper timebase conversion (59.94fps → 60 timebase)
- Fallback to 30fps if detection fails

#### **REVERSE BLADES Mode**
- New purple button: **⚔️ REVERSE BLADES**
- Delete marked sections and keep everything else
- Perfect for removing ads, intros, unwanted segments
- Automatically handles segments at beginning, middle, and end of clips

### ✨ Improvements

- **Frame-accurate timing**: Timecode now uses timebase for professional accuracy
- **Proper Time object handling**: Fixed `.seconds` property access for clip duration
- **Long video support**: Tested and verified on 1h+ videos with no cumulative errors
- **Mixed format support**: Seamlessly mix old formats (1m30, 5:00) with new timecode formats

### 🐛 Bug Fixes

- Fixed timecode parsing to use timebase (60fps) instead of actual framerate (59.94fps)
- Fixed REVERSE BLADES not including final segment after last marked range
- Fixed `getOutPoint()` returning Time object instead of seconds value
- Improved clip duration detection with proper `.seconds` property access

### 📋 Technical Changes

- Refactored `parseTime()` to distinguish between timecode and simple time formats
- Added `isTimecodeFormat` flag for proper frame calculation
- Removed redundant `convertDropFrameToSeconds()` function
- Improved reverse mode logic with proper clip duration detection
- Added `clearInPoint()` and `clearOutPoint()` before getting clip duration

### 🧪 Testing

Successfully tested with:
- 59.94fps footage (1h 14min duration)
- Frame-accurate cuts (sub-frame precision: ~2ms)
- Drop-frame and non-drop-frame timecode
- Reverse mode with multiple segments
- Mixed format inputs
- Long video stability

---

## [1.0.0] - 2025-11-10

### Initial Release

- Basic time format support (1m57, 1:57, 0:02:25)
- Automatic sequence creation from clips
- Keep marked sections functionality
- Support for all framerates
- Multiple dash types and spaces handling
