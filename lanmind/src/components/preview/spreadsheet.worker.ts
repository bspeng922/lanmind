import * as XLSX from 'xlsx';
import { sheetGrid } from './spreadsheet';
let workbook: XLSX.WorkBook | null = null;
// The workbook stays in this worker; only the selected sheet's bounded grid crosses back.
self.onmessage = (event: MessageEvent<{
    id: number;
    buffer?: ArrayBuffer;
    sheet?: string;
}>) => {
    const { id, buffer } = event.data;
    try {
        if (buffer)
            workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
        if (!workbook)
            throw new Error('Workbook is unavailable');
        const sheet = event.data.sheet || workbook.SheetNames[0] || '';
        const grid = workbook.Sheets[sheet] ? sheetGrid(workbook.Sheets[sheet]) : { rows: [], maxCols: 0 };
        self.postMessage({ id, sheet, sheetNames: workbook.SheetNames, ...grid });
    }
    catch (error) {
        self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
};
