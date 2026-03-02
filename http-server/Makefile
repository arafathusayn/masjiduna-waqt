.PHONY: build run dev test test-unit test-e2e check clippy clean bench bench-http fmt

PORT ?= 3000

# ── Build ──

build:
	cargo build --release

dev:
	cargo run

run: build
	PORT=$(PORT) ./target/release/salah-waqt-http

# ── Test ──

test:
	cargo test --release -- --nocapture

test-unit:
	cargo test --release unit -- --nocapture

test-e2e:
	cargo test --release e2e -- --nocapture

# ── Lint / Check ──

check:
	cargo check

clippy:
	cargo clippy -- -D warnings

fmt:
	cargo fmt

fmt-check:
	cargo fmt -- --check

# ── Benchmark ──

bench:
	cd .. && bun benchmarks/http-rust.ts

bench-oha: build
	@echo "Starting server on port 9877..."
	@PORT=9877 ./target/release/salah-waqt-http &
	@sleep 1
	@oha -n 100000 -c 100 --no-tui "http://localhost:9877/api/?lat=23.8103&lon=90.4125&tzname=Asia/Dhaka&date=2025-06-15&method=MWL"
	@-lsof -ti:9877 | xargs kill 2>/dev/null

# ── Clean ──

clean:
	cargo clean
	rm -f rust_server_err.log
