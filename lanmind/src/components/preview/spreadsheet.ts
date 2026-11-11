import * as XLSX from 'xlsx';
export type CellValue = string | number | boolean | Date | null;
export interface SheetGrid {
    rows: CellValue[][];
    maxCols: number;
}
/** Keep the existing 1,000-row preview, including worksheets with an offset origin. */
export function sheetGrid(sheet: XLSX.WorkSheet): SheetGrid {
    const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : undefined;
    if (range)
        range.e.r = Math.min(range.e.r, range.s.r + 999);
    const rows = XLSX.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, defval: '', range });
    return { rows, maxCols: Math.max(8, ...rows.map(row => row.length)) };
}
