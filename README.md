# comfyUI-multi-preview

複数の画像を動的に切り替えて表示できるComfyUIカスタムノードです。

## 機能

- **MultiPreview ノード**：複数の画像入力を持つ高度なプレビューノード
  - 最初に1つの画像入力（image1）を持ちます
  - UIから動的に画像ピンを追加可能（image2, image3, ...）
  - ブラウザ上で画像を切り替えて表示できます
  
- **動的入力ピン**：WebUIから簡単に入力数を変更
- **複数画像一括表示**：バッチ処理の結果を効率的に確認

## インストール

1. ComfyUIの `custom_nodes` ディレクトリに本リポジトリをクローン：
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/username/comfyUI-multi-preview.git
```

2. ComfyUIを再起動

## 使用方法

1. ワークフローで **MultiPreview** ノードを追加
2. 複数の処理結果（画像）を入力に接続
3. UIのボタンで画像を切り替えて表示
4. 各画像サイズと内容を確認可能

### 例
```
[Image Output A] → 
[Image Output B] → [MultiPreview] → (ブラウザで表示・切り替え)
[Image Output C] → 
```

## ライセンス

このプロジェクトはLICENSEファイルに従います。
