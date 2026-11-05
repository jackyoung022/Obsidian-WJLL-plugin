# Obsidian 社区目录提交

截至 2026-11-05，已完成提交前的仓库与版本准备；**尚未正式提交、尚未上架**。最终状态以 Obsidian Community 后台为准。

## 提交信息

- 仓库：https://github.com/jackyoung022/Obsidian-WJLL-plugin
- 英文名称：Dragon Scroll Home
- 插件 ID：dragon-scroll-home
- 准备版本：1.3.2
- 最低版本：Obsidian 1.14.4
- 开源协议：MIT
- 描述：Browse folders and notes as traditional Chinese scrolls, with vertical summaries, nested volumes, and configurable folder visibility.

## 已完成的规范调整

- 显示名称使用 Basic Latin；中文首页和品牌保留。
- 简短英文描述以句点结尾，少于250字符。
- 最低版本以实机验证版本为准；旧版本映射仍保留。
- 启动逻辑只在布局就绪后执行；卸载后不能触发延迟打开。
- 刷新定时器在卸载时取消，拖拽防误触使用时间戳。
- 不在卸载时强制移除工作区标签。
- 设置分节使用 Setting.setHeading，缩进使用CSS变量。
- 命令使用open-home和refresh-home，由Obsidian自动添加插件ID前缀。
- README、MIT LICENSE、五张示例截图与对应Release附件齐全。
- Node检查、卸载/异步加载生命周期测试、示例库浏览器交互检查和安装ZIP检查通过。

## 官方提交流程

1. 登录 [Obsidian Community](https://community.obsidian.md/)，设置个人资料并关联GitHub。
2. 进入 Plugins → New plugin，填写上述仓库URL和条目所有者。
3. 账号本人阅读开发者政策、确认持续维护承诺，并最终提交。
4. 根据自动审核反馈修正问题；通过平台审核前不能宣称已上架。

## 官方资料

- [提交说明](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [账号关联与提交表单](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Community%20directory/Set%20up%20and%20claim.md)
- [Manifest](https://docs.obsidian.md/Reference/Manifest)
- [提交要求](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Community%20directory/Submission%20requirements%20for%20plugins.md)
- [Plugin guidelines](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Releasing/Plugin%20guidelines.md)
