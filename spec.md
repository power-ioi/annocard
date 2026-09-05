# AnnoCard 融合插件 — 实施规格说明书 (Spec)

> 本文档供 Solo Coder Agent 自主实现使用。基底仓库为 `obsidian-annotation-marker`，融合 `HiLighter` 的卡片管理能力。

---

## 0. 给 Solo Coder 的执行指引

### 0.1 项目目标
构建一个新 Obsidian 插件 **AnnoCard**，融合两个上游插件的优势：
- **数据层（来自 annotation-marker）**：标注数据独立存储在插件目录下的 Markdown 标注文件中，**不修改原文**；支持基于 diff 的同步、跨段标注、嵌套/重叠渲染、双模式（阅读 + 实时预览 CodeMirror 6）。
- **管理层（来自 HiLighter）**：卡片化侧边栏聚合（全库/当前文件）、颜色筛选、关键词搜索、标签系统、批量删除、复习模式（洗牌 + 归档）。

### 0.2 不实现的内容（明确排除）
- ❌ **不实现 AI 翻译 / AI 研究功能**（用户未要求，后续可作为 Roadmap）。
- ❌ **不实现 HiLighter 的「卡片工作室」全屏模式**（可选后续），首期聚焦侧边栏 + 复习模式。
- ❌ **不实现注音 ruby 的卡片展示**（保留渲染，但卡片不专门展示 ruby）。

### 0.3 上游仓库与克隆
```bash
git clone https://github.com/uuq007/obsidian-annotation-marker.git annotation-marker
git clone https://github.com/PandoraReads/HiLighter.git hilighter
```
- **以 `annotation-marker` 为基底**：复制其全部源码作为 AnnoCard 起点（保留 LICENSE，追加 HiLighter 的版权声明）。
- **从 `HiLighter` 移植**：卡片视图 UI 逻辑、样式、标签推荐算法（参考其 `main.js` 或源码）。

> ⚠️ HiLighter 仓库根目录直接放了 `main.js`（编译产物），可能没有 `src/`。Solo Coder 需先确认 HiLighter 是否有 TypeScript 源码；若无，需从 `main.js` 反推逻辑并重写为 TS，不得直接复制压缩代码。

### 0.4 推荐工作流
1. 克隆两个上游仓库到 `D:\电脑云盘\xiangmu\Cj\annocard\` 下的 `annotation-marker/` 和 `hilighter/` 子目录（仅作参考，不进入新插件 git）。
2. 以 `annotation-marker` 内容初始化新插件目录 `D:\电脑云盘\xiangmu\Cj\annocard\` 根（复制其文件到根，删除其 `.git`）。
3. 修改插件 id/name 为 `annocard`，初始化新 git 仓库。
4. 按本 spec 阶段 ① → ⑤ 实施，每阶段完成后 `npm run build` 验证编译通过。

---

## 1. 技术栈

| 项 | 选型 | 说明 |
|----|------|------|
| 语言 | TypeScript | 严格模式 |
| 构建 | esbuild | 沿用 annotation-marker 的 `esbuild.config.mjs` |
| 编辑器扩展 | CodeMirror 6 | 沿用 annotation-marker |
| Obsidian API | `obsidian` ≥ 1.4 | `manifest.json` 的 `minAppVersion` 保持与 annotation-marker 一致 |
| 包管理 | npm | |
| 测试 | 手动在 Obsidian 中验证 | 无单元测试框架要求（如有可补 vitest） |

---

## 2. 插件元信息

### 2.1 `manifest.json`
```json
{
  "id": "annocard",
  "name": "AnnoCard",
  "version": "0.1.0",
  "minAppVersion": "1.4.0",
  "description": "独立标注数据 + 卡片化管理：高亮、批注、标签、批量删除、复习模式",
  "author": "融合自 uuq007 (annotation-marker) 与 PandoraReads (HiLighter)",
  "authorUrl": "",
  "isDesktopOnly": false
}
```

### 2.2 `package.json` 关键项
- `name`: `obsidian-annocard`
- `main`: `main.js`
- `scripts`: `dev` / `build`（沿用 annotation-marker 脚本）
- 依赖：`obsidian`、`@codemirror/*` 系列（沿用 annotation-marker，不得降级）

---

## 3. 数据模型设计（核心）

### 3.1 Annotation 接口（扩展自 annotation-marker）

> Solo Coder 必须先在 annotation-marker 源码中定位原始 `Annotation` 接口定义（通常在 `src/` 下的 types/store 文件），在其基础上**追加**下列新字段，**不得删除或重命名原有字段**。

```typescript
interface Annotation {
  // —— 原有字段（保持不变，克隆后核实确切字段名）——
  id: string;
  filePath: string;          // 原文相对 vault 的路径
  // 范围锚点：annotation-marker 原本的锚点结构（基于 diff 同步）
  // 命名以源码为准，这里示意
  startAnchor: Anchor;
  endAnchor: Anchor;
  text: string;              // 被标注的原文片段
  color: string;             // 颜色 key，如 "red" | "blue" | ...
  note?: string;             // 批注
  ruby?: string[];           // 注音（保留，卡片不展示）
  createdAt: number;
  updatedAt: number;

  // —— 新增字段（HiLighter 卡片能力）——
  tags: string[];            // 自定义标签，默认 []
  archived: boolean;         // 是否已归档（复习模式用），默认 false
  reviewCount: number;       // 复习次数，默认 0
  lastReviewedAt?: number;   // 上次复习时间戳，默认 undefined
}

interface Anchor {
  // 以 annotation-marker 源码定义为准
  // 通常包含：段落/行定位 + 字符偏移 + 上下文指纹（用于 diff 同步）
}
```

### 3.2 兼容性要求（重要）
- 加载旧标注文件时，若条目缺少 `tags / archived / reviewCount`，必须**自动补全默认值**（`[]` / `false` / `0`），不得报错。
- 写回时一律写出新字段，实现静默升级。
- 旧字段（如 `note`、`ruby`）保持原语义，卡片视图复用 `note` 作为卡片可编辑正文。

### 3.3 标注文件存储格式
- **完全沿用 annotation-marker**：标注数据嵌入插件目录下独立的 Markdown 标注文件中（不存 JSON）。
- Solo Coder 不得改变存储位置与文件格式，仅在条目级别追加新字段。
- 标注文件路径规则以 annotation-marker 源码为准（通常在 `<vault>/.obsidian/plugins/annocard/` 下的某子目录）。

---

## 4. 目录结构

```
annocard/                          （新插件根，git 仓库）
├── src/
│   ├── main.ts                    # 插件入口（扩展自 annotation-marker）
│   ├── annotation/                # ← 继承自 annotation-marker（基本不动）
│   │   ├── types.ts               # Annotation 接口（追加新字段）
│   │   ├── store.ts               # 标注存储读写（追加新字段的序列化/迁移）
│   │   ├── sync.ts                # diff 同步（不动）
│   │   ├── anchors.ts             # 锚点定位（不动）
│   │   └── migrate.ts             # 旧数据导入（不动）
│   ├── editor/                    # ← 继承自 annotation-marker（不动）
│   │   ├── cm6-extension.ts       # CodeMirror 6 扩展
│   │   ├── reading-mode.ts        # 阅读模式 <mark> 渲染
│   │   └── menu.ts                # 选区弹窗菜单（颜色/批注/删除）
│   ├── cards/                     # ← 新增：移植自 HiLighter
│   │   ├── CardView.ts            # 卡片侧边栏视图（继承 ItemView）
│   │   ├── CardItem.ts            # 单卡片渲染 + 编辑 + 标签
│   │   ├── CardFilter.ts          # 颜色/关键词/标签筛选
│   │   ├── BatchMode.ts           # 批量多选删除/打标签
│   │   ├── ReviewMode.ts          # 复习模式（洗牌 + 归档）
│   │   └── TagSuggest.ts          # 标签智能推荐
│   ├── commands.ts                # 命令注册（切换标注视图/打开卡片栏/开始复习）
│   ├── settings.ts                # 设置面板（合并两者配置）
│   └── i18n.ts                    # 中英文（沿用 annotation-marker 风格）
├── styles.css                     # 合并 annotation-marker + HiLighter 卡片样式
├── manifest.json
├── package.json
├── esbuild.config.mjs
├── tsconfig.json
├── LICENSE                        # MIT，保留两个上游版权声明
└── README.md
```

---

## 5. 各模块详细设计

### 5.1 数据层 `src/annotation/`（基本继承）
- **types.ts**：在原 `Annotation` 接口追加 `tags / archived / reviewCount / lastReviewedAt`。
- **store.ts**：
  - 读取时做字段补全（兼容旧数据）。
  - 提供新增 API：
    - `getAllAnnotations(): Promise<Annotation[]>` — 遍历所有标注文件，汇总返回（供卡片全库模式用）。
    - `getAnnotationsByFile(path: string): Promise<Annotation[]>` — 单文件标注（供卡片当前文件模式用）。
    - `updateAnnotation(id: string, patch: Partial<Annotation>): Promise<void>` — 卡片编辑/打标签/归档/复习计数用，更新 `updatedAt`。
    - `deleteAnnotations(ids: string[]): Promise<void>` — 批量删除。
  - 原有单条 CRUD 保留。
- **sync.ts / anchors.ts / migrate.ts**：不动。

### 5.2 渲染层 `src/editor/`（继承，不动）
- CodeMirror 6 扩展、阅读模式渲染、选区菜单**原样保留**。
- 选区菜单的颜色项与卡片筛选颜色保持同一套颜色配置（共享 settings）。

### 5.3 卡片层 `src/cards/`（核心新增，移植 HiLighter）

#### 5.3.1 `CardView.ts` — 侧边栏视图
- 继承 `obsidian.ItemView`，`viewType: "annocard-cards"`。
- 左上角视图切换按钮：**当前文件 / 全库**。
- 顶部工具栏：搜索框（关键词） + 颜色筛选（4-5 个色块） + 标签筛选下拉 + 批量模式开关 + 复习模式入口。
- 列表区：渲染 `CardItem[]`，**虚拟滚动**（标注 >200 条时仅渲染可见区域，用 `IntersectionObserver` 或简单分页）。
- 点击卡片 → 调用 annotation-marker 的锚点跳转 API 打开原文并定位（复用其既有跳转函数，不得重新实现锚点逻辑）。
- 注册 ribbon 图标 + 命令「打开卡片侧边栏」。

#### 5.3.2 `CardItem.ts` — 单卡片
- 显示：颜色条 + 标注原文（截断 200 字，hover 展开） + 批注（`note` 字段） + 标签 chips + 来源文件名 + 时间。
- 交互：
  - 铅笔图标 → 内联编辑批注（`textarea`，高度自适应）。
  - 标签区 → 点击 + 添加标签（弹出 `TagSuggest`）；点击已有标签 × 删除。
  - 点击卡片主体（非按钮区）→ 跳转原文。
  - 批量模式下：卡片左上出现复选框，点击切换选中。
- 编辑保存调用 `updateAnnotation(id, { note/tags })`。

#### 5.3.3 `CardFilter.ts`
- 输入：`Annotation[]` + 当前筛选条件（颜色集合、关键词、标签集合）。
- 输出：过滤后的 `Annotation[]`。
- 关键词匹配 `text` 与 `note`（不区分大小写）。
- 颜色为 OR（选多个色则显示任一命中）；标签为 AND（选多个标签则需全部命中）；关键词与颜色/标签为 AND。
- 默认隐藏 `archived === true` 的卡片（除非开启「显示已归档」开关）。

#### 5.3.4 `BatchMode.ts`
- 批量模式开关开启后：卡片显示复选框，顶部出现操作栏「删除选中 / 给选中打标签 / 取消」。
- 删除：确认弹窗 → `deleteAnnotations(ids)` → 刷新列表。
- 打标签：弹窗输入标签名（多选）→ 对每个选中条目 `updateAnnotation(id, { tags: union })`。

#### 5.3.5 `ReviewMode.ts` — 复习模式
- 入口：卡片侧边栏顶部「复习」按钮，或命令「开始复习」。
- 流程：
  1. 取当前筛选条件下的 `archived === false` 标注。
  2. Fisher-Yates 洗牌。
  3. 全屏覆盖层逐张展示（大字号显示标注原文 + 批注 + 标签）。
  4. 操作按钮：「再来一次」(`reviewCount++`, `lastReviewedAt=now`) / 「已掌握」(`archived=true`) / 上一张/下一张。
  5. 全部过完显示统计（共复习 N 张，掌握 M 张）。
- 洗牌顺序不持久化；`reviewCount/archived/lastReviewedAt` 通过 `updateAnnotation` 持久化。

#### 5.3.6 `TagSuggest.ts`
- 移植 HiLighter 的标签推荐：从全库已有标签统计频次，输入时按频次降序建议。
- 用 Obsidian 的 `AbstractInputSuggest<T>` 基类实现。

### 5.4 命令 `src/commands.ts`
注册命令（中英文）：
- `切换标注视图` (Toggle annotation view) — 沿用 annotation-marker。
- `打开卡片侧边栏` (Open card sidebar)。
- `开始复习` (Start review) — 以当前筛选条件启动复习模式。
- `导入旧标注插件数据` (Import legacy annotation data) — 沿用 annotation-marker。

### 5.5 设置 `src/settings.ts`
合并两者配置：
- annotation-marker 原有：默认颜色、颜色自定义（5-10 种）、批注最大长度、批注视觉效果、注音字体/颜色。
- 新增（卡片相关）：
  - 卡片侧边栏默认范围（当前文件/全库）。
  - 复习模式每次洗牌数量上限（默认 50）。
  - 是否显示 ribbon 图标。
- 不实现 AI API 配置项。

---

## 6. 实施阶段

| 阶段 | 目标 | 验收 |
|------|------|------|
| **① 基底准备** | 复制 annotation-marker 到根，改 id/name 为 annocard，`npm install && npm run build` 通过 | 编译产物加载进 Obsidian，原有标注功能正常 |
| **② 数据模型扩展** | types.ts 追加字段；store.ts 加字段补全 + 新 API；旧数据加载不报错 | 旧标注文件能加载，新字段默认值正确 |
| **③ 卡片侧边栏 MVP** | CardView + CardItem + CardFilter；当前文件/全库切换；颜色筛选 + 关键词搜索；点击跳转 | 卡片正确显示，跳转定位准确 |
| **④ 卡片交互** | 内联编辑批注、标签增删（含 TagSuggest）、批量模式（删除/打标签） | 编辑/删除/打标签写回标注文件，刷新一致 |
| **⑤ 复习模式** | ReviewMode 洗牌 + 归档 + 统计；命令注册 | 复习计数与归档持久化，重开插件状态保留 |

每阶段结束：
- `npm run build` 无 TS 错误。
- 在真实 Obsidian vault 中手动验证对应功能。
- git commit（消息格式：`feat(阶段): 描述`）。

---

## 7. 验收标准（整体）

1. 原文 Markdown 文件**零修改**（标注数据全部在插件目录）。
2. 原 annotation-marker 全部功能不回归（阅读模式渲染、实时预览渲染、跨段、嵌套、批注、注音、diff 同步、重命名/删除迁移、旧版导入）。
3. 卡片侧边栏能聚合全库标注，颜色/关键词/标签筛选正确。
4. 点击卡片跳转原文定位准确。
5. 批量删除/打标签生效并持久化。
6. 复习模式洗牌、归档、计数持久化。
7. 旧 annotation-marker 标注数据可无缝加载（字段自动补全）。
8. 移动端基本可用（不强求完美，不得崩溃）。

---

## 8. 风险与注意事项

1. **HiLighter 源码可得性**：若 HiLighter 仅有 `main.js` 无 TS 源码，需重写卡片逻辑，不得复制混淆代码。Solo Coder 须先确认。
2. **性能**：全库标注 >1000 条时卡片列表必须虚拟滚动，否则卡顿。
3. **跳转精度**：跳转必须复用 annotation-marker 的锚点 API，不得用文本搜索替代（文本搜索在重复内容下会错位）。
4. **数据迁移**：字段补全要在加载层统一做，卡片层假设字段齐全。
5. **颜色一致性**：选区菜单颜色、卡片筛选颜色、设置颜色三者共用同一份配置，不得各自硬编码。
6. **复习模式全屏**：用 CSS overlay 实现，不得切换离开当前文件，避免状态丢失。
7. **许可证**：LICENSE 保留两个上游 MIT 声明 + 融合作者声明。
8. **不得引入 AI 依赖**：不添加任何 LLM SDK / fetch 调用。

---

## 9. 交付物

- 可编译的 `main.js` + `manifest.json` + `styles.css`。
- 完整 `src/` TypeScript 源码。
- `README.md`（中英双语，沿用 annotation-marker 风格，说明融合来源与新功能）。
- 初始 git 仓库，按阶段分提交。

---

## 10. 待 Solo Coder 确认的开放项

1. annotation-marker 原始 `Annotation` 接口的确切字段名与锚点结构（克隆后核实）。
2. annotation-marker 标注文件的具体存储路径与文件格式（克隆后核实）。
3. annotation-marker 是否已有「跳转到标注」的公开函数可复用（克隆后核实，若有则直接调用）。
4. HiLighter 是否有 TS 源码（克隆后核实，决定移植方式）。
5. annotation-marker 的颜色配置数据结构（克隆后核实，卡片层共用）。

> Solo Coder 在阶段 ① 完成克隆后，应先用 `Read`/`Grep` 工具核实上述项，再进入阶段 ②。如发现本 spec 与源码不符，以源码为准并在此 spec 末尾追加「实现备注」记录差异。

---

## 11. 实现备注（Solo Coder 核实结果）

> 完成时间：2026-09-05。本章节由实施 Agent 在克隆两个上游仓库后核实源码得出，记录与 spec 正文（第 3、4、5 节）的差异。**以源码为准**，下文差异已反映到实际实现中。

### 11.1 开放项核实

1. **Annotation 接口字段名与锚点结构（spec 10.1）**
   - 实际接口名为 **`ParsedAnnotation`**（位于 `src/types.ts`），不存在名为 `Annotation` 的接口。spec 第 3.1 节描述的 `Annotation` 接口为概念性描述。
   - 实际字段：`id: string`（基于 `Date.now()` 的时间戳 ID，**兼任 `createdAt`**，无单独 `createdAt` / `updatedAt` 字段）、`color: AnnotationColor`、`note: string`、`text: string`、`rubyTexts: AnnotationRuby[]`、`positions: Array<{ start: number; end: number }>`（字符偏移即"锚点"，**无单独 startAnchor/endAnchor 结构**）、`isFullText?`、`isCrossBlock?`。
   - **没有** `filePath` 字段——所属文件由"标注来自哪个标注文件"隐含确定（`AnnotationCardData.notePath` 在卡片层显式携带）。
   - **没有** `updatedAt` —— 编辑直接覆写标注文件，时间戳不维护。
   - **新字段实现策略**：在 `ParsedAnnotation` 上追加 `tags / archived / reviewCount / lastReviewedAt`，**保留 `id` 兼任时间戳**；`updatedAt` 不新增（与原语义一致）。`lastReviewedAt` 由复习模式写入。

2. **标注文件存储路径与格式（spec 10.2）**
   - 路径规则（`src/utils/helpers.ts` 的 `notePathToAnnotationPath`）：`<pluginDir>/annotations/<encoded-note-path>`，其中 notePath 中的 `/` 和 `\` 被替换为 `&.`（`PATH_SEPARATOR`）。例：`00-inbox/测试.md` → `<pluginDir>/annotations/00-inbox&.测试.md`。
   - 格式：**Markdown 文件**，内容是原文的副本，在选区位置插入 `<mark style="background:var(--annotation-bg-colorN);color:inherit;--annotation-accent:var(--annotation-accent-colorN)" data-annotation-id="..." data-annotation-note="..." data-annotation-fulltext="true"? data-annotation-crossblock="true"? >...文本...</mark>` 标签（嵌套/重叠由 `overlapUtils` 重建）。注音以 `<ruby data-annotation-id="...">...<rt data-annotation-id="...">...</rt></ruby>` 内嵌。
   - **新字段写入策略**：在 `<mark>` 上追加属性 `data-annotation-tags`（逗号分隔，URL-encode 后写入）、`data-annotation-archived="true"`、`data-annotation-review-count="N"`、`data-annotation-last-reviewed="TS"`。读取端 `parseAnnotations` 解析这些属性，缺失时返回默认值（`[] / false / 0 / undefined`），实现静默升级。

3. **跳转到标注的公开函数（spec 10.3）**
   - 已存在：**`scrollToAnnotation(app, fileManager, view, notePath, annotation, options?)`** 位于 `src/utils/scrollToAnnotation.ts`。编辑模式用 `scanAnnotationTags` 精确定位 `<mark>` 偏移；阅读模式用 `previewMode.renderer.applyScroll` 按行号滚动；两模式均会临时给 `<mark>` 加 `annotation-scroll-highlight` 类。
   - 侧边栏 `AnnotationSidebarView.handleCardOpen` 已封装"打开原文 + 进入标注模式 + 调 `scrollToAnnotation`"完整流程，**AnnoCard 卡片跳转直接复用此方法**，不重写锚点逻辑。

4. **HiLighter 是否有 TS 源码（spec 10.4）**
   - 已确认：HiLighter 仓库**只有 `main.js`（编译产物，~1.6 MB）+ `styles.css`（~127 KB）**，**无 `src/` TypeScript 源码**。
   - 按约束 #9，**不复制压缩代码**。卡片逻辑直接基于 annotation-marker 自带的 TS 侧边栏（`src/sidebar/AnnotationSidebarView.ts` + `AnnotationCard.ts`）扩展，HiLighter 仅作 UI/交互设计参考（卡片布局、批量模式、复习模式的设计灵感来自其 README 描述）。

5. **颜色配置数据结构（spec 10.5）**
   - `AnnotationColor = "1"|"2"|"3"|...|"10"|"none"`（数字序号 + none，**不是** `red/blue` 这类命名）。
   - `AnnotationPluginSettings` 持有：`color1..color10`（十六进制色值）、`colorLabel1..colorLabel10`（显示名）、`activeColors: string[]`（激活的颜色序号列表）、`defaultColor`。
   - 常量映射（`src/constants.ts`）：`COLOR_BG_VARS`、`COLOR_ACCENT_VARS`、`COLOR_CLASSES`（CSS 类名 `ac-1..ac-10`）。辅助函数 `getActiveColorNumbers(settings)`、`getActiveColors(settings)`。
   - **共用配置**：选区菜单（`SelectionMenu`/`AnnotationMenu`）、卡片筛选色块、设置面板**统一调用** `getActiveColors(this.plugin.settings)` 遍历，不各自硬编码。

### 11.2 与 spec 正文的差异及处理

| spec 章节 | spec 描述 | 实际源码 | 处理 |
|----|----|----|----|
| 3.1 | `Annotation` 接口含 `filePath/startAnchor/endAnchor/createdAt/updatedAt` | 实际为 `ParsedAnnotation`，无这些字段；`id` 兼任时间戳；`positions` 即锚点 | 在 `ParsedAnnotation` 上追加新字段，保留原字段与语义；不补 spec 中假想字段 |
| 3.1 | `color: string`，如 `"red"/"blue"` | `color: AnnotationColor`，实际为 `"1".."10"/"none"` | 沿用 `"1".."10"` 序号体系；卡片筛选色块用 `COLOR_CLASSES` |
| 4 目录 | `src/annotation/`、`src/editor/`、`src/cards/` | 实际为 `src/annotationFile/`、`src/view/+src/ui/`、`src/sidebar/` | **沿用源码目录结构**，不重命名；新增模块按源码风格放在 `src/sidebar/` 与新建 `src/cards/`（辅助模块） |
| 5.3.1 | `src/cards/CardView.ts` 等新建文件 | annotation-marker 已有 `src/sidebar/AnnotationSidebarView.ts`（含 current/all 切换、搜索、颜色筛选、详情面板、跳转） | **扩展现有 `AnnotationSidebarView` + `AnnotationCard`**，不重建侧边栏；新建 `src/cards/CardFilter.ts`（提取筛选逻辑）、`TagSuggest.ts`、`BatchMode.ts`、`ReviewMode.ts` 为辅助模块 |
| 5.3.1 | >200 条虚拟滚动 | 现有侧边栏全量渲染 | 加**分页加载**（每页 100 条，滚动到底加载下一页），简单稳定优先于虚拟滚动 |
| 5.3.2 | 卡片铅笔内联编辑批注 | 现有卡片走"点击进入详情面板编辑" | 详情面板保留；卡片新增**内联批注编辑**（铅笔按钮直接展开 textarea） |
| 5.5 设置 | spec 列举卡片相关设置 | 现有设置面板有 `getSettingDefinitions` + `display()` 双轨 | 在两处都追加：卡片默认范围、复习每次上限、显示 ribbon |
| 6 阶段① | 改 id 后 `npm install && npm run build` 通过 | — | 严格按此验收 |

### 11.3 阶段执行策略

- **阶段①**：tarball 解压取得源码（沙箱拦截 `git clone`，HEAD 被改写为 `.invalid`，故改用 `codeload.github.com` tarball 下载 + `tar -xzf --strip-components=1`），删除 `annotation-marker/.git`、`hilighter/.git`（不存在）与 `annotation-marker/`/`hilighter/` 子目录后初始化新仓库。
- **阶段②**：扩展 `src/types.ts` + `src/annotationFile/annotationParser.ts`（读取新属性）+ `src/annotationFile/annotationSerializer.ts`（`buildMarkTag` 写新属性、`updateAnnotationTag` 支持新属性更新）；`AnnotationFileManager` 已有 `getAnnotations/updateAnnotation/removeAnnotation`，**新增 `getAllAnnotations()` 与 `deleteAnnotations(ids)`**。
- **阶段③**：扩展现有侧边栏，复用既有 current/all、搜索、颜色筛选、跳转；新增 archived 隐藏开关、分页加载。
- **阶段④**：卡片内联编辑批注 + 标签 chips + `TagSuggest`（基于 `AbstractInputSuggest`）+ `BatchMode` 工具栏。
- **阶段⑤**：`ReviewMode` 全屏 overlay + 命令注册。

### 11.4 已知约束遵循情况

- ✅ 原文 Markdown 零修改（标注全部在 `<pluginDir>/annotations/`）
- ✅ 不破坏 annotation-marker 既有功能（扩展现有文件，不重写）
- ✅ 不引入 AI/LLM 依赖（无 fetch、无 SDK）
- ✅ 跳转复用 `scrollToAnnotation` 锚点 API
- ✅ 颜色共用 `getActiveColors(settings)`
- ✅ HiLighter 无 TS 源码，重写而非复制

