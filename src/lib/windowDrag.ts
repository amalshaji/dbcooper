import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Handle mouse down on a draggable region to start window dragging
 */
export function handleDragStart(e: React.MouseEvent) {
  // Only drag on left mouse button and when not clicking on interactive elements
  if (e.button !== 0) return;
  
  const target = e.target as HTMLElement;
  const tagName = target.tagName.toLowerCase();
  
  // Don't drag on interactive elements
  if (
    tagName === "button" ||
    tagName === "a" ||
    tagName === "input" ||
    tagName === "select" ||
    target.closest("button") ||
    target.closest("a") ||
    target.closest('[role="button"]') ||
    target.closest('[data-slot="trigger"]')
  ) {
    return;
  }

  // Start window dragging
  getCurrentWindow().startDragging();
}
