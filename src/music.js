// ============================================
// MUSIC.JS FILE MAP
// 0. IMPORTS
// 1. STATE
// 2. AUDIO INSTANCE
// 3. DOM REFERENCES
// 4. HELPERS
// 5. LOAD TRACKS
// 6. RENDER PLAYLIST
// 7. EDIT MODE HELPERS
// 8. PLAYBACK
// 9. BAR POSITION
// 10. UPLOAD
// 11. DELETE
// 12. DOWNLOAD PLAYLIST
// 13. PUBLIC INIT
// ============================================

// ============================================
// 0. IMPORTS
// ============================================
import { supabase } from './supabase-config.js';

// ============================================
// 1. STATE
// ============================================
let tracks       = [];
let currentIndex = -1;
let isPlaying    = false;
let currentUser     = null;
let currentUserData = null;
let barPosition  = localStorage.getItem('musicBarPosition') || 'bottom';
let isShuffled = false;
const LOOP_MODE_OFF = 'off';
const LOOP_MODE_TRACK = 'track';
const LOOP_MODE_PLAYLIST = 'playlist';
let loopMode = LOOP_MODE_OFF;
let isMusicEditMode = false;
let isMusicInitialized = false;
let scWidget = null;
let scWidgetIframe = null;
let scWidgetReady = false;
let scApiLoaded = false;
let scPendingAutoPlay = false;
let isUsingSoundCloudWidget = false;
let suppressAudioEnded = false;
let scCurrentDurationMs = 0;
let currentVolume = Number(localStorage.getItem('musicVolume') || '0.8');
let lastNonZeroVolume = 0.8;

const MUSIC_DBLCLICK_MS = 400;
const MUSIC_DEFAULT_VOLUME = 0.8;

// ============================================
// 2. AUDIO INSTANCE
// ============================================
const audio = new Audio();
audio.preload = 'none';

// ============================================
// 3. DOM REFERENCES
// ============================================
let musicBar, musicBarPfp, musicBarUsername, musicBarTitle, musicBarArtist, musicBarSep;
let musicPrev, musicPlayPause, musicNext, musicOpenPanel;
let musicPanelOverlay, musicPanelTitle, musicTrackList, musicDropZone;
let musicDownloadPlaylist, musicClosePanel;
let musicShuffle, musicLoop;
let musicVolumeWrap, musicVolumeBtn, musicVolumeSlider;

// ============================================
// 4. HELPERS
// ============================================
function getPlaylistTitle() {
  const month = new Date().toLocaleString('default', { month: 'long' }).toLowerCase();
  return `monkey ${month} music`;
}

function pfpSrcFor(userRow) {
  const fallback = './images/pfps/default.png';
  if (!userRow) return fallback;
  return userRow.pfp_url || (userRow.pfp ? `./images/pfps/${userRow.pfp}` : fallback);
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeSoundCloudUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return String(rawUrl || '').trim();
  }
}

function clampVolume(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return MUSIC_DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, numeric));
}

function getTrackAudioUrl(track) {
  return track?.stream_url || track?.file_url || '';
}

function normalizeTrackMetadata(rawTitle, rawArtist) {
  let title = String(rawTitle || '').trim() || 'Untitled';
  let artist = String(rawArtist || '').trim();

  // SoundCloud oEmbed titles are often "Song by Artist"; split this so UI doesn't duplicate artist.
  const byMatch = title.match(/^(.*)\s+by\s+(.+)$/i);
  if (byMatch) {
    const splitTitle = byMatch[1].trim();
    const splitArtist = byMatch[2].trim();
    const normalizedArtist = artist.toLowerCase();

    if (!artist) {
      title = splitTitle || title;
      artist = splitArtist;
    } else if (normalizedArtist === splitArtist.toLowerCase()) {
      title = splitTitle || title;
    }
  }

  return { title, artist };
}

function getTrackDisplayMeta(track) {
  return normalizeTrackMetadata(track?.title, track?.artist);
}

function getRandomTrackIndexExcept(excludedIndex) {
  if (tracks.length === 0) return -1;
  if (tracks.length === 1) return 0;

  let next = excludedIndex;
  while (next === excludedIndex) {
    next = Math.floor(Math.random() * tracks.length);
  }
  return next;
}

function getNextTrackIndex() {
  if (tracks.length === 0) return -1;

  if (isShuffled) {
    return getRandomTrackIndexExcept(currentIndex);
  }

  const baseIndex = currentIndex < 0 ? 0 : currentIndex + 1;
  if (baseIndex < tracks.length) return baseIndex;

  return loopMode === LOOP_MODE_PLAYLIST ? 0 : -1;
}

function getPreviousTrackIndex() {
  if (tracks.length === 0) return -1;

  if (isShuffled) {
    return getRandomTrackIndexExcept(currentIndex);
  }

  if (currentIndex > 0) return currentIndex - 1;
  return loopMode === LOOP_MODE_PLAYLIST ? tracks.length - 1 : -1;
}

function isCurrentAudioTrackLoaded(track) {
  const trackUrl = getTrackAudioUrl(track);
  if (!trackUrl) return false;

  const currentSrc = audio.currentSrc || audio.src || '';
  return currentSrc === trackUrl || currentSrc.includes(trackUrl);
}

function updateVolumeUi() {
  if (musicVolumeSlider) {
    musicVolumeSlider.value = String(Math.round(currentVolume * 100));
  }

  if (musicVolumeBtn) {
    musicVolumeBtn.textContent = currentVolume === 0 ? 'mute' : 'vol';
    musicVolumeBtn.classList.toggle('active', currentVolume > 0);
  }
}

function setPlaybackVolume(volume, { persist = true } = {}) {
  currentVolume = clampVolume(volume);
  audio.volume = currentVolume;

  if (currentVolume > 0) {
    lastNonZeroVolume = currentVolume;
  }

  if (scWidget) {
    scWidget.setVolume(Math.round(currentVolume * 100));
  }

  if (persist) {
    localStorage.setItem('musicVolume', String(currentVolume));
  }

  updateVolumeUi();
}

function restartCurrentTrack() {
  if (currentIndex < 0 || currentIndex >= tracks.length) return;

  const track = tracks[currentIndex];
  const isCurrentTrackSoundCloud = !!track?.soundcloud_url;

  if (isCurrentTrackSoundCloud && scWidget && isUsingSoundCloudWidget) {
    scWidget.seekTo(0);
    scWidget.play();
    isPlaying = true;
    updateBarDisplay();
    return;
  }

  if (!isCurrentAudioTrackLoaded(track)) {
    playTrack(currentIndex);
    return;
  }

  audio.currentTime = 0;
  audio.play()
    .then(() => {
      isPlaying = true;
      updateBarDisplay();
    })
    .catch((err) => {
      console.error('Repeat-one restart failed, reloading track:', err);
      playTrack(currentIndex);
    });
}

function advanceToNextTrack({ fromEnded = false } = {}) {
  if (tracks.length === 0) {
    isPlaying = false;
    currentIndex = -1;
    updateBarDisplay();
    return;
  }

  if (fromEnded && loopMode === LOOP_MODE_TRACK && currentIndex >= 0) {
    restartCurrentTrack();
    return;
  }

  const next = getNextTrackIndex();
  if (next === -1) {
    isPlaying = false;
    currentIndex = -1;
    updateBarDisplay();
    return;
  }

  playTrack(next);
}

function updatePlaybackModeButtons() {
  if (musicShuffle) {
    musicShuffle.classList.toggle('active', isShuffled);
    musicShuffle.title = isShuffled ? 'shuffle: on' : 'shuffle: off';
    musicShuffle.setAttribute('aria-label', musicShuffle.title);
  }

  if (musicLoop) {
    const isRepeatOn = loopMode !== LOOP_MODE_OFF;
    musicLoop.classList.toggle('active', isRepeatOn);

    if (loopMode === LOOP_MODE_TRACK) {
      musicLoop.textContent = '↺1';
      musicLoop.title = 'repeat: song';
    } else if (loopMode === LOOP_MODE_PLAYLIST) {
      musicLoop.textContent = '↺all';
      musicLoop.title = 'repeat: playlist';
    } else {
      musicLoop.textContent = '↺';
      musicLoop.title = 'repeat: off';
    }

    musicLoop.setAttribute('aria-label', musicLoop.title);
  }
}

function loadSoundCloudApi() {
  if (scApiLoaded && window.SC?.Widget) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-soundcloud-widget="1"]');
    if (existing) {
      existing.addEventListener('load', () => {
        scApiLoaded = true;
        resolve();
      }, { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load SoundCloud Widget API')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://w.soundcloud.com/player/api.js';
    script.async = true;
    script.dataset.soundcloudWidget = '1';
    script.onload = () => {
      scApiLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load SoundCloud Widget API'));
    document.head.appendChild(script);
  });
}

async function ensureSoundCloudWidget() {
  if (scWidget && scWidgetReady) return;

  await loadSoundCloudApi();

  if (!scWidgetIframe) {
    const bootstrapTrack = 'https://soundcloud.com/forss/flickermood';
    scWidgetIframe = document.createElement('iframe');
    scWidgetIframe.id = 'musicSoundCloudWidget';
    scWidgetIframe.title = 'SoundCloud widget';
    scWidgetIframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(bootstrapTrack)}`;
    scWidgetIframe.width = '1';
    scWidgetIframe.height = '1';
    scWidgetIframe.allow = 'autoplay; encrypted-media';
    scWidgetIframe.style.position = 'fixed';
    scWidgetIframe.style.left = '-9999px';
    scWidgetIframe.style.top = '-9999px';
    scWidgetIframe.style.border = '0';
    document.body.appendChild(scWidgetIframe);
  }

  if (!scWidget) {
    scWidget = window.SC.Widget(scWidgetIframe);
    scWidget.bind(window.SC.Widget.Events.READY, () => {
      scWidgetReady = true;
      setPlaybackVolume(currentVolume, { persist: false });
      if (scPendingAutoPlay) {
        scPendingAutoPlay = false;
        scWidget.play();
      }
    });
    scWidget.bind(window.SC.Widget.Events.PLAY, () => {
      isPlaying = true;
      isUsingSoundCloudWidget = true;
      scWidget.getDuration((ms) => {
        scCurrentDurationMs = Number(ms) || 0;
      });
      updateBarDisplay();
    });
    scWidget.bind(window.SC.Widget.Events.PAUSE, () => {
      isPlaying = false;
      updateBarDisplay();
    });
    scWidget.bind(window.SC.Widget.Events.FINISH, () => {
      // Many licensed tracks are preview-only on SoundCloud embeds.
      if (scCurrentDurationMs > 0 && scCurrentDurationMs < 30000) {
        alert('This SoundCloud track appears to be preview-only in embeds. Try another link.');
      }
      advanceToNextTrack({ fromEnded: true });
    });
    scWidget.bind(window.SC.Widget.Events.ERROR, () => {
      isPlaying = false;
      updateBarDisplay();
      alert('SoundCloud could not play this track. Try another link.');
    });
  }
}

async function playSoundCloudTrack(soundcloudUrl) {
  if (!soundcloudUrl) throw new Error('Missing SoundCloud URL');
  const normalizedUrl = normalizeSoundCloudUrl(soundcloudUrl);
  await ensureSoundCloudWidget();
  scWidgetReady = false;
  scCurrentDurationMs = 0;
  scPendingAutoPlay = true;
  scWidget.load(normalizedUrl, {
    auto_play: true,
    buying: false,
    sharing: false,
    download: false,
    show_artwork: false,
    show_comments: false,
    show_playcount: false,
    show_user: false,
    visual: false
  });
}

function stopAllPlayback() {
  if (isUsingSoundCloudWidget && scWidget) {
    scWidget.pause();
  }
  if (!audio.paused) {
    audio.pause();
  }
}

// ============================================
// 5. LOAD TRACKS
// ============================================
export async function loadTracks() {
  const { data, error } = await supabase
    .from('music_tracks')
    .select('*')
    .eq('group_id', 'group4')
    .order('created_at', { ascending: true });

  if (error) { console.error('Failed to load tracks:', error); return; }

  const userIds = [...new Set((data || []).map(t => t.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, username, pfp, pfp_url')
      .in('id', userIds);
    (users || []).forEach(u => { userMap[u.id] = u; });
  }

  tracks = (data || []).map(t => ({ ...t, users: userMap[t.user_id] || null }));

  if (tracks.length === 0) {
    currentIndex = -1;
  } else if (currentIndex < 0 || currentIndex >= tracks.length) {
    currentIndex = 0;
  }

  renderTrackList();
  updateBarDisplay();
}

// ============================================
// 6. RENDER PLAYLIST
// ============================================
function renderTrackList() {
  if (!musicTrackList) return;
  musicTrackList.innerHTML = '';

  // In edit mode only show the signed-in user's own tracks
  const visibleTracks = isMusicEditMode
    ? tracks.filter(t => currentUserData?.is_admin || t.user_id === currentUser?.id)
    : tracks;

  if (visibleTracks.length === 0) {
    musicTrackList.innerHTML = `<div class="music-empty">${
      isMusicEditMode ? 'no tracks to edit' : 'no tracks yet — add a soundcloud link above'
    }</div>`;
    return;
  }

  visibleTracks.forEach((track) => {
    const idx      = tracks.indexOf(track);
    const isActive = idx === currentIndex;
    const displayMeta = getTrackDisplayMeta(track);

    const row = document.createElement('div');
    row.className   = `music-track-row${isActive ? ' active' : ''}${isMusicEditMode ? ' edit-mode' : ''}`;
    row.dataset.idx     = idx;
    row.dataset.trackId = track.id;

    if (isMusicEditMode) {
      // ── Edit-mode row: delete button only (no rename) ──
      row.innerHTML = `
        <img class="music-track-pfp" src="${pfpSrcFor(track.users)}" alt="">
        <div class="music-track-info">
          <span class="music-track-title">${escAttr(displayMeta.title)}</span>
          ${displayMeta.artist ? `<span class="music-track-artist">${escAttr(displayMeta.artist)}</span>` : ''}
        </div>
        <div class="music-track-actions">
          <button class="music-track-btn music-delete-btn">delete</button>
        </div>
      `;

      row.querySelector('.music-delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTrack(track.id, idx);
      });

      // Row click in edit mode does nothing
      row.addEventListener('click', e => e.stopPropagation());

    } else {
      // ── Normal row: pfp + title/artist, click to play ──
      row.innerHTML = `
        <img class="music-track-pfp" src="${pfpSrcFor(track.users)}" alt="">
        <div class="music-track-info">
          <span class="music-track-title">${escAttr(displayMeta.title)}</span>
          ${displayMeta.artist ? `<span class="music-track-artist">${escAttr(displayMeta.artist)}</span>` : ''}
        </div>
      `;

      row.addEventListener('click', () => playTrack(idx));
    }

    musicTrackList.appendChild(row);
  });
}

// ============================================
// 7. EDIT MODE HELPERS
// ============================================
// Exit edit mode - no longer renames tracks (delete only)
async function exitMusicEditMode() {
  isMusicEditMode = false;
  const musicPanel = document.querySelector('.music-panel');
  if (musicPanel) musicPanel.classList.remove('edit-mode');
  musicPanelTitle.textContent = getPlaylistTitle();
  renderTrackList();
  updateBarDisplay();
}

// ============================================
// 8. PLAYBACK
// ============================================
async function playTrack(idx) {
  if (idx < 0 || idx >= tracks.length) return;
  currentIndex = idx;
  const track = tracks[idx];
  suppressAudioEnded = true;
  stopAllPlayback();
  suppressAudioEnded = false;

  if (track.soundcloud_url) {
    try {
      audio.pause();
      audio.src = '';
      await playSoundCloudTrack(track.soundcloud_url);
      isUsingSoundCloudWidget = true;
      isPlaying = true;
    } catch (err) {
      console.error('SoundCloud playback error:', err);
      isUsingSoundCloudWidget = false;
      isPlaying = false;
      alert('Could not start SoundCloud playback.');
    }
  } else if (track.stream_url || track.file_url) {
    isUsingSoundCloudWidget = false;
    audio.src = getTrackAudioUrl(track);
    setPlaybackVolume(currentVolume, { persist: false });
    try {
      await audio.play();
      isPlaying = true;
    } catch (err) {
      console.error(err);
      isPlaying = false;
      updateBarDisplay();
    }
  } else {
    isPlaying = false;
  }

  updateBarDisplay();
  renderTrackList();
}

function updateBarDisplay() {
  if (!musicBarTitle) return;
  const track = tracks[currentIndex];

  if (track) {
    const displayMeta = getTrackDisplayMeta(track);
    musicBarTitle.textContent    = displayMeta.title;
    musicBarArtist.textContent   = displayMeta.artist;
    musicBarSep.style.display    = displayMeta.artist ? 'inline' : 'none';
    musicBarPfp.src              = pfpSrcFor(track.users);
    musicBarUsername.textContent = track.users?.username || '—';
  } else {
    musicBarTitle.textContent    = 'no track';
    musicBarArtist.textContent   = '';
    musicBarSep.style.display    = 'none';
    musicBarPfp.src              = './images/pfps/default.png';
    musicBarUsername.textContent = '—';
  }

  musicPlayPause.textContent = isPlaying ? '||' : '▷';
}

// ============================================
// 9. BAR POSITION
// ============================================
function applyBarPosition() {
  const BAR_H = '44px';
  if (barPosition === 'top') {
    musicBar.style.top           = '0';
    musicBar.style.bottom        = 'auto';
    document.body.style.paddingTop    = BAR_H;
    document.body.style.paddingBottom = '';
  } else {
    musicBar.style.bottom        = '0';
    musicBar.style.top           = 'auto';
    document.body.style.paddingBottom = BAR_H;
    document.body.style.paddingTop    = '';
  }
}

// ============================================
// 10. SOUNDCLOUD URL HANDLER
// ============================================
async function addSoundCloudTrack(soundcloudUrl) {
  const url = soundcloudUrl.trim();
  if (!url) { alert('Please enter a SoundCloud URL'); return; }
  const normalizedUrl = normalizeSoundCloudUrl(url);

  const btn = document.getElementById('musicDownloadPlaylist');
  btn.disabled = true;

  try {
    // Fetch metadata from SoundCloud oEmbed (no API key required)
    const oembed = new URL('https://soundcloud.com/oembed');
    oembed.searchParams.set('format', 'json');
    oembed.searchParams.set('url', normalizedUrl);

    const oembedResp = await fetch(oembed.toString());
    if (!oembedResp.ok) throw new Error(`oEmbed failed: ${oembedResp.status}`);
    const oembedData = await oembedResp.json();

    const parsed = normalizeTrackMetadata(oembedData.title, oembedData.author_name || 'Unknown Artist');
    const title = parsed.title;
    const artist = parsed.artist;
    const thumbnail = oembedData.thumbnail_url || '';

    // Insert into Supabase (no stream_url - SoundCloud opens in new window)
    const { error: dbErr } = await supabase
      .from('music_tracks')
      .insert([{
        group_id: 'group4',
        user_id:  currentUser.id,
        title,
        artist,
        soundcloud_url: normalizedUrl,
        thumbnail_url: thumbnail
      }]);

    if (dbErr) throw dbErr;

    const urlInput = document.querySelector('input[placeholder="paste soundcloud link"]');
    if (urlInput) urlInput.value = '';
    await loadTracks();
  } catch (error) {
    console.error('SoundCloud add error:', error);
    alert(`Failed to add track: ${error.message || error}`);
  } finally {
    btn.disabled = false;
  }
}



// ============================================
// 11. DELETE
// ============================================
async function deleteTrack(trackId, idx) {
  const { error } = await supabase
    .from('music_tracks')
    .delete()
    .eq('id', trackId)
    .eq('user_id', currentUser.id);

  if (error) { alert(`Delete failed: ${error.message}`); return; }

  if (idx === currentIndex) {
    stopAllPlayback();
    audio.src = '';
    isPlaying    = false;
    isUsingSoundCloudWidget = false;
    currentIndex = -1;
    updateBarDisplay();
  } else if (idx < currentIndex) {
    currentIndex--;
  }

  await loadTracks();
}

// ============================================
// 12. DOWNLOAD PLAYLIST AS CSV
// ============================================
async function downloadPlaylistAsCSV() {
  if (tracks.length === 0) { alert('No tracks to download'); return; }

  const btn = document.getElementById('musicDownloadPlaylist');
  const title = getPlaylistTitle();

  try {
    btn.textContent = '… exporting';
    btn.disabled = true;

    // Build CSV with BOM for Excel compatibility
    const BOM = '\uFEFF';
    const headers = ['title', 'artist', 'soundcloud_url', 'thumbnail'];
    let csv = BOM + headers.join(',') + '\n';

    for (const track of tracks) {
      const row = [
        `"${(track.title || '').replace(/"/g, '""')}"`,
        `"${(track.artist || '').replace(/"/g, '""')}"`,
        `"${(track.soundcloud_url || '').replace(/"/g, '""')}"`,
        `"${(track.thumbnail_url || '').replace(/"/g, '""')}"`
      ].join(',');
      csv += row + '\n';
    }

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);

    alert(`Playlist exported: ${tracks.length} tracks.`);
  } catch (err) {
    console.error('CSV export error:', err);
    alert(`Export failed: ${err.message || err}`);
  } finally {
    btn.textContent = '⤓ playlist';
    btn.disabled = false;
  }
}

// ============================================
// 13. PUBLIC INIT
// ============================================
export async function initMusic(user, userData) {
  currentUser     = user;
  currentUserData = userData;

  if (isMusicInitialized) {
    await loadTracks();
    return;
  }

  musicBar              = document.getElementById('musicBar');
  musicBarPfp           = document.getElementById('musicBarPfp');
  musicBarUsername      = document.getElementById('musicBarUsername');
  musicBarTitle         = document.getElementById('musicBarTitle');
  musicBarArtist        = document.getElementById('musicBarArtist');
  musicBarSep           = document.getElementById('musicBarSep');
  musicPrev             = document.getElementById('musicPrev');
  musicPlayPause        = document.getElementById('musicPlayPause');
  musicNext             = document.getElementById('musicNext');
  musicOpenPanel        = document.getElementById('musicOpenPanel');
  musicPanelOverlay     = document.getElementById('musicPanelOverlay');
  musicPanelTitle       = document.getElementById('musicPanelTitle');
  musicTrackList        = document.getElementById('musicTrackList');
  musicDropZone         = document.getElementById('musicDropZone');
  musicDownloadPlaylist = document.getElementById('musicDownloadPlaylist');
  musicClosePanel       = document.getElementById('musicClosePanel');
  musicShuffle = document.getElementById('musicShuffle');
  musicLoop    = document.getElementById('musicLoop');
  const musicPanel = document.querySelector('.music-panel');

  const requiredNodes = [
    musicBar,
    musicBarPfp,
    musicBarUsername,
    musicBarTitle,
    musicBarArtist,
    musicBarSep,
    musicPrev,
    musicPlayPause,
    musicNext,
    musicOpenPanel,
    musicPanelOverlay,
    musicPanelTitle,
    musicTrackList,
    musicDropZone,
    musicDownloadPlaylist,
    musicClosePanel,
    musicShuffle,
    musicLoop,
    musicPanel
  ];

  if (requiredNodes.some((node) => !node)) {
    console.error('Music UI initialization failed: missing required DOM elements.');
    return;
  }

  isMusicInitialized = true;

  musicPanelTitle.textContent = getPlaylistTitle();
  applyBarPosition();

  currentVolume = clampVolume(currentVolume);
  if (currentVolume > 0) {
    lastNonZeroVolume = currentVolume;
  }
  setPlaybackVolume(currentVolume, { persist: false });

  musicVolumeWrap = document.createElement('div');
  musicVolumeWrap.className = 'music-volume-wrap';

  musicVolumeBtn = document.createElement('button');
  musicVolumeBtn.className = 'music-ctrl-btn music-volume-btn';
  musicVolumeBtn.type = 'button';

  musicVolumeSlider = document.createElement('input');
  musicVolumeSlider.className = 'music-volume-slider';
  musicVolumeSlider.type = 'range';
  musicVolumeSlider.min = '0';
  musicVolumeSlider.max = '100';
  musicVolumeSlider.step = '1';

  musicVolumeWrap.appendChild(musicVolumeBtn);
  musicVolumeWrap.appendChild(musicVolumeSlider);
  musicBar.insertBefore(musicVolumeWrap, musicOpenPanel);

  updateVolumeUi();
  updatePlaybackModeButtons();

  musicVolumeSlider.addEventListener('input', (e) => {
    const nextVolume = Number(e.target.value) / 100;
    setPlaybackVolume(nextVolume);
  });

  musicVolumeBtn.addEventListener('click', () => {
    if (currentVolume === 0) {
      setPlaybackVolume(lastNonZeroVolume || MUSIC_DEFAULT_VOLUME);
    } else {
      setPlaybackVolume(0);
    }
  });

  // ── Double right-click on music panel toggles edit mode ──
  let lastMusicRightClick = 0;

  musicPanel.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    if (now - lastMusicRightClick < MUSIC_DBLCLICK_MS) {
      lastMusicRightClick = 0;
      if (isMusicEditMode) {
        exitMusicEditMode();
      } else {
        isMusicEditMode = true;
        musicPanel.classList.add('edit-mode');
        musicPanelTitle.textContent = getPlaylistTitle() + ' · editing';
        renderTrackList();
      }
    } else {
      lastMusicRightClick = now;
    }
  });

  // ── Audio events ──
  audio.addEventListener('ended', () => {
    if (suppressAudioEnded) return;
    if (isUsingSoundCloudWidget) return;
    advanceToNextTrack({ fromEnded: true });
  });
  audio.addEventListener('play',  () => { isPlaying = true;  updateBarDisplay(); });
  audio.addEventListener('pause', () => { isPlaying = false; updateBarDisplay(); });

  // ── Controls ──
  musicPrev.addEventListener('click', () => {
    const prev = getPreviousTrackIndex();
    if (prev !== -1) playTrack(prev);
  });
  musicNext.addEventListener('click', () => {
    const next = getNextTrackIndex();
    if (next !== -1) playTrack(next);
  });
  musicPlayPause.addEventListener('click', () => {
    if (tracks.length === 0) return;
    if (currentIndex === -1) {
      playTrack(0);
      return;
    }

    const currentTrack = tracks[currentIndex];
    const isCurrentTrackSoundCloud = !!currentTrack?.soundcloud_url;

    if (isPlaying) {
      if (isCurrentTrackSoundCloud && scWidget) {
        scWidget.pause();
      } else {
        audio.pause();
      }
      return;
    }

    if (isCurrentTrackSoundCloud) {
      if (scWidget && isUsingSoundCloudWidget) {
        scWidget.play();
      } else {
        playTrack(currentIndex);
      }
      return;
    }

    if (!isCurrentAudioTrackLoaded(currentTrack)) {
      playTrack(currentIndex);
      return;
    }

    audio.play().catch((err) => {
      console.error(err);
      isPlaying = false;
      updateBarDisplay();
    });
  });

  musicOpenPanel.addEventListener('click', () => {
    musicPanelOverlay.classList.add('open');
  });
  musicClosePanel.addEventListener('click', () => {
    if (isMusicEditMode) exitMusicEditMode();
    musicPanelOverlay.classList.remove('open');
  });
  musicPanelOverlay.addEventListener('click', (e) => {
    if (e.target === musicPanelOverlay) {
      if (isMusicEditMode) exitMusicEditMode();
      musicPanelOverlay.classList.remove('open');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && musicPanelOverlay.classList.contains('open')) {
      if (isMusicEditMode) exitMusicEditMode();
      musicPanelOverlay.classList.remove('open');
    }
  });

  musicDownloadPlaylist.addEventListener('click', downloadPlaylistAsCSV);

  // ── SoundCloud quick controls ──
  const buttonRow = document.createElement('div');
  buttonRow.className = 'music-link-controls';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'music-link-btn';
  addBtn.textContent = 'add track';

  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.className = 'music-link-inline-input';
  addInput.placeholder = 'paste soundcloud link + enter';

  const searchBtn = document.createElement('button');
  searchBtn.type = 'button';
  searchBtn.className = 'music-link-btn';
  searchBtn.textContent = 'search';

  buttonRow.appendChild(addBtn);
  buttonRow.appendChild(addInput);
  buttonRow.appendChild(searchBtn);

  function showAddInput() {
    addBtn.classList.add('hidden');
    addInput.classList.add('is-visible');
    addInput.focus();
  }

  function hideAddInput() {
    addInput.value = '';
    addInput.classList.remove('is-visible');
    addBtn.classList.remove('hidden');
  }

  // Replace drop zone content with quick controls
  musicDropZone.innerHTML = '';
  musicDropZone.appendChild(buttonRow);

  addBtn.addEventListener('click', () => {
    showAddInput();
  });

  addInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = addInput.value.trim();
      if (!value) return;
      await addSoundCloudTrack(value);
      hideAddInput();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      hideAddInput();
    }
  });

  addInput.addEventListener('blur', () => {
    if (!addInput.value.trim()) {
      hideAddInput();
    }
  });

  searchBtn.addEventListener('click', () => {
    const query = addInput.classList.contains('is-visible')
      ? (addInput.value.trim() || 'music')
      : 'music';
    window.open(`https://soundcloud.com/search?q=${encodeURIComponent(query)}`, '_blank');
  });

  musicShuffle.addEventListener('click', () => {
    isShuffled = !isShuffled;
    updatePlaybackModeButtons();
  });

  musicLoop.addEventListener('click', () => {
    if (loopMode === LOOP_MODE_OFF) {
      loopMode = LOOP_MODE_TRACK;
    } else if (loopMode === LOOP_MODE_TRACK) {
      loopMode = LOOP_MODE_PLAYLIST;
    } else {
      loopMode = LOOP_MODE_OFF;
    }

    updatePlaybackModeButtons();
  });

  await loadTracks();
}