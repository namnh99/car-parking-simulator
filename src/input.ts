import type { InputAction } from "./types";

/**
 * Keyboard handling. Continuous keys are exposed as booleans; one-shot keys
 * (reset, camera) are queued and drained once per frame by the simulation loop.
 */
export class InputManager {
  private readonly down = new Set<string>();
  private pending: InputAction[] = [];

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const gameKey = GAME_KEYS.has(event.code);
    if (gameKey) event.preventDefault();
    if (event.repeat) return;
    this.down.add(event.code);
    const action = ONE_SHOT_KEYS[event.code];
    if (action) this.pending.push(action);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
    if (GAME_KEYS.has(event.code)) event.preventDefault();
  };

  /** Losing focus must clear held keys, otherwise the car keeps driving. */
  private readonly onBlur = (): void => {
    this.down.clear();
  };

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  isHeld(...codes: string[]): boolean {
    return codes.some((code) => this.down.has(code));
  }

  get forward(): boolean {
    return this.isHeld("KeyW", "ArrowUp");
  }

  get backward(): boolean {
    return this.isHeld("KeyS", "ArrowDown");
  }

  get steerLeft(): boolean {
    return this.isHeld("KeyA", "ArrowLeft");
  }

  get steerRight(): boolean {
    return this.isHeld("KeyD", "ArrowRight");
  }

  /** Returns and clears the one-shot actions collected since the last frame. */
  drainActions(): InputAction[] {
    if (this.pending.length === 0) return [];
    const actions = this.pending;
    this.pending = [];
    return actions;
  }
}

const GAME_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

const ONE_SHOT_KEYS: Record<string, InputAction | undefined> = {
  KeyR: "reset",
  KeyC: "resetCamera",
  KeyF: "toggleFollow",
  Equal: "zoomIn",
  NumpadAdd: "zoomIn",
  Minus: "zoomOut",
  NumpadSubtract: "zoomOut",
};
