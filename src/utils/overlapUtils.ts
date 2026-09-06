// 重叠标注的区间分割工具
// 将重叠的标注区间分割为不重叠的段，每段记录覆盖它的标注 ID 集合

import type { AnnotationColor } from "../types";
import { COLOR_BG_VARS, COLOR_ACCENT_VARS } from "../constants";
import { encodeAttr } from "./helpers";

export interface Interval {
  id: string;
  start: number;
  end: number;
  annotationColor?: AnnotationColor;
  note?: string;
  // AnnoCard 卡片化管理字段（重叠重建时一并保留，避免标签/归档状态丢失）
  tags?: string[];
  archived?: boolean;
  reviewCount?: number;
  lastReviewedAt?: number;
  isFullText?: boolean;
  isCrossBlock?: boolean;
}

// 构建 AnnoCard 卡片字段的属性字符串（用于 <mark> 标签）
// 与 buildMarkTag / updateAnnotationTag 保持一致：tags 以 JSON 数组 + encodeAttr 转义存储
export function buildCardAttrs(fields: {
  tags?: string[];
  archived?: boolean;
  reviewCount?: number;
  lastReviewedAt?: number;
  isFullText?: boolean;
  isCrossBlock?: boolean;
}): string {
  let attrs = "";
  if (fields.isFullText) attrs += ` data-annotation-fulltext="true"`;
  if (fields.isCrossBlock) attrs += ` data-annotation-crossblock="true"`;
  if (fields.tags && fields.tags.length > 0) {
    attrs += ` data-annotation-tags="${encodeAttr(JSON.stringify(fields.tags))}"`;
  }
  if (fields.archived) attrs += ` data-annotation-archived="true"`;
  if (fields.reviewCount && fields.reviewCount > 0) {
    attrs += ` data-annotation-review-count="${fields.reviewCount}"`;
  }
  if (fields.lastReviewedAt && fields.lastReviewedAt > 0) {
    attrs += ` data-annotation-last-reviewed="${fields.lastReviewedAt}"`;
  }
  return attrs;
}

export interface Segment {
  ids: string[];
  start: number;
  end: number;
}

// 扫描线算法：将重叠区间分割为不重叠段
export function computeSegments(intervals: Interval[]): Segment[] {
  if (intervals.length === 0) return [];

  const points = new Set<number>();
  for (const iv of intervals) {
    points.add(iv.start);
    points.add(iv.end);
  }

  const sorted = Array.from(points).sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = sorted[i]!;
    const segEnd = sorted[i + 1]!;

    const coveringIds = intervals
      .filter(iv => iv.start <= segStart && iv.end >= segEnd)
      .map(iv => iv.id);

    if (coveringIds.length > 0) {
      segments.push({ ids: coveringIds, start: segStart, end: segEnd });
    }
  }

  return segments;
}

// 从段重建 HTML
export function buildSegmentHtml(
  segments: Segment[],
  plainText: string,
  annotations: Map<string, Interval>
): string {
  const parts: string[] = [];
  let lastEnd = 0;

  for (const seg of segments) {
    if (seg.start > lastEnd) {
      parts.push(plainText.substring(lastEnd, seg.start));
    }

    let enrichedText = plainText.substring(seg.start, seg.end);

    // 按 ID 排序确保一致的嵌套顺序
    const sortedIds = [...seg.ids].sort();

    // 从内到外包裹 <mark> 标签
    let wrapped = enrichedText;
    for (let i = sortedIds.length - 1; i >= 0; i--) {
      const id = sortedIds[i]!;
      const ann = annotations.get(id);
      const color = ann?.annotationColor ?? "3";
      const bgVar = COLOR_BG_VARS[color];
      const accentVar = COLOR_ACCENT_VARS[color] || "transparent";
      // note 在本函数内统一转义（调用方传入原文即可，不再依赖调用方预转义的隐式契约）
      const noteAttr = ann?.note ? ` data-annotation-note="${encodeAttr(ann.note)}"` : "";
      // AnnoCard 卡片字段一并写回（重叠重建不丢失标签/归档/复习状态）
      const cardAttr = ann ? buildCardAttrs({
        tags: ann.tags,
        archived: ann.archived,
        reviewCount: ann.reviewCount,
        lastReviewedAt: ann.lastReviewedAt,
        isFullText: ann.isFullText,
        isCrossBlock: ann.isCrossBlock,
      }) : "";

      wrapped = `<mark style="background:${bgVar};--annotation-accent:${accentVar}" data-annotation-id="${id}"${noteAttr}${cardAttr}>${wrapped}</mark>`;
    }

    parts.push(wrapped);
    lastEnd = seg.end;
  }

  if (lastEnd < plainText.length) {
    parts.push(plainText.substring(lastEnd));
  }

  return parts.join("");
}
