# 来源与第三方声明

本插件复用 Piora 的鸿蒙设备实现，Piora MIT 许可见根目录 LICENSE；导入提交和文件清单见源码中的 vendor/provenance.json。适配代码也按 MIT 许可提供。

随包原生文件来源与许可位于 `dist/resources/tools/windows-x64/`：HDC（Apache-2.0）、libusb（LGPL-2.1）、投屏组件（MIT）。签名工程的来源与许可位于 `dist/resources/signing-project/`。这些文件来自用户提供的 Piora 工程，没有导入个人证书、密钥或设备授权材料。

内置视频资源来自依赖 hypium-driver；其他依赖保持各自的 npm 包及许可。工作台使用的 Lucide 风格图标包含 ISC 许可图形，来源 https://lucide.dev 。

悬浮窗使用 Electron（MIT）及其第三方组件。首次需要时通过 @electron/get（MIT）下载官方运行时，完整 LICENSE 和 LICENSES.chromium.html 随 Electron 解压保留；优先复用用户已有的 DSH Electron。@electron/get 和 extract-zip 保持各自许可。新适配代码 Copyright (c) 2026 kexijiang。

Copyright (c) for portions of Lucide are held by Lucide Contributors; permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is granted, provided that the copyright notice and permission notice appear in all copies. THE SOFTWARE IS PROVIDED “AS IS” WITHOUT WARRANTY; the authors are not liable for damages arising from its use.
