import type { EnvironmentConfig, VehicleConfig } from "./types";
import type { GarageStatus, SimulationStats } from "./simulation";
import { SIM } from "./config";
import { formatNumber } from "./math";
import { turningGeometry, turningRadiusClamped } from "./vehicle";

export interface UiCallbacks {
  onEnvironmentChange: (patch: Partial<EnvironmentConfig>) => void;
  /** Single-field vehicle edit, so the length/overhang identity can be kept. */
  onVehicleChange: (key: keyof VehicleConfig, value: number) => void;
  onPresetChange: (presetId: string) => void;
  onReset: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetCamera: () => void;
  onFollowChange: (follow: boolean) => void;
  /** Called when a field loses focus so the UI can show sanitised values. */
  onCommit: () => void;
}

const ENV_FIELDS: ReadonlyArray<keyof EnvironmentConfig> = [
  "roadWidth",
  "houseWidth",
  "houseDepth",
  "garageDoorWidth",
  "drivewayDepth",
];

const VEHICLE_FIELDS: ReadonlyArray<keyof VehicleConfig> = [
  "vehicleLength",
  "vehicleWidth",
  "wheelbase",
  "frontOverhang",
  "turningRadius",
  "steeringRate",
  "steeringReturnRate",
];

/** Sentinel id for values that no longer match any preset. */
export const CUSTOM_PRESET_ID = "custom";

function mustGet<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing DOM element #${id}`);
  return element as T;
}

/** Binds the parameter panel and the readout panels to the simulation. */
export class Ui {
  private readonly envInputs: Record<keyof EnvironmentConfig, HTMLInputElement>;
  private readonly vehicleInputs: Record<keyof VehicleConfig, HTMLInputElement>;
  private readonly followCheckbox = mustGet<HTMLInputElement>("chk-follow");
  private readonly garagePanel = mustGet<HTMLDivElement>("garage-panel");
  private readonly garageFitStatus = mustGet<HTMLSpanElement>("garage-fit-status");
  private readonly garageVehicleWidth = mustGet<HTMLSpanElement>("garage-vehicle-width");
  private readonly garageDoorWidth = mustGet<HTMLSpanElement>("garage-door-width");
  private readonly garageClearLeft = mustGet<HTMLSpanElement>("garage-clear-left");
  private readonly garageClearRight = mustGet<HTMLSpanElement>("garage-clear-right");
  private readonly statSpeed = mustGet<HTMLSpanElement>("stat-speed");
  private readonly statHeading = mustGet<HTMLSpanElement>("stat-heading");
  private readonly statSteering = mustGet<HTMLSpanElement>("stat-steering");
  private readonly statPosition = mustGet<HTMLSpanElement>("stat-position");
  private readonly turnMaxSteer = mustGet<HTMLSpanElement>("turn-max-steer");
  private readonly turnDiameter = mustGet<HTMLSpanElement>("turn-diameter");
  private readonly turnWall = mustGet<HTMLSpanElement>("turn-wall");
  private readonly turnRear = mustGet<HTMLSpanElement>("turn-rear");
  private readonly turnWarning = mustGet<HTMLParagraphElement>("turn-warning");
  private readonly presetSelect = mustGet<HTMLSelectElement>("veh-preset");

  constructor(callbacks: UiCallbacks) {
    this.envInputs = ENV_FIELDS.reduce(
      (acc, key) => {
        acc[key] = mustGet<HTMLInputElement>(`env-${key}`);
        return acc;
      },
      {} as Record<keyof EnvironmentConfig, HTMLInputElement>,
    );

    this.vehicleInputs = VEHICLE_FIELDS.reduce(
      (acc, key) => {
        acc[key] = mustGet<HTMLInputElement>(`veh-${key}`);
        return acc;
      },
      {} as Record<keyof VehicleConfig, HTMLInputElement>,
    );

    for (const key of ENV_FIELDS) {
      this.wireNumberInput(this.envInputs[key], (value) =>
        callbacks.onEnvironmentChange({ [key]: value }),
      );
    }
    for (const key of VEHICLE_FIELDS) {
      this.wireNumberInput(this.vehicleInputs[key], (value) =>
        callbacks.onVehicleChange(key, value),
      );
    }

    for (const input of [...Object.values(this.envInputs), ...Object.values(this.vehicleInputs)]) {
      input.addEventListener("change", () => callbacks.onCommit());
    }

    this.presetSelect.addEventListener("change", () =>
      callbacks.onPresetChange(this.presetSelect.value),
    );
    mustGet<HTMLButtonElement>("btn-reset").addEventListener("click", () => callbacks.onReset());
    mustGet<HTMLButtonElement>("btn-zoom-in").addEventListener("click", () => callbacks.onZoomIn());
    mustGet<HTMLButtonElement>("btn-zoom-out").addEventListener("click", () => callbacks.onZoomOut());
    mustGet<HTMLButtonElement>("btn-reset-camera").addEventListener("click", () =>
      callbacks.onResetCamera(),
    );
    this.followCheckbox.addEventListener("change", () =>
      callbacks.onFollowChange(this.followCheckbox.checked),
    );
  }

  private wireNumberInput(input: HTMLInputElement, emit: (value: number) => void): void {
    input.addEventListener("input", () => {
      const value = input.valueAsNumber;
      if (!Number.isFinite(value)) return;
      emit(value);
    });
  }

  /** Write (sanitised) config values back into the panel. */
  syncInputs(env: EnvironmentConfig, vehicle: VehicleConfig): void {
    for (const key of ENV_FIELDS) this.envInputs[key].value = formatNumber(env[key]);
    for (const key of VEHICLE_FIELDS) this.vehicleInputs[key].value = formatNumber(vehicle[key]);
  }

  setFollowChecked(follow: boolean): void {
    this.followCheckbox.checked = follow;
  }

  /** Populate the preset dropdown, with a trailing "Custom" entry. */
  setPresets(presets: ReadonlyArray<{ id: string; label: string }>): void {
    const entries = [...presets, { id: CUSTOM_PRESET_ID, label: "Custom" }];
    this.presetSelect.replaceChildren(
      ...entries.map((preset) => {
        const option = document.createElement("option");
        option.value = preset.id;
        option.textContent = preset.label;
        return option;
      }),
    );
    this.selectPreset(presets[0]?.id ?? CUSTOM_PRESET_ID);
  }

  /** Reflect which preset (or Custom) the current values represent. */
  selectPreset(presetId: string): void {
    this.presetSelect.value = presetId;
  }

  updateStats(stats: SimulationStats): void {
    this.statSpeed.textContent = `${stats.speed.toFixed(2)} m/s`;
    this.statHeading.textContent = `${stats.headingDeg.toFixed(0)}°`;
    this.statSteering.textContent = `${stats.steeringDeg.toFixed(0)}°`;
    this.statPosition.textContent = `X ${formatNumber(stats.position.x)} m / Y ${formatNumber(stats.position.y)} m`;
  }

  /** Turning circle implied by the configured turning radius. */
  updateTurning(vehicle: VehicleConfig): void {
    const geometry = turningGeometry(vehicle);
    this.turnMaxSteer.textContent = `${((geometry.steeringAngle * 180) / Math.PI).toFixed(1)}°`;
    this.turnDiameter.textContent = `${formatNumber(geometry.referenceRadius * 2)} m`;
    this.turnWall.textContent = `${formatNumber(geometry.wallToWallRadius)} m`;
    this.turnRear.textContent = `${formatNumber(geometry.rearAxleRadius)} m`;

    const clamped = turningRadiusClamped(vehicle);
    this.turnWarning.hidden = !clamped;
    if (clamped) {
      this.turnWarning.textContent =
        `${formatNumber(vehicle.turningRadius)} m needs more than `
        + `${SIM.maxSteeringAngle}° of lock; the tightest achievable is `
        + `${formatNumber(geometry.referenceRadius * 2)} m diameter.`;
    }
  }

  updateGarage(status: GarageStatus): void {
    this.garagePanel.classList.toggle("is-visible", status.active);
    if (!status.active) return;

    this.garageVehicleWidth.textContent = `${formatNumber(status.vehicleWidth)} m`;
    this.garageDoorWidth.textContent = `${formatNumber(status.doorWidth)} m`;
    this.garageClearLeft.textContent = formatClearance(status.leftClearance);
    this.garageClearRight.textContent = formatClearance(status.rightClearance);
    this.garageClearLeft.classList.toggle("is-bad", status.leftClearance <= 0);
    this.garageClearRight.classList.toggle("is-bad", status.rightClearance <= 0);

    this.garageFitStatus.textContent = status.parked
      ? "PARKED"
      : status.fits
        ? "FITS"
        : "WILL HIT";
    this.garageFitStatus.classList.toggle("is-bad", !status.fits);
    this.garageFitStatus.classList.toggle("is-good", status.fits);
  }
}

function formatClearance(metres: number): string {
  return `${(metres * 100).toFixed(1)} cm`;
}
