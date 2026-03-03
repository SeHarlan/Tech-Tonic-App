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
  const menuContainer = document.getElementById('menu-container');
  if (!menuContainer) {
    console.warn('menu.ts: #menu-container not found');
    return null;
  }

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
      state.currentMode = 'waterfall';
      state.currentDirection = 'up';
    },
    waterfallDown() {
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
      state.currentMode = 'erase';
      state.eraseVariant = 'movement';
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
      state.currentMode = 'erase';
      state.eraseVariant = 'paint';
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
    recordVideo() {},
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

  // ---- Click delegation ----
  function handleClick(e: MouseEvent) {
    if (isMenuAnimating) return;
    const el = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!el) return;

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
  function openMenu() {
    if (!menuContainer || isMenuAnimating) return;
    isMenuAnimating = true;
    menuContainer.addEventListener('transitionend', function onEnd() {
      isMenuAnimating = false;
      menuContainer.removeEventListener('transitionend', onEnd);
    });
    setTimeout(() => { isMenuAnimating = false; }, 300);

    menuContainer.classList.remove('menu-closed');
    isMenuOpen = true;
    updateBrushDisplay();
    updateActiveStates();
  }

  function closeMenu() {
    if (!menuContainer || !isMenuOpen || isMenuAnimating) return;
    isMenuAnimating = true;
    menuContainer.addEventListener('transitionend', function onEnd() {
      isMenuAnimating = false;
      menuContainer.removeEventListener('transitionend', onEnd);
    });
    setTimeout(() => { isMenuAnimating = false; }, 300);

    menuContainer.classList.add('menu-closed');
    isMenuOpen = false;
  }

  // ---- Drawer handle tap ----
  const drawerHandle = document.getElementById('drawer-handle');
  function handleDrawerTap(e: PointerEvent) {
    if (!isMenuOpen && !isMenuAnimating) {
      e.stopPropagation();
      openMenu();
    }
  }
  if (drawerHandle) {
    drawerHandle.addEventListener('pointerdown', handleDrawerTap);
  }

  // ---- Click outside to close ----
  function handleClickOutside(e: PointerEvent) {
    if (!isMenuOpen || !menuContainer || isMenuAnimating) return;
    if (menuContainer.contains(e.target as Node)) return;
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
        case 'toggleManualMode':
          isActive = state.manualMode;
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
        icon.textContent = state.globalFreeze ? '▶' : '⏸\uFE0E';
      }
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
    updateActiveStates,
    updateBrushDisplay,

    destroy() {
      menuContainer.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
      if (drawerHandle) drawerHandle.removeEventListener('pointerdown', handleDrawerTap);
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('mousemove', handleBrushDrag as EventListener);
      document.removeEventListener('touchmove', handleBrushDrag as EventListener);
      document.removeEventListener('mouseup', endBrushDrag);
      document.removeEventListener('touchend', endBrushDrag);
      if (brushDisplay) {
        brushDisplay.removeEventListener('mousedown', startBrushDrag as EventListener);
        brushDisplay.removeEventListener('touchstart', startBrushDrag as EventListener);
      }
    },
  };
}
