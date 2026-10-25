export const CHINESE_FONTS = [
  { id: "system_sans", label: "系统黑体", family: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { id: "source_han_sans", label: "思源黑体 · 内嵌", family: '"CareerAdapt Source Han Sans"', asset: "SourceHanSansSC-Regular.otf", format: "opentype" },
  { id: "source_han_serif", label: "思源宋体 · 内嵌", family: '"CareerAdapt Source Han Serif"', asset: "SourceHanSerifSC-Regular.otf", format: "opentype" },
  { id: "pingfang", label: "苹方 · 系统字体", family: '"PingFang SC", "Microsoft YaHei", sans-serif' }
] as const;
export const ENGLISH_FONTS = [
  { id: "system_sans", label: "系统 Sans", family: '"Segoe UI", Arial, sans-serif' },
  { id: "inter", label: "Inter · 内嵌", family: '"CareerAdapt Inter"', asset: "Inter.ttf", format: "truetype" },
  { id: "roboto", label: "Roboto · 内嵌", family: '"CareerAdapt Roboto"', asset: "Roboto.ttf", format: "truetype" },
  { id: "eb_garamond", label: "EB Garamond · 内嵌", family: '"CareerAdapt EB Garamond"', asset: "EBGaramond.ttf", format: "truetype" },
  { id: "arial", label: "Arial · 系统字体", family: "Arial" },
  { id: "georgia", label: "Georgia · 系统字体", family: "Georgia" },
  { id: "times_new_roman", label: "Times New Roman · 系统字体", family: '"Times New Roman", Times' },
  { id: "helvetica_neue", label: "Helvetica Neue · 系统字体", family: '"Helvetica Neue", Arial' },
  { id: "palatino", label: "Palatino · 系统字体", family: '"Palatino Linotype", Palatino, Georgia' }
] as const;
export const FONT_PRESETS = [
  { id: "inter-sans", label: "Inter + 思源黑体", chineseFont: "source_han_sans", englishFont: "inter" },
  { id: "helvetica-pingfang", label: "Helvetica Neue + 苹方（系统）", chineseFont: "pingfang", englishFont: "helvetica_neue" },
  { id: "roboto-sans", label: "Roboto + 思源黑体", chineseFont: "source_han_sans", englishFont: "roboto" },
  { id: "serif", label: "Times New Roman + 思源宋体", chineseFont: "source_han_serif", englishFont: "times_new_roman" },
  { id: "palatino-serif", label: "Palatino + 思源宋体", chineseFont: "source_han_serif", englishFont: "palatino" },
  { id: "garamond-serif", label: "EB Garamond + 思源宋体", chineseFont: "source_han_serif", englishFont: "eb_garamond" },
  { id: "sans", label: "Arial + 思源黑体", chineseFont: "source_han_sans", englishFont: "arial" }
] as const;
