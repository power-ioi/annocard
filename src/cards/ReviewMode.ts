// AnnoCard 复习模式
// 全屏 overlay 展示当前筛选条件下的未归档标注,逐张过卡
// 卡片下方操作按钮位于 overlay 底部固定栏:上一页 / 记住 / 忘记 / 下一页
// 右上方筛选:记住 / 忘记 —— 只复习对应类别的卡片;未显式标记"记住"的卡片一律归入"忘记"
// 同一张卡片反复标记时以最后一次为准(记住→忘记立即重新归类,反之亦然)
// Fisher-Yates 洗牌,洗牌顺序不持久化,仅持久化 reviewCount/archived/lastReviewedAt

import { Notice } from "obsidian";
import type { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import type { AnnotationCardData } from "../sidebar/AnnotationCard";
import { COLOR_CLASSES } from "../constants";
import { t } from "../i18n";

export interface ReviewModeOptions {
  // 复习每次洗牌数量上限(0=不限)
  batchSize: number;
  // 复习完成后回调(关闭 overlay 时调用,通常触发 sidebar 刷新)
  onExit?: () => void;
  // 单张状态持久化后的回调(可选,用于即时更新外部 UI)
  onCardUpdated?: (cardData: AnnotationCardData) => void;
}

type ReviewFilter = "all" | "remember" | "forget";

export class ReviewMode {
  private fileManager: AnnotationFileManager;
  private cards: AnnotationCardData[];
  private options: ReviewModeOptions;

  // 洗牌后的复习序列(全量)
  private shuffled: AnnotationCardData[] = [];
  // 当前浏览序列(筛选后)
  private queue: AnnotationCardData[] = [];
  // 当前指针
  private cursor = 0;
  // 当前筛选
  private filterMode: ReviewFilter = "all";
  // 会话内显式标记"记住"的卡片(key = notePath#id);未标记的卡片一律视为"忘记"
  private rememberedKeys = new Set<string>();
  // 本次会话显式点击"忘记"的次数(统计用)
  private forgetClicks = 0;

  // overlay DOM 根元素
  private overlayEl: HTMLElement | null = null;
  // 内容容器(每次切换卡片时 empty 重填)
  private contentEl: HTMLElement | null = null;
  // 底部固定操作栏(卡片外,常驻)
  private actionsBarEl: HTMLElement | null = null;
  // 进度条
  private progressEl: HTMLElement | null = null;
  // 右上方筛选按钮
  private filterRememberBtn: HTMLElement | null = null;
  private filterForgetBtn: HTMLElement | null = null;

  private isClosed = false;

  constructor(
    fileManager: AnnotationFileManager,
    cards: AnnotationCardData[],
    options: ReviewModeOptions
  ) {
    this.fileManager = fileManager;
    this.cards = cards;
    this.options = options;
  }

  /**
   * 启动复习模式:洗牌 + 创建 overlay + 渲染第一张
   */
  start(): void {
    if (this.cards.length === 0) {
      new Notice(t().cardReviewEmpty);
      return;
    }

    // 1. 洗牌
    this.shuffled = this.shuffle(this.cards.slice());

    // 2. 截取上限
    const limit = this.options.batchSize > 0 ? this.options.batchSize : this.shuffled.length;
    this.shuffled = this.shuffled.slice(0, Math.min(limit, this.shuffled.length));

    if (this.shuffled.length === 0) {
      new Notice(t().cardReviewEmpty);
      return;
    }

    // 3. 创建 overlay
    // 会话状态重置:已归档(archived=true)的卡片视为之前标记的"记住",其余默认"忘记"
    this.rememberedKeys = new Set(
      this.shuffled.filter((c) => c.annotation.archived).map((c) => this.keyOf(c))
    );
    this.forgetClicks = 0;
    this.filterMode = "all";
    this.queue = this.shuffled.slice();
    this.cursor = 0;
    this.createOverlay();
    this.renderCurrentCard();
  }

  /**
   * Fisher-Yates 洗牌(从后向前)
   */
  private shuffle(arr: AnnotationCardData[]): AnnotationCardData[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  private keyOf(card: AnnotationCardData): string {
    return card.notePath + "#" + card.annotation.id;
  }

  // 卡片是否被归入"忘记"(未被显式标记"记住"的都算忘记)
  private isForgotten(card: AnnotationCardData): boolean {
    return !this.rememberedKeys.has(this.keyOf(card));
  }

  private createOverlay(): void {
    const root = activeDocument.body;
    this.overlayEl = root.createDiv({ cls: "annocard-review-overlay" });

    // 头部:标题 + 进度 + 分类筛选(记住/忘记) + 退出
    const header = this.overlayEl.createDiv({ cls: "annocard-review-header" });
    header.createSpan({ cls: "annocard-review-title", text: t().cardReviewStart });
    this.progressEl = header.createSpan({ cls: "annocard-review-progress" });

    // 右上方分类筛选:点击只复习对应类别(记住/忘记)
    this.filterRememberBtn = header.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annocard-review-filter annocard-filter-remember",
    });
    this.filterRememberBtn.addEventListener("click", () => this.applyFilter("remember"));

    this.filterForgetBtn = header.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annocard-review-filter annocard-filter-forget",
    });
    this.filterForgetBtn.addEventListener("click", () => this.applyFilter("forget"));

    this.updateFilterBtns();

    const exitBtn = header.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annocard-review-exit",
      text: t().cardReviewExit,
    });
    exitBtn.addEventListener("click", () => this.exit());

    // 内容容器
    this.contentEl = this.overlayEl.createDiv({ cls: "annocard-review-content" });

    // 底部固定操作栏(在卡片外,常驻不随卡片滚动)
    this.actionsBarEl = this.overlayEl.createDiv({ cls: "annocard-review-actions-bar" });

    // 阻止冒泡到 Obsidian 的事件(简化:overlay 自身 click 不做事)
    this.overlayEl.addEventListener("click", (e) => {
      if (e.target === this.overlayEl) {
        // 点击空白不退出,避免误触
      }
    });

    // Esc 退出
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.exit();
        activeDocument.removeEventListener("keydown", escHandler);
      }
    };
    activeDocument.addEventListener("keydown", escHandler);
  }

  // 切换分类筛选:再点同一个取消,回到全部
  private applyFilter(mode: ReviewFilter): void {
    this.filterMode = this.filterMode === mode ? "all" : mode;
    this.queue = this.filterMode === "all"
      ? this.shuffled.slice()
      : this.shuffled.filter((c) =>
          this.filterMode === "remember"
            ? this.rememberedKeys.has(this.keyOf(c))
            : this.isForgotten(c)
        );
    this.cursor = 0;
    this.updateFilterBtns();
    if (this.queue.length === 0) {
      new Notice(t().cardReviewEmpty);
    }
    this.renderCurrentCard();
  }

  // 刷新右上方筛选按钮的计数与高亮
  private updateFilterBtns(): void {
    if (!this.filterRememberBtn || !this.filterForgetBtn) return;
    const rememberCount = this.shuffled.filter((c) => this.rememberedKeys.has(this.keyOf(c))).length;
    const forgetCount = this.shuffled.length - rememberCount;
    this.filterRememberBtn.textContent = `${t().cardReviewRemember} ${rememberCount}`;
    this.filterForgetBtn.textContent = `${t().cardReviewForget} ${forgetCount}`;
    this.filterRememberBtn.toggleClass("is-active", this.filterMode === "remember");
    this.filterForgetBtn.toggleClass("is-active", this.filterMode === "forget");
  }

  private renderCurrentCard(): void {
    if (!this.contentEl || !this.progressEl || !this.overlayEl) return;
    this.contentEl.empty();

    const card = this.queue[this.cursor];
    if (!card) {
      this.renderComplete();
      return;
    }

    const { annotation, fileName } = card;
    const loc = t();

    // 进度
    this.progressEl.textContent = loc.cardReviewProgress(this.cursor + 1, this.queue.length);

    // 卡片主体
    const cardEl = this.contentEl.createDiv({ cls: "annocard-review-card" });
    cardEl.addClass(COLOR_CLASSES[annotation.color]);

    // 头部:颜色 + 文件名 + 复习次数
    const header = cardEl.createDiv({ cls: "annocard-review-card-header" });
    header.createSpan({ cls: `annotation-list-dot ${COLOR_CLASSES[annotation.color]}` });
    header.createSpan({ cls: "annocard-review-card-file", text: fileName });
    if (annotation.reviewCount > 0) {
      header.createSpan({
        cls: "annocard-badge-review",
        text: loc.cardReviewCount(annotation.reviewCount),
      });
    }

    // 标注原文(大字号)
    const textEl = cardEl.createDiv({ cls: "annocard-review-card-text" });
    textEl.textContent = annotation.text;

    // 标签 chips
    const tags = annotation.tags ?? [];
    if (tags.length > 0) {
      const tagsEl = cardEl.createDiv({ cls: "annocard-card-tags" });
      for (const tag of tags) {
        tagsEl.createSpan({ cls: "annocard-tag-chip" })
          .createSpan({ cls: "annocard-tag-chip-text", text: tag });
      }
    }

    // 批注(若有)
    if (annotation.note) {
      const noteEl = cardEl.createDiv({ cls: "annocard-review-card-note" });
      noteEl.textContent = annotation.note;
    }

    // 操作按钮渲染到底部固定栏(卡片内不放按钮)
    this.renderActionsBar();

    // 键盘快捷键:← → 翻页,1 = 忘记,2 = 记住
    const keyHandler = (e: KeyboardEvent) => {
      if (this.isClosed) {
        activeDocument.removeEventListener("keydown", keyHandler);
        return;
      }
      if (e.key === "ArrowLeft" && this.cursor > 0) {
        e.preventDefault();
        this.prev();
      } else if (e.key === "ArrowRight" && this.cursor < this.queue.length - 1) {
        e.preventDefault();
        this.next();
      } else if (e.key === "1") {
        e.preventDefault();
        void this.markForget();
      } else if (e.key === "2") {
        e.preventDefault();
        void this.markRemember();
      }
    };
    activeDocument.addEventListener("keydown", keyHandler);
  }

  // 底部固定栏:上一页 / 记住 / 忘记 / 下一页
  private renderActionsBar(): void {
    if (!this.actionsBarEl) return;
    this.actionsBarEl.empty();
    const loc = t();

    // 上一页
    const prevBtn = this.actionsBarEl.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary",
      text: loc.cardReviewPrev,
    });
    prevBtn.disabled = this.cursor === 0;
    prevBtn.addEventListener("click", () => this.prev());

    // 记住(archived=true,归入"记住"类)
    const rememberBtn = this.actionsBarEl.createEl("button", {
      cls: "annotation-btn annotation-btn-primary annocard-review-mastered",
      text: loc.cardReviewRemember,
    });
    rememberBtn.addEventListener("click", () => void this.markRemember());

    // 忘记(reviewCount++,归入"忘记"类)
    const forgetBtn = this.actionsBarEl.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annocard-review-again",
      text: loc.cardReviewForget,
    });
    forgetBtn.addEventListener("click", () => void this.markForget());

    // 下一页
    const nextBtn = this.actionsBarEl.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary",
      text: loc.cardReviewNext,
    });
    nextBtn.disabled = this.cursor === this.queue.length - 1;
    nextBtn.addEventListener("click", () => this.next());
  }

  // 复习完成时底部固定栏只放退出按钮
  private renderCompleteBar(): void {
    if (!this.actionsBarEl) return;
    this.actionsBarEl.empty();
    const exitBtn = this.actionsBarEl.createEl("button", {
      cls: "annotation-btn annotation-btn-primary",
      text: t().cardReviewExit,
    });
    exitBtn.addEventListener("click", () => this.exit());
  }

  private prev(): void {
    if (this.cursor > 0) {
      this.cursor--;
      this.renderCurrentCard();
    }
  }

  private next(): void {
    if (this.cursor < this.queue.length - 1) {
      this.cursor++;
      this.renderCurrentCard();
    } else {
      // 已是最后一张,展示统计
      this.renderComplete();
    }
  }

  // 标记"记住":归档(archived=true)并前进;以最后一次标记为准
  private async markRemember(): Promise<void> {
    const card = this.queue[this.cursor];
    if (!card) return;
    try {
      await this.fileManager.updateAnnotation(card.notePath, card.annotation.id, {
        archived: true,
        lastReviewedAt: Date.now(),
      });
      // 本地缓存更新
      card.annotation.archived = true;
      this.rememberedKeys.add(this.keyOf(card));
      this.updateFilterBtns();
      this.options.onCardUpdated?.(card);
      new Notice(t().cardNoticeArchived, 1000);
    } catch (e) {
      console.error("归档保存失败:", e);
    }
    this.next();
  }

  // 标记"忘记":复习计数+1,清除"记住"标记(含持久化 archived=false)并前进
  private async markForget(): Promise<void> {
    const card = this.queue[this.cursor];
    if (!card) return;
    const newCount = (card.annotation.reviewCount ?? 0) + 1;
    const now = Date.now();
    const wasRemembered = this.rememberedKeys.has(this.keyOf(card));
    try {
      await this.fileManager.updateAnnotation(card.notePath, card.annotation.id, {
        reviewCount: newCount,
        lastReviewedAt: now,
        // 曾标记"记住"的卡片改标"忘记"时,同步撤销归档
        ...(wasRemembered ? { archived: false } : {}),
      });
      // 本地缓存更新,避免下次渲染读到旧值
      card.annotation.reviewCount = newCount;
      card.annotation.lastReviewedAt = now;
      if (wasRemembered) {
        card.annotation.archived = false;
        this.rememberedKeys.delete(this.keyOf(card));
        this.updateFilterBtns();
      }
      this.forgetClicks++;
      this.options.onCardUpdated?.(card);
      new Notice(t().cardNoticeReviewSaved, 1000);
    } catch (e) {
      console.error("复习计数保存失败:", e);
    }
    this.next();
  }

  private renderComplete(): void {
    if (!this.contentEl || !this.progressEl) return;
    this.contentEl.empty();
    const loc = t();
    this.progressEl.textContent = loc.cardReviewProgress(this.queue.length, this.queue.length);

    const total = this.shuffled.length;
    const remembered = this.rememberedKeys.size;
    const forgotten = total - remembered;

    const summary = this.contentEl.createDiv({ cls: "annocard-review-complete" });
    summary.createDiv({
      cls: "annocard-review-stat",
      text: loc.cardReviewStat(total, remembered, forgotten),
    });

    // 底部固定栏放退出按钮
    this.renderCompleteBar();
  }

  exit(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
    this.contentEl = null;
    this.progressEl = null;
    this.actionsBarEl = null;
    this.options.onExit?.();
  }
}
