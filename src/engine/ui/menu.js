/**
 * Menu controller for the drawer UI.
 *
 * Usage (standalone HTML):
 *   <link rel="stylesheet" href="menu.css">
 *   <!-- paste or include menu.html -->
 *   <script src="menu.js"></script>
 *   <script>
 *     const menu = setupMenu({
 *       onAction: (action, state) => console.log(action, state),
 *     });
 *   </script>
 *
 * Usage (ES module import):
 *   import { setupMenu } from './menu.js';
 *   const menu = setupMenu({ onAction: (action, state) => { ... } });
 *
 * The onAction callback receives every dispatched action name and the
 * full current state object, so the consumer can wire it to any engine.
 */

/**
 * @typedef {Object} MenuState
 * @property {string}  currentMode       - Active draw mode
 * @property {string}  currentDirection  - Active direction (up/down/left/right)
 * @property {string}  eraseVariant      - 'movement' | 'paint' | 'both'
 * @property {boolean} waterfallVariant  - true = waterfall, false = straight
 * @property {boolean} globalFreeze      - Paused state
 * @property {boolean} manualMode        - Manual mode on/off
 * @property {boolean} isRecording       - Recording on/off
 * @property {number}  brushSize         - Current brush size value
 * @property {number}  brushSizeIndex    - Current index into brushSizeOptions
 * @property {number[]} brushSizeOptions - Available brush sizes
 */

/**
 * @typedef {Object} MenuOptions
 * @property {(action: string, state: MenuState) => void} [onAction]
 *   Called after every action is dispatched.
 * @property {number[]} [brushSizeOptions] - Override default brush size list.
 * @property {number}   [initialBrushSizeIndex] - Starting brush index.
 */

/**
 * Initialize the menu.
 * @param {MenuOptions} [opts]
 * @returns {{ getState: () => MenuState, setState: (partial: Partial<MenuState>) => void, open: () => void, close: () => void, updateActiveStates: () => void, updateBrushDisplay: () => void, destroy: () => void }}
 */
function setupMenu(opts) {
  opts = opts || {};

  // ---- DOM refs ----
  var menuContainer = document.getElementById('menu-container');
  if (!menuContainer) {
    console.warn('menu.js: #menu-container not found');
    return null;
  }

  // ---- State ----
  var state = {
    currentMode: 'waterfall',
    currentDirection: 'down',
    eraseVariant: 'movement',
    waterfallVariant: true,
    globalFreeze: false,
    manualMode: false,
    isRecording: false,
    brushSize: 1,
    brushSizeIndex: opts.initialBrushSizeIndex || 4,
    brushSizeOptions: opts.brushSizeOptions || [1, 2, 4, 8, 12, 16, 24, 32, 48, 64],
  };

  // Clamp initial index
  state.brushSizeIndex = Math.min(state.brushSizeIndex, state.brushSizeOptions.length - 1);
  state.brushSize = state.brushSizeOptions[state.brushSizeIndex];

  var isMenuOpen = false;
  var isMenuAnimating = false;

  // Brush drag state
  var isDraggingBrushSize = false;
  var brushDragStartY = 0;
  var brushDragStartIndex = 0;


  // ---- Notify consumer ----
  function notify(action) {
    if (opts.onAction) {
      opts.onAction(action, Object.assign({}, state));
    }
  }

  // ---- Actions map ----
  var actions = {
    closeMenu: function () {
      closeMenu();
    },

    // Brush size
    increaseBrushSize: function () {
      if (state.brushSizeOptions.length > 0) {
        state.brushSizeIndex = Math.min(state.brushSizeOptions.length - 1, state.brushSizeIndex + 1);
        state.brushSize = state.brushSizeOptions[state.brushSizeIndex];
        updateBrushDisplay();
      }
    },
    decreaseBrushSize: function () {
      if (state.brushSizeOptions.length > 0) {
        state.brushSizeIndex = Math.max(0, state.brushSizeIndex - 1);
        state.brushSize = state.brushSizeOptions[state.brushSizeIndex];
        updateBrushDisplay();
      }
    },

    // Movement modes
    waterfallUp: function () {
      state.currentMode = 'waterfall';
      state.currentDirection = 'up';
    },
    waterfallDown: function () {
      state.currentMode = 'waterfall';
      state.currentDirection = 'down';
    },
    moveLeft: function () {
      state.currentMode = 'move';
      state.currentDirection = 'left';
    },
    moveRight: function () {
      state.currentMode = 'move';
      state.currentDirection = 'right';
    },
    shuffle: function () {
      state.currentMode = 'shuffle';
    },
    trickle: function () {
      state.currentMode = 'trickle';
    },
    eraseMovement: function () {
      state.currentMode = 'erase';
      state.eraseVariant = 'movement';
    },
    freezeBrush: function () {
      state.currentMode = 'freeze';
    },

    // Pause
    toggleGlobalFreeze: function () {
      state.globalFreeze = !state.globalFreeze;
    },

    // Paint modes
    drawSpace: function () {
      state.currentMode = 'empty';
    },
    drawGem: function () {
      state.currentMode = 'gem';
    },
    drawStatic: function () {
      state.currentMode = 'static';
    },
    resetInitialMovement: function () {
      state.currentMode = 'erase';
      state.eraseVariant = 'paint';
    },

    // Global
    toggleManualMode: function () {
      state.manualMode = !state.manualMode;
    },
    globalReset: function () {
      // state doesn't change — consumer handles the reset
    },
    recordVideo: function () {
      state.isRecording = !state.isRecording;
    },

    // Composite erase cycling (E key)
    cycleEraseMode: function () {
      var variants = ['both', 'movement', 'paint'];
      if (state.currentMode !== 'erase') {
        state.currentMode = 'erase';
        state.eraseVariant = 'both';
      } else {
        var idx = variants.indexOf(state.eraseVariant);
        state.eraseVariant = variants[(idx + 1) % variants.length];
      }
    },

    // Passthrough actions — state doesn't change, consumer handles them
    newSeed: function () {},
    saveScreenshot: function () {},
  };

  // ---- Dispatch helper (runs action + updates UI + notifies) ----
  function dispatch(actionName) {
    if (actions[actionName]) {
      actions[actionName]();
      updateActiveStates();
      notify(actionName);
    }
  }

  // ---- Keyboard shortcuts ----
  function handleKeyDown(e) {
    var key = e.key.toLowerCase();

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
  function handleClick(e) {
    if (isMenuAnimating) return;
    var el = e.target.closest('[data-action]');
    if (!el) return;

    e.preventDefault();
    e.stopPropagation();

    var actionName = el.dataset.action;

    // When paused, only allow certain actions
    var pauseAllowed = ['toggleGlobalFreeze', 'recordVideo', 'closeMenu'];
    if (state.globalFreeze && pauseAllowed.indexOf(actionName) === -1) return;

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
    setTimeout(function () { isMenuAnimating = false; }, 300);

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
    setTimeout(function () { isMenuAnimating = false; }, 300);

    menuContainer.classList.add('menu-closed');
    isMenuOpen = false;
  }

  // ---- Drawer handle tap ----
  var drawerHandle = document.getElementById('drawer-handle');
  function handleDrawerTap(e) {
    if (!isMenuOpen && !isMenuAnimating) {
      e.stopPropagation();
      openMenu();
    }
  }
  if (drawerHandle) {
    drawerHandle.addEventListener('pointerdown', handleDrawerTap);
  }

  // ---- Click outside to close ----
  function handleClickOutside(e) {
    if (!isMenuOpen || !menuContainer || isMenuAnimating) return;
    if (menuContainer.contains(e.target)) return;
    closeMenu();
  }
  document.addEventListener('pointerdown', handleClickOutside);

  // ---- Brush size drag ----
  var brushDisplay = menuContainer.querySelector('.brush-size-display');

  function startBrushDrag(e) {
    if (state.globalFreeze) return;
    e.preventDefault();
    e.stopPropagation();
    isDraggingBrushSize = true;
    brushDragStartY = e.touches ? e.touches[0].clientY : e.clientY;
    brushDragStartIndex = state.brushSizeIndex;
  }

  function handleBrushDrag(e) {
    if (!isDraggingBrushSize) return;
    e.preventDefault();
    var clientY = e.touches ? e.touches[0].clientY : e.clientY;
    var deltaY = brushDragStartY - clientY;
    var indexDelta = Math.floor(deltaY / 20);
    var newIndex = Math.max(0, Math.min(state.brushSizeOptions.length - 1, brushDragStartIndex + indexDelta));

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
    brushDisplay.addEventListener('mousedown', startBrushDrag);
    brushDisplay.addEventListener('touchstart', startBrushDrag);
  }
  document.addEventListener('mousemove', handleBrushDrag);
  document.addEventListener('touchmove', handleBrushDrag, { passive: false });
  document.addEventListener('mouseup', endBrushDrag);
  document.addEventListener('touchend', endBrushDrag);

  // ---- Update active states ----
  function updateActiveStates() {
    var btns = menuContainer.querySelectorAll('[data-action]');
    btns.forEach(function (btn) {
      var action = btn.dataset.action;
      var isActive = false;

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
      var pauseAllowed = ['toggleGlobalFreeze', 'recordVideo'];
      var isPausedDisabled = state.globalFreeze && pauseAllowed.indexOf(action) === -1;
      btn.classList.toggle('paused-disabled', isPausedDisabled);

      // Update waterfall/straight arrow icons
      if (action === 'waterfallUp' || action === 'waterfallDown') {
        var icon = btn.querySelector('.icon');
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
    var brushCol = menuContainer.querySelector('.brush-column');
    var moveSec = menuContainer.querySelector('.movement-section');
    var paintSec = menuContainer.querySelector('.paint-section');
    if (brushCol) brushCol.classList.toggle('paused', state.globalFreeze);
    if (moveSec) moveSec.classList.toggle('paused', state.globalFreeze);
    if (paintSec) paintSec.classList.toggle('paused', state.globalFreeze);

    // Update pause button icon
    var pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) {
      var icon = pauseBtn.querySelector('.icon');
      if (icon) {
        icon.textContent = state.globalFreeze ? '▶' : '⏸\uFE0E';
      }
    }

    // Update record button
    var recBtn = document.getElementById('btn-record-gif');
    if (recBtn) {
      recBtn.classList.toggle('recording', state.isRecording);
    }
  }

  // ---- Update brush display ----
  function updateBrushDisplay() {
    var preview = menuContainer.querySelector('.brush-preview');
    var label = menuContainer.querySelector('.brush-size-label');

    if (preview) {
      var minPx = 8;
      var maxPx = 40;
      var scale = state.brushSizeIndex / Math.max(1, state.brushSizeOptions.length - 1);
      var px = minPx + scale * (maxPx - minPx);
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
    getState: function () {
      return Object.assign({}, state);
    },

    /** Merge partial state and re-render. */
    setState: function (partial) {
      Object.assign(state, partial);
      updateActiveStates();
      updateBrushDisplay();
    },

    open: openMenu,
    close: closeMenu,
    updateActiveStates: updateActiveStates,
    updateBrushDisplay: updateBrushDisplay,

    /** Remove all event listeners. */
    destroy: function () {
      menuContainer.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
      if (drawerHandle) drawerHandle.removeEventListener('pointerdown', handleDrawerTap);
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('mousemove', handleBrushDrag);
      document.removeEventListener('touchmove', handleBrushDrag);
      document.removeEventListener('mouseup', endBrushDrag);
      document.removeEventListener('touchend', endBrushDrag);
      if (brushDisplay) {
        brushDisplay.removeEventListener('mousedown', startBrushDrag);
        brushDisplay.removeEventListener('touchstart', startBrushDrag);
      }
    },
  };
}

// Support both <script> and ES module usage
export { setupMenu };
