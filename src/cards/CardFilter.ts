// AnnoCard 卡片筛选器（纯函数,无副作用）
// 从 AnnotationSidebarView.applyFilters 提取并扩展,新增 tags/archived 过滤
// 颜色: OR (选多个色则显示任一命中;空集合=不过滤)
// 标签: AND (选多个标签则需全部命中)
// 关键词: 与颜色/标签 AND;匹配 text 或 note (不区分大小写)
// archived: 默认隐藏,除非 showArchived=true

import type { AnnotationColor } from "../types";
import type { AnnotationCardData } from "../sidebar/AnnotationCard";

export interface CardFilterState {
  // 选中的颜色集合;空集合表示"全部颜色"
  colors: Set<AnnotationColor>;
  // 关键词(已 trim);空字符串表示无关键词
  keyword: string;
  // 选中的标签集合;空集合表示无标签筛选
  tags: Set<string>;
  // 是否显示已归档标注;false=隐藏 archived=true 的卡片
  showArchived: boolean;
}

export function createDefaultFilterState(): CardFilterState {
  return {
    colors: new Set(),
    keyword: "",
    tags: new Set(),
    showArchived: false,
  };
}

// 应用筛选:返回符合条件的卡片
// 兼容旧数据:tags 字段一定存在(加载层补默认 []),此处直接访问
export function applyCardFilter(cards: AnnotationCardData[], state: CardFilterState): AnnotationCardData[] {
  let result = cards;

  // 1. archived 过滤(默认隐藏)
  if (!state.showArchived) {
    result = result.filter((c) => !c.annotation.archived);
  }

  // 2. 颜色 OR 过滤
  if (state.colors.size > 0) {
    result = result.filter((c) => state.colors.has(c.annotation.color));
  }

  // 3. 标签 AND 过滤(选中的每个标签都必须出现在卡片 tags 中)
  if (state.tags.size > 0) {
    result = result.filter((c) => {
      const cardTags = c.annotation.tags ?? [];
      let allMatch = true;
      for (const t of state.tags) {
        if (!cardTags.includes(t)) {
          allMatch = false;
          break;
        }
      }
      return allMatch;
    });
  }

  // 4. 关键词 AND(与颜色/标签组合即为 AND,因前面已先过滤)
  if (state.keyword) {
    const q = state.keyword.toLowerCase();
    result = result.filter((c) => {
      const text = (c.annotation.text ?? "").toLowerCase();
      const note = (c.annotation.note ?? "").toLowerCase();
      const fileName = (c.fileName ?? "").toLowerCase();
      return text.includes(q) || note.includes(q) || fileName.includes(q);
    });
  }

  return result;
}

// 从全库卡片中收集所有标签及其频次(供 TagSuggest 与标签筛选下拉用)
export function collectTagFrequencies(cards: AnnotationCardData[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const c of cards) {
    const tags = c.annotation.tags ?? [];
    for (const t of tags) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
  }
  return freq;
}

// 按频次降序返回标签列表(供 TagSuggest 排序)
export function tagsByFrequency(cards: AnnotationCardData[]): string[] {
  const freq = collectTagFrequencies(cards);
  return Array.from(freq.keys()).sort((a, b) => {
    const fa = freq.get(a) ?? 0;
    const fb = freq.get(b) ?? 0;
    if (fb !== fa) return fb - fa;
    return a.localeCompare(b);
  });
}
