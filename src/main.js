// ============================================
// MAIN APP FILE MAP
// ============================================
// TABLE OF CONTENTS:
//
//  1. IMPORTS + DOM REFERENCES
//  2. APP STATE
//  3. LINK GRAPH HELPERS
//  4. CANVAS VIEWPORT + PLACEMENT STATE
//  5. CANVAS TRANSFORMS + PLACEMENT HELPERS
//  6. AUTH + USER BOOTSTRAP
//  7. FILE CLASSIFICATION
//  8. POST FORM + OVERLAY HELPERS
//  9. BODY CONTENT + EMBED HELPERS
// 10. POST DETAIL LAYOUT HELPERS
// 11. POST EDITING FLOW
// 12. CATEGORY MANAGEMENT
// 13. POST LINK DATA + SVG RENDERING
// 14. NOTIFICATIONS
// 15. PROFILE MODAL FLOW
// 16. POST SUBMISSION FLOW
// 17. COVER IMAGE PROMPT FLOW
// 18. POST PERSISTENCE
// 19. COMMENTS FLOW
// 20. POST LOADING + CANVAS RENDERING
// 21. FILE PREVIEW HELPERS
// 22. POST CARD COMPOSITION
// 23. GLOBAL EVENT WIRING
// 24. APP BOOTSTRAP
//
// ============================================

// ============================================
// 1. IMPORTS + DOM REFERENCES
// ============================================

import { supabase } from './supabase-config.js';
import { installPrettyAlerts } from './ui-alerts.js';

import { initMusic } from './music.js';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// DOM REFERENCES

const mainPageContainer = document.getElementById('mainPageContainer');

// Canvas (new)
const postCanvas = document.getElementById('postCanvas');
const categoryLayer = document.getElementById('categoryLayer');
const linkLayer = document.getElementById('linkLayer');
const SNAP_ALIGN_THRESHOLD = 18; // px in canvas units — tweak to taste


// (legacy) if still in HTML; not used anymore once canvas is wired
const postFeed = document.getElementById('postFeed');

// Post form overlay
const postDeleteBtn = document.getElementById('postDeleteBtn');
const postFormOverlay = document.getElementById('postFormOverlay');
const postTitle = document.getElementById('postTitle');
const postCategory = document.getElementById('postCategory');
const postCategoryInput = document.getElementById('postCategoryInput');
const addCategoryToggle = document.getElementById('addCategoryToggle');
const postFileInput = document.getElementById('postFileInput');
const postFileName = document.getElementById('postFileName');
const postText = document.getElementById('postText');
const postSubmitBtn = document.getElementById('postSubmitBtn');
const postCancelBtn = document.getElementById('postCancelBtn');

// Log out
const logoutBtn = document.getElementById('logoutBtn');

// Cover image prompt
const postCoverImageLabel = document.getElementById('postCoverImageLabel');
const postCoverImageInput = document.getElementById('postCoverImageInput');
const postCoverFileName   = document.getElementById('postCoverFileName');
const postYoutubeInput    = document.getElementById('postYoutubeInput');

// Post detail modal
const postDetailOverlay = document.getElementById('postDetailOverlay');
const postDetailModal = document.getElementById('postDetailModal');
const postDetailClose = document.getElementById('postDetailClose');
const postDetailContent = document.getElementById('postDetailContent');
const commentsList = document.getElementById('commentsList');
const commentInput = document.getElementById('commentInput');
const commentSubmitBtn = document.getElementById('commentSubmitBtn');

// Notification panel
const notifBar   = document.getElementById('notifBar');
const notifPanel = document.getElementById('notifPanel');
const notifList  = document.getElementById('notifList');

// Profile Modal 

const profileOverlay = document.getElementById('profileOverlay');

// ============================================
// 2. APP STATE
// ============================================

let currentUser = null;
let currentUserData = null;

// Link creation state: if you right-click a post, new post links to it
let pendingLinkPostId = null;
let activeThreadSourcePostId = null; // edit-mode source post for multi-thread linking

const POST_SCALE_STORAGE_KEY = 'demo4-post-scales-v1';
const POST_SCALE_MIN = 0.6;
const POST_SCALE_MAX = 2.2;
let postScaleMapLoaded = false;
let postScaleById = {};
let categoryNetworkRafId = 0;
let pendingCategoryNetworkPosts = [];

const CATEGORY_NETWORK_PASTELS = [
  'hsla(274, 42%, 74%, 0.72)', // pastel purple
  'hsla(126, 34%, 74%, 0.72)', // pastel green
  'hsla(208, 42%, 74%, 0.72)', // pastel blue
  'hsla(31, 52%, 72%, 0.72)',  // pastel orange
  'hsla(286, 36%, 72%, 0.72)',
  'hsla(138, 30%, 72%, 0.72)',
  'hsla(218, 36%, 72%, 0.72)',
  'hsla(38, 46%, 70%, 0.72)'
];

// Post create/edit state
let pendingPost = null;
let editMode = false;
let editingPostId   = null;
let editingPost     = null; // full original post row, used to preserve untouched file fields

// Filters (normal mode only)
let activeUserFilter = null;      // user_id
let activeCategoryFilter = null;  // category name or NONE_CATEGORY_FILTER
const NONE_CATEGORY_FILTER = '__NONE__';


// Modal state
let activePostForModal = null;

// Double right-click detection
let lastRightClick = 0;
const DOUBLE_CLICK_THRESHOLD = 400; // ms

// Cache last loaded data for re-rendering link lines on pan/zoom/move
let lastLoadedPosts = [];
let lastLoadedLinks = [];

let activeLinkTreeRootPostId = null; // any post id inside the selected connected component

// Profile modal state
let profileEditMode       = false;
let newProfileCoverFile   = null;
let newProfilePfpFile     = null;
let currentProfileUserId  = null;

// Post detail 3-col layout state
let pdColWidths   = { visual: 50, text: 30, comments: 20 };
let pdFullscreen  = false;
let _pdHasVisual  = false;
let _pdHasText    = false;
let pdVisualNavController = null;
let pdHoveredRegion = null;
let pdModalInteractionCleanup = null;
let pdVisualZoom = 1;
let pdVisualPanX = 0;
let pdVisualPanY = 0;
let pdPdfRenderToken = 0;

const PD_MIN_ZOOM = 1;
const PD_MAX_ZOOM = 4;
const PD_ZOOM_STEP = 0.18;

const UI_STATE_STORAGE_PREFIX = 'demo4-main-ui-state-v1';
const UI_STATE_QUICK_KEY = 'demo4-main-ui-state-quick-v1';
const UI_STATE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;
const DEFAULT_BOOT_SCALE = 0.14;

let restoredUiState = null;
let restoreInFlight = false;
let uiPersistTimer = null;
let realtimeRefreshTimer = null;
let realtimeNeedsLinks = false;
let mainRealtimeChannel = null;

// ============================================
// 3. LINK GRAPH HELPERS
// ============================================

function buildAdjacency(links) {
  const adj = new Map(); // postId -> Set(postId)
  for (const l of (links || [])) {
    const a = String(l.a_post_id);
    const b = String(l.b_post_id);
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  return adj;
}

function getConnectedComponent(startId, links) {
  const start = String(startId);
  const adj = buildAdjacency(links);
  const seen = new Set();
  const stack = [start];

  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);

    const neighbors = adj.get(cur);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (!seen.has(n)) stack.push(n);
    }
  }

  return seen;
}

function normalizeLinkPair(postAId, postBId) {
  const a = String(postAId);
  const b = String(postBId);
  return a < b
    ? { a_post_id: a, b_post_id: b }
    : { a_post_id: b, b_post_id: a };
}

function findExistingLinkRecord(postAId, postBId, links = lastLoadedLinks) {
  const { a_post_id, b_post_id } = normalizeLinkPair(postAId, postBId);
  return (links || []).find((l) =>
    String(l.a_post_id) === a_post_id && String(l.b_post_id) === b_post_id
  ) || null;
}

function canCurrentUserEditPost(post) {
  if (!currentUser || !post) return false;
  if (currentUserData?.is_admin) return true;
  return String(post.user_id) === String(currentUser.id);
}

async function toggleThreadLinkBetweenPosts(sourcePostId, targetPostId) {
  const sourceId = String(sourcePostId || '');
  const targetId = String(targetPostId || '');

  if (!sourceId || !targetId || sourceId === targetId) return;

  const { a_post_id, b_post_id } = normalizeLinkPair(sourceId, targetId);
  const existing = findExistingLinkRecord(a_post_id, b_post_id, lastLoadedLinks);

  if (existing?.id) {
    const { error } = await supabase
      .from('post_links')
      .delete()
      .eq('id', existing.id);

    if (error) {
      console.error('Failed to remove link:', error);
      alert(`Failed to remove thread link: ${error.message}`);
      return;
    }
  } else {
    const { error } = await supabase
      .from('post_links')
      .insert([{ group_id: 'group4', a_post_id, b_post_id, created_by: currentUser.id }]);

    if (error) {
      console.error('Failed to add link:', error);
      alert(`Failed to add thread link: ${error.message}`);
      return;
    }
  }

  await loadLinks();
  await loadPosts();
}



// ============================================
// 4. CANVAS VIEWPORT + PLACEMENT STATE
// ============================================

let canvasScale = 1;
const MIN_SCALE = 0.04;
const MAX_SCALE = 2.2;
const ZOOM_SENSITIVITY = 0.0015; // tweak: smaller = slower zoom

let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartOffsetX = 0;
let panStartOffsetY = 0;
let canvasOffsetX = 0;
let canvasOffsetY = 0;

// Placement mode
let isPlacing = false;
let placingPost = null;      // the post row (must include id)
let placingCardEl = null;    // DOM element for the card being placed
let placeMouseOffsetX = 0;   // center-of-card offset (canvas units)
let placeMouseOffsetY = 0;
let resizingPostState = null;

const CARD_GAP = 10; // minimum gap between cards (px in canvas units)

// ============================================
// 5. CANVAS TRANSFORMS + PLACEMENT HELPERS
// ============================================

function applyCanvasTransform() {
  if (!postCanvas) return;
  postCanvas.style.transform = `translate(${canvasOffsetX}px, ${canvasOffsetY}px) scale(${canvasScale})`;
  postCanvas.style.transformOrigin = '0 0';

  // keep links in sync with pan/zoom
  renderLinks(lastLoadedPosts, lastLoadedLinks);
  scheduleUiStatePersist();
}

function clampPostScale(value) {
  return Math.max(POST_SCALE_MIN, Math.min(POST_SCALE_MAX, value));
}

function ensurePostScaleMapLoaded() {
  if (postScaleMapLoaded) return;
  postScaleMapLoaded = true;

  try {
    const raw = localStorage.getItem(POST_SCALE_STORAGE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    postScaleById = parsed;
  } catch (err) {
    console.warn('Failed to load post scale map', err);
    postScaleById = {};
  }
}

function persistPostScaleMap() {
  try {
    localStorage.setItem(POST_SCALE_STORAGE_KEY, JSON.stringify(postScaleById));
  } catch (err) {
    console.warn('Failed to persist post scale map', err);
  }
}

function getStoredPostScale(postId) {
  ensurePostScaleMapLoaded();
  const raw = Number(postScaleById[String(postId)]);
  if (!Number.isFinite(raw)) return 1;
  return clampPostScale(raw);
}

function setStoredPostScale(postId, scale) {
  ensurePostScaleMapLoaded();
  postScaleById[String(postId)] = clampPostScale(scale);
  persistPostScaleMap();
}

function getCardScale(cardEl) {
  const raw = Number(cardEl?.dataset?.postScale || '1');
  if (!Number.isFinite(raw)) return 1;
  return clampPostScale(raw);
}

function applyCardScale(cardEl, scale) {
  const next = clampPostScale(scale);
  cardEl.dataset.postScale = String(next);
  cardEl.style.setProperty('--post-scale', String(next));
}

// Convert viewport mouse coordinates to canvas coordinates (account for current pan + zoom)
function viewportPointToCanvasPoint(clientX, clientY) {
  // Inverse of: screen = (canvas * scale) + offset
  return {
    x: (clientX - canvasOffsetX) / canvasScale,
    y: (clientY - canvasOffsetY) / canvasScale
  };
}

function normalizeWheelDelta(e) {
  const lineHeight = 16;
  const pageHeight = window.innerHeight || 800;

  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return e.deltaY * lineHeight;
  }

  if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return e.deltaY * pageHeight;
  }

  return e.deltaY;
}

function getCardRectAt(cardEl, x, y) {
  // offsetWidth/Height are already in canvas units (CSS transform doesn't affect them)
  const scale = getCardScale(cardEl);
  const w = cardEl.offsetWidth * scale;
  const h = cardEl.offsetHeight * scale;
  return { left: x, top: y, right: x + w, bottom: y + h };

}

function rectsOverlap(a, b, gap = 0) {
  return !(
    a.right + gap <= b.left ||
    a.left >= b.right + gap ||
    a.bottom + gap <= b.top ||
    a.top >= b.bottom + gap
  );
}

function canPlaceCardAt(cardEl, x, y) {
  const rect = getCardRectAt(cardEl, x, y);

  const others = postCanvas.querySelectorAll('.post-card');
  for (const other of others) {
    if (other === cardEl) continue;

    const ox = parseFloat(other.style.left || '0');
    const oy = parseFloat(other.style.top || '0');
    const orect = getCardRectAt(other, ox, oy);

    if (rectsOverlap(rect, orect, CARD_GAP)) return false;
  }
  return true;
}

async function waitForCardMedia(cardEl) {
  const images = [...cardEl.querySelectorAll('img')];
  const videos = [...cardEl.querySelectorAll('video')];

  const imagePromises = images.map(img => {
    if (img.complete) return Promise.resolve();
    return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
  });

  const videoPromises = videos.map(vid => {
    if (vid.readyState >= 1) return Promise.resolve();
    return new Promise(resolve => { vid.onloadedmetadata = resolve; vid.onerror = resolve; });
  });

  await Promise.all([...imagePromises, ...videoPromises]);
}

function startPlacement(post, cardEl, mouseEvent) {
  isPlacing = true;
  placingPost = post;
  placingCardEl = cardEl;

  placingCardEl.style.zIndex = '20';
  // Disable interactive buttons so the drop click can't accidentally trigger them
  placingCardEl.querySelectorAll(
    '.post-file-preview-play, .post-file-preview-download-btn, .post-preview-mute-btn, .post-file-preview-youtube-activate'
  ).forEach(btn => { btn.style.pointerEvents = 'none'; });

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (isPlacing && placingCardEl === cardEl) {
        updatePlacementPosition(mouseEvent);
      }
    });
  });
}

function stopPlacement() {
  if (placingCardEl) {
    placingCardEl.style.zIndex = '';
    placingCardEl.style.outline = '';
    // Re-enable interactive buttons now that placement is done
    placingCardEl.querySelectorAll(
      '.post-file-preview-play, .post-file-preview-download-btn, .post-preview-mute-btn, .post-file-preview-youtube-activate'
    ).forEach(btn => { btn.style.pointerEvents = ''; });
  }
  isPlacing = false;
  placingPost = null;
  placingCardEl = null;
}

function updatePlacementPosition(e) {
  if (!isPlacing || !placingCardEl) return;

  const pt = viewportPointToCanvasPoint(e.clientX, e.clientY);

  // offsetWidth/Height are in canvas units — no canvasScale division needed
  const placingScale = getCardScale(placingCardEl);
  const w = placingCardEl.offsetWidth * placingScale;
  const h = placingCardEl.offsetHeight * placingScale;
  placeMouseOffsetX = w / 2;
  placeMouseOffsetY = h / 2;

  let x = pt.x - placeMouseOffsetX;
  let y = pt.y - placeMouseOffsetY;

  const pw = placingCardEl.offsetWidth * placingScale;
  const ph = placingCardEl.offsetHeight * placingScale;
  const pcx = x + pw / 2;
  const pcy = y + ph / 2;

  let snapX = null, snapY = null;
  let bestDx = SNAP_ALIGN_THRESHOLD;
  let bestDy = SNAP_ALIGN_THRESHOLD;

  const cards = postCanvas.querySelectorAll('.post-card');
  for (const other of cards) {
    if (other === placingCardEl) continue;
    const ox  = parseFloat(other.style.left || '0');
    const oy  = parseFloat(other.style.top  || '0');
    const otherScale = getCardScale(other);
    const ocx = ox + (other.offsetWidth * otherScale) / 2;
    const ocy = oy + (other.offsetHeight * otherScale) / 2;

    const dx = Math.abs(pcx - ocx);
    if (dx < bestDx) {
      bestDx = dx;
      snapX = ox + ((other.offsetWidth * otherScale) - pw) / 2;
    }

    const dy = Math.abs(pcy - ocy);
    if (dy < bestDy) {
      bestDy = dy;
      snapY = oy + ((other.offsetHeight * otherScale) - ph) / 2;
    }
  }

  if (snapX !== null) x = snapX;
  if (snapY !== null) y = snapY;

  placingCardEl.style.left = `${x}px`;
  placingCardEl.style.top  = `${y}px`;

  const snapping = snapX !== null || snapY !== null;
  placingCardEl.style.outline = snapping
    ? '2px solid rgba(255,255,255,0.6)'
    : '2px solid rgba(255,255,255,0.25)';

  const ok = canPlaceCardAt(placingCardEl, x, y);
  placingCardEl.style.opacity = ok ? '1' : '0.6';

  renderLinks(lastLoadedPosts, lastLoadedLinks);
}

function beginPostResize(e, cardEl, postId) {
  if (isPlacing) return;

  e.preventDefault();
  e.stopPropagation();

  const startScale = getCardScale(cardEl);
  resizingPostState = {
    cardEl,
    postId: String(postId),
    startX: e.clientX,
    startY: e.clientY,
    startScale
  };

  cardEl.classList.add('post-card-resizing');
}

function updatePostResize(e) {
  if (!resizingPostState?.cardEl) return;

  const dx = e.clientX - resizingPostState.startX;
  const dy = e.clientY - resizingPostState.startY;
  const delta = (dx + dy) / 320;
  const nextScale = clampPostScale(resizingPostState.startScale + delta);

  applyCardScale(resizingPostState.cardEl, nextScale);
  renderLinks(lastLoadedPosts, lastLoadedLinks);
}

function endPostResize() {
  if (!resizingPostState?.cardEl) return;

  const { cardEl, postId } = resizingPostState;
  const nextScale = getCardScale(cardEl);

  cardEl.classList.remove('post-card-resizing');
  setStoredPostScale(postId, nextScale);
  resizingPostState = null;

  renderLinks(lastLoadedPosts, lastLoadedLinks);
}

async function tryDropPlacement(e) {
  if (!isPlacing || !placingCardEl || !placingPost) return;

  const x = parseFloat(placingCardEl.style.left || '0');
  const y = parseFloat(placingCardEl.style.top || '0');

  if (!canPlaceCardAt(placingCardEl, x, y)) {
    return; // keep sticky until a valid spot
  }

  let placementQuery = supabase
  .from('posts')
  .update({ x, y })
  .eq('id', placingPost.id);

if (!currentUserData?.is_admin) {
  placementQuery = placementQuery.eq('user_id', currentUser.id);
}

const { error } = await placementQuery;

  placingPost.x = x;
  placingPost.y = y;

  stopPlacement();
  renderLinks(lastLoadedPosts, lastLoadedLinks);
}

// ============================================
// 6. AUTH + USER BOOTSTRAP
// ============================================

async function checkAuth() {
  const { data: { session }, error } = await supabase.auth.getSession();

  if (error) {
    console.error('Failed to get session:', error);
    return null;
  }

  if (!session) {
    window.location.href = './index.html';
    return null;
  }

  currentUser = session.user;
  console.log('Logged in as:', currentUser.id);

  const { data, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  if (userError) {
    console.error('Failed to fetch user data:', userError);
    return null;
  }

  currentUserData = data;
  console.log('User data loaded:', currentUserData.username);
  return session;
}

// ============================================
// 7. FILE CLASSIFICATION
// ============================================

async function getFileType(file) {
  const mime = file?.type || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';

  if (mime.startsWith('video/')) {
    // probe: audio-only mp4 has no video track (videoWidth stays 0)
    const isAudioOnly = await new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const vid = document.createElement('video');
      vid.preload = 'metadata';
      vid.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(vid.videoWidth === 0);
      };
      vid.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
      };
      vid.src = url;
    });
    return isAudioOnly ? 'audio' : 'video';
  }

  return 'other';
}

async function isVisualFile(file) {
  const type = await getFileType(file);
  return type === 'image' || type === 'video';
}


// ============================================
// 8. POST FORM + OVERLAY HELPERS
// ============================================

function openPostForm() {
  postFormOverlay.style.display = 'flex';
  scheduleUiStatePersist();
}

function closePostForm() {
  postCoverImageInput.value = '';
  postCoverFileName.textContent = 'choose cover image';
  postCoverImageLabel.style.display = 'none';
  postFormOverlay.style.display = 'none';
  postTitle.value = '';
  postFileInput.value = '';
  postFileName.textContent = 'choose file';
  setPostTextBody('');
  postCategory.value = '';
  postCategory.style.display = 'block';
  postCategoryInput.style.display = 'none';
  postCategoryInput.value = '';
  addCategoryToggle.textContent = '+';
  editingPostId = null;
  editingPost   = null;
  postDeleteBtn.style.display = 'none'; // hide when form closes
  postYoutubeInput.value = '';

  // clear pending link target
  pendingLinkPostId = null;
  scheduleUiStatePersist();
}

function hasUnsavedFormContent() {
  if (postTitle.value.trim()) return true;
  if (postFileInput.files && postFileInput.files.length > 0) return true;
  if (getBodyPlainText(postText.innerHTML || '')) return true;
  if (postYoutubeInput.value.trim()) return true;
  return false;
}

async function maybeClosePostForm() {
  if (hasUnsavedFormContent()) {
    const isEditing = Boolean(editingPostId);
    const title = isEditing ? 'discard post edits?' : 'discard this draft?';
    const message = isEditing
      ? 'You have unsaved edits in this post form. Closing now will lose these changes.'
      : 'You have unsaved content in this draft. Closing now will lose it.';

    let shouldClose = false;
    if (typeof window.__prettyConfirm === 'function') {
      shouldClose = await window.__prettyConfirm({
        title,
        message,
        confirmLabel: 'discard',
        cancelLabel: 'keep editing',
        danger: true
      });
    } else {
      shouldClose = confirm('Unsaved changes will be lost. Close anyway?');
    }

    if (!shouldClose) return;
  }
  closePostForm();
}

function closeCoverImagePrompt() {
  coverImageOverlay.style.display = 'none';
  coverImageInput.value = '';
  coverImageFileName.textContent = 'choose image';
  pendingPost = null;
}

function initFileNav(files) {
  let idx = 0;

  const viewer = document.getElementById('fileNavViewer');
  const label  = document.getElementById('fileNavLabel');
  const prev   = document.getElementById('fileNavPrev');
  const next   = document.getElementById('fileNavNext');
  if (!viewer || !label || !prev || !next) return;

  function render() {
    const f = files[idx];
    label.textContent = `${f.name}  (${idx + 1} / ${files.length})`;

    if (f.type === 'image') {
      viewer.innerHTML = `<img class="post-image" src="${f.url}" alt="">`;
    } else if (f.type === 'video') {
      viewer.innerHTML = `<video class="post-video" src="${f.url}" controls></video>`;
    } else if (f.type === 'audio') {
      viewer.innerHTML = `<audio src="${f.url}" controls style="width:100%"></audio>`;
    } else {
      viewer.innerHTML = `
        <div class="file-nav-download">
          <a href="${f.url}" download>${f.name}</a>
        </div>
      `;
    }
  }

  prev.addEventListener('click', () => { idx = (idx - 1 + files.length) % files.length; render(); });
  next.addEventListener('click', () => { idx = (idx + 1) % files.length; render(); });
  render();
}

// ============================================
// 9. BODY CONTENT + EMBED HELPERS
// ============================================


function extractYouTubeId(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const patterns = [
    /[?&]v=([^&\s]+)/,
    /youtu\.be\/([^?&\s]+)/,
    /youtube\.com\/embed\/([^?&\s]+)/,
    /youtube\.com\/shorts\/([^?&\s]+)/,
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) return m[1];
  }
  return null;
}

function getYouTubePosterUrl(youtubeId) {
  if (!youtubeId) return '';
  return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
}

function getYouTubeEmbedSrc(youtubeId, { autoplay = false } = {}) {
  const autoplayFlag = autoplay ? '1' : '0';
  return `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=${autoplayFlag}&rel=0&playsinline=1&modestbranding=1&iv_load_policy=3&color=white`;
}

function createYouTubePosterShellMarkup(youtubeId, shellClass, buttonClass, iconClass) {
  const posterUrl = getYouTubePosterUrl(youtubeId);
  return `
    <div class="${shellClass}" data-youtube-id="${youtubeId}">
      <img class="post-file-preview-cover" src="${posterUrl}" alt="YouTube thumbnail" loading="lazy">
      <button class="${buttonClass}" type="button" aria-label="play YouTube video">
        <span class="${iconClass}" aria-hidden="true">▷</span>
      </button>
    </div>
  `;
}

function activateYouTubeEmbed(shell, iframeClass) {
  if (!shell) return;
  const youtubeId = shell.dataset.youtubeId || '';
  if (!youtubeId) return;

  shell.innerHTML = `
    <iframe
      class="${iframeClass}"
      src="${getYouTubeEmbedSrc(youtubeId, { autoplay: true })}"
      title="YouTube video"
      frameborder="0"
      allowfullscreen
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      loading="lazy"
    ></iframe>
  `;
}

function escapeHtml(text = '') {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hasRichTextMarkup(value) {
  if (!value) return false;
  const template = document.createElement('template');
  template.innerHTML = value;
  return [...template.content.childNodes].some(node => node.nodeType === Node.ELEMENT_NODE);
}

function hasRenderableBodyContent(el) {
  if (!el) return false;
  return Boolean((el.textContent || '').trim() || el.querySelector('br, ul, ol, li, p, div'));
}

function sanitizeBodyHtml(value) {
  if (!value) return '';

  if (!hasRichTextMarkup(value)) {
    return escapeHtml(value).replace(/\n/g, '<br>');
  }

  const template = document.createElement('template');
  template.innerHTML = value;
  const container = document.createElement('div');

  function sanitizeNode(node, targetParent, inList = false) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) {
        targetParent.appendChild(document.createTextNode(node.textContent));
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName.toLowerCase();

    if (tag === 'br') {
      targetParent.appendChild(document.createElement('br'));
      return;
    }

    if (tag === 'b' || tag === 'strong') {
      const strong = document.createElement('strong');
      [...node.childNodes].forEach(child => sanitizeNode(child, strong, inList));
      if (hasRenderableBodyContent(strong)) targetParent.appendChild(strong);
      return;
    }

    if (tag === 'i' || tag === 'em') {
      const em = document.createElement('em');
      [...node.childNodes].forEach(child => sanitizeNode(child, em, inList));
      if (hasRenderableBodyContent(em)) targetParent.appendChild(em);
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      const list = document.createElement(tag);
      [...node.childNodes].forEach(child => sanitizeNode(child, list, true));
      if (hasRenderableBodyContent(list)) targetParent.appendChild(list);
      return;
    }

    if (tag === 'li') {
      const listItem = document.createElement('li');
      [...node.childNodes].forEach(child => sanitizeNode(child, listItem, true));
      if (!hasRenderableBodyContent(listItem)) return;
      if (inList) {
        targetParent.appendChild(listItem);
      } else {
        const fallbackList = document.createElement('ul');
        fallbackList.appendChild(listItem);
        targetParent.appendChild(fallbackList);
      }
      return;
    }

    if (tag === 'p' || tag === 'div') {
      const block = document.createElement(tag);
      [...node.childNodes].forEach(child => sanitizeNode(child, block, false));
      if (hasRenderableBodyContent(block)) targetParent.appendChild(block);
      return;
    }

    if (tag === 'span') {
      const fw = node.style?.fontWeight || '';
      const fs = node.style?.fontStyle  || '';
      const isBold   = fw === 'bold' || fw === '700' || fw === 'bolder';
      const isItalic = fs === 'italic' || fs === 'oblique';
      if (isBold && isItalic) {
        const strong = document.createElement('strong');
        const em = document.createElement('em');
        [...node.childNodes].forEach(child => sanitizeNode(child, em, inList));
        if (hasRenderableBodyContent(em)) { strong.appendChild(em); targetParent.appendChild(strong); }
      } else if (isBold) {
        const strong = document.createElement('strong');
        [...node.childNodes].forEach(child => sanitizeNode(child, strong, inList));
        if (hasRenderableBodyContent(strong)) targetParent.appendChild(strong);
      } else if (isItalic) {
        const em = document.createElement('em');
        [...node.childNodes].forEach(child => sanitizeNode(child, em, inList));
        if (hasRenderableBodyContent(em)) targetParent.appendChild(em);
      } else {
        [...node.childNodes].forEach(child => sanitizeNode(child, targetParent, inList));
      }
      return;
    }

    [...node.childNodes].forEach(child => sanitizeNode(child, targetParent, inList));
  }

  [...template.content.childNodes].forEach(node => sanitizeNode(node, container, false));
  return container.innerHTML.trim();
}

function formatBodyText(text) {
  return sanitizeBodyHtml(text);
}

function formatTimestamp(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';

  return dt.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function renderPostBodyMarkup(text) {
  return `<div class="post-body">${formatBodyText(text)}</div>`;
}

function getBodyPlainText(text) {
  const bodyMarkup = formatBodyText(text);
  if (!bodyMarkup) return '';
  const container = document.createElement('div');
  container.innerHTML = bodyMarkup;
  return (container.textContent || '').replace(/\u00A0/g, ' ').trim();
}

function setPostTextBody(text) {
  postText.innerHTML = formatBodyText(text || '');
}

function getPostTextBody() {
  const sanitized = formatBodyText(postText.innerHTML || '');
  postText.innerHTML = sanitized;
  return sanitized;
}

function insertHtmlAtCursor(html) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    postText.focus();
    document.execCommand('insertHTML', false, html);
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  const fragment = range.createContextualFragment(html);
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);

  if (lastNode) {
    range.setStartAfter(lastNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function handlePostTextPaste(e) {
  const html = e.clipboardData?.getData('text/html');
  const text = e.clipboardData?.getData('text/plain') || '';
  const sanitized = html
    ? formatBodyText(html)
    : escapeHtml(text).replace(/\n/g, '<br>');

  e.preventDefault();
  insertHtmlAtCursor(sanitized || escapeHtml(text));
}

function initPdAudioPlayer(audioFiles, container) {
  if (!audioFiles || audioFiles.length === 0) return;

  let idx = 0;
  const audio = new Audio();
  audio.preload = 'none';

  const player = document.createElement('div');
  player.className = 'pd-audio-player';

  player.innerHTML = `
    <button class="pd-audio-btn pd-audio-play" title="play / pause">▷</button>
    ${audioFiles.length > 1 ? `<button class="pd-audio-btn pd-audio-next" title="next">›</button>` : ''}
    <span class="pd-audio-title"></span>
  `;

  container.appendChild(player);

  const playBtn  = player.querySelector('.pd-audio-play');
  const nextBtn  = player.querySelector('.pd-audio-next');
  const titleEl  = player.querySelector('.pd-audio-title');

  function loadTrack(i) {
    const wasPlaying = !audio.paused;
    audio.pause();
    audio.src = audioFiles[i].url;
    titleEl.textContent = audioFiles[i].name || `track ${i + 1}`;
    playBtn.textContent = '▷';
    if (wasPlaying) audio.play().then(() => { playBtn.textContent = '||'; }).catch(() => {});
  }

  loadTrack(0);

  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.play().then(() => { playBtn.textContent = '||'; }).catch(() => {});
    } else {
      audio.pause();
      playBtn.textContent = '▷';
    }
  });

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      idx = (idx + 1) % audioFiles.length;
      loadTrack(idx);
      audio.play().then(() => { playBtn.textContent = '||'; }).catch(() => {});
    });
  }

  audio.addEventListener('ended', () => {
    if (audioFiles.length > 1) {
      idx = (idx + 1) % audioFiles.length;
      loadTrack(idx);
      audio.play().then(() => { playBtn.textContent = '||'; }).catch(() => {});
    } else {
      playBtn.textContent = '▷';
    }
  });

  // Stop audio when modal closes
  const observer = new MutationObserver(() => {
    if (document.getElementById('postDetailOverlay')?.style.display === 'none') {
      audio.pause();
      audio.src = '';
      observer.disconnect();
    }
  });
  const overlay = document.getElementById('postDetailOverlay');
  if (overlay) observer.observe(overlay, { attributes: true, attributeFilter: ['style'] });
}

async function triggerFileDownload(url, filename) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  }
}

function createPdDownloadTabBar(files) {
  const bar = document.createElement('div');
  bar.className = 'pd-file-tab-bar';

  files.forEach((file) => {
    const btn = document.createElement('button');
    btn.className = 'pd-file-tab pd-file-tab-dl';
    btn.innerHTML = `<span class="pd-dl-icon">⤓</span><span class="pd-tab-name">${file.name}</span>`;
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.title = file.name;
    btn.addEventListener('click', () => {
      triggerFileDownload(file.url, file.name);
    });
    bar.appendChild(btn);
  });

  return bar;
}

function wirePreviewVideoControls(content) {
  const previewVideo = content.querySelector('.post-preview-video');
  const muteBtn = content.querySelector('.post-preview-mute-btn');
  if (!previewVideo || !muteBtn) return;

  muteBtn.textContent = '♪';
  previewVideo.play().catch(() => {});

  muteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    previewVideo.muted = !previewVideo.muted;
    muteBtn.textContent = previewVideo.muted ? '♪' : '⊘';
  });
}

function wireAudioPreviewControls(content) {
  const audioPreview = content.querySelector('.post-preview-audio');
  const playBtn = content.querySelector('.post-file-preview-play');
  if (!audioPreview || !playBtn) return;

  playBtn.textContent = audioPreview.paused ? '▷' : '☐';
  playBtn.addEventListener('click', async (e) => {
    e.stopPropagation();

    try {
      if (!audioPreview.src && audioPreview.dataset.src) {
        audioPreview.src = audioPreview.dataset.src;
      }

      if (audioPreview.paused) {
        await audioPreview.play();
        playBtn.textContent = '☐';
      } else {
        audioPreview.pause();
        playBtn.textContent = '▷';
      }
    } catch (err) {
      console.error('Audio preview failed:', err);
    }
  });

  audioPreview.addEventListener('ended', () => {
    playBtn.textContent = '▷';
  });
  audioPreview.addEventListener('pause', () => {
    playBtn.textContent = '▷';
  });
  audioPreview.addEventListener('play', () => {
    playBtn.textContent = '☐';
  });
}

function wireYouTubePreviewControls(content, { disableInteraction = false } = {}) {
  const activators = content.querySelectorAll('.post-file-preview-youtube-activate');
  if (!activators.length) return;

  activators.forEach((btn) => {
    let _lastPointerType = 'mouse';
    btn.addEventListener('pointerdown', (e) => { _lastPointerType = e.pointerType; });
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // On touch, let the card's tap handler open the post detail instead
      if (_lastPointerType !== 'mouse') return;

      if (disableInteraction || isPlacing || editMode) return;

      const shell = btn.closest('.post-file-preview-youtube-shell');
      activateYouTubeEmbed(shell, 'post-file-preview-youtube-player');
    });
  });
}

// ============================================
// 10. POST DETAIL LAYOUT HELPERS
// ============================================
function applyPdColWidths() {
  const vc = document.getElementById('pdVisualCol');
  const tc = document.getElementById('pdTextCol');
  const cc = document.getElementById('pdCommentsCol');
  if (vc && pdColWidths.visual > 0) vc.style.flex = `0 0 ${pdColWidths.visual}%`;
  if (tc && pdColWidths.text   > 0) tc.style.flex = `0 0 ${pdColWidths.text}%`;
  if (cc) cc.style.flex = `0 0 ${pdColWidths.comments}%`;
}


// Show/hide columns based on available content
function applyPdLayout(hasVisual, hasText) {
  _pdHasVisual = hasVisual;
  _pdHasText   = hasText;
  pdFullscreen = false;


  const vc  = document.getElementById('pdVisualCol');
  const tc  = document.getElementById('pdTextCol');
  const cc  = document.getElementById('pdCommentsCol');

  const h1  = document.getElementById('pdHandle1');
  const h2  = document.getElementById('pdHandle2');
  const fsb = document.getElementById('pdFullscreenBtn');
  if (fsb) fsb.textContent = '⤢';


  if (hasVisual && hasText) {
    pdColWidths = { visual: 50, text: 30, comments: 20 };
    vc.style.display = ''; h1.style.display = '';
    tc.style.display = ''; h2.style.display = '';
  } else if (hasVisual) {
    pdColWidths = { visual: 80, text: 0, comments: 20 };
    vc.style.display = ''; h1.style.display = 'none';

    tc.style.display = 'none'; h2.style.display = '';
  } else if (hasText) {
    pdColWidths = { visual: 0, text: 80, comments: 20 };
    vc.style.display = 'none'; h1.style.display = 'none';
    tc.style.display = ''; h2.style.display = '';

  } else {
    pdColWidths = { visual: 0, text: 0, comments: 100 };
    vc.style.display = 'none'; h1.style.display = 'none';
    tc.style.display = 'none'; h2.style.display = 'none';
  }
  cc.style.display = '';
  applyPdColWidths();

}

// Fullscreen toggle for the visual column
function togglePdFullscreen() {
  pdFullscreen = !pdFullscreen;
  const vc  = document.getElementById('pdVisualCol');

  const tc  = document.getElementById('pdTextCol');
  const cc  = document.getElementById('pdCommentsCol');
  const h1  = document.getElementById('pdHandle1');
  const h2  = document.getElementById('pdHandle2');
  const fsb = document.getElementById('pdFullscreenBtn');

  if (pdFullscreen) {
    tc.style.display  = 'none';
    cc.style.display  = 'none';
    h1.style.display  = 'none';
    h2.style.display  = 'none';
    vc.style.flex     = '0 0 100%';
    if (fsb) fsb.textContent = '⤡';
  } else {
    cc.style.display = '';
    if (fsb) fsb.textContent = '⤢';
    applyPdLayout(_pdHasVisual, _pdHasText);
  }
}

// Build the visual carousel inside the visual column
function buildPdVisualCarousel(visuals, inner, prevBtn, nextBtn, counterEl) {
  if (!visuals || visuals.length === 0) return null;
  let idx = 0;

  function render() {
    const f = visuals[idx];
    const isPdf = f.type === 'pdf';
    pdVisualZoom = 1;
    pdVisualPanX = 0;
    pdVisualPanY = 0;

    if (prevBtn) {
      prevBtn.style.visibility = (!isPdf && visuals.length > 1) ? 'visible' : 'hidden';
    }
    if (nextBtn) {
      nextBtn.style.visibility = (!isPdf && visuals.length > 1) ? 'visible' : 'hidden';
    }
    if (counterEl) {
      counterEl.textContent = (!isPdf && visuals.length > 1) ? `${idx + 1} / ${visuals.length}` : '';
    }

    if (f.type === 'youtube') {
      inner.innerHTML = createYouTubePosterShellMarkup(
        f.url,
        'pd-youtube-shell',
        'pd-youtube-activate',
        'pd-youtube-activate-icon'
      );
      const activateBtn = inner.querySelector('.pd-youtube-activate');
      activateBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const shell = inner.querySelector('.pd-youtube-shell');
        activateYouTubeEmbed(shell, 'pd-visual-youtube');
      });
    } else if (f.type === 'pdf') {
      renderPdPdfViewer(f, inner);
    } else if (f.type === 'image') {
      inner.innerHTML = `<img class="pd-visual-img" src="${f.url}" alt="">`;
      applyPdVisualZoom(inner);
    } else {
      inner.innerHTML = `<video class="pd-visual-video" src="${f.url}" controls></video>`;
    }
  }

  render();

  if (prevBtn) {
    prevBtn.onclick = () => { idx = (idx - 1 + visuals.length) % visuals.length; render(); };
  }
  if (nextBtn) {
    nextBtn.onclick = () => { idx = (idx + 1) % visuals.length; render(); };
  }

  return {
    prev() {
      if (visuals.length <= 1) return;
      idx = (idx - 1 + visuals.length) % visuals.length;
      render();
    },
    next() {
      if (visuals.length <= 1) return;
      idx = (idx + 1) % visuals.length;
      render();
    },
    hasMultiple() {
      return visuals.length > 1;
    },
    getCurrent() {
      return visuals[idx] || null;
    }
  };
}

// Drag-to-resize detail modal columns
function initPdResize() {
  const body = document.getElementById('pdBody');
  const h1   = document.getElementById('pdHandle1');
  const h2   = document.getElementById('pdHandle2');
  let dragging = null;

  h1.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = { handle: 'h1', startX: e.clientX, start: { ...pdColWidths } };
  });
  h2.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = { handle: 'h2', startX: e.clientX, start: { ...pdColWidths } };
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const totalW = body.getBoundingClientRect().width;
    if (!totalW) return;
    const dxPct = ((e.clientX - dragging.startX) / totalW) * 100;

    if (dragging.handle === 'h1') {
      const newV = Math.max(15, Math.min(75, dragging.start.visual + dxPct));
      const newT = Math.max(10, dragging.start.visual + dragging.start.text - newV);
      pdColWidths.visual = newV;
      pdColWidths.text   = newT;
    } else {
      const leftKey = _pdHasText ? 'text' : 'visual';
      const newL = Math.max(15, Math.min(85, dragging.start[leftKey] + dxPct));
      const newC = Math.max(10, dragging.start[leftKey] + dragging.start.comments - newL);
      pdColWidths[leftKey]  = newL;
      pdColWidths.comments  = newC;
    }
    applyPdColWidths();
  });

  document.addEventListener('mouseup', () => { dragging = null; });
}

async function openPostDetailModal(post, user) {
  if (pdModalInteractionCleanup) {
    pdModalInteractionCleanup();
    pdModalInteractionCleanup = null;
  }

  activePostForModal = post;

  // ── User block ──
  const pfpFallback = './images/pfps/default.png';
  const pfpSrc = user?.pfp_url || (user?.pfp ? `./images/pfps/${user.pfp}` : pfpFallback);
  document.getElementById('pdPfp').src              = pfpSrc;
  document.getElementById('pdUsername').textContent = user?.username || '';

  // ── Date ──
  const dateEl = document.getElementById('pdDate');
  dateEl.textContent = post.created_at
    ? new Date(post.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  // ── Title + Category ──
  document.getElementById('pdTitle').textContent = post.title || '';
  let categoryEl = document.getElementById('pdCategory');
  if (!categoryEl) {
    categoryEl = document.createElement('div');
    categoryEl.id        = 'pdCategory';
    categoryEl.className = 'pd-category';
    document.getElementById('pdTitle').insertAdjacentElement('afterend', categoryEl);
  }
  categoryEl.textContent  = post.category || '';
  categoryEl.style.display = post.category ? '' : 'none';

  // ── Classify files ──
  const ext     = getFileExtension(post.file_name || '');
  const isImage = post.file_type === 'image'  || isImageExtension(ext);
  const isAudio = post.file_type === 'audio'  || isAudioExtension(ext);
  const isVideo = (post.file_type === 'video' || isVideoExtension(ext)) && !isAudio;
  const isMulti = !!(post.files && post.files.length > 1);
  const hasCover = !!post.cover_image_url;

  let visualFiles   = []; // { url, name, type:'image'|'video'|'youtube'|'pdf' }
  let audioFiles    = []; // { url, name }
  let downloadFiles = []; // { url, name }

  if (isMulti) {
    (post.files || []).forEach(f => {
      if      (f.type === 'image' || f.type === 'video') visualFiles.push(f);
      else if (f.type === 'audio') audioFiles.push({ url: f.url, name: f.name });
      else if (isPdfExtension(getFileExtension(f.name || ''))) visualFiles.push({ url: f.url, name: f.name, type: 'pdf' });
      else    downloadFiles.push({ url: f.url, name: f.name });
    });
  } else if (post.file_url) {
    if      (isImage) visualFiles.push({ url: post.file_url, name: post.file_name, type: 'image' });
    else if (isVideo) visualFiles.push({ url: post.file_url, name: post.file_name, type: 'video' });
    else if (isAudio) audioFiles.push({ url: post.file_url, name: post.file_name || 'audio' });
    else if (isPdfExtension(ext)) visualFiles.push({ url: post.file_url, name: post.file_name || 'pdf', type: 'pdf' });
    else              downloadFiles.push({ url: post.file_url, name: post.file_name || 'file' });
  }

  // Cover counts as visual if no real visual files
  const coverAsVisual = hasCover && visualFiles.length === 0 && !post.youtube_url;
  if (coverAsVisual) {
    visualFiles.push({ url: post.cover_image_url, name: 'cover', type: 'image' });
  }

  // YouTube
  const ytId = extractYouTubeId(post.youtube_url || '');
  if (ytId) {
    visualFiles.unshift({ url: ytId, name: 'youtube', type: 'youtube' });
  }

  const hasVisual = visualFiles.length > 0;
  const hasText   = !!getBodyPlainText(post.body) || audioFiles.length > 0 || downloadFiles.length > 0;

  // ── Visual column ──
  const visualInner = document.getElementById('pdVisualInner');
  visualInner.innerHTML = '';
  if (hasVisual) {
    pdVisualNavController = buildPdVisualCarousel(
      visualFiles,
      visualInner,
      document.getElementById('pdVisPrev'),
      document.getElementById('pdVisNext'),
      document.getElementById('pdVisualCounter')
    );
  } else {
    pdVisualNavController = null;
  }

  // ── Text column ──
  const contentCol = document.getElementById('postDetailContent');
  contentCol.innerHTML = '';

  // Download tabs
  if (downloadFiles.length > 0) {
    contentCol.appendChild(createPdDownloadTabBar(downloadFiles));
  }

  // Audio tabs + player
  if (audioFiles.length > 0) {
    contentCol.appendChild(createPdDownloadTabBar(audioFiles));
    initPdAudioPlayer(audioFiles, contentCol);
  }

  // Body text
  if (post.body) {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'post-body post-body-formatted';
    bodyEl.innerHTML  = formatBodyText(post.body);
    contentCol.appendChild(bodyEl);
  }

  // ── Apply layout ──
  applyPdLayout(hasVisual, hasText);

  pdModalInteractionCleanup = initPostDetailInteractions();

  postDetailOverlay.style.display = 'flex';
  loadCommentsForPost(post.id);
  loadConnectedTabs(post);
  scheduleUiStatePersist();
}

async function loadConnectedTabs(post) {
  const tabContainer = document.getElementById('pdThreadTabs');
  tabContainer.innerHTML = '';

  const { data: links, error } = await supabase
    .from('post_links')
    .select('a_post_id, b_post_id')
    .or(`a_post_id.eq.${post.id},b_post_id.eq.${post.id}`)
    .eq('group_id', 'group4');

  if (error || !links || links.length === 0) return;

  const connectedIds = links.map(l =>
    String(l.a_post_id) === String(post.id) ? l.b_post_id : l.a_post_id
  );

  const { data: connectedPosts, error: postsErr } = await supabase
    .from('posts')
    .select('id, title, body, user_id')
    .in('id', connectedIds);

  if (postsErr || !connectedPosts || connectedPosts.length === 0) return;

  const userIds = [...new Set(connectedPosts.map(p => p.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users').select('id, username').in('id', userIds);
    (users || []).forEach(u => { userMap[u.id] = u.username; });
  }

  connectedPosts.forEach(cp => {
    const label = cp.title || cp.body?.slice(0, 30) || userMap[cp.user_id] || 'post';
    const tab = document.createElement('button');
    tab.className   = 'pd-thread-tab';
    tab.textContent = label;
    tab.title       = label;

    tab.addEventListener('click', async () => {
      const { data: fullPost } = await supabase.from('posts').select('*').eq('id', cp.id).single();
      const { data: fullUser } = await supabase.from('users').select('id, username, pfp, pfp_url').eq('id', cp.user_id).single();
      if (fullPost) openPostDetailModal(fullPost, fullUser || {});
    });

    tabContainer.appendChild(tab);
  });
}

function closePostDetailModal() {
  pdPdfRenderToken += 1;
  postDetailOverlay.style.display = 'none';
  document.getElementById('postDetailContent').innerHTML = '';
  commentsList.innerHTML  = '';
  commentInput.value      = '';
  activePostForModal      = null;
  pdVisualNavController   = null;
  pdVisualZoom            = 1;
  pdVisualPanX            = 0;
  pdVisualPanY            = 0;
  pdHoveredRegion         = null;
  if (pdModalInteractionCleanup) {
    pdModalInteractionCleanup();
    pdModalInteractionCleanup = null;
  }
  pdFullscreen            = false;
  scheduleUiStatePersist();
}

// ============================================
// 11. POST EDITING FLOW
// ============================================

function toggleEditMode() {
  editMode = !editMode;
  activeThreadSourcePostId = null;
  activeUserFilter = null;
  activeCategoryFilter = null;
  mainPageContainer.classList.toggle('edit-mode', editMode);
  document.getElementById('editModeBtn')?.classList.toggle('active', editMode);
  if (!editMode) closePostForm();
  loadPosts();
  scheduleUiStatePersist();
}

function openEditForm(post) {
  editingPostId = post.id;
  editingPost   = post; // preserve full row so we can keep untouched file fields
  postTitle.value = post.title || '';
  setPostTextBody(post.body || '');
  postCategory.value = post.category || '';

  // Show what file(s) are currently attached
  if (post.files && post.files.length > 1) {
    postFileName.textContent = `${post.files.length} files attached`;
  } else {
    postFileName.textContent = post.file_name || 'replace file';
  }

  postDeleteBtn.style.display = 'inline-block'; // show in edit mode
  postYoutubeInput.value = post.youtube_url ? `https://youtu.be/${post.youtube_url}` : '';

  const hasNonVisualFile = post.file_url && post.file_type !== 'image' && post.file_type !== 'video';
if (hasNonVisualFile || post.cover_image_url) {
  postCoverImageLabel.style.display = 'block';
  postCoverFileName.textContent = post.cover_image_url
    ? decodeURIComponent(post.cover_image_url.split('/').pop().replace(/^\d+-/, ''))
    : 'choose cover image';
}
  openPostForm();

}

async function handleDeletePost(postId) {
  try {
    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId)
      .eq('user_id', currentUser.id);

    if (error) throw error;

    console.log('Post deleted:', postId);
    await loadPosts();
    await loadLinks();
    renderLinks(lastLoadedPosts, lastLoadedLinks);
  } catch (error) {
    console.error('Delete failed:', error.message);
    alert(`Delete failed: ${error.message}`);
  }
}

// ============================================
// 12. CATEGORY MANAGEMENT
// ============================================

async function loadCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('group_id', 'group4')
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to load categories:', error);
    return;
  }

  postCategory.innerHTML = '<option value="">none</option>';

  data.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat.name;
    option.textContent = cat.name;
    postCategory.appendChild(option);
  });

  console.log(`Loaded ${data.length} categories`);
}

async function handleAddCategory() {
  const name = postCategoryInput.value.trim();
  if (!name) return;

  try {
    const { error } = await supabase
      .from('categories')
      .insert([{ name: name, group_id: 'group4' }]);

    if (error) throw error;

    console.log('Category added:', name);
    await loadCategories();
    postCategory.value = name;

    postCategory.style.display = 'block';
    postCategoryInput.style.display = 'none';
    postCategoryInput.value = '';
    addCategoryToggle.textContent = '+';
  } catch (error) {
    alert(`Failed to add category: ${error.message}`);
  }
}

// ============================================
// 13. POST LINK DATA + SVG RENDERING
// ============================================

async function loadLinks() {
  const { data, error } = await supabase
    .from('post_links')
    .select('id, a_post_id, b_post_id')
    .eq('group_id', 'group4');

  if (error) {
    console.error('Failed to load links:', error);
    lastLoadedLinks = [];
    return [];
  }

  lastLoadedLinks = data || [];
  return lastLoadedLinks;
}

function orthogonalPathD(x1, y1, x2, y2) {
  // Option A: horizontal then vertical
  const d1 = `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
  const len1 = Math.abs(x2 - x1) + Math.abs(y2 - y1);

  // Option B: vertical then horizontal
  const d2 = `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
  const len2 = Math.abs(x2 - x1) + Math.abs(y2 - y1);

  // lengths are the same in this simple case, but we’ll keep structure
  // in case you later add margins/avoidance.
  return (len2 < len1) ? d2 : d1;
}

function getCategoryNetworkColor(categoryName) {
  const key = String(categoryName || '').trim().toLowerCase();
  let hash = 0;

  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }

  const idx = Math.abs(hash) % CATEGORY_NETWORK_PASTELS.length;
  return CATEGORY_NETWORK_PASTELS[idx];
}

function scheduleCategoryNetworkRender(posts, options = {}) {
  const { force = false } = options;
  pendingCategoryNetworkPosts = posts || [];

  if (!force && (isPlacing || resizingPostState)) return;
  if (categoryNetworkRafId) return;

  categoryNetworkRafId = window.requestAnimationFrame(() => {
    categoryNetworkRafId = 0;
    renderCategoryNetworks(pendingCategoryNetworkPosts || []);
  });
}

function renderCategoryNetworks(posts) {
  if (!categoryLayer || !postCanvas) return;
  categoryLayer.innerHTML = '';

  const visiblePosts = (posts || []).filter(p => String(p.category || '').trim());
  if (visiblePosts.length < 2) return;

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  categoryLayer.appendChild(defs);

  const glowFilter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  glowFilter.setAttribute('id', 'category-thread-glow');
  glowFilter.setAttribute('x', '-20%');
  glowFilter.setAttribute('y', '-20%');
  glowFilter.setAttribute('width', '140%');
  glowFilter.setAttribute('height', '140%');

  const glow = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
  glow.setAttribute('dx', '0');
  glow.setAttribute('dy', '0');
  glow.setAttribute('stdDeviation', '1.15');
  glow.setAttribute('flood-color', 'rgba(255, 255, 255, 0.95)');
  glow.setAttribute('flood-opacity', '0.62');
  glowFilter.appendChild(glow);
  defs.appendChild(glowFilter);

  const svgRect = categoryLayer.getBoundingClientRect();
  const groups = new Map();

  for (const post of visiblePosts) {
    const categoryKey = String(post.category || '').trim().toLowerCase();
    if (!groups.has(categoryKey)) {
      groups.set(categoryKey, {
        label: String(post.category || '').trim(),
        posts: []
      });
    }
    groups.get(categoryKey).posts.push(post);
  }

  for (const group of groups.values()) {
    if (!group.posts || group.posts.length < 2) continue;

    const points = [];
    for (const post of group.posts) {
      const cardEl = postCanvas.querySelector(`.post-card[data-post-id="${post.id}"]`);
      if (!cardEl) continue;

      const rect = cardEl.getBoundingClientRect();
      points.push({
        x: ((rect.left + rect.right) / 2) - svgRect.left,
        y: ((rect.top + rect.bottom) / 2) - svgRect.top
      });
    }

    if (points.length < 2) continue;

    const strokeColor = getCategoryNetworkColor(group.label);
    const safeLabel = group.label.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i];
        const b = points[j];

        const gradId = `category-thread-grad-${safeLabel}-${i}-${j}`;
        const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        grad.setAttribute('id', gradId);
        grad.setAttribute('gradientUnits', 'userSpaceOnUse');
        grad.setAttribute('x1', a.x);
        grad.setAttribute('y1', a.y);
        grad.setAttribute('x2', b.x);
        grad.setAttribute('y2', b.y);

        const stopStart = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stopStart.setAttribute('offset', '0%');
        stopStart.setAttribute('stop-color', strokeColor);
        stopStart.setAttribute('stop-opacity', '0.0');

        const stopRise = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stopRise.setAttribute('offset', '18%');
        stopRise.setAttribute('stop-color', strokeColor);
        stopRise.setAttribute('stop-opacity', '0.4');

        const stopMid = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stopMid.setAttribute('offset', '50%');
        stopMid.setAttribute('stop-color', strokeColor);
        stopMid.setAttribute('stop-opacity', '1');

        const stopFall = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stopFall.setAttribute('offset', '82%');
        stopFall.setAttribute('stop-color', strokeColor);
        stopFall.setAttribute('stop-opacity', '0.4');

        const stopEnd = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stopEnd.setAttribute('offset', '100%');
        stopEnd.setAttribute('stop-color', strokeColor);
        stopEnd.setAttribute('stop-opacity', '0.0');

        grad.appendChild(stopStart);
        grad.appendChild(stopRise);
        grad.appendChild(stopMid);
        grad.appendChild(stopFall);
        grad.appendChild(stopEnd);
        defs.appendChild(grad);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${a.x} ${a.y} L ${b.x} ${b.y}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', `url(#${gradId})`);
        path.setAttribute('stroke-width', '1.95');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('filter', 'url(#category-thread-glow)');
        path.style.pointerEvents = 'none';
        categoryLayer.appendChild(path);
      }
    }
  }
}

function renderLinks(posts, links) {
  if (!linkLayer || !postCanvas) return;
  scheduleCategoryNetworkRender(posts);
  linkLayer.innerHTML = '';

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  linkLayer.appendChild(defs);

  const postGlowFilter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  postGlowFilter.setAttribute('id', 'post-thread-glow');
  postGlowFilter.setAttribute('x', '-20%');
  postGlowFilter.setAttribute('y', '-20%');
  postGlowFilter.setAttribute('width', '140%');
  postGlowFilter.setAttribute('height', '140%');

  const postGlow = document.createElementNS('http://www.w3.org/2000/svg', 'feDropShadow');
  postGlow.setAttribute('dx', '0');
  postGlow.setAttribute('dy', '0');
  postGlow.setAttribute('stdDeviation', '1.15');
  postGlow.setAttribute('flood-color', 'rgba(255, 255, 255, 0.95)');
  postGlow.setAttribute('flood-opacity', '0.62');
  postGlowFilter.appendChild(postGlow);
  defs.appendChild(postGlowFilter);

  const postsById = new Map((posts || []).map(p => [String(p.id), p]));
  const allowedIds = new Set((posts || []).map(p => String(p.id)));
  const svgRect = linkLayer.getBoundingClientRect();

  function clampToEdge(rect, viewportRect, px, py) {
    const l = rect.left - viewportRect.left;
    const r = rect.right - viewportRect.left;
    const t = rect.top - viewportRect.top;
    const b = rect.bottom - viewportRect.top;

    const cx = Math.max(l, Math.min(r, px));
    const cy = Math.max(t, Math.min(b, py));

    const dLeft = Math.abs(cx - l);
    const dRight = Math.abs(cx - r);
    const dTop = Math.abs(cy - t);
    const dBottom = Math.abs(cy - b);
    const minD = Math.min(dLeft, dRight, dTop, dBottom);

    if (minD === dLeft) return { x: l, y: cy };
    if (minD === dRight) return { x: r, y: cy };
    if (minD === dTop) return { x: cx, y: t };
    return { x: cx, y: b };
  }

  for (const link of (links || [])) {
    const aId = String(link.a_post_id);
    const bId = String(link.b_post_id);

    if (!allowedIds.has(aId) || !allowedIds.has(bId)) continue;

    const a = postsById.get(aId);
    const b = postsById.get(bId);
    if (!a || !b) continue;

    const aEl = postCanvas.querySelector(`.post-card[data-post-id="${a.id}"]`);
    const bEl = postCanvas.querySelector(`.post-card[data-post-id="${b.id}"]`);
    if (!aEl || !bEl) continue;

    const aRect = aEl.getBoundingClientRect();
    const bRect = bEl.getBoundingClientRect();

    const aCx = (aRect.left + aRect.right) / 2 - svgRect.left;
    const aCy = (aRect.top + aRect.bottom) / 2 - svgRect.top;
    const bCx = (bRect.left + bRect.right) / 2 - svgRect.left;
    const bCy = (bRect.top + bRect.bottom) / 2 - svgRect.top;

    const p1 = clampToEdge(aRect, svgRect, bCx, bCy);
    const p2 = clampToEdge(bRect, svgRect, aCx, aCy);

    const d = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;

    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hit.classList.add('link-hit');
    hit.setAttribute('d', d);
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'rgba(0,0,0,0)');
    hit.setAttribute('stroke-width', '14');
    hit.style.pointerEvents = 'stroke';
    hit.style.cursor = 'pointer';

    hit.addEventListener('click', (e) => {
      e.stopPropagation();

      if (activeLinkTreeRootPostId === aId || activeLinkTreeRootPostId === bId) {
        activeLinkTreeRootPostId = null;
      } else {
        activeUserFilter = null;
        activeCategoryFilter = null;
        activeLinkTreeRootPostId = aId;
      }

      loadPosts();
    });

    linkLayer.appendChild(hit);

    const gradId = `link-grad-${link.id || `${aId}-${bId}`}`;
    const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.setAttribute('id', gradId);
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    grad.setAttribute('x1', p1.x);
    grad.setAttribute('y1', p1.y);
    grad.setAttribute('x2', p2.x);
    grad.setAttribute('y2', p2.y);

    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', 'rgba(0,0,0,0.78)');
    stop1.setAttribute('stop-opacity', '0.0');

    const stopMid = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stopMid.setAttribute('offset', '50%');
    stopMid.setAttribute('stop-color', 'rgba(0,0,0,0.78)');
    stopMid.setAttribute('stop-opacity', '1');

    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', 'rgba(0,0,0,0.78)');
    stop2.setAttribute('stop-opacity', '0.0');

    grad.appendChild(stop1);
    grad.appendChild(stopMid);
    grad.appendChild(stop2);
    defs.appendChild(grad);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', `url(#${gradId})`);
    path.setAttribute('stroke-width', '1.95');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-dasharray', '28 10 20 22 6 12 30 8 10 16');
    path.setAttribute('stroke-dashoffset', '0');
    path.setAttribute('filter', 'url(#post-thread-glow)');
    path.style.animation = 'link-flow 9s linear infinite';
    path.style.pointerEvents = 'none';
    linkLayer.appendChild(path);
  }
}

// ============================================
// 14. NOTIFICATIONS
// ============================================

const MAX_NOTIFICATIONS = 40;

async function loadNotifications() {
  if (!currentUser) return;

  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, post_id, actor_user_id, created_at')
    .eq('recipient_user_id', currentUser.id)
    .eq('group_id', 'group4')
    .order('created_at', { ascending: false })
    .limit(MAX_NOTIFICATIONS);

  if (error) {
    console.error('Failed to load notifications:', error);
    return;
  }

  if (!data || data.length === 0) {
    notifList.innerHTML = `<div class="notif-empty">no notifications</div>`;
    return;
  }

  // Fetch actor usernames
  const actorIds = [...new Set(data.map(n => n.actor_user_id).filter(Boolean))];
  let actorMap = {};
  if (actorIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, username')
      .in('id', actorIds);
    (users || []).forEach(u => { actorMap[u.id] = u.username; });
  }

  notifList.innerHTML = '';

  data.forEach(n => {
    const actor = actorMap[n.actor_user_id] || 'someone';
    const text  = n.type === 'comment'
      ? 'commented on your post'
      : 'connected a thread to your post';
    const stamp = formatTimestamp(n.created_at);

    const item = document.createElement('div');
    item.className = 'notif-item';
    item.innerHTML = `
      <div class="notif-actor">${actor}</div>
      <div class="notif-text">${text}</div>
      <div class="notif-time">${stamp}</div>
    `;

    item.addEventListener('click', async () => {
      // Load the related post and open its detail modal
      const { data: post, error: postErr } = await supabase
        .from('posts')
        .select('*')
        .eq('id', n.post_id)
        .single();

      if (postErr || !post) return;

      const { data: userData } = await supabase
        .from('users')
        .select('id, username, pfp, pfp_url')
        .eq('id', post.user_id)
        .single();

      openPostDetailModal(post, userData || {});
    });

    notifList.appendChild(item);
  });
}


// ============================================
// 15. PROFILE MODAL FLOW
// ============================================

async function openProfileModal(userId) {
  if (!userId) return;
  currentProfileUserId = userId;
  profileEditMode     = false;
  newProfileCoverFile = null;
  newProfilePfpFile   = null;

  const { data: user, error } = await supabase
    .from('users').select('*').eq('id', userId).single();
  if (error || !user) return;

  const isOwnProfile = currentUser && userId === currentUser.id;

  // ── Cover ──
  const coverImg         = document.getElementById('profileCoverImg');
  const coverPlaceholder = document.getElementById('profileCoverPlaceholder');
  const coverOverlay     = document.getElementById('profileCoverOverlay');

  if (user.cover_image_url) {
    coverImg.src           = user.cover_image_url;
    coverImg.style.display = 'block';
    coverPlaceholder.style.display = 'none';
  } else {
    coverImg.style.display         = 'none';
    coverPlaceholder.style.display = 'block';
  }
  coverOverlay.style.display = 'none';

  // ── PFP ──
  const pfpWidget  = document.getElementById('profilePfpWidget');
  const pfpOverlay = document.getElementById('profilePfpOverlay');
  pfpWidget.innerHTML = '';
  const pfpFallback = './images/pfps/default.webp';
  const pfpSrc = user.pfp_url || (user.pfp ? `./images/pfps/${user.pfp}` : pfpFallback);
  const img = document.createElement('img');
  img.src = pfpSrc;
  img.style.cssText = 'width:60px;height:60px;object-fit:cover;display:block;';
  pfpWidget.appendChild(img);
  pfpOverlay.style.display = 'none';

  // ── Username ──
  const usernameSpan  = document.getElementById('profileUsername');
  const usernameInput = document.getElementById('profileUsernameInput');
  usernameSpan.textContent  = user.username;
  usernameSpan.style.display  = 'inline';
  usernameInput.value         = user.username;
  usernameInput.style.display = 'none';

  // ── Save btn ──
  document.getElementById('profileSaveBtn').style.display = 'none';

  // ── Posts ──
  const postsList = document.getElementById('profilePostsList');
  postsList.innerHTML = '';

  const { data: posts } = await supabase
    .from('posts')
    .select('id, title, body, file_name')
    .eq('user_id', userId)
    .eq('group_id', 'group4')
    .order('created_at', { ascending: false });

  if (posts && posts.length > 0) {
    posts.forEach(p => {
      const label = p.title || p.body?.slice(0, 60) || p.file_name || 'untitled';
      const item = document.createElement('div');
      item.className    = 'profile-post-item';
      item.textContent  = label;

      item.addEventListener('click', async () => {
        const { data: fullPost } = await supabase
          .from('posts').select('*').eq('id', p.id).single();
        if (fullPost) openPostDetailModal(fullPost, user);
      });

      postsList.appendChild(item);
    });
  } else {
    postsList.innerHTML = '<div style="color:rgba(255,255,255,0.2);font-size:0.8rem;padding:10px 0;">no posts yet</div>';
  }

  // ── Edit mode (own profile only, triggered by right-click) ──
  const profileModal = document.getElementById('profileModal');

    let lastProfileRightClick = 0;

  profileModal.oncontextmenu = (e) => {
    if (!isOwnProfile) return;
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    const timeSince = now - lastProfileRightClick;
    lastProfileRightClick = now;

    if (timeSince < DOUBLE_CLICK_THRESHOLD) {
      lastProfileRightClick = 0;
      profileEditMode = !profileEditMode;

      coverOverlay.style.display  = profileEditMode ? 'flex'         : 'none';
      pfpOverlay.style.display    = profileEditMode ? 'flex'         : 'none';
      usernameSpan.style.display  = profileEditMode ? 'none'         : 'inline';
      usernameInput.style.display = profileEditMode ? 'inline'       : 'none';
      document.getElementById('profileSaveBtn').style.display = profileEditMode ? 'inline-block' : 'none';
    }
    // single right-click inside profile does nothing
  };
    profileOverlay.classList.add('open');
  document.body.classList.add('profile-open');
  scheduleUiStatePersist();
}

function closeProfileModal() {
  profileOverlay.classList.remove('open');
  document.body.classList.remove('profile-open');
  profileEditMode     = false;
  newProfileCoverFile = null;
  newProfilePfpFile   = null;
  currentProfileUserId = null;
  scheduleUiStatePersist();
}

async function saveProfileChanges() {
  if (!currentProfileUserId) return;

  const updates = {};

  // Username
  const usernameInput = document.getElementById('profileUsernameInput');
  const newUsername = usernameInput.value.trim();
  if (!newUsername || newUsername.length > 12) {
    alert('Username must be 1–12 characters'); return;
  }

  // Check uniqueness only if changed
  const { data: currentUserRow } = await supabase
    .from('users').select('username').eq('id', currentProfileUserId).single();
  if (newUsername !== currentUserRow?.username) {
    const { data: taken } = await supabase
      .from('users').select('id').eq('username', newUsername).maybeSingle();
    if (taken) { alert('Username already taken'); return; }
    updates.username = newUsername;
  }

  // New cover image
  if (newProfileCoverFile) {
    const path = `covers/${currentProfileUserId}-${Date.now()}.${newProfileCoverFile.name.split('.').pop()}`;
    const { error: upErr } = await supabase.storage
      .from('group4-pfps').upload(path, newProfileCoverFile);
    if (upErr) { alert('Cover upload failed'); return; }
    const { data: urlData } = supabase.storage.from('group4-pfps').getPublicUrl(path);
    updates.cover_image_url = urlData.publicUrl;
  }

  // New pfp
  if (newProfilePfpFile) {
    const ext  = newProfilePfpFile.name.split('.').pop() || 'webp';
    const path = `${currentProfileUserId}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('group4-pfps').upload(path, newProfilePfpFile);
    if (upErr) { alert('PFP upload failed'); return; }
    const { data: urlData } = supabase.storage.from('group4-pfps').getPublicUrl(path);
    updates.pfp_url = urlData.publicUrl;
    updates.pfp     = null;
  }

  if (Object.keys(updates).length === 0) {
    closeProfileModal(); return;
  }

  updates.updated_at = new Date();
  const { error } = await supabase
    .from('users').update(updates).eq('id', currentProfileUserId);
  if (error) { alert(`Save failed: ${error.message}`); return; }

  // Refresh current user data if it's their own profile
  if (currentProfileUserId === currentUser?.id) {
    currentUserData = { ...currentUserData, ...updates };
  }

  closeProfileModal();
  await loadPosts();
  renderLinks(lastLoadedPosts, lastLoadedLinks);
}
// ============================================
// 16. POST SUBMISSION FLOW
// ============================================


async function handlePostSubmit() {
  if (postSubmitBtn.disabled) return; // prevent double-submit

  const title     = postTitle.value.trim();
  const body      = getPostTextBody();
  const category  = postCategory.value || null;
  const fileList  = [...postFileInput.files];
  const isMulti   = fileList.length > 1;
  const coverFile = postCoverImageInput.files[0] || null;
  const youtubeInputValue = postYoutubeInput.value.trim();
  const youtubeId = extractYouTubeId(youtubeInputValue) || null;

  if (youtubeInputValue && !youtubeId) {
    alert('Enter a valid YouTube URL');
    return;
  }

  const hasExistingFile = Boolean(
    editingPost && (editingPost.file_url || (editingPost.files && editingPost.files.length > 0))
  );
  const hasExistingYoutube = Boolean(editingPost && editingPost.youtube_url && !youtubeInputValue);

  if (!title && fileList.length === 0 && !getBodyPlainText(body) && !youtubeId && !hasExistingFile && !hasExistingYoutube) {
    alert('Add a title, text, choose a file, or paste a YouTube URL');
    return;
  }

  // Client-side file size check (Supabase free tier = 50 MB per file)
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  for (const file of fileList) {
    if (file.size > MAX_FILE_SIZE) {
      alert(`"${file.name}" is too large — max 50 MB per file.`);
      return;
    }
  }

  postSubmitBtn.disabled    = true;
  postSubmitBtn.textContent = '...';

  try {

    let fileURL = null, fileName = null, fileType = null;
    let filesArray = null;

    if (fileList.length === 1) {
      const file = fileList[0];
      fileName = file.name;
      fileType = await getFileType(file);
      const filePath = `${currentUser.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('group4-posts').upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from('group4-posts').getPublicUrl(filePath);
      fileURL = urlData.publicUrl;

    } else if (isMulti) {
      filesArray = [];
      for (const file of fileList) {
        const ft = await getFileType(file);
        const filePath = `${currentUser.id}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('group4-posts').upload(filePath, file);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage
          .from('group4-posts').getPublicUrl(filePath);
        filesArray.push({ url: urlData.publicUrl, name: file.name, type: ft });
      }
    }


    // Auto-cover: if multi-file and no manual cover chosen, use first visual file's URL
    let autoCoverUrl = null;
    if (isMulti && !coverFile && filesArray) {
      const firstVisual = filesArray.find(f => f.type === 'image' || f.type === 'video');
      if (firstVisual) autoCoverUrl = firstVisual.url;
    }

    let coverImageURL = null;
    if (coverFile) {
      const coverPath = `${currentUser.id}/covers/${Date.now()}-${coverFile.name}`;
      const { error: coverError } = await supabase.storage
        .from('group4-posts').upload(coverPath, coverFile);
      if (coverError) throw coverError;
      const { data: coverUrlData } = supabase.storage
        .from('group4-posts').getPublicUrl(coverPath);
      coverImageURL = coverUrlData.publicUrl;
    }

    const postRecord = {
      title:       title    || null,
      body:        body     || null,
      category:    category || null,
      youtube_url: youtubeId,
    };

    if (fileList.length === 1) {
      // User chose a new single file — replace everything
      postRecord.file_url  = fileURL;
      postRecord.file_name = fileName;
      postRecord.file_type = fileType;
      postRecord.files     = null;
    } else if (isMulti) {
      // User chose multiple new files — replace everything
      postRecord.files     = filesArray;
      postRecord.file_url  = null;
      postRecord.file_name = null;
      postRecord.file_type = null;
    } else if (editingPostId && editingPost) {
      // Edit with no new file chosen — preserve whatever was already there
      postRecord.file_url  = editingPost.file_url  ?? null;
      postRecord.file_name = editingPost.file_name ?? null;
      postRecord.file_type = editingPost.file_type ?? null;
      postRecord.files     = editingPost.files     ?? null;
    } else {
      // New post with no file
      postRecord.file_url  = null;
      postRecord.file_name = null;
      postRecord.file_type = null;
      postRecord.files     = null;
    }

    // Cover image: use new upload, or auto-cover, or preserve existing on edit
    if (coverImageURL) {
      postRecord.cover_image_url = coverImageURL;
    } else if (autoCoverUrl) {
      postRecord.cover_image_url = autoCoverUrl;
    } else if (editingPostId && editingPost) {
      postRecord.cover_image_url = editingPost.cover_image_url ?? null;
    }

    // ── EDIT ──
    if (editingPostId) {
      await updatePost(editingPostId, postRecord);
      closePostForm();
      await loadPosts();
      await loadLinks();
      renderLinks(lastLoadedPosts, lastLoadedLinks);
      return;
    }

    // ── CREATE ──
    postRecord.user_id  = currentUser.id;
    postRecord.group_id = 'group4';

    const created = await savePost(postRecord);

    if (pendingLinkPostId) {
      const a = String(pendingLinkPostId);
      const b = String(created.id);
      const a_post_id = a < b ? a : b;
      const b_post_id = a < b ? b : a;
      const { error: linkErr } = await supabase
        .from('post_links')
        .insert([{ group_id: 'group4', a_post_id, b_post_id, created_by: currentUser.id }]);
      if (linkErr) console.error('Failed to create link:', linkErr);
    }

    closePostForm();
    await loadPosts();
    await loadLinks();
    renderLinks(lastLoadedPosts, lastLoadedLinks);

    const createdEl = postCanvas.querySelector(`.post-card[data-post-id="${created.id}"]`);
    if (createdEl) {
      await waitForCardMedia(createdEl);
      startPlacement(created, createdEl,
        window.__lastMouseEventForPlacement || { clientX: 200, clientY: 200 });
    }
   } catch (error) {
    console.error('Post submission failed:', error?.message || error);
    alert(`Post failed: ${error?.message || error}`);
  } finally {
    postSubmitBtn.disabled    = false;
    postSubmitBtn.textContent = 'submit';
  }
}

async function finalizeCoverImagePromptSave(saved, isEdit) {
  closeCoverImagePrompt();
  await loadPosts();
  await loadLinks();
  renderLinks(lastLoadedPosts, lastLoadedLinks);

  if (!isEdit && saved) {
    const createdEl = postCanvas.querySelector(`.post-card[data-post-id="${saved.id}"]`);
    if (createdEl) {
      await waitForCardMedia(createdEl);
      startPlacement(saved, createdEl, window.__lastMouseEventForPlacement || { clientX: 200, clientY: 200 });
    }
  }
}

// ============================================
// 17. COVER IMAGE PROMPT FLOW
// ============================================

async function handleCoverImageSubmit() {
  if (!pendingPost) return;

  const coverFile = coverImageInput.files[0];
  if (!coverFile) { alert('Choose an image or click skip'); return; }

  try {
    const filePath = `${currentUser.id}/covers/${Date.now()}-${coverFile.name}`;
    const { error: uploadError } = await supabase.storage.from('group4-posts').upload(filePath, coverFile);
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('group4-posts').getPublicUrl(filePath);
    pendingPost.cover_image_url = urlData.publicUrl;

    const isEdit = pendingPost._isEdit;
    const editId = pendingPost._editId;
    if (isEdit) { delete pendingPost._isEdit; delete pendingPost._editId; }

    const saved = isEdit ? await updatePost(editId, pendingPost) : await savePost(pendingPost);

    await finalizeCoverImagePromptSave(saved, isEdit);
  } catch (error) {
    console.error('Cover image upload failed:', error.message);
    alert(`Cover image failed: ${error.message}`);
  }
}

async function handleCoverImageSkip() {
  if (!pendingPost) return;

  try {
    const isEdit = pendingPost._isEdit;
    const editId = pendingPost._editId;
    if (isEdit) { delete pendingPost._isEdit; delete pendingPost._editId; }

    const saved = isEdit ? await updatePost(editId, pendingPost) : await savePost(pendingPost);

    await finalizeCoverImagePromptSave(saved, isEdit);
  } catch (error) {
    console.error('Post save failed:', error.message);
    alert(`Post failed: ${error.message}`);
  }
}

// ============================================
// 18. POST PERSISTENCE
// ============================================

async function savePost(postRecord) {
  const { data, error } = await supabase
    .from('posts')
    .insert([postRecord])
    .select();

  if (error) throw error;

  console.log('Post saved:', data?.[0]?.id);
  return data?.[0];
}

async function updatePost(postId, updates) {
  let query = supabase
    .from('posts')
    .update(updates)
    .eq('id', postId);

  if (!currentUserData?.is_admin) {
    query = query.eq('user_id', currentUser.id);
  }

  const { data, error } = await query.select();
  if (error) throw error;
  return data?.[0];
}

// ============================================
// 19. COMMENTS FLOW
// ============================================

async function loadCommentsForPost(postId) {
  const { data: comments, error } = await supabase
    .from('comments')
    .select('id, body, created_at, user_id')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to load comments:', error);
    commentsList.innerHTML = `<div style="opacity:0.7;">failed to load comments</div>`;
    return;
  }

  const commentUserIds = [...new Set((comments || []).map(c => c.user_id).filter(Boolean))];

  let commentUsers = [];
  if (commentUserIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, username, pfp, pfp_url')
      .in('id', commentUserIds);

    if (usersError) {
      console.error('Failed to load comment users:', usersError);
    } else {
      commentUsers = users || [];
    }
  }

  const commentUserMap = {};
  commentUsers.forEach(u => { commentUserMap[u.id] = u; });

  commentsList.innerHTML = '';

  if (!comments || comments.length === 0) {
    commentsList.innerHTML = `<div style="opacity:0.7;">no comments yet</div>`;
    return;
  }

  comments.forEach(c => {
    const row = document.createElement('div');
    row.className = 'comment-row';

    const u = commentUserMap[c.user_id];
    const uname = u?.username || 'unknown';
    const pfpSrc = u?.pfp_url || (u?.pfp ? `./images/pfps/${u.pfp}` : './images/pfps/default.png');
    const isOwn = currentUser && c.user_id === currentUser.id;
    const stamp = formatTimestamp(c.created_at);

    row.innerHTML = `
      <div class="comment-header">
        <img class="comment-pfp" src="${pfpSrc}" alt="">
        <span class="comment-username">${uname}</span>
        <span class="comment-time">${stamp}</span>
      </div>
      <div class="comment-body">${c.body}</div>
    `;

    // Double right-click to edit/delete own comments
    if (isOwn) {
      let lastRightClickComment = 0;

      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const now = Date.now();
        const timeSince = now - lastRightClickComment;
        lastRightClickComment = now;

        if (timeSince < DOUBLE_CLICK_THRESHOLD) {
          lastRightClickComment = 0;
          openCommentEditMode(row, c);
        }
      });
    }

    commentsList.appendChild(row);
  });
}

function openCommentEditMode(row, comment) {
  // Prevent double-opening
  if (row.querySelector('.comment-edit-input')) return;

  const bodyEl = row.querySelector('.comment-body');
  const originalText = bodyEl.textContent;

  // Replace body with an inline input + save/delete buttons
  bodyEl.style.display = 'none';

  const input = document.createElement('textarea');
  input.className = 'comment-edit-input';
  input.value = originalText;

  const actions = document.createElement('div');
  actions.className = 'comment-edit-actions';
  actions.innerHTML = `
    <button class="comment-edit-save">save</button>
    <button class="comment-edit-delete">delete</button>
  `;

  row.appendChild(input);
  row.appendChild(actions);
  input.focus();
  input.select();

  // Cancel — restore original view
    // Double right-click on the row closes edit mode
  let lastRightClickEdit = 0;
  const cancelEdit = () => {
    input.remove();
    actions.remove();
    bodyEl.style.display = '';
    row.removeEventListener('contextmenu', editContextHandler);
  };
  const editContextHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    const timeSince = now - lastRightClickEdit;
    lastRightClickEdit = now;
    if (timeSince < DOUBLE_CLICK_THRESHOLD) {
      lastRightClickEdit = 0;
      cancelEdit();
    }
  };
  row.addEventListener('contextmenu', editContextHandler);

  // Save — update in DB then reload
  actions.querySelector('.comment-edit-save').addEventListener('click', async () => {
    const newText = input.value.trim();
    if (!newText) return;
    const { error } = await supabase
      .from('comments')
      .update({ body: newText })
      .eq('id', comment.id)
      .eq('user_id', currentUser.id);
    if (error) { alert(`Save failed: ${error.message}`); return; }
    await loadCommentsForPost(activePostForModal.id);
  });

  // Delete — remove from DB then reload
  actions.querySelector('.comment-edit-delete').addEventListener('click', async () => {
    const { error } = await supabase
      .from('comments')
      .delete()
      .eq('id', comment.id)
      .eq('user_id', currentUser.id);
    if (error) { alert(`Delete failed: ${error.message}`); return; }
    await loadCommentsForPost(activePostForModal.id);
  });

  // Enter = save, Escape = cancel
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      actions.querySelector('.comment-edit-save').click();
    }
        if (e.key === 'Escape') {
      cancelEdit();
    }
  });
}


async function submitComment() {
  if (!activePostForModal) return;

  const text = commentInput.value.trim();
  if (!text) return;

  const { error } = await supabase
    .from('comments')
    .insert([{
      post_id: activePostForModal.id,
      user_id: currentUser.id,
      body: text
    }]);

  if (error) {
    console.error('Failed to post comment:', error);
    alert(`Comment failed: ${error.message}`);
    return;
  }

  commentInput.value = '';
  await loadCommentsForPost(activePostForModal.id);

  postDetailModal.scrollTop = postDetailModal.scrollHeight;
}

// ============================================
// 20. POST LOADING + CANVAS RENDERING
// ============================================
async function loadPosts() {
  try {
    let query = supabase
      .from('posts')
      .select('*')
      .eq('group_id', 'group4')
      .order('created_at', { ascending: false });

    if (!editMode) {
      // NOTE: tree filter is exclusive, but we do NOT clear it here.
      // We clear it only when user clicks category/username (in those handlers),
      // or when they click empty background (optional).
      if (activeUserFilter) {
        query = query.eq('user_id', activeUserFilter);
      }
      if (activeCategoryFilter) {
        if (activeCategoryFilter === NONE_CATEGORY_FILTER) {
          query = query.is('category', null);
        } else {
          query = query.eq('category', activeCategoryFilter);
        }
      }
    }

    const { data: posts, error } = await query;

    if (error) {
      console.error('Failed to load posts:', error);
      return;
    }

    // Store + apply tree filter (exclusive)
    lastLoadedPosts = posts || [];

    if (
      activeThreadSourcePostId &&
      !lastLoadedPosts.some(p => String(p.id) === String(activeThreadSourcePostId))
    ) {
      activeThreadSourcePostId = null;
    }

    if (activeLinkTreeRootPostId) {
      const allowed = getConnectedComponent(activeLinkTreeRootPostId, lastLoadedLinks);
      lastLoadedPosts = lastLoadedPosts.filter(p => allowed.has(String(p.id)));
    }

    // Build user map based on *visible* posts (so you don't fetch unused users)
    const userIds = [...new Set((lastLoadedPosts || []).map(p => p.user_id).filter(Boolean))];

    let users = [];
    if (userIds.length > 0) {
      const { data, error: usersError } = await supabase
        .from('users')
        .select('id, username, pfp, pfp_url')
        .in('id', userIds);

      if (usersError) {
        console.error('Failed to load users:', usersError);
        return;
      }
      users = data || [];
    }

    const userMap = {};
    users.forEach(u => { userMap[u.id] = u; });

    if (!postCanvas) {
      console.error('postCanvas element not found. Check your HTML wrapper.');
      return;
    }

    postCanvas.innerHTML = '';
    buildPostCard._indexCounter = 0;

    // IMPORTANT: render from lastLoadedPosts (filtered), not posts
    (lastLoadedPosts || []).forEach(post => {
      const user = userMap[post.user_id] || {};
      const card = buildPostCard(post, user);
      postCanvas.appendChild(card);
    });

    console.log(`Loaded ${lastLoadedPosts?.length || 0} posts`);

    renderLinks(lastLoadedPosts, lastLoadedLinks);
    scheduleUiStatePersist();
  } catch (err) {
    console.error('loadPosts crashed:', err);
  }
}



function trapScrollInside(el) {
  if (!el) return;

  el.addEventListener('wheel', (e) => {
    if (isPlacing) return; // let canvas zoom handle it during placement
    const canScroll = el.scrollHeight > el.clientHeight;
    if (!canScroll) return;

    e.stopPropagation();

    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    const scrollingUp = e.deltaY < 0;
    const scrollingDown = e.deltaY > 0;

    if ((scrollingUp && !atTop) || (scrollingDown && !atBottom)) {
      e.preventDefault();
      el.scrollTop += e.deltaY;
    } else {
      /* still prevent canvas zoom when hovering text */
      e.preventDefault();
    }
  }, { passive: false });
}

// ============================================
// 21. FILE PREVIEW HELPERS
// ============================================

function getFileExtension(filename = '') {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function isImageExtension(ext) {
  return [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
    'heif', 'avif', 'svg'
  ].includes(ext);
}

function isAudioExtension(ext) {
  return [
    'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'oga'
  ].includes(ext);
}

function isVideoExtension(ext) {
  return [
    'mp4', 'mov', 'webm', 'm4v', 'ogv'
  ].includes(ext);
}

function isPdfExtension(ext) {
  return ext === 'pdf';
}

function isVisualExtension(ext) {
  return isImageExtension(ext) || isVideoExtension(ext);
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPdVisualPanLimits(visualInner, imageEl) {
  if (!visualInner || !imageEl) return { maxX: 0, maxY: 0 };

  const baseW = imageEl.offsetWidth;
  const baseH = imageEl.offsetHeight;
  const viewportW = visualInner.clientWidth;
  const viewportH = visualInner.clientHeight;

  const zoomedW = baseW * pdVisualZoom;
  const zoomedH = baseH * pdVisualZoom;

  return {
    maxX: Math.max(0, (zoomedW - viewportW) / 2),
    maxY: Math.max(0, (zoomedH - viewportH) / 2)
  };
}

function clampPdVisualPan(visualInner, imageEl) {
  const { maxX, maxY } = getPdVisualPanLimits(visualInner, imageEl);
  pdVisualPanX = clampValue(pdVisualPanX, -maxX, maxX);
  pdVisualPanY = clampValue(pdVisualPanY, -maxY, maxY);
}

function applyPdVisualZoom(visualInner) {
  if (!visualInner) return;
  const imageEl = visualInner.querySelector('.pd-visual-img');
  if (!imageEl) return;

  clampPdVisualPan(visualInner, imageEl);

  imageEl.style.transformOrigin = 'center center';
  imageEl.style.transform = `translate(${pdVisualPanX}px, ${pdVisualPanY}px) scale(${pdVisualZoom})`;
  imageEl.classList.toggle('pd-visual-img-draggable', pdVisualZoom > 1);
}

function adjustPdVisualZoom(delta, visualInner, anchorClientX = null, anchorClientY = null) {
  if (!visualInner) return;
  const imageEl = visualInner.querySelector('.pd-visual-img');
  if (!imageEl) return;

  const oldScale = pdVisualZoom;
  const next = clampValue(pdVisualZoom + delta, PD_MIN_ZOOM, PD_MAX_ZOOM);
  if (next === oldScale) return;

  if (anchorClientX != null && anchorClientY != null) {
    const rect = visualInner.getBoundingClientRect();
    const px = anchorClientX - rect.left;
    const py = anchorClientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const zoomRatio = next / oldScale;
    pdVisualPanX = (1 - zoomRatio) * (px - cx) + zoomRatio * pdVisualPanX;
    pdVisualPanY = (1 - zoomRatio) * (py - cy) + zoomRatio * pdVisualPanY;
  }

  pdVisualZoom = next;

  if (pdVisualZoom <= PD_MIN_ZOOM) {
    pdVisualPanX = 0;
    pdVisualPanY = 0;
  }

  clampPdVisualPan(visualInner, imageEl);
  applyPdVisualZoom(visualInner);
}

async function renderPdPdfViewer(file, inner) {
  const token = ++pdPdfRenderToken;

  inner.innerHTML = `
    <div class="pd-pdf-shell">
      <div class="pd-pdf-toolbar">
        <button class="pd-pdf-btn" data-action="prev">‹</button>
        <span class="pd-pdf-page-indicator">1 / 1</span>
        <button class="pd-pdf-btn" data-action="next">›</button>
        <button class="pd-pdf-btn pd-pdf-print" data-action="print">print</button>
      </div>
      <div class="pd-pdf-body">
        <div class="pd-pdf-thumbs"></div>
        <div class="pd-pdf-pages"></div>
      </div>
    </div>
  `;

  const toolbar = inner.querySelector('.pd-pdf-toolbar');
  const pageIndicator = inner.querySelector('.pd-pdf-page-indicator');
  const thumbsEl = inner.querySelector('.pd-pdf-thumbs');
  const pagesEl = inner.querySelector('.pd-pdf-pages');
  if (!toolbar || !pageIndicator || !thumbsEl || !pagesEl) return;

  let totalPages = 0;
  let activePage = 1;
  const pageEls = [];
  const thumbBtns = [];

  const updateActivePage = (nextPage) => {
    const clamped = clampValue(nextPage, 1, Math.max(1, totalPages));
    activePage = clamped;
    pageIndicator.textContent = `${activePage} / ${Math.max(1, totalPages)}`;

    thumbBtns.forEach((btn, idx) => {
      const isActive = idx + 1 === activePage;
      btn.classList.toggle('active', isActive);
    });
  };

  const jumpToPage = (pageNum) => {
    const target = pageEls[pageNum - 1];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateActivePage(pageNum);
  };

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    if (action === 'prev') jumpToPage(activePage - 1);
    if (action === 'next') jumpToPage(activePage + 1);
    if (action === 'print') {
      const popup = window.open(file.url, '_blank', 'noopener,noreferrer');
      if (popup) popup.focus();
    }
  });

  try {
    const loadingTask = pdfjsLib.getDocument({ url: file.url, withCredentials: false });
    const pdfDoc = await loadingTask.promise;
    if (token !== pdPdfRenderToken) return;

    totalPages = pdfDoc.numPages;
    updateActivePage(1);

    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
      const page = await pdfDoc.getPage(pageNum);
      if (token !== pdPdfRenderToken) return;

      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = Math.max(560, (pagesEl.clientWidth || 860) - 32);
      const pageScale = clampValue(targetWidth / baseViewport.width, 0.65, 2.1);
      const viewport = page.getViewport({ scale: pageScale });

      const pageWrap = document.createElement('div');
      pageWrap.className = 'pd-pdf-page';
      pageWrap.dataset.page = String(pageNum);

      const pageCanvas = document.createElement('canvas');
      pageCanvas.className = 'pd-pdf-page-canvas';
      pageCanvas.width = Math.floor(viewport.width);
      pageCanvas.height = Math.floor(viewport.height);

      const pageCtx = pageCanvas.getContext('2d', { alpha: false });
      await page.render({ canvasContext: pageCtx, viewport }).promise;
      if (token !== pdPdfRenderToken) return;

      pageWrap.appendChild(pageCanvas);
      pagesEl.appendChild(pageWrap);
      pageEls.push(pageWrap);

      const thumbViewport = page.getViewport({ scale: 0.2 });
      const thumbBtn = document.createElement('button');
      thumbBtn.className = 'pd-pdf-thumb';
      thumbBtn.type = 'button';

      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.className = 'pd-pdf-thumb-canvas';
      thumbCanvas.width = Math.floor(thumbViewport.width);
      thumbCanvas.height = Math.floor(thumbViewport.height);

      const thumbCtx = thumbCanvas.getContext('2d', { alpha: false });
      await page.render({ canvasContext: thumbCtx, viewport: thumbViewport }).promise;
      if (token !== pdPdfRenderToken) return;

      const thumbLabel = document.createElement('span');
      thumbLabel.className = 'pd-pdf-thumb-label';
      thumbLabel.textContent = String(pageNum);

      thumbBtn.appendChild(thumbCanvas);
      thumbBtn.appendChild(thumbLabel);
      thumbBtn.addEventListener('click', () => jumpToPage(pageNum));
      thumbsEl.appendChild(thumbBtn);
      thumbBtns.push(thumbBtn);
    }

    pagesEl.addEventListener('scroll', () => {
      if (pageEls.length === 0) return;
      const containerTop = pagesEl.getBoundingClientRect().top;

      let closestPage = 1;
      let bestDist = Number.POSITIVE_INFINITY;
      pageEls.forEach((el, idx) => {
        const dist = Math.abs(el.getBoundingClientRect().top - containerTop);
        if (dist < bestDist) {
          bestDist = dist;
          closestPage = idx + 1;
        }
      });
      updateActivePage(closestPage);
    }, { passive: true });

    updateActivePage(1);
  } catch (error) {
    console.error('Failed to render PDF preview:', error);
    inner.innerHTML = `<div class="pd-pdf-error">Unable to render PDF preview.</div>`;
  }
}

function initPostDetailInteractions() {
  const visualCol = document.getElementById('pdVisualCol');
  const textCol = document.getElementById('pdTextCol');
  const commentsCol = document.getElementById('pdCommentsCol');
  const visualInner = document.getElementById('pdVisualInner');
  const textInner = document.getElementById('postDetailContent');
  const commentsInner = document.querySelector('.pd-comments-inner');
  if (!visualCol || !textCol || !commentsCol || !visualInner || !textInner || !commentsInner) {
    return () => {};
  }

  const enterVisual = () => { pdHoveredRegion = 'visual'; };
  const enterText = () => { pdHoveredRegion = 'text'; };
  const enterComments = () => { pdHoveredRegion = 'comments'; };

  let draggingImage = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let panStartX = 0;
  let panStartY = 0;

  const onVisualWheel = (e) => {
    if (pdHoveredRegion !== 'visual') return;

    const current = pdVisualNavController?.getCurrent?.();
    const imageActive = current && current.type === 'image';
    if (!imageActive) return;

    e.preventDefault();
    e.stopPropagation();
    const zoomDelta = e.deltaY < 0 ? PD_ZOOM_STEP : -PD_ZOOM_STEP;
    adjustPdVisualZoom(zoomDelta, visualInner, e.clientX, e.clientY);
  };

  const onVisualPointerDown = (e) => {
    const imageEl = visualInner.querySelector('.pd-visual-img');
    if (!imageEl) return;
    if (pdVisualZoom <= 1) return;
    if (e.button !== 0) return;

    draggingImage = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX = pdVisualPanX;
    panStartY = pdVisualPanY;
    visualInner.classList.add('pd-visual-dragging');

    try {
      visualInner.setPointerCapture?.(e.pointerId);
    } catch {
      // best effort
    }

    e.preventDefault();
  };

  const onVisualPointerMove = (e) => {
    if (!draggingImage) return;

    const imageEl = visualInner.querySelector('.pd-visual-img');
    if (!imageEl) return;

    pdVisualPanX = panStartX + (e.clientX - dragStartX);
    pdVisualPanY = panStartY + (e.clientY - dragStartY);
    clampPdVisualPan(visualInner, imageEl);
    applyPdVisualZoom(visualInner);
    e.preventDefault();
  };

  const stopVisualDrag = () => {
    draggingImage = false;
    visualInner.classList.remove('pd-visual-dragging');
  };

  const onTextWheel = (e) => {
    if (pdHoveredRegion !== 'text') return;
    e.stopPropagation();
  };

  const onCommentsWheel = (e) => {
    if (pdHoveredRegion !== 'comments') return;
    e.stopPropagation();
  };

  visualCol.addEventListener('mouseenter', enterVisual);
  textCol.addEventListener('mouseenter', enterText);
  commentsCol.addEventListener('mouseenter', enterComments);

  visualInner.addEventListener('wheel', onVisualWheel, { passive: false });
  visualInner.addEventListener('pointerdown', onVisualPointerDown);
  visualInner.addEventListener('pointermove', onVisualPointerMove);
  visualInner.addEventListener('pointerup', stopVisualDrag);
  visualInner.addEventListener('pointercancel', stopVisualDrag);
  visualInner.addEventListener('lostpointercapture', stopVisualDrag);
  textInner.addEventListener('wheel', onTextWheel, { passive: true });
  commentsInner.addEventListener('wheel', onCommentsWheel, { passive: true });

  return () => {
    visualCol.removeEventListener('mouseenter', enterVisual);
    textCol.removeEventListener('mouseenter', enterText);
    commentsCol.removeEventListener('mouseenter', enterComments);

    visualInner.removeEventListener('wheel', onVisualWheel);
    visualInner.removeEventListener('pointerdown', onVisualPointerDown);
    visualInner.removeEventListener('pointermove', onVisualPointerMove);
    visualInner.removeEventListener('pointerup', stopVisualDrag);
    visualInner.removeEventListener('pointercancel', stopVisualDrag);
    visualInner.removeEventListener('lostpointercapture', stopVisualDrag);
    textInner.removeEventListener('wheel', onTextWheel);
    commentsInner.removeEventListener('wheel', onCommentsWheel);
    stopVisualDrag();
    pdHoveredRegion = null;
  };
}

function getFilePreviewLabel(filename = '') {
  const ext = getFileExtension(filename);
  if (!ext) return '?';
  return ext.toUpperCase();
}

function buildFilePreviewMarkup(post) {
  // ── YOUTUBE ──
  const youtubeId = extractYouTubeId(post.youtube_url || '');
  if (youtubeId) {
    return `
      <div class="post-file-preview post-file-preview-youtube">
        ${createYouTubePosterShellMarkup(
          youtubeId,
          'post-file-preview-youtube-shell',
          'post-file-preview-youtube-activate',
          'post-file-preview-youtube-activate-icon'
        )}
      </div>
    `;
  }

  // ── MULTI-FILE ──
  if (post.files && post.files.length > 1) {
    const hasCover = !!post.cover_image_url;
    return `
      <div class="post-file-preview post-file-preview-download${hasCover ? ' has-cover' : ''}">
        ${hasCover ? `<img class="post-file-preview-cover" src="${post.cover_image_url}" alt="">` : ''}
        <div class="post-file-preview-label">+</div>
        <span class="post-file-preview-download-btn">›</span>
      </div>
    `;
  }

  const ext = getFileExtension(post.file_name || '');
  const label = getFilePreviewLabel(post.file_name || '');

  const isImage = post.file_type === 'image' || isImageExtension(ext);
  const isAudio = post.file_type === 'audio' || isAudioExtension(ext);
  const isVideo = (post.file_type === 'video' || isVideoExtension(ext)) && !isAudio;

  if (isImage && post.file_url) {
    return `<img class="post-image" src="${post.file_url}" alt="">`;
  }

  if (isVideo && post.file_url) {
    const label = getFilePreviewLabel(post.file_name || '');
    return `
      <div class="post-file-preview post-file-preview-video">
        <video class="post-preview-video" src="${post.file_url}" muted loop autoplay playsinline preload="metadata" disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback" x-webkit-airplay="deny"></video>
        <div class="post-file-preview-label">${label}</div>
        <button class="post-preview-mute-btn" type="button" aria-label="toggle sound">X</button>
      </div>
    `;
  }

  if (isAudio && post.file_url) {
    const hasCover = !!post.cover_image_url;
    return `
      <div class="post-file-preview post-file-preview-audio ${hasCover ? 'has-cover' : ''}">
        ${hasCover ? `<img class="post-file-preview-cover" src="${post.cover_image_url}" alt="">` : ''}
        <div class="post-file-preview-label">${label}</div>
        <button class="post-file-preview-play" type="button" aria-label="play audio">></button>
        <audio class="post-preview-audio" src="${post.file_url}" preload="none"></audio>
      </div>
    `;
  }

  // replace the existing `if (post.file_url)` (the download tile) with:
  if (post.file_url) {
    const hasCover = !!post.cover_image_url;
    return `
      <div class="post-file-preview post-file-preview-download${hasCover ? ' has-cover' : ''}">
        ${hasCover ? `<img class="post-file-preview-cover" src="${post.cover_image_url}" alt="">` : ''}
        <div class="post-file-preview-label">${label}</div>
        <a class="post-file-preview-download-btn" href="${post.file_url}" download aria-label="download file">⤓</a>
      </div>
    `;
  }

  return `
    <div class="post-file-preview">
      <div class="post-file-preview-label">${label}</div>
    </div>
  `;
}

function getPostCardMediaState(post) {
  const isMultiFile = !!(post.files && post.files.length > 1);
  const fileExt = getFileExtension(post.file_name || '');
  const isImageFile = isImageExtension(fileExt) || post.file_type === 'image';
  const isAudioFile = isAudioExtension(fileExt) || post.file_type === 'audio';
  const isVideoFile = (isVideoExtension(fileExt) || post.file_type === 'video') && !isAudioFile;
  const isVisualFile = isImageFile || isVideoFile;
  const hasCoverImage = !!post.cover_image_url;
  const youtubeId = extractYouTubeId(post.youtube_url || '');
  const hasYoutube = !!youtubeId;
  const hasAnyFile = !!post.file_url || isMultiFile;
  const isOtherFile = (!!post.file_url && !isVisualFile && !isAudioFile) || isMultiFile;
  const hasVisual = (hasAnyFile && (isVisualFile || hasCoverImage)) || hasYoutube;

  let visualSrc = null;
  if (isImageFile || isVideoFile) {
    visualSrc = post.file_url;
  } else if (hasCoverImage) {
    visualSrc = post.cover_image_url;
  } else if (hasYoutube) {
    visualSrc = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;
  }

  return {
    isMultiFile,
    isImageFile,
    isAudioFile,
    isVideoFile,
    isVisualFile,
    hasCoverImage,
    hasYoutube,
    hasAnyFile,
    isOtherFile,
    hasVisual,
    visualSrc
  };
}

function getPostCardContentConfig(post, mediaState) {
  const hasTitle = !!(post.title && post.title.trim());
  const hasText = !!getBodyPlainText(post.body);
  const {
    isImageFile,
    isAudioFile,
    isVideoFile,
    hasCoverImage,
    hasYoutube,
    isOtherFile,
    hasVisual,
    visualSrc
  } = mediaState;

  const buildPreviewMarkup = () => {
    if (isImageFile) return `<img class="post-image" src="${visualSrc}" alt="">`;
    if (isVideoFile || isAudioFile || isOtherFile || hasYoutube) return buildFilePreviewMarkup(post);
    if (hasCoverImage) return `<img class="post-image" src="${visualSrc}" alt="">`;
    return '';
  };

  if (hasTitle && (hasVisual || isAudioFile || isOtherFile) && hasText) {
    return {
      classes: ['post-layout-title-visual-text'],
      html: `
        <div class="post-title"><span class="post-title-track">${post.title}</span></div>
        <div class="post-visual-text-row">
          ${buildPreviewMarkup()}
          ${renderPostBodyMarkup(post.body)}
        </div>
      `
    };
  }

  if (hasTitle && (hasVisual || isAudioFile || isOtherFile)) {
    return {
      classes: ['post-layout-title-visual'],
      html: `
        <div class="post-title"><span class="post-title-track">${post.title}</span></div>
        ${buildPreviewMarkup()}
      `
    };
  }

  if ((isAudioFile || isOtherFile) && hasText) {
    return {
      classes: ['post-layout-visual-text'],
      html: `
        <div class="post-visual-text-row">
          ${buildFilePreviewMarkup(post)}
          ${renderPostBodyMarkup(post.body)}
        </div>
      `
    };
  }

  if (hasVisual && hasText) {
    return {
      classes: ['post-layout-visual-text'],
      html: `
        <div class="post-visual-text-row">
          ${isImageFile ? `<img class="post-image" src="${visualSrc}" alt="">` : buildFilePreviewMarkup(post)}
          ${renderPostBodyMarkup(post.body)}
        </div>
      `
    };
  }

  if (hasTitle && hasText) {
    return {
      classes: ['post-layout-title-text'],
      html: `
        <div class="post-title"><span class="post-title-track">${post.title}</span></div>
        ${renderPostBodyMarkup(post.body)}
      `
    };
  }

  if (hasVisual) {
    if (isVideoFile) {
      return {
        classes: ['post-layout-visual', 'post-layout-visual-natural'],
        cardClasses: ['post-card-natural-video'],
        html: buildFilePreviewMarkup(post),
        onRender(content, card) {
          content.querySelector('.post-file-preview-video')?.classList.add('post-file-preview-video-natural');
          lockNaturalVideoCardWidth(card, content);
        }
      };
    }

    if (isOtherFile || hasYoutube) {
      return {
        classes: ['post-layout-visual'],
        html: buildFilePreviewMarkup(post)
      };
    }

    return {
      classes: ['post-layout-visual'],
      html: `<img class="post-image" src="${visualSrc}" alt="">`
    };
  }

  if (isAudioFile || isOtherFile) {
    return {
      classes: ['post-layout-visual'],
      html: buildFilePreviewMarkup(post)
    };
  }

  if (hasTitle) {
    return {
      classes: ['post-layout-title'],
      html: `<div class="post-title"><span class="post-title-track">${post.title}</span></div>`
    };
  }

  if (hasText) {
    return {
      classes: ['post-layout-text'],
      html: renderPostBodyMarkup(post.body)
    };
  }

  return { classes: [], html: '' };
}

function lockNaturalVideoCardWidth(card, content) {
  const vid = content.querySelector('.post-preview-video');
  if (!vid) return;

  const applyNaturalWidth = () => {
    if (!vid.videoWidth || !vid.videoHeight) return;
    const aspect = vid.videoWidth / vid.videoHeight;
    let h = Math.min(vid.videoHeight, 400);
    let w = Math.round(h * aspect);
    if (w > 300) {
      w = 300;
      h = Math.round(w / aspect);
    }
    card.style.width = `${w}px`;
  };

  if (vid.readyState >= 1) applyNaturalWidth();
  else vid.addEventListener('loadedmetadata', applyNaturalWidth, { once: true });
}

function closeHelpOverlay() {
  const helpOverlay = document.getElementById('helpOverlay');
  if (!helpOverlay) return;
  helpOverlay.style.display = 'none';
  scheduleUiStatePersist();
}

function toggleHelpOverlay() {
  const helpOverlay = document.getElementById('helpOverlay');
  if (!helpOverlay) return;
  const isOpen = helpOverlay.style.display !== 'none';
  helpOverlay.style.display = isOpen ? 'none' : 'flex';
  scheduleUiStatePersist();
}

function closeNotificationsPanel() {
  notifPanel.classList.remove('open');
  document.body.classList.remove('notif-open');
  scheduleUiStatePersist();
}

function openNotificationsPanel() {
  notifPanel.classList.add('open');
  document.body.classList.add('notif-open');
  loadNotifications();
  scheduleUiStatePersist();
}

function getUiStateStorageKey() {
  return `${UI_STATE_STORAGE_PREFIX}:${currentUser?.id || 'anon'}`;
}

function isFiniteNumber(value) {
  return Number.isFinite(value) && !Number.isNaN(value);
}

function buildUiStateSnapshot() {
  const helpOverlay = document.getElementById('helpOverlay');

  return {
    version: 1,
    savedAt: Date.now(),
    canvasScale,
    canvasOffsetX,
    canvasOffsetY,
    activePostId: activePostForModal?.id || null,
    postFormOpen: postFormOverlay?.style.display === 'flex',
    profileUserId: profileOverlay?.classList.contains('open') ? currentProfileUserId : null,
    notifOpen: !!notifPanel?.classList.contains('open'),
    helpOpen: !!helpOverlay && helpOverlay.style.display !== 'none',
    editMode,
    activeUserFilter,
    activeCategoryFilter,
    activeLinkTreeRootPostId
  };
}

function persistUiStateNow() {
  if (!currentUser) return;

  try {
    const snapshot = buildUiStateSnapshot();
    sessionStorage.setItem(getUiStateStorageKey(), JSON.stringify(snapshot));

    const quickSnapshot = {
      savedAt: snapshot.savedAt,
      canvasScale: snapshot.canvasScale,
      canvasOffsetX: snapshot.canvasOffsetX,
      canvasOffsetY: snapshot.canvasOffsetY
    };
    sessionStorage.setItem(UI_STATE_QUICK_KEY, JSON.stringify(quickSnapshot));
  } catch (err) {
    console.warn('Failed to persist UI state', err);
  }
}

function readQuickViewportState() {
  try {
    const raw = sessionStorage.getItem(UI_STATE_QUICK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > UI_STATE_MAX_AGE_MS) return null;
    return parsed;
  } catch (err) {
    console.warn('Failed to read quick viewport state', err);
    return null;
  }
}

function scheduleUiStatePersist() {
  if (restoreInFlight) return;

  window.clearTimeout(uiPersistTimer);
  uiPersistTimer = window.setTimeout(() => {
    persistUiStateNow();
  }, 120);
}

function readPersistedUiState() {
  if (!currentUser) return null;

  try {
    const raw = sessionStorage.getItem(getUiStateStorageKey());
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > UI_STATE_MAX_AGE_MS) return null;
    return parsed;
  } catch (err) {
    console.warn('Failed to read persisted UI state', err);
    return null;
  }
}

function applyInitialViewportState(snapshot) {
  if (
    snapshot &&
    isFiniteNumber(snapshot.canvasScale) &&
    isFiniteNumber(snapshot.canvasOffsetX) &&
    isFiniteNumber(snapshot.canvasOffsetY)
  ) {
    canvasScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, snapshot.canvasScale));
    canvasOffsetX = snapshot.canvasOffsetX;
    canvasOffsetY = snapshot.canvasOffsetY;
    return;
  }

  canvasScale = DEFAULT_BOOT_SCALE;
  canvasOffsetX = Math.round(window.innerWidth * 0.34);
  canvasOffsetY = Math.round(window.innerHeight * 0.22);
}

async function restoreUiPanelsAndModals(snapshot) {
  if (!snapshot) return;

  activeUserFilter = snapshot.activeUserFilter || null;
  activeCategoryFilter = snapshot.activeCategoryFilter || null;
  activeLinkTreeRootPostId = snapshot.activeLinkTreeRootPostId || null;

  if (snapshot.notifOpen) {
    openNotificationsPanel();
  }

  if (snapshot.postFormOpen && !editMode) {
    openPostForm();
  }

  const helpOverlay = document.getElementById('helpOverlay');
  if (snapshot.helpOpen && helpOverlay) {
    helpOverlay.style.display = 'flex';
  }

  if (snapshot.profileUserId) {
    await openProfileModal(snapshot.profileUserId);
  }

  if (snapshot.activePostId) {
    const { data: post, error: postErr } = await supabase
      .from('posts')
      .select('*')
      .eq('id', snapshot.activePostId)
      .maybeSingle();

    if (!postErr && post) {
      const { data: user } = await supabase
        .from('users')
        .select('id, username, pfp, pfp_url')
        .eq('id', post.user_id)
        .maybeSingle();

      await openPostDetailModal(post, user || {});
    }
  }
}

function scheduleRealtimeRefresh(options = {}) {
  const {
    withLinks = false,
    withNotifications = false,
    maybeCommentPostId = null
  } = options;

  if (withLinks) realtimeNeedsLinks = true;

  window.clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = window.setTimeout(async () => {
    await loadPosts();

    if (realtimeNeedsLinks) {
      await loadLinks();
      realtimeNeedsLinks = false;
    }

    renderLinks(lastLoadedPosts, lastLoadedLinks);

    if (withNotifications && notifPanel?.classList.contains('open')) {
      await loadNotifications();
    }

    if (
      activePostForModal &&
      maybeCommentPostId &&
      String(activePostForModal.id) === String(maybeCommentPostId)
    ) {
      await loadCommentsForPost(activePostForModal.id);
    }
  }, 220);
}

function initializeRealtimeRefresh() {
  if (mainRealtimeChannel) return;

  mainRealtimeChannel = supabase
    .channel(`main-live:${currentUser?.id || 'anon'}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'posts', filter: 'group_id=eq.group4' },
      () => {
        scheduleRealtimeRefresh({ withLinks: true });
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'post_links', filter: 'group_id=eq.group4' },
      () => {
        scheduleRealtimeRefresh({ withLinks: true });
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'comments' },
      (payload) => {
        const changedPostId = payload?.new?.post_id || payload?.old?.post_id || null;
        scheduleRealtimeRefresh({ maybeCommentPostId: changedPostId });
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_user_id=eq.${currentUser?.id}`
      },
      () => {
        scheduleRealtimeRefresh({ withNotifications: true });
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Realtime refresh subscribed');
      }
    });
}

function handleGlobalKeydown(e) {
  const tag = document.activeElement?.tagName?.toLowerCase();
  const isTyping = tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable;

  if (!isTyping && postDetailOverlay?.style.display === 'flex') {
    if (e.key === 'ArrowLeft' && pdVisualNavController?.hasMultiple?.()) {
      e.preventDefault();
      pdVisualNavController.prev();
      return;
    }
    if (e.key === 'ArrowRight' && pdVisualNavController?.hasMultiple?.()) {
      e.preventDefault();
      pdVisualNavController.next();
      return;
    }
  }

  if (e.key === 'h' || e.key === 'H') {
    if (!isTyping) {
      e.preventDefault();
      toggleHelpOverlay();
      return;
    }
  }

  if (e.key !== 'Escape') return;

  const helpOverlay = document.getElementById('helpOverlay');
  if (helpOverlay?.style.display !== 'none') {
    closeHelpOverlay();
  } else if (postDetailOverlay?.style.display === 'flex') {
    closePostDetailModal();
  } else if (profileOverlay?.classList.contains('open')) {
    closeProfileModal();
  } else if (notifPanel?.classList.contains('open')) {
    closeNotificationsPanel();
  } else if (postFormOverlay?.style.display === 'flex') {
    maybeClosePostForm();
  } else if (editMode) {
    toggleEditMode();
  }
}

function applyMarqueeIfNeeded(containerEl, trackEl, separator = '\u00A0\u00A0') {
  if (!containerEl || !trackEl) return;

  requestAnimationFrame(() => {
    if (trackEl.scrollWidth <= containerEl.clientWidth) return;

    const originalText = trackEl.textContent;
    trackEl.textContent = originalText + separator + originalText;

    requestAnimationFrame(() => {
      const totalWidth = trackEl.scrollWidth;
      if (totalWidth <= 0) return;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const style = getComputedStyle(trackEl);
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

      const firstHalfWidth = ctx.measureText(originalText + separator).width;
      const pct = (firstHalfWidth / totalWidth) * 100;
      trackEl.style.setProperty('--marquee-end-pct', `-${pct.toFixed(3)}%`);
    });

    containerEl.classList.add('is-marquee');
  });
}

function attachLongPress(element, onPress, options = {}) {
  if (!element || typeof onPress !== 'function') return;

  const {
    duration = 400,
    stopPropagationOnMouseDown = false,
    shouldIgnoreMouseDown = null,
    shouldIgnorePointerDown = shouldIgnoreMouseDown
  } = options;

  let pressTimer = null;
  let activePointerId = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerMoved = false;
  const MOVE_THRESHOLD = 10;

  element.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (shouldIgnoreMouseDown?.(e)) return;
    if (stopPropagationOnMouseDown) e.stopPropagation();

    pressTimer = setTimeout(() => {
      pressTimer = null;
      onPress(e);
    }, duration);
  });

  const clearPressTimer = () => {
    clearTimeout(pressTimer);
    pressTimer = null;
  };

  element.addEventListener('mouseup', clearPressTimer);
  element.addEventListener('mouseleave', clearPressTimer);

  element.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    if (shouldIgnorePointerDown?.(e)) return;
    if (stopPropagationOnMouseDown) e.stopPropagation();

    activePointerId = e.pointerId;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    pointerMoved = false;

    try {
      element.setPointerCapture?.(e.pointerId);
    } catch {
      // no-op: pointer capture is best-effort only
    }

    e.preventDefault();
  });

  element.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') return;
    if (activePointerId !== e.pointerId) return;

    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;
    if (Math.hypot(dx, dy) > MOVE_THRESHOLD) {
      pointerMoved = true;
      clearPressTimer();
    }
  });

  const clearPointerState = (e) => {
    if (e && e.pointerType === 'mouse') return;
    activePointerId = null;
    pointerMoved = false;
  };

  element.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    if (activePointerId !== e.pointerId) return;

    const shouldActivate = !pointerMoved && !shouldIgnorePointerDown?.(e);
    clearPressTimer();
    clearPointerState(e);

    if (shouldActivate) {
      onPress(e);
    }
  });

  element.addEventListener('pointercancel', (e) => {
    clearPressTimer();
    clearPointerState(e);
  });

  element.addEventListener('lostpointercapture', clearPressTimer);
}

// ============================================
// 22. POST CARD COMPOSITION
// ============================================
function buildPostCard(post, user) {
  const card = document.createElement('div');
  card.className = 'post-card';
  card.dataset.postId = post.id;
  const canEditThisPost = canCurrentUserEditPost(post);

  const idx = (buildPostCard._indexCounter || 0);
  buildPostCard._indexCounter = idx + 1;

  const fallbackX = 60 + (idx % 4) * 340;
  const fallbackY = 60 + Math.floor(idx / 4) * 280;

  const x = (post.x ?? fallbackX);
  const y = (post.y ?? fallbackY);

  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
  applyCardScale(card, getStoredPostScale(post.id));

  const mediaState = getPostCardMediaState(post);

  const content = document.createElement('div');
  content.className = 'post-card-content';

  const contentConfig = getPostCardContentConfig(post, mediaState);
  content.classList.add(...contentConfig.classes);
  if (contentConfig.cardClasses?.length) {
    card.classList.add(...contentConfig.cardClasses);
  }
  content.innerHTML = contentConfig.html;
  contentConfig.onRender?.(content, card);

  if (
  content.classList.contains('post-layout-title-visual-text') ||
  content.classList.contains('post-layout-title-text') ||
  content.classList.contains('post-layout-visual-text') ||
  content.classList.contains('post-layout-text')
) {
  const bodyEl = content.querySelector('.post-body');
  if (bodyEl) {
    const text = bodyEl.textContent.trim();
    if (text.length >= 35) {
      content.classList.add('is-long-text');
      trapScrollInside(bodyEl);
    }
  }
}

  const titleEl = content.querySelector('.post-title');
  const titleTrackEl = content.querySelector('.post-title-track');
  applyMarqueeIfNeeded(titleEl, titleTrackEl);



  wirePreviewVideoControls(content);
  wireAudioPreviewControls(content);
  wireYouTubePreviewControls(content, { disableInteraction: editMode });

  card.appendChild(content);

  const footer = document.createElement('div');
  footer.className = 'post-footer';

  const pfpFallback = './images/pfps/default.png';
  const pfpSrc = user?.pfp_url || (user?.pfp ? `./images/pfps/${user.pfp}` : pfpFallback);


      if (editMode && canEditThisPost) {
    footer.innerHTML = `
      <img class="post-footer-pfp" src="${pfpSrc}" alt="" data-user-id="${post.user_id}" style="cursor:pointer;">
      <span class="post-footer-action post-footer-edit">edit</span>
      <span class="post-footer-action post-footer-reposition">⟴</span>
      <span class="post-footer-action post-footer-thread ${String(activeThreadSourcePostId) === String(post.id) ? 'active' : ''}" title="toggle thread mode">𓍯</span>
      <span class="post-footer-category post-footer-filter-btn"><span class="post-footer-category-track">${post.category || 'none'}</span></span>
    `;

    footer.querySelector('.post-footer-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditForm(post);
    });

    footer.querySelector('.post-footer-reposition')?.addEventListener('click', (e) => {
      e.stopPropagation();
      startPlacement(post, card, window.__lastMouseEventForPlacement || { clientX: 200, clientY: 200 });
    });

    footer.querySelector('.post-footer-thread')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      activeThreadSourcePostId = String(activeThreadSourcePostId) === String(post.id)
        ? null
        : String(post.id);
      await loadPosts();
    });

  } else {
    footer.innerHTML = `
    <img class="post-footer-pfp" src="${pfpSrc}" alt="" data-user-id="${post.user_id}" style="cursor:pointer;">
    <span class="post-footer-username post-footer-filter-btn"><span class="post-footer-username-track">${user?.username || 'unknown'}</span></span>
    <span class="post-footer-category post-footer-filter-btn"><span class="post-footer-category-track">${post.category || 'none'}</span></span>
  `;

    const usernameEl = footer.querySelector('.post-footer-username');
    if (!editMode && usernameEl && user?.id) {
      usernameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        activeUserFilter = (activeUserFilter === user.id) ? null : user.id;
        loadPosts();
      });
    }

    const categoryEl = footer.querySelector('.post-footer-category');
    if (!editMode && categoryEl) {
      categoryEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const isNone = post.category == null;
        const nextFilter = isNone ? NONE_CATEGORY_FILTER : post.category;
        activeCategoryFilter = (activeCategoryFilter === nextFilter) ? null : nextFilter;
        loadPosts();
      });
    }
  }

  const pfpEl = footer.querySelector('.post-footer-pfp');
  attachLongPress(pfpEl, () => openProfileModal(post.user_id), {
    duration: 400,
    stopPropagationOnMouseDown: true
  });

  card.appendChild(footer);

  if (editMode && canEditThisPost) {
    const corners = ['corner-tl', 'corner-tr', 'corner-br', 'corner-bl'];
    corners.forEach((cornerClass) => {
      const resizeHandle = document.createElement('div');
      resizeHandle.className = `post-resize-handle ${cornerClass}`;
      resizeHandle.title = 'drag corner to resize';
      resizeHandle.addEventListener('mousedown', (e) => beginPostResize(e, card, post.id));
      card.appendChild(resizeHandle);
    });
  }

  if (editMode && activeThreadSourcePostId) {
    const postId = String(post.id);
    const sourceId = String(activeThreadSourcePostId);
    if (postId === sourceId) {
      card.classList.add('post-card-thread-source');
    } else if (findExistingLinkRecord(sourceId, postId, lastLoadedLinks)) {
      card.classList.add('post-card-thread-linked');
    }
  }

  const categoryEl = card.querySelector('.post-footer-category');
  const categoryTrackEl = card.querySelector('.post-footer-category-track');
  applyMarqueeIfNeeded(categoryEl, categoryTrackEl);

  const usernameEl      = card.querySelector('.post-footer-username');
  const usernameTrackEl = card.querySelector('.post-footer-username-track');
  applyMarqueeIfNeeded(usernameEl, usernameTrackEl, '\u00A0');

  card.addEventListener('click', async (e) => {
    if (!editMode || !activeThreadSourcePostId) return;

    if (
      e.target.closest('.post-footer-action') ||
      e.target.closest('.post-footer-pfp') ||
      e.target.closest('.post-footer-username') ||
      e.target.closest('.post-footer-category') ||
      e.target.closest('.post-preview-mute-btn') ||
      e.target.closest('.post-file-preview-play') ||
      e.target.closest('.post-file-preview-download-btn') ||
      e.target.closest('.post-file-preview-youtube-activate') ||
      e.target.closest('.post-resize-handle')
    ) {
      return;
    }

    e.stopPropagation();

    const sourceId = String(activeThreadSourcePostId);
    const targetId = String(post.id);
    if (sourceId === targetId) return;

    await toggleThreadLinkBetweenPosts(sourceId, targetId);
  });

  attachLongPress(card, () => openPostDetailModal(post, user), {
    duration: 400,
    shouldIgnorePointerDown: (e) => Boolean(
      e.target.closest('.post-footer-pfp') ||
      e.target.closest('.post-footer-username') ||
      e.target.closest('.post-footer-category') ||
      e.target.closest('.post-footer-action') ||
      e.target.closest('.post-resize-handle') ||
      e.target.closest('.post-preview-mute-btn') ||
      e.target.closest('.post-file-preview-play') ||
      e.target.closest('.post-file-preview-download-btn')
    ),
    shouldIgnoreMouseDown: (e) => {
      if (isPlacing) return true;
      return Boolean(
        e.target.closest('.post-footer-pfp') ||
        e.target.closest('.post-footer-username') ||
        e.target.closest('.post-footer-category') ||
        e.target.closest('.post-footer-action') ||
        e.target.closest('.post-resize-handle') ||
        e.target.closest('.post-preview-mute-btn') ||
        e.target.closest('.post-file-preview-play') ||
        e.target.closest('.post-file-preview-download-btn') ||
        e.target.closest('.post-file-preview-youtube-activate')
      );
    }
  });

  return card;
}

// ============================================
// 23. GLOBAL EVENT WIRING
// ============================================

function initializeEventListeners() {
  const recordPlacementPointer = (e) => {
    window.__lastMouseEventForPlacement = e;
  };

  window.addEventListener('mousemove', recordPlacementPointer);
  window.addEventListener('pointermove', recordPlacementPointer);
  window.addEventListener('pointerdown', recordPlacementPointer);

  document.getElementById('pdFullscreenBtn')?.addEventListener('click', togglePdFullscreen);
  initPdResize();

  const canvasViewport = document.getElementById('canvasViewport');
  let activePanPointerId = null;
  let panStartPointerX = 0;
  let panStartPointerY = 0;
  let panStartPointerOffsetX = 0;
  let panStartPointerOffsetY = 0;

  const beginPointerPan = (e) => {
    if (isPlacing) return;
    if (e.target.closest('.post-card')) return;
    if (e.target.closest('#linkLayer')) return;

    if (activeLinkTreeRootPostId) {
      activeLinkTreeRootPostId = null;
      loadPosts();
      return;
    }

    activePanPointerId = e.pointerId;
    panStartPointerX = e.clientX;
    panStartPointerY = e.clientY;
    panStartPointerOffsetX = canvasOffsetX;
    panStartPointerOffsetY = canvasOffsetY;

    try {
      canvasViewport.setPointerCapture?.(e.pointerId);
    } catch {
      // best effort only
    }

    return true;
  };

  const updatePointerPan = (e) => {
    if (activePanPointerId !== e.pointerId) return;
    const dx = e.clientX - panStartPointerX;
    const dy = e.clientY - panStartPointerY;
    canvasOffsetX = panStartPointerOffsetX + dx;
    canvasOffsetY = panStartPointerOffsetY + dy;
    applyCanvasTransform();
  };

  const endPointerPan = (e) => {
    if (e && activePanPointerId !== null && e.pointerId !== activePanPointerId) return;
    activePanPointerId = null;
  };

  // Canvas pan controls
  canvasViewport.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartOffsetX = canvasOffsetX;
    panStartOffsetY = canvasOffsetY;
  });

  canvasViewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    if (beginPointerPan(e)) {
      e.preventDefault();
    }
  });

  // Background drag pan in view mode
  canvasViewport.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (isPlacing) return;
    if (e.target.closest('.post-card')) return;
    if (e.target.closest('#linkLayer')) return;

    if (activeLinkTreeRootPostId) {
      activeLinkTreeRootPostId = null;
      loadPosts();
      return;
    }

    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartOffsetX = canvasOffsetX;
    panStartOffsetY = canvasOffsetY;
  });

  canvasViewport.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') return;
    updatePointerPan(e);
  });

  canvasViewport.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    endPointerPan(e);
  });

  canvasViewport.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'mouse') return;
    endPointerPan(e);
  });

  window.addEventListener('mousemove', (e) => {
    if (resizingPostState) {
      updatePostResize(e);
      return;
    }
    if (!isPanning) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    canvasOffsetX = panStartOffsetX + dx;
    canvasOffsetY = panStartOffsetY + dy;
    applyCanvasTransform();
  });

  window.addEventListener('mouseup', () => {
    endPostResize();
    isPanning = false;
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 1) isPanning = false;
  }); 

  window.addEventListener('mousemove', (e) => {
    if (isPlacing) updatePlacementPosition(e);
  });

  window.addEventListener('mousedown', async (e) => {
    if (!isPlacing) return;
    if (e.button !== 0) return;
    await tryDropPlacement(e);
  });

  canvasViewport.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  // Canvas context menu gestures
    (canvasViewport || mainPageContainer).addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (isPlacing) return;

    const now = Date.now();
    const timeSince = now - lastRightClick;
    lastRightClick = now;

    const isFormOpen = postFormOverlay.style.display === 'flex';

    if (timeSince < DOUBLE_CLICK_THRESHOLD) {
      lastRightClick = 0;
      closePostForm();
      toggleEditMode();
      return;
    }

    // if right-clicked on a post, next created post links to it
    const clickedCard = e.target.closest('.post-card');
    pendingLinkPostId = clickedCard ? clickedCard.dataset.postId : null;

    setTimeout(() => {
      if (lastRightClick !== now) return;

      if (isFormOpen) {
        closePostForm();
        return;
      }

      if (!editMode) {
        openPostForm();
      }
    }, DOUBLE_CLICK_THRESHOLD);
  });

  // Profile modal controls
  document.getElementById('profileClose').addEventListener('click', closeProfileModal);


  document.getElementById('profileSaveBtn').addEventListener('click', saveProfileChanges);

  document.getElementById('profileCoverInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    newProfileCoverFile = file;
    const coverImg = document.getElementById('profileCoverImg');
    coverImg.src           = URL.createObjectURL(file);
    coverImg.style.display = 'block';
    document.getElementById('profileCoverPlaceholder').style.display = 'none';
  });

  document.getElementById('profilePfpInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    newProfilePfpFile = file;
    const pfpWidget = document.getElementById('profilePfpWidget');
    pfpWidget.innerHTML = '';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.style.cssText = 'width:60px;height:60px;object-fit:cover;display:block;';
    pfpWidget.appendChild(img);
  });

  // Canvas wheel zoom
  canvasViewport.addEventListener('wheel', (e) => {
    e.preventDefault();

    const delta = normalizeWheelDelta(e);
    const zoomFactor = Math.exp(-delta * ZOOM_SENSITIVITY);

    const oldScale = canvasScale;
    let newScale = oldScale * zoomFactor;
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    if (newScale === oldScale) return;

    const mouseX = e.clientX;
    const mouseY = e.clientY;

    const before = viewportPointToCanvasPoint(mouseX, mouseY);

    canvasScale = newScale;

    canvasOffsetX = mouseX - before.x * canvasScale;
    canvasOffsetY = mouseY - before.y * canvasScale;

    applyCanvasTransform();
  }, { passive: false });

  postCancelBtn.addEventListener('click', maybeClosePostForm);

  postText?.addEventListener('paste', handlePostTextPaste);
  postText?.addEventListener('blur', () => {
    postText.innerHTML = formatBodyText(postText.innerHTML || '');
  });

   postCoverImageInput.addEventListener('change', () => {
    const file = postCoverImageInput.files[0];
    if (file) {
      postCoverFileName.textContent = file.name;
    } else {
      postCoverFileName.textContent = editingPost?.cover_image_url
        ? 'replace cover'
        : 'choose cover image';
    }
  });


  postFileInput.addEventListener('change', async () => {
  const files = [...postFileInput.files];
  if (files.length === 0) {
    postFileName.textContent = 'choose file';
    postCoverImageLabel.style.display = 'none';
    postCoverImageInput.value = '';
    postCoverFileName.textContent = 'choose cover image';
    return;
  }

  postFileName.textContent = files.length === 1
    ? files[0].name
    : `${files.length} files`;

  // Show cover input if any file is non-visual
  const types = await Promise.all(files.map(f => getFileType(f)));
  const anyNonVisual = types.some(t => t !== 'image' && t !== 'video');

  if (anyNonVisual) {
    postCoverImageLabel.style.display = 'block';
  } else {
    postCoverImageLabel.style.display = 'none';
    postCoverImageInput.value = '';
    postCoverFileName.textContent = 'choose cover image';
  }
});

  postSubmitBtn.addEventListener('click', handlePostSubmit);

  addCategoryToggle.addEventListener('click', () => {
    if (postCategory.style.display !== 'none') {
      postCategory.style.display = 'none';
      postCategoryInput.style.display = 'block';
      postCategoryInput.value = '';
      postCategoryInput.focus();
      addCategoryToggle.textContent = '×';
    } else {
      postCategory.style.display = 'block';
      postCategoryInput.style.display = 'none';
      postCategoryInput.value = '';
      addCategoryToggle.textContent = '+';
    }
  });

  postCategoryInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCategory();
    }
  });


  logoutBtn?.addEventListener('click', async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      alert(`Logout failed: ${error.message}`);
      return;
    }
    window.location.href = './index.html';
  });

  postDeleteBtn.addEventListener('click', async () => {
  if (!editingPostId) return;
  await handleDeletePost(editingPostId);
  closePostForm();
});

  postDetailClose?.addEventListener('click', closePostDetailModal);
  postDetailOverlay?.addEventListener('click', (e) => {
    if (e.target === postDetailOverlay) closePostDetailModal();
  });

  commentSubmitBtn?.addEventListener('click', submitComment);
  commentInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitComment();
    }
  });

  // Global keyboard shortcuts and dismiss behavior
  document.addEventListener('keydown', handleGlobalKeydown);

  document.getElementById('helpClose')?.addEventListener('click', closeHelpOverlay);

  const helpOverlay = document.getElementById('helpOverlay');
  helpOverlay?.addEventListener('click', (e) => {
    if (e.target === helpOverlay) {
      closeHelpOverlay();
    }
  });

  // Notification panel toggle
  notifBar.addEventListener('click', () => {
    const isOpen = notifPanel.classList.contains('open');
    if (isOpen) {
      closeNotificationsPanel();
    } else {
      openNotificationsPanel();
    }
  });

  window.addEventListener('beforeunload', persistUiStateNow);
  window.addEventListener('pagehide', persistUiStateNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      persistUiStateNow();
    }
  });

}




// ============================================
// 24. APP BOOTSTRAP
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Main page loaded');

  installPrettyAlerts({ baseUrl: import.meta.env.BASE_URL });

  const canvasViewport = document.getElementById('canvasViewport');
  if (canvasViewport) {
    canvasViewport.style.opacity = '0';
    canvasViewport.style.filter = 'blur(8px)';
    canvasViewport.style.transition = 'opacity 200ms ease, filter 260ms ease';
  }

  const quickViewportState = readQuickViewportState();
  applyInitialViewportState(quickViewportState);
  applyCanvasTransform();

  document.documentElement.style.setProperty(
    "--bg-url",
    `url(${import.meta.env.BASE_URL}images/background.jpg)`
  );

  const session = await checkAuth();
  if (!session) return;

  restoredUiState = readPersistedUiState();

  if (restoredUiState?.editMode) {
    editMode = true;
    mainPageContainer.classList.add('edit-mode');
  }

  if (restoredUiState) {
    activeUserFilter = restoredUiState.activeUserFilter || null;
    activeCategoryFilter = restoredUiState.activeCategoryFilter || null;
    activeLinkTreeRootPostId = restoredUiState.activeLinkTreeRootPostId || null;
  }

  applyInitialViewportState(restoredUiState);

  initializeEventListeners();
  await loadCategories();
  await loadPosts();
  await loadLinks();
  await loadNotifications();
  await initMusic(currentUser, currentUserData);

  applyCanvasTransform();
  renderLinks(lastLoadedPosts, lastLoadedLinks);

  restoreInFlight = true;
  await restoreUiPanelsAndModals(restoredUiState);
  restoreInFlight = false;

  initializeRealtimeRefresh();
  persistUiStateNow();

  if (canvasViewport) {
    requestAnimationFrame(() => {
      canvasViewport.style.opacity = '1';
      canvasViewport.style.filter = 'blur(0px)';
    });
  }

  console.log('Main page ready');
});