# Stretch goal: Rust and standalone releases

Freegas stays on Node.js while we validate provider behavior and the real coding-harness experience. A Rust migration is a future target, not current functionality or an announced release date.

The goal is a small executable users can download and run without installing Node or Rust. Sharing Hub's implementation language is useful for maintenance, but the HTTP boundary does not require it.

Acceptance targets:

- Preserve the CLI's Gas Stations, Pre-roll format, credential boundaries, and fuel jokes.
- Pass equivalent black-box tests for routing, cooldowns, cancellation, tool calls, streaming, imports, exports, and error codes.
- Prove parity through the pinned Hub integration and a real provider/tool-calling harness session.
- Build and smoke-test Windows x64, Linux x64/ARM64, and macOS Intel/Apple Silicon release artifacts. Confirm runner/toolchain availability before promising support.
- Attach checksums and build provenance to GitHub Releases; document signing/notarization status.
- Support existing Node configurations or ship a tested migration path.
- Compare install size, startup time, memory, maintenance effort, and contributor accessibility before replacing the Node implementation.

Until then, releases contain a portable Node CLI tarball requiring Node.js 22.16+. They are not native binaries. Node single-executable packaging is an alternative worth evaluating before committing to a port.
