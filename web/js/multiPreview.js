import { app } from "../../scripts/app.js";

// ==================== Extension ====================

app.registerExtension({
    name: "comfyui.multipreview",

    // beforeRegisterNodeDef でプロトタイプに仕込む方法が最も確実。
    // nodeCreated より前に呼ばれ、全インスタンスに適用される。
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "MultiPreview") return;

        // --- onConnectionsChange をプロトタイプレベルで拡張 ---
        const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, index, connected, link_info) {
            // 元の処理を先に呼ぶ
            origOnConnectionsChange?.apply(this, arguments);

            // type=1 がINPUT側の変化
            if (type === 1) {
                updateDynamicInputs(this);
                rebuildButtons(this);
                updateButtonStates(this);
            }
        };

        // --- onExecuted をプロトタイプレベルで拡張 ---
        const origOnExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (output) {
            origOnExecuted?.apply(this, arguments);
            const images = output?.images ?? [];
            this._mpImages = images;
            showImage(this, this._mpSelectedPin ?? 1);
            updateButtonStates(this);
        };
    },

    // nodeCreated でDOMウィジェットを追加し、初期ピンを保証する
    async nodeCreated(node) {
        if (node.constructor.type !== "MultiPreview") return;

        // 状態の初期化
        node._mpSelectedPin = 1;
        node._mpImages = [];

        // DOMウィジェット追加
        createButtonPanel(node);
        createPreviewPanel(node);

        // 最低2つの入力ピンを保証
        ensureMinimumInputs(node);

        // 初期ボタン構築
        rebuildButtons(node);
        updateButtonStates(node);
    },
});

// ==================== Input Pin Management ====================

function isImageInput(input) {
    return input && /^image\d+$/.test(input.name);
}

function getImageInputs(node) {
    return (node.inputs || []).filter(isImageInput);
}

function getPinNumber(inputName) {
    const m = inputName.match(/^image(\d+)$/);
    return m ? parseInt(m[1], 10) : 0;
}

function ensureMinimumInputs(node) {
    const names = getImageInputs(node).map(i => i.name);
    if (!names.includes("image1")) node.addInput("image1", "IMAGE");
    if (!names.includes("image2")) node.addInput("image2", "IMAGE");
}

/**
 * 接続状況に応じてピンを追加/削除する。
 * - 末尾のピンが接続されたら新しい空きピンを追加
 * - 末尾に未接続ピンが2つ以上あれば1つになるまで削除
 */
function updateDynamicInputs(node) {
    const inputs = getImageInputs(node);
    if (!inputs.length) return;

    const last = inputs[inputs.length - 1];

    // 末尾ピンが接続されている → 新しいピンを追加
    if (last.link != null) {
        const maxPin = Math.max(...inputs.map(i => getPinNumber(i.name)));
        if (maxPin < 100) {
            node.addInput(`image${maxPin + 1}`, "IMAGE");
        }
        return;
    }

    // 末尾に未接続ピンが2つ以上 → 余分な末尾ピンを削除（最低1つは残す）
    for (let i = inputs.length - 1; i > 0; i--) {
        const prev = inputs[i - 1];
        const cur = inputs[i];
        if (cur.link == null && prev.link == null) {
            const slotIndex = node.inputs.indexOf(cur);
            if (slotIndex >= 0) node.removeInput(slotIndex);
        } else {
            break;
        }
    }
}

// ==================== Button Panel ====================

function createButtonPanel(node) {
    const container = document.createElement("div");
    container.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        padding: 8px;
        background: #2a2a2a;
        border-radius: 4px;
        min-height: 48px;
        align-items: center;
        box-sizing: border-box;
    `;

    node.addDOMWidget("mp_buttons", "mp_buttons", container, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 48,
    });

    node._mpButtonContainer = container;
    node._mpButtons = {};
}

function rebuildButtons(node) {
    const container = node._mpButtonContainer;
    if (!container) return;

    container.innerHTML = "";
    node._mpButtons = {};

    const imageInputs = getImageInputs(node);

    imageInputs.forEach((input) => {
        const pin = getPinNumber(input.name);
        const btn = document.createElement("button");
        btn.textContent = String(pin);
        btn.style.cssText = `
            min-width: 32px;
            height: 32px;
            padding: 0 6px;
            border-radius: 3px;
            font-weight: bold;
            font-size: 12px;
            border: 1px solid #444;
            background: #2e2e2e;
            color: #555;
            cursor: not-allowed;
        `;
        btn.disabled = true;

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            if (btn.disabled) return;
            node._mpSelectedPin = pin;
            updateButtonStates(node);
            showImage(node, pin);
        });

        node._mpButtons[pin] = btn;
        container.appendChild(btn);
    });
}

function updateButtonStates(node) {
    const inputs = getImageInputs(node);
    const selectedPin = node._mpSelectedPin ?? 1;

    inputs.forEach((input) => {
        const pin = getPinNumber(input.name);
        const btn = node._mpButtons?.[pin];
        if (!btn) return;

        const connected = input.link != null;
        const selected = selectedPin === pin;

        btn.disabled = !connected;

        if (!connected) {
            btn.style.background = "#2e2e2e";
            btn.style.borderColor = "#444";
            btn.style.color = "#555";
            btn.style.cursor = "not-allowed";
        } else if (selected) {
            btn.style.background = "#4a90e2";
            btn.style.borderColor = "#5a9fef";
            btn.style.color = "#fff";
            btn.style.cursor = "pointer";
        } else {
            btn.style.background = "#3a3a3a";
            btn.style.borderColor = "#555";
            btn.style.color = "#ccc";
            btn.style.cursor = "pointer";
        }
    });
}

// ==================== Preview Panel ====================

function createPreviewPanel(node) {
    const container = document.createElement("div");
    container.style.cssText = `
        width: 100%;
        min-height: 200px;
        background: #1a1a1a;
        border: 1px solid #444;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        box-sizing: border-box;
    `;

    const img = document.createElement("img");
    img.style.cssText = `
        max-width: 100%;
        max-height: 512px;
        object-fit: contain;
        display: none;
    `;

    const placeholder = document.createElement("span");
    placeholder.textContent = "No image";
    placeholder.style.cssText = "color: #555; font-size: 13px; font-family: sans-serif;";

    container.appendChild(img);
    container.appendChild(placeholder);

    node.addDOMWidget("mp_preview", "mp_preview", container, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 200,
    });

    node._mpImgElement = img;
    node._mpPlaceholder = placeholder;
}

function showImage(node, pinNumber) {
    const img = node._mpImgElement;
    const placeholder = node._mpPlaceholder;
    if (!img) return;

    const entry = (node._mpImages ?? [])[pinNumber - 1]; // 0-indexed
    if (!entry) {
        img.style.display = "none";
        placeholder.style.display = "";
        placeholder.textContent = "No image";
        return;
    }

    const params = new URLSearchParams({
        filename: entry.filename,
        subfolder: entry.subfolder || "",
        type: entry.type || "temp",
        rand: Math.random(),
    });

    img.src = `/view?${params}`;
    img.style.display = "block";
    placeholder.style.display = "none";

    img.onerror = () => {
        img.style.display = "none";
        placeholder.style.display = "";
        placeholder.textContent = "Failed to load image";
    };
}
