// This is an original adapter smoke game, not a Construct-engine export.
const adapter = globalThis.__C3MiniGameAdapter;
const canvas = adapter.canvas;
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D is unavailable');
let score = Number(localStorage.getItem('smoke-score') || 0);
let resourceStatus = 'Loading local JSON';
let touching = false;
let time = 0;
let lastTime = 0;
const pause = () => { touching = false; };
document.addEventListener('visibilitychange', pause);
canvas.addEventListener('pointerdown', () => {
  score += 1;
  touching = true;
  localStorage.setItem('smoke-score', String(score));
  globalThis.__C3SmokeState.score = score;
});
canvas.addEventListener('pointerup', () => { touching = false; });
canvas.addEventListener('pointercancel', pause);
globalThis.__C3SmokeState = { platform: adapter.platform, score, resourceLoaded: false, frames: 0 };
fetch('config.json').then(response => {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}).then(config => {
  resourceStatus = config.message;
  globalThis.__C3SmokeState.resourceLoaded = true;
}).catch(error => { resourceStatus = `Resource failed: ${error.message}`; });

function draw(now) {
  time += Math.min((now - lastTime) / 1000 || 0, 0.05);
  lastTime = now;
  const width = canvas.width;
  const height = canvas.height;
  const scale = width / 390;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  const h = height / scale;
  context.fillStyle = '#101820'; context.fillRect(0, 0, 390, h);
  context.fillStyle = '#90b9c6'; context.font = '12px sans-serif'; context.textAlign = 'left';
  context.fillText('CONSTRUCT 3 / ADAPTER CHECK', 28, 43);
  context.fillStyle = '#f5f6f0'; context.font = 'bold 30px sans-serif';
  context.fillText(({wechat: 'WECHAT', douyin: 'DOUYIN', tiktok: 'TIKTOK'}[adapter.platform] || adapter.platform), 28, 88);
  context.fillStyle = '#b1bfc3'; context.font = '14px sans-serif';
  context.fillText('Tap anywhere. Your count is saved locally.', 28, 118);
  const radius = touching ? 86 : 76 + Math.sin(time * 2) * 4;
  const y = h * 0.47;
  context.beginPath(); context.arc(195, y, radius, 0, Math.PI * 2);
  context.fillStyle = touching ? '#ffd07a' : '#97e3bd'; context.fill();
  context.fillStyle = '#101820'; context.textAlign = 'center'; context.font = 'bold 48px sans-serif';
  context.fillText(String(score), 195, y + 16);
  context.fillStyle = '#eaf0ee'; context.font = '15px sans-serif'; context.fillText(resourceStatus, 195, h - 85);
  context.fillStyle = '#90a7af'; context.font = '12px sans-serif';
  context.fillText('Canvas · Touch · Storage · Local fetch', 195, h - 56);
  context.fillText('Adapter smoke test — not a Construct game', 195, h - 35);
  globalThis.__C3SmokeState.frames++;
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
