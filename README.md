# ComfyUI MultiPreview

MultiPreview is a custom ComfyUI node for previewing multiple image inputs in a single node.

It supports dynamic image pins, per-pin preview switching, batch image navigation, and immediate preview updates while a workflow is running.

## Features

- Multiple image inputs in one preview node
- Dynamic `imageN` input pins
  - A new empty pin is automatically added as needed
  - Empty pins remain available for connection
- Dynamic preview buttons
  - Buttons are shown only for pins that have an active connection or retained preview state
- Switch preview by pin button
- Batch image support
  - Each pin keeps its own batch image index
  - Switching between pins restores that pin's previous batch position
- Immediate preview updates
  - Images are displayed as soon as each pin finishes
  - The node does not need to wait for all connected inputs to finish
- Auto latest mode
  - Optional `auto_latest` toggle
  - When enabled, the preview automatically switches to the pin that most recently received an image
- Stable state handling
  - Disconnecting a pin does not immediately clear the current preview
  - Old state is cleaned up on the next execution
- Node run button fallback
  - The node still supports normal execution behavior
- Image preload/cache handling
  - Reduces flicker when switching pins or receiving new images

## Installation

1. Download or clone this repository into your ComfyUI custom nodes directory:

```txt
ComfyUI/custom_nodes/ComfyUI-MultiPreview
```

2. Restart ComfyUI.

3. Hard refresh your browser.

4. Add the node from:

```txt
image / MultiPreview
```

## Usage

Connect image outputs to the `image1`, `image2`, `image3`, ... inputs.

```txt
Image source A ──▶ image1
Image source B ──▶ image2
Image source C ──▶ image3
```

MultiPreview will show a button for each connected image pin.

Click a button to switch the preview target.

If a connected input produces a batch, use the normal ComfyUI preview navigation to move through the batch images.

## Auto Latest

The `auto_latest` toggle controls whether the preview should automatically switch to the newest arriving pin.

- OFF: Keep showing the currently selected pin
- ON: Automatically switch to the pin that most recently received an image

## Notes

MultiPreview injects internal receiver nodes at execution time. These receivers save per-pin preview images and notify the frontend with a custom event so the parent MultiPreview node can update immediately.

The internal receiver nodes are injected automatically and do not need to be placed manually.

## v1.2.0

Added an auto-updating display-only node.

- Unified release version strings
- Added constants for default node size, unwrap depth, cleanup delay, and cache size
- Added safer `node.size` initialization
- Added a small image cache limit
- Made image cache entries safer for duplicate image metadata
- Narrowed standard-preview-widget cleanup matching
- Added comments for ComfyUI lifecycle workarounds and intentional prompt hooks


## MultiPreview Auto

`MultiPreview Auto` is a simplified node variant.

- Dynamic image pins only
- No pin buttons
- No manual preview switching
- Always switches to the pin that most recently received an image
- Uses the same internal receiver mechanism as `MultiPreview`

Use this node when you only want a compact live preview of the latest completed branch.
