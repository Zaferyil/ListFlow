/**
 * Regenerates every app icon from public/logo.png: `node scripts/icons.cjs`.
 *
 * The icons are checked in rather than built, so the app has them without a
 * build step — this is how they were made, and how to remake them when the
 * logo changes.
 */
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const R = require('path').join(__dirname, '..');

const data = 'data:image/png;base64,' + fs.readFileSync(R + '/public/logo.png').toString('base64');
const SRC = 1254;

// The supplied logo already draws a rounded card with a margin around it. A
// phone rounds the icon itself, so the card is cropped to fill the frame;
// otherwise the two roundings stack into a visible border.
const CROP = { x: 96, y: 92, size: 1064 };

function full(size) {
  const scale = size / CROP.size;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="#1a1433"/>
    <g transform="scale(${scale}) translate(${-CROP.x} ${-CROP.y})">
      <image xlink:href="${data}" width="${SRC}" height="${SRC}"/>
    </g>
  </svg>`;
}

// Android crops to its own shape, so the whole logo — margin included — is
// stood back from the edge far enough that a circle cannot reach the tag.
function maskable(size) {
  const inset = size * 0.06;
  const inner = size - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="#1a1433"/>
    <image xlink:href="${data}" x="${inset}" y="${inset}" width="${inner}" height="${inner}"/>
  </svg>`;
}

const out = [
  [R + '/src/app/icon.png', full(256), 256],
  [R + '/src/app/apple-icon.png', full(180), 180],
  [R + '/public/icon-192.png', full(192), 192],
  [R + '/public/icon-512.png', full(512), 512],
  [R + '/public/icon-maskable-512.png', maskable(512), 512],
];

for (const [path, svg, size] of out) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path, png);
  console.log(path.replace(R + '/', ''), size + 'px', Math.round(png.length / 1024) + ' KB');
}
