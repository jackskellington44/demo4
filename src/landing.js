// ============================================
// LANDING.JS FILE MAP
// 0. PROFILE PICTURE GRID SETUP
// 1. DOM REFERENCES
// 2. UI STATE
// 3. VIEW TOGGLE (LOGIN/SIGNUP)
// 4. PFP SELECTION AND UPLOAD
// 5. FORM VALIDATION
// 6. LOGIN FLOW
// 7. SIGNUP FLOW
// 8. KEYBOARD SUBMISSION
// 9. APP BOOTSTRAP
// ============================================

import { supabase } from './supabase-config.js';
import { installPrettyAlerts } from './ui-alerts.js';

// ============================================
// 0. PROFILE PICTURE GRID SETUP
// ============================================

const PFP_LIST = [
  'pfp1.webp',  'pfp2.webp',  'pfp3.webp',  'pfp4.webp',  'pfp5.webp',
  'pfp6.webp',  'pfp7.webp',  'pfp8.webp',  'pfp9.webp',  'pfp10.webp',
  'pfp11.webp', 'pfp12.webp', 'pfp13.webp', 'pfp14.webp', 'pfp15.webp',
  'pfp16.webp', 'pfp17.webp', 'pfp18.webp', 'pfp19.webp'
];

const MAX_PFP_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED_PFP_MIME_TYPES = new Set([
  'image/webp',
  'image/gif',
  'image/png',
  'image/jpeg'
]);

function hashStringDjb2(input) {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function toUsernameKey(username) {
  return String(username || '').trim().toLowerCase();
}

function makeInternalEmail(username) {
  const key = toUsernameKey(username);
  const slug = key.replace(/[^a-z0-9]/g, '_').slice(0, 12) || 'user';
  const hash = hashStringDjb2(key);
  return `u_${slug}_${hash}@grp.io`;
}

function getPfpValidationError(file) {
  if (!file) return null;

  if (!ALLOWED_PFP_MIME_TYPES.has(file.type)) {
    return 'Profile picture must be webp, gif, png, or jpeg.';
  }

  if (file.size > MAX_PFP_UPLOAD_BYTES) {
    return 'Profile picture must be 2 MB or smaller.';
  }

  return null;
}

function drawImageSafely(ctx, img) {
  try {
    ctx.drawImage(img, 0, 0, 200, 200);
  } catch (e) {
    console.warn('Unable to draw profile picture frame', e);
  }
}

function freezeContainerFrame(container) {
  const img = container.querySelector('img');
  const cvs = container.querySelector('canvas');
  if (img && cvs && img.naturalWidth > 0) {
    const ctx = cvs.getContext('2d');
    if (ctx) drawImageSafely(ctx, img);
    img.classList.remove('pfp-playing');
  }
}

function deselectPFPContainers() {
  pfpContainers.forEach(container => {
    if (container.classList.contains('selected')) {
      freezeContainerFrame(container);
    }
    container.classList.remove('selected');
  });
}

function loadPFPGrid() {
  const pfpGrid = document.getElementById('pfpGrid');

  PFP_LIST.forEach(pfpName => {
    const container = document.createElement('div');
    container.className = 'pfp-container';
    container.dataset.pfp = pfpName;

    const src = `${import.meta.env.BASE_URL}images/pfps/${pfpName}`;

    const cvs = document.createElement('canvas');
    cvs.width  = 200;
    cvs.height = 200;
    const ctx  = cvs.getContext('2d');

    const img = document.createElement('img');
    img.src = src;
    img.alt = pfpName;

    const drawFrame = () => {
      drawImageSafely(ctx, img);
    };

    if (img.complete && img.naturalWidth > 0) drawFrame();
    else img.addEventListener('load', drawFrame, { once: true });

    container.addEventListener('mouseenter', () => {
      img.classList.add('pfp-playing');
    });

    container.addEventListener('mouseleave', () => {
      if (!container.classList.contains('selected')) {
        drawFrame();
        img.classList.remove('pfp-playing');
      }
    });

    container.appendChild(cvs);
    container.appendChild(img);
    pfpGrid.appendChild(container);
  });

  // Add upload tile at the end of the grid
  const uploadContainer = document.createElement('div');
  uploadContainer.className = 'upload-pfp-container';
  uploadContainer.id = 'uploadPFPButton';
  uploadContainer.innerHTML = '<span>+</span>';
  pfpGrid.appendChild(uploadContainer);
}

// ============================================
// 1. DOM REFERENCES
// ============================================

const loginToggle    = document.getElementById('loginToggle');
const signupToggle   = document.getElementById('signupToggle');
const loginInputs    = document.getElementById('loginInputs');
const signupInputs   = document.getElementById('signupInputs');
const pfpSelection   = document.getElementById('pfpSelection');
const pfpUpload      = document.getElementById('pfpUpload');
const loginUsername  = document.getElementById('loginUsername');
const loginPassword  = document.getElementById('loginPassword');
const signupUsername = document.getElementById('signupUsername');
const signupPassword = document.getElementById('signupPassword');

let pfpContainers  = null;
let uploadPFPButton = null;

// ============================================
// 2. UI STATE
// ============================================

let selectedPFP     = null;
let uploadedPFPFile = null;
let signupInFlight  = false;

// ============================================
// 3. VIEW TOGGLE (LOGIN/SIGNUP)
// ============================================

function setActiveView(view) {
  if (view === 'login') {
    loginToggle.classList.add('active');
    signupToggle.classList.remove('active');
    loginInputs.style.display  = 'flex';
    signupInputs.style.display = 'none';
    pfpSelection.style.display = 'none';
  } else {
    signupToggle.classList.add('active');
    loginToggle.classList.remove('active');
    loginInputs.style.display  = 'none';
    signupInputs.style.display = 'flex';
    pfpSelection.style.display = 'flex';
  }
}

function initializeViews() {
  loginToggle.addEventListener('click',  () => setActiveView('login'));
  signupToggle.addEventListener('click', () => setActiveView('signup'));
  setActiveView('login');
}

// ============================================
// 4. PFP SELECTION AND UPLOAD
// ============================================

function initializePFPSelection() {
  pfpContainers   = document.querySelectorAll('.pfp-container');
  uploadPFPButton = document.getElementById('uploadPFPButton');

  pfpContainers.forEach(container => {
    container.addEventListener('click', function () {
      // Deselect all and freeze the previously selected animated frame
      deselectPFPContainers();
      uploadPFPButton.classList.remove('selected');

      this.classList.add('selected');
      this.querySelector('img')?.classList.add('pfp-playing'); // keep playing when selected
      selectedPFP     = this.dataset.pfp;
      uploadedPFPFile = null;
    });
  });
}

function initializePFPUpload() {
  uploadPFPButton = document.getElementById('uploadPFPButton');

  uploadPFPButton.addEventListener('click', () => pfpUpload.click());

  pfpUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const pfpError = getPfpValidationError(file);
    if (pfpError) {
      alert(pfpError);
      pfpUpload.value = '';
      return;
    }

    // Deselect grid items
    deselectPFPContainers();

    uploadPFPButton.classList.add('selected');
    uploadPFPButton.innerHTML = '<span>✓</span>';
    selectedPFP     = null;
    uploadedPFPFile = file;
  });
}

// ============================================
// 5. FORM VALIDATION
// ============================================

function validateLoginForm() {
  if (!loginUsername.value.trim()) { alert('Please enter a username'); return false; }
  if (!loginPassword.value)        { alert('Please enter a password'); return false; }
  return true;
}

function validateSignupForm() {
  const u = signupUsername.value.trim();
  if (!u || u.length > 12)    { alert('Username must be 1–12 characters'); return false; }
  if (!signupPassword.value)  { alert('Please enter a password'); return false; }
  if (signupPassword.value.length < 6) { alert('Password must be at least 6 characters'); return false; }
  if (!selectedPFP && !uploadedPFPFile) { alert('Please select or upload a profile picture'); return false; }
  if (uploadedPFPFile) {
    const pfpError = getPfpValidationError(uploadedPFPFile);
    if (pfpError) { alert(pfpError); return false; }
  }
  return true;
}

// ============================================
// 6. LOGIN FLOW
// ============================================

async function handleLogin() {
  if (!validateLoginForm()) return;
  const username = loginUsername.value.trim();
  const password = loginPassword.value;

  try {
    // Look up internal email by username
    const { data: userData, error: lookupErr } = await supabase
      .from('users')
      .select('email')
      .eq('username', username)
      .maybeSingle();

    if (lookupErr || !userData) throw new Error('Username not found');

    const { error } = await supabase.auth.signInWithPassword({
      email: userData.email,
      password
    });
    if (error) throw error;

    window.location.href = './main.html';
  } catch (error) {
    console.error('Login error:', error.message);
    alert(`Login failed: ${error.message}`);
  }
}

// ============================================
// 7. SIGNUP FLOW
// ============================================

async function handleSignup() {
  if (signupInFlight) return;
  if (!validateSignupForm()) return;

  signupInFlight = true;
  const username = signupUsername.value.trim();
  const password = signupPassword.value;

  // Track created resources so we can roll back partial work on failure.
  let createdUserId = null;
  let insertedUserRow = false;
  let uploadedPfpPath = null;
  let signedIn = false;

  const setSignupUIBusy = (busy) => {
    signupToggle.disabled = busy;
    loginToggle.disabled = busy;
    signupUsername.disabled = busy;
    signupPassword.disabled = busy;
    if (pfpUpload) pfpUpload.disabled = busy;
    if (uploadPFPButton) uploadPFPButton.style.pointerEvents = busy ? 'none' : '';
    if (pfpContainers) {
      pfpContainers.forEach(container => {
        container.style.pointerEvents = busy ? 'none' : '';
      });
    }
  };

  const rollbackSignupArtifacts = async () => {
    if (uploadedPfpPath) {
      const { error: removePfpErr } = await supabase.storage
        .from('group4-pfps')
        .remove([uploadedPfpPath]);
      if (removePfpErr) {
        console.warn('Rollback warning: could not remove uploaded profile picture', removePfpErr.message);
      }
    }

    if (insertedUserRow && createdUserId) {
      const { error: deleteUserErr } = await supabase
        .from('users')
        .delete()
        .eq('id', createdUserId);
      if (deleteUserErr) {
        console.warn('Rollback warning: could not remove users row', deleteUserErr.message);
      }
    }

    if (signedIn) {
      const { error: signOutErr } = await supabase.auth.signOut();
      if (signOutErr) {
        console.warn('Rollback warning: could not sign out after failed signup', signOutErr.message);
      }
    }
  };

  try {
    setSignupUIBusy(true);

    // Quick pre-check for a friendlier message (DB unique index is still authoritative).
    const { data: existing, error: lookupErr } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (existing) { alert('Username already taken'); return; }

    // Deterministic internal email makes retries idempotent for the same username.
    const internalEmail = makeInternalEmail(username);

    let userId = null;

    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email: internalEmail,
      password
    });

    if (signUpErr) {
      const normalizedMessage = String(signUpErr.message || '').toLowerCase();
      const alreadyExists = normalizedMessage.includes('already') || normalizedMessage.includes('registered');

      if (!alreadyExists) throw signUpErr;

      // Existing auth account for this username key: try idempotent resume with provided password.
      const { data: resumeSignInData, error: resumeSignInErr } = await supabase.auth.signInWithPassword({
        email: internalEmail,
        password
      });
      if (resumeSignInErr) {
        throw new Error('Username already taken');
      }

      userId = resumeSignInData?.user?.id || null;
      signedIn = true;
    } else {
      if (!signUpData?.user?.id) {
        throw new Error('Signup failed: user account was not created.');
      }

      userId = signUpData.user.id;
      createdUserId = userId;

      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: internalEmail,
        password
      });
      if (signInErr) throw signInErr;
      if (!userId && signInData?.user?.id) userId = signInData.user.id;
      signedIn = true;
    }

    if (!userId) {
      const { data: meData, error: meErr } = await supabase.auth.getUser();
      if (meErr || !meData?.user?.id) {
        throw new Error('Signup failed: missing authenticated user context.');
      }
      userId = meData.user.id;
    }

    const { data: existingUserRow, error: existingUserRowErr } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (existingUserRowErr) throw existingUserRowErr;

    // Prior successful completion for this account: treat as idempotent success.
    if (existingUserRow) {
      window.location.href = './main.html';
      return;
    }

    // Upload custom pfp if provided
    let pfpURL = null;
    if (uploadedPFPFile) {
      const extMap = {
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/png': 'png',
        'image/jpeg': 'jpg'
      };
      const ext = extMap[uploadedPFPFile.type] || 'webp';
      const path = `${userId}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('group4-pfps')
        .upload(path, uploadedPFPFile);
      if (upErr) throw upErr;
      uploadedPfpPath = path;
      const { data: urlData } = supabase.storage.from('group4-pfps').getPublicUrl(path);
      pfpURL = urlData.publicUrl;
    }

    // Save user record
    const { error: dbErr } = await supabase.from('users').insert([{
      id:         userId,
      username,
      email:      internalEmail,
      pfp:        selectedPFP  || null,
      pfp_url:    pfpURL       || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }]);
    if (dbErr) {
      if (dbErr.code === '23505') {
        throw new Error('Username already taken');
      }
      throw dbErr;
    }
    insertedUserRow = true;

    window.location.href = './main.html';
  } catch (error) {
    await rollbackSignupArtifacts();
    console.error('Signup error:', error.message);
    alert(`Signup failed: ${error.message}`);
  } finally {
    setSignupUIBusy(false);
    signupInFlight = false;
  }
}

// ============================================
// 8. KEYBOARD SUBMISSION
// ============================================

function handleEnterKey(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (loginToggle.classList.contains('active')) handleLogin();
  else handleSignup();
}

function initializeFormSubmission() {
  document.querySelectorAll('input').forEach(input => {
    input.addEventListener('keydown', handleEnterKey);
  });
}

// ============================================
// 9. APP BOOTSTRAP
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  installPrettyAlerts({ baseUrl: import.meta.env.BASE_URL });

  document.documentElement.style.setProperty(
    '--bg-url',
    `url(${import.meta.env.BASE_URL}images/background.jpg)`
  );

  loadPFPGrid();
  initializeViews();
  initializePFPSelection();
  initializePFPUpload();
  initializeFormSubmission();
});