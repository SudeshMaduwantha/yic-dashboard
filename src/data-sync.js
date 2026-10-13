const ExcelJS = require('exceljs');

const MONTH_FIXES = {
  augest: 'August',
  auguest: 'August',
};

async function parseWorkbookFile(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const result = {};
  wb.eachSheet((sheet) => {
    if (sheet.name.trim().toLowerCase() === 'dashboard') return;
    result[sheet.name] = parseSportSheet(sheet);
  });
  return result;
}

function parseSportSheet(sheet) {
  const weekHeaderRow = findWeekHeaderRow(sheet);
  if (!weekHeaderRow) return [];

  // Header is 3 rows above the data: month name, then a "Week" label row, then 1st/2nd/3rd/4th.
  const monthRowNum = weekHeaderRow - 2;
  const monthRow = sheet.getRow(monthRowNum);
  const weekRow = sheet.getRow(weekHeaderRow);

  // Month blocks start at column C and run as far right as the sheet goes — one
  // block per month, each as wide as its week labels (1st..4th, or 1st..5th when a
  // month had a 5th class day). Not a fixed 4-month window, so new months added to
  // the sheet (September onwards) are picked up without code changes.
  const months = [];
  const lastCol = Math.max(sheet.columnCount, weekRow.cellCount);
  let col = 3;
  while (col <= lastCol) {
    if (weekOrdinal(weekRow.getCell(col).value) !== '1st') { col++; continue; }
    const colStart = col;
    const weekLabels = [];
    while (col <= lastCol) {
      const label = weekOrdinal(weekRow.getCell(col).value);
      if (!label || (label === '1st' && weekLabels.length)) break;
      weekLabels.push(label);
      col++;
    }
    months.push({ name: cleanMonthName(monthRow.getCell(colStart).value), colStart, weekLabels });
  }

  const students = [];
  for (let r = weekHeaderRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const name = row.getCell(1).value;
    if (!name || !String(name).trim()) continue;

    const studentMonths = months.map((m) => {
      const weeks = m.weekLabels.map((label, k) => {
        const raw = row.getCell(m.colStart + k).value;
        return {
          label,
          present: raw === 1 || raw === '1',
          marked: raw === 1 || raw === 0 || raw === '1' || raw === '0',
        };
      });
      return { name: m.name, weeks };
    });

    students.push({
      name: String(name).trim(),
      grade: row.getCell(2).value != null ? String(row.getCell(2).value).trim() : '',
      months: studentMonths,
    });
  }
  return students;
}

function findWeekHeaderRow(sheet) {
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const c3 = String(row.getCell(3).value || '').trim().toLowerCase();
    const c4 = String(row.getCell(4).value || '').trim().toLowerCase();
    if (c3.startsWith('1st') && c4.startsWith('2nd')) return r;
  }
  return null;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "1st", "2nd week", "5th" -> "1st".."5th"; anything else (blank, "Total") -> null.
function weekOrdinal(raw) {
  const match = String(raw || '').trim().toLowerCase().match(/^([1-5])(st|nd|rd|th)/);
  return match ? `${match[1]}${match[2]}` : null;
}

function cleanMonthName(raw) {
  const text = String(raw || '');
  const match = text.match(/\(([^)]+)\)/);
  const word = (match ? match[1] : text).trim().toLowerCase();
  if (MONTH_FIXES[word]) return MONTH_FIXES[word];
  // Accept abbreviations/typos like "Sept", "Oct", "Novemebr" by their first 3 letters.
  const full = MONTH_NAMES.find((m) => word.startsWith(m.slice(0, 3).toLowerCase()));
  if (full) return full;
  return word ? word[0].toUpperCase() + word.slice(1) : 'Month';
}

module.exports = { parseWorkbookFile };
