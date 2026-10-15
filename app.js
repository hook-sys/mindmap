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

  // Authentication State (Phase 1 SaaS)
  authUser: null, // { id, email, fullName, tier }
  isGuest: true,

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

// User Menu & Header Auth Elements
const btnHeaderAuth = document.getElementById('btn-header-auth');
const btnUserProfile = document.getElementById('btn-user-profile');
const userAvatarBadge = document.getElementById('user-avatar-badge');
const userNameText = document.getElementById('user-name-text');
const userPlanBadge = document.getElementById('user-plan-badge');
const userDropdown = document.getElementById('user-dropdown');
const userDropdownCaption = document.getElementById('user-dropdown-caption');
const userDropdownName = document.getElementById('user-dropdown-name');
const userDropdownMeta = document.getElementById('user-dropdown-meta');
const dropdownGuestSection = document.getElementById('dropdown-guest-section');
const dropdownAuthSection = document.getElementById('dropdown-auth-section');
const dropdownLogoutSection = document.getElementById('dropdown-logout-section');
const btnDropdownLogin = document.getElementById('btn-dropdown-login');
const btnSwitchUserModal = document.getElementById('btn-switch-user-modal');
const btnAuthChangePassword = document.getElementById('btn-auth-change-password');
const btnSwitchToGuest = document.getElementById('btn-switch-to-guest');
const btnOpenCloudConfig = document.getElementById('btn-open-cloud-config');
const btnAuthLogout = document.getElementById('btn-auth-logout');

// Auth Modal Elements
const authModal = document.getElementById('auth-modal');
const btnCloseAuthModal = document.getElementById('btn-close-auth-modal');
const authModalTitle = document.getElementById('auth-modal-title');
const authModalSubtitle = document.getElementById('auth-modal-subtitle');
const authNavTabs = document.getElementById('auth-nav-tabs');
const tabBtnSignin = document.getElementById('tab-btn-signin');
const tabBtnSignup = document.getElementById('tab-btn-signup');
const tabBtnRecovery = document.getElementById('tab-btn-recovery');
const authAlert = document.getElementById('auth-alert');
const authAlertIcon = document.getElementById('auth-alert-icon');
const authAlertText = document.getElementById('auth-alert-text');

const authPanelSignin = document.getElementById('auth-panel-signin');
const authPanelSignup = document.getElementById('auth-panel-signup');
const authPanelRecovery = document.getElementById('auth-panel-recovery');
const authPanelUpdatePw = document.getElementById('auth-panel-update-pw');

const formSignin = document.getElementById('form-signin');
const signinEmail = document.getElementById('signin-email');
const signinPassword = document.getElementById('signin-password');
const btnSubmitSignin = document.getElementById('btn-submit-signin');
const linkForgotPassword = document.getElementById('link-forgot-password');
const linkGotoSignup = document.getElementById('link-goto-signup');

const formSignup = document.getElementById('form-signup');
const signupName = document.getElementById('signup-name');
const signupEmail = document.getElementById('signup-email');
const signupPassword = document.getElementById('signup-password');
const signupConfirmPassword = document.getElementById('signup-confirm-password');
const btnSubmitSignup = document.getElementById('btn-submit-signup');
const linkGotoSignin = document.getElementById('link-goto-signin');

const formRecovery = document.getElementById('form-recovery');
const recoveryEmail = document.getElementById('recovery-email');
const btnSubmitRecovery = document.getElementById('btn-submit-recovery');
const linkRecoveryToSignin = document.getElementById('link-recovery-to-signin');

const formUpdatePw = document.getElementById('form-update-pw');
const updatePwNew = document.getElementById('update-pw-new');
const updatePwConfirm = document.getElementById('update-pw-confirm');
const btnSubmitUpdatePw = document.getElementById('btn-submit-update-pw');

// Cloud Config Modal Elements
const cloudConfigModal = document.getElementById('cloud-config-modal');
const btnCloseCloudConfigModal = document.getElementById('btn-close-cloud-config-modal');
const btnCancelCloudConfig = document.getElementById('btn-cancel-cloud-config');
const inputSupabaseUrl = document.getElementById('input-supabase-url');
const inputSupabaseAnonKey = document.getElementById('input-supabase-anon-key');
const btnTestCloudConfig = document.getElementById('btn-test-cloud-config');
const btnClearCloudConfig = document.getElementById('btn-clear-cloud-config');
const btnSaveCloudConfig = document.getElementById('btn-save-cloud-config');
const cloudConfigAlert = document.getElementById('cloud-config-alert');
const cloudConfigAlertIcon = document.getElementById('cloud-config-alert-icon');
const cloudConfigAlertText = document.getElementById('cloud-config-alert-text');

// Toast Banner Elements
const toastBanner = document.getElementById('toast-banner');
const toastBannerIcon = document.getElementById('toast-banner-icon');
const toastBannerMessage = document.getElementById('toast-banner-message');
let toastTimeout = null;

// AI Generator & Expand Elements
const btnAiGenerator = document.getElementById('btn-ai-generator');
const btnAiExpand = document.getElementById('btn-ai-expand');

const aiGeneratorModal = document.getElementById('ai-generator-modal');
const btnCloseAiModal = document.getElementById('btn-close-ai-modal');
const btnCancelAiModal = document.getElementById('btn-cancel-ai-modal');
const aiPromptInput = document.getElementById('ai-prompt-input');
const btnSubmitAiGenerate = document.getElementById('btn-submit-ai-generate');
const aiGeneratorAlert = document.getElementById('ai-generator-alert');
const aiAlertText = document.getElementById('ai-alert-text');
const aiInputStep = document.getElementById('ai-input-step');
const aiPreviewStep = document.getElementById('ai-preview-step');
const aiInputFooterActions = document.getElementById('ai-input-footer-actions');
const aiPreviewFooterActions = document.getElementById('ai-preview-footer-actions');
const aiPreviewTitle = document.getElementById('ai-preview-title');
const aiPreviewCount = document.getElementById('ai-preview-count');
const aiPreviewTree = document.getElementById('ai-preview-tree');
const btnDiscardAiPreview = document.getElementById('btn-discard-ai-preview');
const btnApplyAiReplace = document.getElementById('btn-apply-ai-replace');
const btnApplyAiNew = document.getElementById('btn-apply-ai-new');
const aiProviderNameDisplay = document.getElementById('ai-provider-name-display');
const aiProviderModelDisplay = document.getElementById('ai-provider-model-display');

const aiExpandModal = document.getElementById('ai-expand-modal');
const btnCloseExpandModal = document.getElementById('btn-close-expand-modal');
const btnCancelExpandModal = document.getElementById('btn-cancel-expand-modal');
const btnConfirmAiExpand = document.getElementById('btn-confirm-ai-expand');
const aiExpandNodeLabel = document.getElementById('ai-expand-node-label');
const aiExpandCount = document.getElementById('ai-expand-count');
const aiExpandAlert = document.getElementById('ai-expand-alert');
const aiExpandAlertText = document.getElementById('ai-expand-alert-text');

let currentGeneratedMindMap = null;
let currentExpandTargetNodeId = null;

// Super Admin AI Settings Elements
const btnOpenSuperAdmin = document.getElementById('btn-open-super-admin');
const superAdminModal = document.getElementById('super-admin-modal');
const btnCloseSuperAdminModal = document.getElementById('btn-close-super-admin-modal');
const btnCancelSuperAdmin = document.getElementById('btn-cancel-super-admin');
const superAdminAlert = document.getElementById('super-admin-alert');
const superAdminAlertIcon = document.getElementById('super-admin-alert-icon');
const superAdminAlertText = document.getElementById('super-admin-alert-text');
const adminProviderSelect = document.getElementById('admin-provider-select');
const adminModelSelect = document.getElementById('admin-model-select');
const adminModelDesc = document.getElementById('admin-model-desc');
const adminProviderCards = document.getElementById('admin-provider-cards');
const btnAdminTestConnection = document.getElementById('btn-admin-test-connection');
const adminTestResultBox = document.getElementById('admin-test-result-box');
const adminTestIcon = document.getElementById('admin-test-icon');
const adminTestMessage = document.getElementById('admin-test-message');
const btnSaveSuperAdmin = document.getElementById('btn-save-super-admin');
let superAdminConfigCache = null;

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

// Global Toast Notification Helper
function showToast(message, type = 'info', duration = 3500) {
  if (!toastBanner) return;
  if (toastTimeout) clearTimeout(toastTimeout);

  toastBanner.className = `toast-banner ${type}`;
  if (type === 'success') {
    toastBannerIcon.innerText = '✓';
  } else if (type === 'error') {
    toastBannerIcon.innerText = '⚠️';
  } else {
    toastBannerIcon.innerText = 'ℹ️';
  }
  toastBannerMessage.innerText = message;
  toastBanner.style.display = 'flex';

  toastTimeout = setTimeout(() => {
    toastBanner.style.display = 'none';
  }, duration);
}

// Application Initialization
async function init() {
  // 1. Initialize Supabase Auth if available
  if (window.AuthService) {
    try {
      const authRes = await window.AuthService.init();
      if (authRes && authRes.configured && authRes.user) {
        state.authUser = window.AuthService.getUserProfile();
        state.isGuest = false;
      } else {
        state.authUser = null;
        state.isGuest = true;
      }

      // Attach auth state change listener
      window.AuthService.onAuthStateChange(handleAuthStateChange);
    } catch (err) {
      console.warn('[App] AuthService init warning:', err);
      state.authUser = null;
      state.isGuest = true;
    }
  }

  // 2. Load active local user
  const savedUser = localStorage.getItem('mm_active_user') || 'Default User';
  state.currentUser = savedUser;

  // 3. Update User UI (handles Authenticated SaaS vs Local Guest)
  updateUserUI();

  // 4. Load projects for active user
  await loadUserProjects(state.currentUser);

  updateViewTransform();
  render();
  setupEventListeners();

  // 5. Check for password recovery hash in URL (e.g. #access_token=...&type=recovery)
  checkPasswordRecoveryHash();
}

function updateUserUI() {
  if (state.authUser && !state.isGuest) {
    // Authenticated SaaS User View
    const email = state.authUser.email || 'User';
    const displayName = state.authUser.fullName || email.split('@')[0];
    const initial = (displayName.charAt(0) || email.charAt(0) || 'U').toUpperCase();

    userAvatarBadge.innerText = initial;
    userAvatarBadge.style.background = 'linear-gradient(135deg, #4F46E5, #7C3AED)';
    userNameText.innerText = displayName;

    if (userPlanBadge) {
      userPlanBadge.innerText = 'Free Plan';
      userPlanBadge.className = 'user-plan-badge free';
    }

    if (btnHeaderAuth) btnHeaderAuth.style.display = 'none';

    if (userDropdownCaption) userDropdownCaption.innerText = 'Cloud Account';
    if (userDropdownName) userDropdownName.innerText = displayName;
    if (userDropdownMeta) userDropdownMeta.innerText = `${email} • Free Tier`;

    if (dropdownGuestSection) dropdownGuestSection.style.display = 'none';
    if (dropdownAuthSection) dropdownAuthSection.style.display = 'block';
    if (dropdownLogoutSection) dropdownLogoutSection.style.display = 'block';

    if (modalProjectUserLabel) modalProjectUserLabel.innerText = `${state.currentUser} (Local)`;
  } else {
    // Guest / Local User View
    const initial = state.currentUser.charAt(0).toUpperCase();
    userAvatarBadge.innerText = initial;
    userAvatarBadge.style.background = 'var(--primary)';
    userNameText.innerText = state.currentUser;

    if (userPlanBadge) {
      userPlanBadge.innerText = 'Local';
      userPlanBadge.className = 'user-plan-badge local';
    }

    if (btnHeaderAuth) btnHeaderAuth.style.display = 'inline-flex';

    if (userDropdownCaption) userDropdownCaption.innerText = 'Local Profile';
    if (userDropdownName) userDropdownName.innerText = state.currentUser;
    if (userDropdownMeta) userDropdownMeta.innerText = 'Stored locally on this device';

    if (dropdownGuestSection) dropdownGuestSection.style.display = 'block';
    if (dropdownAuthSection) dropdownAuthSection.style.display = 'none';
    if (dropdownLogoutSection) dropdownLogoutSection.style.display = 'none';

    if (modalProjectUserLabel) modalProjectUserLabel.innerText = state.currentUser;
  }
}

// Handle Supabase Auth State Changes
function handleAuthStateChange(event, session) {
  console.log('[Auth] State change event:', event);

  if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
    if (session && session.user) {
      state.authUser = window.AuthService.getUserProfile();
      state.isGuest = false;
      updateUserUI();
      closeAuthModal();
      showToast(`Signed in as ${state.authUser.email}`, 'success');
    }
  } else if (event === 'SIGNED_OUT') {
    state.authUser = null;
    state.isGuest = true;
    updateUserUI();
    showToast('Signed out. Your canvas mind map is preserved.', 'info');
  } else if (event === 'PASSWORD_RECOVERY') {
    switchAuthTab('update-pw');
    openAuthModal('update-pw');
    setAuthAlert('Please enter your new password to regain access.', 'info');
  } else if (event === 'TOKEN_REFRESHED') {
    if (session && session.user) {
      state.authUser = window.AuthService.getUserProfile();
      state.isGuest = false;
    }
  }
}

// Check for password recovery hash in URL
function checkPasswordRecoveryHash() {
  const hash = window.location.hash || '';
  if (hash.includes('type=recovery') || hash.includes('access_token')) {
    switchAuthTab('update-pw');
    openAuthModal('update-pw');
    setAuthAlert('Set your new password to complete recovery.', 'info');
    // Clear hash without reloading
    history.replaceState(null, '', window.location.pathname);
  }
}

// Auth Tab Management
function switchAuthTab(tabName) {
  clearAuthAlert();

  const tabs = [
    { name: 'signin', btn: tabBtnSignin, panel: authPanelSignin },
    { name: 'signup', btn: tabBtnSignup, panel: authPanelSignup },
    { name: 'recovery', btn: tabBtnRecovery, panel: authPanelRecovery }
  ];

  tabs.forEach(t => {
    if (t.btn && t.panel) {
      if (t.name === tabName) {
        t.btn.classList.add('active');
        t.panel.style.display = 'block';
      } else {
        t.btn.classList.remove('active');
        t.panel.style.display = 'none';
      }
    }
  });

  if (authPanelUpdatePw) {
    if (tabName === 'update-pw') {
      authPanelUpdatePw.style.display = 'block';
      if (authNavTabs) authNavTabs.style.display = 'none';
      if (authModalTitle) authModalTitle.innerText = 'Reset Password';
      if (authModalSubtitle) authModalSubtitle.innerText = 'Create a new secure password';
    } else {
      authPanelUpdatePw.style.display = 'none';
      if (authNavTabs) authNavTabs.style.display = 'flex';
      if (authModalTitle) authModalTitle.innerText = 'Cloud Account';
      if (authModalSubtitle) authModalSubtitle.innerText = 'Sign in to sync your mind maps securely';
    }
  }
}

function setAuthAlert(message, type = 'error') {
  if (!authAlert || !authAlertText) return;
  authAlert.className = `auth-alert ${type}`;
  if (type === 'success') {
    authAlertIcon.innerText = '✓';
  } else if (type === 'info') {
    authAlertIcon.innerText = 'ℹ️';
  } else {
    authAlertIcon.innerText = '⚠️';
  }
  authAlertText.innerText = message;
  authAlert.style.display = 'flex';
}

function clearAuthAlert() {
  if (authAlert) authAlert.style.display = 'none';
}

function openAuthModal(defaultTab = 'signin') {
  // If Supabase is not configured yet, direct user to Cloud Settings modal first
  if (window.AuthService && !window.AuthService.isConfigured()) {
    openCloudConfigModal('Please connect your Supabase project credentials first to enable real authentication.');
    return;
  }

  userDropdown.classList.remove('active');
  switchAuthTab(defaultTab);
  authModal.classList.add('active');
}

function closeAuthModal() {
  authModal.classList.remove('active');
  clearAuthAlert();
}

function setButtonLoading(btn, isLoading, originalText = '') {
  if (!btn) return;
  const spinner = btn.querySelector('.btn-spinner');
  const label = btn.querySelector('.btn-text');

  if (isLoading) {
    btn.disabled = true;
    if (spinner) spinner.style.display = 'inline-block';
    if (label) label.innerText = 'Please wait...';
  } else {
    btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
    if (label) label.innerText = originalText;
  }
}

// Cloud Config Modal Management
function openCloudConfigModal(customMessage = null) {
  userDropdown.classList.remove('active');
  clearCloudConfigAlert();

  if (window.AuthService) {
    const config = window.AuthService.getConfig();
    if (config) {
      inputSupabaseUrl.value = config.url || '';
      inputSupabaseAnonKey.value = config.anonKey || '';
    } else {
      inputSupabaseUrl.value = '';
      inputSupabaseAnonKey.value = '';
    }
  }

  if (customMessage) {
    setCloudConfigAlert(customMessage, 'info');
  }

  cloudConfigModal.classList.add('active');
}

function closeCloudConfigModal() {
  cloudConfigModal.classList.remove('active');
  clearCloudConfigAlert();
}

function setCloudConfigAlert(message, type = 'error') {
  if (!cloudConfigAlert || !cloudConfigAlertText) return;
  cloudConfigAlert.className = `auth-alert ${type}`;
  if (type === 'success') {
    cloudConfigAlertIcon.innerText = '✓';
  } else if (type === 'info') {
    cloudConfigAlertIcon.innerText = 'ℹ️';
  } else {
    cloudConfigAlertIcon.innerText = '⚠️';
  }
  cloudConfigAlertText.innerText = message;
  cloudConfigAlert.style.display = 'flex';
}

function clearCloudConfigAlert() {
  if (cloudConfigAlert) cloudConfigAlert.style.display = 'none';
}

// ================= AI MULTI-PROVIDER UI CONTROLLERS =================

async function fetchAiStatus() {
  try {
    const res = await fetch('/api/ai/status');
    if (res.ok) {
      const data = await res.json();
      if (aiProviderNameDisplay) {
        aiProviderNameDisplay.innerText = data.activeProviderName || 'Fal AI';
      }
      if (aiProviderModelDisplay && data.models && data.models.length > 0) {
        const defaultMod = data.models.find(m => m.default) || data.models[0];
        aiProviderModelDisplay.innerText = defaultMod.id;
      }
      return data;
    }
  } catch (e) {
    console.warn('[AI] Could not fetch AI status:', e.message);
  }
  return null;
}

function openAiGeneratorModal() {
  userDropdown.classList.remove('active');
  clearAiGeneratorAlert();
  currentGeneratedMindMap = null;

  if (aiPromptInput) aiPromptInput.value = '';
  if (aiInputStep) aiInputStep.style.display = 'block';
  if (aiPreviewStep) aiPreviewStep.style.display = 'none';
  if (aiInputFooterActions) aiInputFooterActions.style.display = 'flex';
  if (aiPreviewFooterActions) aiPreviewFooterActions.style.display = 'none';

  aiGeneratorModal.classList.add('active');
  fetchAiStatus();
  setTimeout(() => {
    if (aiPromptInput) aiPromptInput.focus();
  }, 100);
}

function closeAiGeneratorModal() {
  aiGeneratorModal.classList.remove('active');
  clearAiGeneratorAlert();
  currentGeneratedMindMap = null;
}

function setAiGeneratorAlert(message, type = 'error') {
  if (!aiGeneratorAlert || !aiAlertText) return;
  aiGeneratorAlert.className = `auth-alert ${type}`;
  if (type === 'success') {
    aiAlertIcon.innerText = '✓';
  } else if (type === 'info') {
    aiAlertIcon.innerText = 'ℹ️';
  } else {
    aiAlertIcon.innerText = '⚠️';
  }
  aiAlertText.innerText = message;
  aiGeneratorAlert.style.display = 'flex';
}

function clearAiGeneratorAlert() {
  if (aiGeneratorAlert) aiGeneratorAlert.style.display = 'none';
}

function renderAiPreviewTree(generatedData) {
  if (!aiPreviewTree) return;
  aiPreviewTree.innerHTML = '';

  const nodes = generatedData.nodes || {};
  const rootId = generatedData.rootId || 'root';
  const rootNode = nodes[rootId] || { text: 'Central Topic' };

  if (aiPreviewTitle) {
    aiPreviewTitle.innerText = generatedData.title || rootNode.text;
  }
  if (aiPreviewCount) {
    const totalCount = Object.keys(nodes).length;
    aiPreviewCount.innerText = `${totalCount} nodes generated`;
  }

  // Find direct branches (children of root)
  const branches = Object.values(nodes).filter(n => n.parentId === rootId);

  branches.forEach(branch => {
    const branchEl = document.createElement('div');
    branchEl.className = 'ai-preview-branch';

    const titleEl = document.createElement('div');
    titleEl.className = 'ai-preview-branch-title';
    titleEl.innerHTML = `
      <span class="ai-preview-branch-dot" style="background: ${branch.color || '#4F46E5'};"></span>
      <strong>${escapeHtml(branch.text)}</strong>
    `;
    branchEl.appendChild(titleEl);

    // Sub-children of this branch
    const subChildren = Object.values(nodes).filter(n => n.parentId === branch.id);
    if (subChildren.length > 0) {
      const listEl = document.createElement('ul');
      listEl.className = 'ai-preview-children-list';
      subChildren.forEach(sc => {
        const itemEl = document.createElement('li');
        itemEl.className = 'ai-preview-child-item';
        itemEl.innerText = sc.text;
        listEl.appendChild(itemEl);
      });
      branchEl.appendChild(listEl);
    }

    aiPreviewTree.appendChild(branchEl);
  });
}

function openAiExpandModal(nodeId) {
  const targetNode = state.nodes[nodeId];
  if (!targetNode) {
    showToast('Please select a valid node to expand.', 'error');
    return;
  }

  currentExpandTargetNodeId = nodeId;
  if (aiExpandNodeLabel) {
    aiExpandNodeLabel.innerText = `"${targetNode.text}"`;
  }
  clearAiExpandAlert();
  aiExpandModal.classList.add('active');
}

function closeAiExpandModal() {
  aiExpandModal.classList.remove('active');
  clearAiExpandAlert();
  currentExpandTargetNodeId = null;
}

function setAiExpandAlert(message, type = 'error') {
  if (!aiExpandAlert || !aiExpandAlertText) return;
  aiExpandAlert.className = `auth-alert ${type}`;
  aiExpandAlertText.innerText = message;
  aiExpandAlert.style.display = 'flex';
}

function clearAiExpandAlert() {
  if (aiExpandAlert) aiExpandAlert.style.display = 'none';
}

// ==========================================================================
// Super Admin AI Settings Functions
// ==========================================================================

function openSuperAdminModal() {
  if (userDropdown) userDropdown.classList.remove('active');
  if (superAdminModal) superAdminModal.classList.add('active');
  loadSuperAdminConfig();
}

function closeSuperAdminModal() {
  if (superAdminModal) superAdminModal.classList.remove('active');
  clearSuperAdminAlert();
  if (adminTestResultBox) adminTestResultBox.style.display = 'none';
}

function setSuperAdminAlert(message, type = 'info') {
  if (!superAdminAlert || !superAdminAlertText) return;
  superAdminAlert.style.display = 'flex';
  superAdminAlert.className = `auth-alert ${type}`;
  if (superAdminAlertIcon) {
    superAdminAlertIcon.textContent = type === 'success' ? '✓' : type === 'error' ? '⚠️' : 'ℹ️';
  }
  superAdminAlertText.textContent = message;
}

function clearSuperAdminAlert() {
  if (superAdminAlert) {
    superAdminAlert.style.display = 'none';
    if (superAdminAlertText) superAdminAlertText.textContent = '';
  }
}

async function getAdminAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (window.AuthService && typeof window.AuthService.getAccessToken === 'function') {
    const token = window.AuthService.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return headers;
}

async function loadSuperAdminConfig() {
  clearSuperAdminAlert();
  if (adminTestResultBox) adminTestResultBox.style.display = 'none';

  try {
    const headers = await getAdminAuthHeaders();
    const res = await fetch('/api/ai/admin/config', { headers });
    const data = await res.json();

    if (!res.ok || !data.success) {
      const errMsg = data.error || 'Failed to retrieve Super Admin AI configuration.';
      setSuperAdminAlert(errMsg, 'error');
      return;
    }

    superAdminConfigCache = data;
    renderSuperAdminUI(data);
  } catch (err) {
    setSuperAdminAlert(err.message || 'Error communicating with Super Admin API.', 'error');
  }
}

function renderSuperAdminUI(data) {
  if (!data || !data.providers) return;

  // 1. Populate Provider Dropdown
  if (adminProviderSelect) {
    adminProviderSelect.innerHTML = '';
    data.providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} ${p.isConfigured ? '✓' : '(Not Configured)'}`;
      if (p.id === data.activeProvider) opt.selected = true;
      adminProviderSelect.appendChild(opt);
    });
  }

  // 2. Populate Models for selected provider
  if (adminProviderSelect) {
    updateAdminModelDropdown(adminProviderSelect.value);
  }

  // 3. Render Provider Credential Status Cards
  renderAdminProviderCards(data.providers, data.activeProvider);
}

function updateAdminModelDropdown(providerId) {
  if (!superAdminConfigCache || !adminModelSelect) return;
  const prov = superAdminConfigCache.providers.find(p => p.id === providerId);
  if (!prov || !prov.models) return;

  adminModelSelect.innerHTML = '';
  prov.models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.name} (${m.id})`;
    if (m.id === prov.defaultModel) opt.selected = true;
    adminModelSelect.appendChild(opt);
  });

  updateAdminModelDescription();
}

function updateAdminModelDescription() {
  if (!superAdminConfigCache || !adminProviderSelect || !adminModelSelect || !adminModelDesc) return;
  const providerId = adminProviderSelect.value;
  const modelId = adminModelSelect.value;
  const prov = superAdminConfigCache.providers.find(p => p.id === providerId);
  if (!prov) return;
  const modelObj = prov.models.find(m => m.id === modelId);
  if (modelObj && modelObj.description) {
    adminModelDesc.textContent = modelObj.description;
  } else {
    adminModelDesc.textContent = `Model ID: ${modelId}`;
  }
}

function renderAdminProviderCards(providers, activeProviderId) {
  if (!adminProviderCards) return;
  adminProviderCards.innerHTML = '';

  providers.forEach(p => {
    const card = document.createElement('div');
    card.className = `admin-provider-card ${p.id === activeProviderId ? 'active-card' : ''}`;
    
    const isOk = p.isConfigured;
    const masked = p.maskedKey || 'Not Configured';
    const statusClass = isOk ? 'status-ok' : 'status-missing';
    const statusIcon = isOk ? '✓' : '⚠️';

    card.innerHTML = `
      <div class="admin-card-header">
        <span class="admin-card-title">${escapeHtml(p.name)}</span>
        ${p.id === activeProviderId ? '<span class="admin-active-pill">ACTIVE</span>' : ''}
      </div>
      <div class="admin-card-env">${escapeHtml(p.envKeyName)}</div>
      <div class="admin-card-footer">
        <span class="admin-key-status ${statusClass}">
          <span>${statusIcon}</span>
          <span>${isOk ? `Set (${escapeHtml(masked)})` : 'Missing / Not Configured'}</span>
        </span>
      </div>
    `;
    adminProviderCards.appendChild(card);
  });
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

    // AI Expand button (Fal AI)
    const btnAiNode = document.createElement('button');
    btnAiNode.className = 'node-btn ai-expand-btn';
    btnAiNode.title = 'Expand node with AI (Fal AI)';
    btnAiNode.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`;
    btnAiNode.addEventListener('mousedown', (e) => e.stopPropagation());
    btnAiNode.addEventListener('click', (e) => {
      e.stopPropagation();
      openAiExpandModal(node.id);
    });
    quickBar.appendChild(btnAiNode);
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

  // AI Generator Button (Top Toolbar)
  if (btnAiGenerator) {
    btnAiGenerator.addEventListener('click', () => {
      openAiGeneratorModal();
    });
  }

  // AI Expand Button (Canvas Toolbar)
  if (btnAiExpand) {
    btnAiExpand.addEventListener('click', () => {
      if (state.selectedId) {
        openAiExpandModal(state.selectedId);
      } else {
        openAiExpandModal(state.rootId);
      }
    });
  }

  // AI Generator Modal Controls
  if (btnCloseAiModal) {
    btnCloseAiModal.addEventListener('click', closeAiGeneratorModal);
  }
  if (btnCancelAiModal) {
    btnCancelAiModal.addEventListener('click', closeAiGeneratorModal);
  }

  // Submit AI Generate
  if (btnSubmitAiGenerate) {
    btnSubmitAiGenerate.addEventListener('click', async () => {
      clearAiGeneratorAlert();
      const prompt = (aiPromptInput ? aiPromptInput.value : '').trim();

      if (!prompt) {
        setAiGeneratorAlert('Please enter a topic or concept to generate a mind map.', 'error');
        return;
      }

      const detailLevel = document.querySelector('input[name="ai-detail-level"]:checked')?.value || 'standard';

      setButtonLoading(btnSubmitAiGenerate, true, 'Generating Mind Map ✨');
      try {
        const res = await fetch('/api/ai/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, detailLevel })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          const errMsg = data.error || 'Failed to generate mind map with AI.';
          setAiGeneratorAlert(errMsg, 'error');
          return;
        }

        // Store generated data and transition to Preview step
        currentGeneratedMindMap = data.data;

        aiInputStep.style.display = 'none';
        aiPreviewStep.style.display = 'block';
        aiInputFooterActions.style.display = 'none';
        aiPreviewFooterActions.style.display = 'flex';

        renderAiPreviewTree(currentGeneratedMindMap);
      } catch (err) {
        setAiGeneratorAlert(err.message || 'Network error communicating with AI service.', 'error');
      } finally {
        setButtonLoading(btnSubmitAiGenerate, false, 'Generate Mind Map ✨');
      }
    });
  }

  // Discard preview / Back to edit
  if (btnDiscardAiPreview) {
    btnDiscardAiPreview.addEventListener('click', () => {
      aiPreviewStep.style.display = 'none';
      aiInputStep.style.display = 'block';
      aiPreviewFooterActions.style.display = 'none';
      aiInputFooterActions.style.display = 'flex';
      clearAiGeneratorAlert();
    });
  }

  // Apply as New Project
  if (btnApplyAiNew) {
    btnApplyAiNew.addEventListener('click', async () => {
      if (!currentGeneratedMindMap) return;

      const newId = `proj_${Date.now()}`;
      const title = currentGeneratedMindMap.title || 'AI Mind Map';

      state.currentProjectId = newId;
      state.currentProjectTitle = title;
      state.nodes = currentGeneratedMindMap.nodes;
      state.rootId = currentGeneratedMindMap.rootId || 'root';
      state.selectedId = state.rootId;

      projectTitleInput.value = title;
      await StorageService.saveProject(state.currentUser, {
        id: newId,
        title: title,
        nodes: state.nodes,
        rootId: state.rootId
      });

      state.history = [];
      state.historyIndex = -1;
      saveHistorySnapshot();

      closeAiGeneratorModal();
      centerView();
      render();
      showToast(`Created new AI mind map: "${title}"`, 'success');
    });
  }

  // Apply and Replace Current Canvas
  if (btnApplyAiReplace) {
    btnApplyAiReplace.addEventListener('click', async () => {
      if (!currentGeneratedMindMap) return;

      if (!confirm('Are you sure you want to replace your current canvas? This will update the active project nodes.')) {
        return;
      }

      const title = currentGeneratedMindMap.title || state.currentProjectTitle;
      state.currentProjectTitle = title;
      state.nodes = currentGeneratedMindMap.nodes;
      state.rootId = currentGeneratedMindMap.rootId || 'root';
      state.selectedId = state.rootId;

      projectTitleInput.value = title;
      saveHistorySnapshot();

      closeAiGeneratorModal();
      centerView();
      render();
      showToast('Replaced current canvas with AI generated mind map!', 'success');
    });
  }

  // AI Expand Modal Controls
  if (btnCloseExpandModal) {
    btnCloseExpandModal.addEventListener('click', closeAiExpandModal);
  }
  if (btnCancelExpandModal) {
    btnCancelExpandModal.addEventListener('click', closeAiExpandModal);
  }

  // Confirm AI Expand
  if (btnConfirmAiExpand) {
    btnConfirmAiExpand.addEventListener('click', async () => {
      clearAiExpandAlert();
      const targetNode = state.nodes[currentExpandTargetNodeId];
      if (!targetNode) {
        setAiExpandAlert('Target node not found.', 'error');
        return;
      }

      const count = parseInt(aiExpandCount.value, 10) || 4;

      setButtonLoading(btnConfirmAiExpand, true, 'Expand Node ✨');
      try {
        const res = await fetch('/api/ai/expand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodeId: targetNode.id,
            nodeText: targetNode.text,
            mindMapTopic: state.currentProjectTitle,
            count,
            existingNodes: state.nodes
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          const errMsg = data.error || 'Failed to expand node with AI.';
          setAiExpandAlert(errMsg, 'error');
          return;
        }

        const newNodes = data.newNodes || [];
        if (newNodes.length === 0) {
          setAiExpandAlert('No child nodes returned by AI.', 'error');
          return;
        }

        // Add new nodes to state
        newNodes.forEach(node => {
          state.nodes[node.id] = node;
        });

        // Ensure parent is expanded
        targetNode.collapsed = false;

        // Select the first expanded child for convenience
        state.selectedId = newNodes[0].id;

        saveHistorySnapshot();
        closeAiExpandModal();
        render();
        showToast(`Expanded "${targetNode.text}" with ${newNodes.length} AI subtopics!`, 'success');
      } catch (err) {
        setAiExpandAlert(err.message || 'Error expanding node.', 'error');
      } finally {
        setButtonLoading(btnConfirmAiExpand, false, 'Expand Node ✨');
      }
    });
  }

  // Header Quick Auth Button
  if (btnHeaderAuth) {
    btnHeaderAuth.addEventListener('click', () => {
      openAuthModal('signin');
    });
  }

  // Dropdown Login Button
  if (btnDropdownLogin) {
    btnDropdownLogin.addEventListener('click', () => {
      openAuthModal('signin');
    });
  }

  // Dropdown Auth Logout Button
  if (btnAuthLogout) {
    btnAuthLogout.addEventListener('click', async () => {
      userDropdown.classList.remove('active');
      if (window.AuthService) {
        try {
          await window.AuthService.signOut();
        } catch (err) {
          console.error('[Auth] Sign out error:', err);
        }
      }
    });
  }

  // Dropdown Change Password
  if (btnAuthChangePassword) {
    btnAuthChangePassword.addEventListener('click', () => {
      userDropdown.classList.remove('active');
      switchAuthTab('update-pw');
      openAuthModal('update-pw');
    });
  }

  // Dropdown Switch to Local Guest Mode
  if (btnSwitchToGuest) {
    btnSwitchToGuest.addEventListener('click', () => {
      userDropdown.classList.remove('active');
      state.isGuest = true;
      updateUserUI();
      showToast('Switched to local guest mode. Cloud account remains saved.', 'info');
    });
  }

  // Dropdown Cloud Settings Button
  if (btnOpenCloudConfig) {
    btnOpenCloudConfig.addEventListener('click', () => {
      openCloudConfigModal();
    });
  }

  // Super Admin AI Settings Button
  if (btnOpenSuperAdmin) {
    btnOpenSuperAdmin.addEventListener('click', () => {
      openSuperAdminModal();
    });
  }

  // Super Admin Modal Controls
  if (btnCloseSuperAdminModal) {
    btnCloseSuperAdminModal.addEventListener('click', closeSuperAdminModal);
  }
  if (btnCancelSuperAdmin) {
    btnCancelSuperAdmin.addEventListener('click', closeSuperAdminModal);
  }

  // Admin Provider Dropdown Change
  if (adminProviderSelect) {
    adminProviderSelect.addEventListener('change', (e) => {
      updateAdminModelDropdown(e.target.value);
      if (adminTestResultBox) adminTestResultBox.style.display = 'none';
    });
  }

  // Admin Model Dropdown Change
  if (adminModelSelect) {
    adminModelSelect.addEventListener('change', () => {
      updateAdminModelDescription();
    });
  }

  // Admin Test Connection
  if (btnAdminTestConnection) {
    btnAdminTestConnection.addEventListener('click', async () => {
      clearSuperAdminAlert();
      const providerId = adminProviderSelect ? adminProviderSelect.value : 'fal';

      setButtonLoading(btnAdminTestConnection, true, 'Testing...');
      if (adminTestResultBox) adminTestResultBox.style.display = 'none';

      try {
        const headers = await getAdminAuthHeaders();
        const res = await fetch('/api/ai/admin/test-connection', {
          method: 'POST',
          headers,
          body: JSON.stringify({ providerId })
        });

        const data = await res.json();
        if (adminTestResultBox) {
          adminTestResultBox.style.display = 'flex';
          if (res.ok && data.success) {
            adminTestResultBox.className = 'admin-test-result success';
            if (adminTestIcon) adminTestIcon.textContent = '✓';
            if (adminTestMessage) {
              adminTestMessage.innerHTML = `<strong>${escapeHtml(data.providerName)}:</strong> ${escapeHtml(data.message)} <br><small style="opacity: 0.85;">${escapeHtml(data.costNotice || '')}</small>`;
            }
          } else {
            adminTestResultBox.className = 'admin-test-result error';
            if (adminTestIcon) adminTestIcon.textContent = '⚠️';
            if (adminTestMessage) {
              adminTestMessage.innerHTML = `<strong>Test Failed:</strong> ${escapeHtml(data.message || data.error || 'Connection check failed.')}`;
            }
          }
        }
      } catch (err) {
        if (adminTestResultBox) {
          adminTestResultBox.style.display = 'flex';
          adminTestResultBox.className = 'admin-test-result error';
          if (adminTestIcon) adminTestIcon.textContent = '⚠️';
          if (adminTestMessage) adminTestMessage.textContent = err.message || 'Network error during test.';
        }
      } finally {
        setButtonLoading(btnAdminTestConnection, false, 'Test Selected Provider');
      }
    });
  }

  // Admin Save Configuration
  if (btnSaveSuperAdmin) {
    btnSaveSuperAdmin.addEventListener('click', async () => {
      clearSuperAdminAlert();
      const activeProvider = adminProviderSelect ? adminProviderSelect.value : 'fal';
      const selectedModel = adminModelSelect ? adminModelSelect.value : '';

      setButtonLoading(btnSaveSuperAdmin, true, 'Saving...');
      try {
        const headers = await getAdminAuthHeaders();
        const res = await fetch('/api/ai/admin/config', {
          method: 'POST',
          headers,
          body: JSON.stringify({ activeProvider, selectedModel })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          setSuperAdminAlert(data.error || 'Failed to save Super Admin AI settings.', 'error');
          return;
        }

        superAdminConfigCache = data;
        renderSuperAdminUI(data);

        // Update active provider pills in AI Generator modal
        if (aiProviderNameDisplay) aiProviderNameDisplay.innerText = data.activeProviderName;
        if (aiProviderModelDisplay) aiProviderModelDisplay.innerText = data.activeModel;

        setSuperAdminAlert(`Successfully updated active provider to ${data.activeProviderName} (${data.activeModel})!`, 'success');
        showToast(`AI Provider updated: ${data.activeProviderName}`, 'success');
      } catch (err) {
        setSuperAdminAlert(err.message || 'Error updating configuration.', 'error');
      } finally {
        setButtonLoading(btnSaveSuperAdmin, false, 'Save & Activate Provider');
      }
    });
  }

  // Auth Modal Close & Tabs
  if (btnCloseAuthModal) {
    btnCloseAuthModal.addEventListener('click', closeAuthModal);
  }
  if (tabBtnSignin) {
    tabBtnSignin.addEventListener('click', () => switchAuthTab('signin'));
  }
  if (tabBtnSignup) {
    tabBtnSignup.addEventListener('click', () => switchAuthTab('signup'));
  }
  if (tabBtnRecovery) {
    tabBtnRecovery.addEventListener('click', () => switchAuthTab('recovery'));
  }

  // In-form Tab Navigation Links
  if (linkForgotPassword) {
    linkForgotPassword.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('recovery');
    });
  }
  if (linkGotoSignup) {
    linkGotoSignup.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('signup');
    });
  }
  if (linkGotoSignin) {
    linkGotoSignin.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('signin');
    });
  }
  if (linkRecoveryToSignin) {
    linkRecoveryToSignin.addEventListener('click', (e) => {
      e.preventDefault();
      switchAuthTab('signin');
    });
  }

  // Form: Sign In
  if (formSignin) {
    formSignin.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthAlert();

      const email = signinEmail.value.trim();
      const password = signinPassword.value;

      if (!email || !password) {
        setAuthAlert('Please fill in both email and password.', 'error');
        return;
      }

      setButtonLoading(btnSubmitSignin, true, 'Sign In');
      try {
        await window.AuthService.signIn({ email, password });
        signinPassword.value = '';
        closeAuthModal();
      } catch (err) {
        setAuthAlert(err.message, 'error');
      } finally {
        setButtonLoading(btnSubmitSignin, false, 'Sign In');
      }
    });
  }

  // Form: Sign Up
  if (formSignup) {
    formSignup.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthAlert();

      const fullName = signupName.value.trim();
      const email = signupEmail.value.trim();
      const password = signupPassword.value;
      const confirmPw = signupConfirmPassword.value;

      if (!email || !password) {
        setAuthAlert('Please provide email and password.', 'error');
        return;
      }
      if (password.length < 6) {
        setAuthAlert('Password must be at least 6 characters long.', 'error');
        return;
      }
      if (password !== confirmPw) {
        setAuthAlert('Passwords do not match. Please verify.', 'error');
        return;
      }

      setButtonLoading(btnSubmitSignup, true, 'Create Free Account');
      try {
        const res = await window.AuthService.signUp({ email, password, fullName });
        signupPassword.value = '';
        signupConfirmPassword.value = '';

        if (res.requiresConfirmation) {
          setAuthAlert('Account created! Please check your email to confirm your registration before signing in.', 'success');
        } else {
          closeAuthModal();
          showToast('Welcome to MindMap Studio! Free Cloud Tier active.', 'success');
        }
      } catch (err) {
        setAuthAlert(err.message, 'error');
      } finally {
        setButtonLoading(btnSubmitSignup, false, 'Create Free Account');
      }
    });
  }

  // Form: Password Recovery
  if (formRecovery) {
    formRecovery.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthAlert();

      const email = recoveryEmail.value.trim();
      if (!email) {
        setAuthAlert('Please enter your email address.', 'error');
        return;
      }

      setButtonLoading(btnSubmitRecovery, true, 'Send Reset Link');
      try {
        await window.AuthService.resetPassword(email);
        setAuthAlert('Password reset instructions sent! Please check your inbox.', 'success');
      } catch (err) {
        setAuthAlert(err.message, 'error');
      } finally {
        setButtonLoading(btnSubmitRecovery, false, 'Send Reset Link');
      }
    });
  }

  // Form: Update Password (from recovery link)
  if (formUpdatePw) {
    formUpdatePw.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearAuthAlert();

      const newPw = updatePwNew.value;
      const confirmPw = updatePwConfirm.value;

      if (!newPw || newPw.length < 6) {
        setAuthAlert('New password must be at least 6 characters long.', 'error');
        return;
      }
      if (newPw !== confirmPw) {
        setAuthAlert('Passwords do not match. Please verify.', 'error');
        return;
      }

      setButtonLoading(btnSubmitUpdatePw, true, 'Save New Password');
      try {
        await window.AuthService.updatePassword(newPw);
        updatePwNew.value = '';
        updatePwConfirm.value = '';
        closeAuthModal();
        showToast('Password updated successfully!', 'success');
      } catch (err) {
        setAuthAlert(err.message, 'error');
      } finally {
        setButtonLoading(btnSubmitUpdatePw, false, 'Save New Password');
      }
    });
  }

  // Cloud Config Modal Listeners
  if (btnCloseCloudConfigModal) {
    btnCloseCloudConfigModal.addEventListener('click', closeCloudConfigModal);
  }
  if (btnCancelCloudConfig) {
    btnCancelCloudConfig.addEventListener('click', closeCloudConfigModal);
  }

  // Test Cloud Connection
  if (btnTestCloudConfig) {
    btnTestCloudConfig.addEventListener('click', async () => {
      clearCloudConfigAlert();
      const url = inputSupabaseUrl.value.trim();
      const key = inputSupabaseAnonKey.value.trim();

      if (!url || !key) {
        setCloudConfigAlert('Please provide both Project URL and Anon Key to test.', 'error');
        return;
      }

      setButtonLoading(btnTestCloudConfig, true, 'Test Connection');
      try {
        const testRes = await window.AuthService.testConnection(url, key);
        if (testRes.success) {
          setCloudConfigAlert('Connection test successful! Valid Supabase credentials.', 'success');
        } else {
          setCloudConfigAlert(testRes.error || 'Connection failed.', 'error');
        }
      } catch (err) {
        setCloudConfigAlert(err.message || 'Connection test failed.', 'error');
      } finally {
        setButtonLoading(btnTestCloudConfig, false, 'Test Connection');
      }
    });
  }

  // Save Cloud Configuration
  if (btnSaveCloudConfig) {
    btnSaveCloudConfig.addEventListener('click', async () => {
      clearCloudConfigAlert();
      const url = inputSupabaseUrl.value.trim();
      const key = inputSupabaseAnonKey.value.trim();

      if (!url || !key) {
        setCloudConfigAlert('Please provide both Project URL and Anon Public Key.', 'error');
        return;
      }

      setButtonLoading(btnSaveCloudConfig, true, 'Save & Connect');
      try {
        await window.AuthService.saveConfig(url, key);
        closeCloudConfigModal();
        showToast('Supabase connected successfully! You can now sign in.', 'success');
        openAuthModal('signin');
      } catch (err) {
        setCloudConfigAlert(err.message, 'error');
      } finally {
        setButtonLoading(btnSaveCloudConfig, false, 'Save & Connect');
      }
    });
  }

  // Clear / Disconnect Cloud Configuration
  if (btnClearCloudConfig) {
    btnClearCloudConfig.addEventListener('click', async () => {
      if (confirm('Are you sure you want to disconnect Supabase cloud configuration?')) {
        await window.AuthService.clearConfig();
        inputSupabaseUrl.value = '';
        inputSupabaseAnonKey.value = '';
        closeCloudConfigModal();
        updateUserUI();
        showToast('Supabase disconnected. Running in local mode.', 'info');
      }
    });
  }

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
