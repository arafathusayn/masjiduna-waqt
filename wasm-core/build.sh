#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Building WASM with SIMD + Rayon (nightly, build-std)..."
rustup run nightly cargo build --target wasm32-unknown-unknown --release

echo "Generating wasm-bindgen JS glue..."
~/.cargo/bin/wasm-bindgen \
  target/wasm32-unknown-unknown/release/wasm_core.wasm \
  --out-dir pkg \
  --target web \
  --weak-refs

echo "Done. Output in wasm-core/pkg/"
ls -lh pkg/wasm_core_bg.wasm
