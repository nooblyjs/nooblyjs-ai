import { raw } from './html.js';

const svg = (paths) =>
  raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`);

export const icons = {
  team: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 4.9a3.2 3.2 0 0 1 0 6.2"/><path d="M17.5 14.2c1.6.6 2.7 2.2 3 4.8"/>'),
  profile: svg('<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16.2c.5-1.6 1.7-2.4 3.2-2.4s2.7.8 3.2 2.4"/><path d="M14.5 10h4M14.5 13.5h4"/>'),
  billing: svg('<path d="M6 3h12v18l-2.2-1.4L13.6 21l-1.6-1.4L10.4 21l-2.2-1.4L6 21z"/><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3"/>'),
  hire: svg('<circle cx="10" cy="8" r="3.2"/><path d="M4 19c.6-3.2 3-5 6-5 1.4 0 2.7.4 3.7 1.1"/><path d="M18 13v6M15 16h6"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  arrowRight: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  upload: svg('<path d="M12 16V5M7 10l5-5 5 5"/><path d="M5 19h14"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  chevronLeft: svg('<path d="m15 6-6 6 6 6"/>'),
  chevronRight: svg('<path d="m9 6 6 6-6 6"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/>'),
  trash: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'),
  memory: svg('<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z"/><path d="M5 20.5A2.5 2.5 0 0 1 7.5 18H19v3H7.5"/><path d="M9 7.5h6M9 11h4"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2.5 2.5M14 9l2 2"/>'),
  signOut: svg('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M9 16l-4-4 4-4M5 12h10"/>'),
  pin: svg('<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  settings: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  alert: svg('<path d="M12 4 3 19h18z"/><path d="M12 10v4M12 16.5v.5"/>'),
  doc: svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 15.5h5"/>'),
};
