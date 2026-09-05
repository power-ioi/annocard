// AnnoCard 复习模式
// 全屏 overlay 展示当前筛选条件下的未归档标注,逐张过卡
// 操作:再来一次(reviewCount++, lastReviewedAt=now) / 已掌握(archived=true) / 上下张 / 退出
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

export class ReviewMode {
  private fileManager: AnnotationFileManager;
  private cards: AnnotationCardData[];
  private options: ReviewModeOptions;

  // 洗牌后的复习序列
  private shuffled: AnnotationCardData[] = [];
  // 当前指针
  private cursor = 0;
  // 已掌握的卡片数(archived 在复习期间被设置)
  private masteredCount = 0;
  // 已点击"再来一次"的卡片数
  private againCount = 0;

  // overlay DOM 根元素
  private overlayEl: HTMLElement | null = null;
  // 内容容器(每次切换卡片时 empty 重填)
  private contentEl: HTMLElement | null = null;
  // 进度条
  private progressEl: HTMLElement | null = null;

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

  private createOverlay(): void {
    const root = activeDocument.body;
    this.overlayEl = root.createDiv({ cls: "annocard-review-overlay" });

    // 头部:标题 + 进度 + 退出
    const header = this.overlayEl.createDiv({ cls: "annocard-review-header" });
    header.createSpan({ cls: "annocard-review-title", text: t().cardReviewStart });
    this.progressEl = header.createSpan({ cls: "annocard-review-progress" });
    const exitBtn = header.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annocard-review-exit",
      text: t().cardReviewExit,
    });
    exitBtn.addEventListener("click", () => this.exit());

    // 内容容器
    this.contentEl = this.overlayEl.createDiv({ cls: "annocard-review-content" });

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

  private renderCurrentCard(): void {
    if (!this.contentEl || !this.progressEl || !this.overlayEl) return;
    this.contentEl.empty();

    const card = this.shuffled[this.cursor];
    if (!card) {
      this.renderComplete();
      return;
    }

    const { annotation, fileName } = card;
    const loc = t();

    // 进度
    this.progressEl.textContent = loc.cardReviewProgress(this.cursor + 1, this.shuffled.length);

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

    // 操作按钮
    const actions = cardEl.createDiv({ cls: "annocard-review-actions" });

    // 上一张
    const prevBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary",
      text: loc.cardReviewPrev,
    });
    prevBtn.disabled = this.cursor === 0;
    prevBtn.addEventListener("click", () => this.prev());

    // 再来一次(reviewCount++)
    const againBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary annocard-review-again",
      text: loc.cardReviewAgain,
    });
    againBtn.addEventListener("click", () => void this.markAgain());

    // 已掌握(archived=true)
    const masteredBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-primary annocard-review-mastered",
      text: loc.cardReviewMastered,
    });
    masteredBtn.addEventListener("click", () => void this.markMastered());

    // 下一张
    const nextBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary",
      text: loc.cardReviewNext,
    });
    nextBtn.disabled = this.cursor === this.shuffled.length - 1;
    nextBtn.addEventListener("click", () => this.next());

    // 键盘快捷键
    const keyHandler = (e: KeyboardEvent) => {
      if (this.isClosed) {
        activeDocument.removeEventListener("keydown", keyHandler);
        return;
      }
      if (e.key === "ArrowLeft" && this.cursor > 0) {
        e.preventDefault();
        this.prev();
      } else if (e.key === "ArrowRight" && this.cursor < this.shuffled.length - 1) {
        e.preventDefault();
        this.next();
      } else if (e.key === "1") {
        e.preventDefault();
        void this.markAgain();
      } else if (e.key === "2") {
        e.preventDefault();
        void this.markMastered();
      }
    };
    activeDocument.addEventListener("keydown", keyHandler);
  }

  private prev(): void {
    if (this.cursor > 0) {
      this.cursor--;
      this.renderCurrentCard();
    }
  }

  private next(): void {
    if (this.cursor < this.shuffled.length - 1) {
      this.cursor++;
      this.renderCurrentCard();
    } else {
      // 已是最后一张,展示统计
      this.renderComplete();
    }
  }

  private async markAgain(): Promise<void> {
    const card = this.shuffled[this.cursor];
    if (!card) return;
    const newCount = (card.annotation.reviewCount ?? 0) + 1;
    const now = Date.now();
    try {
      await this.fileManager.updateAnnotation(card.notePath, card.annotation.id, {
        reviewCount: newCount,
        lastReviewedAt: now,
      });
      // 本地缓存更新,避免下次渲染读到旧值
      card.annotation.reviewCount = newCount;
      card.annotation.lastReviewedAt = now;
      this.againCount++;
      this.options.onCardUpdated?.(card);
      new Notice(t().cardNoticeReviewSaved, 1000);
    } catch (e) {
      console.error("复习计数保存失败:", e);
    }
    this.next();
  }

  private async markMastered(): Promise<void> {
    const card = this.shuffled[this.cursor];
    if (!card) return;
    try {
      await this.fileManager.updateAnnotation(card.notePath, card.annotation.id, {
        archived: true,
        lastReviewedAt: Date.now(),
      });
      // 本地缓存更新
      card.annotation.archived = true;
      this.masteredCount++;
      this.options.onCardUpdated?.(card);
      new Notice(t().cardNoticeArchived, 1000);
    } catch (e) {
      console.error("归档保存失败:", e);
    }
    this.next();
  }

  private renderComplete(): void {
    if (!this.contentEl || !this.progressEl) return;
    this.contentEl.empty();
    const loc = t();
    this.progressEl.textContent = loc.cardReviewProgress(this.shuffled.length, this.shuffled.length);

    const summary = this.contentEl.createDiv({ cls: "annocard-review-complete" });
    summary.createDiv({
      cls: "annocard-review-stat",
      text: loc.cardReviewStat(this.shuffled.length, this.masteredCount),
    });

    if (this.againCount > 0) {
      summary.createDiv({
        cls: "annocard-review-again-count",
        text: `${loc.cardReviewAgain}: ${this.againCount}`,
      });
    }

    const actions = summary.createDiv({ cls: "annocard-review-actions" });
    const exitBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-primary",
      text: loc.cardReviewExit,
    });
    exitBtn.addEventListener("click", () => this.exit());
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
    this.options.onExit?.();
  }
}
