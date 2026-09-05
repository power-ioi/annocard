import { App, TFile, normalizePath } from "obsidian";
import type { NewAnnotation, ParsedAnnotation, AnnotationUpdates } from "../types";
import { notePathToAnnotationPath, annotationPathToNotePath } from "../utils/helpers";
import { parseAnnotations, stripAnnotationTags } from "./annotationParser";
import { insertAnnotation, insertFullTextAnnotation, insertCrossBlockAnnotation, removeAnnotationTag, updateAnnotationTag } from "./annotationSerializer";
import { diffSync } from "./diffSync";

export class AnnotationFileManager {
  private app: App;
  private pluginDir: string;

  constructor(app: App, pluginDir: string) {
    this.app = app;
    this.pluginDir = pluginDir;
  }

  // 获取标注文件路径
  getAnnotationFilePath(notePath: string): string {
    return notePathToAnnotationPath(this.pluginDir, notePath);
  }

  // 检查标注文件是否存在
  async hasAnnotationFile(notePath: string): Promise<boolean> {
    const path = normalizePath(this.getAnnotationFilePath(notePath));
    return this.app.vault.adapter.exists(path);
  }

  // 确保标注文件存在（不存在则从原文件复制创建）
  async ensureAnnotationFile(notePath: string): Promise<boolean> {
    try {
      const annotationPath = normalizePath(this.getAnnotationFilePath(notePath));

      if (await this.app.vault.adapter.exists(annotationPath)) {
        await this.syncFromOriginal(notePath);
        return true;
      }

      // 读取原文件内容
      const originalFile = this.app.vault.getAbstractFileByPath(notePath);
      if (!(originalFile instanceof TFile)) return false;
      const content = await this.app.vault.read(originalFile);

      // 确保目录存在
      const dir = annotationPath.substring(0, annotationPath.lastIndexOf("/"));
      if (dir && !(await this.app.vault.adapter.exists(dir))) {
        await this.app.vault.adapter.mkdir(dir);
      }

      await this.app.vault.adapter.write(annotationPath, content);
      return true;
    } catch (e) {
      console.error("创建标注文件失败:", notePath, e);
      return false;
    }
  }

  // 读取标注文件内容
  async readAnnotationFile(notePath: string): Promise<string> {
    const annotationPath = normalizePath(this.getAnnotationFilePath(notePath));
    return this.app.vault.adapter.read(annotationPath);
  }

  // 写入标注文件内容
  async writeAnnotationFile(notePath: string, content: string): Promise<void> {
    const annotationPath = normalizePath(this.getAnnotationFilePath(notePath));
    await this.app.vault.adapter.write(annotationPath, content);
  }

  // 同步原文件更新到标注文件
  async syncFromOriginal(notePath: string): Promise<void> {
    try {
      const file = this.app.vault.getAbstractFileByPath(notePath);
      if (!(file instanceof TFile)) return;

      const originalContent = await this.app.vault.read(file);
      const annotatedContent = await this.readAnnotationFile(notePath);

      const result = diffSync(originalContent, annotatedContent);
      if (result.changed) {
        await this.writeAnnotationFile(notePath, result.content);
      }
    } catch (e) {
      console.error("同步标注文件失败:", notePath, e);
    }
  }

  // 同步标注文件编辑回原文件。
  // 写回前先把原文件的外部变更（分屏编辑/同步盘等在会话期间发生的修改）
  // 经 diffSync 合并进标注文件，再剥离标注标签写回——双向核对，
  // 避免直接用标注文件内容全文覆盖掉外部修改
  async syncToOriginal(notePath: string): Promise<void> {
    try {
      const file = this.app.vault.getAbstractFileByPath(notePath);
      if (!(file instanceof TFile)) return;

      await this.syncFromOriginal(notePath);

      const annotatedContent = await this.readAnnotationFile(notePath);
      const pureContent = stripAnnotationTags(annotatedContent);

      const currentContent = await this.app.vault.read(file);
      if (currentContent !== pureContent) {
        await this.app.vault.modify(file, pureContent);
      }
    } catch (e) {
      console.error("同步回原文件失败:", notePath, e);
    }
  }

  // 文件重命名时迁移标注文件
  async migrateAnnotationFile(oldPath: string, newPath: string): Promise<void> {
    const oldAnnotationPath = normalizePath(this.getAnnotationFilePath(oldPath));
    if (!(await this.app.vault.adapter.exists(oldAnnotationPath))) return;

    const content = await this.app.vault.adapter.read(oldAnnotationPath);

    const newAnnotationPath = normalizePath(this.getAnnotationFilePath(newPath));
    const dir = newAnnotationPath.substring(0, newAnnotationPath.lastIndexOf("/"));
    if (dir && !(await this.app.vault.adapter.exists(dir))) {
      await this.app.vault.adapter.mkdir(dir);
    }

    await this.app.vault.adapter.write(newAnnotationPath, content);
    await this.app.vault.adapter.remove(oldAnnotationPath);

    await this.cleanupEmptyDirs(oldAnnotationPath);
  }

  // 文件删除时清理标注文件
  async deleteAnnotationFile(notePath: string): Promise<void> {
    const annotationPath = normalizePath(this.getAnnotationFilePath(notePath));
    if (await this.app.vault.adapter.exists(annotationPath)) {
      await this.app.vault.adapter.remove(annotationPath);
      await this.cleanupEmptyDirs(annotationPath);
    }
  }

  // 清理空的父目录
  private async cleanupEmptyDirs(filePath: string): Promise<void> {
    const annotationsDir = normalizePath(`${this.pluginDir}/annotations`);
    let dir = filePath.substring(0, filePath.lastIndexOf("/"));

    while (dir.length > annotationsDir.length) {
      if (!(await this.app.vault.adapter.exists(dir))) break;
      const listed = await this.app.vault.adapter.list(dir);
      if (listed.files.length > 0 || listed.folders.length > 0) break;
      await this.app.vault.adapter.rmdir(dir, false);
      dir = dir.substring(0, dir.lastIndexOf("/"));
    }
  }

  // 解析标注文件中的所有标注
  async getAnnotations(notePath: string): Promise<ParsedAnnotation[]> {
    try {
      const content = await this.readAnnotationFile(notePath);
      return parseAnnotations(content);
    } catch (e) {
      console.error("解析标注失败:", notePath, e);
      return [];
    }
  }

  // 添加标注
  async addAnnotation(notePath: string, annotation: NewAnnotation): Promise<ParsedAnnotation> {
    const content = await this.readAnnotationFile(notePath);
    const { content: newContent, id } = insertAnnotation(content, annotation);
    await this.writeAnnotationFile(notePath, newContent);

    const result = parseAnnotations(newContent).find((a) => a.id === id);
    return result!;
  }

  // 添加全文标注（所有匹配位置共享同一 ID）
  async addFullTextAnnotation(notePath: string, annotation: NewAnnotation): Promise<ParsedAnnotation | null> {
    const content = await this.readAnnotationFile(notePath);
    const result = insertFullTextAnnotation(content, annotation);
    if (result.count === 0) return null;
    await this.writeAnnotationFile(notePath, result.content);

    const annotations = parseAnnotations(result.content);
    return annotations.find(a => a.id === result.id) ?? null;
  }

  // 添加跨段标注（多个文本块分别插入同 ID 的 <mark> 标签）
  async addCrossBlockAnnotation(notePath: string, annotation: NewAnnotation): Promise<ParsedAnnotation | null> {
    const content = await this.readAnnotationFile(notePath);
    const result = insertCrossBlockAnnotation(content, annotation);
    if (result.blockCount === 0) return null;
    await this.writeAnnotationFile(notePath, result.content);

    const annotations = parseAnnotations(result.content);
    return annotations.find(a => a.id === result.id) ?? null;
  }

  // 删除标注
  async removeAnnotation(notePath: string, annotationId: string): Promise<void> {
    const content = await this.readAnnotationFile(notePath);
    const newContent = removeAnnotationTag(content, annotationId);
    await this.writeAnnotationFile(notePath, newContent);
  }

  // 更新标注
  async updateAnnotation(
    notePath: string,
    annotationId: string,
    updates: AnnotationUpdates
  ): Promise<void> {
    const content = await this.readAnnotationFile(notePath);
    const newContent = updateAnnotationTag(content, annotationId, updates);
    await this.writeAnnotationFile(notePath, newContent);
  }

  // ========== AnnoCard 卡片化管理新增 API ==========

  // 遍历所有标注文件，汇总返回全库标注（供卡片侧边栏"全库"模式用）
  // 返回值每条含 notePath，便于卡片层跳转与回写
  async getAllAnnotations(): Promise<Array<{ annotation: ParsedAnnotation; notePath: string }>> {
    const annotationsDir = normalizePath(`${this.pluginDir}/annotations`);
    const exists = await this.app.vault.adapter.exists(annotationsDir);
    if (!exists) return [];

    const listed = await this.app.vault.adapter.list(annotationsDir);
    const mdFiles = listed.files.filter((f) => f.endsWith(".md"));
    const results: Array<{ annotation: ParsedAnnotation; notePath: string }> = [];

    // 并行读取（限流 8 并发，与 AnnotationSidebarView.loadAllAnnotations 一致）
    const CONCURRENCY = 8;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < mdFiles.length) {
        const filePath = mdFiles[cursor++]!;
        try {
          const notePath = annotationPathToNotePath(this.pluginDir, filePath);
          const annotations = await this.getAnnotations(notePath);
          for (const annotation of annotations) {
            results.push({ annotation, notePath });
          }
        } catch {
          // 跳过损坏文件
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, mdFiles.length) }, worker));
    return results;
  }

  // 单文件标注（供卡片侧边栏"当前文件"模式用）
  // 包装 getAnnotations，返回带 notePath 的结构，与 getAllAnnotations 形态一致
  async getAnnotationsByFile(notePath: string): Promise<Array<{ annotation: ParsedAnnotation; notePath: string }>> {
    const hasFile = await this.hasAnnotationFile(notePath);
    if (!hasFile) return [];
    const annotations = await this.getAnnotations(notePath);
    return annotations.map((annotation) => ({ annotation, notePath }));
  }

  // 查找指定标注 ID 所在的笔记路径（全库扫描，O(标注文件数)）
  // 用于卡片层仅持有 id 时定位回写文件（如批量删除/复习计数）
  async findAnnotationNotePath(annotationId: string): Promise<string | null> {
    const all = await this.getAllAnnotations();
    const found = all.find((item) => item.annotation.id === annotationId);
    return found ? found.notePath : null;
  }

  // 按 ID 更新单条标注（跨文件）：先定位 notePath 再回写
  // 卡片层编辑批注/打标签/归档/复习计数时调用
  async updateAnnotationById(annotationId: string, updates: AnnotationUpdates): Promise<boolean> {
    const notePath = await this.findAnnotationNotePath(annotationId);
    if (!notePath) return false;
    await this.updateAnnotation(notePath, annotationId, updates);
    return true;
  }

  // 按 ID 批量删除标注（跨文件）
  // 先扫描定位每个 id 所在文件，按 notePath 分组后逐文件 removeAnnotationTag
  async deleteAnnotations(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    // 收集 id → notePath 映射（一次全库扫描，避免多次扫描）
    const all = await this.getAllAnnotations();
    const idToNotePath = new Map<string, string>();
    for (const { annotation, notePath } of all) {
      if (ids.includes(annotation.id)) {
        idToNotePath.set(annotation.id, notePath);
      }
    }

    // 按 notePath 分组
    const byNotePath = new Map<string, string[]>();
    for (const id of ids) {
      const notePath = idToNotePath.get(id);
      if (!notePath) continue; // 找不到则跳过（可能已被删）
      let arr = byNotePath.get(notePath);
      if (!arr) {
        arr = [];
        byNotePath.set(notePath, arr);
      }
      arr.push(id);
    }

    // 逐文件批量删除：读一次，循环剥离所有目标 id 标签，写一次
    for (const [notePath, idList] of byNotePath) {
      try {
        let content = await this.readAnnotationFile(notePath);
        for (const id of idList) {
          content = removeAnnotationTag(content, id);
        }
        await this.writeAnnotationFile(notePath, content);
      } catch (e) {
        console.error("批量删除标注失败:", notePath, e);
      }
    }
  }
}
