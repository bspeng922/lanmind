import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { sheetGrid } from './spreadsheet';
test('spreadsheet preview keeps dates, cached formulas, CSV, sheet selection and the row boundary', () => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 1100 }, (_, i) => [i, new Date(2026, 0, 2)]));
    sheet.C1 = { t: 'n', f: 'A1+1', v: 1 };
    sheet['!ref'] = 'A1:C1100';
    XLSX.utils.book_append_sheet(wb, sheet, 'Data');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['other']]), 'Other');
    const parsed = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellDates: true });
    const grid = sheetGrid(parsed.Sheets.Data);
    assert.equal(grid.rows.length, 1000);
    assert.equal(grid.rows[999][0], 999);
    assert.ok(grid.rows[0][1] instanceof Date);
    assert.equal(grid.rows[0][2], 1);
    assert.equal(sheetGrid(parsed.Sheets.Other).rows[0][0], 'other');
    assert.deepEqual(sheetGrid(XLSX.read('a,b\n1,2', { type: 'string' }).Sheets.Sheet1).rows, [['a', 'b'], [1, 2]]);
});
test('offset and empty worksheets preserve their displayed data', () => {
    assert.deepEqual(sheetGrid({}).rows, []);
    const sheet = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.sheet_add_aoa(sheet, [['offset'], ['next']], { origin: 'C30' });
    sheet['!ref'] = 'C30:C31';
    assert.deepEqual(sheetGrid(sheet).rows, [['offset'], ['next']]);
});
