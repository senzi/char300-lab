export type ShareTextLine = {
  text: string;
  tracking: number;
};

type MeasureText = (text: string) => number;

const forbiddenLineStart = /^[，。！？；：、）》】」』〉…—]/u;
const forbiddenLineEnd = /[（《【「『〈]$/u;

export function layoutShareText(
  text: string,
  width: number,
  measureText: MeasureText,
  maxTightening = 1.5
): ShareTextLine[] {
  const lines: ShareTextLine[] = [];

  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    if (paragraph === "") {
      lines.push({ text: "", tracking: 0 });
      continue;
    }

    let current = "";
    for (const segment of segmentTextForWrapping(paragraph)) {
      const next = current + segment;
      if (measureText(next) <= width || current === "") {
        current = next;
        continue;
      }

      if (forbiddenLineStart.test(segment)) {
        const tracking = getFittingTracking(next, width, measureText, maxTightening);
        if (tracking !== null) {
          lines.push({ text: next, tracking });
          current = "";
          continue;
        }

        const [remaining, carried] = popLastGrapheme(current);
        if (remaining) {
          lines.push({ text: remaining, tracking: 0 });
        }
        current = carried + segment;
        continue;
      }

      if (forbiddenLineEnd.test(current)) {
        const [remaining, carried] = popLastGrapheme(current);
        if (remaining) {
          lines.push({ text: remaining, tracking: 0 });
        }
        current = carried + segment;
        continue;
      }

      lines.push({ text: current, tracking: 0 });
      current = segment;
    }

    if (current) {
      lines.push({ text: current, tracking: 0 });
    }
  }

  return lines;
}

export function getTrackedTextWidth(text: string, tracking: number, measureText: MeasureText): number {
  const graphemes = Array.from(text);
  const glyphWidth = graphemes.reduce((total, grapheme) => total + measureText(grapheme), 0);
  return glyphWidth + Math.max(graphemes.length - 1, 0) * tracking;
}

function getFittingTracking(text: string, width: number, measureText: MeasureText, maxTightening: number): number | null {
  const gapCount = Array.from(text).length - 1;
  if (gapCount <= 0) {
    return null;
  }

  const naturalWidth = getTrackedTextWidth(text, 0, measureText);
  const requiredTightening = Math.max((naturalWidth - width) / gapCount, 0);
  return requiredTightening <= maxTightening ? -requiredTightening : null;
}

function segmentTextForWrapping(text: string): string[] {
  return text.match(/[，。！？；：、）》】」』〉…—]+|\s+|[A-Za-z]+|\d+|./gu) ?? [];
}

function popLastGrapheme(text: string): [string, string] {
  const graphemes = Array.from(text);
  return [graphemes.slice(0, -1).join(""), graphemes.at(-1) ?? ""];
}
