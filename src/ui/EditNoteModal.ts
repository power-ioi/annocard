import { App, Modal, Notice } from "obsidian";
import type { AnnotationColor, AnnotationPluginSettings } from "../types";
import { COLOR_CLASSES, getActiveColors } from "../constants";
import { t } from "../i18n";

// 编辑批注的模态框
export class EditNoteModal extends Modal {
  private annotationText: string;
  private currentNote: string;
  private currentColor: AnnotationColor;
  private getSettings: () => AnnotationPluginSettings;
  private onSave: (note: string, color: AnnotationColor) => void | Promise<void>;

  private noteInput: HTMLTextAreaElement | null = null;

  constructor(
    app: App,
    getSettings: () => AnnotationPluginSettings,
    params: {
      text: string;
      note: string;
      color: AnnotationColor;
    },
    onSave: (note: string, color: AnnotationColor) => void | Promise<void>
  ) {
    super(app);
    this.getSettings = getSettings;
    this.annotationText = params.text;
    this.currentNote = params.note;
    this.currentColor = params.color;
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    const settings = this.getSettings();
    const maxLen = settings.maxNoteLength;
    const loc = t();
    contentEl.addClass("annotation-note-modal");

    this.containerEl.addEventListener("mousedown", (e) => e.stopPropagation());
    this.containerEl.addEventListener("mouseup", (e) => e.stopPropagation());
    this.containerEl.addEventListener("focusin", (e) => e.stopPropagation());

    contentEl.createEl("h3", { text: this.currentNote ? loc.modalEditNote : loc.modalAddNote });

    const previewEl = contentEl.createDiv({ cls: "annotation-modal-preview" });
    const previewHeader = previewEl.createDiv({ cls: "annotation-modal-preview-header" });
    previewHeader.createEl("strong", { text: loc.modalAnnotationText });
    const copyBtn = previewHeader.createEl("button", {
      cls: "annotation-copy-btn",
      text: loc.copy,
    });
    copyBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.annotationText).then(() => {
        copyBtn.textContent = loc.copied;
        window.setTimeout(() => { copyBtn.textContent = loc.copy; }, 1500);
      }).catch(() => { /* 剪贴板写入失败时忽略 */ });
    });
    const previewText = this.annotationText.length > 200
      ? this.annotationText.substring(0, 200) + "..."
      : this.annotationText;
    previewEl.createSpan({ text: previewText, cls: "annotation-modal-preview-text" });

    // 颜色选择
    const colorContainer = contentEl.createDiv({ cls: "annotation-color-picker" });
    colorContainer.createEl("label", { text: loc.modalAnnotationColor });

    const settingsMap = settings as unknown as Record<string, unknown>;
    const colors: AnnotationColor[] = getActiveColors(settings);
    for (const c of colors) {
      const btn = colorContainer.createEl("button", { cls: `annotation-color-dot ${COLOR_CLASSES[c]}` });
      const colorLabel = typeof settingsMap[`colorLabel${c}`] === "string"
        ? (settingsMap[`colorLabel${c}`] as string)
        : loc.colorLabel(c);
      btn.title = c === "none" ? loc.none : colorLabel;
      if (c === this.currentColor) btn.addClass("active");
      btn.addEventListener("click", () => {
        colorContainer.querySelectorAll(".annotation-color-dot")
          .forEach((b) => b.removeClass("active"));
        btn.addClass("active");
        this.currentColor = c;
      });
    }

    const noteContainer = contentEl.createDiv({ cls: "annotation-note-container" });
    noteContainer.createEl("label", { text: loc.modalNoteLabel(maxLen) });
    this.noteInput = noteContainer.createEl("textarea", { cls: "annotation-note-input" });
    this.noteInput.setAttribute("maxlength", String(maxLen));
    this.noteInput.setAttribute("rows", "4");
    this.noteInput.setAttribute("placeholder", loc.modalNotePlaceholder);
    this.noteInput.value = this.currentNote;

    const charCount = noteContainer.createDiv({
      cls: "annotation-char-count",
      text: loc.charCount(this.currentNote.length, maxLen),
    });
    this.noteInput.addEventListener("input", () => {
      const len = this.noteInput?.value.length ?? 0;
      charCount.textContent = loc.charCount(len, maxLen);
      charCount.toggleClass("annotation-char-count-error", len > maxLen);
    });


    const buttonContainer = contentEl.createDiv({ cls: "annotation-modal-buttons" });
    buttonContainer.createEl("button", {
      text: loc.cancel,
      cls: "annotation-btn annotation-btn-secondary",
    }).addEventListener("click", () => this.close());

    buttonContainer.createEl("button", {
      text: loc.save,
      cls: "annotation-btn annotation-btn-primary",
    }).addEventListener("click", () => {
      const note = this.noteInput?.value ?? "";
      void this.onSave(note, this.currentColor);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
