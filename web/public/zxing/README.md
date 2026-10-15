# zxing-wasm reader, self-hosted

`zxing_reader.wasm` is the WebAssembly build of [zxing-wasm](https://github.com/Sec-ant/zxing-wasm)
(MIT), copied unchanged from `node_modules/zxing-wasm/dist/reader/` at the version pinned in
`web/package.json`. `web/src/lib/barcode/detect.ts` loads it from here instead of the package's
CDN default, and only when the camera scanner opens on a browser without a `BarcodeDetector`.

After bumping `zxing-wasm`, copy the file again:

```sh
cp web/node_modules/zxing-wasm/dist/reader/zxing_reader.wasm web/public/zxing/
```

`web/src/lib/barcode/self-hosted.test.ts` fails until the two files match.
