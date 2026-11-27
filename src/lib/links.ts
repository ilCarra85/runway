// Collegamenti verso altre app (solo da telefono).

const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';
export const isAndroid = /Android/i.test(UA);
export const isPhone = isAndroid || /iPhone|iPod/i.test(UA);

/** Google Calendar web aperto sul giorno indicato (data ISO AAAA-MM-GG). */
export const calendarWebUrl = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return `https://calendar.google.com/calendar/r/day/${y}/${m}/${d}`;
};

/**
 * Calendario alla data del movimento. Su Android si prova l'app Google Calendar
 * (intent "content://com.android.calendar/time/<millisecondi>"); se non c'è si apre il calendario web.
 */
export function calendarUrl(date: string, time?: string): string {
  const web = calendarWebUrl(date);
  if (!isAndroid) return web;
  const ms = new Date(`${date}T${time || '12:00'}:00`).getTime();
  return `intent://com.android.calendar/time/${ms}#Intent;scheme=content;package=com.google.android.calendar;S.browser_fallback_url=${encodeURIComponent(web)};end`;
}
