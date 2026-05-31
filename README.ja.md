# ComfyUI MultiPreview

[English README](./README.md)

MultiPreview は、複数の画像入力を1つのノード内でプレビューするための ComfyUI カスタムノードです。

動的な画像入力ピン、ピンごとのプレビュー切り替え、バッチ画像のナビゲーション、ワークフロー実行中の即時プレビュー更新に対応しています。

## Features / 機能

- 1つのプレビューノードで複数の画像入力を扱えます
- 動的な `imageN` 入力ピン
  - 必要に応じて、新しい空の入力ピンが自動で追加されます
  - 空のピンは接続用として残ります
- 動的なプレビューボタン
  - 接続中のピン、またはプレビュー状態が保持されているピンにだけボタンが表示されます
- ピンごとのボタンでプレビュー対象を切り替えられます
- バッチ画像に対応
  - 各ピンごとに、バッチ画像の表示位置を保持します
  - ピンを切り替えると、そのピンで前回表示していたバッチ位置が復元されます
- 即時プレビュー更新
  - 各ピンの処理が完了した時点で画像が表示されます
  - 接続されているすべての入力が完了するまで待つ必要はありません
- Auto latest モード
  - `auto_latest` トグルを搭載
  - 有効にすると、最後に画像を受け取ったピンへ自動的にプレビューが切り替わります
- 安定した状態管理
  - ピンを切断しても、現在のプレビューはすぐには消えません
  - 古い状態は次回実行時に整理されます
- ノード実行ボタンへの対応
  - 通常のノード実行時の挙動も維持しています
- 画像のプリロード / キャッシュ処理
  - ピン切り替え時や新しい画像受信時のちらつきを軽減します

## Installation / インストール

1. このリポジトリをダウンロード、または clone して、ComfyUI の custom nodes ディレクトリに配置します。

```txt
ComfyUI/custom_nodes/ComfyUI-MultiPreview
```

2. ComfyUI を再起動します。

3. ブラウザをハードリロードします。

4. 以下のカテゴリからノードを追加します。

```txt
image / MultiPreview
```

## Usage / 使い方

画像出力を `image1`, `image2`, `image3`, ... の入力に接続します。

```txt
Image source A ──▶ image1
Image source B ──▶ image2
Image source C ──▶ image3
```

<img width="406" height="633" alt="MultiPreview screenshot" src="https://github.com/user-attachments/assets/ec0e2de7-bfe1-4677-83e3-30a81b9f7e06" />

MultiPreview は、接続された画像ピンごとにボタンを表示します。

ボタンをクリックすると、表示するプレビュー対象を切り替えられます。

接続された入力がバッチ画像を出力する場合は、通常の ComfyUI プレビュー操作でバッチ内の画像を切り替えられます。

## Auto Latest

`auto_latest` トグルでは、新しく画像を受け取ったピンへ自動でプレビューを切り替えるかどうかを制御できます。

- OFF: 現在選択中のピンを表示し続けます
- ON: 最後に画像を受け取ったピンへ自動的に切り替えます

## MultiPreview Auto

`MultiPreview Auto` は、ボタンや手動切り替えを省いた簡易版ノードです。

- 動的な画像ピンのみ
- ピン切り替えボタンなし
- 手動プレビュー切り替えなし
- 最後に画像を受け取ったピンを常に表示
- `MultiPreview` と同じ内部レシーバー機構を使用

最新の完了結果だけをコンパクトに確認したい場合に使用します。

## Notes / 補足

MultiPreview は、実行中に内部レシーバーノードを使用して、各入力の処理が完了した時点でプレビューを更新します。

これらの内部レシーバーノードは実行時に自動で注入されるため、手動で配置する必要はありません。




## 一時プレビューファイルについて

MultiPreview は、ComfyUI 標準の一時プレビュー画像保存機構である `PreviewImage.save_images()` を使用しています。

そのため、プレビュー画像ファイルは標準の ComfyUI プレビューノードと同様の仕組みで扱われます。


## v1.2.8

ComfyUI のタブ / view 切り替え時に、一時的な空状態でプレビューキャッシュが上書きされる問題を抑制したメンテナンスリリースです。

- MultiPreview ノード用のフロントエンド状態キャッシュを追加
- ComfyUI のタブ / view 切り替え後にプレビュー画像を復元
- 選択中 pin と pin ごとの batch index を復元
- ノード UI 再構築後にプレビューボタンを復元


## 状態復元について

MultiPreview は、ノードごとの状態をフロントエンド側のメモリに一時保存します。

ComfyUI のタブや view を切り替えた際にノード UI が再構築された場合、以下の状態を復元します。

- 保存済みプレビュー画像
- 選択中の pin
- pin ごとの batch index
- プレビューボタン

この状態はブラウザセッション内の一時的な復元用であり、ワークフローへの永続保存を目的としたものではありません。


### 復元タイミング修正

v1.2.3 では、ComfyUI がノードの最終 id / 状態を確定する前に setup hook を呼ぶケースに対応しました。有効なキャッシュ状態が見つかった場合だけ復元済みとして扱い、ウィジェット初期化後に遅延復元を1回実行します。


### 状態キャッシュ保護

v1.2.4 では、タブ / view 切り替え中に一時的な空の UI 状態が発生しても、既存のプレビューキャッシュを上書きしないようにしました。また、復元時に現在の canvas graph と root graph の両方を探索します。


## Debug Build / デバッグ版

このデバッグ版では、MultiPreview のライフサイクル、状態保存 / 復元、receiver payload、pin 選択処理について詳細な console ログを出します。

ブラウザコンソールで以下を検索してください。

```txt
[MultiPreview v1.2.8]
```


### デバッグログのスパム抑制

v1.2.8 では、1秒ごとの定期保存ログをデフォルトで無効化しています。receiver 更新、pin 選択、ライフサイクルイベント、blur、visibilitychange、beforeunload では引き続き状態保存されます。


### 復元リトライ修正

v1.2.8 では、タブ / view 切り替えで live 側の pin 画像状態が空になっても、キャッシュ済みプレビュー画像が残っている場合は再度復元を試みます。


## v1.2.8

古いプレビューの削除と state cache の安全性を改善したリリースです。

- 画像入力がすべて未接続の状態で実行した場合、プレビュー画像・node image 配列・復元キャッシュを削除
- 全入力を外して再実行した際に古いプレビューが復元されないように修正
- キャッシュ復元前に接続スナップショットを確認
- 可能な場合は state cache key に graph 識別子を含めるように変更
- verbose debug logging をデフォルト無効化


## v1.2.9

バッチ表示位置の保持に関する修正です。

- `node.imageIndex` の変更を監視し、選択中 pin の batch index を即時保存
- 初期 graph / configure 処理で、復元済みの pin ごとの batch index が消えないように修正


## v1.2.10

全入力未接続時のプレビュー削除クラッシュ修正です。

- すべての画像入力を外して MultiPreview を実行した際のクラッシュを修正
- `node.imgs` / `node.images` に空配列を入れず、プロパティ削除でクリアするように変更
- v1.2.9 の batch index 保持修正は維持


## v1.2.11

プレビュー削除時の安全用プレースホルダー修正です。

- ComfyUI 標準 preview widget が削除されるまでの間、空の `node.imgs` ではなく透明1px画像を保持
- 非同期で再生成される標準 preview widget の削除タイミングを追加
- 利用可能な場合は legacy `app.nodeOutputs` の image 情報も削除


## v1.2.12

全入力未接続時のプレビュー削除挙動を調整しました。

- v1.2.11 の透明1pxプレースホルダーを廃止
- 全画像入力が未接続の場合でも `node.imgs` / `node.images` に空配列を入れないように変更
- ComfyUI 標準 preview widget が一瞬残る場合は、通常の Preview Image と同様に直前の非空プレビュー配列を維持
- 全入力未接続実行時の stale restore cache 抑止は維持


## v1.2.13

バッチ表示位置のキャッシュ保存タイミング修正です。

- `node.imageIndex` 変更後、選択中 pin の batch index を復元キャッシュへ即時保存
- `saveNodeStateSoon()` を microtask で実行し、素早いタブ / view 切り替え時の取りこぼしを抑制
- v1.2.12 の全入力未接続時のクリア挙動は維持


## v1.2.14

画像入力なし実行時の挙動修正です。

- MultiPreview が画像入力未接続のまま実行された場合に execution error を発生させ、通常の Preview Image と同様にノードが赤くなるように修正
- 全入力未接続時の stale preview state クリア時に、現在表示中の batch page を維持
- stale restore cache 抑止と batch index cache timing 修正は維持


## v1.2.15

画像入力なし実行時の表示挙動を調整しました。

- 実行済みの MultiPreview で全画像入力を外して実行した場合、現在のプレビュー表示を維持したままノードが赤くなるように変更
- まだプレビューのない新規 MultiPreview を画像入力なしで実行した場合は、画像なしのまま赤くなります
- no-input error 状態へ入る際も pin ごとの batch index を維持


## v1.2.16

エラーメッセージの調整です。

- 画像入力なし実行時のエラーメッセージを `Required input is missing: images` に変更
- 実行済みプレビューを維持したままノードが赤くなる v1.2.15 の挙動は維持


## v1.2.17

軽量なちらつき低減対応です。

- 現在の `node.imgs` がない場合でも、対象画像が未ロードなら pin 切り替えを defer するように変更
- 標準 preview widget 削除の 500ms 遅延 sweep を削除
- receiver 更新時、ウィジェット初期化済みの場合は軽量な状態初期化のみ行うように変更
- v1.2.16 の画像入力なしエラーメッセージ挙動は維持


## v1.2.18

小規模な安定性改善です。

- `onConnectionsChange` に schedule guard を追加し、動的 pin 調整処理が重複して queue されにくいように修正
- image cache から削除される画像について、handler 削除・`img.src` クリア・waiter callback クリアを明示的に実行
- v1.2.17 のちらつき低減対応は維持


## v1.2.19

receiver の state 管理経路を一本化しました。

- internal receiver に安定した `state_key` を追加
- workflow タブが表でも裏でも、receiver payload はまず global preview state store を更新
- live node が存在する場合のみ、同じ保存済み state を UI に反映
- preview 保持、selected pin、pin ごとの batch index 復元を state_key ベースの単一路線に統一


## v1.2.20

state_key fallback と cache eviction の安全性修正です。

- cache eviction 時に `img.src` や waiter callback を消さず、Map 参照のみ削除するように変更
- 表示中プレビューや deferred selection が cache eviction で壊れる問題を回避
- prompt node id / class_type から作る fallback state key を追加
- live graph node が見つからない prompt injection 経路でも receiver payload を保存可能に変更
- 復元時は graph-based state key と prompt fallback state key の両方を確認
- v1.2.19 の receiver state 一本化は維持


## v1.2.21

レビュー指摘対応です。

- `injectInternalReceiversIntoPrompt()` 内の未定義 fallback 定数を修正
- `removeStandardPreviewWidgetsSoon()` に schedule guard を追加し、重複 timer を抑制
- `onExecuted` hook で意図的に未使用にしている変数へ補足コメントを追加
- v1.2.20 の state-key fallback と安全な cache eviction 挙動は維持


## v1.2.22

ノード削除時の cleanup 対応です。

- MultiPreview ノードに `onRemoved` lifecycle hook を追加
- ノード削除時に、graph-based / prompt-fallback の preview state key を `globalStateStore()` から削除
- v1.2.21 のレビュー指摘対応と v1.2.20 の state-key fallback 挙動は維持

注意: 将来の ComfyUI frontend で、実際のノード削除ではなく workflow tab unload 時にも `onRemoved` が走る場合は、より厳密な削除判定 guard が必要になる可能性があります。


## v1.2.23

自動更新時の 0x0 ちらつき低減です。

- `syncContextMenuImages()` で、差し替え先 batch 全体の読み込みが終わるまで直前の `node.imgs` を維持
- 新しい未ロード画像を標準 preview widget が一瞬 0x0 として描画する問題を抑制
- 復元経路と fallback 実行経路も deferred pin selection を使うように変更
- v1.2.22 の onRemoved cleanup 挙動は維持


## v1.2.24

バッチのグリッド表示復元修正です。

- ComfyUI 標準の `node.imageIndex = null` によるグリッド表示状態を 0 ページ目へ丸めないように変更
- 標準 preview の `X` ボタンで batch preview がグリッド表示へ戻らない問題を修正
- pin ごとの batch page と一緒に、pin ごとの grid view 状態も保存・復元
- v1.2.23 の 0x0 ちらつき抑制挙動は維持


## v1.2.25

デフォルト batch index の修正です。

- `undefined` の imageIndex は未保存状態として扱い、デフォルトの 0 ページ目にするように変更
- 明示的な `null` の imageIndex は ComfyUI 標準の batch grid view 状態として維持
- 新規 / default 表示が grid 扱いになる問題を避けつつ、`X` ボタンによる grid 表示は維持


## v1.2.26

workflow 復元 / 再接続時の安全な input 処理です。

- `onNodeCreated` / `onConfigure` 中の `ensureWidgets()` では dynamic image input を削除しないように変更
- `reconcileDynamicInputs()` に `allowRemove: false` を追加し、読み込み中は削除を抑制
- input 削除は明示的な接続変更時と実行時に限定し、LiteGraph の workflow 復元中に link / slot 配置が崩れるリスクを低減
- v1.2.25 の default index / grid 挙動は維持
