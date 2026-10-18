// Optional browser integration check. Start the app on 3001 and Chrome with
// --headless --remote-debugging-port=9223, then run node test/browser-smoke.js.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const tabs = await (await fetch('http://127.0.0.1:9223/json')).json();
const tab = tabs.find((entry) => entry.type === 'page');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let serial = 0;
const pending = new Map(), errors = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry.text);
  if (!message.id) return;
  const request = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(expression) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
const clickSquare = (square) => evaluate(`document.querySelector('[data-square="${square}"]').dispatchEvent(new MouseEvent('click', {bubbles:true}))`);
try {
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:3001' });
  await waitFor('document.querySelectorAll(".square").length === 64');
  assert.equal(await evaluate('document.querySelectorAll("use.piece").length'), 32);
  // Click the upright pawn itself, not just the tile beneath its feet.
  const pawn = await evaluate(`(() => { const box = document.querySelector('[data-piece-square="52"]').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height * .3 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...pawn, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...pawn, button: 'left', clickCount: 1 });
  assert.equal(await evaluate('document.querySelectorAll(".move-marker").length'), 2);
  await clickSquare(36); // e4
  await waitFor('document.getElementById("human-tag").textContent === "YOUR TURN" && document.querySelectorAll(".move-row").length === 1');
  assert.equal(await evaluate('document.querySelector(".move-row span:nth-child(2)").textContent'), 'e4');
  assert.notEqual(await evaluate('document.querySelector(".move-row span:nth-child(3)").textContent'), '—');
  assert.ok(!await evaluate('document.getElementById("status-detail").textContent.includes("unavailable")'));
  await evaluate('document.getElementById("undo").click()');
  assert.equal(await evaluate('document.querySelectorAll(".move-row").length'), 0);
  assert.equal(await evaluate('document.querySelectorAll("use.piece").length'), 32);
  // Rewind several moves at once from the history list.
  await clickSquare(52); await clickSquare(36); // e4
  await waitFor('document.getElementById("human-tag").textContent === "YOUR TURN" && document.querySelectorAll(".move-row").length === 1');
  await clickSquare(51); await clickSquare(35); // d4
  await waitFor('document.getElementById("human-tag").textContent === "YOUR TURN" && document.querySelectorAll(".move-row").length === 2');
  assert.equal(await evaluate('document.querySelectorAll(".history-move").length'), 3, 'latest computer reply is not a rewind point');
  await evaluate('document.querySelector(".move-row span:nth-child(3) .history-move").click()'); // back to just after black's first reply
  assert.equal(await evaluate('document.querySelectorAll(".move-row").length'), 1);
  assert.equal(await evaluate('document.getElementById("human-tag").textContent'), 'YOUR TURN');
  await evaluate('document.querySelector(".move-row span:nth-child(2) .history-move").click()'); // back to the start
  assert.equal(await evaluate('document.querySelectorAll(".move-row").length'), 0);
  assert.equal(await evaluate('document.getElementById("undo").disabled'), true);
  await evaluate('document.getElementById("flip").click()');
  await evaluate('document.getElementById("side").value = "b"; document.getElementById("new-game").click()');
  await waitFor('document.getElementById("human-tag").textContent === "YOUR TURN" && document.querySelectorAll(".move-row").length === 1');
  assert.equal(await evaluate('document.getElementById("undo").disabled'), true);
  await evaluate('document.getElementById("new-game").click()');
  assert.equal(await evaluate('document.getElementById("restart").open'), true);
  await evaluate('document.getElementById("cancel-restart").click()');
  assert.equal(await evaluate('document.getElementById("restart").open'), false);
  await evaluate('document.getElementById("side").value = "w"; document.getElementById("new-game").click(); document.getElementById("confirm-restart").click()');
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('../desktop-preview.png', import.meta.url), Buffer.from(screenshot.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile page should not overflow horizontally');
  await clickSquare(52);
  await clickSquare(36);
  await waitFor('document.getElementById("human-tag").textContent === "YOUR TURN"');
  const mobile = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(new URL('../mobile-preview.png', import.meta.url), Buffer.from(mobile.data, 'base64'));
  assert.deepEqual(errors, [], 'No browser JavaScript, CSP or resource errors');
  console.log('Browser checks passed: rendering, SVG pieces, legal highlights, real computer reply, undo, rotate, play black, restart dialog, mobile layout.');
} finally {
  socket.close();
}
