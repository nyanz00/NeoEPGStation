# NeoEPGStation 開発ロードマップ

## danmakuの高リフレッシュレート描画

### 現在の状態（2026-08-29）

- 4K・144Hz環境で、ほかの動画を同時再生するとdanmakuが前後へ震えるようにガクつく問題を調査した。
- 視聴設定の「danmakuを高リフレッシュレートで描画（実験的機能）」を有効にした場合、WebGL2のテクスチャアトラスとインスタンシングによるバッチ描画を使用する。
- コメントの開始位置、終了位置、開始時刻、表示時間を追加時にGPUバッファへ登録し、毎フレームの位置計算は頂点シェーダーで行う。
- CPU側で毎フレーム全コメントのインスタンスデータを作り直す処理は廃止した。GPUバッファの再生成は、コメントの追加・削除・プレイヤーのリサイズ時に限る。
- 従来の前後へ震えるガクつきは解消し、その後に残っていたごくまれな一瞬の詰まりも、GPU位置計算へ移行した時点ではほぼ気にならない状態になった。このため追加調査は一旦保留する。

### 実機計測結果

4K・144Hzモニターで実験的機能を有効にし、プレイヤーのinfoパネルで確認した値は以下の通り。

- `Danmaku Worker rAF`のp95: おおむね7.0～7.1ms
- `Danmaku GPU Time`: おおむね0.01～0.02ms
- 144Hzの理論フレーム間隔: 約6.94ms

この結果では、Workerのフレーム供給と通常のWebGL2描画はどちらも安定しており、現状のボトルネックではない。GPU時間は低頻度のタイマークエリで測定しており、コメント画像の生成やテクスチャ転送時間は含まれない場合がある。

### 再び気になった場合の次の調査

現状の描画方式や既定値を先に変更せず、同じ4K・144Hz環境とコメント量で次を計測する。

1. Worker rAF間隔のp99、最大値、10ms／14ms以上になった回数をinfoパネルへ追加する。
2. コメント文字列から画像を作る時間、`ImageBitmap`の生成時間、テクスチャアトラスへ登録する時間を個別に計測する。
3. 詰まりが新規コメントの追加時刻と一致するか確認する。
4. 上記が軽い場合は、Chrome/VivaldiのPerformanceトレースでCanvas合成、GPUプロセス、画面へのpresent待ちを確認する。
5. ブラウザの通常タブ、PWA、60Hz、144Hz、ほかの動画の同時再生あり／なしを同じ動画で比較する。

判断の目安:

- p99や最大値だけ大きい: Workerまたはブラウザのスケジューリング停止を疑う。
- GPU時間もフレーム予算へ近づく: WebGL描画やCanvasサイズを疑う。
- rAFとGPU時間が安定したまま見た目だけ詰まる: Chromeの合成・present経路を疑う。
- 新規コメント追加時だけ詰まる: 文字画像生成またはテクスチャ転送を疑う。

### 関連実装

NeoEPGStation:

- `client/src/pages/SettingsPage.tsx`
- `client/src/pages/OnAirWatchPage.tsx`
- `client/src/pages/RecordedWatchPage.tsx`
- `client/src/core/storage/settings.ts`
- DPlayer依存更新コミット: `8cc5eceb`

DPlayer `epgstation`ブランチ:

- `src/ts/webgl2-danmaku-batch-renderer.ts`
- `src/ts/webgl-danmaku-worker.ts`
- `src/ts/webgl-danmaku-worker-protocol.ts`
- `src/ts/webgl-danmaku-worker-renderer.ts`
- `src/ts/danmaku.ts`
- `src/ts/info-panel.ts`
- WebGL2バッチ描画コミット: `69c420d`
- GPU位置計算・計測追加コミット: `bda0c3c`
- 対応する生成済みバンドル: `c26f12a`
