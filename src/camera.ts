import type { Aabb, Vec2 } from "./types";
import { SIM } from "./config";
import { clamp } from "./math";

/**
 * Default 3/4 view used by the renderer. The user can orbit around these
 * values at runtime with the camera controls.
 */
export const DEFAULT_VIEW_YAW = (12 * Math.PI) / 180;
export const DEFAULT_VIEW_PITCH = (50 * Math.PI) / 180;
/** Keep enough pitch to preserve a readable, stable projection. */
export const MIN_VIEW_PITCH = (25 * Math.PI) / 180;
export const MAX_VIEW_PITCH = (88 * Math.PI) / 180;

/** Wall tops included when framing the scene. */
const FIT_HEIGHT = 3.2;

/** Wrap an angle to [-PI, PI). */
function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((((angle + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

/**
 * Pseudo-3D camera. World units are metres (x east, y south, z up).
 *
 * `zoom` is CSS pixels per metre on the ground plane. The horizontal axis is
 * mirrored so that turning right (+heading) still turns right on screen when
 * the house sits above the road. `yaw` and `pitch` are mutable so the scene
 * can be orbited.
 */
export class Camera {
  centerX = 0;
  centerY = 0;
  zoom = 32;

  private _yaw = DEFAULT_VIEW_YAW;
  private _pitch = DEFAULT_VIEW_PITCH;

  /** Scene yaw around the vertical axis, radians. */
  get yaw(): number {
    return this._yaw;
  }

  /** View elevation, radians (0 = ground level, PI/2 = top-down). */
  get pitch(): number {
    return this._pitch;
  }

  /** Vertical compression of the ground plane (sin of the view pitch). */
  get groundTilt(): number {
    return Math.sin(this._pitch);
  }

  /** Screen scale for world height (cos of the view pitch). */
  get heightScale(): number {
    return Math.cos(this._pitch);
  }

  get yawDegrees(): number {
    return (this._yaw * 180) / Math.PI;
  }

  get pitchDegrees(): number {
    return (this._pitch * 180) / Math.PI;
  }

  /** Set the view angle. Yaw wraps; pitch is clamped to the orbit range. */
  setView(yawRadians: number, pitchRadians: number): void {
    if (Number.isFinite(yawRadians)) this._yaw = wrapAngle(yawRadians);
    if (Number.isFinite(pitchRadians)) {
      this._pitch = clamp(pitchRadians, MIN_VIEW_PITCH, MAX_VIEW_PITCH);
    }
  }

  /** Apply a relative orbit (radians). */
  orbitBy(deltaYaw: number, deltaPitch: number): void {
    this.setView(this._yaw + deltaYaw, this._pitch + deltaPitch);
  }

  /** Frame an AABB, leaving a little padding. */
  fit(bounds: Aabb, viewWidth: number, viewHeight: number, padding = 0.92): void {
    this.centerX = (bounds.minX + bounds.maxX) / 2;
    this.centerY = (bounds.minY + bounds.maxY) / 2;

    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    let maxX = 0.001;
    let maxY = 0.001;
    for (const x of [bounds.minX, bounds.maxX]) {
      for (const y of [bounds.minY, bounds.maxY]) {
        const dx = x - this.centerX;
        const dy = y - this.centerY;
        const rx = dx * cos - dy * sin;
        const ry = dx * sin + dy * cos;
        maxX = Math.max(maxX, Math.abs(rx));
        maxY = Math.max(maxY, Math.abs(ry) * this.groundTilt + FIT_HEIGHT * this.heightScale);
      }
    }

    const zoom = Math.min(viewWidth / (2 * maxX), viewHeight / (2 * maxY)) * padding;
    this.zoom = clamp(zoom, SIM.minZoom, SIM.maxZoom);
  }

  /**
   * Project a world point to screen space. `height` is world z (metres above
   * the road plane) and defaults to ground level.
   */
  worldToScreen(
    worldX: number,
    worldY: number,
    viewWidth: number,
    viewHeight: number,
    height = 0,
  ): Vec2 {
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    const dx = worldX - this.centerX;
    const dy = worldY - this.centerY;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return {
      x: -rx * this.zoom + viewWidth / 2,
      y: (-(ry * this.groundTilt) - height * this.heightScale) * this.zoom + viewHeight / 2,
    };
  }

  /** Inverse of {@link worldToScreen} on the ground plane (z = 0). */
  screenToWorld(screenX: number, screenY: number, viewWidth: number, viewHeight: number): Vec2 {
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    const rx = -(screenX - viewWidth / 2) / this.zoom;
    const ry = -(screenY - viewHeight / 2) / (this.zoom * this.groundTilt);
    return {
      x: this.centerX + rx * cos + ry * sin,
      y: this.centerY - rx * sin + ry * cos,
    };
  }

  /** Zoom about a screen point so the world point under it stays put. */
  zoomAt(
    screenX: number,
    screenY: number,
    factor: number,
    viewWidth: number,
    viewHeight: number,
  ): void {
    const before = this.screenToWorld(screenX, screenY, viewWidth, viewHeight);
    this.zoom = clamp(this.zoom * factor, SIM.minZoom, SIM.maxZoom);
    const after = this.screenToWorld(screenX, screenY, viewWidth, viewHeight);
    this.centerX += before.x - after.x;
    this.centerY += before.y - after.y;
  }

  zoomBy(factor: number, viewWidth: number, viewHeight: number): void {
    this.zoomAt(viewWidth / 2, viewHeight / 2, factor, viewWidth, viewHeight);
  }

  /** Pan so the world moves with the pointer, accounting for yaw and tilt. */
  panByScreen(deltaScreenX: number, deltaScreenY: number): void {
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    const invTilt = 1 / this.groundTilt;
    this.centerX += (deltaScreenX * cos + deltaScreenY * sin * invTilt) / this.zoom;
    this.centerY += (-deltaScreenX * sin + deltaScreenY * cos * invTilt) / this.zoom;
  }

  /** Exponential smoothing towards a target point (used for camera follow). */
  followToward(targetX: number, targetY: number, dt: number): void {
    const t = 1 - Math.exp(-8 * dt);
    this.centerX += (targetX - this.centerX) * t;
    this.centerY += (targetY - this.centerY) * t;
  }
}
