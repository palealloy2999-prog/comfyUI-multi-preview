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

## v1.2.8

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
[MultiPreview v1.2.8]
```


### Debug log noise reduction

v1.2.8 disables the 1-second periodic persistence log by default. State is still saved on receiver updates, pin selection, lifecycle events, blur, visibilitychange, and beforeunload.


### Restore retry fix

v1.2.8 allows state restoration to run again when a tab/view switch clears the live pin image state while cached preview images still exist.


## v1.2.8

Stale preview cleanup and state-cache safety release.

- Clears preview images, node image arrays, and restore cache when executing with no connected image inputs
- Prevents all-disconnected runs from restoring stale previews
- Adds connection snapshot checks before restoring cached preview state
- Includes graph identity in the state cache key when available
- Disables verbose debug logging by default


## v1.2.9

Batch index retention fix.

- Tracks `node.imageIndex` changes and immediately stores the current batch index for the selected pin
- Prevents the initial graph/configure pass from clearing restored per-pin batch indexes


## v1.2.10

Clear-preview crash fix.

- Fixes a crash when executing MultiPreview after disconnecting all image inputs
- Clears `node.imgs` / `node.images` by deleting the properties instead of assigning empty arrays
- Keeps the v1.2.9 batch index retention fix


## v1.2.11

Clear-preview safety placeholder fix.

- Uses a transparent 1x1 placeholder instead of an empty `node.imgs` state while ComfyUI's standard preview widget is being removed
- Extends delayed cleanup for asynchronously recreated standard preview widgets
- Clears legacy `app.nodeOutputs` image fields when available


## v1.2.12

Clear-preview behavior adjustment.

- Removes the transparent 1x1 placeholder used in v1.2.11
- Does not assign empty `node.imgs` / `node.images` arrays when all image inputs are disconnected
- Keeps the previous non-empty preview array briefly if ComfyUI's standard preview widget is still visible, matching normal Preview Image behavior
- Keeps stale restore cache suppressed for all-disconnected runs


## v1.2.13

Batch index cache timing fix.

- Saves the selected pin's batch index to the restore cache immediately after `node.imageIndex` changes
- Uses a microtask-based `saveNodeStateSoon()` to avoid losing the latest batch page during fast tab/view switching
- Keeps the v1.2.12 all-disconnected clear behavior


## v1.2.14

No-input execution behavior fix.

- Raises an execution error when MultiPreview runs with no connected image inputs, so the node turns red like ComfyUI's normal Preview Image behavior
- Preserves the current visible batch page when clearing stale preview state after all inputs are disconnected
- Keeps stale restore cache suppression and batch index cache timing fixes


## v1.2.15

No-input execution display behavior adjustment.

- If a previously executed MultiPreview is run after all image inputs are disconnected, the current preview display is preserved while the node turns red
- If a fresh MultiPreview with no previous preview is run without image inputs, it simply turns red with no preview image
- Keeps per-pin batch index state when entering the no-input error state


## v1.2.16

Error message adjustment.

- Changes the no-input execution error message to `Required input is missing: images`
- Keeps the v1.2.15 behavior where a previously displayed preview remains visible while the node turns red


## v1.2.17

Light flicker reduction pass.

- Defers pin switching whenever the target image is not loaded yet, even when there is no current `node.imgs` preview
- Removes the 500ms delayed standard-preview-widget cleanup sweep
- Uses a lightweight state initialization path for receiver updates after the node widgets are already ready
- Keeps the v1.2.16 no-input error message behavior


## v1.2.18

Small stability cleanup.

- Adds a schedule guard to `onConnectionsChange` so dynamic pin reconciliation cannot queue repeated overlapping passes
- Clears evicted image cache entries more explicitly by dropping handlers, clearing `img.src`, and emptying waiter callbacks
- Keeps the v1.2.17 flicker reduction changes


## v1.2.19

Unified receiver state pipeline.

- Internal receivers now include a stable `state_key`
- Receiver payloads always update the global preview state store first, whether the workflow tab is visible or not
- If the live node is available, the same stored state is then applied to the node UI
- Preview persistence, selected pin state, and per-pin batch index restoration now use a single state-key-based path


## v1.2.20

State-key fallback and cache eviction safety fix.

- Cache eviction now removes only the Map reference and no longer clears `img.src` or waiter callbacks, preventing visible previews or deferred selections from being broken
- Adds a prompt-node fallback state key so receiver payloads can still be stored when the live graph node is unavailable during prompt injection
- Restore now checks both the graph-based state key and the prompt fallback state key
- Keeps the v1.2.19 unified receiver state pipeline


## v1.2.21

Review fixes.

- Fixes an undefined fallback constant in `injectInternalReceiversIntoPrompt()`
- Adds a schedule guard to `removeStandardPreviewWidgetsSoon()` to coalesce repeated cleanup timers
- Adds a clarifying comment for intentionally unused `onExecuted` hook variables
- Keeps the v1.2.20 state-key fallback and safe cache eviction behavior


## v1.2.22

Node removal cleanup.

- Adds an `onRemoved` lifecycle hook for MultiPreview nodes
- Clears graph-based and prompt-fallback preview state keys from `globalStateStore()` when the node is removed
- Keeps the v1.2.21 review fixes and v1.2.20 state-key fallback behavior

Note: if a future ComfyUI frontend fires `onRemoved` during workflow-tab unload rather than actual node deletion, this cleanup may need a stricter deletion guard.


## v1.2.23

0x0 flicker reduction for auto-update replacement.

- `syncContextMenuImages()` now keeps the previous `node.imgs` until the whole replacement batch has loaded
- Prevents ComfyUI's standard preview widget from briefly rendering newly assigned but still-unloaded images as 0x0
- Restore and fallback execution paths now use deferred pin selection
- Keeps the v1.2.22 onRemoved cleanup behavior


## v1.2.24

Batch grid view restoration fix.

- Preserves ComfyUI's `node.imageIndex = null` grid-view state instead of coercing it to page 0
- Fixes the standard preview `X` button not returning batch previews to grid view
- Stores and restores grid-view state per pin together with per-pin batch page state
- Keeps the v1.2.23 0x0 flicker guard behavior


## v1.2.25

Default batch index fix.

- Treats `undefined` imageIndex as the default first page (`0`)
- Keeps explicit `null` imageIndex as ComfyUI's batch grid-view state
- Prevents fresh/default previews from starting in grid mode while preserving the `X` button grid behavior
