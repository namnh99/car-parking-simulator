import type { Aabb, Vec2 } from "./types";
import { SIM } from "./config";
import { clamp } from "./math";

/**
 * Top-down camera. World units are metres (y-down), `zoom` is CSS pixels per
 * metre, so `screen = (world - centre) * zoom + viewport/2`.
 */
export class Camera {
  centerX = 0;
  centerY = 0;
  zoom = 32;

  /** Frame an AABB, leaving a little padding. */
  fit(bounds: Aabb, viewWidth: number, viewHeight: number, padding = 0.92): void {
    const worldWidth = Math.max(bounds.maxX - bounds.minX, 0.001);
    const worldHeight = Math.max(bounds.maxY - bounds.minY, 0.001);
    const zoom = Math.min(viewWidth / worldWidth, viewHeight / worldHeight) * padding;
    this.zoom = clamp(zoom, SIM.minZoom, SIM.maxZoom);
    this.centerX = (bounds.minX + bounds.maxX) / 2;
    this.centerY = (bounds.minY + bounds.maxY) / 2;
  }

  worldToScreen(worldX: number, worldY: number, viewWidth: number, viewHeight: number): Vec2 {
    return {
      x: (worldX - this.centerX) * this.zoom + viewWidth / 2,
      y: (worldY - this.centerY) * this.zoom + viewHeight / 2,
    };
  }

  screenToWorld(screenX: number, screenY: number, viewWidth: number, viewHeight: number): Vec2 {
    return {
      x: (screenX - viewWidth / 2) / this.zoom + this.centerX,
      y: (screenY - viewHeight / 2) / this.zoom + this.centerY,
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

  panByScreen(deltaScreenX: number, deltaScreenY: number): void {
    this.centerX -= deltaScreenX / this.zoom;
    this.centerY -= deltaScreenY / this.zoom;
  }

  /** Exponential smoothing towards a target point (used for camera follow). */
  followToward(targetX: number, targetY: number, dt: number): void {
    const t = 1 - Math.exp(-8 * dt);
    this.centerX += (targetX - this.centerX) * t;
    this.centerY += (targetY - this.centerY) * t;
  }
}
