export type DailyShareLayout = {
  width: number;
  height: number;
  cardX: number;
  cardY: number;
  cardWidth: number;
  cardHeight: number;
  innerX: number;
  innerRight: number;
  titleY: number;
  meterY: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
  contentTextX: number;
  contentTextY: number;
  diffLabelY: number;
  diffStripY: number;
  diffStripHeight: number;
  footerDividerY: number;
  achievementY: number;
  brandY: number;
  urlY: number;
  logoX: number;
  logoY: number;
  logoSize: number;
};

export const dailyShareCardWidth = 1040;
export const dailyShareLineHeight = 48;

export function getDailyShareLayout(lineCount: number): DailyShareLayout {
  const width = dailyShareCardWidth;
  const cardX = 48;
  const cardY = 48;
  const cardWidth = width - cardX * 2;
  const innerX = 112;
  const innerRight = width - innerX;
  const contentX = 96;
  const contentY = 176;
  const contentWidth = width - contentX * 2;
  const contentHeight = Math.max(148, 32 + Math.max(lineCount, 1) * dailyShareLineHeight + 32);
  const contentBottom = contentY + contentHeight;
  const diffLabelY = contentBottom + 58;
  const diffStripY = contentBottom + 78;
  const diffStripHeight = 86;
  const footerDividerY = diffStripY + diffStripHeight + 40;
  const achievementY = footerDividerY + 52;
  const brandY = footerDividerY + 90;
  const urlY = footerDividerY + 124;
  const logoSize = 72;
  const logoX = innerRight - logoSize;
  const logoY = footerDividerY + 34;
  const cardBottom = Math.max(urlY + 38, logoY + logoSize + 34);
  const cardHeight = cardBottom - cardY;
  const height = cardBottom + 48;

  return {
    width,
    height,
    cardX,
    cardY,
    cardWidth,
    cardHeight,
    innerX,
    innerRight,
    titleY: 124,
    meterY: 96,
    contentX,
    contentY,
    contentWidth,
    contentHeight,
    contentTextX: contentX + 32,
    contentTextY: contentY + 56,
    diffLabelY,
    diffStripY,
    diffStripHeight,
    footerDividerY,
    achievementY,
    brandY,
    urlY,
    logoX,
    logoY,
    logoSize
  };
}
