# ComfyUI MultiPreview

[日本語版はこちら / Japanese README](./README.ja.md)

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

<img width="406" height="633" alt="MultiPreview screenshot" src="https://github.com/user-attachments/assets/ec0e2de7-bfe1-4677-83e3-30a81b9f7e06" />

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

## Temporary Preview Files

MultiPreview uses ComfyUI's standard temporary preview image mechanism through `PreviewImage.save_images()`.

This means preview files are handled in the same general way as standard ComfyUI preview nodes.

## v1.2.7-debug

Maintenance release with a guarded state cache for ComfyUI tab/view switching.

- Added in-memory frontend state cache for MultiPreview nodes
- Restores preview images after ComfyUI tab/view switching
- Restores selected pin and per-pin batch index
- Restores preview buttons after node UI rebuilds


## MultiPreview Auto

`MultiPreview Auto` is a simplified node variant.

- Dynamic image pins only
- No pin buttons
- No manual preview switching
- Always switches to the pin that most recently received an image
- Uses the same internal receiver mechanism as `MultiPreview`

Use this node when you only want a compact live preview of the latest completed branch.


## State Restoration

MultiPreview keeps an in-memory frontend state cache for each node.

When ComfyUI rebuilds the node UI after switching tabs or views, MultiPreview attempts to restore:

- saved preview images
- selected pin
- per-pin batch index
- preview buttons

This state is session-local and is not intended to be a workflow serialization format.


### Restoration timing fix

v1.2.3 fixes a case where ComfyUI could call node setup hooks before the final node id/state was available. MultiPreview now delays marking a node as restored until a valid cached state is actually found, and also runs one deferred restore pass after widget setup.


### State cache guard

v1.2.4 prevents empty transient UI state during tab/view switches from overwriting a previously cached preview state. It also searches both the current canvas graph and root graph when restoring nodes.


## Debug Build

This debug build enables verbose console logging for MultiPreview lifecycle, state save/restore, receiver payloads, and pin selection.

Search the browser console for:

```txt
[MultiPreview v1.2.7-debug]
```


### Debug log noise reduction

v1.2.7-debug disables the 1-second periodic persistence log by default. State is still saved on receiver updates, pin selection, lifecycle events, blur, visibilitychange, and beforeunload.


### Restore retry fix

v1.2.7-debug allows state restoration to run again when a tab/view switch clears the live pin image state while cached preview images still exist.
