import { getLanguage } from "obsidian";
import { zhCN } from "./zh";
import { en } from "./en";

export interface LocaleDict {
  // 通用
  save: string;
  cancel: string;
  copy: string;
  copied: string;
  delete: string;
  edit: string;
  open: string;
  close: string;
  add: string;
  all: string;
  none: string;
  noData: string;
  noteContent: string;

  // main.ts — 功能区 & 命令
  ribbonTooltip: string;
  commandToggleView: string;
  commandSidebar: string;
  commandImport: string;
  commandAnnotateColor: (label: string) => string;

  // main.ts — Notice
  noticeNoFile: string;
  noticeFileCreateFailed: string;
  noticeOpenFailed: string;
  noticeOriginalMissing: string;
  noticeNoCrossCallout: string;
  noticeNoLegacyData: string;
  noticeNoSelection: string;
  noticeMultiLineSelection: string;

  // 设置
  settingsTitle: string;
  settingsDefaultColor: string;
  settingsDefaultColorDesc: string;
  settingsColorCustom: string;
  settingsAddColor: string;
  settingsRemoveColor: string;
  settingsColorPlaceholder: string;
  settingsNoteStyle: string;
  settingsNoteEffect: string;
  settingsNoteEffectDesc: string;
  settingsNoteEffectThick: string;
  settingsNoteEffectDashed: string;
  settingsNoteEffectWavy: string;
  settingsNoteEffectDouble: string;
  settingsMaxNoteLength: string;
  settingsMaxNoteLengthDesc: string;
  settingsAnnotationMode: string;
  settingsDefaultViewMode: string;
  settingsDefaultViewModeDesc: string;
  settingsViewModePreview: string;
  settingsViewModeSource: string;
  settingsAutoOpenAnnotation: string;
  settingsAutoOpenAnnotationDesc: string;

  // 选择菜单 (SelectionMenu)
  menuFullText: string;
  noticeCopied: string;
  noticeAnnotationAdded: string;
  noticeAnnotationAndNoteAdded: string;
  noticeTextNotFound: string;
  noticeAddFailed: string;
  noticePartialWikiLink: string;

  // 编辑批注模态框 (EditNoteModal)
  modalNoteLabel: (n: number) => string;
  modalNotePlaceholder: string;

  // 标注菜单 (AnnotationMenu)
  menuEditNote: string;
  menuCopyOriginal: string;
  noticeColorChanged: string;
  noticeOriginalCopied: string;
  noticeNoteUpdated: string;
  noticeDeleted: string;

  // 标注列表面板 (AnnotationListPanel)
  panelTitle: string;
  panelSortContentAsc: string;
  panelSortContentDesc: string;
  panelSortTimeAsc: string;
  panelSortTimeDesc: string;
  panelSortColorAsc: string;
  panelSortColorDesc: string;
  panelDeleteAnnotation: string;
  panelViewAnnotation: string;
  panelFilterLabel: string;
  panelFilterAll: string;

  // 侧边栏 (AnnotationSidebarView)
  sidebarTitle: string;
  sidebarCurrentNote: string;
  sidebarAllNotes: string;
  sidebarExpandAll: string;
  sidebarCollapseAll: string;
  sidebarSortLabel: string;
  sidebarSearchLabel: string;
  sidebarFilterLabel: string;
  sidebarSearchPlaceholder: string;
  sidebarSortContent: string;
  sidebarSortContentDesc: string;
  sidebarSortTimeAsc: string;
  sidebarSortTimeDesc: string;
  sidebarSortColor: string;
  sidebarSortColorDesc: string;
  sidebarSortByNote: string;
  sidebarLoadFailed: string;
  sidebarNoMatch: string;
  sidebarNoAnnotations: string;
  sidebarAnnotationText: string;
  sidebarNoteSection: string;
  sidebarNoteEditPlaceholder: string;
  sidebarNoteCopy: string;
  sidebarNoteCopied: string;
  sidebarNoteCopyRestore: string;
  sidebarNoteEmpty: string;
  sidebarOpenNote: string;
  sidebarDeleteAnnotation: string;
  noticeAnnotationUpdated: string;
  noticeNoteFileNotFound: string;

  // 标注卡片 (AnnotationCard)
  cardOpen: string;
  cardDelete: string;
  // AnnoCard 卡片化管理新增
  cardArchived: string;
  cardReviewCount: (n: number) => string;
  cardEdit: string;
  cardShowArchived: string;
  cardHideArchived: string;
  cardTagFilter: string;
  cardTagFilterAll: string;
  cardBatchMode: string;
  cardBatchDelete: string;
  cardBatchTag: string;
  cardBatchCancel: string;
  cardBatchSelected: (n: number) => string;
  cardLoadMore: string;
  cardReviewStart: string;
  cardReviewExit: string;
  cardReviewNext: string;
  cardReviewPrev: string;
  cardReviewRemember: string;
  cardReviewForget: string;
  cardReviewEmpty: string;
  reviewOverviewAll: string;
  cardSetTitle: string;
  cardSetViewBar: string;
  cardSetViewSquare: string;
  cardSetOrderAsc: string;
  cardSetOrderDesc: string;
  cardSetNoNote: string;
  cardSetNoTags: string;
  tagEditTitle: string;
  cardReviewStat: (n: number, r: number, f: number) => string;
  cardReviewProgress: (cur: number, total: number) => string;
  cardTagAddPlaceholder: string;
  cardTagAddConfirm: string;
  cardTagAddTitle: string;
  cardTagAddToSelected: string;
  cardConfirmBatchDelete: (n: number) => string;
  cardNoticeTagAdded: string;
  cardNoticeTagRemoved: string;
  cardNoticeBatchDeleted: (n: number) => string;
  cardNoticeBatchTagged: (n: number) => string;
  cardNoticeNoteUpdated: string;
  cardNoticeArchived: string;
  cardNoticeReviewSaved: string;
  cardNoticeNoSelection: string;
  commandCardSidebar: string;
  commandStartReview: string;
  settingsCardTitle: string;
  settingsCardDefaultScope: string;
  settingsCardDefaultScopeDesc: string;
  settingsCardDefaultScopeCurrent: string;
  settingsCardDefaultScopeAll: string;
  settingsReviewBatchSize: string;
  settingsReviewBatchSizeDesc: string;
  settingsShowCardRibbon: string;
  settingsShowCardRibbonDesc: string;
  settingsShowArchivedInCard: string;
  settingsShowArchivedInCardDesc: string;

  // 提示框 (TooltipManager)
  tooltipLabel: string;

  // 导入 (ImportConfirmModal)
  importTitle: string;
  importScanFiles: (n: number) => string;
  importScanAnnotations: (n: number) => string;
  importWarningNoDelete: string;
  importWarningSkipDup: string;
  importConfirm: string;
  importImporting: string;
  importFailed: string;
  importComplete: string;
  importResultImported: (n: number) => string;
  importResultSkippedInvalid: (n: number) => string;
  importResultSkippedDuplicate: (n: number) => string;
  importResultSkippedNotFound: (n: number) => string;
  importResultFailed: (n: number) => string;
  importErrorDetails: string;
  importMoreErrors: (n: number) => string;
  importOk: string;

  // 导出
  commandExport: string;
  sidebarExportBtn: string;
  exportModalTitle: string;
  exportModalPlaceholder: string;
  noticeExportSuccess: (n: number) => string;
  noticeExportFailed: string;
  noticeExportNoFile: string;
  exportConfirmOverwrite: string;
  exportConfirmOverwriteDesc: string;
  exportFolderPlaceholder: string;
  exportFolderSuggestTitle: string;
  exportFileNameTitle: string;
  exportFileNamePlaceholder: string;
  exportFileNameInvalid: string;
  exportAutoName: string;
  exportAutoNamePrefix: string;
  settingsExportFolder: string;
  settingsExportFolderDesc: string;

  // 带参数
  colorLabel: (n: string) => string;
  fullTextAnnotation: (n: number) => string;
  crossBlockAnnotation: (n: number) => string;
  fullTextBadge: (n: number) => string;
  crossBlockBadge: (n: number) => string;
  noteTooLong: (n: number) => string;
  notePlaceholder: (n: number) => string;
  charCount: (current: number, max: number) => string;
  confirmDeleteMulti: (n: number) => string;
  confirmDelete: string;
  annotationViewTitle: (name: string) => string;
}

let currentLocale: LocaleDict | null = null;

export function initLocale(): void {
  // 用 Obsidian 官方接口获取界面语言，避免直接读 localStorage
  const lang = getLanguage() || "en";
  if (lang === "zh" || lang.startsWith("zh-")) {
    currentLocale = zhCN;
  } else {
    currentLocale = en;
  }
}

export function t(): LocaleDict {
  return currentLocale!;
}
