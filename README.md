# ComfyUI MultiPreview

[日本語版はこちら / Japanese README](./README.ja.md)

MultiPreview combines multiple image outputs into one live preview node. It is useful for monitoring parallel workflow branches without placing a separate Preview Image node on every branch.

## Features

- Up to 32 dynamic `IMAGE` inputs (`image1`, `image2`, ...)
- Displays each input as soon as that branch finishes
- Switches between connected inputs with pin buttons
- Optional `auto_latest` toggle to follow the most recently completed input
- Batch image navigation with a separate remembered position for each pin
- Restores the current preview when switching workflow tabs or views during the same browser session
- Includes `MultiPreview Auto`, a compact variant that always follows the latest input

## Installation

Clone or download this repository into the ComfyUI custom nodes directory:

```txt
cd ComfyUI/custom_nodes
git clone https://github.com/palealloy2999-prog/comfyUI-multi-preview
```

Restart ComfyUI, then hard-refresh the browser.

The nodes are available under:

```txt
image / MultiPreview
image / MultiPreview Auto
```

## Usage

Connect image outputs from different workflow branches to `image1`, `image2`, `image3`, and so on. A new empty input is added automatically when needed.

```txt
Image source A ──▶ image1
Image source B ──▶ image2
Image source C ──▶ image3
```

<img width="406" height="633" alt="MultiPreview screenshot" src="https://github.com/user-attachments/assets/ec0e2de7-bfe1-4677-83e3-30a81b9f7e06" />

Run the workflow as usual. MultiPreview updates when each connected branch completes, without waiting for every other branch.

- Click a numbered pin button to show that input.
- Turn on `auto_latest` to switch automatically to the newest completed input.
- Use the standard ComfyUI image controls to navigate batches. Each pin remembers its own batch position.

## MultiPreview Auto

`MultiPreview Auto` always displays the most recently completed input. It has no pin buttons or manual selection controls, making it suitable for a compact live preview of parallel branches.

## Notes

- MultiPreview is a preview/output node and does not provide an `IMAGE` output.
- Preview images and restored UI state are temporary. The preview cache is kept only for the current browser session.
- Internal receiver nodes are added automatically at execution time and do not need to be placed manually.
- Preview files use ComfyUI's standard temporary image directory. During normal browser execution, each MultiPreview input is saved once by its internal receiver.
