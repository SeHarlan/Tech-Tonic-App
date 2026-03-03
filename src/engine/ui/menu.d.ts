export interface MenuState {
  currentMode: string;
  currentDirection: string;
  eraseVariant: string;
  waterfallVariant: boolean;
  globalFreeze: boolean;
  manualMode: boolean;
  isRecording: boolean;
  brushSize: number;
  brushSizeIndex: number;
  brushSizeOptions: number[];
}

export interface MenuController {
  getState(): MenuState;
  setState(partial: Partial<MenuState>): void;
  open(): void;
  close(): void;
  updateActiveStates(): void;
  updateBrushDisplay(): void;
  destroy(): void;
}

export interface MenuOptions {
  onAction?: (action: string, state: MenuState) => void;
  brushSizeOptions?: number[];
  initialBrushSizeIndex?: number;
}

export function setupMenu(opts?: MenuOptions): MenuController | null;
