import type { Page } from '@playwright/test';

/** Measure ordinary visible text on flat surfaces, compositing translucent backgrounds. */
export const contrastIssues = (page: Page) => page.evaluate(() => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const rgba = (color: string) => {
    ctx.clearRect(0,0,1,1); ctx.fillStyle = color; ctx.fillRect(0,0,1,1);
    const value = Array.from(ctx.getImageData(0,0,1,1).data);
    return [value[0], value[1], value[2], value[3]/255];
  };
  const luminance = (rgb: number[]) => rgb.slice(0,3).map(v => {
    const n = v/255;
    return n <= .04045 ? n/12.92 : ((n+.055)/1.055)**2.4;
  }).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
  const issues: Array<{text:string; ratio:number; color:string; className:string}> = [];
  for(const el of document.querySelectorAll<HTMLElement>('button,span,p,label,h1,h2,h3,h4,td,th,a,code')) {
    if(![...el.childNodes].some(node=>node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) continue;
    const rect = el.getBoundingClientRect();
    if(!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight) continue;
    if(el.closest('[disabled], [aria-disabled="true"], .docx-render-wrapper, [data-document-content]')) continue;
    let ancestor: HTMLElement | null = el;
    const layers: number[][] = [];
    let skip = false;
    while(ancestor) {
      const style = getComputedStyle(ancestor);
      if(style.visibility === 'hidden' || Number(style.opacity) < .99 || style.backgroundImage !== 'none') { skip = true; break; }
      layers.push(rgba(style.backgroundColor));
      if(layers.at(-1)![3] === 1) break;
      ancestor = ancestor.parentElement;
    }
    if(skip) continue;
    let background = [255,255,255];
    for(const layer of layers.reverse()) background=background.map((c,i)=>layer[i]*layer[3]+c*(1-layer[3]));
    const style = getComputedStyle(el);
    const fg = rgba(style.color);
    const foreground = background.map((c,i)=>fg[i]*fg[3]+c*(1-fg[3]));
    const l1=luminance(foreground), l2=luminance(background);
    const ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
    const large = parseFloat(style.fontSize)>=24 || (parseFloat(style.fontSize)>=18.66 && Number(style.fontWeight)>=700);
    if(ratio < (large ? 3 : 4.5)-.02) issues.push({text:el.textContent!.trim().slice(0,45),ratio:Math.round(ratio*100)/100,color:style.color,className:el.className});
  }
  return issues;
});
