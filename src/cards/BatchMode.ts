// AnnoCard 批量模式操作
// 封装批量删除 / 批量打标签 的核心逻辑,UI 工具栏由 AnnotationSidebarView 渲染
// 调用 AnnotationFileManager 的 API(跨文件分组),不直接读写文件

import { App, Modal, Notice } from "obsidian";
import type { AnnotationFileManager } from "../annotationFile/AnnotationFileManager";
import type { AnnotationCardData } from "../sidebar/AnnotationCard";
import { t } from "../i18n";
import { ConfirmOverwriteModal } from "../ui/ExportModal";

/**
 * 批量删除给定卡片集合对应的标注
 * 弹确认窗 → 按 notePath 分组调用 removeAnnotation → 提示
 * 返回实际删除的条数
 */
export async function batchDeleteAnnotations(
  app: App,
  fileManager: AnnotationFileManager,
  cards: AnnotationCardData[]
): Promise<number> {
  if (cards.length === 0) {
    new Notice(t().cardNoticeNoSelection);
    return 0;
  }

  const idList = cards.map((c) => c.annotation.id);
  // 复用 AnnotationFileManager.deleteAnnotations(它内部按全库扫描定位 id 并按 notePath 分组,
  // 这里卡片已知 notePath,但 deleteAnnotations 内部仍可处理;一致性 > 微小性能差异)
  await fileManager.deleteAnnotations(idList);

  new Notice(t().cardNoticeBatchDeleted(cards.length));
  return cards.length;
}

/**
 * 弹出确认窗 → 调用 batchDeleteAnnotations
 * 使用 ConfirmOverwriteModal 复用其双按钮设计(标题/内容/确认回调)
 */
export function confirmBatchDelete(
  app: App,
  fileManager: AnnotationFileManager,
  cards: AnnotationCardData[],
  onDone: () => void
): void {
  if (cards.length === 0) {
    new Notice(t().cardNoticeNoSelection);
    return;
  }
  new ConfirmOverwriteModal(
    app,
    t().cardConfirmBatchDelete(cards.length),
    async () => {
      await batchDeleteAnnotations(app, fileManager, cards);
      onDone();
    },
    t().delete
  ).open();
}

/**
 * 批量给选中标注追加标签(union,与已有标签合并去重)
 */
export async function batchAddTags(
  fileManager: AnnotationFileManager,
  cards: AnnotationCardData[],
  tags: string[]
): Promise<number> {
  if (cards.length === 0) {
    new Notice(t().cardNoticeNoSelection);
    return 0;
  }
  if (tags.length === 0) return 0;

  let updated = 0;
  for (const card of cards) {
    try {
      const existing = card.annotation.tags ?? [];
      const merged = Array.from(new Set([...existing, ...tags]));
      await fileManager.updateAnnotation(card.notePath, card.annotation.id, { tags: merged });
      updated++;
    } catch (e) {
      console.error("批量打标签失败:", card.annotation.id, e);
    }
  }

  new Notice(t().cardNoticeBatchTagged(updated));
  return updated;
}

/**
 * 弹出标签输入模态框(支持多标签,逗号或空格分隔)
 * 确认后调用 onConfirm(tags)
 */
export class BatchTagInputModal extends Modal {
  private onConfirm: (tags: string[]) => void;
  private inputEl!: HTMLInputElement;

  constructor(
    app: App,
    onConfirm: (tags: string[]) => void
  ) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    titleEl.setText(t().cardTagAddToSelected);

    contentEl.createEl("p", {
      cls: "annocard-modal-desc",
      text: t().cardTagAddPlaceholder,
    });

    this.inputEl = contentEl.createEl("input", {
      type: "text",
      cls: "annocard-modal-input",
    });
    this.inputEl.setAttribute("placeholder", t().cardTagAddPlaceholder);

    const btnRow = contentEl.createDiv({ cls: "annocard-modal-button-row" });
    const confirmBtn = btnRow.createEl("button", {
      cls: "annotation-btn annotation-btn-primary",
      text: t().cardTagAddConfirm,
    });
    const cancelBtn = btnRow.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary",
      text: t().cancel,
    });

    const submit = () => {
      const raw = this.inputEl.value.trim();
      if (!raw) {
        this.close();
        return;
      }
      // 逗号或空格分隔,去空、去重
      const tags = Array.from(new Set(
        raw.split(/[,，\s]+/).map((s) => s.trim()).filter((s) => s.length > 0)
      ));
      this.onConfirm(tags);
      this.close();
    };

    confirmBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", () => this.close());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    // 焦点
    window.setTimeout(() => this.inputEl.focus(), 50);
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
