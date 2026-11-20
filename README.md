# Neon RenderPipeline Lab — WebXR × WebGPU

Three.js r187 の `WebGPURenderer` と WebXR WebGPU Binding (`XRGPUBinding`) を使い、
`RenderPipeline`（旧 PostProcessing）の各エフェクトを VR の中で調整しながら見られるデモです。
シーンはネオンゲートが立つ紫の未来都市（ガラスのような反射床、星空、霧、岩）です。

## デモ（GitHub Pages）

**https://webxr-jp.github.io/webxr-webgpu-renderpipeline-demo/**

`main` に push すると GitHub Actions（[.github/workflows/deploy.yml](.github/workflows/deploy.yml)）が
`npm ci` → `vite build` → Pages への公開までを行います。初回だけリポジトリの
**Settings → Pages → Source** を **GitHub Actions** に設定してください。

- Pages はサブパス（`/<リポジトリ名>/`）で配信されるため、CI が `configure-pages` の出力から
  `BASE_PATH` と `SITE_URL` を Vite に渡します（`<user>.github.io` リポジトリなら `/`）。
- 共有用サムネは [public/ogp.jpg](public/ogp.jpg)（1200×630）。OGP は絶対 URL が必要なので、
  `index.html` の `__SITE_URL__` をビルド時にサイト URL へ置換しています。
- Pages は HTTPS なので、ヘッドセットからもそのまま URL を開けます（WebXR のセキュアコンテキスト要件）。

ローカルで本番ビルドを確認する場合:

```bash
npm run build && npm run preview
```

## 起動

```bash
npm install
npm run dev
```

- デスクトップ: `https://localhost:5173`（自己署名証明書の警告は許可してください）
- ヘッドセット: 同じ LAN から `https://<PCのIP>:5173`
- 証明書警告を避けたい場合（ローカル確認・自動テスト用）: `NO_HTTPS=1 npm run dev` で `http://localhost:5173`
  （localhost はセキュアコンテキストなので WebGPU も動きます）

## 必要環境

- WebGPU 対応ブラウザ
- VR で WebGPU を使うには、ブラウザが `XRGPUBinding` と `webgpu` セッション機能に対応している必要があります
  （Chromium 系ではフラグ / Origin Trial の場合あり）。セッションは `requiredFeatures: ['webgpu']` で要求します。
  画面左上に Backend と XRGPUBinding の対応状況が表示されます。

## 操作

| | デスクトップ | VR |
|---|---|---|
| パラメータ調整 | シーン内パネルをクリック / 右上の lil-gui | コントローラーのレイ + トリガー（スライダーはドラッグ） |
| パネルを呼ぶ | – | グリップ（squeeze） |
| 移動 | ドラッグで Orbit | 左スティック移動 / 右スティック 30° スナップターン |

## エフェクト

Bloom / Lens Flare / Chromatic Aberration / Afterimage / Color Grade（Exposure・Contrast・Saturation・Hue・Tone Mapping）/
Vignette / Scanlines / Film Grain / FXAA / MSAA / シーンパスの解像度スケール。
プリセット: Neon Dream, Clean, Retro CRT, Dream Trail, Overdrive。`POST: ON/OFF` で生の描画と比較できます。

スライダーは uniform の更新だけなので即時に反映されます。ON/OFF の切り替えはノードグラフを組み直すため、
シェーダーの再コンパイルで一瞬止まることがあります。

## 仕組み（XR でのポストプロセス）

WebGPU XR セッションでは、three.js はプロジェクションレイヤーを **2 レイヤーのテクスチャ配列**（片目 1 レイヤー）として描画します。
r187 の標準 `PassNode` / `RenderPipeline` はまだ配列に対応していないため、このデモでは
[src/pipeline.js](src/pipeline.js) の `PipelineLab.renderStereo()` で次のように処理しています。

1. `renderer.xr.updateCamera()` で各目の XR ビューカメラを求める
2. 目ごとに独立した `RenderPipeline`（scene pass → bloom → … → `renderOutput`）を通常の `PerspectiveCamera` で実行する
3. `renderer.setRenderTarget( xrTarget, eyeIndex )` で、結果を配列のそのレイヤーへ書き込む
4. UI（パネル・レイ）は色変換なしのオーバーレイパスで最後に描くので、Bloom などのエフェクトがかからない

デスクトップ GUI の **Desktop view → Stereo preview (XR path)** をオンにすると、
同じコードパスを 2 レイヤーの配列 RT に対して実行し、左右に並べて表示します（ヘッドセットなしでの確認用）。

## ファイル

- [src/main.js](src/main.js) — レンダラー、XR、コントローラー、ループ
- [src/scene.js](src/scene.js) — ネオン都市（TSL マテリアル、インスタンス描画、ミラー反射）
- [src/pipeline.js](src/pipeline.js) — RenderPipeline のノードグラフと目ごとのレンダリング
- [src/vrPanel.js](src/vrPanel.js) — CanvasTexture で描く VR 内パネル
- [src/params.js](src/params.js) — 全パラメータ、UI の定義、プリセット
