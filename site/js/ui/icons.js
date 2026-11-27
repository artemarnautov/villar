// Inline SVG icons (static, trusted markup). Owner: interface.
const s = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;

export const ICONS = {
  mark: `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8.5" fill="currentColor"/><path d="M9.2 9.5 16 22.6l6.8-13.1" fill="none" stroke="#f6f1ea" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  close: s('<path d="M6 6l12 12M18 6 6 18"/>', 'stroke-width="2"'),
  pin: s('<path d="M9.4 3.6h5.2l-.9 5.1 2.9 2.9v1.6H7.4v-1.6l2.9-2.9z"/><path d="M12 13.2v7.2"/>', 'stroke-width="1.8"'),
  plus: s('<path d="M12 5.5v13M5.5 12h13"/>', 'stroke-width="2"'),
  check: s('<path d="M5 12.5l4.2 4.2L19 7"/>', 'stroke-width="2.2"'),
  chevronDown: s('<path d="M6 9l6 6 6-6"/>', 'stroke-width="2.2"'),
  chevronRight: s('<path d="M9 6l6 6-6 6"/>', 'stroke-width="2"'),
  chevronLeft: s('<path d="M15 6l-6 6 6 6"/>', 'stroke-width="2.2"'),
  camera: s('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.4" r="3.4"/>', 'class="cam"'),
  morning: s('<path d="M3 19h18M7 19a5 5 0 0 1 10 0"/><path d="M12 11V3.5M9 6.5l3-3 3 3"/><path d="M4.2 13.6l1.5.9M19.8 13.6l-1.5.9"/>'),
  day: s('<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>'),
  golden: s('<path d="M3 19h18M7 19a5 5 0 0 1 10 0"/><path d="M12 3.5V11M9 8l3 3 3-3"/><path d="M4.2 13.6l1.5.9M19.8 13.6l-1.5.9"/>'),
  evening: s('<path d="M19.5 14.6A7.6 7.6 0 0 1 9.4 4.5a7.6 7.6 0 1 0 10.1 10.1z"/>'),
  drag: s('<path d="M9 11V5.8a1.6 1.6 0 1 1 3.2 0V11m0-1.2V4.6a1.6 1.6 0 1 1 3.2 0v5.6m0-3.2a1.6 1.6 0 1 1 3.2 0v6.6c0 3.9-2.8 6.9-6.6 6.9-2.6 0-4.1-1-5.6-3l-2.6-3.8a1.6 1.6 0 0 1 2.4-2.1L9 14.4"/>'),
  sparkle: s('<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.5 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'),
  palette: s('<path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.2 0 1.9-.8 1.9-1.8 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8h2.1a4.4 4.4 0 0 0 4.4-4.4c0-3.9-4-7.1-9.2-7.1z"/><circle cx="7.6" cy="11.4" r="1.2"/><circle cx="10.4" cy="7.4" r="1.2"/><circle cx="15.2" cy="7.6" r="1.2"/>'),
  cube: s('<path d="M12 2.8l8 4.4v9.6l-8 4.4-8-4.4V7.2z"/><path d="M4.3 7.4 12 11.8l7.7-4.4M12 11.8v9.2"/>'),
  truck: s('<path d="M2.8 6.5h11v9.5h-11zM13.8 9.5h4l2.6 3.2v3.3h-6.6"/><circle cx="7" cy="17.4" r="1.9"/><circle cx="17" cy="17.4" r="1.9"/>'),
  tools: s('<path d="M14.6 6.3a3.9 3.9 0 0 0 4.9 4.9l-8.6 8.6a2.1 2.1 0 1 1-3-3z"/><path d="M14.6 6.3l2.4-2.4M19.5 11.2l1.7-1.7"/>'),
  key: s('<circle cx="8" cy="14.5" r="4"/><path d="M11 11.6 20 2.8M16.8 6l2.4 2.4M14.4 8.4l1.8 1.8"/>'),
  bag: s('<path d="M5 8h14l-1 12.5H6z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>'),
  reset: s('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>'),
  shield: s('<path d="M12 3l7 2.8v5.5c0 4.5-3 8.2-7 9.7-4-1.5-7-5.2-7-9.7V5.8z"/><path d="M8.8 12l2.2 2.2 4.4-4.4"/>'),
};

export const icon = (name) => ICONS[name] || '';
