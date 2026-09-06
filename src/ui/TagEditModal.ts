import { Modal, type App } from "obsidian";
import { t } from "../i18n";

// 编辑标签的小弹窗:单个输入框,标签以逗号/顿号/分号/空格分隔,保存时去重去空
export class TagEditModal extends Modal {
  private initialTags: string[];
  private onSave: (tags: string[]) => void;
  private inputEl: HTMLInputElement | null = null;

  constructor(app: App, initialTags: string[], onSave: (tags: string[]) => void) {
    super(app);
    this.initialTags = initialTags;
    this.onSave = onSave;
  }

  onOpen(): void {
    this.contentEl.empty();
    const loc = t();
    this.contentEl.createEl("h3", { text: loc.tagEditTitle });
    const row = this.contentEl.createDiv({ cls: "annocard-tag-edit-row" });
    this.inputEl = row.createEl("input", {
      cls: "annocard-tag-edit-input",
      type: "text",
      placeholder: loc.cardTagAddPlaceholder,
    });
    this.inputEl.value = this.initialTags.join(", ");
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      }
    });
    const actions = this.contentEl.createDiv({ cls: "annocard-tag-edit-actions" });
    const cancelBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-secondary",
      text: loc.cancel,
    });
    cancelBtn.addEventListener("click", () => this.close());
    const saveBtn = actions.createEl("button", {
      cls: "annotation-btn annotation-btn-primary mod-cta",
      text: loc.save,
    });
    saveBtn.addEventListener("click", () => this.submit());
    window.setTimeout(() => this.inputEl?.focus(), 50);
  }

  private submit(): void {
    const raw = this.inputEl?.value ?? "";
    const tags = Array.from(
      new Set(raw.split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean))
    );
    this.close();
    this.onSave(tags);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
