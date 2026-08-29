# ComfyUI MultiPreview

[English README](./README.md)

MultiPreview は、複数の画像出力を1つのノードで確認するためのライブプレビューノードです。並列に分岐したワークフローでも、ブランチごとに Preview Image ノードを配置せず、結果を1か所にまとめて確認できます。

## 機能

- 最大32個の動的な `IMAGE` 入力（`image1`, `image2`, ...）
- 各入力の処理が完了した時点でプレビューを即時更新
- ピンボタンによる入力画像の切り替え
- 最後に完了した入力へ自動で切り替える `auto_latest` トグル
- バッチ画像の表示と、ピンごとの表示位置の記憶
- 同じブラウザセッション内でタブや表示を切り替えた際のプレビュー復元
- 最新の入力だけを自動表示する簡易版 `MultiPreview Auto`

## インストール

このリポジトリをダウンロードまたはcloneし、ComfyUIのcustom nodesディレクトリに配置します。

```txt
cd ComfyUI/custom_nodes
git clone https://github.com/palealloy2999-prog/comfyUI-multi-preview
```

ComfyUIを再起動し、ブラウザをハードリロードしてください。

ノードは次のカテゴリから追加できます。

```txt
image / MultiPreview
image / MultiPreview Auto
```

## 使い方

異なるワークフローブランチの画像出力を、`image1`, `image2`, `image3`の順に接続します。必要になると、新しい空の入力ピンが自動で追加されます。

```txt
Image source A ──▶ image1
Image source B ──▶ image2
Image source C ──▶ image3
```

<img width="406" height="633" alt="MultiPreview screenshot" src="https://github.com/user-attachments/assets/ec0e2de7-bfe1-4677-83e3-30a81b9f7e06" />

通常どおりワークフローを実行してください。MultiPreviewは、すべてのブランチの完了を待たず、接続された各ブランチが完了するたびにプレビューを更新します。

- 番号付きのピンボタンをクリックすると、その入力画像を表示します。
- `auto_latest`をONにすると、最後に完了した入力へ自動的に切り替わります。
- バッチ画像はComfyUI標準の画像操作で切り替えられます。表示位置はピンごとに記憶されます。

## MultiPreview Auto

`MultiPreview Auto`は、最後に完了した入力を常に表示します。ピンボタンや手動切り替え機能がないため、並列ブランチの最新結果だけをコンパクトに確認したい場合に適しています。

## 補足

- MultiPreviewはプレビュー用の出力ノードであり、`IMAGE`出力はありません。
- プレビュー画像と復元用のUI状態は一時的なものです。プレビューキャッシュは現在のブラウザセッション内だけで保持されます。
- 内部レシーバーノードは実行時に自動で追加されるため、手動で配置する必要はありません。
- プレビューファイルにはComfyUI標準のtempディレクトリを使用します。通常のブラウザ実行では、各MultiPreview入力を内部レシーバーが1回だけ保存します。
