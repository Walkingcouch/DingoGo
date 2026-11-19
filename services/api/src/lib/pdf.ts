/**
 * A small PDF writer for statements, tax invoices and returns (Round 16). No dependencies: A4 pages, Helvetica and
 * Helvetica-Bold (built into every PDF reader, WinAnsi encoding), headings, wrapped paragraphs, label/value rows and tables
 * with page breaks and repeated table headers. Text is stored uncompressed so it stays searchable (and testable).
 */

const W = 595.28, H = 841.89, M = 48;           // A4 portrait in points, margin
const WIDTHS: Record<string, number> = {};       // Helvetica advance widths (1/1000 em) for printable ASCII
' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'.split('').forEach((ch, i) => {
  WIDTHS[ch] = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
    278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
    667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
    333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584][i];
});
const WIN: Record<string, number> = { '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '…': 0x85, '€': 0x80 };

/** Text as WinAnsi bytes (as a latin1 string), escaped for a PDF string literal. Characters outside WinAnsi become "?". */
function enc(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    let b = WIN[ch] ?? (c >= 32 && c <= 255 && !(c >= 127 && c < 160) ? c : c === 9 ? 32 : 63);
    const x = String.fromCharCode(b);
    out += x === '(' || x === ')' || x === '\\' ? '\\' + x : x;
  }
  return out;
}

export function textWidth(s: string, size: number, bold = false) {
  let w = 0;
  for (const ch of s) w += WIDTHS[ch] ?? 556;
  return (w / 1000) * size * (bold ? 1.06 : 1);
}

/** Break text into lines no wider than `width`. */
export function wrap(s: string, width: number, size: number, bold = false): string[] {
  const out: string[] = [];
  for (const para of String(s).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) <= width || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

export type Align = 'left' | 'right';
export interface Col { label: string; width: number; align?: Align }

export class Pdf {
  private pages: string[][] = [];
  private y = 0;
  readonly width = W - 2 * M;
  constructor(private title = 'DingoGo', private footer = '') { this.newPage(); }

  newPage() { this.pages.push([]); this.y = H - M; }
  private get ops() { return this.pages[this.pages.length - 1]; }
  /** Room for `h` more points on this page, or start a new one. Returns true if a new page was started. */
  ensure(h: number) { if (this.y - h < M + 20) { this.newPage(); return true; } return false; }

  text(x: number, y: number, s: string, size = 10, bold = false, align: Align = 'left', colW = 0) {
    const tx = align === 'right' ? x + colW - textWidth(s, size, bold) : x;
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${enc(s)}) Tj ET`);
  }
  rule(weight = 0.5) { this.ops.push(`${weight} w ${M} ${this.y.toFixed(2)} m ${(W - M).toFixed(2)} ${this.y.toFixed(2)} l S`); this.y -= 8; }
  gap(h = 8) { this.y -= h; }

  heading(s: string, size = 16) { this.ensure(size + 12); this.y -= size; this.text(M, this.y, s, size, true); this.y -= 8; }
  para(s: string, size = 9.5, bold = false) {
    for (const line of wrap(s, this.width, size, bold)) { this.ensure(size + 3); this.y -= size + 3; this.text(M, this.y, line, size, bold); }
    this.y -= 4;
  }
  /** Label/value pairs in two columns (label left, value right-aligned or after the label). */
  rows(pairs: [string, string][], opts: { size?: number; boldLast?: boolean; labelW?: number } = {}) {
    const size = opts.size ?? 10; const lw = opts.labelW ?? this.width * 0.62;
    pairs.forEach(([k, v], i) => {
      const bold = !!opts.boldLast && i === pairs.length - 1;
      const lines = wrap(k, lw - 6, size, bold);
      this.ensure(lines.length * (size + 4));
      lines.forEach((l, j) => { this.y -= size + 4; this.text(M, this.y, l, size, bold); if (j === 0) this.text(M + lw, this.y, v, size, bold, 'right', this.width - lw); });
    });
    this.y -= 4;
  }
  /** Table with a header row (repeated after a page break); column widths are fractions of the page width. */
  table(cols: Col[], rows: string[][], opts: { size?: number; boldLast?: boolean } = {}) {
    const size = opts.size ?? 8.5;
    const xs: number[] = []; let x = M;
    for (const c of cols) { xs.push(x); x += c.width * this.width; }
    const header = () => {
      this.y -= size + 4;
      cols.forEach((c, i) => this.text(xs[i], this.y, c.label, size, true, c.align, c.width * this.width - 4));
      this.y -= 3; this.ops.push(`0.4 w ${M} ${this.y.toFixed(2)} m ${(W - M).toFixed(2)} ${this.y.toFixed(2)} l S`);
    };
    this.ensure(2 * (size + 5)); header();
    rows.forEach((r, ri) => {
      const bold = !!opts.boldLast && ri === rows.length - 1;
      const cells = cols.map((c, i) => wrap(r[i] ?? '', c.width * this.width - 6, size, bold));
      const h = Math.max(...cells.map((l) => l.length)) * (size + 3) + 2;
      if (this.ensure(h)) header();
      const top = this.y;
      cells.forEach((lines, i) => lines.forEach((l, j) => this.text(xs[i], top - (j + 1) * (size + 3), l, size, bold, cols[i].align, cols[i].width * this.width - 4)));
      this.y = top - h;
    });
    this.y -= 6;
  }

  toBuffer(): Buffer {
    const objs: string[] = [];
    const add = (s: string) => { objs.push(s); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add('PAGES');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids: number[] = [];
    this.pages.forEach((ops, i) => {
      const foot = `BT /F1 7.5 Tf ${M} 28 Td (${enc(`${this.footer ? this.footer + '   ' : ''}Page ${i + 1} of ${this.pages.length}`)}) Tj ET`;
      const stream = [...ops, foot].join('\n');
      const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`));
    });
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    const info = add(`<< /Title (${enc(this.title)}) /Producer (DingoGo) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}
