const P = {
  chart: <><path d="M4 19V5" /><path d="M4 19h16" /><rect x="7" y="11" width="3" height="5" /><rect x="12" y="8" width="3" height="8" /><rect x="17" y="13" width="3" height="3" /></>,
  layers: <><path d="M12 4 3 8.5 12 13l9-4.5L12 4Z" /><path d="m3 13.5 9 4.5 9-4.5" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" /><rect x="13" y="4" width="7" height="7" /><rect x="4" y="13" width="7" height="7" /><rect x="13" y="13" width="7" height="7" /></>,
  factory: <><path d="M4 20V10l5 3V10l5 3V6l6 3v11Z" /><path d="M4 20h16" /></>,
  box: <><path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" /><path d="m4 7 8 4 8-4" /><path d="M12 11v10" /></>,
  trend: <><path d="M4 16l5-5 3 3 7-7" /><path d="M15 7h4v4" /></>,
  calendar: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 10h16" /><path d="M9 3v4" /><path d="M15 3v4" /><path d="M8 14h2.5" /><path d="M14 14h2" /><path d="M8 17.5h2.5" /></>,
  book: <><path d="M5 5a2 2 0 0 1 2-2h12v18H7a2 2 0 0 1-2-2Z" /><path d="M9 3v18" /></>,
  filter: <><path d="M4 5h16l-6.5 7.5V19l-3-2v-4.5Z" /></>,
  reset: <><path d="M4 12a8 8 0 1 1 2.6 5.9" /><path d="M4 19v-5h5" /></>,
  print: <><path d="M7 9V4h10v5" /><rect x="4" y="9" width="16" height="7" rx="1.5" /><path d="M7 16h10v4H7z" /></>,
  user: <><circle cx="12" cy="9" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
  logout: <><path d="M14 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7" /><path d="m17 15 3-3-3-3" /><path d="M20 12h-8" /></>,
  menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
}

export default function Icon({ name, size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      {P[name] || null}
    </svg>
  )
}
