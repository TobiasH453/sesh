// Square-cornered stroke icons, 24x24.

const PATHS = {
  heart: 'M12 20.5 3.5 12V6.5L6.5 3.5h3L12 6l2.5-2.5h3l3 3V12Z',
  comment: 'M3.5 4.5h17v11.5h-11l-4 4v-4h-2Z',
  share: 'M12 3.5v11M7.5 8 12 3.5 16.5 8M4.5 12.5v8h15v-8',
  soundOn: 'M3.5 9h4l5-4v14l-5-4h-4ZM16 9v6M19.5 6.5v11',
  soundOff: 'M3.5 9h4l5-4v14l-5-4h-4ZM15.5 9.5l5 5M20.5 9.5l-5 5',
  close: 'M5.5 5.5l13 13M18.5 5.5l-13 13',
  trash: 'M4 6.5h16M9 6.5v-3h6v3M6.5 6.5l1 14h9l1-14',
  back: 'M15 4.5 7.5 12l7.5 7.5',
  flip: 'M4 9.5h13l-3.5-3.5M20 14.5H7l3.5 3.5',
  play: 'M7 4.5v15l12-7.5Z',
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}
