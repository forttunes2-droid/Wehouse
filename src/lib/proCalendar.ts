type CalendarEntry = { id: string; title: string; start: string; end?: string };
const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0,10)) ? value.slice(0,10).replaceAll('-','') : null;
export function calendarText(entries: CalendarEntry[], now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//WeHouse//Pro Calendar//EN','CALSCALE:GREGORIAN'];
  for (const row of entries) {
    const start = day(row.start);
    if (!start) continue;
    const end = day(row.end || '');
    lines.push('BEGIN:VEVENT', 'UID:' + escape(row.id) + '@wehouse', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + start);
    if (end && end > start) lines.push('DTEND;VALUE=DATE:' + end);
    lines.push('SUMMARY:' + escape(row.title), 'DESCRIPTION:WeHouse calendar snapshot. Re-export after booking changes.', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // Fold at 75 UTF-8 octets, without splitting a Unicode character.
  return lines.map(line => {
    let folded = '', part = '';
    for (const char of line) {
      if (new TextEncoder().encode(part + char).length > 75) { folded += part + '\r\n'; part = ' '; }
      part += char;
    }
    return folded + part;
  }).join('\r\n') + '\r\n';
}
export function downloadCalendar(entries: CalendarEntry[], filename: string) {
  const url = URL.createObjectURL(new Blob([calendarText(entries)], {type:'text/calendar;charset=utf-8'}));
  const link = document.createElement('a'); link.href=url; link.download=filename; link.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
