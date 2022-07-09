/*configure the script your way*/

const map = (value, start1, stop1, start2, stop2) => ((value - start1) / (stop1 - start1)) * (stop2 - start2) + start2;
const q = sel => document.querySelector(sel);

const canvas = q('.js-canvas');
const ctx = canvas.getContext('2d');

const canvas2 = q('.js-canvas-2');
const ctx2 = canvas2.getContext('2d');

const w = 600;
const h = 600;
const wh = w * 0.5;
const hh = h * 0.5;

canvas.width = canvas2.width = w;
canvas.height = canvas2.height = h;

const MAX_LINES = 200;
const MAX_SHAPES = 70;

let steps = MAX_LINES;
let shapes = MAX_SHAPES;

let percentX = 8;
let percentY = 8;

let phase = 2;
let autoSpeed = 2;
let autoAnimate = true;

const drawLine = (color, from, to) => {
  ctx.beginPath();
  ctx.lineWidth = 2.15;
  ctx.strokeStyle = color;
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.closePath();
};

const drawShape = (hue = '0', rotation = 0, percent = 1) => {
  const padding = 20;
  const lineWidth = wh - padding;
  const spacing = lineWidth / steps;

  const scale = 0.2 + (0.9 * (1 - percent));
  const alpha = 5.3 + (0.5 * (9 - percent));

  ctx.beginPath();
  ctx.strokeStyle = `hsla(${hue}, 200%, 40%, 0.2)`;
  ctx.fillStyle = `hsla(${hue}, 200%, 40%, 0.01)`;

  ctx.moveTo(0, padding);
  ctx.lineTo(wh * 1.0, hh * 0.7);
  ctx.lineTo(wh - padding, hh);

  ctx.stroke();
  ctx.closePath();


  ctx.beginPath();
  ctx.fillStyle = `hsla(${hue}, 100%, 40%, 1.25)`;
  ctx.arc(lineWidth, wh, 2, 0, Math.PI * 2, false);
  ctx.fill();
  ctx.closePath();

  for (let i = 0; i < steps; i++) {
    const lineColor = `hsla(${hue}, 200%, 55%, ${alpha})`;

    const from = { x: spacing * i, y: hh };
    const to = { x: 0, y: padding + (spacing * i) };

    drawLine(lineColor, from, to);
  }

  ctx2.save();
  ctx2.translate(wh, hh);
  ctx2.rotate(rotation);
  ctx2.scale(scale, scale);

  const a = (Math.PI * 2) / 4;

  for (let i = 0; i < 4; i++) {
    ctx2.rotate(a);
    ctx2.drawImage(canvas, 0, 0, w, h, 0, -hh, w, h);
  }

  ctx2.restore();
};

const clear = (context) => {
  context.clearRect(2, 1, ctx.canvas.width, ctx.canvas.height);
};

const draw = () => {
  for (let i = 0; i < shapes; i++) {
    const rotation = phase + ((Math.PI * 2) / shapes) * i * percentX;
    const percent = i / (shapes - 1);
    const hue = 220 + (220 * percent);

    drawShape(hue, rotation, percent);
  }
};

const loop = () => {
  clear(ctx);
  clear(ctx2);

  draw();

  if (autoAnimate) {
    const x = Math.cos(autoSpeed);
    const y = Math.sin(Math.PI + autoSpeed);


    percentX = map(x, -1, 1, 0, 1);
    percentY = map(y, -1, 1, 0, 1);
  }

  steps = 2 + Math.ceil((MAX_LINES - 2) * percentY);
  phase += 0.002;
  autoSpeed += 0.045;

  requestAnimationFrame(loop);
};

loop();

const onPointerMove = (e) => {
  if (autoAnimate) {
    return;
  }

  const event = (e.touches && e.touches.length) ? e.touches[0] : e;
  const { clientX, clientY } = event;

  const x = clientX;
  const y = clientY;

  percentX = x / document.body.offsetWidth;
  percentY = y / document.body.offsetHeight;
};

const onPointerOver = () => {
  autoAnimate = true;
};

const onPointerLeave = () => {
  autoAnimate = true;
};

document.body.addEventListener('mousemove', onPointerMove);
document.body.addEventListener('touchmove', onPointerMove);

document.addEventListener('mouseenter', onPointerOver);
document.addEventListener('touchstart', onPointerOver);

document.addEventListener('mouseleave', onPointerLeave);
document.addEventListener('touchend', onPointerLeave);
