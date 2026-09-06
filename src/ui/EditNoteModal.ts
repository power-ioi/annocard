import { App, Modal } from "obsidian";
import type { AnnotationColor, AnnotationPluginSettings } from "../types";
import { t } from "../i18n";

// 编辑批注的模态框
export class EditNoteModal extends Modal {
  private currentNote: string;
  private currentColor: AnnotationColor;
  private getSettings: () => AnnotationPluginSettings;
  private onSave: (note: string, color: AnnotationColor) => void | Promise<void>;

  private noteInput: HTMLTextAreaElement | null = null;

  constructor(
    app: App,
    getSettings: () => AnnotationPluginSettings,
    params: {
      note: string;
      color: AnnotationColor;
    },
    onSave: (note: string, color: AnnotationColor) => void | Promise<void>
  ) {
    super(app);
    this.getSettings = getSettings;
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
