// Keep the host's connected silhouette and remove detached matting debris.
import fs from 'node:fs';
const [input, output] = process.argv.slice(2);
const keepCount = Number(process.argv[4] || 1);
const alpha = fs.readFileSync(input);
const width = 1920, height = 1080, size = width * height;
if (alpha.length !== size) throw new Error('Expected 1920x1080 alpha plane');
const labels = new Int32Array(size), queue = new Int32Array(size);
let nextLabel = 0, largestLabel = 0, largestSize = 0;
const components = [];
for (let start = 0; start < size; start++) {
  if (labels[start] || alpha[start] < 16) continue;
  const label = ++nextLabel;
  let head = 0, tail = 1;
  queue[0] = start; labels[start] = label;
  while (head < tail) {
    const p = queue[head++], x = p % width;
    for (const n of [x > 0 ? p - 1 : -1, x + 1 < width ? p + 1 : -1,
                     p >= width ? p - width : -1, p + width < size ? p + width : -1]) {
      if (n >= 0 && labels[n] === 0 && alpha[n] >= 16) {
        labels[n] = label; queue[tail++] = n;
      }
    }
  }
  if (tail > largestSize) { largestSize = tail; largestLabel = label; }
  components.push([label, tail]);
}
if (largestSize < 10000) throw new Error('No substantial host silhouette found');
const retained = new Set(components.sort((a,b)=>b[1]-a[1]).slice(0, keepCount).map(c=>c[0]));
const clean = Buffer.alloc(size);
for (let p = 0; p < size; p++) {
  if (!alpha[p]) continue;
  let keep = retained.has(labels[p]);
  if (!keep && alpha[p] < 16) {
    const x = p % width, y = Math.floor(p / width);
    for (let dy = -2; dy <= 2 && !keep; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height &&
          retained.has(labels[p + dy * width + dx])) { keep = true; break; }
    }
  }
  if (keep) clean[p] = alpha[p] > 245 ? 255 : alpha[p];
}
fs.writeFileSync(output, clean);
