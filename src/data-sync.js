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

  // Columns C..R (3..18): 4 months x 4 weeks each.
  const months = [];
  for (let block = 0; block < 4; block++) {
    const colStart = 3 + block * 4;
    const monthLabel = cleanMonthName(monthRow.getCell(colStart).value);
    const weekLabels = [0, 1, 2, 3].map((k) => String(weekRow.getCell(colStart + k).value || '').trim());
    months.push({ name: monthLabel, colStart, weekLabels });
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

function cleanMonthName(raw) {
  const text = String(raw || '');
  const match = text.match(/\(([^)]+)\)/);
  const word = (match ? match[1] : text).trim().toLowerCase();
  if (MONTH_FIXES[word]) return MONTH_FIXES[word];
  return word ? word[0].toUpperCase() + word.slice(1) : 'Month';
}

module.exports = { parseWorkbookFile };
