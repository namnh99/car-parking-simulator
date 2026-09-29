import "./style.css";
import { DEFAULT_ENV, DEFAULT_VEHICLE, SIM, VEHICLE_PRESETS } from "./config";
import { Camera } from "./camera";
import { InputManager } from "./input";
import { Renderer } from "./renderer";
import { Simulation } from "./simulation";
import { CUSTOM_PRESET_ID, Ui } from "./ui";
import { bodyCenter } from "./vehicle";
import type { InputAction } from "./types";

const canvasElement = document.getElementById("scene");
const viewportElement = document.getElementById("viewport");
if (!(canvasElement instanceof HTMLCanvasElement)) throw new Error("Missing #scene canvas");
if (!(viewportElement instanceof HTMLElement)) throw new Error("Missing #viewport container");

const canvas: HTMLCanvasElement = canvasElement;
const viewport: HTMLElement = viewportElement;

const camera = new Camera();
const renderer = new Renderer(canvas, camera);
const simulation = new Simulation(DEFAULT_ENV, DEFAULT_VEHICLE);
const input = new InputManager();

let follow = false;
let cameraUserControlled = false;

function resetCameraView(): void {
  camera.fit(simulation.env.bounds, renderer.viewWidth, renderer.viewHeight);
  cameraUserControlled = false;
}

function setFollow(value: boolean): void {
  follow = value;
  ui.setFollowChecked(value);
}

const ui = new Ui({
  onEnvironmentChange: (patch) => {
    simulation.applyEnvironment({ ...simulation.env.config, ...patch });
    if (!cameraUserControlled) resetCameraView();
  },
  onVehicleChange: (key, value) => {
    simulation.applyVehicleConfig({ ...simulation.vehicleConfig, [key]: value });
    ui.updateTurning(simulation.vehicleConfig);
    // A hand edit no longer matches the selected preset.
    ui.selectPreset(CUSTOM_PRESET_ID);
  },
  onPresetChange: (presetId) => {
    const preset = VEHICLE_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    simulation.applyVehicleConfig(preset.config);
    ui.syncInputs(simulation.env.config, simulation.vehicleConfig);
    ui.updateTurning(simulation.vehicleConfig);
    ui.selectPreset(preset.id);
  },
  onReset: () => simulation.resetVehicle(),
  onZoomIn: () => {
    camera.zoomBy(1.2, renderer.viewWidth, renderer.viewHeight);
    cameraUserControlled = true;
  },
  onZoomOut: () => {
    camera.zoomBy(1 / 1.2, renderer.viewWidth, renderer.viewHeight);
    cameraUserControlled = true;
  },
  onResetCamera: () => resetCameraView(),
  onFollowChange: (value) => setFollow(value),
  onCommit: () => ui.syncInputs(simulation.env.config, simulation.vehicleConfig),
});

ui.setPresets(VEHICLE_PRESETS.map(({ id, label }) => ({ id, label })));
ui.syncInputs(simulation.env.config, simulation.vehicleConfig);
ui.updateTurning(simulation.vehicleConfig);

// ------------------------------------------------------------------ layout

function handleResize(): void {
  const rect = viewport.getBoundingClientRect();
  renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
  // Keep the whole scene framed until the user takes manual control of the camera.
  if (!cameraUserControlled) resetCameraView();
}

const resizeObserver = new ResizeObserver(handleResize);
resizeObserver.observe(viewport);
handleResize();

// ------------------------------------------------------------- map gestures

let dragging = false;
let lastPointerX = 0;
let lastPointerY = 0;

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.button !== 1) return;
  dragging = true;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
  viewport.classList.add("is-panning");
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  camera.panByScreen(dx, dy);
  cameraUserControlled = true;
  if (follow) setFollow(false);
});

function endDrag(event: PointerEvent): void {
  if (!dragging) return;
  dragging = false;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  viewport.classList.remove("is-panning");
}

canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.0015);
    camera.zoomAt(
      event.clientX - rect.left,
      event.clientY - rect.top,
      factor,
      renderer.viewWidth,
      renderer.viewHeight,
    );
    cameraUserControlled = true;
  },
  { passive: false },
);

// -------------------------------------------------------------------- loop

function handleAction(action: InputAction): void {
  switch (action) {
    case "reset":
      simulation.resetVehicle();
      break;
    case "resetCamera":
      resetCameraView();
      break;
    case "toggleFollow":
      setFollow(!follow);
      break;
    case "zoomIn":
      camera.zoomBy(1.2, renderer.viewWidth, renderer.viewHeight);
      cameraUserControlled = true;
      break;
    case "zoomOut":
      camera.zoomBy(1 / 1.2, renderer.viewWidth, renderer.viewHeight);
      cameraUserControlled = true;
      break;
  }
}

let lastTime = performance.now();

function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, SIM.maxFrameDt);
  lastTime = now;

  for (const action of input.drainActions()) handleAction(action);

  simulation.update(dt, input);

  if (follow) {
    const center = bodyCenter(simulation.state, simulation.vehicleConfig);
    camera.followToward(center.x, center.y, dt);
  }

  renderer.render({
    env: simulation.env,
    vehicleConfig: simulation.vehicleConfig,
    vehicle: simulation.state,
    trail: simulation.trail,
    camera,
    garage: simulation.garage,
  });

  ui.updateStats(simulation.stats());
  ui.updateGarage(simulation.garage);

  window.requestAnimationFrame(frame);
}

window.requestAnimationFrame(frame);
