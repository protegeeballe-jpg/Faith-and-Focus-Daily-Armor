export function isValidDiaryArchiveDate(dateString) {
  if (typeof dateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return false;
  }

  const date = new Date(dateString + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime())
    && date.toISOString().slice(0, 10) === dateString;
}
