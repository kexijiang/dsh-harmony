# Third-Party Notices

This plugin builds on code and runtime assets adapted from [Piora](vendor/provenance.json).

- **Piora Harmony Workbench & Control Runtime** (`vendor/piora/`): MIT License (see [LICENSE](LICENSE)).
- **Bundled Windows HDC Toolchain** (`dist/resources/tools/windows-x64/hdc.exe`, `libusb_shared.dll`): OpenHarmony HDC (Apache-2.0), OpenHarmony third_party_libusb (LGPL-2.1-or-later), and HongJing toolchain distribution notice (MIT). License texts are packaged under `dist/resources/tools/windows-x64/`. `OHScrcpyServer.hap` is not bundled or distributed by this plugin.
- **Bundled Native Video Capture Libraries** (`dist/third_party/harmony-video/`): HOScrcpy 1.0.18-beta Unix-socket ARM64 libraries (MIT License; license and source provenance preserved in `dist/third_party/harmony-video/LICENSE` and `dist/third_party/harmony-video/SOURCE.md`), alongside `hypium-driver` bundled `libscrcpy_server-*.so` runtime libraries.
- **Harmony Log Workbench Archive & Extraction Dependencies** (`dist/third_party/harmony-log-workbench/`, `7z-bin`, `yauzl`): Log workbench helper notices and license texts (7-Zip LGPL-2.1 / BSD / MIT) are preserved under `dist/third_party/harmony-log-workbench/`. `7z-bin` and `yauzl` are installed as standard npm runtime dependencies.
- **Desktop Peer Runtime Dependencies**: `hypium-driver`, `mediabunny`, `sharp`, `@grpc/grpc-js`, `@sqlite.org/sqlite-wasm`, `ws`, `node-pty`, `proper-lockfile`, `jszip`, `iconv-lite`, and `typebox` remain attributed to their respective upstream authors and licenses.
