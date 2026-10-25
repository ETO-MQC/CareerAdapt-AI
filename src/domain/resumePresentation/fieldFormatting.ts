import type { FieldAppearance } from "@/domain/schemas/fieldAppearance";

export type FieldMark = "bold" | "italic" | "underline";
type Range = FieldAppearance["ranges"][number];

export function isFieldMarkActive(ranges: Range[], from: number, to: number, mark: FieldMark) {
  if (from >= to) return false;
  const boundaries = [...new Set([from, to, ...ranges.flatMap(range => [Math.max(from, range.from), Math.min(to, range.to)])])].filter(value => value >= from && value <= to).sort((a,b) => a-b);
  return boundaries.slice(0,-1).every((start,index) => ranges.some(range => range.from <= start && range.to >= boundaries[index+1] && range[mark]));
}

/** Formatting ranges never change the source text or its field identity. */
export function toggleFieldMark(ranges: Range[], length: number, from: number, to: number, mark: FieldMark): Range[] {
  const enabled = !isFieldMarkActive(ranges, from, to, mark);
  const boundaries = [...new Set([0,length,from,to,...ranges.flatMap(range => [range.from,range.to])])].sort((a,b) => a-b);
  const result: Range[] = [];
  for (let index=0;index<boundaries.length-1;index++) {
    const start=boundaries[index], end=boundaries[index+1];
    const active=ranges.filter(range=>range.from<=start && range.to>=end);
    const flags = { bold: active.some(range=>range.bold), italic: active.some(range=>range.italic), underline: active.some(range=>range.underline) };
    if(start>=from && end<=to) flags[mark]=enabled;
    if(!flags.bold && !flags.italic && !flags.underline) continue;
    const previous=result.at(-1);
    if(previous && previous.to===start && Boolean(previous.bold)===flags.bold && Boolean(previous.italic)===flags.italic && Boolean(previous.underline)===flags.underline) previous.to=end;
    else result.push({from:start,to:end,...(flags.bold?{bold:true}:{}),...(flags.italic?{italic:true}:{}),...(flags.underline?{underline:true}:{})});
  }
  return result;
}
