import { RECORD_DURATION_SECONDS } from '../recording';

// --- Types ---

export interface MenuState {
  currentMode: string;
  currentDirection: string;
  eraseVariant: string;
  waterfallVariant: boolean;
  globalFreeze: boolean;
  manualMode: boolean;
  brushSize: number;
  brushSizeIndex: number;
  brushSizeOptions: number[];
}

export interface MenuOptions {
  onAction?: (action: string, state: MenuState) => void;
  onAppMenu?: () => void;
  brushSizeOptions?: number[];
  initialBrushSizeIndex?: number;
}

export interface MenuController {
  getState(): MenuState;
  setState(partial: Partial<MenuState>): void;
  open(): void;
  close(): void;
  show(): void;
  hide(): void;
  updateActiveStates(): void;
  updateBrushDisplay(): void;
  destroy(): void;
}

// --- Actions map type ---

type ActionMap = Record<string, () => void>;

// --- Setup ---

export function setupMenu(opts?: MenuOptions): MenuController | null {
  const o = opts || {};

  // ---- DOM refs ----
  const menuContainerResult = document.getElementById('menu-container');
  if (!menuContainerResult) {
    console.warn('menu.ts: #menu-container not found');
    return null;
  }
  const menuContainer: HTMLElement = menuContainerResult;

  // ---- Action bar refs ----
  const actionBar = document.getElementById('engine-action-bar');
  const systemBtn = document.getElementById('btn-system');
  const toolsBtn = document.getElementById('btn-tools');
  const recordBtn = document.getElementById('btn-record');

  // ---- State ----
  const state: MenuState = {
    currentMode: 'waterfall',
    currentDirection: 'down',
    eraseVariant: 'movement',
    waterfallVariant: true,
    globalFreeze: false,
    manualMode: false,
    brushSize: 1,
    brushSizeIndex: o.initialBrushSizeIndex ?? 4,
    brushSizeOptions: o.brushSizeOptions ?? [1, 2, 4, 8, 12, 16, 24, 32, 48, 64],
  };

  // Clamp initial index
  state.brushSizeIndex = Math.min(state.brushSizeIndex, state.brushSizeOptions.length - 1);
  state.brushSize = state.brushSizeOptions[state.brushSizeIndex];

  let isMenuOpen = false;
  let isMenuAnimating = false;
  let animTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Brush drag state
  let isDraggingBrushSize = false;
  let brushDragStartY = 0;
  let brushDragStartIndex = 0;

  // ---- Notify consumer ----
  function notify(action: string) {
    if (o.onAction) {
      o.onAction(action, { ...state });
    }
  }

  // ---- Actions map ----
  const actions: ActionMap = {
    closeMenu() {
      closeMenu();
    },

    // Brush size
    increaseBrushSize() {
      if (state.brushSizeOptions.length > 0) {
        state.brushSizeIndex = Math.min(state.brushSizeOptions.length - 1, state.brushSizeIndex + 1);
        state.brushSize = state.brushSizeOptions[state.brushSizeIndex];
        updateBrushDisplay();
      }
    },
    decreaseBrushSize() {
      if (state.brushSizeOptions.length > 0) {
        state.brushSizeIndex = Math.max(0, state.brushSizeIndex - 1);
        state.brushSize = state.brushSizeOptions[state.brushSizeIndex];
        updateBrushDisplay();
      }
    },

    // Movement modes
    waterfallUp() {
      if (state.currentMode === 'waterfall' && state.currentDirection === 'up') {
        state.waterfallVariant = !state.waterfallVariant;
      }
      state.currentMode = 'waterfall';
      state.currentDirection = 'up';
    },
    waterfallDown() {
      if (state.currentMode === 'waterfall' && state.currentDirection === 'down') {
        state.waterfallVariant = !state.waterfallVariant;
      }
      state.currentMode = 'waterfall';
      state.currentDirection = 'down';
    },
    moveLeft() {
      state.currentMode = 'move';
      state.currentDirection = 'left';
    },
    moveRight() {
      state.currentMode = 'move';
      state.currentDirection = 'right';
    },
    shuffle() {
      state.currentMode = 'shuffle';
    },
    trickle() {
      state.currentMode = 'trickle';
    },
    eraseMovement() {
      if (state.currentMode !== 'erase') {
        state.currentMode = 'erase';
        state.eraseVariant = 'movement';
      } else if (state.eraseVariant === 'both') {
        state.eraseVariant = 'movement';
      } else {
        state.eraseVariant = 'both';
      }
    },
    freezeBrush() {
      state.currentMode = 'freeze';
    },

    // Pause
    toggleGlobalFreeze() {
      state.globalFreeze = !state.globalFreeze;
    },

    // Paint modes
    drawSpace() {
      state.currentMode = 'empty';
    },
    drawGem() {
      state.currentMode = 'gem';
    },
    drawStatic() {
      state.currentMode = 'static';
    },
    resetInitialMovement() {
      if (state.currentMode !== 'erase') {
        state.currentMode = 'erase';
        state.eraseVariant = 'paint';
      } else if (state.eraseVariant === 'both') {
        state.eraseVariant = 'paint';
      } else {
        state.eraseVariant = 'both';
      }
    },

    // Global
    toggleManualMode() {
      state.manualMode = !state.manualMode;
    },
    globalReset() {
      // state doesn't change — consumer handles the reset
    },
    openAppMenu() {
      if (o.onAppMenu) {
        o.onAppMenu();
      }
    },

    // Composite erase cycling (E key)
    cycleEraseMode() {
      const variants = ['both', 'movement', 'paint'];
      if (state.currentMode !== 'erase') {
        state.currentMode = 'erase';
        state.eraseVariant = 'both';
      } else {
        const idx = variants.indexOf(state.eraseVariant);
        state.eraseVariant = variants[(idx + 1) % variants.length];
      }
    },

    // Passthrough actions — state doesn't change, consumer handles them
    newSeed() {},
    saveScreenshot() {},
    recordVideo() {
      // Sync button visual when triggered via keyboard ('R')
      isRecording = !isRecording;
      if (recordBtn) recordBtn.classList.toggle('recording', isRecording);
      if (recordTimeoutId !== null) {
        clearTimeout(recordTimeoutId);
        recordTimeoutId = null;
      }
      if (isRecording) {
        recordTimeoutId = setTimeout(() => {
          isRecording = false;
          if (recordBtn) recordBtn.classList.remove('recording');
          recordTimeoutId = null;
        }, RECORD_DURATION_SECONDS * 1000);
      }
    },
  };

  // ---- Dispatch helper (runs action + updates UI + notifies) ----
  function dispatch(actionName: string) {
    if (actions[actionName]) {
      actions[actionName]();
      updateActiveStates();
      notify(actionName);
    }
  }

  // ---- Keyboard shortcuts ----
  function handleKeyDown(e: KeyboardEvent) {
    const key = e.key.toLowerCase();

    // Global actions — always allowed, even when paused
    switch (key) {
      case ' ':
        e.preventDefault();
        dispatch('toggleGlobalFreeze');
        return;
      case 'p':
        dispatch('saveScreenshot');
        return;
      case 'r':
        dispatch('recordVideo');
        return;
      case 'n':
        dispatch('newSeed');
        return;
      case 'q':
        dispatch('openAppMenu');
        return;
      case 'm':
        if (isMenuOpen) { closeMenu(); } else { openMenu(); }
        return;
    }

    // Block drawing/mode keys when paused
    if (state.globalFreeze) return;

    switch (key) {
      // Arrow keys — movement directions
      case 'arrowup':
        dispatch('waterfallUp');
        break;
      case 'arrowdown':
        dispatch('waterfallDown');
        break;
      case 'arrowleft':
        dispatch('moveLeft');
        break;
      case 'arrowright':
        dispatch('moveRight');
        break;

      // Letter shortcuts for modes
      case 'e':
        dispatch('cycleEraseMode');
        break;
      case 'f':
        dispatch('freezeBrush');
        break;
      case 's':
        dispatch('shuffle');
        break;
      case 't':
        dispatch('trickle');
        break;
      case 'd':
        dispatch('drawStatic');
        break;
      case 'g':
        dispatch('drawGem');
        break;
      case 'o':
        dispatch('drawSpace');
        break;

      // Brush size
      case '[':
        dispatch('decreaseBrushSize');
        break;
      case ']':
        dispatch('increaseBrushSize');
        break;

      // Manual mode
      case 'x':
        dispatch('toggleManualMode');
        break;
    }
  }
  window.addEventListener('keydown', handleKeyDown);

  // ---- Click delegation (menu panel buttons) ----
  function handleClick(e: MouseEvent) {
    if (isMenuAnimating) return;
    const target = e.target as HTMLElement;
    const el = target.closest('[data-action]') as HTMLElement | null;

    // If click wasn't on an interactive element, close the menu
    if (!el) {
      const isInteractive = target.closest('.brush-size-display, .mode-toggle');
      if (!isInteractive) closeMenu();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const actionName = el.dataset.action!;

    // When paused, only allow certain actions
    const pauseAllowed = ['toggleGlobalFreeze', 'openAppMenu', 'closeMenu'];
    if (state.globalFreeze && !pauseAllowed.includes(actionName)) return;

    dispatch(actionName);
  }
  menuContainer.addEventListener('click', handleClick);

  // ---- Open / Close ----
  function clearAnimGuard() {
    isMenuAnimating = false;
    if (animTimeoutId !== null) {
      clearTimeout(animTimeoutId);
      animTimeoutId = null;
    }
  }

  function openMenu() {
    if (!menuContainer || isMenuAnimating) return;
    isMenuAnimating = true;
    menuContainer.addEventListener('transitionend', function onEnd() {
      clearAnimGuard();
      menuContainer.removeEventListener('transitionend', onEnd);
    });
    animTimeoutId = setTimeout(clearAnimGuard, 300);

    menuContainer.classList.remove('menu-closed');
    isMenuOpen = true;
    if (toolsBtn) toolsBtn.classList.add('active');
    updateBrushDisplay();
    updateActiveStates();
  }

  function closeMenu() {
    if (!menuContainer || !isMenuOpen || isMenuAnimating) return;
    isMenuAnimating = true;
    menuContainer.addEventListener('transitionend', function onEnd() {
      clearAnimGuard();
      menuContainer.removeEventListener('transitionend', onEnd);
    });
    animTimeoutId = setTimeout(clearAnimGuard, 300);

    menuContainer.classList.add('menu-closed');
    isMenuOpen = false;
    if (toolsBtn) toolsBtn.classList.remove('active');
  }

  // ---- Action bar: SYSTEM button ----
  // Use 'click' (not pointerdown) so the full tap completes before
  // the overlay opens — prevents mobile ghost-event glitches.
  function handleSystemClick(e: MouseEvent) {
    e.stopPropagation();
    dispatch('openAppMenu');
  }
  if (systemBtn) {
    systemBtn.addEventListener('click', handleSystemClick);
  }

  // ---- Action bar: TOOLS button ----
  function handleToolsClick(e: PointerEvent) {
    e.stopPropagation();
    if (isMenuAnimating) return;
    if (isMenuOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }
  if (toolsBtn) {
    toolsBtn.addEventListener('pointerdown', handleToolsClick);
  }

  // ---- Action bar: RECORD button ----
  // TODO: Replace manual timeout with programmatic callback from engine when recording stops
  let isRecording = false;
  let recordTimeoutId: ReturnType<typeof setTimeout> | null = null;
  function handleRecordClick(e: MouseEvent) {
    e.stopPropagation();
    dispatch('recordVideo');
  }
  if (recordBtn) {
    recordBtn.addEventListener('click', handleRecordClick);
  }

  // ---- Click outside to close ----
  function handleClickOutside(e: PointerEvent) {
    if (!isMenuOpen || !menuContainer || isMenuAnimating) return;
    if (menuContainer.contains(e.target as Node)) return;
    // Don't close when clicking the action bar
    if (actionBar?.contains(e.target as Node)) return;
    closeMenu();
  }
  document.addEventListener('pointerdown', handleClickOutside);

  // ---- Brush size drag ----
  const brushDisplay = menuContainer.querySelector('.brush-size-display');

  function startBrushDrag(e: MouseEvent | TouchEvent) {
    if (state.globalFreeze) return;
    e.preventDefault();
    e.stopPropagation();
    isDraggingBrushSize = true;
    brushDragStartY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    brushDragStartIndex = state.brushSizeIndex;
  }

  function handleBrushDrag(e: MouseEvent | TouchEvent) {
    if (!isDraggingBrushSize) return;
    e.preventDefault();
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const deltaY = brushDragStartY - clientY;
    const indexDelta = Math.floor(deltaY / 20);
    const newIndex = Math.max(0, Math.min(state.brushSizeOptions.length - 1, brushDragStartIndex + indexDelta));

    if (newIndex !== state.brushSizeIndex) {
      state.brushSizeIndex = newIndex;
      state.brushSize = state.brushSizeOptions[state.brushSizeIndex];
      updateBrushDisplay();
      notify('brushSizeChanged');
    }
  }

  function endBrushDrag() {
    isDraggingBrushSize = false;
  }

  if (brushDisplay) {
    brushDisplay.addEventListener('mousedown', startBrushDrag as EventListener);
    brushDisplay.addEventListener('touchstart', startBrushDrag as EventListener);
  }
  document.addEventListener('mousemove', handleBrushDrag as EventListener);
  document.addEventListener('touchmove', handleBrushDrag as EventListener, { passive: false });
  document.addEventListener('mouseup', endBrushDrag);
  document.addEventListener('touchend', endBrushDrag);

  // ---- Update active states ----
  function updateActiveStates() {
    const btns = menuContainer.querySelectorAll<HTMLElement>('[data-action]');
    btns.forEach((btn) => {
      const action = btn.dataset.action!;
      let isActive = false;

      switch (action) {
        case 'waterfallUp':
          isActive = state.currentMode === 'waterfall' && state.currentDirection === 'up';
          break;
        case 'waterfallDown':
          isActive = state.currentMode === 'waterfall' && state.currentDirection === 'down';
          break;
        case 'moveLeft':
          isActive = state.currentMode === 'move' && state.currentDirection === 'left';
          break;
        case 'moveRight':
          isActive = state.currentMode === 'move' && state.currentDirection === 'right';
          break;
        case 'eraseMovement':
          isActive = state.currentMode === 'erase' && (state.eraseVariant === 'movement' || state.eraseVariant === 'both');
          break;
        case 'resetInitialMovement':
          isActive = state.currentMode === 'erase' && (state.eraseVariant === 'paint' || state.eraseVariant === 'both');
          break;
        case 'freezeBrush':
          isActive = state.currentMode === 'freeze';
          break;
        case 'shuffle':
          isActive = state.currentMode === 'shuffle';
          break;
        case 'trickle':
          isActive = state.currentMode === 'trickle';
          break;
        case 'drawStatic':
          isActive = state.currentMode === 'static';
          break;
        case 'drawGem':
          isActive = state.currentMode === 'gem';
          break;
        case 'drawSpace':
          isActive = state.currentMode === 'empty';
          break;
        case 'toggleGlobalFreeze':
          isActive = state.globalFreeze;
          break;
      }

      btn.classList.toggle('active', isActive);

      // Dim buttons disabled when paused
      const pauseAllowed = ['toggleGlobalFreeze', 'openAppMenu'];
      const isPausedDisabled = state.globalFreeze && !pauseAllowed.includes(action);
      btn.classList.toggle('paused-disabled', isPausedDisabled);

      // Update waterfall/straight arrow icons
      if (action === 'waterfallUp' || action === 'waterfallDown') {
        const icon = btn.querySelector('.icon');
        if (icon) {
          if (action === 'waterfallUp') {
            icon.textContent = state.waterfallVariant ? '⤊' : '↑';
          } else {
            icon.textContent = state.waterfallVariant ? '⤋' : '↓';
          }
        }
      }
    });

    // Toggle paused class on sections
    const brushCol = menuContainer.querySelector('.brush-column');
    const moveSec = menuContainer.querySelector('.movement-section');
    const paintSec = menuContainer.querySelector('.paint-section');
    if (brushCol) brushCol.classList.toggle('paused', state.globalFreeze);
    if (moveSec) moveSec.classList.toggle('paused', state.globalFreeze);
    if (paintSec) paintSec.classList.toggle('paused', state.globalFreeze);

    // Update pause button icon
    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) {
      const icon = pauseBtn.querySelector('.icon');
      if (icon) {
        icon.textContent = state.globalFreeze ? '▶\uFE0E' : '⏸\uFE0E';
      }
    }

    // Update manual/organic toggle
    const modeToggle = document.getElementById('mode-toggle');
    if (modeToggle) {
      modeToggle.classList.toggle('manual-active', state.manualMode);
      modeToggle.classList.toggle('organic-active', !state.manualMode);

      const manualLabel = modeToggle.querySelector('[data-mode="manual"]');
      const organicLabel = modeToggle.querySelector('[data-mode="organic"]');
      if (manualLabel) manualLabel.classList.toggle('active-label', state.manualMode);
      if (organicLabel) organicLabel.classList.toggle('active-label', !state.manualMode);
    }

  }

  // ---- Update brush display ----
  function updateBrushDisplay() {
    const preview = menuContainer.querySelector('.brush-preview') as HTMLElement | null;
    const label = menuContainer.querySelector('.brush-size-label');

    if (preview) {
      const minPx = 8;
      const maxPx = 40;
      const scale = state.brushSizeIndex / Math.max(1, state.brushSizeOptions.length - 1);
      const px = minPx + scale * (maxPx - minPx);
      preview.style.width = px + 'px';
      preview.style.height = px + 'px';
    }

    if (label) {
      label.textContent = Math.round(state.brushSize * 2) + 'px';
    }
  }

  // ---- Initial render ----
  updateActiveStates();
  updateBrushDisplay();

  // ---- Public API ----
  return {
    getState(): MenuState {
      return { ...state };
    },

    setState(partial: Partial<MenuState>) {
      Object.assign(state, partial);
      updateActiveStates();
      updateBrushDisplay();
    },

    open: openMenu,
    close: closeMenu,

    show() {
      if (actionBar) actionBar.classList.remove('bar-hidden');
      menuContainer.classList.remove('menu-hidden');
    },

    hide() {
      closeMenu();
      if (actionBar) actionBar.classList.add('bar-hidden');
      menuContainer.classList.add('menu-hidden');
    },

    updateActiveStates,
    updateBrushDisplay,

    destroy() {
      menuContainer.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('mousemove', handleBrushDrag as EventListener);
      document.removeEventListener('touchmove', handleBrushDrag as EventListener);
      document.removeEventListener('mouseup', endBrushDrag);
      document.removeEventListener('touchend', endBrushDrag);
      if (brushDisplay) {
        brushDisplay.removeEventListener('mousedown', startBrushDrag as EventListener);
        brushDisplay.removeEventListener('touchstart', startBrushDrag as EventListener);
      }
      if (systemBtn) systemBtn.removeEventListener('click', handleSystemClick);
      if (toolsBtn) toolsBtn.removeEventListener('pointerdown', handleToolsClick);
      if (recordBtn) recordBtn.removeEventListener('click', handleRecordClick);
      if (recordTimeoutId !== null) clearTimeout(recordTimeoutId);
    },
  };
}
