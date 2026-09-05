import type { ParsedAnnotation } from "../types";
import { COLOR_CLASSES } from "../constants";
import { t } from "../i18n";

// 侧边栏卡片数据
export interface AnnotationCardData {
  annotation: ParsedAnnotation;
  notePath: string;   // 所属笔记路径
  fileName: string;   // 笔记文件名
}

// 卡片渲染选项:Phase ④ 的批量模式与内联编辑通过此参数控制
export interface AnnotationCardOptions {
  // 批量模式下卡片显示复选框
  batchMode?: boolean;
  // 当前是否选中(批量模式)
  selected?: boolean;
  // 切换选中(批量模式)
  onToggleSelect?: (cardData: AnnotationCardData, selected: boolean) => void;
  // 内联编辑批注(Pencil 按钮)
  onEditNote?: (cardData: AnnotationCardData, noteEl: HTMLElement) => void;
  // 添加标签(标签区 + 按钮)
  onAddTag?: (cardData: AnnotationCardData, tagInputEl: HTMLElement) => void;
  // 删除单个标签(点击已有标签 ×)
  onRemoveTag?: (cardData: AnnotationCardData, tag: string) => void;
}

// 创建单个标注卡片
export function createAnnotationCard(
  parent: HTMLElement,
  cardData: AnnotationCardData,
  handlers: {
    onClick: (cardData: AnnotationCardData) => void;
    onOpen: (cardData: AnnotationCardData) => void;
    onDelete: (cardData: AnnotationCardData) => void;
  },
  options?: AnnotationCardOptions
): HTMLElement {
  const { annotation, fileName } = cardData;
  const loc = t();

  const card = parent.createDiv({ cls: "annotation-sidebar-card" });
  if (options?.batchMode) card.addClass("annocard-card-batch");
  if (options?.selected) card.addClass("annocard-card-selected");
  if (annotation.archived) card.addClass("annocard-card-archived");

  // 批量模式复选框(左上角)
  if (options?.batchMode) {
    const checkbox = card.createEl("input", {
      type: "checkbox",
      cls: "annocard-card-checkbox",
    });
    checkbox.checked = !!options.selected;
    checkbox.addEventListener("click", (e) => e.stopPropagation());
    checkbox.addEventListener("change", () => {
      options.onToggleSelect?.(cardData, checkbox.checked);
    });
  }

  // 卡片头部：颜色圆点 + 徽章 + 时间 + 文件名
  const header = card.createDiv({ cls: "annotation-sidebar-card-header" });
  header.createSpan({ cls: `annotation-list-dot ${COLOR_CLASSES[annotation.color]}` });

  // 全文/跨段标记
  if (annotation.isFullText && annotation.positions.length > 1) {
    const badge = header.createSpan({ cls: "annotation-list-badge" });
    badge.textContent = loc.fullTextBadge(annotation.positions.length);
  } else if (annotation.isCrossBlock) {
    const badge = header.createSpan({ cls: "annotation-list-badge" });
    badge.textContent = loc.crossBlockBadge(annotation.positions.length);
  }

  // 已归档徽章
  if (annotation.archived) {
    const archivedBadge = header.createSpan({ cls: "annocard-badge-archived" });
    archivedBadge.textContent = t().cardArchived;
  }

  // 创建时间
  const date = new Date(parseInt(annotation.id));
  if (!isNaN(date.getTime())) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const timeStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    header.createSpan({ cls: "annotation-sidebar-card-time", text: timeStr });
  }

  // 复习次数(>0 时显示)
  if (annotation.reviewCount > 0) {
    header.createSpan({
      cls: "annocard-badge-review",
      text: t().cardReviewCount(annotation.reviewCount),
    });
  }

  // 文件名
  header.createSpan({
    cls: "annotation-sidebar-card-filename",
    text: fileName,
  });

  // 标注文字
  const textEl = card.createDiv({ cls: "annotation-sidebar-card-text" });
  const previewText = annotation.text.length > 80
    ? annotation.text.substring(0, 80) + "..."
    : annotation.text;
  textEl.textContent = previewText;

  // 批注内容
  let noteEl: HTMLElement | null = null;
  if (annotation.note) {
    noteEl = card.createDiv({ cls: "annotation-sidebar-card-note" });
    const noteText = annotation.note.length > 100
      ? annotation.note.substring(0, 100) + "..."
      : annotation.note;
    noteEl.textContent = noteText;
  }

  // 标签 chips
  const tags = annotation.tags ?? [];
  if (tags.length > 0 || options?.onAddTag) {
    const tagsEl = card.createDiv({ cls: "annocard-card-tags" });
    for (const tag of tags) {
      const chip = tagsEl.createSpan({ cls: "annocard-tag-chip" });
      chip.createSpan({ cls: "annocard-tag-chip-text", text: tag });
      if (options?.onRemoveTag) {
        const remove = chip.createSpan({ cls: "annocard-tag-chip-x", text: "×" });
        remove.addEventListener("click", (e) => {
          e.stopPropagation();
          options.onRemoveTag!(cardData, tag);
        });
      }
    }
    if (options?.onAddTag) {
      const addBtn = tagsEl.createSpan({ cls: "annocard-tag-chip-add", text: "+" });
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        options.onAddTag!(cardData, tagsEl);
      });
    }
  }

  // 操作按钮
  const actions = card.createDiv({ cls: "annotation-sidebar-card-actions" });

  // 内联编辑批注按钮(Phase ④)
  if (options?.onEditNote && noteEl) {
    const editBtn = actions.createEl("button", {
      text: t().cardEdit,
      cls: "annotation-btn annotation-btn-secondary annocard-card-edit-btn",
    });
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      options.onEditNote!(cardData, noteEl!);
    });
  }

  const openBtn = actions.createEl("button", {
    text: loc.cardOpen,
    cls: "annotation-btn annotation-btn-secondary",
  });
  const deleteBtn = actions.createEl("button", {
    text: loc.cardDelete,
    cls: "annotation-btn annotation-btn-danger",
  });

  // 事件绑定
  card.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if ((e.target as HTMLElement).closest(".annocard-tag-chip-x")) return;
    if ((e.target as HTMLElement).closest(".annocard-tag-chip-add")) return;
    if ((e.target as HTMLElement).closest(".annocard-card-checkbox")) return;
    handlers.onClick(cardData);
  });
  openBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onOpen(cardData);
  });
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onDelete(cardData);
  });

  return card;
}

