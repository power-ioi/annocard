// CM6 编辑模式下的标注标签扫描器
// 扫描文档文本中的 <mark>/<ruby>/<rt> 标签，提取位置和元数据

// 匹配所有标注相关标签
const TAG_REGEX = /<\/?(?:mark|ruby|rt)(?:\s[^>]*)?>/g;

// 从属性字符串中提取指定属性值
function getAttr(attrs: string, name: string): string | null {
	const regex = new RegExp(`${name}="([^"]*)"`, "i");
	const match = attrs.match(regex);
	return match ? match[1]! : null;
}

// 从 style 属性中提取颜色序号
function extractColorIndex(style: string): string {
	const match = style.match(/annotation-bg-color(\d+)/);
	return match ? match[1]! : "3";
}

// 扫描到的标签信息
interface TagMatch {
	type: "mark-open" | "mark-close" | "ruby-open" | "ruby-close" | "rt-open" | "rt-close";
	from: number;
	to: number;
	annotationId?: string;
	colorIndex?: string;
	hasNote?: boolean;
}

// 解析后的完整标注块
export interface AnnotationBlock {
	id: string;
	colorIndex: string;
	hasNote: boolean;
	markOpenFrom: number;
	markOpenTo: number;
	markCloseFrom: number;
	markCloseTo: number;
}

// 扫描文本中的所有标注标签
function scanTags(text: string, offset: number): TagMatch[] {
	const tags: TagMatch[] = [];
	let match: RegExpExecArray | null;

	TAG_REGEX.lastIndex = 0;
	while ((match = TAG_REGEX.exec(text)) !== null) {
		const tagText = match[0];
		const from = match.index + offset;
		const to = from + tagText.length;

		if (tagText.startsWith("</")) {
			if (tagText.startsWith("</mark")) {
				tags.push({ type: "mark-close", from, to });
			} else if (tagText.startsWith("</ruby")) {
				tags.push({ type: "ruby-close", from, to });
			} else if (tagText.startsWith("</rt")) {
				tags.push({ type: "rt-close", from, to });
			}
		} else {
			const spaceIdx = tagText.indexOf(" ");
			const attrsStr = spaceIdx >= 0 ? tagText.substring(spaceIdx + 1, tagText.length - 1) : "";

			if (tagText.startsWith("<mark")) {
				const style = getAttr(attrsStr, "style") || "";
				tags.push({
					type: "mark-open",
					from,
					to,
					annotationId: getAttr(attrsStr, "data-annotation-id") || undefined,
					colorIndex: style ? extractColorIndex(style) : "3",
					hasNote: !!getAttr(attrsStr, "data-annotation-note"),
				});
			} else if (tagText.startsWith("<ruby")) {
				tags.push({
					type: "ruby-open",
					from,
					to,
					annotationId: getAttr(attrsStr, "data-annotation-id") || undefined,
				});
			} else if (tagText.startsWith("<rt")) {
				tags.push({
					type: "rt-open",
					from,
					to,
					annotationId: getAttr(attrsStr, "data-annotation-id") || undefined,
				});
			}
		}
	}

	return tags;
}

// 从标签列表构建标注块（用栈配对标签）
// fullText: 完整文档文本，用于提取 rt 标签内的注音文字
export function scanAnnotationTags(text: string, offset: number, fullText: string): AnnotationBlock[] {
	const tags = scanTags(text, offset);
	const blocks: AnnotationBlock[] = [];

	// 栈用于配对 mark 标签
	const markStack: Array<{
		id: string;
		colorIndex: string;
		hasNote: boolean;
		openFrom: number;
		openTo: number;
	}> = [];

	for (const tag of tags) {
		switch (tag.type) {
			case "mark-open": {
				markStack.push({
					id: tag.annotationId || "",
					colorIndex: tag.colorIndex || "3",
					hasNote: tag.hasNote || false,
					openFrom: tag.from,
					openTo: tag.to,
				});
				break;
			}
			case "mark-close": {
				const mark = markStack.pop();
				if (!mark) break;
				blocks.push({
					id: mark.id,
					colorIndex: mark.colorIndex,
					hasNote: mark.hasNote,
					markOpenFrom: mark.openFrom,
					markOpenTo: mark.openTo,
					markCloseFrom: tag.from,
					markCloseTo: tag.to,
				});
				break;
			}
		}
	}

	return blocks;
}

// 快速检查文本是否包含标注标签
export function hasAnnotationTags(text: string): boolean {
	return text.includes('data-annotation-id') && text.includes('<mark');
}
