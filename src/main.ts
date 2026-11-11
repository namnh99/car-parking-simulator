import "./style.css";
import { DEFAULT_ENV, DEFAULT_VEHICLE, SIM, VEHICLE_PRESETS } from "./config";
import { Camera, DEFAULT_VIEW_PITCH, DEFAULT_VIEW_YAW } from "./camera";
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
const initialPreset = VEHICLE_PRESETS[0];
const simulation = new Simulation(DEFAULT_ENV, initialPreset?.config ?? DEFAULT_VEHICLE);
const input = new InputManager();

let follow = false;
let cameraUserControlled = false;

function fitCamera(): void {
  // Frame the action (house, garage approach and the spawn) rather than the
  // entire carriageway, which is several times wider than the stage.
  const env = simulation.env;
  camera.fit(
    {
      minX: env.house.left - 3.5,
      maxX: env.start.x + 3.2,
      minY: env.bounds.minY,
      maxY: env.bounds.maxY,
    },
    renderer.viewWidth,
    renderer.viewHeight,
    0.92,
  );
}

function resetCameraView(): void {
  camera.setView(DEFAULT_VIEW_YAW, DEFAULT_VIEW_PITCH);
  fitCamera();
  ui.setViewAngles(camera.yawDegrees, camera.pitchDegrees);
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
  onViewAngleChange: (yawDegrees, pitchDegrees) => {
    camera.setView((yawDegrees * Math.PI) / 180, (pitchDegrees * Math.PI) / 180);
    ui.setViewAngles(camera.yawDegrees, camera.pitchDegrees);
    cameraUserControlled = true;
  },
  onCommit: () => ui.syncInputs(simulation.env.config, simulation.vehicleConfig),
});

ui.setPresets(VEHICLE_PRESETS.map(({ id, label }) => ({ id, label })));
ui.selectPreset(initialPreset?.id ?? CUSTOM_PRESET_ID);
ui.syncInputs(simulation.env.config, simulation.vehicleConfig);
ui.updateTurning(simulation.vehicleConfig);
ui.setViewAngles(camera.yawDegrees, camera.pitchDegrees);

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

type DragMode = "pan" | "orbit";

let dragMode: DragMode | null = null;
let lastPointerX = 0;
let lastPointerY = 0;

function setDragMode(mode: DragMode | null): void {
  dragMode = mode;
  viewport.classList.toggle("is-panning", mode === "pan");
  viewport.classList.toggle("is-orbiting", mode === "orbit");
}

canvas.addEventListener("pointerdown", (event) => {
  const wantsOrbit = event.button === 2 || (event.button === 0 && event.shiftKey);
  const wantsPan = event.button === 0 || event.button === 1;
  if (!wantsOrbit && !wantsPan) return;
  setDragMode(wantsOrbit ? "orbit" : "pan");
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
  if (follow) setFollow(false);
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragMode) return;
  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  if (dragMode === "orbit") {
    // Match the drag direction: dragging down tilts the ground plane down
    // towards the viewer (higher pitch), dragging up lowers the view.
    camera.orbitBy(-dx * 0.008, dy * 0.008);
    ui.setViewAngles(camera.yawDegrees, camera.pitchDegrees);
  } else {
    camera.panByScreen(dx, dy);
  }
  cameraUserControlled = true;
});

function endDrag(event: PointerEvent): void {
  if (!dragMode) return;
  setDragMode(null);
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
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
