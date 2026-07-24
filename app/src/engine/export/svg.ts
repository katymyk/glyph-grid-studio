import type { Scene } from '../../domain/scene';
import { resolveScene } from '../placements';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Serialize a scene at time t to SVG, from the same placements the canvas paints. */
export function sceneToSVG(scene: Scene, t: number): string {
  const { width: W, height: H } = scene;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n`;
  if (scene.background) svg += `<rect width="${W}" height="${H}" fill="${scene.background}"/>\n`;
  for (const layer of resolveScene(scene, t)) {
    svg += `<g opacity="${layer.opacity}">\n`;
    for (const p of layer.placements) {
      const deg = (p.rotation * 180) / Math.PI;
      const tr = deg ? ` transform="rotate(${deg.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)})"` : '';
      const fam = p.font.split(',')[0].replace(/"/g, '');
      svg +=
        `<text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" font-family="${esc(fam)}" ` +
        `font-weight="${p.weight}" font-size="${p.size.toFixed(2)}" fill="${p.color}" ` +
        `text-anchor="middle" dominant-baseline="central" opacity="${p.alpha}"${tr}>${esc(p.glyph)}</text>\n`;
    }
    svg += `</g>\n`;
  }
  svg += '</svg>';
  return svg;
}
