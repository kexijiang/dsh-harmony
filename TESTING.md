# 验收记录

版本：0.3.3。日期：2026-10-31（Asia/Shanghai）。

环境：Windows x64、DSH NEXT 2.0.21-next、内置 dsh 0.2.1-rc.4、Better Sidebar 0.28.2、Electron 43.3.0、USB 连接的 HUAWEI Mate 60。

## 桌面操控与真机

- 在 NEXT 右侧 Better Sidebar 中打开“鸿蒙设备”，热停用和重新启用后页面、路由正常恢复。
- 通过 NEXT 设置切换深色、浅色，面板、设置抽屉和投屏工具栏同步；验收后恢复“跟随系统”。
- 查看应用列表、共享目录文件列表、独立设备信息页和设置抽屉；设备资料不再堆在投屏画面下方。
- 打开侧栏真机视频及连接详情，验证对话框使用不透明背景。
- 打开独立 Windows 悬浮窗，显示真实设备画面；点击置顶、选择 80% 缩放、移回面板和关闭投屏，确认实际窗口及侧栏变化。
- 设备息屏时视频停止，亮屏后重新建立视频。没有绕过设备锁屏。

发现并修复：首次启动隐藏 GUI、默认浮动层级未保持 Windows 置顶、重复设置未置顶状态影响窗口顺序，以及 Cordis 停用时未执行路由注销。

## 自动检查

- `npm run check`：16 项测试通过，覆盖真实 HDC 枚举、Agent 工具参数、租约、截图附件、取消、SQLite worker、路径边界、HTTP 来源校验、Better Sidebar 注册与真实 Cordis 资源释放。
- `node scripts/check-redesign.mjs`：深浅色、不透明弹窗、设置抽屉和独立功能页通过。
- `node scripts/check-ui.mjs`：420 px 面板、真机枚举和设备设置通过，无页面错误或失败 HTTP 请求。
- `node scripts/check-native.mjs --device`：接收真实视频帧；核对原生窗口实际可见性、置顶/取消置顶、尺寸、停靠隐藏、重新打开和关闭。
- 在 NEXT 自带 Electron 下运行 `scripts/check-installed.mjs`：已安装包的 PTY、SQLite、Hypium IPC 通过。
- 已通过 NEXT 的真实 Agent 工具管线执行设备枚举。

## 范围

应用安装/卸载、文件删除、修改数据库、对外发送消息，以及系统录屏等有实际数据副作用的操作不属于本次真机冒烟验收。没有把单元测试代替真机结果。

公开展示图使用测试数据；包含真实设备和本机路径的验证输出只保存在本地 `.verification/`，不随仓库或发行包发布。
