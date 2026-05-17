# ComfyUI MultiPreview v25 phase2-fix8-fix3-base

Fix3 をベースにした安定化版です。

## 方針

- `PreviewImage.save_images()` で画像保存
- `ui.images` は返さない
- pin別メタデータ `mp_images_json` でフロントへ渡す
- fix3 のボタン切替ロジックを維持
- 標準Preview由来の重複表示widgetを削除
- 未接続pinボタンは何もしない

## 確認ログ

```txt
[MultiPreview] v25-phase2-fix8-fix3-base loaded
```

## 注意

同名ノード競合を避けるため、古い `ComfyUI-MultiPreview-v25-*` テストフォルダは削除または退避してください。
