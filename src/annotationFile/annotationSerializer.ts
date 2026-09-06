import type { AnnotationColor, NewAnnotation } from "../types";
import { COLOR_BG_VARS, COLOR_ACCENT_VARS } from "../constants";
import { generateId, encodeAttr } from "../utils/helpers";
import { findTextInSource, buildCleanedMap, expandToWikiLinks, findExcludedRanges } from "../utils/contentMapper";
import { computeSegments, buildSegmentHtml, buildCardAttrs, type Interval } from "../utils/overlapUtils";

// 选中了 wiki-link 内部分文字时抛出
export class PartialWikiLinkError extends Error {
  constructor() { super("partialWikiLink"); }
}
import { parseAnnotations, stripAnnotationTags, findMatchingCloseMark, parseCardFields } from "./annotationParser";

// 清理原生 <ruby> 标签（非插件生成）：移除 <rt> 内容和 <ruby> 标签本身
function stripNativeRuby(text: string): string {
  return text
    .replace(/<rt[^>]*>[\s\S]*?<\/(?:rt|ruby)>/g, "")
    .replace(/<\/?ruby[^>]*>/g, "");
}

// 构建完整的 <mark> 标签
export function buildMarkTag(
  id: string,
  text: string,
  color: AnnotationColor,
  note?: string,
  createdAt?: string,
  isFullText?: boolean,
  isCrossBlock?: boolean,
  cardFields?: {
    tags?: string[];
    archived?: boolean;
    reviewCount?: number;
    lastReviewedAt?: number;
  }
): string {
  const bgVar = COLOR_BG_VARS[color];
  const accentVar = COLOR_ACCENT_VARS[color] || "transparent";
  const noteAttr = note ? ` data-annotation-note="${encodeAttr(note)}"` : "";
  // AnnoCard 卡片字段（含 fulltext/crossblock 标记）统一通过 buildCardAttrs 拼接
  const cardAttr = buildCardAttrs({
    isFullText,
    isCrossBlock,
    tags: cardFields?.tags,
    archived: cardFields?.archived,
    reviewCount: cardFields?.reviewCount,
    lastReviewedAt: cardFields?.lastReviewedAt,
  });


  return `<mark style="background:${bgVar};color:inherit;--annotation-accent:${accentVar}" data-annotation-id="${id}"${noteAttr}${cardAttr}>${text}</mark>`;
}

// 在标注文件内容中插入新标注
export function insertAnnotation(content: string, annotation: NewAnnotation, customId?: string): { content: string; id: string } {
  const id = customId ?? generateId();

  let start = -1;
  let end = -1;

  if (annotation.position) {
    start = annotation.position.start;
    end = annotation.position.end;
  } else {
    const found = findTextInSource(
      content, annotation.text,
      annotation.contextBefore, annotation.contextAfter,
      annotation.startLine, annotation.endLine,
      annotation.occurrence
    );
    if (found) {
      if (found.isPartialWikiLink) {
        throw new PartialWikiLinkError();
      }
      start = found.start;
      end = found.end;
    }
  }

  if (start < 0) {
    return { content, id };
  }

  if (end < 0) {
    end = start + annotation.text.length;
  }

  const sourceSlice = content.substring(start, end);
  const needsRebuild = /<(?:mark|ruby|rt)\s[^>]*data-annotation-id|<\/mark>/i.test(sourceSlice);

  if (!needsRebuild) {
    const tag = (sourceSlice === annotation.text)
      ? buildMarkTag(id, sourceSlice, annotation.color, annotation.note)
      : buildMarkTag(id, sourceSlice, annotation.color, annotation.note);

    return {
      content: content.substring(0, start) + tag + content.substring(end),
      id,
    };
  }

  return rebuildOverlapRegion(content, start, end, id, annotation);
}

// 重建受重叠影响的区域
function rebuildOverlapRegion(
  content: string,
  newStart: number,
  newEnd: number,
  newId: string,
  annotation: NewAnnotation
): { content: string; id: string } {
  const existingAnnotations = parseAnnotations(content);
  const involvedAnnotations = existingAnnotations.filter(a =>
    a.positions.some(p => p.start < newEnd && p.end > newStart)
  );

  const probeStarts = [newStart, ...involvedAnnotations.flatMap(a => a.positions.map(p => p.start))];
  const probeEnds = [newEnd, ...involvedAnnotations.flatMap(a => a.positions.map(p => p.end))];
  const probeStart = Math.min(...probeStarts);
  const probeEnd = Math.max(...probeEnds);

  const nestedAnnotations = existingAnnotations.filter(a =>
    !involvedAnnotations.includes(a) &&
    a.positions.some(p => p.start >= probeStart && p.end <= probeEnd)
  );
  const allExistingToRebuild = [...involvedAnnotations, ...nestedAnnotations];

  const allStarts = [newStart, ...allExistingToRebuild.flatMap(a => a.positions.map(p => p.start))];
  const allEnds = [newEnd, ...allExistingToRebuild.flatMap(a => a.positions.map(p => p.end))];
  const affectedStart = Math.min(...allStarts);
  const affectedEnd = Math.max(...allEnds);

  const affectedRegion = content.substring(affectedStart, affectedEnd);
  const plainRegion = stripNativeRuby(stripAnnotationTags(affectedRegion));

  const allInvolved = [
    ...allExistingToRebuild.map(a => ({
      id: a.id,
      text: a.text,
      color: a.color,
      note: a.note,
      tags: a.tags,
      archived: a.archived,
      reviewCount: a.reviewCount,
      lastReviewedAt: a.lastReviewedAt,
      isFullText: a.isFullText,
      isCrossBlock: a.isCrossBlock,
    })),
    {
      id: newId,
      text: annotation.text,
      color: annotation.color,
      note: annotation.note,
      // 新标注无卡片字段（默认值），显式列出保持类型一致
      tags: undefined as string[] | undefined,
      archived: undefined as boolean | undefined,
      reviewCount: undefined as number | undefined,
      lastReviewedAt: undefined as number | undefined,
      isFullText: undefined as boolean | undefined,
      isCrossBlock: undefined as boolean | undefined,
    },
  ];

  const intervals: Interval[] = [];
  for (const ann of allInvolved) {
    const idx = plainRegion.indexOf(ann.text);
    if (idx >= 0) {
      intervals.push({
        id: ann.id,
        start: idx,
        end: idx + ann.text.length,
        annotationColor: ann.color,
        // note 传原文，由 buildSegmentHtml 统一转义
        note: ann.note || undefined,
        tags: ann.tags,
        archived: ann.archived,
        reviewCount: ann.reviewCount,
        lastReviewedAt: ann.lastReviewedAt,
        isFullText: ann.isFullText,
        isCrossBlock: ann.isCrossBlock,
      });
    }
  }

  const segments = computeSegments(intervals);
  const annotationMap = new Map<string, Interval>();
  for (const iv of intervals) {
    annotationMap.set(iv.id, iv);
  }
  const rebuiltRegion = buildSegmentHtml(segments, plainRegion, annotationMap);

  return {
    content: content.substring(0, affectedStart) + rebuiltRegion + content.substring(affectedEnd),
    id: newId,
  };
}

// 从标注文件内容中删除指定标注
export function removeAnnotationTag(content: string, annotationId: string): string {
  let result = removeRubyById(content, annotationId);
  result = removeMarkById(result, annotationId);
  result = mergeAdjacentMarks(result);
  return result;
}

// 合并相邻的同 ID <mark> 段
function mergeAdjacentMarks(content: string): string {
  const openRe = /<mark\s+([^>]*)>/g;
  const closeRe = /<\/mark>/g;

  interface TagInfo {
    index: number;
    length: number;
    type: "open" | "close";
    id: string;
    isFullText: boolean;
  }

  const tags: TagInfo[] = [];
  let m: RegExpExecArray | null;

  while ((m = openRe.exec(content)) !== null) {
    const attrs = m[1]!;
    const id = attrs.match(/data-annotation-id="([^"]*)"/)?.[1] || "";
    const isFullText = attrs.includes('data-annotation-fulltext="true"');
    tags.push({ index: m.index, length: m[0].length, type: "open", id, isFullText });
  }

  while ((m = closeRe.exec(content)) !== null) {
    tags.push({ index: m.index, length: 7, type: "close", id: "", isFullText: false });
  }

  tags.sort((a, b) => a.index - b.index);

  const stack: number[] = [];
  const skipSet = new Set<number>();

  for (let i = 0; i < tags.length; i++) {
    if (skipSet.has(i)) continue;
    const tag = tags[i]!;
    if (tag.type === "open") {
      stack.push(i);
    } else {
      const openIdx = stack.pop();
      if (openIdx === undefined) continue;
      const openTag = tags[openIdx]!;

      const nextIdx = i + 1;
      const nextTag = tags[nextIdx];
      if (
        nextTag &&
        nextTag.type === "open" &&
        nextTag.id === openTag.id &&
        !nextTag.isFullText &&
        openTag.id &&
        tag.index + tag.length === nextTag.index
      ) {
        skipSet.add(i);
        skipSet.add(nextIdx);
        stack.push(openIdx);
      }
    }
  }

  if (skipSet.size === 0) return content;

  const parts: string[] = [];
  let lastIdx = 0;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!;
    if (tag.index > lastIdx) {
      parts.push(content.substring(lastIdx, tag.index));
    }
    if (!skipSet.has(i)) {
      parts.push(content.substring(tag.index, tag.index + tag.length));
    }
    lastIdx = tag.index + tag.length;
  }
  if (lastIdx < content.length) {
    parts.push(content.substring(lastIdx));
  }

  return parts.join("");
}

// 移除指定标注关联的 <ruby> 标签
function removeRubyById(content: string, annotationId: string): string {
  const rubyRegex = new RegExp(
    `<ruby\\s+[^>]*data-annotation-id="${annotationId}"[^>]*>([\\s\\S]*?)<rt\\s+[^>]*data-annotation-id="${annotationId}"[^>]*>[\\s\\S]*?<\\/rt><\\/ruby>`,
    "g"
  );
  return content.replace(rubyRegex, "$1");
}

// 用栈匹配移除指定 ID 的 <mark> 标签
function removeMarkById(content: string, annotationId: string): string {
  const openRe = /<mark\s+([^>]*)>/g;
  const closeRe = /<\/mark>/g;

  interface MarkTag { index: number; length: number; type: "open" | "close"; id: string }
  const tags: MarkTag[] = [];

  let m: RegExpExecArray | null;
  while ((m = openRe.exec(content)) !== null) {
    const id = m[1]!.match(/data-annotation-id="([^"]*)"/)?.[1] || "";
    tags.push({ index: m.index, length: m[0].length, type: "open", id });
  }
  while ((m = closeRe.exec(content)) !== null) {
    tags.push({ index: m.index, length: 7, type: "close", id: "" });
  }

  tags.sort((a, b) => a.index - b.index);

  const stack: number[] = [];
  const removeSet = new Set<number>();

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!;
    if (tag.type === "open") {
      stack.push(i);
    } else {
      const openIdx = stack.pop();
      if (openIdx !== undefined && tags[openIdx]!.id === annotationId) {
        removeSet.add(openIdx);
        removeSet.add(i);
      }
    }
  }

  if (removeSet.size === 0) return content;

  const parts: string[] = [];
  let lastIdx = 0;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i]!;
    if (tag.index > lastIdx) {
      parts.push(content.substring(lastIdx, tag.index));
    }
    if (!removeSet.has(i)) {
      parts.push(content.substring(tag.index, tag.index + tag.length));
    }
    lastIdx = tag.index + tag.length;
  }
  if (lastIdx < content.length) {
    parts.push(content.substring(lastIdx));
  }

  return parts.join("");
}

// 更新指定标注的属性
export function updateAnnotationTag(
  content: string,
  annotationId: string,
  updates: {
    color?: AnnotationColor;
    note?: string;
    // AnnoCard 卡片化管理字段
    tags?: string[];
    archived?: boolean;
    reviewCount?: number;
    lastReviewedAt?: number;
  }
): string {
  // 用深度配对定位每个完整 <mark> 区间：惰性正则在嵌套标注（重叠重建的产物）上
  // 会把内容截短到第一个 </mark>，重建时吞掉内层标注、产生孤立闭标签
  const openRe = new RegExp(`<mark\\s+([^>]*data-annotation-id="${annotationId}"[^>]*)>`, "g");
  const ranges: Array<{ start: number; end: number; attrs: string; openLength: number }> = [];

  let m: RegExpExecArray | null;
  while ((m = openRe.exec(content)) !== null) {
    const start = m.index;
    // RegExpExecArray 的 [0] 是具名 string 成员，无需断言（m[1] 走索引签名才需要）
    const openLength = m[0].length;
    const closeStart = findMatchingCloseMark(content, start + openLength);
    if (closeStart === -1) continue;
    ranges.push({ start, end: closeStart + 7, attrs: m[1]!, openLength });
  }

  if (ranges.length === 0) return content;

  const hasCardUpdates = updates.tags !== undefined
    || updates.archived !== undefined
    || updates.reviewCount !== undefined
    || updates.lastReviewedAt !== undefined;

  // 从后往前重建，避免前序替换使后序偏移失效
  let result = content;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]!;
    const innerContent = content.slice(r.start + r.openLength, r.end - 7);
    let newAttrs = r.attrs;

    if (updates.color) {
      const bgVar = COLOR_BG_VARS[updates.color];
      const accentVar = COLOR_ACCENT_VARS[updates.color] || "transparent";
      // 替换 style 中的 background 和 --annotation-accent
      if (newAttrs.includes("style=")) {
        newAttrs = newAttrs.replace(
          /style="background:[^"]*"/,
          `style="background:${bgVar};color:inherit;--annotation-accent:${accentVar}"`
        );
      } else {
        newAttrs += ` style="background:${bgVar};color:inherit;--annotation-accent:${accentVar}"`;
      }
    }

    if (updates.note !== undefined) {
      if (updates.note) {
        if (newAttrs.includes("data-annotation-note=")) {
          newAttrs = newAttrs.replace(
            /data-annotation-note="[^"]*"/,
            `data-annotation-note="${encodeAttr(updates.note)}"`
          );
        } else {
          newAttrs += ` data-annotation-note="${encodeAttr(updates.note)}"`;
        }
      } else {
        newAttrs = newAttrs.replace(/\s*data-annotation-note="[^"]*"/, "");
      }
    }

    // AnnoCard 卡片字段更新：先解析旧属性并与 updates 合并（updates 未提供的字段保留原值），
    // 再剥离旧属性、整体回写——否则部分更新（如只改 archived）会丢失标签等未提供字段
    // （多 <mark> 同 ID 时每个标签都更新，保持与 note 一致的处理口径）
    if (hasCardUpdates) {
      const oldFields = parseCardFields(newAttrs);
      const merged = {
        tags: updates.tags !== undefined ? updates.tags : oldFields.tags,
        archived: updates.archived !== undefined ? updates.archived : oldFields.archived,
        reviewCount: updates.reviewCount !== undefined ? updates.reviewCount : oldFields.reviewCount,
        lastReviewedAt: updates.lastReviewedAt !== undefined ? updates.lastReviewedAt : oldFields.lastReviewedAt,
      };

      newAttrs = newAttrs.replace(/\s*data-annotation-tags="[^"]*"/g, "");
      newAttrs = newAttrs.replace(/\s*data-annotation-archived="[^"]*"/g, "");
      newAttrs = newAttrs.replace(/\s*data-annotation-review-count="[^"]*"/g, "");
      newAttrs = newAttrs.replace(/\s*data-annotation-last-reviewed="[^"]*"/g, "");

      const cardAttr = buildCardAttrs(merged);
      newAttrs += cardAttr;
    }


    result = result.slice(0, r.start) + `<mark ${newAttrs}>${innerContent}</mark>` + result.slice(r.end);
  }

  return result;
}

// 全文标注插入
export function insertFullTextAnnotation(
  content: string,
  annotation: NewAnnotation
): { content: string; id: string; count: number } {
  const id = generateId();
  const map = buildCleanedMap(content);
  const excludedRanges = findExcludedRanges(content);

  const occurrences: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = map.cleaned.indexOf(annotation.text, searchFrom);
    if (idx < 0) break;
    occurrences.push(idx);
    // 按 text 长度推进，不允许重叠匹配（如对"哈哈"全文标注"哈哈"这类叠词，
    // 重叠区间相交会在插入时切进已生成的 <mark> 产生损坏标签）
    searchFrom = idx + annotation.text.length;
  }

  if (occurrences.length === 0) return { content, id, count: 0 };

  let newContent = content;
  let actualCount = 0;
  // 已插入区间（源坐标），插入循环跳过与之重叠的匹配（wiki-link 扩展可能使区间变宽）
  const insertedRanges: Array<{ start: number; end: number }> = [];
  for (let i = occurrences.length - 1; i >= 0; i--) {
    const cleanStart = occurrences[i]!;
    const cleanEnd = cleanStart + annotation.text.length;

    // 跳过代码块和内联代码区域
    const srcPos = map.cleanedToSource[cleanStart] ?? 0;
    const isInExcluded = excludedRanges.some(r => srcPos >= r.start && srcPos < r.end);
    if (isInExcluded) continue;

    let srcStart = map.cleanedToSource[cleanStart] ?? 0;
    let srcEnd = (map.cleanedToSource[cleanEnd - 1] ?? srcStart) + 1;

    // 扩展到完整 wiki-link，跳过部分选中
    const expanded = expandToWikiLinks(newContent, srcStart, srcEnd);
    if (expanded.isPartialWikiLink) {
      continue;
    }
    srcStart = expanded.start;
    srcEnd = expanded.end;

    if (insertedRanges.some(r => srcStart < r.end && srcEnd > r.start)) continue;

    const sourceSlice = newContent.substring(srcStart, srcEnd);

    const tag = buildMarkTag(id, sourceSlice, annotation.color, annotation.note, undefined, undefined, true);
    newContent = newContent.substring(0, srcStart) + tag + newContent.substring(srcEnd);
    insertedRanges.push({ start: srcStart, end: srcEnd });
    actualCount++;
  }

  return { content: newContent, id, count: actualCount };
}

// 跨段标注插入
export function insertCrossBlockAnnotation(
  content: string,
  annotation: NewAnnotation
): { content: string; id: string; blockCount: number } {
  const segments = annotation.blockSegments;
  if (!segments || segments.length === 0) {
    return { content, id: generateId(), blockCount: 0 };
  }

  const id = generateId();


  const sorted = [...segments]
    .map((seg, idx) => ({ ...seg, originalIdx: idx }))
    .sort((a, b) => b.lineStart - a.lineStart);

  let newContent = content;
  let successCount = 0;

  for (const block of sorted) {
    const found = findTextInSource(
      newContent, block.text,
      undefined, undefined,
      block.lineStart, block.lineEnd,
      block.occurrence
    );
    if (!found) continue;

    const sourceSlice = newContent.substring(found.start, found.end);
    const needsRebuild = /<(?:mark|ruby|rt)\s[^>]*data-annotation-id|<\/mark>/i.test(sourceSlice);

    if (!needsRebuild) {
      const tag = buildMarkTag(id, sourceSlice, annotation.color, annotation.note, undefined, undefined, true);
      newContent = newContent.substring(0, found.start) + tag + newContent.substring(found.end);
      successCount++;
    } else {
      const result = rebuildOverlapRegion(newContent, found.start, found.end, id, {
        text: block.text,
        color: annotation.color,
        note: annotation.note,
      });
      newContent = result.content;
      successCount++;
    }
  }

  return { content: newContent, id, blockCount: successCount };
}
