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
  // oltre all'indirizzo con l'orario si passa anche "beginTime" (letto dall'app per scegliere il giorno da mostrare)
  return `intent://com.android.calendar/time/${ms}#Intent;scheme=content;action=android.intent.action.VIEW;`
    + `package=com.google.android.calendar;l.beginTime=${ms};l.endTime=${ms + 3600000};`
    // vista giorno invece di quella predefinita (extra "VIEW"/"DETAIL_VIEW" del calendario Android)
    + `S.VIEW=DAY;B.DETAIL_VIEW=true;`
    + `S.browser_fallback_url=${encodeURIComponent(web)};end`;
}

/**
 * «Spostamenti» di Google Maps al giorno indicato. Su Android si passa all'app Maps l'indirizzo della cronologia
 * (lo stesso della vecchia versione web, con la data nel parametro "pb"); se l'app non c'è si apre l'indirizzo nel browser.
 */
export function timelineUrl(date: string): string {
  const path = `www.google.com/maps/timeline?pb=!1m2!1m1!1s${date}`;
  if (!isAndroid) return `https://${path}`;
  return `intent://${path}#Intent;scheme=https;action=android.intent.action.VIEW;package=com.google.android.apps.maps;`
    + `S.browser_fallback_url=${encodeURIComponent('https://' + path)};end`;
}
