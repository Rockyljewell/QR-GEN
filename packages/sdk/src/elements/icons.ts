const svg = (body: string, size = 22) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  torch: svg('<path d="M8 2h8l-1 6H9z"/><path d="M9 8h6v3l-1 2v8a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-8l-1-2z"/><path d="M12 14v2"/>'),
  torchOn: svg('<path d="M8 2h8l-1 6H9z" fill="currentColor"/><path d="M9 8h6v3l-1 2v8a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-8l-1-2z" fill="currentColor"/>'),
  switchCamera: svg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><path d="M9.5 13.5a2.5 2.5 0 0 0 4.3 1.7M14.5 12.5a2.5 2.5 0 0 0-4.3-1.7"/><path d="M14 15.4v-1.9h-1.9M10 10.6v1.9h1.9"/>'),
  pause: svg('<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 18),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>', 30),
  alert: svg('<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.01"/>', 30),
  scan: svg('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 12h10"/>', 30),
} as const;
