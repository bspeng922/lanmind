/**
 * ExcelPreview — Spreadsheet (.xlsx / .xls / .csv) preview component with
 * real Excel column (A-Z) and row (1, 2, 3...) headers, sticky scroll,
 * formula bar, cell selection, in-sheet search, and sheet tabs.
 *
 * CALLING SPEC:
 *   <ExcelPreview
 *     arrayBuffer={buffer}
 *     fileName={fileName}
 *   />
 */

import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Search,
  X,
  Table,
  Layers,
  Copy,
  Check,
  ChevronDown,
  FileSpreadsheet,
  AlertCircle,
  Hash,
  Download,
} from 'lucide-react';

interface Props {
  arrayBuffer: ArrayBuffer;
  fileName: string;
}

// Convert 0-indexed column number to Excel column letter (0 -> A, 25 -> Z, 26 -> AA)
function getColumnLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

// Determine cell text alignment
function getCellAlignment(val: unknown): 'right' | 'center' | 'left' {
  if (typeof val === 'number') return 'right';
  if (val instanceof Date) return 'center';
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!isNaN(Number(trimmed)) && trimmed !== '') return 'right';
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(trimmed)) return 'center';
    if (/^(\$|¥|€|£|￥)\s*\d+/.test(trimmed)) return 'right';
    if (/^\d+(\.\d+)?%$/.test(trimmed)) return 'right';
  }
  return 'left';
}

// Format cell display string
function formatCellValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${val.getFullYear()}-${pad(val.getMonth() + 1)}-${pad(val.getDate())}`;
  }
  if (typeof val === 'number') {
    return Number.isInteger(val) ? val.toString() : val.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return String(val);
}

export const ExcelPreview: React.FC<Props> = ({ arrayBuffer, fileName }) => {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [currentSheet, setCurrentSheet] = useState<string>('');
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number; val: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse workbook
  useEffect(() => {
    try {
      const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
      setWorkbook(wb);
      const firstSheet = wb.SheetNames[0] || '';
      setCurrentSheet(firstSheet);
      setSelectedCell(null);
      setError(null);
    } catch (err: any) {
      console.error('Failed to parse Excel file', err);
      setError(err?.message || '解析 Excel 工作簿失败');
    }
  }, [arrayBuffer]);

  // Extract raw grid data for current sheet
  const { rows, maxCols } = useMemo(() => {
    if (!workbook || !currentSheet) return { rows: [], maxCols: 0 };
    const ws = workbook.Sheets[currentSheet];
    if (!ws) return { rows: [], maxCols: 0 };

    const raw = (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][]).slice(0, 1000);
    let cols = 0;
    raw.forEach((r) => {
      if (Array.isArray(r) && r.length > cols) cols = r.length;
    });

    return { rows: raw, maxCols: Math.max(cols, 8) };
  }, [workbook, currentSheet]);

  // Search matches
  const matchCount = useMemo(() => {
    if (!searchQuery.trim()) return 0;
    const q = searchQuery.toLowerCase();
    let count = 0;
    rows.forEach((row) => {
      row.forEach((cell) => {
        if (formatCellValue(cell).toLowerCase().includes(q)) count++;
      });
    });
    return count;
  }, [rows, searchQuery]);

  const handleCopyCell = () => {
    if (!selectedCell?.val) return;
    navigator.clipboard.writeText(selectedCell.val).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const selectedCoord = selectedCell
    ? `${getColumnLetter(selectedCell.col)}${selectedCell.row + 1}`
    : 'A1';

  return (
    <div className="flex h-full flex-col bg-surface text-main">
      {/* Top Toolbar & Formula Bar */}
      <div className="border-b border-edge bg-surface p-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Active Sheet Badge & Stats */}
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-success border border-emerald-500/20">
              <FileSpreadsheet className="h-4 w-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-main font-mono">{currentSheet || '工作表'}</span>
              <span className="ml-2 text-[11px] text-quiet font-mono">
                {rows.length} 行 × {maxCols} 列
              </span>
            </div>
          </div>

          {/* In-Sheet Search Box */}
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-quiet" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索单元格内容..."
              className="h-7.5 w-full rounded-lg border border-subtle/80 bg-canvas pl-8 pr-7 text-xs text-main outline-none focus:border-accent/50 transition-colors font-mono"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-quiet hover:text-sub"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {searchQuery && (
              <span className="absolute -bottom-4 right-0 text-[10px] text-success/90 font-mono">
                {matchCount} 处匹配
              </span>
            )}
          </div>
        </div>

        {/* Formula / Inspector Bar */}
        <div className="flex items-center gap-2 rounded-lg border border-edge/90 bg-canvas/70 px-2.5 py-1.5 text-xs font-mono">
          <div className="flex items-center gap-1 font-bold text-success bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex-shrink-0">
            <span>{selectedCoord}</span>
          </div>
          <div className="text-quiet select-none">|</div>
          <div className="min-w-0 flex-1 truncate text-sub select-text">
            {selectedCell ? selectedCell.val : (rows[0] && rows[0][0] !== undefined ? formatCellValue(rows[0][0]) : '')}
          </div>
          {selectedCell?.val && (
            <button
              onClick={handleCopyCell}
              className="flex-shrink-0 p-1 text-sub hover:text-success transition-colors"
              title="复制单元格内容"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Main Grid View */}
      <div className="relative flex-1 overflow-auto bg-canvas p-2">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center py-24 text-center">
            <AlertCircle className="h-9 w-9 text-danger mb-3" />
            <p className="text-sm font-medium text-sub">{error}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-24 text-center text-quiet">
            <Table className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-xs">该工作表为空</p>
          </div>
        ) : (
          <div className="inline-block min-w-full rounded-xl border border-edge bg-surface shadow-popover overflow-hidden">
            <table className="w-full border-collapse text-xs font-sans">
              <thead>
                <tr>
                  {/* Top-Left Corner Cell (Sticky) */}
                  <th className="sticky left-0 top-0 z-30 h-8 w-12 border-b border-r border-edge bg-canvas text-center font-mono text-[11px] font-semibold text-quiet select-none">
                    #
                  </th>

                  {/* Column Headers: A, B, C, D... (Sticky Top) */}
                  {Array.from({ length: maxCols }).map((_, colIdx) => {
                    const letter = getColumnLetter(colIdx);
                    const isColSelected = selectedCell?.col === colIdx;
                    return (
                      <th
                        key={colIdx}
                        className={`sticky top-0 z-20 h-8 min-w-[100px] max-w-[240px] px-2 text-center font-mono text-[11px] font-bold border-b border-r border-edge transition-colors select-none ${
                          isColSelected
                            ? 'bg-emerald-500/20 text-success border-b-emerald-500'
                            : 'bg-canvas text-sub hover:bg-hover'
                        }`}
                      >
                        {letter}
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {rows.map((row, rowIdx) => {
                  const isRowSelected = selectedCell?.row === rowIdx;
                  return (
                    <tr
                      key={rowIdx}
                      className={rowIdx % 2 === 0 ? 'bg-surface' : 'bg-canvas/50'}
                    >
                      {/* Row Header: 1, 2, 3... (Sticky Left) */}
                      <td
                        className={`sticky left-0 z-10 h-7 border-b border-r border-edge px-1 text-center font-mono text-[11px] select-none transition-colors ${
                          isRowSelected
                            ? 'bg-emerald-500/20 text-success font-bold'
                            : 'bg-canvas text-quiet'
                        }`}
                      >
                        {rowIdx + 1}
                      </td>

                      {/* Cells */}
                      {Array.from({ length: maxCols }).map((_, colIdx) => {
                        const cellVal = row[colIdx];
                        const formatted = formatCellValue(cellVal);
                        const isSelected = selectedCell?.row === rowIdx && selectedCell?.col === colIdx;
                        const align = getCellAlignment(cellVal);
                        const isMatched = searchQuery.trim() && formatted.toLowerCase().includes(searchQuery.toLowerCase());

                        return (
                          <td
                            key={colIdx}
                            onClick={() => setSelectedCell({ row: rowIdx, col: colIdx, val: formatted })}
                            className={`h-7 max-w-[260px] truncate border-b border-r border-edge/80 px-2.5 py-1 text-xs cursor-cell transition-all font-mono ${
                              align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
                            } ${
                              isSelected
                                ? 'bg-emerald-500/25 ring-2 ring-emerald-400 ring-inset text-main font-semibold z-10'
                                : isMatched
                                ? 'bg-amber-500/25 text-warning'
                                : 'text-sub hover:bg-hover/50'
                            }`}
                            title={formatted}
                          >
                            {formatted}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bottom Sheet Tabs Bar (Like Real Excel) */}
      {workbook && workbook.SheetNames.length > 0 && (
        <div className="flex items-center gap-1 border-t border-edge bg-surface px-3 py-1.5 overflow-x-auto scrollbar-none">
          <div className="flex items-center gap-1 mr-2 text-[11px] text-quiet font-mono select-none flex-shrink-0">
            <Layers className="h-3.5 w-3.5 text-success" />
            <span>工作表:</span>
          </div>

          {workbook.SheetNames.map((name) => {
            const isActive = name === currentSheet;
            return (
              <button
                key={name}
                onClick={() => {
                  setCurrentSheet(name);
                  setSelectedCell(null);
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-mono font-medium transition-all flex-shrink-0 ${
                  isActive
                    ? 'bg-emerald-500/20 text-success border border-emerald-500/40 shadow-soft'
                    : 'border border-edge bg-surface/60 text-sub hover:text-main hover:bg-hover'
                }`}
              >
                <span>{name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
