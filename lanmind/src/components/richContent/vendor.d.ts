declare module '@plantuml/core' {
  export function renderToString(lines: string[], success: (svg: string) => void, failure: (error: string) => void,
    options?: { dark?: boolean; maxSvgSize?: number }): void;
}
declare module '@plantuml/core/themes.js';
declare module 'mammoth/mammoth.browser' {
  import mammoth = require('mammoth');
  export = mammoth;
}
