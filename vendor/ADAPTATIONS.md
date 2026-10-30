# Piora 快照适配

上游来源见 provenance.json。未改动 F:\Piora。

构建时替换的边界：src/adapters 中的 Pi 工具定义/JSON Schema、PromptRun、文件工作区、NextResponse、动态组件、HTTP 来源鉴别及运行时资源路径。原有设备管理、观察、租约、动作和场景代码保留。

快照内的局部改动：

- lib/harmony/transfer-jobs.ts：增加 dispose，取消并等待后台传输，释放续租计时器与控制租约。
- lib/harmony/database-export-jobs.ts：增加 dispose，取消并等待后台导出。
- components/workspace/HarmonyPanel.tsx：默认进入投屏页，设备信息独立成页；设置改为侧边抽屉；没有原生目录选择桥时隐藏选择按钮；视觉模型说明指向 DSH 当前对话模型。
- components/workspace/harmony/MirrorWindow.tsx：接入插件提供的原生悬浮窗桥，增加置顶、缩放及停靠按钮；修复标题栏的主题变量。
- HarmonySettingsSurface.tsx 和面板 CSS：独立、不透明的设置抽屉，随宿主深浅色更新。
- useTheme 在构建时替换为宿主主题订阅器，不再读取 Piora 的皮肤或主题存储。
- UiInspector、inspector-model 和 tree API：可选截图与坐标信息，提供快照拾取、树和属性联动。
- DeviceExplorer 替代文件页入口，使用现有文件 API 展示懒加载树表和操作侧面板；device-files 规范化根目录条目路径。
- 暂时隐藏应用、数据库、日志、终端、自动化和语音验证入口，保留原有实现和 Agent 工具。

原生窗口及鉴权端点由 src/native-mirror.ts 和 src/native-mirror.cjs 实现。它们不依赖 Piora Electron 主进程，窗口隐藏时停止画面订阅，插件卸载时关闭窗口和本地服务。

重新从上游导入时应保留/重新应用这些适配，并执行完整的定向检查。
