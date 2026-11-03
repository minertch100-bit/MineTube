// ============================================
// IndexedDB - تخزين الفيديوهات
// ============================================
let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);
    const req = indexedDB.open('ytAppDB', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos');
    };
    req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function saveVideoBlob(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', 'readwrite');
    tx.objectStore('videos').put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getVideoBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', 'readonly');
    const req = tx.objectStore('videos').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function deleteVideoBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', 'readwrite');
    tx.objectStore('videos').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ============================================
// الأمان - تشفير كلمات المرور (SHA-256)
// ============================================
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'yt_salt_2024_secure');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// تنظيف النصوص من XSS
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ============================================
// نظام التخزين
// ============================================
const DB = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; }
    catch (e) { return null; }
  },
  set(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  remove(key) { localStorage.removeItem(key); }
};

// ============================================
// الحالة
// ============================================
const state = {
  user: DB.get('session') || null, // جلسة فقط بدون كلمة مرور
  videos: DB.get('videos') || [],
  history: DB.get('history') || [],
  liked: DB.get('liked') || [],
  channels: DB.get('channels') || [],
  subscriptions: DB.get('subscriptions') || [],
  comments: DB.get('comments') || [],
  viewLog: DB.get('viewLog') || {}, // لمنع التكرار
  currentCategory: 'الكل',
  currentSearch: '',
  currentPage: 'home',
  currentVideoId: null,
  editingVideoId: null,
  editThumbData: null,
  viewedVideo: null,
  viewCounted: false,
  currentChannelView: null,
  videoBlobUrls: {} // لحفظ الروابط من الإلغاء
};

function saveState() {
  DB.set('session', state.user);
  DB.set('videos', state.videos);
  DB.set('history', state.history);
  DB.set('liked', state.liked);
  DB.set('channels', state.channels);
  DB.set('subscriptions', state.subscriptions);
  DB.set('comments', state.comments);
  DB.set('viewLog', state.viewLog);
}

// ============================================
// أدوات
// ============================================
function formatViews(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + ' مليون مشاهدة';
  if (n >= 1000) return (n / 1000).toFixed(1) + ' ألف مشاهدة';
  return n + ' مشاهدة';
}

function formatTime(ts) {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day > 30) return 'قبل ' + Math.floor(day / 30) + ' شهر';
  if (day > 0) return 'قبل ' + day + ' يوم';
  if (hr > 0) return 'قبل ' + hr + ' ساعة';
  if (min > 0) return 'قبل ' + min + ' دقيقة';
  return 'الآن';
}

const $ = (id) => document.getElementById(id);

// ============================================
// Toast Notifications (بديل alert)
// ============================================
function showToast(message, type = 'info', duration = 3000) {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============================================
// Modal
// ============================================
function openModal(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); }

// ============================================
// التنقل
// ============================================
function showPage(pageName) {
  // إيقاف الفيديو عند المغادرة
  if (state.currentPage === 'watch' && pageName !== 'watch') {
    const player = $('mainVideo');
    if (player) player.pause();
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = $('page-' + pageName);
  if (page) page.classList.add('active');

  document.querySelectorAll('.side-item[data-page]').forEach(i => i.classList.remove('active'));
  const sideItem = document.querySelector(`.side-item[data-page="${pageName}"]`);
  if (sideItem) sideItem.classList.add('active');

  state.currentPage = pageName;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (pageName === 'history') renderHistory();
  if (pageName === 'liked') renderLiked();
  if (pageName === 'myvideos') renderMyVideos();
  if (pageName === 'channel-settings') loadChannelSettings();
  if (pageName === 'app-settings') loadAppSettings();
  if (pageName === 'shorts') renderShorts();
  if (pageName === 'home') filterAndRender();
}

document.querySelectorAll('.side-item[data-page]').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    showPage(item.dataset.page);
    if (window.innerWidth <= 900) closeSidebar();
  });
});

$('logoBtn').addEventListener('click', (e) => {
  e.preventDefault();
  showPage('home');
});

// ============================================
// عرض الفيديوهات
// ============================================
function renderVideos(list, container) {
  container.innerHTML = '';
  if (list.length === 0) return false;

  list.forEach((video, index) => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.style.animationDelay = `${Math.min(index * 0.05, 0.5)}s`;

    const channel = state.channels.find(c => c.id === video.channelId);
    let avatarHtml;
    if (channel && channel.avatar && channel.avatar.startsWith('data:')) {
      avatarHtml = `<img src="${channel.avatar}" alt="">`;
    } else {
      avatarHtml = sanitize(video.avatar || video.channel[0]);
    }

    card.innerHTML = `
      <div class="thumb">
        <img src="${sanitize(video.thumb)}" alt="${sanitize(video.title)}" loading="lazy">
        <span class="duration">${sanitize(video.duration || '0:00')}</span>
      </div>
      <div class="video-info">
        <div class="channel-avatar" data-channel="${sanitize(video.channelId)}">${avatarHtml}</div>
        <div class="video-text">
          <h3>${sanitize(video.title)}</h3>
          <p class="channel-name">${sanitize(video.channel)}</p>
          <p class="meta">${formatViews(video.views)} • ${formatTime(video.time)}</p>
        </div>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.channel-avatar')) {
        openChannelPage(video.channelId);
      } else {
        openWatchPage(video.id);
      }
    });
    container.appendChild(card);
  });
  return true;
}

function filterAndRender() {
  let filtered = state.videos.filter(v => v.privacy !== 'private' || v.ownerId === state.user?.id);
  if (state.currentCategory !== 'الكل') {
    filtered = filtered.filter(v => v.category === state.currentCategory);
  }
  if (state.currentSearch) {
    const q = state.currentSearch.toLowerCase();
    filtered = filtered.filter(v =>
      v.title.toLowerCase().includes(q) ||
      v.channel.toLowerCase().includes(q) ||
      (v.description && v.description.toLowerCase().includes(q))
    );
  }
  filtered.sort((a, b) => b.time - a.time);
  const hasResults = renderVideos(filtered, $('videoGrid'));
  $('emptyState').style.display = hasResults ? 'none' : 'block';
}

// البحث
let searchTimeout;
$('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.currentSearch = e.target.value.trim();
    if (state.currentPage !== 'home') showPage('home');
    filterAndRender();
  }, 200);
});
$('searchBtn').addEventListener('click', () => {
  state.currentSearch = $('searchInput').value.trim();
  if (state.currentPage !== 'home') showPage('home');
  filterAndRender();
});
$('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    state.currentSearch = $('searchInput').value.trim();
    if (state.currentPage !== 'home') showPage('home');
    filterAndRender();
    $('searchInput').blur();
  }
});

// التصنيفات
$('chipsBar').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $('chipsBar').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  state.currentCategory = chip.dataset.cat;
  state.currentSearch = '';
  $('searchInput').value = '';
  if (state.currentPage !== 'home') showPage('home');
  filterAndRender();
});

// الشريط الجانبي
function openSidebar() {
  $('sidebar').classList.add('open');
  $('sidebar').classList.remove('hidden');
  $('overlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  if (window.innerWidth > 900) $('sidebar').classList.add('hidden');
  $('overlay').classList.remove('show');
  document.body.style.overflow = '';
}
$('menuBtn').addEventListener('click', () => {
  if (window.innerWidth <= 900) {
    $('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
  } else {
    $('sidebar').classList.toggle('hidden');
  }
});
$('overlay').addEventListener('click', closeSidebar);
$('mobileSearchBtn').addEventListener('click', () => {
  $('navCenter').classList.toggle('active');
  if ($('navCenter').classList.contains('active')) $('searchInput').focus();
});

// ============================================
// صفحة القناة
// ============================================
function openChannelPage(channelId) {
  const channel = state.channels.find(c => c.id === channelId);
  if (!channel) { showToast('القناة غير موجودة', 'error'); return; }
  state.currentChannelView = channelId;
  showPage('channel');
  renderChannelPage(channel);
}

function renderChannelPage(channel) {
  const banner = $('channelBanner');
  if (channel.banner && channel.banner.startsWith('data:')) {
    banner.style.backgroundImage = `url(${channel.banner})`;
    banner.style.backgroundSize = 'cover';
  } else {
    banner.style.backgroundImage = '';
    banner.style.background = 'linear-gradient(135deg, #3ea6ff 0%, #6c5ce7 100%)';
  }

  const avatar = $('channelPageAvatar');
  if (channel.avatar && channel.avatar.startsWith('data:')) {
    avatar.innerHTML = `<img src="${channel.avatar}" alt="">`;
  } else {
    avatar.textContent = sanitize(channel.name[0]);
  }

  $('channelPageName').textContent = channel.name;
  const subsCount = state.subscriptions.filter(s => s.channelId === channel.id).length;
  const vidsCount = state.videos.filter(v => v.channelId === channel.id && v.privacy !== 'private').length;
  $('channelPageStats').textContent = `${subsCount} مشترك • ${vidsCount} فيديو`;
  $('channelPageDesc').textContent = channel.desc || 'لا يوجد وصف';

  const subBtn = $('channelPageSubBtn');
  const isOwn = state.user && state.user.channelId === channel.id;
  if (isOwn) {
    subBtn.style.display = 'none';
  } else {
    subBtn.style.display = '';
    const isSubbed = state.user && state.subscriptions.find(s => s.channelId === channel.id && s.userId === state.user.id);
    subBtn.textContent = isSubbed ? 'مشترك' : 'اشتراك';
    subBtn.classList.toggle('subscribed', !!isSubbed);
    subBtn.onclick = () => toggleSubscribe(channel.id);
  }

  const vids = state.videos.filter(v => v.channelId === channel.id && v.privacy !== 'private');
  renderVideos(vids, $('channelVideosGrid'));

  const shorts = vids.filter(v => v.isShort);
  const shortsGrid = $('channelShortsGrid');
  shortsGrid.innerHTML = '';
  if (shorts.length === 0) {
    shortsGrid.innerHTML = '<p style="color:#aaa;">لا توجد شورتس</p>';
  } else {
    shorts.forEach(s => {
      const card = document.createElement('div');
      card.className = 'short-card';
      card.innerHTML = `<img src="${sanitize(s.thumb)}" alt="${sanitize(s.title)}"><div class="short-info">${sanitize(s.title)}</div>`;
      card.addEventListener('click', () => openWatchPage(s.id));
      shortsGrid.appendChild(card);
    });
  }

  const totalViews = state.videos.filter(v => v.channelId === channel.id).reduce((sum, v) => sum + (v.views || 0), 0);
  $('channelAboutBox').innerHTML = `
    <h3>الوصف</h3>
    <p>${sanitize(channel.desc || 'لا يوجد وصف')}</p>
    <h3 style="margin-top:16px;">معلومات</h3>
    <div class="about-item"><span class="about-label">عدد المشتركين</span><span>${subsCount}</span></div>
    <div class="about-item"><span class="about-label">عدد الفيديوهات</span><span>${vidsCount}</span></div>
    <div class="about-item"><span class="about-label">إجمالي المشاهدات</span><span>${totalViews.toLocaleString()}</span></div>
    <div class="about-item"><span class="about-label">تاريخ الإنشاء</span><span>${new Date(channel.createdAt).toLocaleDateString('ar-EG')}</span></div>
    <div class="about-item"><span class="about-label">الدولة</span><span>${sanitize(channel.country || 'غير محدد')}</span></div>
  `;
}

document.querySelectorAll('.channel-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.channel-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.channel-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`[data-ctab-content="${tab.dataset.ctab}"]`).classList.add('active');
  });
});

// ============================================
// صفحة المشاهدة - إصلاح تشغيل الفيديو
// ============================================
async function openWatchPage(videoId) {
  const video = state.videos.find(v => v.id === videoId);
  if (!video) { showToast('الفيديو غير موجود', 'error'); return; }

  // تحرير الرابط السابق
  if (state.videoBlobUrls[videoId]) {
    URL.revokeObjectURL(state.videoBlobUrls[videoId]);
    delete state.videoBlobUrls[videoId];
  }

  state.currentVideoId = videoId;
  state.viewedVideo = video;
  state.viewCounted = false;

  // إضافة للسجل
  const settings = DB.get('appSettings') || {};
  if (settings.saveHistory !== false) {
    state.history = state.history.filter(h => h.id !== videoId);
    state.history.unshift({ id: videoId, watchedAt: Date.now() });
    if (state.history.length > 100) state.history.pop();
    saveState();
  }

  showPage('watch');
  await renderWatchPage(video);
}

async function renderWatchPage(video) {
  const player = $('mainVideo');
  
  // إزالة المستمعين السابقين
  player.onerror = null;
  player.ontimeupdate = null;
  player.onloadedmetadata = null;

  if (video.hasVideoFile) {
    try {
      const blob = await getVideoBlob(video.id);
      if (blob) {
        const url = URL.createObjectURL(blob);
        state.videoBlobUrls[video.id] = url; // حفظ الرابط لعدم إلغاؤه
        player.src = url;
      } else {
        showToast('ملف الفيديو غير موجود', 'error');
      }
    } catch (err) {
      console.error('خطأ في تحميل الفيديو:', err);
      showToast('فشل تحميل الفيديو', 'error');
    }
  } else {
    player.removeAttribute('src');
    player.load();
  }
  player.poster = video.thumb || '';

  // عدّاد المشاهدات الآمن
  player.onloadedmetadata = () => {
    // معلومات المدة
    const duration = player.duration;
    if (duration && isFinite(duration)) {
      const mins = Math.floor(duration / 60);
      const secs = Math.floor(duration % 60);
      video.duration = `${mins}:${secs.toString().padStart(2, '0')}`;
      saveState();
    }
  };

  player.ontimeupdate = () => {
    if (state.viewCounted) return;
    const duration = player.duration;
    if (!duration || !isFinite(duration) || duration === 0) return;
    
    // حساب المشاهدة عند 50%
    if (player.currentTime >= duration * 0.5) {
      registerView(video);
    }
  };

  player.onerror = () => {
    showToast('حدث خطأ في تشغيل الفيديو', 'error');
  };

  $('watchTitle').textContent = video.title;

  const channel = state.channels.find(c => c.id === video.channelId);
  const avatarEl = $('watchAvatar');
  if (channel && channel.avatar && channel.avatar.startsWith('data:')) {
    avatarEl.innerHTML = `<img src="${channel.avatar}" alt="">`;
  } else {
    avatarEl.textContent = sanitize(video.avatar || video.channel[0]);
  }
  avatarEl.onclick = () => { if (video.channelId) openChannelPage(video.channelId); };
  document.querySelector('.channel-details').onclick = () => { if (video.channelId) openChannelPage(video.channelId); };

  $('watchChannelName').textContent = video.channel;
  const subsCount = state.subscriptions.filter(s => s.channelId === video.channelId).length;
  $('watchSubsCount').textContent = subsCount + ' مشترك';

  const subBtn = $('subscribeBtn');
  const isOwn = state.user && video.channelId && state.user.channelId === video.channelId;
  if (isOwn) {
    subBtn.style.display = 'none';
    let badge = document.querySelector('.own-channel-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'own-channel-badge';
      badge.textContent = 'قناتك';
      subBtn.parentNode.appendChild(badge);
    }
  } else {
    subBtn.style.display = '';
    const oldBadge = document.querySelector('.own-channel-badge');
    if (oldBadge) oldBadge.remove();
    const isSubbed = state.user && state.subscriptions.find(s => s.channelId === video.channelId && s.userId === state.user.id);
    subBtn.textContent = isSubbed ? 'مشترك' : 'اشتراك';
    subBtn.classList.toggle('subscribed', !!isSubbed);
    subBtn.onclick = () => toggleSubscribe(video.channelId);
  }

  const likes = video.likes || [];
  const isLiked = state.user && likes.includes(state.user.id);
  const isDisliked = state.user && (video.dislikes || []).includes(state.user.id);
  $('likeCount').textContent = likes.length || '0';
  $('likeBtn').classList.toggle('liked', isLiked);
  $('dislikeBtn').classList.toggle('disliked', isDisliked);
  $('likeBtn').onclick = () => toggleLike(video.id);
  $('dislikeBtn').onclick = () => toggleDislike(video.id);
  $('shareBtn').onclick = () => shareVideo(video);

  $('watchViews').textContent = formatViews(video.views);
  $('watchTime').textContent = formatTime(video.time);
  $('watchDescText').textContent = video.description || 'لا يوجد وصف';

  renderComments(video.id);
  if (state.user) $('commentAvatar').textContent = state.user.name[0];
  else $('commentAvatar').textContent = '؟';
  $('submitComment').onclick = () => submitComment(video.id);
  $('cancelComment').onclick = () => { $('commentInput').value = ''; };
  $('commentInput').value = '';

  renderWatchSidebar(video.id);
}

// ============================================
// تسجيل مشاهدة آمن (منع التلاعب)
// ============================================
function registerView(video) {
  if (state.viewCounted) return;
  if (!state.user) {
    // زوار غير مسجلين - عداد محلي فقط بدون تخزين دائم
    state.viewCounted = true;
    $('watchViews').textContent = formatViews(video.views);
    return;
  }

  const viewKey = `${state.user.id}_${video.id}`;
  const now = Date.now();
  const lastView = state.viewLog[viewKey] || 0;
  const HOUR = 3600000;

  // منع تكرار المشاهدة خلال ساعة
  if (now - lastView < HOUR) {
    state.viewCounted = true;
    showToast('تم احتساب مشاهدتك مسبقاً', 'info', 2000);
    return;
  }

  // تسجيل مشاهدة صحيحة
  state.viewLog[viewKey] = now;
  video.views = (video.views || 0) + 1;
  state.viewCounted = true;
  saveState();
  $('watchViews').textContent = formatViews(video.views);
  showToast('تم احتساب المشاهدة', 'success', 2000);
}

function toggleLike(videoId) {
  if (!state.user) { openModal('loginModal'); return; }
  const video = state.videos.find(v => v.id === videoId);
  if (!video) return;
  video.likes = video.likes || [];
  video.dislikes = video.dislikes || [];
  const idx = video.likes.indexOf(state.user.id);
  if (idx >= 0) {
    video.likes.splice(idx, 1);
    state.liked = state.liked.filter(id => id !== videoId);
  } else {
    video.likes.push(state.user.id);
    video.dislikes = video.dislikes.filter(id => id !== state.user.id);
    if (!state.liked.includes(videoId)) state.liked.push(videoId);
  }
  saveState();
  renderWatchPage(video);
}

function toggleDislike(videoId) {
  if (!state.user) { openModal('loginModal'); return; }
  const video = state.videos.find(v => v.id === videoId);
  if (!video) return;
  video.likes = video.likes || [];
  video.dislikes = video.dislikes || [];
  const idx = video.dislikes.indexOf(state.user.id);
  if (idx >= 0) {
    video.dislikes.splice(idx, 1);
  } else {
    video.dislikes.push(state.user.id);
    video.likes = video.likes.filter(id => id !== state.user.id);
    state.liked = state.liked.filter(id => id !== videoId);
  }
  saveState();
  renderWatchPage(video);
}

function toggleSubscribe(channelId) {
  if (!state.user) { openModal('loginModal'); return; }
  if (state.user.channelId === channelId) {
    showToast('لا يمكنك الاشتراك في قناتك', 'warning');
    return;
  }
  const idx = state.subscriptions.findIndex(s => s.channelId === channelId && s.userId === state.user.id);
  if (idx >= 0) {
    state.subscriptions.splice(idx, 1);
    showToast('تم إلغاء الاشتراك', 'info');
  } else {
    state.subscriptions.push({ channelId, userId: state.user.id, time: Date.now() });
    showToast('تم الاشتراك', 'success');
  }
  saveState();
  
  if (state.currentVideoId && state.currentPage === 'watch') {
    const video = state.videos.find(v => v.id === state.currentVideoId);
    if (video) renderWatchPage(video);
  }
  if (state.currentPage === 'channel' && state.currentChannelView) {
    const channel = state.channels.find(c => c.id === state.currentChannelView);
    if (channel) renderChannelPage(channel);
  }
  updateSubsList();
}

function shareVideo(video) {
  const url = window.location.href.split('?')[0] + '?v=' + video.id;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('تم نسخ الرابط', 'success'));
  } else {
    showToast('الرابط: ' + url, 'info', 5000);
  }
}

function renderComments(videoId) {
  const list = $('commentsList');
  const videoComments = state.comments.filter(c => c.videoId === videoId);
  $('commentsCount').textContent = videoComments.length;
  list.innerHTML = '';
  if (videoComments.length === 0) {
    list.innerHTML = '<p style="color:#888;font-size:14px;">لا توجد تعليقات بعد. كن الأول!</p>';
    return;
  }
  videoComments.sort((a, b) => b.time - a.time).forEach(comment => {
    const item = document.createElement('div');
    item.className = 'comment-item';
    const isLiked = state.user && (comment.likes || []).includes(state.user.id);
    item.innerHTML = `
      <div class="channel-avatar">${sanitize(comment.author[0])}</div>
      <div class="comment-content">
        <div class="comment-header">
          <span class="comment-author">${sanitize(comment.author)}</span>
          <span class="comment-time">${formatTime(comment.time)}</span>
        </div>
        <p class="comment-text">${sanitize(comment.text)}</p>
        <button class="comment-like-btn" style="${isLiked ? 'color:#3ea6ff;' : ''}">إعجاب ${(comment.likes || []).length || ''}</button>
      </div>
    `;
    item.querySelector('.comment-like-btn').addEventListener('click', () => {
      if (!state.user) { openModal('loginModal'); return; }
      comment.likes = comment.likes || [];
      const idx = comment.likes.indexOf(state.user.id);
      if (idx >= 0) comment.likes.splice(idx, 1);
      else comment.likes.push(state.user.id);
      saveState();
      renderComments(videoId);
    });
    list.appendChild(item);
  });
}

function submitComment(videoId) {
  if (!state.user) { openModal('loginModal'); return; }
  const input = $('commentInput');
  const text = input.value.trim();
  if (!text) return;
  if (text.length > 500) { showToast('التعليق طويل جداً (500 حرف كحد أقصى)', 'error'); return; }
  state.comments.push({
    id: 'cm' + Date.now(),
    videoId,
    userId: state.user.id,
    author: state.user.name,
    text,
    time: Date.now(),
    likes: []
  });
  saveState();
  input.value = '';
  renderComments(videoId);
  showToast('تم إضافة تعليقك', 'success');
}

function renderWatchSidebar(currentId) {
  const container = $('watchSidebar');
  container.innerHTML = '';
  const suggestions = state.videos.filter(v => v.id !== currentId && v.privacy !== 'private').slice(0, 8);
  if (suggestions.length === 0) {
    container.innerHTML = '<p style="color:#888;">لا توجد فيديوهات مقترحة</p>';
    return;
  }
  suggestions.forEach(v => {
    const card = document.createElement('div');
    card.className = 'sidebar-video-card';
    card.innerHTML = `
      <div class="sidebar-video-thumb">
        <img src="${sanitize(v.thumb)}" alt="${sanitize(v.title)}">
        <span class="duration">${sanitize(v.duration || '0:00')}</span>
      </div>
      <div class="sidebar-video-info">
        <h4>${sanitize(v.title)}</h4>
        <p>${sanitize(v.channel)}</p>
        <p>${formatViews(v.views)}</p>
      </div>
    `;
    card.addEventListener('click', () => {
      openWatchPage(v.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    container.appendChild(card);
  });
}

// السجل والمعجب بها
function renderHistory() {
  const grid = $('historyGrid');
  const empty = $('historyEmpty');
  const items = state.history.map(h => state.videos.find(v => v.id === h.id)).filter(Boolean);
  if (items.length === 0) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  renderVideos(items, grid);
}

function renderLiked() {
  const grid = $('likedGrid');
  const empty = $('likedEmpty');
  const items = state.liked.map(id => state.videos.find(v => v.id === id)).filter(Boolean);
  if (items.length === 0) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  renderVideos(items, grid);
}

function renderMyVideos() {
  const grid = $('myVideosGrid');
  const empty = $('myVideosEmpty');
  if (!state.user) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('h2').textContent = 'سجل الدخول أولاً';
    empty.querySelector('p').textContent = 'تحتاج لتسجيل الدخول لرؤية فيديوهاتك';
    return;
  }
  const myVids = state.videos.filter(v => v.ownerId === state.user.id);
  if (myVids.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    empty.querySelector('h2').textContent = 'لا توجد فيديوهات';
    empty.querySelector('p').textContent = 'قم بتحميل فيديوك الأول';
    return;
  }
  empty.style.display = 'none';
  renderVideos(myVids, grid);
  grid.querySelectorAll('.video-card').forEach((card, i) => {
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.textContent = 'إعدادات';
    btn.style.cssText = 'margin-top:8px;font-size:12px;padding:6px 12px;';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openVideoSettings(myVids[i].id);
    });
    card.appendChild(btn);
  });
}

function renderShorts() {
  const grid = $('shortsGrid');
  const empty = $('shortsEmpty');
  const shorts = state.videos.filter(v => v.isShort);
  if (shorts.length === 0) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  grid.innerHTML = '';
  shorts.forEach(s => {
    const card = document.createElement('div');
    card.className = 'short-card';
    card.innerHTML = `<img src="${sanitize(s.thumb)}" alt="${sanitize(s.title)}"><div class="short-info">${sanitize(s.title)}</div>`;
    card.addEventListener('click', () => openWatchPage(s.id));
    grid.appendChild(card);
  });
}

// ============================================
// النوافذ
// ============================================
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('show');
  });
});

$('avatarBtn').addEventListener('click', () => {
  if (!state.user) openModal('loginModal');
  else if (!state.user.channelId) openModal('createChannelModal');
  else showPage('app-settings');
});

$('registerLink').addEventListener('click', (e) => {
  e.preventDefault();
  closeModal('loginModal');
  openModal('registerModal');
});

$('loginSubmit').addEventListener('click', async () => {
  const email = $('loginEmail').value.trim().toLowerCase();
  const password = $('loginPassword').value;
  if (!email || !password) { showToast('املأ جميع الحقول', 'error'); return; }
  
  const users = DB.get('users') || [];
  const hash = await hashPassword(password);
  const found = users.find(u => u.email === email && u.passwordHash === hash);
  
  if (!found) { showToast('البريد أو كلمة المرور غير صحيحة', 'error'); return; }
  
  // حفظ جلسة بدون كلمة مرور
  const session = {
    id: found.id,
    name: found.name,
    email: found.email,
    channelId: found.channelId
  };
  state.user = session;
  saveState();
  
  // تحديث بيانات المستخدم في users
  const idx = users.findIndex(u => u.id === found.id);
  if (idx >= 0) users[idx].lastLogin = Date.now();
  DB.set('users', users);
  
  closeModal('loginModal');
  $('loginEmail').value = '';
  $('loginPassword').value = '';
  updateUI();
  showToast('مرحباً ' + found.name, 'success');
  showPage('home');
});

$('registerSubmit').addEventListener('click', async () => {
  const name = $('registerName').value.trim();
  const email = $('registerEmail').value.trim().toLowerCase();
  const password = $('registerPassword').value;
  
  if (!name || !email || !password) { showToast('املأ جميع الحقول', 'error'); return; }
  if (name.length < 2) { showToast('الاسم قصير جداً', 'error'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('بريد إلكتروني غير صالح', 'error'); return; }
  if (password.length < 6) { showToast('كلمة المرور 6 أحرف على الأقل', 'error'); return; }
  
  const users = DB.get('users') || [];
  if (users.find(u => u.email === email)) { showToast('البريد مستخدم بالفعل', 'error'); return; }
  
  const hash = await hashPassword(password);
  const newUser = {
    id: 'u' + Date.now(),
    name: sanitize(name),
    email,
    passwordHash: hash,
    channelId: null,
    createdAt: Date.now()
  };
  users.push(newUser);
  DB.set('users', users);
  
  state.user = {
    id: newUser.id,
    name: newUser.name,
    email: newUser.email,
    channelId: null
  };
  saveState();
  
  closeModal('registerModal');
  $('registerName').value = '';
  $('registerEmail').value = '';
  $('registerPassword').value = '';
  updateUI();
  showToast('تم إنشاء الحساب', 'success');
  setTimeout(() => openModal('createChannelModal'), 300);
});

$('createChannelSubmit').addEventListener('click', () => {
  const name = $('newChannelName').value.trim();
  if (!name) { showToast('أدخل اسم القناة', 'error'); return; }
  if (!state.user) return;
  if (state.user.channelId) { showToast('لديك قناة بالفعل', 'warning'); return; }
  
  const channel = {
    id: 'c' + Date.now(),
    name: sanitize(name),
    desc: sanitize($('newChannelDesc').value.trim()),
    ownerId: state.user.id,
    avatar: name[0],
    banner: '',
    country: 'EG',
    keywords: '',
    lang: 'ar',
    allowComments: true,
    allowEmbed: true,
    showSubs: true,
    createdAt: Date.now()
  };
  state.channels.push(channel);
  state.user.channelId = channel.id;
  
  const users = DB.get('users') || [];
  const idx = users.findIndex(u => u.id === state.user.id);
  if (idx >= 0) users[idx].channelId = channel.id;
  DB.set('users', users);
  
  saveState();
  closeModal('createChannelModal');
  $('newChannelName').value = '';
  $('newChannelDesc').value = '';
  updateUI();
  showToast('تم إنشاء القناة', 'success');
  showPage('channel-settings');
});

// ============================================
// إعدادات القناة
// ============================================
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector(`[data-tab-content="${tab.dataset.tab}"]`).classList.add('active');
  });
});

function getCurrentChannel() {
  if (!state.user || !state.user.channelId) return null;
  return state.channels.find(c => c.id === state.user.channelId);
}

function loadChannelSettings() {
  const channel = getCurrentChannel();
  if (!channel) {
    $('page-channel-settings').innerHTML = `
      <h1 class="page-title">إعدادات القناة</h1>
      <div class="empty-state">
        <h2>لا توجد قناة</h2>
        <p>أنشئ قناة أولاً</p>
        <button class="btn-primary" style="margin-top:16px;" onclick="document.getElementById('createChannelModal').classList.add('show')">إنشاء قناة</button>
      </div>
    `;
    return;
  }
  $('channelNameInput').value = channel.name;
  $('channelDescInput').value = channel.desc;
  $('channelCountryInput').value = channel.country;
  $('channelKeywords').value = channel.keywords;
  $('channelLang').value = channel.lang;
  $('permComments').checked = channel.allowComments;
  $('permEmbed').checked = channel.allowEmbed;
  $('permSubs').checked = channel.showSubs;
  if (channel.avatar && channel.avatar.startsWith('data:')) {
    $('channelAvatarPreview').src = channel.avatar;
    $('channelAvatarPreview').style.display = 'block';
  }
  if (channel.banner) {
    $('channelBannerPreview').src = channel.banner;
    $('channelBannerPreview').style.display = 'block';
  }
}

$('saveGeneralBtn').addEventListener('click', () => {
  const c = getCurrentChannel();
  if (!c) return;
  const name = $('channelNameInput').value.trim();
  if (!name) { showToast('الاسم مطلوب', 'error'); return; }
  c.name = sanitize(name);
  c.desc = sanitize($('channelDescInput').value.trim());
  c.country = $('channelCountryInput').value;
  saveState();
  showToast('تم الحفظ', 'success');
  updateUI();
});

$('savePermsBtn').addEventListener('click', () => {
  const c = getCurrentChannel();
  if (!c) return;
  c.allowComments = $('permComments').checked;
  c.allowEmbed = $('permEmbed').checked;
  c.showSubs = $('permSubs').checked;
  saveState();
  showToast('تم الحفظ', 'success');
});

$('saveAdvancedBtn').addEventListener('click', () => {
  const c = getCurrentChannel();
  if (!c) return;
  c.keywords = sanitize($('channelKeywords').value.trim());
  c.lang = $('channelLang').value;
  saveState();
  showToast('تم الحفظ', 'success');
});

$('channelAvatarFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('ملف غير صالح', 'error'); return; }
  compressImage(file, 400, (dataUrl) => {
    $('channelAvatarPreview').src = dataUrl;
    $('channelAvatarPreview').style.display = 'block';
    $('channelAvatarPreview').dataset.data = dataUrl;
  });
});

$('channelBannerFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('ملف غير صالح', 'error'); return; }
  compressImage(file, 1200, (dataUrl) => {
    $('channelBannerPreview').src = dataUrl;
    $('channelBannerPreview').style.display = 'block';
    $('channelBannerPreview').dataset.data = dataUrl;
  });
});

$('saveBrandingBtn').addEventListener('click', () => {
  const c = getCurrentChannel();
  if (!c) return;
  if ($('channelAvatarPreview').dataset.data) c.avatar = $('channelAvatarPreview').dataset.data;
  if ($('channelBannerPreview').dataset.data) c.banner = $('channelBannerPreview').dataset.data;
  saveState();
  showToast('تم الحفظ', 'success');
  updateUI();
});

$('deleteChannelBtn').addEventListener('click', () => {
  if (!confirm('حذف القناة؟ سيتم حذف جميع فيديوهاتها أيضاً')) return;
  const c = getCurrentChannel();
  if (!c) return;
  
  // حذف الفيديوهات
  const channelVideos = state.videos.filter(v => v.channelId === c.id);
  channelVideos.forEach(async (v) => {
    try { await deleteVideoBlob(v.id); } catch (e) {}
  });
  const videoIds = channelVideos.map(v => v.id);
  state.videos = state.videos.filter(v => v.channelId !== c.id);
  state.history = state.history.filter(h => !videoIds.includes(h.id));
  state.liked = state.liked.filter(id => !videoIds.includes(id));
  state.comments = state.comments.filter(cm => !videoIds.includes(cm.videoId));
  
  state.channels = state.channels.filter(ch => ch.id !== c.id);
  state.user.channelId = null;
  
  const users = DB.get('users') || [];
  const idx = users.findIndex(u => u.id === state.user.id);
  if (idx >= 0) users[idx].channelId = null;
  DB.set('users', users);
  
  saveState();
  updateUI();
  showPage('home');
  showToast('تم حذف القناة', 'success');
});

// ============================================
// إعدادات التطبيق
// ============================================
function loadAppSettings() {
  if (state.user) {
    $('appUserName').value = state.user.name;
    $('appUserEmail').value = state.user.email;
  }
  const settings = DB.get('appSettings') || {};
  $('themeSelect').value = settings.theme || 'dark';
  $('fontSizeSelect').value = settings.fontSize || 'normal';
  $('autoplayNext').checked = settings.autoplayNext !== false;
  $('qualitySelect').value = settings.quality || 'auto';
  $('autoplayVideos').checked = settings.autoplayVideos !== false;
  $('showCaptions').checked = !!settings.showCaptions;
  $('notifySubs').checked = settings.notifySubs !== false;
  $('notifyComments').checked = settings.notifyComments !== false;
  $('notifyLikes').checked = settings.notifyLikes !== false;
  $('saveHistory').checked = settings.saveHistory !== false;
  $('showActivity').checked = !!settings.showActivity;
  applyTheme(settings.theme || 'dark');
  applyFontSize(settings.fontSize || 'normal');
  updateStorageUsage();
}

function applyTheme(theme) {
  if (theme === 'light') document.body.classList.add('light-theme');
  else document.body.classList.remove('light-theme');
}

function applyFontSize(size) {
  document.body.classList.remove('font-small', 'font-large');
  if (size === 'small') document.body.classList.add('font-small');
  else if (size === 'large') document.body.classList.add('font-large');
}

function saveAppSettings(partial) {
  const settings = DB.get('appSettings') || {};
  Object.assign(settings, partial);
  DB.set('appSettings', settings);
  applyTheme(settings.theme || 'dark');
  applyFontSize(settings.fontSize || 'normal');
}

async function updateStorageUsage() {
  let total = 0;
  for (let key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      total += (localStorage[key].length + key.length) * 2;
    }
  }
  const mb = (total / (1024 * 1024)).toFixed(2);
  $('storageUsage').textContent = mb + ' MB';
}

$('saveAppUserBtn').addEventListener('click', async () => {
  if (!state.user) { showToast('سجل الدخول أولاً', 'error'); return; }
  const name = $('appUserName').value.trim();
  const email = $('appUserEmail').value.trim().toLowerCase();
  const currentPwd = $('appCurrentPassword').value;
  const newPwd = $('appNewPassword').value;
  
  if (!name || !email) { showToast('املأ الحقول', 'error'); return; }
  
  const users = DB.get('users') || [];
  const idx = users.findIndex(u => u.id === state.user.id);
  if (idx < 0) return;
  
  // تغيير كلمة المرور إن طلب
  if (newPwd) {
    if (!currentPwd) { showToast('أدخل كلمة المرور الحالية', 'error'); return; }
    const currentHash = await hashPassword(currentPwd);
    if (users[idx].passwordHash !== currentHash) { showToast('كلمة المرور الحالية خاطئة', 'error'); return; }
    if (newPwd.length < 6) { showToast('كلمة المرور الجديدة قصيرة', 'error'); return; }
    users[idx].passwordHash = await hashPassword(newPwd);
    $('appCurrentPassword').value = '';
    $('appNewPassword').value = '';
  }
  
  users[idx].name = sanitize(name);
  users[idx].email = email;
  state.user.name = sanitize(name);
  state.user.email = email;
  
  DB.set('users', users);
  saveState();
  showToast('تم الحفظ', 'success');
  updateUI();
});

$('logoutBtn').addEventListener('click', () => {
  if (!confirm('تسجيل الخروج؟')) return;
  state.user = null;
  saveState();
  updateUI();
  showPage('home');
  showToast('تم تسجيل الخروج', 'info');
});

$('saveAppearanceBtn').addEventListener('click', () => {
  saveAppSettings({
    theme: $('themeSelect').value,
    fontSize: $('fontSizeSelect').value,
    autoplayNext: $('autoplayNext').checked
  });
  showToast('تم الحفظ', 'success');
});

$('savePlaybackBtn').addEventListener('click', () => {
  saveAppSettings({
    quality: $('qualitySelect').value,
    autoplayVideos: $('autoplayVideos').checked,
    showCaptions: $('showCaptions').checked
  });
  showToast('تم الحفظ', 'success');
});

$('saveNotificationsBtn').addEventListener('click', () => {
  saveAppSettings({
    notifySubs: $('notifySubs').checked,
    notifyComments: $('notifyComments').checked,
    notifyLikes: $('notifyLikes').checked
  });
  showToast('تم الحفظ', 'success');
});

$('savePrivacyBtn').addEventListener('click', () => {
  saveAppSettings({
    saveHistory: $('saveHistory').checked,
    showActivity: $('showActivity').checked
  });
  showToast('تم الحفظ', 'success');
});

$('clearHistoryBtn2').addEventListener('click', () => {
  if (!confirm('مسح سجل المشاهدة؟')) return;
  state.history = [];
  saveState();
  updateStorageUsage();
  showToast('تم المسح', 'success');
});

$('clearHistoryBtn').addEventListener('click', () => {
  if (!confirm('مسح سجل المشاهدة؟')) return;
  state.history = [];
  saveState();
  renderHistory();
  showToast('تم المسح', 'success');
});

$('clearLikedBtn').addEventListener('click', () => {
  if (!confirm('مسح الإعجابات؟')) return;
  state.liked = [];
  state.videos.forEach(v => { v.likes = (v.likes || []).filter(id => id !== state.user?.id); });
  saveState();
  updateStorageUsage();
  showToast('تم المسح', 'success');
});

$('clearSubsBtn').addEventListener('click', () => {
  if (!confirm('إلغاء جميع الاشتراكات؟')) return;
  state.subscriptions = state.subscriptions.filter(s => s.userId !== state.user?.id);
  saveState();
  updateSubsList();
  updateStorageUsage();
  showToast('تم الإلغاء', 'success');
});

$('clearCommentsBtn').addEventListener('click', () => {
  if (!confirm('مسح تعليقاتك؟')) return;
  state.comments = state.comments.filter(c => c.userId !== state.user?.id);
  saveState();
  updateStorageUsage();
  showToast('تم المسح', 'success');
});

// ============================================
// ضغط الصور
// ============================================
function compressImage(file, maxWidth, callback) {
  if (file.size > 10 * 1024 * 1024) {
    showToast('الملف كبير جداً (10MB كحد أقصى)', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => showToast('فشل تحميل الصورة', 'error');
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ============================================
// رفع فيديو
// ============================================
$('uploadBtn').addEventListener('click', () => {
  if (!state.user) { showToast('سجل الدخول أولاً', 'warning'); openModal('loginModal'); return; }
  if (!state.user.channelId) { showToast('أنشئ قناة أولاً', 'warning'); openModal('createChannelModal'); return; }
  openModal('uploadModal');
});

$('newVideoBtn').addEventListener('click', () => $('uploadBtn').click());

$('videoThumbFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('ملف غير صالح', 'error'); return; }
  compressImage(file, 400, (dataUrl) => {
    $('thumbPreview').src = dataUrl;
    $('thumbPreview').style.display = 'block';
    $('thumbPreview').dataset.data = dataUrl;
  });
});

$('uploadSubmit').addEventListener('click', async () => {
  const title = $('videoTitle').value.trim();
  if (!title) { showToast('أدخل عنوان الفيديو', 'error'); return; }
  if (title.length > 100) { showToast('العنوان طويل جداً', 'error'); return; }
  
  const channel = getCurrentChannel();
  if (!channel) { showToast('لا توجد قناة', 'error'); return; }

  const videoFile = $('videoFile').files[0];
  const thumbData = $('thumbPreview').dataset.data || null;
  const isShort = $('isShortCheck').checked;
  
  // التحقق من حجم الفيديو
  if (videoFile && videoFile.size > 500 * 1024 * 1024) {
    showToast('الفيديو كبير جداً (500MB كحد أقصى)', 'error');
    return;
  }

  const btn = $('uploadSubmit');
  btn.disabled = true;
  btn.textContent = 'جاري النشر...';

  try {
    const videoId = 'v' + Date.now();
    let hasVideoFile = false;

    if (videoFile) {
      await saveVideoBlob(videoId, videoFile);
      hasVideoFile = true;
    }

    const newVideo = {
      id: videoId,
      title: sanitize(title),
      channel: sanitize(channel.name),
      channelId: channel.id,
      views: 0,
      time: Date.now(),
      duration: '0:00',
      thumb: thumbData || 'https://picsum.photos/id/0/640/360',
      avatar: channel.avatar && channel.avatar.startsWith('data:') ? channel.avatar : channel.name[0],
      category: $('videoCategory').value,
      description: sanitize($('videoDesc').value.trim()),
      privacy: 'public',
      comments: true,
      ownerId: state.user.id,
      hasVideoFile: hasVideoFile,
      likes: [],
      dislikes: [],
      isShort: isShort
    };

    state.videos.unshift(newVideo);
    saveState();

    closeModal('uploadModal');
    $('videoTitle').value = '';
    $('videoDesc').value = '';
    $('videoFile').value = '';
    $('videoThumbFile').value = '';
    $('thumbPreview').style.display = 'none';
    $('thumbPreview').removeAttribute('data-data');
    $('isShortCheck').checked = false;
    btn.disabled = false;
    btn.textContent = 'نشر الفيديو';

    showToast('تم نشر الفيديو بنجاح', 'success');
    showPage('myvideos');
  } catch (err) {
    console.error(err);
    showToast('حدث خطأ: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'نشر الفيديو';
  }
});

// ============================================
// إعدادات الفيديو
// ============================================
function openVideoSettings(videoId) {
  const video = state.videos.find(v => v.id === videoId);
  if (!video) return;
  state.editingVideoId = videoId;
  state.editThumbData = null;
  $('editVideoTitle').value = video.title;
  $('editVideoDesc').value = video.description || '';
  $('editVideoPrivacy').value = video.privacy || 'public';
  $('editVideoComments').checked = video.comments !== false;
  $('editThumbPreview').src = video.thumb;
  $('editThumbPreview').style.display = 'block';
  $('editVideoThumbFile').value = '';
  openModal('videoSettingsModal');
}

$('editVideoThumbFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('ملف غير صالح', 'error'); return; }
  compressImage(file, 400, (dataUrl) => {
    state.editThumbData = dataUrl;
    $('editThumbPreview').src = dataUrl;
    $('editThumbPreview').style.display = 'block';
  });
});

$('saveVideoSettingsBtn').addEventListener('click', () => {
  const v = state.videos.find(x => x.id === state.editingVideoId);
  if (!v) return;
  const title = $('editVideoTitle').value.trim();
  if (!title) { showToast('العنوان مطلوب', 'error'); return; }
  v.title = sanitize(title);
  v.description = sanitize($('editVideoDesc').value.trim());
  v.privacy = $('editVideoPrivacy').value;
  v.comments = $('editVideoComments').checked;
  if (state.editThumbData) v.thumb = state.editThumbData;
  saveState();
  closeModal('videoSettingsModal');
  showToast('تم الحفظ', 'success');
  renderMyVideos();
});

$('deleteVideoBtn').addEventListener('click', async () => {
  if (!confirm('حذف الفيديو نهائياً؟')) return;
  const videoId = state.editingVideoId;
  try { await deleteVideoBlob(videoId); } catch (e) { console.error(e); }
  state.videos = state.videos.filter(v => v.id !== videoId);
  state.history = state.history.filter(h => h.id !== videoId);
  state.liked = state.liked.filter(id => id !== videoId);
  state.comments = state.comments.filter(c => c.videoId !== videoId);
  saveState();
  closeModal('videoSettingsModal');
  showToast('تم الحذف', 'success');
  renderMyVideos();
});

// ============================================
// تحديث الواجهة
// ============================================
function updateUI() {
  if (state.user) {
    $('avatarBtn').textContent = state.user.name[0];
    $('avatarBtn').title = state.user.name;
  } else {
    $('avatarBtn').textContent = '؟';
    $('avatarBtn').title = 'تسجيل الدخول';
  }
  updateSubsList();
  const myChannelsList = $('myChannelsList');
  if (state.user && state.user.channelId) {
    const channel = getCurrentChannel();
    if (channel) {
      myChannelsList.innerHTML = `
        <a href="#" class="side-item" data-page="channel-settings">
          <span class="side-icon channel-dot">${sanitize(channel.name[0])}</span>
          ${sanitize(channel.name)}
        </a>
      `;
      myChannelsList.querySelector('.side-item').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('channel-settings');
      });
    }
  } else {
    myChannelsList.innerHTML = '<p class="empty-note">لا توجد قناة</p>';
  }
}

function updateSubsList() {
  const subsList = $('subsList');
  const subs = state.subscriptions.filter(s => s.userId === state.user?.id);
  if (subs.length === 0) {
    subsList.innerHTML = '<p class="empty-note">لا توجد اشتراكات بعد</p>';
    return;
  }
  subsList.innerHTML = '';
  subs.forEach(s => {
    const ch = state.channels.find(c => c.id === s.channelId);
    if (ch) {
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'side-item';
      a.innerHTML = `<span class="side-icon channel-dot">${sanitize(ch.name[0])}</span>${sanitize(ch.name)}`;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        openChannelPage(ch.id);
      });
      subsList.appendChild(a);
    }
  });
}

// أحداث عامة
window.addEventListener('scroll', () => {
  if (window.scrollY > 400) $('backToTop').classList.add('show');
  else $('backToTop').classList.remove('show');
});
$('backToTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

$('settingsBtn').addEventListener('click', () => {
  if (!state.user) openModal('loginModal');
  else showPage('app-settings');
});

// تشغيل أولي
updateUI();
filterAndRender();

const savedSettings = DB.get('appSettings') || {};
applyTheme(savedSettings.theme || 'dark');
applyFontSize(savedSettings.fontSize || 'normal');

const urlParams = new URLSearchParams(window.location.search);
const videoParam = urlParams.get('v');
if (videoParam && state.videos.find(v => v.id === videoParam)) {
  openWatchPage(videoParam);
}