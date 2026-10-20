/* =========================================================
   Ball Hit - a small brick-breaker arcade game
   Sections:
     1. Config and level data
     2. Game state
     3. DOM references
     4. Setup and input
     5. Level loader
     6. Update (movement, collisions)
     7. Renderer
     8. Game flow (start, lose life, level up, end)
     9. Main loop
   ========================================================= */

"use strict";

/* ---------- 1. Config and level data ---------- */

const WIDTH = 800;
const HEIGHT = 600;

const PADDLE_W = 110;
const PADDLE_H = 14;
const PADDLE_Y = HEIGHT - 40;
const PADDLE_KEY_SPEED = 9;   // pixels per frame at 60fps

const BALL_R = 8;
const START_LIVES = 3;
const LEVEL_PAUSE_MS = 1800;  // how long the "Level Up" banner stays up

// Brick grid: 10 columns, centred. 10*68 + 9*6 = 734 wide, so 33px margin each side.
const BRICK_W = 68;
const BRICK_H = 24;
const BRICK_GAP = 6;
const BRICK_COLS = 10;
const GRID_LEFT = (WIDTH - (BRICK_COLS * BRICK_W + (BRICK_COLS - 1) * BRICK_GAP)) / 2;
const GRID_TOP = 70;

// Each row is a string of 10 characters. 0 = empty, 1-3 = hits needed to break.
// Every row is a palindrome so the layouts stay symmetric.
const LEVELS = [
  {
    name: "Warm Up",
    speed: 5,
    rows: [
      "1111111111",
      "1111111111",
      "1111111111",
      "1111111111",
    ],
  },
  {
    name: "Fortress",
    speed: 5.8,
    rows: [
      "2222222222",
      "1111111111",
      "1122222211",
      "0011111100",
      "0001111000",
    ],
  },
  {
    name: "Crossfire",
    speed: 6.6,
    rows: [
      "3300000033",
      "2222222222",
      "1212112121",
      "0111111110",
      "0030000300",
      "1111111111",
    ],
  },
  {
    name: "Final Wall",
    speed: 7.4,
    rows: [
      "3333333333",
      "3222222223",
      "3211111123",
      "3210000123",
      "2213333122",
      "1100000011",
    ],
  },
];

// Brick colour by hits remaining
const BRICK_COLORS = { 1: "#4fe3c1", 2: "#ffb84d", 3: "#ff6b81" };

/* ---------- 2. Game state ---------- */

let state = "start";   // start | ready | playing | paused | levelup | over | win
let score = 0;
let highScore = 0;
let level = 0;         // index into LEVELS
let lives = START_LIVES;

const paddle = { x: (WIDTH - PADDLE_W) / 2, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H };
const ball = { x: 0, y: 0, vx: 0, vy: 0, speed: 5 };

let bricks = [];
let particles = [];
let trail = [];
let keys = { left: false, right: false };
let lastTime = 0;
let levelTimer = null;

/* ---------- 3. DOM references ---------- */

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const hudScore = document.getElementById("hud-score");
const hudHigh = document.getElementById("hud-high");
const hudLevel = document.getElementById("hud-level");
const hudLives = document.getElementById("hud-lives");

const banner = document.getElementById("banner");
const screenStart = document.getElementById("screen-start");
const screenOver = document.getElementById("screen-over");
const screenWin = document.getElementById("screen-win");

/* ---------- 4. Setup and input ---------- */

function init() {
  highScore = loadHighScore();
  updateHud();
  bindInput();
  requestAnimationFrame(loop);
}

function loadHighScore() {
  try {
    return parseInt(localStorage.getItem("ballhit-high"), 10) || 0;
  } catch (e) {
    return 0; // storage can be blocked (private mode, file:// in some browsers)
  }
}

function saveHighScore() {
  try {
    localStorage.setItem("ballhit-high", String(highScore));
  } catch (e) {
    /* ignore */
  }
}

function bindInput() {
  // Mouse moves the paddle. We convert from screen pixels to canvas units.
  canvas.addEventListener("mousemove", (e) => {
    if (state !== "ready" && state !== "playing") return;
    const rect = canvas.getBoundingClientRect();
    const scale = WIDTH / rect.width;
    setPaddleCenter((e.clientX - rect.left) * scale);
  });

  // Touch support so it also works on a tablet
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scale = WIDTH / rect.width;
    setPaddleCenter((e.touches[0].clientX - rect.left) * scale);
  }, { passive: false });

  canvas.addEventListener("mousedown", launchBall);
  canvas.addEventListener("touchstart", launchBall, { passive: true });

  window.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowLeft":
      case "a":
      case "A":
        keys.left = true;
        e.preventDefault();
        break;
      case "ArrowRight":
      case "d":
      case "D":
        keys.right = true;
        e.preventDefault();
        break;
      case " ":
        // Don't hijack Space when a button has focus (it would double-trigger)
        if (document.activeElement && document.activeElement.tagName === "BUTTON") return;
        e.preventDefault();
        launchBall();
        break;
      case "p":
      case "P":
      case "Escape":
        togglePause();
        break;
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
  });

  // Losing focus mid-game shouldn't leave the paddle "stuck" moving
  window.addEventListener("blur", () => { keys.left = keys.right = false; });

  document.getElementById("btn-start").addEventListener("click", startGame);
  document.getElementById("btn-restart").addEventListener("click", startGame);
  document.getElementById("btn-again").addEventListener("click", startGame);
}

function setPaddleCenter(x) {
  paddle.x = clamp(x - paddle.w / 2, 0, WIDTH - paddle.w);
}

function launchBall() {
  if (state !== "ready") return;
  // Launch slightly off-vertical, random side, so it isn't always identical
  const angle = (Math.random() * 30 + 15) * (Math.random() < 0.5 ? -1 : 1) * Math.PI / 180;
  ball.vx = ball.speed * Math.sin(angle);
  ball.vy = -ball.speed * Math.cos(angle);
  state = "playing";
}

function togglePause() {
  if (state === "playing") state = "paused";
  else if (state === "paused") state = "playing";
}

/* ---------- 5. Level loader ---------- */

function loadLevel(index) {
  const def = LEVELS[index];
  bricks = [];
  def.rows.forEach((row, r) => {
    for (let c = 0; c < BRICK_COLS; c++) {
      const hits = parseInt(row[c], 10);
      if (!hits) continue;
      bricks.push({
        x: GRID_LEFT + c * (BRICK_W + BRICK_GAP),
        y: GRID_TOP + r * (BRICK_H + BRICK_GAP),
        w: BRICK_W,
        h: BRICK_H,
        hits: hits,
        max: hits,
      });
    }
  });
  ball.speed = def.speed;
  particles = [];
  resetBall();
}

// Park the ball on the paddle, waiting for a launch
function resetBall() {
  paddle.x = (WIDTH - paddle.w) / 2;
  ball.x = paddle.x + paddle.w / 2;
  ball.y = paddle.y - BALL_R - 1;
  ball.vx = 0;
  ball.vy = 0;
  trail = [];
  state = "ready";
}

/* ---------- 6. Update ---------- */

function update(dt) {
  if (state !== "ready" && state !== "playing") {
    updateParticles(dt);
    return;
  }

  // Keyboard paddle movement
  if (keys.left) paddle.x -= PADDLE_KEY_SPEED * dt;
  if (keys.right) paddle.x += PADDLE_KEY_SPEED * dt;
  paddle.x = clamp(paddle.x, 0, WIDTH - paddle.w);

  if (state === "ready") {
    // Ball rides along with the paddle
    ball.x = paddle.x + paddle.w / 2;
    ball.y = paddle.y - BALL_R - 1;
    updateParticles(dt);
    return;
  }

  const prevX = ball.x;
  const prevY = ball.y;

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Short trail behind the ball
  trail.push({ x: ball.x, y: ball.y });
  if (trail.length > 8) trail.shift();

  handleWalls();
  handlePaddle();
  handleBricks(prevX, prevY);

  // Ball fell past the paddle
  if (ball.y - BALL_R > HEIGHT) {
    loseLife();
  }

  updateParticles(dt);
}

function handleWalls() {
  if (ball.x - BALL_R < 0) {
    ball.x = BALL_R;
    ball.vx = Math.abs(ball.vx);
  } else if (ball.x + BALL_R > WIDTH) {
    ball.x = WIDTH - BALL_R;
    ball.vx = -Math.abs(ball.vx);
  }
  if (ball.y - BALL_R < 0) {
    ball.y = BALL_R;
    ball.vy = Math.abs(ball.vy);
  }
}

function handlePaddle() {
  const withinX = ball.x + BALL_R > paddle.x && ball.x - BALL_R < paddle.x + paddle.w;
  const reachingTop = ball.y + BALL_R >= paddle.y && ball.y + BALL_R <= paddle.y + paddle.h + 10;

  if (ball.vy > 0 && withinX && reachingTop) {
    // Where on the paddle did we hit? -1 = left edge, +1 = right edge
    const offset = clamp((ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2), -1, 1);
    const angle = offset * 62 * Math.PI / 180;   // max 62 degrees from vertical
    ball.vx = ball.speed * Math.sin(angle);
    ball.vy = -ball.speed * Math.cos(angle);
    ball.y = paddle.y - BALL_R;
  }
}

function handleBricks(prevX, prevY) {
  for (const b of bricks) {
    if (b.hits <= 0) continue;

    // Closest point on the brick to the ball centre
    const nearX = clamp(ball.x, b.x, b.x + b.w);
    const nearY = clamp(ball.y, b.y, b.y + b.h);
    const dx = ball.x - nearX;
    const dy = ball.y - nearY;
    if (dx * dx + dy * dy > BALL_R * BALL_R) continue;

    // Decide which face was struck: if we were already lined up with the
    // brick horizontally before this frame, we came in from the top/bottom.
    const wasBesideBrick = prevX < b.x || prevX > b.x + b.w;
    const wasAboveOrBelow = prevY < b.y || prevY > b.y + b.h;

    if (wasBesideBrick && !wasAboveOrBelow) {
      ball.vx = -ball.vx;
    } else {
      ball.vy = -ball.vy;
    }
    // Nudge the ball out so it can't hit the same brick twice
    ball.x = prevX;
    ball.y = prevY;

    b.hits -= 1;
    addScore(10);

    if (b.hits <= 0) {
      addScore(10 * b.max);          // bonus for finishing a brick
      spawnParticles(b.x + b.w / 2, b.y + b.h / 2, BRICK_COLORS[b.max]);
    }

    if (bricks.every((br) => br.hits <= 0)) {
      levelComplete();
    }
    break; // one brick per frame keeps the bounce predictable
  }
}

function updateParticles(dt) {
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 0.12 * dt;
    p.life -= dt;
  }
  particles = particles.filter((p) => p.life > 0);
}

function spawnParticles(x, y, color) {
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 1 + Math.random() * 3;
    particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 25 + Math.random() * 15,
      color,
    });
  }
}

/* ---------- 7. Renderer ---------- */

function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  drawBricks();
  drawParticles();
  drawPaddle();
  drawBall();

  if (state === "ready") {
    drawCenterText("Click or press Space to launch", HEIGHT / 2 + 90, 20, "#9d97c9");
  } else if (state === "paused") {
    ctx.fillStyle = "rgba(15, 11, 32, 0.7)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawCenterText("Paused", HEIGHT / 2, 44, "#ece9ff");
    drawCenterText("Press P to resume", HEIGHT / 2 + 40, 18, "#9d97c9");
  }
}

function drawBricks() {
  for (const b of bricks) {
    if (b.hits <= 0) continue;
    const color = BRICK_COLORS[b.hits];
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, 6);
    ctx.fill();
    ctx.restore();

    // Soft highlight along the top edge
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.beginPath();
    ctx.roundRect(b.x + 3, b.y + 3, b.w - 6, 5, 3);
    ctx.fill();

    // Tougher bricks get a dark pip for each remaining hit
    if (b.max > 1) {
      ctx.fillStyle = "rgba(21, 17, 43, 0.75)";
      const startX = b.x + b.w / 2 - (b.hits - 1) * 7;
      for (let i = 0; i < b.hits; i++) {
        ctx.beginPath();
        ctx.arc(startX + i * 14, b.y + b.h / 2 + 3, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawPaddle() {
  ctx.save();
  ctx.shadowColor = "#4fe3c1";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#4fe3c1";
  ctx.beginPath();
  ctx.roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 7);
  ctx.fill();
  ctx.restore();
}

function drawBall() {
  // Fading trail
  trail.forEach((t, i) => {
    const a = (i + 1) / trail.length;
    ctx.fillStyle = `rgba(255, 243, 176, ${a * 0.25})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, BALL_R * a, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.save();
  ctx.shadowColor = "#fff3b0";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#fff3b0";
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(p.life / 40, 0);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
}

function drawCenterText(text, y, size, color) {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px "Chakra Petch", "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(text, WIDTH / 2, y);
}

function updateHud() {
  hudScore.textContent = score;
  hudHigh.textContent = highScore;
  hudLevel.textContent = level + 1;

  let dots = "";
  for (let i = 0; i < START_LIVES; i++) {
    dots += `<span class="life${i < lives ? "" : " lost"}"></span>`;
  }
  hudLives.innerHTML = dots;
  hudLives.setAttribute("aria-label", lives + " lives left");
}

/* ---------- 8. Game flow ---------- */

function startGame() {
  clearTimeout(levelTimer);
  score = 0;
  lives = START_LIVES;
  level = 0;
  screenStart.classList.add("hidden");
  screenOver.classList.add("hidden");
  screenWin.classList.add("hidden");
  banner.classList.remove("show");
  loadLevel(level);
  updateHud();
}

function addScore(points) {
  score += points;
  if (score > highScore) {
    highScore = score;
    saveHighScore();
  }
  updateHud();
}

function loseLife() {
  lives -= 1;
  updateHud();
  if (lives <= 0) {
    endGame();
  } else {
    resetBall();
  }
}

function levelComplete() {
  // Last level cleared means the whole game is won
  if (level === LEVELS.length - 1) {
    state = "win";
    document.getElementById("win-score").textContent = score;
    document.getElementById("win-note").textContent =
      score >= highScore ? "That's a new high score." : "High score: " + highScore;
    setTimeout(() => screenWin.classList.remove("hidden"), 700);
    return;
  }

  state = "levelup";
  level += 1;
  showBanner(`Level ${level + 1}: ${LEVELS[level].name}`);

  levelTimer = setTimeout(() => {
    loadLevel(level);
    updateHud();
  }, LEVEL_PAUSE_MS);
}

function showBanner(text) {
  banner.textContent = text;
  banner.classList.remove("show");
  void banner.offsetWidth;   // restart the CSS animation
  banner.classList.add("show");
}

function endGame() {
  state = "over";
  document.getElementById("over-score").textContent = score;
  document.getElementById("over-level").textContent = level + 1;
  document.getElementById("over-note").textContent =
    score > 0 && score >= highScore ? "That's a new high score." : "High score: " + highScore;
  screenOver.classList.remove("hidden");
}

/* ---------- 9. Main loop ---------- */

function loop(now) {
  // dt is 1.0 at exactly 60fps, so movement stays the same on faster screens
  const dt = Math.min((now - lastTime) / (1000 / 60), 2.5) || 1;
  lastTime = now;

  update(dt);
  draw();
  requestAnimationFrame(loop);
}

/* ---------- Helpers ---------- */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

init();
