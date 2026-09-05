// AnnoCard 标签智能推荐
// 移植 HiLighter 思路:从全库已有标签按频次降序建议,基于 Obsidian 官方 AbstractInputSuggest
// 不引入 AI,纯频次统计 + 子串/前缀匹配

import { AbstractInputSuggest, App, prepareFuzzySearch, type SearchResult } from "obsidian";

// 推荐选项:标签文本 + 频次
export interface TagSuggestion {
  tag: string;
  count: number;
  score?: SearchResult; // fuzzy 命中结果(可空,表示精确匹配)
}

/**
 * TagSuggest: 绑定到 <input>,输入时弹出全库已有标签的推荐列表
 *
 * 用法:
 *   const sugg = new TagSuggest(app, inputEl, () => allTags);
 *   sugg.onSelect((s) => { inputEl.value = s.tag; ... });
 *
 * 构造参数 candidateProvider 必须返回去重的标签数组(由调用方维护频次缓存),
 * 每次输入触发 getSuggestions 时实时拉取,避免 Suggest 持有陈旧缓存。
 */
export class TagSuggest extends AbstractInputSuggest<TagSuggestion> {
  private candidateProvider: () => string[];

  constructor(app: App, textInputEl: HTMLInputElement, candidateProvider: () => string[]) {
    super(app, textInputEl);
    this.candidateProvider = candidateProvider;
    // 默认上限 100 与 AbstractInputSuggest 默认一致;标签数量通常 <200,无需调整
  }

  protected getSuggestions(query: string): TagSuggestion[] {
    const q = query.trim().toLowerCase();
    const candidates = this.candidateProvider();

    if (!q) {
      // 无输入时返回前 20 个(字母序)供快速选择
      return candidates
        .slice()
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 20)
        .map((tag) => ({ tag, count: 0 }));
    }

    // 1. 前缀匹配优先(常见场景:用户记得开头)
    // 2. 子串包含次之
    // 3. fuzzy 兜底(支持拼写偏差)
    const lower = (s: string) => s.toLowerCase();
    const prefixMatches: string[] = [];
    const containsMatches: string[] = [];
    const fuzzyMatches: Array<{ tag: string; score: SearchResult }> = [];

    const fuzzy = prepareFuzzySearch(q);

    for (const tag of candidates) {
      const lt = lower(tag);
      if (lt.startsWith(q)) {
        prefixMatches.push(tag);
      } else if (lt.includes(q)) {
        containsMatches.push(tag);
      } else {
        const score = fuzzy(tag);
        if (score) {
          fuzzyMatches.push({ tag, score });
        }
      }
    }

    // fuzzy 按得分降序,取前 10
    fuzzyMatches.sort((a, b) => (b.score.score ?? 0) - (a.score.score ?? 0));
    const fuzzyTop = fuzzyMatches.slice(0, 10);

    const ordered = [
      ...prefixMatches.sort((a, b) => a.localeCompare(b)),
      ...containsMatches.sort((a, b) => a.localeCompare(b)),
      ...fuzzyTop.map((m) => m.tag),
    ];

    // 去重(同一标签可能命中多个类别)
    const seen = new Set<string>();
    const result: TagSuggestion[] = [];
    for (const tag of ordered) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      result.push({ tag, count: 0 });
      if (result.length >= 25) break; // 推荐列表上限 25,避免过长
    }
    return result;
  }

  renderSuggestion(value: TagSuggestion, el: HTMLElement): void {
    el.empty();
    el.addClass("annocard-tag-suggestion");
    el.createSpan({ cls: "annocard-tag-suggestion-text", text: value.tag });
    if (value.count > 0) {
      el.createSpan({ cls: "annocard-tag-suggestion-count", text: String(value.count) });
    }
  }

  // selectSuggestion 由 AbstractInputSuggest 默认实现:写入 input 值并关闭 popover,
  // 然后回调通过 onSelect 注册的 callback。无需在此重写
}
