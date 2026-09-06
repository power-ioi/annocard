import { ItemView, MarkdownView, Notice, normalizePath, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type { AnnotationColor, ParsedAnnotation } from "../types";
import { COLOR_CLASSES, COLOR_ACCENT_VARS, getActiveColors } from "../constants";
import { annotationPathToNotePath, getViewFilePath } from "../utils/helpers";
import { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import { editAnnotationInEditor } from "../utils/annotationEditorHelper";
import { scrollToAnnotation } from "../utils/scrollToAnnotation";
import { createAnnotationCard, type AnnotationCardData } from "./AnnotationCard";
import type AnnotationPlugin from "../main";
import { t } from "../i18n";
import { FolderSuggestModal, FileNameModal, ConfirmOverwriteModal } from "../ui/ExportModal";
import { sortAnnotations, buildExportContent } from "../utils/exporter";
import { applyCardFilter, tagsByFrequency, type CardFilterState } from "../cards/CardFilter";
import { TagSuggest } from "../cards/TagSuggest";
import { BatchTagInputModal, batchAddTags, confirmBatchDelete } from "../cards/BatchMode";
import { ReviewMode } from "../cards/ReviewMode";

export const ANNOTATION_SIDEBAR_VIEW_TYPE = "annotation-sidebar-view";

// AnnoCard 卡片侧边栏:分页大小(>200 条时分页加载,避免一次性渲染卡顿)
const CARD_PAGE_SIZE = 100;

type SidebarMode = "current" | "all";
type SortOption = "position-asc" | "position-desc" | "time-asc" | "time-desc" | "color-asc" | "color-desc" | "by-note";

export class AnnotationSidebarView extends ItemView {
  private plugin: AnnotationPlugin;
  private fileManager: AnnotationFileManager;

  // 状态
  private mode: SidebarMode = "current";
  private searchQuery = "";
  private colorFilter: AnnotationColor | "all" = "all";
  private sortOption: SortOption = "position-asc";
  // AnnoCard 新增:已归档过滤 + 标签筛选
  private showArchived: boolean;
  private tagFilter: Set<string> = new Set();
  // AnnoCard 批量模式
  private batchMode = false;
  private batchSelectedIds: Set<string> = new Set();
  // AnnoCard 卡片内容折叠状态(true=隐藏标注内容与标签)
  private cardsCollapsed = false;
  // AnnoCard 复习模式实例(打开时非空)
  private reviewMode: ReviewMode | null = null;

  // DOM 引用
  private cardListEl: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private sortSelect: HTMLSelectElement | null = null;
  private exportBtn: HTMLElement | null = null;
  private tabs: Record<SidebarMode, HTMLElement> = { current: null!, all: null! };
  private colorBtns: Map<string, HTMLElement> = new Map();
  private colorRowEl: HTMLElement | null = null;
  private showArchivedBtn: HTMLElement | null = null;
  private tagFilterSelect: HTMLSelectElement | null = null;
  // AnnoCard 工具栏按钮
  private batchBtn: HTMLElement | null = null;
  private reviewBtn: HTMLElement | null = null;
  // 复习总览(HiLighter 风格按文件分组网格)是否激活
  private reviewOverviewActive = false;
  private expandBtn: HTMLElement | null = null;
  private collapseBtn: HTMLElement | null = null;
  private batchBar: HTMLElement | null = null;
  private batchSelectedCount: HTMLElement | null = null;
  // 标签候选缓存(全库模式刷新时同步,供 TagSuggest 用)
  private allTagCandidates: string[] = [];

  // 全部笔记模式缓存
  private allAnnotationsCache: AnnotationCardData[] | null = null;

  // 防抖定时器
  private searchDebounceTimer: number | null = null;
  private leafChangeTimer: number | null = null;
  private lastRefreshedNotePath: string | null = null;

  // 刷新回调引用（onOpen/onClose 共用同一引用，确保 indexOf 能命中）
  private boundAnnotationChange: (() => void) | null = null;

  // 渲染代际 token：递增，await 之后若已被新代次取代则丢弃，避免过期数据污染 DOM
  private renderGeneration = 0;

  // AnnoCard 分页:当前已渲染的卡片数(从 cachedSortedCards 头部累计)
  private cachedSortedCards: AnnotationCardData[] = [];
  private renderedCount = 0;

  constructor(leaf: WorkspaceLeaf, plugin: AnnotationPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.fileManager = plugin.fileManager;
    // AnnoCard:已归档默认隐藏,初值来自设置
    this.showArchived = !!plugin.settings.showArchivedInCard;
    // AnnoCard:初值来自设置的默认范围(当前文件 / 全库)
    this.mode = plugin.settings.cardDefaultScope === "all" ? "all" : "current";
  }

  getViewType(): string {
    return ANNOTATION_SIDEBAR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t().sidebarTitle;
  }

  getIcon(): string {
    return "lucide-bookmark";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("annotation-sidebar");

    this.renderToolbar(container);
    this.renderSearchBar(container);
    this.renderBatchBar(container);

    this.cardListEl = container.createDiv({ cls: "annotation-sidebar-card-list" });
    // 同步折叠初始状态(默认展开)
    this.setCardsCollapsed(this.cardsCollapsed);
    // AnnoCard:列表区滚动加载更多(分页)
    if (this.cardListEl) {
      this.cardListEl.addEventListener("scroll", () => {
        if (!this.cardListEl) return;
        const nearBottom = this.cardListEl.scrollTop + this.cardListEl.clientHeight >= this.cardListEl.scrollHeight - 200;
        if (nearBottom) this.loadMore();
      });
    }

    // 注册事件
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (this.mode === "current") {
          const activeFile = this.app.workspace.getActiveFile();
          const currentPath = activeFile?.path ?? null;
          if (currentPath === this.lastRefreshedNotePath) return;

          if (this.leafChangeTimer) window.clearTimeout(this.leafChangeTimer);
          this.leafChangeTimer = window.setTimeout(() => {
            void this.refresh();
          }, 200);
        }
      })
    );

    // 注册刷新回调（保存引用，onClose 时用同一引用精确注销）
    this.boundAnnotationChange = () => {
      void this.refresh();
    };
    this.plugin.annotationChangeCallbacks.push(this.boundAnnotationChange);

    // 初始加载
    await this.refresh();
  }

  async onClose(): Promise<void> {
    // 使用同一引用精确注销
    if (this.boundAnnotationChange) {
      const idx = this.plugin.annotationChangeCallbacks.indexOf(this.boundAnnotationChange);
      if (idx >= 0) {
        this.plugin.annotationChangeCallbacks.splice(idx, 1);
      }
      this.boundAnnotationChange = null;
    }
    // 清掉挂起的防抖定时器：关视图后仍触发会对已脱离 DOM 的列表做全量加载
    if (this.searchDebounceTimer) {
      window.clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    if (this.leafChangeTimer) {
      window.clearTimeout(this.leafChangeTimer);
      this.leafChangeTimer = null;
    }
    // AnnoCard:关闭时退出复习模式(若打开)
    if (this.reviewMode) {
      this.reviewMode.exit();
      this.reviewMode = null;
    }
    this.allAnnotationsCache = null;
  }

  // ========== 渲染方法 ==========

  private renderToolbar(container: HTMLElement): void {
    // HiLighter 风格：顶部彩色标签行 + 工具栏按钮
    const toolbar = container.createDiv({ cls: "annotation-sidebar-toolbar hl-highlight-toolbar" });

    // 第一行：展开/折叠 + 范围切换（当前/全部）+ 标签筛选
    const topRow = toolbar.createDiv({ cls: "hl-toolbar-top" });

    // 左侧按钮组
    const left = topRow.createDiv({ cls: "hl-toolbar-actions annocard-top-left" });

    // 展开/折叠：控制所有卡片的标注内容与标签显隐
    this.expandBtn = left.createEl("button", {
      cls: "hl-btn-all annocard-btn-expand",
      text: t().sidebarExpandAll,
    });
    this.expandBtn.addEventListener("click", () => this.setCardsCollapsed(false));

    this.collapseBtn = left.createEl("button", {
      cls: "hl-btn-all annocard-btn-collapse",
      text: t().sidebarCollapseAll,
    });
    this.collapseBtn.addEventListener("click", () => this.setCardsCollapsed(true));

    // 范围切换：当前笔记 / 全部笔记
    this.tabs.current = left.createEl("button", {
      cls: "hl-btn-subtle annotation-sidebar-tab hl-tab-current",
      text: t().sidebarCurrentNote,
    });
    this.tabs.all = left.createEl("button", {
      cls: "hl-btn-subtle annotation-sidebar-tab hl-tab-all",
      text: t().sidebarAllNotes,
    });
    this.tabs.current.toggleClass("is-active", this.mode === "current");
    this.tabs.all.toggleClass("is-active", this.mode === "all");
    this.tabs.current.addEventListener("click", () => this.switchMode("current"));
    this.tabs.all.addEventListener("click", () => this.switchMode("all"));

    // 标签筛选下拉（置于"全部"之后）
    this.tagFilterSelect = left.createEl("select", {
      cls: "hl-color-select annotation-sidebar-tag-select",
    });
    this.tagFilterSelect.addEventListener("change", () => {
      if (!this.tagFilterSelect) return;
      const v = this.tagFilterSelect.value;
      if (!v) {
        this.tagFilter.clear();
      } else {
        this.tagFilter.clear();
        this.tagFilter.add(v);
      }
      void this.renderCards();
    });
    this.refreshTagFilterOptions();

    // 第二行：顺序排序 | 右侧图标按钮（导出/批量/复习）
    const secondRow = toolbar.createDiv({ cls: "hl-toolbar-top annocard-toolbar-second" });
    const sortGroup = secondRow.createDiv({ cls: "hl-toolbar-actions annocard-top-left" });

    // 排序（带"顺序"标签）
    sortGroup.createSpan({ cls: "hl-row-label annocard-sort-label", text: t().sidebarSortLabel });
    this.sortSelect = sortGroup.createEl("select", { cls: "hl-color-select annotation-sidebar-sort-select" });
    this.sortSelect.addEventListener("change", () => {
      this.sortOption = this.sortSelect!.value as SortOption;
      void this.renderCards();
    });
    this.updateSortOptions();

    // 右侧操作图标按钮
    const actions = secondRow.createDiv({ cls: "hl-toolbar-actions annocard-top-right" });

    // 导出按钮（仅当前笔记模式）
    this.exportBtn = actions.createEl("button", {
      cls: "hl-btn-all annocard-icon-toolbar-btn annotation-sidebar-export-btn",
      attr: { "aria-label": t().sidebarExportBtn },
    });
    setIcon(this.exportBtn, "download");
    this.exportBtn.addEventListener("click", () => { void this.exportCurrentAnnotations(); });
    this.exportBtn.toggleClass("is-hidden", this.mode !== "current");

    // 批量模式开关
    this.batchBtn = actions.createEl("button", {
      cls: "hl-btn-all annocard-icon-toolbar-btn annocard-toolbar-batch",
      attr: { "aria-label": t().cardBatchMode },
    });
    setIcon(this.batchBtn, "list-checks");
    this.batchBtn.toggleClass("is-active", this.batchMode);
    this.batchBtn.addEventListener("click", () => {
      this.batchMode = !this.batchMode;
      this.batchSelectedIds.clear();
      this.batchBtn?.toggleClass("is-active", this.batchMode);
      this.updateBatchBar();
      void this.renderCards();
    });

    // 复习模式入口
    this.reviewBtn = actions.createEl("button", {
      cls: "hl-btn-all annocard-icon-toolbar-btn annocard-toolbar-review",
      attr: { "aria-label": t().cardReviewStart },
    });
    setIcon(this.reviewBtn, "graduation-cap");
    this.reviewBtn.addEventListener("click", () => this.toggleReviewOverview());
  }

  // 切换卡片内容折叠状态并同步按钮态
  private setCardsCollapsed(collapsed: boolean): void {
    this.cardsCollapsed = collapsed;
    this.cardListEl?.toggleClass("annocard-cards-collapsed", collapsed);
    this.expandBtn?.toggleClass("is-active", !collapsed);
    this.collapseBtn?.toggleClass("is-active", collapsed);
  }

  private updateSortOptions(): void {
    if (!this.sortSelect) return;
    const currentValue = this.sortOption;
    this.sortSelect.empty();
    const loc = t();

    if (this.mode === "current") {
      const opts = [
        { v: "position-asc", t: loc.sidebarSortContent },
        { v: "position-desc", t: loc.sidebarSortContentDesc },
        { v: "time-asc", t: loc.sidebarSortTimeAsc },
        { v: "time-desc", t: loc.sidebarSortTimeDesc },
        { v: "color-asc", t: loc.sidebarSortColor },
        { v: "color-desc", t: loc.sidebarSortColorDesc },
      ];
      for (const o of opts) {
        this.sortSelect.createEl("option", { value: o.v, text: o.t });
      }
      // 如果当前选项不适用于当前笔记模式，回退
      if (!["position-asc", "position-desc", "time-asc", "time-desc", "color-asc", "color-desc"].includes(currentValue)) {
        this.sortOption = "position-asc";
      }
    } else {
      const opts = [
        { v: "by-note", t: loc.sidebarSortByNote },
        { v: "time-asc", t: loc.sidebarSortTimeAsc },
        { v: "time-desc", t: loc.sidebarSortTimeDesc },
        { v: "color-asc", t: loc.sidebarSortColor },
      ];
      for (const o of opts) {
        this.sortSelect.createEl("option", { value: o.v, text: o.t });
      }
      // 如果当前选项不适用于全部笔记模式，回退
      if (!["by-note", "time-asc", "time-desc", "color-asc"].includes(currentValue)) {
        this.sortOption = "by-note";
      }
    }
    this.sortSelect.value = this.sortOption;
  }

  private switchMode(newMode: SidebarMode): void {
    if (this.mode === newMode) return;
    this.mode = newMode;
    this.tabs.current.toggleClass("is-active", newMode === "current");
    this.tabs.all.toggleClass("is-active", newMode === "all");
    if (this.exportBtn) {
      this.exportBtn.toggleClass("is-hidden", newMode !== "current");
    }
    this.updateSortOptions();
    void this.refresh();
  }

  private renderSearchBar(container: HTMLElement): void {
    // HiLighter 风格：检索行 + 筛选行（分离）
    const filterArea = container.createDiv({ cls: "hl-filter-area" });

    // === 检索行 ===
    const searchRow = filterArea.createDiv({ cls: "hl-search-row" });
    searchRow.createSpan({ cls: "hl-row-label", text: t().sidebarSearchLabel });

    this.searchInput = searchRow.createEl("input", {
      type: "text",
      cls: "hl-search-input annotation-sidebar-search-input",
      placeholder: t().sidebarSearchPlaceholder,
    });
    this.searchInput.addEventListener("input", () => {
      if (this.searchDebounceTimer) window.clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = window.setTimeout(() => {
        this.searchQuery = this.searchInput?.value ?? "";
        void this.renderCards();
      }, 300);
    });

    // 已归档切换（HiLighter 风格圆角按钮）
    this.showArchivedBtn = searchRow.createEl("button", {
      cls: "hl-btn-all annocard-show-archived-btn",
      text: this.showArchived ? t().cardHideArchived : t().cardShowArchived,
    });
    this.showArchivedBtn.toggleClass("is-active", this.showArchived);
    this.showArchivedBtn.addEventListener("click", () => {
      this.showArchived = !this.showArchived;
      if (this.showArchivedBtn) {
        this.showArchivedBtn.textContent = this.showArchived ? t().cardHideArchived : t().cardShowArchived;
        this.showArchivedBtn.toggleClass("is-active", this.showArchived);
      }
      void this.renderCards();
    });

    // === 筛选行：颜色圆点 ===
    const colorRow = filterArea.createDiv({ cls: "hl-color-row" });
    this.colorRowEl = colorRow;
    this.rebuildColorFilterRow();
  }

  // 重建颜色筛选圆点行（设置里增删颜色后联动刷新）
  private rebuildColorFilterRow(): void {
    const colorRow = this.colorRowEl;
    if (!colorRow) return;
    const activeList = getActiveColors(this.plugin.settings);
    // 当前筛选色被停用则回退到"全部"
    if (this.colorFilter !== "all" && !activeList.includes(this.colorFilter)) {
      this.colorFilter = "all";
    }
    colorRow.empty();
    this.colorBtns.clear();
    colorRow.createSpan({ cls: "hl-row-label", text: t().sidebarFilterLabel });

    // "全部"按钮（彩虹圈样式）
    const allBtn = colorRow.createEl("button", {
      cls: "hl-h-color-dot annotation-sidebar-color-btn annotation-sidebar-color-all active hl-dot-all",
      text: "🌈",
      attr: { title: t().all },
    });
    allBtn.addEventListener("click", () => {
      this.colorFilter = "all";
      this.updateColorBtnState();
      void this.renderCards();
    });
    this.colorBtns.set("all", allBtn);

    // 颜色圆点
    const settingsMap = this.plugin.settings as unknown as Record<string, unknown>;
    for (const color of getActiveColors(this.plugin.settings)) {
      const label = settingsMap[`colorLabel${color}`];
      const btn = colorRow.createEl("button", {
        cls: `hl-h-color-dot annotation-sidebar-color-btn ${COLOR_CLASSES[color]} hl-dot-${color}`,
        attr: { title: typeof label === "string" ? label : "" },
      });
      btn.addEventListener("click", () => {
        this.colorFilter = color;
        this.updateColorBtnState();
        void this.renderCards();
      });
      this.colorBtns.set(color, btn);
    }
    this.updateColorBtnState();
  }

  // 设置里颜色增删后的联动入口（AnnotationSettingTab 调用）
  refreshColorFilter(): void {
    this.rebuildColorFilterRow();
    void this.renderCards();
  }

  // 刷新标签筛选下拉框的选项(基于当前缓存的全库/单文件标签集合)
  private refreshTagFilterOptions(): void {
    if (!this.tagFilterSelect) return;
    const loc = t();
    const tagArr = Array.from(this.tagFilter);
    const current = tagArr.length > 0 ? tagArr[0]! : "";

    this.tagFilterSelect.empty();
    // 占位项
    this.tagFilterSelect.createEl("option", { value: "", text: loc.cardTagFilterAll });

    for (const tag of this.allTagCandidates) {
      this.tagFilterSelect.createEl("option", { value: tag, text: tag });
    }

    // 还原选中状态
    this.tagFilterSelect.value = current;
  }

  private updateColorBtnState(): void {
    for (const [key, btn] of this.colorBtns) {
      btn.toggleClass("active", key === this.colorFilter);
    }
  }

  // ========== 批量模式工具栏 ==========

  // 渲染批量操作工具栏(初始隐藏,批量模式开启时显示)
  private renderBatchBar(container: HTMLElement): void {
    this.batchBar = container.createDiv({ cls: "annocard-batch-bar is-hidden" });

    this.batchSelectedCount = this.batchBar.createSpan({ cls: "annocard-batch-count" });

    const actions = this.batchBar.createDiv({ cls: "annocard-batch-actions" });
    const deleteBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-danger",
      text: t().cardBatchDelete,
    });
    deleteBtn.addEventListener("click", () => this.handleBatchDelete());

    const tagBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary",
      text: t().cardBatchTag,
    });
    tagBtn.addEventListener("click", () => this.handleBatchTag());

    const cancelBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary",
      text: t().cardBatchCancel,
    });
    cancelBtn.addEventListener("click", () => {
      this.batchMode = false;
      this.batchSelectedIds.clear();
      this.batchBtn?.toggleClass("is-active", this.batchMode);
      this.updateBatchBar();
      void this.renderCards();
    });

    this.updateBatchBar();
  }

  // 更新批量工具栏的可见性与选中计数
  private updateBatchBar(): void {
    if (!this.batchBar || !this.batchSelectedCount) return;
    this.batchBar.toggleClass("is-hidden", !this.batchMode);
    this.batchSelectedCount.textContent = t().cardBatchSelected(this.batchSelectedIds.size);
  }

  // 批量选中切换(由卡片复选框触发)
  private handleToggleSelect(cardData: AnnotationCardData, selected: boolean): void {
    if (selected) {
      this.batchSelectedIds.add(cardData.annotation.id);
    } else {
      this.batchSelectedIds.delete(cardData.annotation.id);
    }
    this.updateBatchBar();
  }

  // 收集当前选中(基于缓存的卡片数据,以便批量操作能拿到 notePath)
  private collectSelectedCards(): AnnotationCardData[] {
    if (this.batchSelectedIds.size === 0) return [];
    return this.cachedSortedCards.filter((c) => this.batchSelectedIds.has(c.annotation.id));
  }

  // 批量删除
  private handleBatchDelete(): void {
    const selected = this.collectSelectedCards();
    if (selected.length === 0) {
      new Notice(t().cardNoticeNoSelection);
      return;
    }
    confirmBatchDelete(this.app, this.fileManager, selected, async () => {
      // 刷新标注视图
      const notePaths = new Set(selected.map((c) => c.notePath));
      for (const notePath of notePaths) {
        await this.plugin.refreshAnnotationView(notePath);
      }
      // 清空选中,重新加载列表
      this.batchSelectedIds.clear();
      this.updateBatchBar();
      await this.refresh();
    });
  }

  // 批量打标签
  private handleBatchTag(): void {
    const selected = this.collectSelectedCards();
    if (selected.length === 0) {
      new Notice(t().cardNoticeNoSelection);
      return;
    }
    new BatchTagInputModal(this.app, (tags) => {
      void (async () => {
        await batchAddTags(this.fileManager, selected, tags);
        // 刷新标注视图
        const notePaths = new Set(selected.map((c) => c.notePath));
        for (const notePath of notePaths) {
          await this.plugin.refreshAnnotationView(notePath);
        }
        // 不清空选中,允许继续操作;重新加载列表以反映新标签
        await this.refresh();
      })();
    }).open();
  }

  // ========== 卡片内联编辑 ==========

  // 内联编辑批注:把 noteEl 替换为 textarea,失焦/回车保存
  private async handleInlineEditNote(cardData: AnnotationCardData, noteEl: HTMLElement): Promise<void> {
    const parent = noteEl.parentElement;
    if (!parent) return;

    // 创建 textarea
    const textarea = document.createElement("textarea");
    textarea.className = "annocard-inline-note-edit";
    textarea.value = cardData.annotation.note;
    textarea.setAttribute("rows", "2");
    const maxLen = this.plugin.settings.maxNoteLength;
    textarea.setAttribute("maxlength", String(maxLen));

    parent.replaceChild(textarea, noteEl);
    textarea.focus();
    textarea.select();

    let saved = false;
    const save = async () => {
      if (saved) return;
      saved = true;
      const newNote = textarea.value;
      if (newNote === cardData.annotation.note) {
        // 未修改,还原显示
        parent.replaceChild(noteEl, textarea);
        return;
      }
      try {
        // 走 fileManager 更新(若标注视图在 source 模式下打开,会通过事件刷新)
        await this.fileManager.updateAnnotation(cardData.notePath, cardData.annotation.id, { note: newNote });
        cardData.annotation.note = newNote;
        // 刷新对应标注视图
        await this.plugin.refreshAnnotationView(cardData.notePath);
        // 更新 noteEl 内容（空批注时保持隐藏占位类）
        noteEl.textContent = newNote;
        noteEl.toggleClass("annocard-note-empty", !newNote);
        parent.replaceChild(noteEl, textarea);
        new Notice(t().cardNoticeNoteUpdated);
      } catch (e) {
        console.error("内联编辑批注失败:", e);
        parent.replaceChild(noteEl, textarea);
      }
    };

    textarea.addEventListener("blur", () => void save());
    textarea.addEventListener("keydown", (e) => {
      // Ctrl/Cmd+Enter 强制保存,Esc 取消
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        textarea.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        saved = true; // 阻止 blur 保存
        parent.replaceChild(noteEl, textarea);
      }
    });
  }

  // 内联添加标签:在 tagsEl 内追加输入框,绑定 TagSuggest,确认后追加
  private handleAddTagInline(cardData: AnnotationCardData, tagsEl: HTMLElement): void {
    // 已存在输入框则不重复创建
    const existing = tagsEl.querySelector(".annocard-tag-input");
    if (existing) {
      (existing as HTMLInputElement).focus();
      return;
    }

    const input = createEl("input", {
      cls: "annocard-tag-input",
      attr: { type: "text", placeholder: t().cardTagAddPlaceholder, size: "12" },
    });
    tagsEl.appendChild(input);
    input.focus();

    // TagSuggest 绑定
    const suggest = new TagSuggest(this.app, input, () => this.allTagCandidates);
    suggest.onSelect((suggestion) => {
      input.value = suggestion.tag;
      void this.commitTagInput(cardData, input, tagsEl);
    });

    let committed = false;
    const commitHandler = () => {
      if (committed) return;
      committed = true;
      void this.commitTagInput(cardData, input, tagsEl);
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitHandler();
      } else if (e.key === "Escape") {
        e.preventDefault();
        committed = true;
        input.remove();
      }
    });
    input.addEventListener("blur", () => {
      // 失焦时若有输入则提交,否则移除
      if (input.value.trim()) commitHandler();
      else input.remove();
    });
  }

  // 提交标签输入(由 Enter/blur 触发)
  private async commitTagInput(
    cardData: AnnotationCardData,
    input: HTMLInputElement,
    tagsEl: HTMLElement
  ): Promise<void> {
    const tag = input.value.trim();
    if (!tag) {
      input.remove();
      return;
    }
    const existing = cardData.annotation.tags ?? [];
    if (existing.includes(tag)) {
      input.remove();
      return;
    }
    try {
      const merged = [...existing, tag];
      await this.fileManager.updateAnnotation(cardData.notePath, cardData.annotation.id, { tags: merged });
      cardData.annotation.tags = merged;
      // 刷新对应标注视图(可选,标签不显示在原文,只为保持数据一致)
      await this.plugin.refreshAnnotationView(cardData.notePath);
      // 重新渲染当前卡片以显示新 chip
      // 简化:触发全列表刷新(单卡 re-render 需要保存 ref,此处折中)
      new Notice(t().cardNoticeTagAdded);
      await this.refresh();
    } catch (e) {
      console.error("添加标签失败:", e);
      input.remove();
    }
  }

  // 删除单个标签
  private async handleRemoveTag(cardData: AnnotationCardData, tag: string): Promise<void> {
    const existing = cardData.annotation.tags ?? [];
    const merged = existing.filter((t) => t !== tag);
    try {
      await this.fileManager.updateAnnotation(cardData.notePath, cardData.annotation.id, { tags: merged });
      cardData.annotation.tags = merged;
      await this.plugin.refreshAnnotationView(cardData.notePath);
      new Notice(t().cardNoticeTagRemoved);
      await this.refresh();
    } catch (e) {
      console.error("删除标签失败:", e);
    }
  }

  // ========== 复习模式 ==========

  // 启动复习模式:取当前筛选下的未归档卡片
  // 公开:供命令"开始复习"调用;传入 cards 时仅复习该子集(复习总览点击卡片/文件组)
  startReview(cards?: AnnotationCardData[]): void {
    // 已打开则不重复启动
    if (this.reviewMode) return;

    // 复习包含全部卡片(含已标记"记住"的),复习界面内可用右上筛选只看记住/忘记
    const reviewCards = cards ?? this.cachedSortedCards;
    if (reviewCards.length === 0) {
      new Notice(t().cardReviewEmpty);
      return;
    }

    // 进入复习弹层前退出总览
    this.reviewOverviewActive = false;
    this.reviewBtn?.removeClass("is-active");

    this.reviewMode = new ReviewMode(this.fileManager, reviewCards, {
      batchSize: this.plugin.settings.reviewBatchSize,
      onExit: () => {
        this.reviewMode = null;
        this.reviewOverviewActive = false;
        this.reviewBtn?.removeClass("is-active");
        // 复习可能修改了 archived,重置 allAnnotationsCache 以重新加载
        this.allAnnotationsCache = null;
        void this.refresh();
      },
    });
    this.reviewMode.start();
  }

  // 切换复习总览(HiLighter 风格:按文件分组 + 数量角标 + 卡片网格)
  private toggleReviewOverview(): void {
    if (this.reviewMode) return;
    this.reviewOverviewActive = !this.reviewOverviewActive;
    this.reviewBtn?.toggleClass("is-active", this.reviewOverviewActive);
    void this.renderCards({ keepReviewOverview: this.reviewOverviewActive });
  }

  // 渲染复习总览:按文件分组,点击卡片复习该文件组,"复习全部"复习当前筛选全集
  private renderReviewOverview(): void {
    if (!this.cardListEl) return;
    const loc = t();
    this.cardListEl.empty();

    const total = this.cachedSortedCards.length;
    if (total === 0) {
      this.renderEmpty(this.cardListEl, loc.cardReviewEmpty);
      return;
    }

    // 顶部"复习全部"
    const topRow = this.cardListEl.createDiv({ cls: "annocard-review-overview-top" });
    const allBtn = topRow.createEl("button", {
      cls: "annocard-review-all-btn",
      text: `${loc.reviewOverviewAll} (${total})`,
    });
    allBtn.addEventListener("click", () => this.startReview());

    // 按文件分组,保持当前排序中首次出现的顺序
    const groups = new Map<string, AnnotationCardData[]>();
    for (const card of this.cachedSortedCards) {
      const arr = groups.get(card.notePath);
      if (arr) arr.push(card);
      else groups.set(card.notePath, [card]);
    }

    for (const [notePath, cards] of groups) {
      const fileName = notePath.split("/").pop()?.replace(/\.md$/i, "") ?? notePath;
      const group = this.cardListEl.createDiv({ cls: "annocard-review-group" });
      const header = group.createDiv({ cls: "annocard-review-group-header" });
      const caret = header.createSpan({ cls: "annocard-review-group-caret", text: "▾" });
      header.createSpan({ cls: "annocard-review-group-name", text: fileName });
      header.createSpan({ cls: "annocard-review-group-count", text: String(cards.length) });
      const grid = group.createDiv({ cls: "annocard-review-grid" });
      header.addEventListener("click", () => {
        const collapsed = !grid.hasClass("is-collapsed");
        grid.toggleClass("is-collapsed", collapsed);
        caret.toggleClass("is-collapsed", collapsed);
      });

      for (const card of cards) {
        const tile = grid.createDiv({ cls: "annocard-review-tile" });
        // 已标记"记住"(archived)的卡片绿色调,与复习筛选语义一致
        if (card.annotation.archived) tile.addClass("is-remembered");
        const accent = COLOR_ACCENT_VARS[card.annotation.color];
        if (accent) tile.setCssStyles({ borderLeft: `3px solid ${accent}` });
        const excerpt = card.annotation.note || card.annotation.text;
        tile.createDiv({
          cls: "annocard-review-tile-text",
          text: excerpt.length > 140 ? excerpt.slice(0, 140) + "…" : excerpt,
        });
        tile.addEventListener("click", () => this.startReview(cards));
      }
    }
  }

  // ========== 数据加载 ==========

  async refresh(): Promise<void> {
    this.allAnnotationsCache = null;
    // 数据变更(加批注/标签、批量操作、复习退出等)后的刷新保持滚动位置,
    // 避免卡片流跳回顶部;筛选/搜索/排序路径直接调 renderCards 仍回顶部
    await this.renderCards({ preserveScroll: true });
    const activeFile = this.app.workspace.getActiveFile();
    this.lastRefreshedNotePath = activeFile?.path ?? null;
  }

  private async renderCards(opts: { preserveScroll?: boolean; keepReviewOverview?: boolean } = {}): Promise<void> {
    if (!this.cardListEl) return;
    // 非总览触发路径(筛选/搜索/排序/数据刷新)一律退出复习总览
    if (!opts.keepReviewOverview) this.reviewOverviewActive = false;
    // 复习总览激活:渲染分组网格而非普通卡片流
    if (this.reviewOverviewActive) {
      this.renderReviewOverview();
      return;
    }
    // 在 empty() 前捕获滚动位置(仅 preserveScroll 时)
    const savedScroll = opts.preserveScroll ? this.cardListEl.scrollTop : 0;

    // 筛选色可能指向已删除（停用）的颜色，重置为全部
    if (this.colorFilter !== "all" && !getActiveColors(this.plugin.settings).includes(this.colorFilter)) {
      this.colorFilter = "all";
      this.updateColorBtnState();
    }

    // 本次渲染的代次；拍快照 mode，避免 await 期间 mode 被切换后仍走旧分支
    const myGen = ++this.renderGeneration;
    const modeSnapshot = this.mode;

    this.cardListEl.empty();

    let cards: AnnotationCardData[];

    try {
      if (modeSnapshot === "current") {
        cards = await this.loadCurrentFileAnnotations();
      } else {
        cards = await this.loadAllAnnotations();
      }
    } catch {
      if (myGen === this.renderGeneration) {
        this.renderEmpty(this.cardListEl, t().sidebarLoadFailed);
      }
      return;
    }

    // 检查点：数据加载后若已被更新的渲染取代，丢弃本次（防重复卡片 / 防混入）
    if (myGen !== this.renderGeneration) return;

    // AnnoCard:更新标签候选缓存(供 TagSuggest 与标签筛选下拉用)
    this.allTagCandidates = tagsByFrequency(cards);
    this.refreshTagFilterOptions();

    // AnnoCard:应用统一筛选(archived + 颜色 + 标签 + 关键词)
    const filterState = this.buildFilterState();
    const filtered = applyCardFilter(cards, filterState);
    const sorted = this.applySort(filtered);

    // AnnoCard:缓存分页数据,渲染首屏(空态由 renderNextPage 处理)
    this.cachedSortedCards = sorted;
    this.renderedCount = 0;
    this.renderNextPage();

    // 恢复刷新前的滚动位置:若原位置超出首屏高度,继续补渲染后续页直到覆盖
    if (savedScroll > 0 && this.cachedSortedCards.length > 0) {
      let guard = 0;
      while (
        this.renderedCount < this.cachedSortedCards.length &&
        this.cardListEl.scrollHeight < savedScroll + this.cardListEl.clientHeight &&
        guard++ < 50
      ) {
        this.renderNextPage();
      }
      this.cardListEl.scrollTop = savedScroll;
    }
  }

  // 构建当前筛选状态(供 applyCardFilter 用)
  private buildFilterState(): CardFilterState {
    const colors = new Set<AnnotationColor>();
    if (this.colorFilter !== "all") {
      colors.add(this.colorFilter);
    }
    return {
      colors,
      keyword: this.searchQuery.trim(),
      tags: new Set(this.tagFilter),
      showArchived: this.showArchived,
    };
  }

  // 渲染下一页(从 cachedSortedCards 头部累计 renderedCount 处开始)
  private renderNextPage(): void {
    if (!this.cardListEl) return;

    // 首屏(空列表时):empty 已在 renderCards 调用前做过
    if (this.renderedCount === 0) {
      this.cardListEl.empty();
    }

    if (this.cachedSortedCards.length === 0) {
      const loc = t();
      const hasFilter = !!this.searchQuery
        || this.colorFilter !== "all"
        || this.tagFilter.size > 0
        || !this.showArchived;
      this.renderEmpty(
        this.cardListEl,
        hasFilter ? loc.sidebarNoMatch : loc.sidebarNoAnnotations
      );
      return;
    }

    const end = Math.min(this.renderedCount + CARD_PAGE_SIZE, this.cachedSortedCards.length);
    const batch = this.cachedSortedCards.slice(this.renderedCount, end);

    for (const cardData of batch) {
      createAnnotationCard(this.cardListEl, cardData, {
        onClick: () => { /* 点击卡片不再打开详情面板 */ },
        onOpen: (data) => { void this.handleCardOpen(data); },
        onDelete: (data) => this.handleCardDelete(data),
      }, {
        batchMode: this.batchMode,
        selected: this.batchSelectedIds.has(cardData.annotation.id),
        onToggleSelect: (data, selected) => this.handleToggleSelect(data, selected),
        onEditNote: (data, noteEl) => { void this.handleInlineEditNote(data, noteEl); },
        onAddTag: (data, tagsEl) => this.handleAddTagInline(data, tagsEl),
        onRemoveTag: (data, tag) => { void this.handleRemoveTag(data, tag); },
      });
    }
    this.renderedCount = end;

    // 末尾加载更多按钮(若仍有未渲染的)
    if (this.renderedCount < this.cachedSortedCards.length) {
      const moreBtn = this.cardListEl.createDiv({
        cls: "annocard-load-more",
        text: t().cardLoadMore,
      });
      moreBtn.addEventListener("click", () => {
        moreBtn.remove();
        this.renderNextPage();
      });
    }
  }

  // 滚动触发的加载更多(若已到末尾则无操作)
  private loadMore(): void {
    if (!this.cardListEl) return;
    if (this.renderedCount >= this.cachedSortedCards.length) return;
    // 移除末尾的"加载更多"按钮(避免与新渲染的批次重叠)
    const oldBtn = this.cardListEl.querySelector(".annocard-load-more");
    if (oldBtn) oldBtn.remove();
    this.renderNextPage();
  }

  private async loadCurrentFileAnnotations(): Promise<AnnotationCardData[]> {
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      // 没有活跃文件，尝试通过标注会话获取
      const notePath = this.plugin.getActiveAnnotationNotePath();
      if (notePath) return this.loadAnnotationsForNote(notePath);
      return [];
    }

    if (activeFile.extension !== "md") return [];

    // 检查当前文件是否是标注文件（fakeTFile）
    const originalPath = this.plugin.getOriginalPathByAnnotationPath(activeFile.path);
    const notePath = originalPath ?? activeFile.path;

    return this.loadAnnotationsForNote(notePath);
  }

  private async loadAnnotationsForNote(notePath: string): Promise<AnnotationCardData[]> {
    const hasFile = await this.fileManager.hasAnnotationFile(notePath);
    if (!hasFile) return [];
    const annotations = await this.fileManager.getAnnotations(notePath);
    const fileName = notePath.split("/").pop() ?? notePath;
    return annotations.map((a) => ({ annotation: a, notePath, fileName }));
  }

  private async loadAllAnnotations(): Promise<AnnotationCardData[]> {
    if (this.allAnnotationsCache) return this.allAnnotationsCache;

    const pluginDir = this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/obsidian-annotation-marker`;
    const annotationsDir = normalizePath(`${pluginDir}/annotations`);

    const exists = await this.app.vault.adapter.exists(annotationsDir);
    if (!exists) {
      this.allAnnotationsCache = [];
      return [];
    }

    const listed = await this.app.vault.adapter.list(annotationsDir);

    // 并行读取（限流 8 并发，避免大库一次性打满 I/O）：此前逐文件串行 await，
    // 全部笔记模式下首次加载与缓存失效后的重读都很慢
    const mdFiles = listed.files.filter((f) => f.endsWith(".md"));
    const results: AnnotationCardData[] = [];
    const CONCURRENCY = 8;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < mdFiles.length) {
        const filePath = mdFiles[cursor++]!;
        try {
          const notePath = annotationPathToNotePath(pluginDir, filePath);
          const originalFile = this.app.vault.getAbstractFileByPath(notePath);
          if (!(originalFile instanceof TFile)) continue;
          const annotations = await this.fileManager.getAnnotations(notePath);
          const fileName = originalFile.name;
          for (const annotation of annotations) {
            results.push({ annotation, notePath, fileName });
          }
        } catch {
          // 跳过
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, mdFiles.length) }, worker));

    this.allAnnotationsCache = results;
    return results;
  }

  // ========== 筛选与排序 ==========
  // applyFilters 已被 applyCardFilter(archived+color+tag+keyword 统一)替代,见 renderCards

  private applySort(cards: AnnotationCardData[]): AnnotationCardData[] {
    const sorted = [...cards];
    switch (this.sortOption) {
      case "position-asc":
        sorted.sort((a, b) => a.annotation.positions[0]!.start - b.annotation.positions[0]!.start);
        break;
      case "position-desc":
        sorted.sort((a, b) => b.annotation.positions[0]!.start - a.annotation.positions[0]!.start);
        break;
      case "time-asc":
        sorted.sort((a, b) => parseInt(a.annotation.id) - parseInt(b.annotation.id));
        break;
      case "time-desc":
        sorted.sort((a, b) => parseInt(b.annotation.id) - parseInt(a.annotation.id));
        break;
      case "color-asc":
        sorted.sort((a, b) => a.annotation.color.localeCompare(b.annotation.color));
        break;
      case "color-desc":
        sorted.sort((a, b) => b.annotation.color.localeCompare(a.annotation.color));
        break;
      case "by-note":
        sorted.sort((a, b) => {
          const cmp = a.notePath.localeCompare(b.notePath);
          if (cmp !== 0) return cmp;
          return a.annotation.positions[0]!.start - b.annotation.positions[0]!.start;
        });
        break;
    }
    return sorted;
  }

  private renderEmpty(container: HTMLElement, message: string): void {
    container.createDiv({ cls: "annotation-sidebar-empty", text: message });
  }

  // ========== 查找标注视图 ==========

  private findAnnotationView(notePath: string): MarkdownView | null {
    const annotationPath = this.plugin.activeAnnotationSessions.get(notePath);
    if (!annotationPath) return null;

    let result: MarkdownView | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === annotationPath) {
        result = view;
      }
    });
    return result;
  }

  // ========== 卡片操作 ==========

  private async handleCardOpen(cardData: AnnotationCardData): Promise<void> {
    const { notePath, annotation } = cardData;

    // 检查目标笔记是否已在标注视图中
    const annotationPath = this.plugin.activeAnnotationSessions.get(notePath);
    let targetLeaf: WorkspaceLeaf | null = null;

    if (annotationPath) {
      this.app.workspace.iterateAllLeaves((leaf) => {
        // 只匹配主区 leaf，排除左右 side dock，避免误激活 side view 导致侧边栏跳走
        const root = leaf.getRoot();
        if (root !== this.app.workspace.rootSplit) return;
        const filePath = getViewFilePath(leaf.view);
        if (filePath === annotationPath) {
          targetLeaf = leaf;
        } else if (!targetLeaf) {
          // 标签页未激活时 view.file 可能暂时为 null，用 viewState 兜底（与 main.ts layout-change 一致）
          const vs = leaf.getViewState();
          if ((vs.state as { file?: string }).file === annotationPath) {
            targetLeaf = leaf;
          }
        }
      });
    }

    if (!targetLeaf) {
      const file = this.app.vault.getAbstractFileByPath(notePath);
      if (!(file instanceof TFile)) {
        new Notice(t().noticeNoteFileNotFound);
        return;
      }
      // getLeaf(false) 复用活动 leaf；从侧边栏点击时活动 leaf 可能就是侧边栏 leaf，
      // 在其上 openFile 会把侧边栏视图替换成笔记，故检测到 side dock 时改在主区打开
      let leaf = this.app.workspace.getLeaf(false);
      const root = leaf.getRoot();
      if (root === this.app.workspace.leftSplit || root === this.app.workspace.rightSplit) {
        leaf = this.app.workspace.getLeaf("tab");
      }
      await leaf.openFile(file);
      await this.plugin.openAnnotationView(leaf, notePath);
      targetLeaf = leaf;
    }

    this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
    await this.scrollToAnnotationInLeaf(targetLeaf, annotation);
  }

  private async scrollToAnnotationInLeaf(leaf: WorkspaceLeaf, annotation: ParsedAnnotation): Promise<void> {
    const view = leaf.view as MarkdownView;
    if (!view) return;

    const viewNotePath = this.getNotePathForView(view);
    if (!viewNotePath) return;

    const ap = this.plugin.activeAnnotationSessions.get(viewNotePath);
    const notePath = ap ? this.plugin.getOriginalPathByAnnotationPath(ap) ?? viewNotePath : viewNotePath;

    await scrollToAnnotation(
      this.app,
      this.fileManager,
      view,
      notePath,
      annotation,
      { delayBeforeScroll: 400 }
    );
  }

  private getNotePathForView(view: MarkdownView): string | null {
    const filePath = view.file?.path;
    if (!filePath) return null;
    return this.plugin.getOriginalPathByAnnotationPath(filePath) ?? filePath;
  }

  private handleCardDelete(cardData: AnnotationCardData): void {
    const { annotation, notePath } = cardData;

    const loc = t();
    const msg = (annotation.isFullText || annotation.positions.length > 1) && annotation.positions.length > 1
      ? loc.confirmDeleteMulti(annotation.positions.length)
      : loc.confirmDelete;

    // 使用 Obsidian Modal 替代浏览器 confirm()，避免焦点丢失
    new ConfirmOverwriteModal(
      this.app,
      msg,
      async () => {
        const view = this.findAnnotationView(notePath);
        const deleted = view && view.getMode() === "source"
          ? await editAnnotationInEditor(view, this.fileManager, notePath, annotation.id, "delete")
          : false;

        if (!deleted) {
          await this.fileManager.removeAnnotation(notePath, annotation.id);
        }

        await this.plugin.refreshAnnotationView(notePath);
        void this.renderCards();
        new Notice(loc.noticeDeleted);
      },
      loc.delete
    ).open();
  }

  // ========== 导出标注 ==========

  private async exportCurrentAnnotations(): Promise<void> {
    const loc = t();
    const cards = await this.loadCurrentFileAnnotations();
    if (cards.length === 0) {
      new Notice(loc.noData);
      return;
    }

    // 导出仅在当前笔记模式可用（exportBtn 在 by-note 所属的"全部笔记"模式下隐藏），
    // 防御性兜底：万一 sortOption 残留 by-note 则回退为位置正序
    const sortOption = this.sortOption === "by-note" ? "position-asc" as const : this.sortOption;
    const annotations = sortAnnotations(
      cards.map((c) => c.annotation),
      sortOption
    );
    const content = buildExportContent(annotations);
    const exportFolder = this.plugin.settings.exportFolder?.trim();

    const doExport = (folderPath: string) => {
      const activeFile = this.app.workspace.getActiveFile();
      const noteName = activeFile?.name?.replace(/\.md$/, "") ?? "";

      new FileNameModal(this.app, noteName, async (fileName: string) => {
        const filePath = normalizePath(folderPath && folderPath !== "/" ? `${folderPath}/${fileName}` : fileName);
        const existing = this.app.vault.getAbstractFileByPath(filePath);

        const doWrite = async () => {
          try {
            if (existing instanceof TFile) {
              await this.app.vault.modify(existing, content);
            } else {
              await this.app.vault.create(filePath, content);
            }
            new Notice(loc.noticeExportSuccess(annotations.length));
          } catch (e) {
            console.error("导出失败:", e);
            new Notice(loc.noticeExportFailed);
          }
        };

        if (existing instanceof TFile) {
          new ConfirmOverwriteModal(
            this.app,
            `${loc.exportConfirmOverwrite}\n${filePath}\n\n${loc.exportConfirmOverwriteDesc}`,
            doWrite
          ).open();
        } else {
          await doWrite();
        }
      }).open();
    };

    if (exportFolder) {
      doExport(exportFolder);
    } else {
      new FolderSuggestModal(this.app, doExport).open();
    }
  }
}
