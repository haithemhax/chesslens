# ChessLens

**Offline Live Chess Show for Projector Displays**

ChessLens is an offline live chess show application built for physical chess tournaments and exhibitions. It watches a physical chessboard through a USB-connected webcam or smartphone, detects moves with homography and illumination-normalized descriptors, evaluates every position with a bundled Stockfish 19 lite single-threaded WebAssembly engine, and renders a high-contrast audience display on a projector with move quality verdicts, evaluation graphs, and multilingual commentary (English, French, Arabic).

---

## Exact Command to Run the Show

For the show, run the optimized production build completely offline:

```bash
# 1. Build the production bundle (copies the Stockfish WASM worker locally)
npm run build

# 2. Serve the production build locally
npm run preview
```

Open `http://localhost:4173` in Google Chrome or Microsoft Edge.
- Press **F** to enter Fullscreen.
- Press **`** (backtick) to open the Operator Panel.

---

## Operator Hotkeys Quick Reference

| Key | Action | Notes |
| :--- | :--- | :--- |
| **`** or **~** | **Toggle Operator Panel** | Opens/closes operator drawer without interrupting audience view |
| **F** | **Toggle Fullscreen** | Fills projector screen (1920×1080 or 1280×720) |
| **P** | **PANIC HOTKEY** | Instantly switches to Demo mode (The Opera Game) or returns to live game |
| **1** | **Accept Candidate 1** | Resolves ambiguous detection candidate #1 instantly |
| **2** | **Accept Candidate 2** | Resolves ambiguous detection candidate #2 instantly |
| **3** | **Accept Candidate 3** | Resolves ambiguous detection candidate #3 instantly |
| **Esc** | **Dismiss / Close** | Closes modals, operator drawer, or calibration view |

---

## Connecting a Phone as a Webcam over USB

Using a phone as a camera gives superior optical clarity compared to cheap webcams. **Always use a direct USB cable rather than Wi-Fi** to avoid venue Wi-Fi interference, packet loss, or latency spikes. A wired connection also keeps the phone charged throughout a 3-hour match.

### Option A: DroidCam (Android & iOS) — Recommended
1. Install **DroidCam** on the phone and the **DroidCam Client** on your PC/laptop.
2. On Android: Enable **Developer Options** and turn on **USB Debugging**.
3. Connect the phone to the laptop via a good USB-C cable.
4. Launch the DroidCam PC client, click the **USB (Android)** icon, and click **Start**.
5. In ChessLens, open the Operator Panel (press `` ` ``), select `DroidCam Source` under **Camera Device**, and click **Start Camera**.

### Option B: Iriun Webcam (Android & iOS)
1. Install **Iriun 4K Webcam** on the phone and the Iriun driver on your PC.
2. Connect the phone via USB cable (with USB debugging enabled on Android).
3. Open the Iriun app on the phone; the PC driver detects it automatically.
4. In ChessLens, select `Iriun Webcam` as the device and start the camera.

### Option C: Camo by Reincubate (iOS & Android)
1. Install **Camo** on phone and laptop.
2. Connect via USB; Camo delivers low-latency 1080p video with manual focus and exposure locking.
3. Lock autofocus and exposure in Camo so lighting changes in the room do not cause lens pulsing.

---

## Calibration Steps

Calibration takes less than 60 seconds and is persisted safely in browser storage:

1. **Mount Camera Securely**: Position the camera overhead or at an angle (45°–70°). Ensure the entire board and all 4 outer corners are visible.
2. **Start Camera**: In the Operator Panel, select your camera and click **Start camera**.
3. **Open Calibration**: Click **Calibrate board**.
4. **Click the 4 Corners**: Click the 4 board corners in clockwise order:
   - Corner 1: **Top Left**
   - Corner 2: **Top Right**
   - Corner 3: **Bottom Right**
   - Corner 4: **Bottom Left**
5. **Fine-Tune with the Draggable Handles & Magnifier Loupe**:
   - Drag any corner circle handle.
   - A **2.4× circular magnifier loupe** automatically tracks your cursor with crosshairs so you can align the handle to the exact corner vertex.
6. **Verify with the Golden Alignment Grid**:
   - The warped top-down preview displays an overlaid golden $8 \times 8$ grid.
   - Ensure the outer lines match rank 1/8 and file a/h.
7. **Set Board Orientation**:
   - Select **White side nearest camera** if the camera sits on White's side.
   - Select **Black side nearest camera** if the camera sits behind Black.
8. **Confirm Calibration**: Click **Confirm calibration**.
9. **Capture Baseline Appearance**:
   - Ensure the board is in starting position with pieces placed.
   - Click **Capture Baseline**. This stores the baseline appearance of all 64 squares for uneven venue lighting.
10. **Test Detection Mode**:
    - Toggle **Test detection mode** in the Operator Panel.
    - Move a piece on the board: the operator view highlights the changed squares and matches the legal move without changing the audience game state.
    - Turn off Test Mode when ready for the show.

---

## Camera Fit Check & Framing Guide

ChessLens includes an automated, real-time **Camera Fit Check** that continuously evaluates physical framing, board resolution, perspective tilt, lens sharpness, and lighting conditions.

It operates entirely in JavaScript, runs sub-5ms downscaled evaluations throttled to once every 2 seconds while idle, and is **strictly operator-only**—no warnings or diagnostic markers are ever projected onto the audience display.

### What is Measured
| Metric | Good | Warning | Poor / Action Required | Actionable Operator Advice |
| :--- | :--- | :--- | :--- | :--- |
| **Board Inside Frame** | All 4 corners $\ge 3\%$ inside frame | Within 3% of edge | Any corner outside frame | *"Board is cut off on the right: move the phone left"* |
| **Pixels Per Square** | $\ge 60\text{ px/sq}$ | $35 - 60\text{ px/sq}$ | $< 35\text{ px/sq}$ (fills $< 50\%$ height) | *"Board is too small: move the phone closer or zoom in"* |
| **Perspective Tilt** | Angle deviation $\le 15^\circ$ | $15^\circ - 25^\circ$ deviation | $> 25^\circ$ deviation | *"Phone is tilted: place it directly above the board"* |
| **Centering Offset** | Centroid within 8% of center | Off-center | Severely off-center | Panning direction hints: *"move the phone left/right/up/down"* |
| **Grid Alignment** | Score $\ge 55 / 100$ | $35 - 55 / 100$ | $< 35 / 100$ | *"Grid alignment is low: check corner placement"* |
| **Sharpness** | Variance $\ge 60$ | Baseline drop $\ge 40\%$ | Baseline drop $\ge 60\%$ | *"Image is blurry: clean the lens or lock the focus"* |
| **Exposure** | Luminance $60 - 200$ | Luminance $< 60$ or $> 200$ | Severe over/under-exposure | *"Lighting is too dark/bright"* |
| **Specular Glare** | Saturation $< 3\%$ | Saturation $\ge 3\%$ | Saturated square $\ge 6\%$ | *"Glare on e4, f4: move the lamp or change the angle"* |
| **Camera Drift** | Position stable | — | Board bumped or shifted | *"Camera moved: recalibrate"* |

### Visual Overlays (Operator & Calibration Views Only)
- **Framing Guide**: A golden dashed rectangle with corner bracket accents indicates recommended framing.
- **Pre-Calibration State**: Shows the dashed guide with *"Fit the whole board inside the frame"* while measuring exposure and sharpness on raw frames.
- **Traffic-Light Status Quadrilateral**: The calibrated board boundary highlights in **Emerald** (Good), **Amber** (Warning), or **Red** (Poor).
- **Localized Glare Highlighting**: Individual glare squares (e.g. `e4`, `f4`) are projected directly back to the physical camera frame and highlighted with translucent red fills and a `⚡` badge.
- **Warp Preview Badges**: In the Calibration View, glare squares are also marked on the top-down 8×8 grid.

### Operator Safeguards
- **Pre-Show Checklist**: The Splash screen includes an informational Camera Fit check before show start.
- **Live Show Toast**: If physical conditions drop from Good to Poor during a live match, an operator-only warning toast alerts the crew immediately.
- **Baseline Capture Confirmation**: If the operator attempts to capture the baseline appearance while fit status is Poor, ChessLens prompts for confirmation first to avoid baking in bad calibration data.

---

## Live Camera Video Panel (Side-by-Side View)

In addition to the optional full-screen background, ChessLens features a dedicated **Live Camera Video Panel** placed directly to the **right** of the digital board:
- **Layout on Audience Display**:
  - Positions the physical board side-by-side with the digital board.
  - Shares the top row of the right column side-by-side with the Verdict Banner, followed by the Commentary Card, Move List, and Eval Graph.
  - Fits cleanly on both **1920×1080** and **1280×720** projector displays with zero vertical scrollbars and zero overflow.
  - If toggled off, the layout smoothly reflows and gives 100% of the space back to the Verdict Banner.
- **View Options (Operator Panel)**:
  - **Show / Hide**: Toggle the camera panel on or off.
  - **Source View**:
    - **Raw Camera**: Direct real-time feed with native aspect ratio (`object-contain`).
    - **Top-Down Warped Board**: Renders the 512×512 homography-warped board at ~18 FPS, including subtle gold highlights on the `from` and `to` squares of the last detected move.
  - **Panel Size**: Select **Small**, **Medium**, or **Large** to adjust column proportion.
  - **Rotation**: 0°, 90°, 180°, or 270°.
  - **Mirror Camera**: Flip horizontally for mirrored camera configurations.
- **Fallbacks & Safety**:
  - When camera is offline, disconnected, or in Demo/Panic mode, displays a clean placeholder with no error messages visible to the audience.
  - Wrapped inside an `ErrorBoundary` so video failures never blank the audience screen.
  - Reattaches automatically as soon as the camera stream returns.

---

## Interactive Chess Game (Chess.com Style)

ChessLens now supports direct, full interactive chess gameplay directly on the digital board:
- **Chess.com Style Move Interaction**:
  - **Click to Move & Drag-and-Drop**: Click or drag any piece of the current turn's color.
  - **Legal Move Dots**: Open destination squares display clean centered dots.
  - **Capture Indicators**: Capture squares display an outer ring hugging the square borders.
  - **Selected Piece Highlight**: Selected square glows with a warm brass ring.
  - **Move Highlights**: The `from` and `to` squares highlight in chess.com-style yellow/olive.
  - **Check Indicator**: King's square pulses red when in check.
- **Audio Synthesizer (100% Offline)**:
  - Generates authentic chess sounds using the Web Audio API without any external MP3 files.
  - Distinct sounds for regular moves, captures, castling, and checks.
- **Play Modes in Demo / Exhibition Mode**:
  - **🎮 vs Computer (Stockfish AI)**: Play a real match against the bundled Stockfish engine! You play White (or Black), and the engine automatically responds with its calculated best move after a realistic delay.
  - **👥 Pass & Play (2-Player)**: Move both sides interactively on the board.
  - **📜 Opera Game Replay**: Automated move-by-move replay of Paul Morphy's 1858 Opera Game.
- **Quick Controls**:
  - Switch modes on the fly, toggle player color (White ⚪ / Black ⚫), start a **New Game**, **Undo** moves, or **Flip** the board.
  - Every played move triggers real-time Stockfish evaluation, win-probability swings, verdict banners, and multilingual commentary!

---

## Live Camera Background

ChessLens can project the real physical board directly behind the digital board:
- **Modes**:
  - **Full Background**: The live camera stream fills the entire screen behind the digital board with a dark veil (`rgba(5, 7, 11, 0.65)`) and perimeter vignette, guaranteeing that the digital pieces, eval bar, and commentary are crisp and readable from 10 meters away.
  - **Corner (PiP)**: A floating picture-in-picture window with rounded corners and a glowing brass border in the lower left corner.
  - **Off**: Displays the default sleek dark backdrop.
- **Controls (Operator Panel)**:
  - **Opacity** (0–100%, default 35%)
  - **Blur** (0–20px, default 6px)
  - **Brightness** (50–150%, default 100%)
  - **Mirror Camera**: Flips horizontally for mirrored overhead mounts.
  - **Rotation**: 0°, 90°, 180°, or 270° orientation adjustment.
- **Performance Mode**:
  - Toggling **Performance Mode** disables real-time CSS Gaussian blur filters and uses purely GPU-accelerated opacity and scale transforms.
  - **Tip for Show Day**: If your laptop has an integrated GPU (e.g. Intel UHD) or the audience display drops below 60 FPS, enable Performance Mode.
- **Hardware Protection**:
  - Reuses the existing `MediaStream` object already powering the computer vision loop.
  - **Never** invokes `getUserMedia` a second time, avoiding hardware collisions with single-consumer USB drivers like DroidCam or Iriun.
  - Automatically fades out when Demo mode is activated or if the camera stream drops.

---

## Video Recording & Auto-Segmentation

Record the match in full HD without affecting show presentation:
- **Recording Sources**:
  - **Camera Stream**: Directly records the live physical board feed.
  - **Audience Screen**: Records the full audience presentation via `getDisplayMedia`.
- **Auto-Segmentation**:
  - By default, recordings are auto-split every **10 minutes** (configurable 1–60 mins).
  - Each segment is written with its own WebM EBML headers, making every segment file completely valid and playable on its own. If the laptop battery dies or the browser closes unexpectedly, you lose at most the current slice, never the whole game.
- **Saving Files**:
  - **Direct Folder Access**: Click **Choose save folder** in the Operator Panel to grant directory write permission using the File System Access API. New segments are written directly to disk in the background.
  - **Browser Download Fallback**: If directory access is not supported or declined, segments automatically trigger standard browser downloads.
- **File Naming Format**:
  - Files are automatically named using the event and player names configured in the Operator Panel:  
    `{EventName}_{WhitePlayer}_vs_{BlackPlayer}_{Timestamp}_part{N}.webm`
  - Special characters and spaces are safely sanitized; Arabic characters are fully supported.
- **Operator-Only Visibility**:
  - A red `REC 04:15 • Part 1` indicator and elapsed timer are shown exclusively in the Operator Panel drawer.
  - No recording watermarks or alerts are ever projected to the audience.
- **Low-Disk Protection**:
  - The recording controller queries `navigator.storage.estimate()` every 10 seconds and triggers a gentle warning if free space drops below 500MB.

---

## Reliability Features Built for Show Day

- **Screen Wake Lock**: Automatically prevents the laptop and projector from dimming or going to sleep during long games.
- **Hidden Cursor**: In audience mode, the mouse pointer hides after 2.5 seconds of inactivity and reappears instantly on movement.
- **Cinematic Live Camera Background**: Renders the live camera stream behind the digital board with a dark veil and perimeter vignette for maximum 10-meter readability. Supports Full Background, Picture-in-Picture Corner window, or Off. Reuses the primary `MediaStream` with zero additional device locks. Includes a **Performance Mode** that disables CSS blur to guarantee smooth 60 FPS on low-power show laptops.
- **Auto-Segmented Video Recording**: Operator-controlled recording of the camera stream or audience display (`getDisplayMedia`) at 1–10 Mbps (WebM VP9/VP8). Automatically splits into clean, independently playable 10-minute segments so a hardware issue never corrupts an entire match. Supports saving directly to a selected folder via File System Access API or browser download. Displays a live elapsed timer and low-storage warning (<500MB) exclusively in the Operator Panel.
- **Hand & Arm Occlusion Guard**: An 8-connected cluster detector prevents evaluating moves while a hand or arm is over the board, restarting the settle window until the player withdraws their hand.
- **Camera Drift Detection**: If the camera or board is bumped or shifted, a warning alerts the operator to recalibrate rather than silently misreading moves.
- **Stockfish Watchdog & Material Fallback**: The Stockfish WASM worker is strictly serialized with a watchdog timer (`movetime + 1800ms`). If the engine ever stalls, it terminates the dead worker, restarts a fresh worker, and seamlessly falls back to material balance evaluation without crashing the audience screen.
- **Error Boundaries**: Every UI widget (ChessBoard, EvalBar, VerdictBanner, CommentaryCard, MoveList, EvalGraph) is isolated with error boundaries that preserve the last known good visual state.
- **10-Move Anti-Repetition Commentary Memory**: Commentary templates track recent phrases to ensure varied, natural-sounding commentary. Includes opening recognition (Ruy Lopez, Italian, Sicilian, French, Caro-Kann, Queen's Gambit, King's Indian, etc.), recaptures, exchange sacrifices, back-rank threats, and mate countdowns.
- **Arabic RTL & LTR Isolation**: Full right-to-left layout for Arabic with Unicode directional isolation (`\u2066...\u2069`) to guarantee algebraic notation (`Nf3+`, `O-O`, `Qxd7#`) is never visually mangled.

---

## Troubleshooting Guide

### 1. Camera is missing or shows "Camera off"
- Ensure your phone webcam app (DroidCam / Iriun / Camo) is opened and streaming **before** loading the webpage.
- In Chrome/Edge, check the address bar permissions icon and grant Camera access.
- When serving across a local Wi-Fi router, browsers block camera access on plain `http://192.168.x.x`. Always run ChessLens on `http://localhost:4173` on the machine connected to the camera, or use HTTPS.

### 2. Move not detected / Board says "Watching"
- Check that the player has completely removed their hand from the board.
- Check the Operator Panel for **Pending Decision (1/2/3)**: if lighting caused low confidence, the top 3 candidates are listed in the operator view. Press **1**, **2**, or **3** to confirm.
- If the physical board got out of sync with software, click **Re-sync Board**: it scans the physical board changes against 1-ply and 2-ply legal continuations and reconciles automatically.
- Alternatively, type the move into **Apply move** (e.g. `Nf3`, `e4`, `O-O`) in the Operator Panel.

### 3. False move triggered while player was thinking
- Increase **Settle time** in the Operator Panel from 400 ms to 600–800 ms.
- If pieces on dark squares blend into dark wood, ensure adequate overhead lighting without direct spotlight glare.

### 4. Engine status shows Error or takes too long
- The engine watchdog automatically recovers within 2.5 seconds.
- You can manually click **Restart engine** in the Operator Panel.
- Adjust **Engine search time** between 400 ms and 2000 ms.

### 5. Camera bumped / Board shifted
- If a warning appears: *"Camera or board shift detected"*, open Operator Panel (`` ` ``), click **Recalibrate**, and adjust the corner handles with the magnifier loupe.

### 6. Emergency / System Freeze
- **Press P**: Instantly activates Demo mode (The Opera Game replay) with commentary and engine evaluations, providing immediate entertainment while you inspect the hardware.
- Press **P** again to return to the live show when resolved.

---

## Printable One-Page Pre-Show Checklist

Print this page or keep it on your phone before the event:

```
======================================================================
                     CHESSLENS PRE-SHOW CHECKLIST
======================================================================

[ ] 60 MINUTES BEFORE THE SHOW:
    [ ] Laptop plugged into AC wall power (not running on battery).
    [ ] Projector connected via HDMI, display resolution set to 1080p or 720p.
    [ ] Phone mounted securely on rigid tripod/arm overlooking the chessboard.
    [ ] Phone connected via USB cable; phone battery charging confirmed.
    [ ] Webcam software (DroidCam / Iriun / Camo) running over USB.
    [ ] Room lighting turned on; verify NO glare or reflections on the board.

[ ] 30 MINUTES BEFORE THE SHOW:
    [ ] Launch: npm run build && npm run preview
    [ ] Open http://localhost:4173 in Chrome or Edge.
    [ ] Press F to confirm Fullscreen on the projector.
    [ ] Press ` to open Operator Panel.
    [ ] Select camera device and click "Start camera".
    [ ] Calibrate board: 4 corners (TL, TR, BR, BL) aligned with Loupe.
    [ ] Verify alignment grid lines on top-down preview.
    [ ] Select board orientation (White or Black nearest camera).
    [ ] Place pieces in starting position, click "Capture baseline".
    [ ] Set Event Name and Player Names in "Event & Players" section.
    [ ] Select audience commentary language (English / Français / العربية).

[ ] 10 MINUTES BEFORE THE SHOW:
    [ ] Splash Pre-Show Checklist shows all green:
        [x] Camera streaming
        [x] Board calibrated
        [x] Engine responding
        [x] Offline fonts loaded
        [x] Fullscreen available
        [x] 100% offline ready
    [ ] Make a test move (e.g. e2-e4) with Test Detection Mode:
        [x] Move identified correctly.
    [ ] Test "P" panic hotkey to confirm Demo mode replays smoothly.
    [ ] Reset board to starting position and click "Start Show".

[ ] DURING THE SHOW (OPERATOR EMERGENCY CONTROLS):
    [ ] Open Operator Controls:        Press `
    [ ] Ambiguous move confirmation:   Press 1, 2, or 3
    [ ] Emergency Demo Mode:          Press P
    [ ] Resume after manual fix:       Click "Sync board"
======================================================================
```

---

## Project Structure

```
chesslens/
├── public/
│   └── engine/               # Bundled Stockfish 19 lite single-threaded JS & WASM
├── scripts/
│   ├── copy-engine.mjs       # Copies Stockfish WASM from npm package into public/
│   └── test-logic.mjs        # 19 comprehensive offline tests (homography, CV, engine, i18n)
├── src/
│   ├── commentary/
│   │   ├── commentary.js     # Template assembly, opening detection & anti-repetition memory
│   │   ├── templates.js      # Multilingual templates (EN, FR, AR)
│   │   └── llm.js            # Optional, non-blocking 3-second LLM commentary client
│   ├── components/
│   │   ├── AudienceScreen.jsx   # Projector display (1080p/720p, high contrast, cursor hiding)
│   │   ├── ChessBoard.jsx       # Virtual board with piece glyphs & LTR coordinate isolation
│   │   ├── CalibrationView.jsx  # Draggable corner handles, 2.4x loupe & 8x8 alignment grid
│   │   ├── CommentaryCard.jsx   # Live commentary with RTL support
│   │   ├── EvalBar.jsx          # Vertical win-probability evaluation bar
│   │   ├── EvalGraph.jsx        # Centipawn swing chart over plies
│   │   ├── MoveList.jsx         # Score sheet with quality verdict indicators
│   │   ├── VerdictBanner.jsx    # Move quality banner (Brilliant, Best, Good, etc.)
│   │   ├── TitleIntroModal.jsx  # Matchup title card with player names & event title
│   │   ├── FinalResultModal.jsx # Game-over victory screen with score & statistics
│   │   ├── OperatorPanel.jsx    # Operator drawer, calibration, engine & test controls
│   │   ├── Splash.jsx           # Pre-show checklist & system verification screen
│   │   └── ErrorBoundary.jsx    # Subsystem isolation preserving last known good state
│   ├── engine/
│   │   └── StockfishEngine.js   # Serialized UCI wrapper with watchdog & auto-restart
│   ├── i18n/
│   │   └── translations.js      # English, French, and Arabic dictionaries
│   ├── lib/
│   │   ├── chess.js / chessHelpers.js  # Move parsing & FEN helpers
│   │   ├── classification.js    # Move scoring, hand occlusion & 2-ply reconciliation
│   │   ├── evaluation.js        # Score normalization & win probability
│   │   ├── homography.js        # Perspective projection & warp mapping
│   │   └── storage.js           # Safe localStorage persistence
│   ├── state/
│   │   ├── store.js             # Zustand store with settings, game & vision state
│   │   └── ShowProvider.jsx     # Vision loop, engine orchestration & keyboard shortcuts
│   └── vision/
│       └── VisionController.js  # Frame processing, descriptors, drift detector, replay tool
```
