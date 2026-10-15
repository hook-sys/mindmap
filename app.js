/**
 * MindMap Studio - Visual Mind Mapping Tool
 * Full Multi-User and Multi-Project Management Support
 */

// Application State
const state = {
  currentUser: 'Default User',
  currentProjectId: 'proj_default',
  currentProjectTitle: 'Main Project',
  users: ['Default User'],
  selectedTemplate: 'blank',

  nodes: {}, // id -> node object
  rootId: 'root',
  selectedId: null,
  editingId: null,

  panX: window.innerWidth / 2,
  panY: window.innerHeight / 2,
  zoom: 1,

  history: [],
  historyIndex: -1,

  isPanning: false,
  startPanX: 0,
  startPanY: 0,
  draggedNodeId: null,
  hasDragged: false,
  dragStartMouseX: 0,
  dragStartMouseY: 0,
  dragStartNodePositions: {}
};

// Built-in Templates
const TEMPLATES = {
  blank: (title) => ({
    root: {
      id: 'root',
      text: title || 'Central Topic',
      parentId: null,
      x: 0,
      y: 0,
      color: '#4F46E5',
      collapsed: false
    }
  }),
  plan: (title) => {
    const root = { id: 'root', text: title || 'Project Plan', parentId: null, x: 0, y: 0, color: '#4F46E5', collapsed: false };
    const c1 = { id: 'node_1', text: 'Objectives 🎯', parentId: 'root', x: 240, y: -90, color: '#0284C7', collapsed: false };
    const c2 = { id: 'node_2', text: 'Action Steps 📝', parentId: 'root', x: 240, y: 40, color: '#16A34A', collapsed: false };
    const sc = { id: 'node_3', text: 'Initial Research', parentId: 'node_2', x: 480, y: 40, color: '#16A34A', collapsed: false };
    const c3 = { id: 'node_4', text: 'Deliverables 🚀', parentId: 'root', x: 240, y: 170, color: '#9333EA', collapsed: false };
    return { root, node_1: c1, node_2: c2, node_3: sc, node_4: c3 };
  },
  brainstorm: (title) => {
    const root = { id: 'root', text: title || 'Brainstorming Session', parentId: null, x: 0, y: 0, color: '#D97706', collapsed: false };
    const c1 = { id: 'node_1', text: 'Core Problem ❓', parentId: 'root', x: 240, y: -90, color: '#DC2626', collapsed: false };
    const c2 = { id: 'node_2', text: 'Creative Ideas 💡', parentId: 'root', x: 240, y: 40, color: '#4F46E5', collapsed: false };
    const sc = { id: 'node_3', text: 'Top Priority Idea', parentId: 'node_2', x: 480, y: 40, color: '#4F46E5', collapsed: false };
    const c3 = { id: 'node_4', text: 'Key Benefits 👍', parentId: 'root', x: 240, y: 170, color: '#16A34A', collapsed: false };
    return { root, node_1: c1, node_2: c2, node_3: sc, node_4: c3 };
  },
  meeting: (title) => {
    const root = { id: 'root', text: title || 'Team Meeting Notes', parentId: null, x: 0, y: 0, color: '#0D9488', collapsed: false };
    const c1 = { id: 'node_1', text: 'Agenda 📋', parentId: 'root', x: 240, y: -90, color: '#0284C7', collapsed: false };
    const c2 = { id: 'node_2', text: 'Key Discussions 💬', parentId: 'root', x: 240, y: 40, color: '#9333EA', collapsed: false };
    const c3 = { id: 'node_3', text: 'Decisions & Actions 📌', parentId: 'root', x: 240, y: 170, color: '#DC2626', collapsed: false };
    return { root, node_1: c1, node_2: c2, node_3: c3 };
  }
};

// Storage Service (Backend REST API + LocalStorage Mirror)
const StorageService = {
  async getUsers() {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.users) && data.users.length) {
          localStorage.setItem('mm_users', JSON.stringify(data.users));
          return data.users;
        }
      }
    } catch (e) {}

    const local = localStorage.getItem('mm_users');
    return local ? JSON.parse(local) : ['Default User'];
  },

  async createUser(username) {
    const safeName = username.trim().substring(0, 50);
    try {
      await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: safeName })
      });
    } catch (e) {}

    const users = await this.getUsers();
    if (!users.includes(safeName)) {
      users.push(safeName);
      localStorage.setItem('mm_users', JSON.stringify(users));
    }
    return safeName;
  },

  async getProjects(username) {
    try {
      const res = await fetch(`/api/projects?user=${encodeURIComponent(username)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.projects)) {
          return data.projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        }
      }
    } catch (e) {}

    const key = `mm_${username}_projects`;
    const local = localStorage.getItem(key);
    if (local) {
      try {
        const obj = JSON.parse(local);
        return Object.values(obj).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      } catch (err) {}
    }
    return [];
  },

  async getProject(username, projectId) {
    try {
      const res = await fetch(`/api/projects/${projectId}?user=${encodeURIComponent(username)}`);
      if (res.ok) return await res.json();
    } catch (e) {}

    const key = `mm_${username}_projects`;
    const local = localStorage.getItem(key);
    if (local) {
      try {
        const obj = JSON.parse(local);
        if (obj[projectId]) return obj[projectId];
      } catch (err) {}
    }
    return null;
  },

  _saveQueue: Promise.resolve(),

  saveProject(username, projectData) {
    const record = {
      id: projectData.id,
      title: projectData.title,
      nodes: projectData.nodes,
      rootId: projectData.rootId || 'root',
      updatedAt: Date.now()
    };

    this._saveQueue = this._saveQueue.then(async () => {
      try {
        await fetch(`/api/projects?user=${encodeURIComponent(username)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record)
        });
      } catch (e) {}

      const key = `mm_${username}_projects`;
      const local = localStorage.getItem(key);
      const obj = local ? JSON.parse(local) : {};
      obj[record.id] = record;
      localStorage.setItem(key, JSON.stringify(obj));
    }).catch(err => {
      console.error('Save queue error:', err);
    });

    return this._saveQueue;
  },

  async deleteProject(username, projectId) {
    try {
      await fetch(`/api/projects/${projectId}?user=${encodeURIComponent(username)}`, {
        method: 'DELETE'
      });
    } catch (e) {}

    const key = `mm_${username}_projects`;
    const local = localStorage.getItem(key);
    if (local) {
      try {
        const obj = JSON.parse(local);
        delete obj[projectId];
        localStorage.setItem(key, JSON.stringify(obj));
      } catch (err) {}
    }
  }
};

// DOM Elements
const canvasViewport = document.getElementById('canvas-viewport');
const canvasWorld = document.getElementById('canvas-world');
const svgConnectors = document.getElementById('svg-connectors');
const nodesContainer = document.getElementById('nodes-container');
const zoomLevelText = document.getElementById('zoom-level');

// Top Toolbar & Project Elements
const projectTitleInput = document.getElementById('project-title-input');
const btnProjectsMgr = document.getElementById('btn-projects-mgr');
const btnNewProjectTrigger = document.getElementById('btn-new-project-trigger');
const btnAddChild = document.getElementById('btn-add-child');
const btnAddSibling = document.getElementById('btn-add-sibling');
const btnDeleteNode = document.getElementById('btn-delete-node');
const btnAutoLayout = document.getElementById('btn-auto-layout');
const btnColorPalette = document.getElementById('btn-color-palette');
const colorPopover = document.getElementById('color-popover');
const currentColorDot = document.getElementById('current-color-dot');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnResetView = document.getElementById('btn-reset-view');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnExportImg = document.getElementById('btn-export-img');
const btnCloseTip = document.getElementById('btn-close-tip');
const saveStatusText = document.getElementById('save-status-text');
const saveStatusPill = document.getElementById('save-status');
const btnFitScreen = document.getElementById('btn-fit-screen');
const btnShortcutsPill = document.getElementById('btn-shortcuts-pill');

// User Menu Elements
const btnUserProfile = document.getElementById('btn-user-profile');
const userAvatarBadge = document.getElementById('user-avatar-badge');
const userNameText = document.getElementById('user-name-text');
const userDropdown = document.getElementById('user-dropdown');
const userDropdownName = document.getElementById('user-dropdown-name');
const btnSwitchUserModal = document.getElementById('btn-switch-user-modal');

// Modals
const projectsModal = document.getElementById('projects-modal');
const btnCloseProjectsModal = document.getElementById('btn-close-projects-modal');
const btnModalCreateProject = document.getElementById('btn-modal-create-project');
const projectsListContainer = document.getElementById('projects-list-container');
const modalProjectUserLabel = document.getElementById('modal-project-user-label');

const newProjectModal = document.getElementById('new-project-modal');
const btnCloseNewProjectModal = document.getElementById('btn-close-new-project-modal');
const newProjectNameInput = document.getElementById('new-project-name-input');
const btnCancelNewProject = document.getElementById('btn-cancel-new-project');
const btnConfirmCreateProject = document.getElementById('btn-confirm-create-project');

const usersModal = document.getElementById('users-modal');
const btnCloseUsersModal = document.getElementById('btn-close-users-modal');
const usersListContainer = document.getElementById('users-list-container');
const newUsernameInput = document.getElementById('new-username-input');
const btnSubmitAddUser = document.getElementById('btn-submit-add-user');

const helpModal = document.getElementById('help-modal');
const btnHelp = document.getElementById('btn-help');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnGotIt = document.getElementById('btn-got-it');

const DEFAULT_COLORS = ['#4F46E5', '#0284C7', '#0D9488', '#16A34A', '#D97706', '#DC2626', '#9333EA', '#DB2777'];

// Application Initialization
async function init() {
  // Load active user
  const savedUser = localStorage.getItem('mm_active_user') || 'Default User';
  state.currentUser = savedUser;
  updateUserUI();

  // Load project for active user
  await loadUserProjects(state.currentUser);

  updateViewTransform();
  render();
  setupEventListeners();
}

function updateUserUI() {
  const initial = state.currentUser.charAt(0).toUpperCase();
  userAvatarBadge.innerText = initial;
  userNameText.innerText = state.currentUser;
  userDropdownName.innerText = state.currentUser;
  modalProjectUserLabel.innerText = state.currentUser;
}

// Load or restore projects for given user
async function loadUserProjects(username) {
  const projects = await StorageService.getProjects(username);

  if (projects && projects.length > 0) {
    // Open most recently updated project
    const latest = projects[0];
    const fullProj = await StorageService.getProject(username, latest.id);
    if (fullProj && fullProj.nodes && Object.keys(fullProj.nodes).length > 0) {
      state.currentProjectId = fullProj.id;
      state.currentProjectTitle = fullProj.title || 'Main Project';
      state.nodes = fullProj.nodes;
      state.rootId = fullProj.rootId || 'root';
      state.selectedId = state.rootId;
    } else {
      createDefaultProject(username);
    }
  } else {
    // Check if there was an old single-project session to migrate
    const oldRaw = localStorage.getItem('mindmap_app_data');
    if (oldRaw && username === 'Default User') {
      try {
        const oldData = JSON.parse(oldRaw);
        if (oldData.nodes && Object.keys(oldData.nodes).length > 0) {
          state.currentProjectId = 'proj_main';
          state.currentProjectTitle = 'Main Project';
          state.nodes = oldData.nodes;
          state.rootId = oldData.rootId || 'root';
          state.selectedId = state.rootId;
          await StorageService.saveProject(username, {
            id: state.currentProjectId,
            title: state.currentProjectTitle,
            nodes: state.nodes,
            rootId: state.rootId
          });
          projectTitleInput.value = state.currentProjectTitle;
          state.history = [];
          state.historyIndex = -1;
          saveHistorySnapshot();
          return;
        }
      } catch (e) {}
    }

    createDefaultProject(username);
  }

  projectTitleInput.value = state.currentProjectTitle;
  state.history = [];
  state.historyIndex = -1;
  saveHistorySnapshot();
}

function createDefaultProject(username) {
  state.currentProjectId = `proj_${Date.now()}`;
  state.currentProjectTitle = 'Main Project';
  state.nodes = TEMPLATES.plan('Main Topic');
  state.rootId = 'root';
  state.selectedId = 'root';

  StorageService.saveProject(username, {
    id: state.currentProjectId,
    title: state.currentProjectTitle,
    nodes: state.nodes,
    rootId: state.rootId
  });
}

let saveStatusTimeout = null;
function notifySaveStatus(status = 'Saved') {
  if (!saveStatusText) return;
  saveStatusText.textContent = status;
  if (saveStatusPill) {
    if (status === 'Saving...') {
      saveStatusPill.classList.add('saving');
    } else {
      saveStatusPill.classList.remove('saving');
    }
  }
}

// Save & Snapshot History
function saveHistorySnapshot() {
  if (state.historyIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.historyIndex + 1);
  }

  const snapshot = JSON.stringify({
    nodes: state.nodes,
    rootId: state.rootId,
    selectedId: state.selectedId,
    title: state.currentProjectTitle
  });

  state.history.push(snapshot);
  if (state.history.length > 30) {
    state.history.shift();
  } else {
    state.historyIndex++;
  }

  notifySaveStatus('Saving...');
  if (saveStatusTimeout) clearTimeout(saveStatusTimeout);
  saveStatusTimeout = setTimeout(() => {
    notifySaveStatus('Saved');
  }, 450);

  // Persist project automatically
  StorageService.saveProject(state.currentUser, {
    id: state.currentProjectId,
    title: state.currentProjectTitle,
    nodes: state.nodes,
    rootId: state.rootId
  });
}

function undo() {
  if (state.editingId) {
    state.editingId = null;
  }
  if (state.historyIndex > 0) {
    state.historyIndex--;
    const snapshot = JSON.parse(state.history[state.historyIndex]);
    state.nodes = snapshot.nodes;
    state.rootId = snapshot.rootId;
    state.selectedId = snapshot.selectedId;
    render();
    notifySaveStatus('Saving...');
    if (saveStatusTimeout) clearTimeout(saveStatusTimeout);
    saveStatusTimeout = setTimeout(() => {
      notifySaveStatus('Saved');
    }, 400);
    StorageService.saveProject(state.currentUser, {
      id: state.currentProjectId,
      title: state.currentProjectTitle,
      nodes: state.nodes,
      rootId: state.rootId
    });
  }
}

function redo() {
  if (state.editingId) {
    state.editingId = null;
  }
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    const snapshot = JSON.parse(state.history[state.historyIndex]);
    state.nodes = snapshot.nodes;
    state.rootId = snapshot.rootId;
    state.selectedId = snapshot.selectedId;
    render();
    notifySaveStatus('Saving...');
    if (saveStatusTimeout) clearTimeout(saveStatusTimeout);
    saveStatusTimeout = setTimeout(() => {
      notifySaveStatus('Saved');
    }, 400);
    StorageService.saveProject(state.currentUser, {
      id: state.currentProjectId,
      title: state.currentProjectTitle,
      nodes: state.nodes,
      rootId: state.rootId
    });
  }
}

// Node Operations
function getChildren(nodeId) {
  return Object.values(state.nodes).filter(node => node.parentId === nodeId);
}

function getSubtreeIds(nodeId) {
  const ids = [nodeId];
  const children = getChildren(nodeId);
  children.forEach(child => {
    ids.push(...getSubtreeIds(child.id));
  });
  return ids;
}

function isNodeVisible(nodeId) {
  let curr = state.nodes[nodeId];
  while (curr && curr.parentId) {
    const parent = state.nodes[curr.parentId];
    if (!parent) break;
    if (parent.collapsed) return false;
    curr = parent;
  }
  return true;
}

function getNodeDepth(nodeId) {
  let depth = 0;
  let curr = state.nodes[nodeId];
  while (curr && curr.parentId && state.nodes[curr.parentId]) {
    depth++;
    curr = state.nodes[curr.parentId];
  }
  return depth;
}

function toggleCollapse(nodeId) {
  const node = state.nodes[nodeId];
  if (!node) return;

  node.collapsed = !node.collapsed;

  if (node.collapsed && !isNodeVisible(state.selectedId)) {
    state.selectedId = node.id;
  }

  saveHistorySnapshot();
  render();
}

function cycleNodeColor(nodeId) {
  const node = state.nodes[nodeId];
  if (!node) return;
  const currentIndex = DEFAULT_COLORS.indexOf(node.color);
  const nextColor = DEFAULT_COLORS[(currentIndex + 1) % DEFAULT_COLORS.length];
  changeSelectedNodeColor(nextColor, nodeId);
}

function addChildNode(parentId) {
  const targetParentId = parentId || state.selectedId || state.rootId;
  const parent = state.nodes[targetParentId];
  if (!parent) return;

  if (parent.collapsed) {
    parent.collapsed = false;
  }

  const newId = 'node_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const siblings = getChildren(parent.id);
  const isParentRoot = parent.id === state.rootId;

  const direction = (parent.x < 0) ? -1 : 1;
  const offsetX = (isParentRoot ? 240 : 200) * direction;
  const offsetY = (siblings.length - (siblings.length ? (siblings.length - 1) / 2 : 0)) * 65;

  let nodeColor = parent.color || '#4F46E5';
  if (isParentRoot) {
    nodeColor = DEFAULT_COLORS[siblings.length % DEFAULT_COLORS.length];
  }

  const newNode = {
    id: newId,
    text: 'New Idea',
    parentId: parent.id,
    x: parent.x + offsetX,
    y: parent.y + offsetY,
    color: nodeColor,
    collapsed: false
  };

  state.nodes[newId] = newNode;
  state.selectedId = newId;

  saveHistorySnapshot();
  render();

  setTimeout(() => {
    startEditing(newId);
  }, 50);
}

function addSiblingNode(currentNodeId) {
  const current = state.nodes[currentNodeId || state.selectedId];
  if (!current || !current.parentId) {
    addChildNode(state.rootId);
    return;
  }

  const parent = state.nodes[current.parentId];
  if (!parent) return;

  const newId = 'node_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

  const newNode = {
    id: newId,
    text: 'New Branch',
    parentId: parent.id,
    x: current.x,
    y: current.y + 70,
    color: current.color,
    collapsed: false
  };

  state.nodes[newId] = newNode;
  state.selectedId = newId;

  saveHistorySnapshot();
  render();

  setTimeout(() => {
    startEditing(newId);
  }, 50);
}

function deleteNode(nodeId) {
  const targetId = nodeId || state.selectedId;
  if (!targetId) return;

  if (targetId === state.rootId) {
    alert('The root node cannot be deleted.');
    return;
  }

  const targetNode = state.nodes[targetId];
  const parentId = targetNode ? targetNode.parentId : null;

  const idsToDelete = getSubtreeIds(targetId);
  idsToDelete.forEach(id => {
    delete state.nodes[id];
  });

  state.selectedId = parentId || state.rootId;
  saveHistorySnapshot();
  render();
}

function changeSelectedNodeColor(color, targetId) {
  const id = targetId || state.selectedId;
  if (!id || !state.nodes[id]) return;
  state.nodes[id].color = color;
  
  const subtree = getSubtreeIds(id);
  subtree.forEach(subId => {
    if (subId !== id && state.nodes[subId]) {
      state.nodes[subId].color = color;
    }
  });

  saveHistorySnapshot();
  render();
}

// Auto Layout
function applyAutoLayout() {
  const root = state.nodes[state.rootId];
  if (!root) return;

  root.x = 0;
  root.y = 0;

  const directChildren = getChildren(root.id);
  const rightChildren = [];
  const leftChildren = [];

  directChildren.forEach((child, index) => {
    if (index % 2 === 0) {
      rightChildren.push(child);
    } else {
      leftChildren.push(child);
    }
  });

  function layoutBranch(node, direction, depth, yStart) {
    const children = getChildren(node.id);
    if (children.length === 0) {
      return { totalHeight: 65, midY: yStart };
    }

    let currentY = yStart;
    let childYMidpoints = [];

    children.forEach(child => {
      const childX = node.x + (direction * 220);
      const res = layoutBranch(child, direction, depth + 1, currentY);
      child.x = childX;
      child.y = res.midY;
      childYMidpoints.push(res.midY);
      currentY += Math.max(res.totalHeight, 65);
    });

    const minChildY = Math.min(...childYMidpoints);
    const maxChildY = Math.max(...childYMidpoints);
    const midY = (minChildY + maxChildY) / 2;
    const totalHeight = currentY - yStart;

    return { totalHeight, midY };
  }

  let rightStartY = -((rightChildren.length - 1) * 70) / 2;
  rightChildren.forEach(child => {
    child.x = 240;
    const res = layoutBranch(child, 1, 1, rightStartY);
    child.y = res.midY;
    rightStartY += Math.max(res.totalHeight, 75);
  });

  let leftStartY = -((leftChildren.length - 1) * 70) / 2;
  leftChildren.forEach(child => {
    child.x = -240;
    const res = layoutBranch(child, -1, 1, leftStartY);
    child.y = res.midY;
    leftStartY += Math.max(res.totalHeight, 75);
  });

  centerView();
  saveHistorySnapshot();
  render();
}

// Text Editing
function startEditing(nodeId) {
  state.editingId = nodeId;
  const nodeEl = document.getElementById(`node-elem-${nodeId}`);
  if (!nodeEl) return;

  nodeEl.classList.add('editing');
  const textEl = nodeEl.querySelector('.node-text');
  textEl.contentEditable = "true";
  textEl.focus();

  const range = document.createRange();
  range.selectNodeContents(textEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function finishEditing() {
    textEl.contentEditable = "false";
    nodeEl.classList.remove('editing');
    const newText = textEl.innerText.trim() || 'Untitled';
    if (state.nodes[nodeId]) {
      const oldText = state.nodes[nodeId].text;
      state.nodes[nodeId].text = newText;
      if (oldText !== newText) {
        saveHistorySnapshot();
      }
    }
    state.editingId = null;
    render();
  }

  textEl.onblur = finishEditing;

  textEl.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      textEl.blur();
    } else if (e.key === 'Escape') {
      textEl.innerText = state.nodes[nodeId].text;
      textEl.blur();
    }
  };
}

// Rendering
function render() {
  renderNodes();
  renderConnectors();
  updateToolbarState();
}

function renderNodes() {
  nodesContainer.innerHTML = '';

  Object.values(state.nodes).forEach(node => {
    if (!isNodeVisible(node.id)) return;

    const depth = getNodeDepth(node.id);
    const isRoot = node.id === state.rootId;
    const isSelected = node.id === state.selectedId;
    const children = getChildren(node.id);
    const hasChildren = children.length > 0;
    const isCollapsed = Boolean(node.collapsed);

    const div = document.createElement('div');
    div.id = `node-elem-${node.id}`;
    div.className = `mind-node depth-${Math.min(depth, 3)} ${isRoot ? 'root-node' : ''} ${isSelected ? 'selected' : ''} ${hasChildren ? 'has-children' : ''} ${isCollapsed ? 'is-collapsed' : ''}`;
    div.style.left = `${node.x}px`;
    div.style.top = `${node.y}px`;

    const accentColor = node.color || '#4F46E5';
    div.style.setProperty('--node-accent', accentColor);

    if (isRoot) {
      div.style.backgroundColor = accentColor;
    } else {
      div.style.borderLeftColor = accentColor;
    }

    // 1. Floating Micro Action Bar on Hover / Selection
    const quickBar = document.createElement('div');
    quickBar.className = 'node-quick-bar';

    // Add Child button
    const btnAdd = document.createElement('button');
    btnAdd.className = 'node-btn add-btn';
    btnAdd.title = 'Add Child Node (Tab)';
    btnAdd.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>`;
    btnAdd.addEventListener('mousedown', (e) => e.stopPropagation());
    btnAdd.addEventListener('click', (e) => {
      e.stopPropagation();
      addChildNode(node.id);
    });
    quickBar.appendChild(btnAdd);

    // Color Cycle button
    const btnColor = document.createElement('button');
    btnColor.className = 'node-btn color-btn';
    btnColor.title = 'Cycle Color';
    btnColor.innerHTML = `<span class="action-color-dot" style="background:${accentColor};"></span>`;
    btnColor.addEventListener('mousedown', (e) => e.stopPropagation());
    btnColor.addEventListener('click', (e) => {
      e.stopPropagation();
      cycleNodeColor(node.id);
    });
    quickBar.appendChild(btnColor);

    // Collapse / Expand toggle button (if has children)
    if (hasChildren) {
      const btnToggle = document.createElement('button');
      btnToggle.className = 'node-btn toggle-btn';
      btnToggle.title = isCollapsed ? `Expand branches (${children.length})` : 'Collapse branches';
      btnToggle.innerHTML = isCollapsed
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/></svg>`;
      btnToggle.addEventListener('mousedown', (e) => e.stopPropagation());
      btnToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCollapse(node.id);
      });
      quickBar.appendChild(btnToggle);
    }

    // Delete button (non-root)
    if (!isRoot) {
      const btnDel = document.createElement('button');
      btnDel.className = 'node-btn delete-btn';
      btnDel.title = 'Delete node (Del)';
      btnDel.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
      btnDel.addEventListener('mousedown', (e) => e.stopPropagation());
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteNode(node.id);
      });
      quickBar.appendChild(btnDel);
    }

    div.appendChild(quickBar);

    // 2. Node Text
    const textSpan = document.createElement('span');
    textSpan.className = 'node-text';
    textSpan.innerText = node.text;
    div.appendChild(textSpan);

    // 3. Collapse Badge on connecting line (if has children)
    if (hasChildren) {
      const badge = document.createElement('div');
      badge.className = `node-collapse-badge ${isCollapsed ? 'is-collapsed' : ''}`;
      badge.title = isCollapsed ? `Click to expand (${children.length} hidden)` : 'Click to collapse branches';
      badge.innerText = isCollapsed ? `+${children.length}` : '−';
      badge.addEventListener('mousedown', (e) => e.stopPropagation());
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCollapse(node.id);
      });
      div.appendChild(badge);
    }

    // 4. Dedicated Child Add Handle Button (+)
    const addHandle = document.createElement('div');
    addHandle.className = 'node-add-handle';
    addHandle.title = 'Add Child Node (+)';
    addHandle.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 5v14M5 12h14"/></svg>`;
    addHandle.addEventListener('mousedown', (e) => e.stopPropagation());
    addHandle.addEventListener('click', (e) => {
      e.stopPropagation();
      addChildNode(node.id);
    });
    div.appendChild(addHandle);

    // Click & Drag Events
    div.addEventListener('mousedown', (e) => onNodeMouseDown(e, node.id));
    div.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startEditing(node.id);
    });

    nodesContainer.appendChild(div);
  });
}

function renderConnectors() {
  svgConnectors.innerHTML = '';

  Object.values(state.nodes).forEach(node => {
    if (!node.parentId || !state.nodes[node.parentId]) return;

    const parent = state.nodes[node.parentId];
    if (!isNodeVisible(parent.id) || !isNodeVisible(node.id)) return;

    const isDirectlySelected = (node.id === state.selectedId);
    const isParentSelected = (parent.id === state.selectedId);
    const isBranchActive = isDirectlySelected || isParentSelected;

    const pEl = document.getElementById(`node-elem-${parent.id}`);
    const cEl = document.getElementById(`node-elem-${node.id}`);

    const pWidth = pEl ? pEl.offsetWidth : 120;
    const cWidth = cEl ? cEl.offsetWidth : 120;

    let startX, endX;
    if (node.x >= parent.x) {
      startX = parent.x + (pWidth / 2);
      endX = node.x - (cWidth / 2);
    } else {
      startX = parent.x - (pWidth / 2);
      endX = node.x + (cWidth / 2);
    }

    const startY = parent.y;
    const endY = node.y;

    const horizontalDist = Math.abs(endX - startX);
    const verticalDist = Math.abs(endY - startY);
    // Smooth Bezier handle offset with minimum curve radius
    const dx = Math.max(horizontalDist * 0.5, Math.min(verticalDist * 0.45, 45));
    const ctrl1X = node.x >= parent.x ? startX + dx : startX - dx;
    const ctrl2X = node.x >= parent.x ? endX - dx : endX + dx;

    const pathData = `M ${startX} ${startY} C ${ctrl1X} ${startY}, ${ctrl2X} ${endY}, ${endX} ${endY}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('class', `connector-line ${isBranchActive ? 'active' : ''}`);
    path.setAttribute('stroke', isBranchActive ? (node.color || '#4F46E5') : '#cbd5e1');
    path.setAttribute('stroke-width', isBranchActive ? '2.5' : '1.75');

    svgConnectors.appendChild(path);
  });
}

function updateToolbarState() {
  const selectedNode = state.nodes[state.selectedId];
  if (selectedNode) {
    currentColorDot.style.backgroundColor = selectedNode.color || '#4F46E5';
    btnDeleteNode.disabled = (selectedNode.id === state.rootId);
  }
  btnUndo.disabled = (state.historyIndex <= 0);
  btnRedo.disabled = (state.historyIndex >= state.history.length - 1);
}

function selectNode(nodeId) {
  state.selectedId = nodeId;
  document.querySelectorAll('.mind-node').forEach(el => {
    el.classList.remove('selected');
  });
  const el = document.getElementById(`node-elem-${nodeId}`);
  if (el) {
    el.classList.add('selected');
  }
  renderConnectors();
  updateToolbarState();
}

// Dragging Nodes
function onNodeMouseDown(e, nodeId) {
  if (e.button !== 0) return;
  if (state.editingId === nodeId) return;

  // Ignore clicks inside button handles
  if (e.target.closest('.node-quick-bar, .node-add-handle, .node-collapse-badge')) {
    return;
  }

  e.stopPropagation();
  selectNode(nodeId);

  state.draggedNodeId = nodeId;
  state.hasDragged = false;
  state.dragStartMouseX = e.clientX;
  state.dragStartMouseY = e.clientY;

  state.dragStartNodePositions = {};
  const subtree = getSubtreeIds(nodeId);
  subtree.forEach(id => {
    state.dragStartNodePositions[id] = {
      x: state.nodes[id].x,
      y: state.nodes[id].y
    };
  });

  window.addEventListener('mousemove', onNodeMouseMove);
  window.addEventListener('mouseup', onNodeMouseUp);
}

function onNodeMouseMove(e) {
  if (!state.draggedNodeId) return;

  const dx = (e.clientX - state.dragStartMouseX) / state.zoom;
  const dy = (e.clientY - state.dragStartMouseY) / state.zoom;

  if (!state.hasDragged) {
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      state.hasDragged = true;
      const el = document.getElementById(`node-elem-${state.draggedNodeId}`);
      if (el) el.classList.add('dragging');
    } else {
      return;
    }
  }

  Object.keys(state.dragStartNodePositions).forEach(id => {
    if (state.nodes[id]) {
      state.nodes[id].x = state.dragStartNodePositions[id].x + dx;
      state.nodes[id].y = state.dragStartNodePositions[id].y + dy;

      const el = document.getElementById(`node-elem-${id}`);
      if (el) {
        el.style.left = `${state.nodes[id].x}px`;
        el.style.top = `${state.nodes[id].y}px`;
      }
    }
  });

  renderConnectors();
}

function onNodeMouseUp() {
  if (state.draggedNodeId) {
    const el = document.getElementById(`node-elem-${state.draggedNodeId}`);
    if (el) el.classList.remove('dragging');

    const didDrag = state.hasDragged;
    state.draggedNodeId = null;
    state.hasDragged = false;
    state.dragStartNodePositions = {};

    if (didDrag) {
      saveHistorySnapshot();
      render();
    }
  }
  window.removeEventListener('mousemove', onNodeMouseMove);
  window.removeEventListener('mouseup', onNodeMouseUp);
}

// Viewport Transform
function updateViewTransform() {
  canvasWorld.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  zoomLevelText.innerText = `${Math.round(state.zoom * 100)}%`;
}

function centerView() {
  state.panX = window.innerWidth / 2;
  state.panY = window.innerHeight / 2;
  state.zoom = 1;
  updateViewTransform();
}

function fitToScreen() {
  const nodes = Object.values(state.nodes).filter(node => isNodeVisible(node.id));
  if (nodes.length === 0) {
    centerView();
    return;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(node => {
    const el = document.getElementById(`node-elem-${node.id}`);
    const w = el ? el.offsetWidth : 140;
    const h = el ? el.offsetHeight : 50;
    minX = Math.min(minX, node.x - w / 2);
    minY = Math.min(minY, node.y - h / 2);
    maxX = Math.max(maxX, node.x + w / 2);
    maxY = Math.max(maxY, node.y + h / 2);
  });

  const rect = canvasViewport.getBoundingClientRect();
  const vpWidth = rect.width || window.innerWidth;
  const vpHeight = rect.height || (window.innerHeight - 56);

  const contentW = Math.max(maxX - minX, 100);
  const contentH = Math.max(maxY - minY, 100);
  const padding = 100;

  const scaleX = (vpWidth - padding * 2) / contentW;
  const scaleY = (vpHeight - padding * 2) / contentH;
  let targetZoom = Math.min(scaleX, scaleY, 1.0);
  targetZoom = Math.min(Math.max(targetZoom, 0.25), 2.0);

  const contentCenterX = (minX + maxX) / 2;
  const contentCenterY = (minY + maxY) / 2;

  state.zoom = targetZoom;
  state.panX = (vpWidth / 2) - contentCenterX * targetZoom;
  state.panY = (vpHeight / 2) - contentCenterY * targetZoom;

  updateViewTransform();
}

function setZoom(newZoom, centerX = window.innerWidth / 2, centerY = window.innerHeight / 2) {
  const clampedZoom = Math.min(Math.max(newZoom, 0.25), 2.5);
  if (clampedZoom === state.zoom) return;

  const worldX = (centerX - state.panX) / state.zoom;
  const worldY = (centerY - state.panY) / state.zoom;

  state.zoom = clampedZoom;
  state.panX = centerX - worldX * state.zoom;
  state.panY = centerY - worldY * state.zoom;

  updateViewTransform();
}

// Export to PNG Image
function exportToImage() {
  const nodes = Object.values(state.nodes).filter(node => isNodeVisible(node.id));
  if (nodes.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(node => {
    const el = document.getElementById(`node-elem-${node.id}`);
    const w = el ? el.offsetWidth : 140;
    const h = el ? el.offsetHeight : 50;
    minX = Math.min(minX, node.x - w / 2);
    minY = Math.min(minY, node.y - h / 2);
    maxX = Math.max(maxX, node.x + w / 2);
    maxY = Math.max(maxY, node.y + h / 2);
  });

  const padding = 60;
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  const width = Math.max(maxX - minX, 400);
  const height = Math.max(maxY - minY, 300);

  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  nodes.forEach(node => {
    if (!node.parentId || !state.nodes[node.parentId] || !isNodeVisible(node.parentId)) return;
    const parent = state.nodes[node.parentId];

    const pEl = document.getElementById(`node-elem-${parent.id}`);
    const cEl = document.getElementById(`node-elem-${node.id}`);
    const pWidth = pEl ? pEl.offsetWidth : 120;
    const cWidth = cEl ? cEl.offsetWidth : 120;

    let startX = (node.x >= parent.x ? parent.x + pWidth / 2 : parent.x - pWidth / 2) - minX;
    let endX = (node.x >= parent.x ? node.x - cWidth / 2 : node.x + cWidth / 2) - minX;
    let startY = parent.y - minY;
    let endY = node.y - minY;

    const horizontalDist = Math.abs(endX - startX);
    const verticalDist = Math.abs(endY - startY);
    const dx = Math.max(horizontalDist * 0.5, Math.min(verticalDist * 0.45, 45));
    const ctrl1X = node.x >= parent.x ? startX + dx : startX - dx;
    const ctrl2X = node.x >= parent.x ? endX - dx : endX + dx;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(ctrl1X, startY, ctrl2X, endY, endX, endY);
    ctx.strokeStyle = node.color || '#4F46E5';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });

  nodes.forEach(node => {
    const isRoot = node.id === state.rootId;
    const el = document.getElementById(`node-elem-${node.id}`);
    const w = el ? el.offsetWidth : 130;
    const h = el ? el.offsetHeight : 44;
    const x = (node.x - w / 2) - minX;
    const y = (node.y - h / 2) - minY;
    const radius = isRoot ? 12 : 8;

    function drawRoundedRect(c, rx, ry, rw, rh, r) {
      if (typeof c.roundRect === 'function') {
        c.roundRect(rx, ry, rw, rh, r);
      } else {
        const rad = typeof r === 'number' ? r : 6;
        c.moveTo(rx + rad, ry);
        c.arcTo(rx + rw, ry, rx + rw, ry + rh, rad);
        c.arcTo(rx + rw, ry + rh, rx, ry + rh, rad);
        c.arcTo(rx, ry + rh, rx, ry, rad);
        c.arcTo(rx, ry, rx + rw, ry, rad);
        c.closePath();
      }
    }

    ctx.beginPath();
    drawRoundedRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = isRoot ? (node.color || '#4F46E5') : '#ffffff';
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = isRoot ? 'transparent' : '#e2e8f0';
    ctx.stroke();

    if (!isRoot) {
      ctx.beginPath();
      drawRoundedRect(ctx, x, y, 6, h, [radius, 0, 0, radius]);
      ctx.fillStyle = node.color || '#4F46E5';
      ctx.fill();
    }

    ctx.fillStyle = isRoot ? '#ffffff' : '#0f172a';
    ctx.font = isRoot ? 'bold 15px "Inter", sans-serif' : '500 14px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(node.text, x + w / 2, y + h / 2);
  });

  const a = document.createElement('a');
  a.download = `${(state.currentProjectTitle || 'mindmap').replace(/\s+/g, '_')}-${Date.now()}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

// Project Manager Modal Functions
async function openProjectsManagerModal() {
  modalProjectUserLabel.innerText = state.currentUser;
  projectsModal.classList.add('active');
  await renderProjectsList();
}

async function renderProjectsList() {
  projectsListContainer.innerHTML = '<div style="padding: 20px; color: #64748b;">Loading projects...</div>';
  const projects = await StorageService.getProjects(state.currentUser);

  if (projects.length === 0) {
    projectsListContainer.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 36px 12px; color: #64748b;">
        <p style="font-size: 16px; font-weight: 500;">No projects found for ${state.currentUser}</p>
        <p style="font-size: 13px; margin-top: 6px;">Click the <b>+ New Project</b> button to start your first map!</p>
      </div>
    `;
    return;
  }

  projectsListContainer.innerHTML = '';
  projects.forEach(proj => {
    const isCurrent = (proj.id === state.currentProjectId);
    const card = document.createElement('div');
    card.className = `project-card ${isCurrent ? 'active-project' : ''}`;

    const dateStr = new Date(proj.updatedAt || Date.now()).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    card.innerHTML = `
      <div class="project-card-header">
        <h3>${escapeHtml(proj.title || 'Untitled Project')} ${isCurrent ? '<span style="font-size: 11px; color: #4f46e5; background: #eef2ff; padding: 2px 6px; border-radius: 10px;">Active</span>' : ''}</h3>
        <div class="project-card-meta">
          <span>${proj.nodeCount || '1'} nodes</span>
          <span>${dateStr}</span>
        </div>
      </div>
      <div class="project-card-actions">
        <button class="btn ${isCurrent ? 'secondary' : 'primary'} btn-open-proj">
          ${isCurrent ? 'Current' : 'Open'}
        </button>
        <button class="btn outline btn-rename-proj" title="Rename Project">Rename</button>
        <button class="btn danger btn-del-proj" title="Delete Project">Delete</button>
      </div>
    `;

    // Open Project
    card.querySelector('.btn-open-proj').addEventListener('click', async () => {
      if (!isCurrent) {
        await switchProject(proj.id);
      }
      projectsModal.classList.remove('active');
    });

    // Rename Project
    card.querySelector('.btn-rename-proj').addEventListener('click', async () => {
      const newTitle = prompt('Enter new project title:', proj.title);
      if (newTitle && newTitle.trim()) {
        const fullProj = await StorageService.getProject(state.currentUser, proj.id);
        if (fullProj) {
          fullProj.title = newTitle.trim();
          await StorageService.saveProject(state.currentUser, fullProj);
          if (proj.id === state.currentProjectId) {
            state.currentProjectTitle = newTitle.trim();
            projectTitleInput.value = state.currentProjectTitle;
          }
          await renderProjectsList();
        }
      }
    });

    // Delete Project
    card.querySelector('.btn-del-proj').addEventListener('click', async () => {
      if (confirm(`Are you sure you want to delete "${proj.title}"?`)) {
        await StorageService.deleteProject(state.currentUser, proj.id);
        if (proj.id === state.currentProjectId) {
          await loadUserProjects(state.currentUser);
          render();
        }
        await renderProjectsList();
      }
    });

    projectsListContainer.appendChild(card);
  });
}

async function switchProject(projectId) {
  const fullProj = await StorageService.getProject(state.currentUser, projectId);
  if (fullProj && fullProj.nodes) {
    state.currentProjectId = fullProj.id;
    state.currentProjectTitle = fullProj.title || 'Untitled Project';
    state.nodes = fullProj.nodes;
    state.rootId = fullProj.rootId || 'root';
    state.selectedId = state.rootId;

    projectTitleInput.value = state.currentProjectTitle;
    state.history = [];
    state.historyIndex = -1;
    saveHistorySnapshot();
    centerView();
    render();
  }
}

// User Profiles Modal
async function openUsersModal() {
  usersModal.classList.add('active');
  userDropdown.classList.remove('active');
  await renderUsersList();
}

async function renderUsersList() {
  usersListContainer.innerHTML = 'Loading profiles...';
  const users = await StorageService.getUsers();
  usersListContainer.innerHTML = '';

  users.forEach(username => {
    const isActive = (username === state.currentUser);
    const item = document.createElement('div');
    item.className = `user-item ${isActive ? 'active' : ''}`;

    item.innerHTML = `
      <div class="user-item-info">
        <span class="user-item-avatar">${username.charAt(0).toUpperCase()}</span>
        <span class="user-item-name">${escapeHtml(username)}</span>
      </div>
      <div>
        ${isActive 
          ? '<span style="font-size: 12px; font-weight: 600; color: #4F46E5;">Active Profile</span>' 
          : '<button class="btn outline" style="padding: 4px 10px; font-size: 12px;">Switch</button>'}
      </div>
    `;

    if (!isActive) {
      item.addEventListener('click', async () => {
        await switchUserProfile(username);
        usersModal.classList.remove('active');
      });
    }

    usersListContainer.appendChild(item);
  });
}

async function switchUserProfile(newUsername) {
  // Finish active inline editing before switching to avoid saving previous user's edit to new user
  if (state.editingId) {
    const textSpan = document.querySelector(`#node-elem-${state.editingId} .node-text`);
    if (textSpan) {
      finishEditing(state.editingId, textSpan);
    } else {
      state.editingId = null;
    }
  }

  // Wait for any queued save operations of current user to finish
  if (StorageService._saveQueue) {
    await StorageService._saveQueue;
  }

  state.currentUser = newUsername;
  localStorage.setItem('mm_active_user', newUsername);
  updateUserUI();

  await loadUserProjects(newUsername);
  centerView();
  render();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Event Listeners Setup
function setupEventListeners() {
  // Project Title Editing
  const onTitleChange = () => {
    const val = projectTitleInput.value.trim() || 'Untitled Project';
    if (state.currentProjectTitle !== val) {
      state.currentProjectTitle = val;
      notifySaveStatus('Saving...');
      StorageService.saveProject(state.currentUser, {
        id: state.currentProjectId,
        title: state.currentProjectTitle,
        nodes: state.nodes,
        rootId: state.rootId
      });
      setTimeout(() => notifySaveStatus('Saved'), 350);
    }
  };
  projectTitleInput.addEventListener('change', onTitleChange);
  projectTitleInput.addEventListener('blur', onTitleChange);

  // Project Manager Modal
  btnProjectsMgr.addEventListener('click', openProjectsManagerModal);
  btnCloseProjectsModal.addEventListener('click', () => projectsModal.classList.remove('active'));

  // New Project Modal
  btnNewProjectTrigger.addEventListener('click', () => {
    newProjectNameInput.value = 'New Mind Map';
    newProjectModal.classList.add('active');
  });

  btnModalCreateProject.addEventListener('click', () => {
    projectsModal.classList.remove('active');
    newProjectNameInput.value = 'New Mind Map';
    newProjectModal.classList.add('active');
  });

  btnCloseNewProjectModal.addEventListener('click', () => newProjectModal.classList.remove('active'));
  btnCancelNewProject.addEventListener('click', () => newProjectModal.classList.remove('active'));

  // Template Card Selection
  document.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedTemplate = card.getAttribute('data-template');
    });
  });

  // Confirm Create Project
  btnConfirmCreateProject.addEventListener('click', async () => {
    const title = newProjectNameInput.value.trim() || 'New Mind Map';
    const templateKey = state.selectedTemplate || 'blank';
    const templateFn = TEMPLATES[templateKey] || TEMPLATES.blank;

    const newId = `proj_${Date.now()}`;
    const newNodes = templateFn(title);

    state.currentProjectId = newId;
    state.currentProjectTitle = title;
    state.nodes = newNodes;
    state.rootId = 'root';
    state.selectedId = 'root';

    projectTitleInput.value = title;
    await StorageService.saveProject(state.currentUser, {
      id: newId,
      title: title,
      nodes: newNodes,
      rootId: 'root'
    });

    state.history = [];
    state.historyIndex = -1;
    saveHistorySnapshot();

    newProjectModal.classList.remove('active');
    centerView();
    render();
  });

  // User Profile Dropdown Toggle
  btnUserProfile.addEventListener('click', (e) => {
    e.stopPropagation();
    userDropdown.classList.toggle('active');
  });

  btnSwitchUserModal.addEventListener('click', () => {
    openUsersModal();
  });

  btnCloseUsersModal.addEventListener('click', () => usersModal.classList.remove('active'));

  // Add User Profile
  btnSubmitAddUser.addEventListener('click', async () => {
    const name = newUsernameInput.value.trim();
    if (name) {
      await StorageService.createUser(name);
      newUsernameInput.value = '';
      await switchUserProfile(name);
      usersModal.classList.remove('active');
    }
  });

  newUsernameInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const name = newUsernameInput.value.trim();
      if (name) {
        await StorageService.createUser(name);
        newUsernameInput.value = '';
        await switchUserProfile(name);
        usersModal.classList.remove('active');
      }
    }
  });

  // Close menus when clicking outside
  document.addEventListener('click', (e) => {
    if (!btnUserProfile.contains(e.target) && !userDropdown.contains(e.target)) {
      userDropdown.classList.remove('active');
    }
    if (!btnColorPalette.contains(e.target) && !colorPopover.contains(e.target)) {
      colorPopover.classList.remove('active');
    }
  });

  // Canvas Viewport Panning
  canvasViewport.addEventListener('mousedown', (e) => {
    if (e.target === canvasViewport || e.target === canvasWorld || e.target === svgConnectors) {
      state.isPanning = true;
      state.startPanX = e.clientX - state.panX;
      state.startPanY = e.clientY - state.panY;
      colorPopover.classList.remove('active');
      userDropdown.classList.remove('active');
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (state.isPanning) {
      state.panX = e.clientX - state.startPanX;
      state.panY = e.clientY - state.startPanY;
      updateViewTransform();
    }
  });

  window.addEventListener('mouseup', () => {
    state.isPanning = false;
  });

  // Zoom with Mouse Wheel
  canvasViewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(state.zoom * zoomFactor, e.clientX, e.clientY);
  }, { passive: false });

  // Floating Zoom & View Buttons
  btnZoomIn.addEventListener('click', () => setZoom(state.zoom * 1.2));
  btnZoomOut.addEventListener('click', () => setZoom(state.zoom / 1.2));
  btnResetView.addEventListener('click', centerView);
  if (btnFitScreen) {
    btnFitScreen.addEventListener('click', fitToScreen);
  }

  // Toolbar Actions
  btnAddChild.addEventListener('click', () => addChildNode());
  btnAddSibling.addEventListener('click', () => addSiblingNode());
  btnDeleteNode.addEventListener('click', () => deleteNode());
  btnAutoLayout.addEventListener('click', applyAutoLayout);
  btnUndo.addEventListener('click', undo);
  btnRedo.addEventListener('click', redo);
  btnExportImg.addEventListener('click', exportToImage);

  // Color Palette Popover
  btnColorPalette.addEventListener('click', (e) => {
    e.stopPropagation();
    colorPopover.classList.toggle('active');
  });

  document.querySelectorAll('.color-option').forEach(el => {
    el.addEventListener('click', () => {
      const color = el.getAttribute('data-color');
      changeSelectedNodeColor(color);
      colorPopover.classList.remove('active');
    });
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (state.editingId) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'Tab') {
      e.preventDefault();
      addChildNode();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      addSiblingNode();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteNode();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  });

  // Help Modal & Shortcuts Pill
  btnHelp.addEventListener('click', () => {
    helpModal.classList.add('active');
    userDropdown.classList.remove('active');
  });
  if (btnShortcutsPill) {
    btnShortcutsPill.addEventListener('click', () => {
      helpModal.classList.add('active');
    });
  }
  btnCloseModal.addEventListener('click', () => helpModal.classList.remove('active'));
  btnGotIt.addEventListener('click', () => helpModal.classList.remove('active'));

  // Close Quick Tip
  if (btnCloseTip) {
    btnCloseTip.addEventListener('click', () => {
      const tipBanner = document.getElementById('quick-tip-banner') || document.querySelector('.quick-tip');
      if (tipBanner) tipBanner.style.display = 'none';
    });
  }

  window.addEventListener('resize', () => {
    render();
  });
}

// Start application
window.addEventListener('DOMContentLoaded', init);
