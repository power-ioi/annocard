# AnnoCard / 标注卡片融合插件

为 Obsidian 笔记添加文本标注、高亮、批注和注音功能，并以卡片化管理聚合全库标注。
Add text annotations, highlights, notes, and ruby characters to Obsidian notes, with a card-based sidebar aggregating annotations across the vault.

标注数据存储在独立的标注文件中，不修改原始 Markdown 文件。支持阅读模式和实时预览编辑模式（支持在标注模式中修改笔记）。
Annotation data is stored in separate annotation files without modifying the original Markdown files. Supports both reading mode and live preview editing mode (including editing notes in annotation mode).

> **融合来源 / Fusion Sources**：AnnoCard 由两个上游 Obsidian 插件融合而成：
> - 数据层（标注文件存储、diff 同步、跨段/嵌套渲染、阅读模式、选区菜单、注音、旧版导入）源自 [obsidian-annotation-marker](https://github.com/uuq007/obsidian-annotation-marker)（作者：uuq007）。
> - 卡片化管理层（卡片侧边栏聚合、颜色/关键词/标签筛选、批量删除、复习模式）在 annotation-marker 既有侧边栏基础上扩展，UI/交互设计参考自 [HiLighter](https://github.com/PandoraReads/HiLighter)（作者：PandoraReads）。HiLighter 仓库仅含编译产物，无 TypeScript 源码；按约束未复制压缩代码，所有卡片逻辑均基于 annotation-marker 的 TS 侧边栏重写实现。
>
> **Fusion sources**: AnnoCard merges two upstream Obsidian plugins. The data layer (annotation file storage, diff sync, cross-block/nested rendering, reading mode, selection menu, ruby, legacy import) originates from [obsidian-annotation-marker](https://github.com/uuq007/obsidian-annotation-marker) by uuq007. The card management layer (sidebar aggregation, color/keyword/tag filters, batch delete, review mode) extends annotation-marker's existing sidebar; UI/interaction design is inspired by [HiLighter](https://github.com/PandoraReads/HiLighter) by PandoraReads. HiLighter ships only a compiled bundle without TypeScript sources; per constraints, no minified code was copied — all card logic was rewritten on top of annotation-marker's TS sidebar.

## Features / 功能特性

### Annotation Types / 标注类型

- **彩色标注** — 默认 5 种颜色高亮（红、蓝、黄、绿、紫），可在设置中扩展至最多 10 种并自定义色值与标签名

  **Color highlights** — 5 highlight colors by default (red, blue, yellow, green, purple), expandable up to 10 in settings with custom hex values and labels

- **批注** — 为标注添加详细笔记，悬浮即可查看

  **Notes** — add detailed notes to annotations, viewable on hover

- **注音** — 为选中文本添加注音（ruby 标签），支持多个注音

  **Ruby** — add ruby characters to selected text, supports multiple ruby annotations

- **全文标注** — 一键标注文件中所有相同文本

  **Full-text annotation** — annotate all occurrences of the selected text in one click

- **跨段标注** — 支持跨越段落和文本块的标注

  **Cross-block annotation** — annotate text spanning multiple paragraphs or blocks

- **嵌套/重叠标注** — 自动处理标注重叠区域的渲染

  **Nested/overlapping annotations** — automatic rendering of overlapping annotation regions

### Interactions / 交互操作

- 选中文字后直接选择颜色添加标注

  Select text and pick a color to instantly add an annotation

- 点击标注弹出操作菜单（编辑颜色、批注、注音、删除）

  Click an annotation to open the action menu (edit color, note, ruby, delete)

- 鼠标悬浮显示批注内容气泡

  Hover over annotations to see note content in a popup

- 标注列表面板 — 浮动显示当前文件所有标注，点击可跳转

  Annotation list panel — floating panel showing all annotations in the current file, click to navigate

- 侧边栏标注管理视图 — 按文件浏览全部标注，支持搜索和颜色筛选

  Sidebar annotation management view — browse all annotations by file, with search and color filtering

### Mobile Support / 移动端支持

- 手机上长按选词或拖动选择手柄，选区稳定后自动弹出添加标注菜单；拖动手柄期间菜单不会弹出，弹出后仍可继续拖手柄调整选区，菜单原地跟随更新（已输入的批注与所选颜色保留）

  On mobile, long-press to select a word or drag the selection handles; once the selection is stable, the add-annotation menu pops up automatically. The menu stays out of the way while you drag the handles, and keeps updating in place if you adjust the selection afterwards — your note text and chosen color are preserved

- 点击已有标注打开操作菜单 — 移动端查看/编辑批注的入口

  Tap an existing annotation to open its action menu — the entry point for viewing/editing notes on mobile

- 弹出菜单不抢占焦点，不会被软键盘顶飞布局；悬浮气泡在切换文件、滚动或点击其他区域时自动收起

  Menus don't steal focus on open, so the soft keyboard won't break the layout; note bubbles auto-dismiss on file switch, scroll, or tapping elsewhere

- 触屏优化：无粘滞悬停态、按压反馈，标注列表悬浮球可用手指自由拖动

  Touch-friendly: no sticky hover states, press feedback, and the annotation-list floating button can be dragged freely with a finger

### Dual Mode Support / 双模式支持

- **阅读模式** — 标注以彩色 `<mark>` 标签渲染

  **Reading mode** — annotations rendered as colored `<mark>` tags

- **实时预览编辑模式** — 通过 CodeMirror 6 扩展显示标注高亮和注音

  **Live preview editing mode** — annotation highlights and ruby displayed via CodeMirror 6 extensions

### File Management / 文件管理

- 标注数据独立存储，原始文件零侵入

  Annotation data stored independently, zero intrusion on original files

- 原文件修改后自动同步到标注文件（基于 diff 算法）

  Auto-sync to annotation files when original files are modified (diff-based algorithm)

- 原文件重命名/删除时自动迁移/清理标注数据

  Auto-migrate/clean annotation data when original files are renamed or deleted

- 支持从旧版插件导入标注数据

  Support importing annotation data from older plugin versions

### Configurable Options / 可配置项

- 默认标注颜色

  Default annotation color

- 标注颜色自定义（默认 5 种，最多扩展至 10 种，支持十六进制色值）

  Customize annotation colors (5 by default, expandable up to 10; hex color values supported)

- 颜色标签名称

  Color label names

- 批注最大长度

  Max note length

- 批注视觉效果（无/粗线/虚线/波浪线/双线）

  Note visual effect (none/thick/dashed/wavy/double underline)

- 注音字体大小和颜色

  Ruby font size and color

## Installation / 安装

### Manual Installation / 手动安装

1. 从 [Releases](https://github.com/uuq007/obsidian-annotation-marker/releases) 下载最新版本

   Download the latest version from [Releases](https://github.com/uuq007/obsidian-annotation-marker/releases)

2. 将 `main.js`、`manifest.json`、`styles.css` 复制到 vault 的 `.obsidian/plugins/obsidian-annotation-marker/` 目录

   Copy `main.js`, `manifest.json`, `styles.css` to your vault's `.obsidian/plugins/obsidian-annotation-marker/` directory

3. 在 Obsidian 设置中启用插件

   Enable the plugin in Obsidian settings

### Build from Source / 从源码构建

```bash
git clone https://github.com/uuq007/obsidian-annotation-marker.git
cd obsidian-annotation-marker
npm install
npm run build
```

## Usage / 使用方法

1. 点击左侧边栏的标注图标进入标注视图

   Click the annotation icon in the left sidebar to enter annotation view

2. 选中文字后弹出颜色选择菜单

   Select text to bring up the color picker menu

3. 点击已有标注可编辑或删除

   Click an existing annotation to edit or delete it

4. 通过命令面板可执行：

   Available commands via the command palette:
   - `切换标注视图` — 在普通视图和标注视图间切换

     `Toggle annotation view` — switch between normal and annotation views

   - `标注管理侧边栏` — 打开标注管理面板

     `Annotation management sidebar` — open the annotation management panel

   - `导入旧标注插件数据` — 从旧版插件迁移数据

     `Import legacy annotation data` — migrate data from older plugin versions

## Differences from Legacy Versions / 与旧版的区别

v3.0.0 后续版本是完全重写的版本，主要变化：
v3.0.0 and later are complete rewrites. Key changes:

- 标注数据不再使用 JSON 文件存储，改为嵌入到插件目录下独立的 Markdown 标注文件中，不影响 Obsidian 仓库

  Annotation data is no longer stored as JSON files; instead embedded in separate Markdown annotation files under the plugin directory, leaving the Obsidian vault untouched

- 支持编辑模式（CodeMirror 6）

  Support for editing mode (CodeMirror 6)

- 新增侧边栏标注管理视图

  New sidebar annotation management view

- 新增全文标注、跨段标注、注音功能

  New full-text annotation, cross-block annotation, and ruby features

- 更好的标注重叠处理

  Better handling of overlapping annotations

- 提供旧版数据导入命令，可从旧版平滑迁移

  Legacy data import command for smooth migration from older versions

## Limitations / 插件限制

- 暂不支持对嵌入内容添加标注

  Embeds are not yet supported for annotation

- 暂不支持对代码块内容添加标注

  Code blocks are not yet supported for annotation

## Roadmap / 后续功能

- [x] 导出标注到仓库笔记中

  Export annotations into vault notes

- ……

## AnnoCard 卡片化管理（新增）/ Card Management (New)

AnnoCard 在 annotation-marker 既有功能上新增了卡片化管理能力：

AnnoCard adds card-management capabilities on top of annotation-marker:

### 卡片侧边栏 / Card Sidebar

- **当前文件 / 全库切换** — 默认显示当前文件的标注；可切换为聚合全库所有标注的卡片列表。默认范围可在设置中配置。

  **Current file / All notes** — default shows annotations from the current file; switch to aggregate annotations across the entire vault. Default scope is configurable in settings.

- **颜色 / 关键词 / 标签筛选** — 颜色为 OR（选多个色则显示任一命中），标签为 AND，关键词匹配 text/note/fileName 不区分大小写。

  **Color / keyword / tag filters** — colors OR, tags AND, keyword matches text/note/fileName (case-insensitive).

- **已归档过滤** — 默认隐藏 archived=true 的卡片，可一键切换显示。初值来自设置。

  **Archive filter** — archived cards hidden by default; one-click toggle. Initial value comes from settings.

- **分页加载** — 标注 >100 条时按每页 100 条分页渲染，滚动到底自动加载下一页，避免一次性渲染卡顿。

  **Pagination** — when annotations exceed 100, renders in pages of 100; auto-loads the next page on scroll to prevent jank.

- **点击卡片跳转原文** — 复用 annotation-marker 的 `scrollToAnnotation` 锚点 API 精确定位（不用文本搜索，避免重复内容错位）。

  **Click a card to jump to the source** — reuses annotation-marker's `scrollToAnnotation` anchor API for precise positioning (no text search, preventing misalignment on duplicate content).

### 卡片交互 / Card Interactions

- **内联编辑批注** — 卡片上的"编辑"按钮直接把批注区替换为 textarea，Ctrl/Cmd+Enter 保存、Esc 取消。

  **Inline note editing** — the "Edit" button replaces the note area with a textarea; Ctrl/Cmd+Enter to save, Esc to cancel.

- **标签 chips** — 卡片底部展示已有标签 chips，点击 × 删除单个标签，点击 + 弹出 `TagSuggest` 智能推荐（按频次降序，支持前缀/子串/fuzzy 匹配）。

  **Tag chips** — existing tags shown as chips at the bottom; click × to remove a tag, click + to open `TagSuggest` (frequency-sorted suggestions with prefix/contains/fuzzy matching).

- **批量模式** — 工具栏"批量"开关启用后，每张卡片左侧出现复选框；顶部出现批量操作栏（删除选中 / 给选中打标签 / 取消）。

  **Batch mode** — toggle "Batch" in the toolbar; each card shows a checkbox on the left; a batch action bar appears at the top (delete selected / tag selected / cancel).

### 复习模式 / Review Mode

- **洗牌复习** — 取当前筛选下未归档的标注，Fisher-Yates 洗牌后全屏 overlay 逐张过卡。每次复习数量上限可在设置中配置（默认 50，0=不限）。洗牌顺序不持久化。

  **Shuffled review** — takes non-archived annotations under the current filter, Fisher-Yates shuffles, and walks through them in a full-screen overlay. Per-session size limit is configurable (default 50, 0 = unlimited). Shuffle order is not persisted.

- **复习操作** — 「再来一次」(`reviewCount++`, `lastReviewedAt=now`) / 「已掌握」(`archived=true`) / 上一张/下一张。Esc 退出。键盘快捷键：←/→ 切换，1=再来一次，2=已掌握。

  **Review actions** — "Again" (`reviewCount++`, `lastReviewedAt=now`) / "Mastered" (`archived=true`) / Previous/Next. Esc to exit. Shortcuts: ←/→ to navigate, 1 = Again, 2 = Mastered.

- **持久化** — `reviewCount`、`archived`、`lastReviewedAt` 通过 `AnnotationFileManager.updateAnnotation` 持久化到标注文件，重开插件状态保留。

  **Persistence** — `reviewCount`, `archived`, `lastReviewedAt` are persisted to annotation files via `AnnotationFileManager.updateAnnotation`, surviving reloads.

### 命令 / Commands

- `打开卡片侧边栏` — 打开（聚焦）卡片侧边栏，不切换关闭。
- `开始复习` — 以当前筛选条件启动复习模式。
- `切换标注视图` / `导入旧标注插件数据` / `导出当前笔记标注` — 沿用 annotation-marker。

  `Open card sidebar` / `Start review` (new) — and the inherited `Toggle annotation view` / `Import legacy annotation data` / `Export current note annotations` from annotation-marker.

### 设置 / Settings

新增"卡片化管理"分组：
- 卡片侧边栏默认范围（当前文件 / 全库）
- 复习每次洗牌数量上限（0=不限）
- 显示卡片侧边栏 ribbon 图标
- 卡片侧边栏默认显示已归档

New "Card Management" group in settings: default scope, review batch size limit, show ribbon icon, show archived by default.

## License / 许可证

MIT
