// QR Drop Pro - Desktop Dashboard Application

let activePort = window.location.port || 5000;
let currentSelectedIp = '';
let stagedFiles = [];
let soundEnabled = true;
let activeShareId = null;

// Audio Chime using Web Audio API (No external sound files required)
function playChime(type = 'success') {
    if (!soundEnabled) return;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        const now = audioCtx.currentTime;
        if (type === 'success') {
            // Uplifting two-tone chime (E5 -> B5)
            osc.frequency.setValueAtTime(659.25, now);
            osc.frequency.exponentialRampToValueAtTime(987.77, now + 0.15);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
            osc.start(now);
            osc.stop(now + 0.6);
        } else if (type === 'receive') {
            // Three-tone phone ping
            osc.frequency.setValueAtTime(523.25, now); // C5
            osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
            osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
            gain.gain.setValueAtTime(0.18, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
            osc.start(now);
            osc.stop(now + 0.8);
        }
    } catch (e) {
        console.warn('Audio not allowed yet by user gesture', e);
    }
}

// Toast Notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : ''}`;
    toast.innerHTML = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Utility: Format File Size
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// DOM Elements
const networkIpSelect = document.getElementById('networkIpSelect');
const soundToggleBtn = document.getElementById('soundToggleBtn');
const soundIcon = document.getElementById('soundIcon');
const openFolderBtn = document.getElementById('openFolderBtn');

const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

const fileDropzone = document.getElementById('fileDropzone');
const fileInput = document.getElementById('fileInput');
const selectedFilesBox = document.getElementById('selectedFilesBox');
const stagedFileList = document.getElementById('stagedFileList');
const stagedCount = document.getElementById('stagedCount');
const clearStagedBtn = document.getElementById('clearStagedBtn');
const shareNote = document.getElementById('shareNote');
const uploadAndGenerateBtn = document.getElementById('uploadAndGenerateBtn');

// QR elements
const activeQrImage = document.getElementById('activeQrImage');
const qrEmptyState = document.getElementById('qrEmptyState');
const qrDetails = document.getElementById('qrDetails');
const activeQrUrl = document.getElementById('activeQrUrl');
const copyQrUrlBtn = document.getElementById('copyQrUrlBtn');
const openQrUrlBtn = document.getElementById('openQrUrlBtn');
const qrStatusPill = document.getElementById('qrStatusPill');

// Receive Portal elements
const receiveQrImage = document.getElementById('receiveQrImage');
const receivePortalUrl = document.getElementById('receivePortalUrl');
const copyReceiveUrlBtn = document.getElementById('copyReceiveUrlBtn');
const openReceiveUrlBtn = document.getElementById('openReceiveUrlBtn');
const incomingFilesList = document.getElementById('incomingFilesList');
const clearReceivedBtn = document.getElementById('clearReceivedBtn');

// History Table
const historyTableBody = document.getElementById('historyTableBody');
const historyCount = document.getElementById('historyCount');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const clearAllBtn = document.getElementById('clearAllBtn');

// Modal Elements
const qrModal = document.getElementById('qrModal');
const closeQrModalBtn = document.getElementById('closeQrModalBtn');
const modalShareTitle = document.getElementById('modalShareTitle');
const modalQrImage = document.getElementById('modalQrImage');
const modalShareUrl = document.getElementById('modalShareUrl');
const modalCopyUrlBtn = document.getElementById('modalCopyUrlBtn');
const modalOpenUrlBtn = document.getElementById('modalOpenUrlBtn');

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    currentSelectedIp = networkIpSelect.value || window.location.hostname;
    setupTabs();
    setupDropzone();
    setupEventListeners();
    updateReceivePortalQR();
    connectWebSocket();
    loadHistory();
});

// Update Network IP Selection
networkIpSelect.addEventListener('change', () => {
    currentSelectedIp = networkIpSelect.value;
    updateReceivePortalQR();
    if (activeShareId) {
        updateActiveShareQR(activeShareId);
    }
    showToast(`تم تبديل عنوان الشبكة إلى: ${currentSelectedIp}`);
});

// Tab Navigation
function setupTabs() {
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const target = btn.getAttribute('data-tab');
            document.getElementById(target).classList.add('active');

            if (target === 'historyTab') {
                loadHistory();
            }
        });
    });
}

// Receive Portal QR
function updateReceivePortalQR() {
    const portalUrl = `http://${currentSelectedIp}:${activePort}/upload-portal`;
    receivePortalUrl.textContent = portalUrl;
    openReceiveUrlBtn.href = portalUrl;
    receiveQrImage.src = `/api/qr?text=${encodeURIComponent(portalUrl)}`;
}

// Active Share QR (PC -> Phone)
function updateActiveShareQR(shareId) {
    activeShareId = shareId;
    const downloadUrl = `http://${currentSelectedIp}:${activePort}/d/${shareId}`;
    activeQrUrl.textContent = downloadUrl;
    openQrUrlBtn.href = downloadUrl;
    activeQrImage.src = `/api/qr?text=${encodeURIComponent(downloadUrl)}`;

    activeQrImage.style.display = 'block';
    qrEmptyState.style.display = 'none';
    qrDetails.style.display = 'block';
    qrStatusPill.textContent = 'جاهز للمسح بالهاتف ✅';
    qrStatusPill.className = 'status-pill badge-success';
}

// Dropzone & File Selection
function setupDropzone() {
    fileDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileDropzone.classList.add('dragover');
    });

    fileDropzone.addEventListener('dragleave', () => {
        fileDropzone.classList.remove('dragover');
    });

    fileDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        fileDropzone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFilesSelected(Array.from(e.dataTransfer.files));
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFilesSelected(Array.from(e.target.files));
        }
    });

    clearStagedBtn.addEventListener('click', () => {
        stagedFiles = [];
        fileInput.value = '';
        renderStagedFiles();
    });
}

function handleFilesSelected(files) {
    stagedFiles = stagedFiles.concat(files);
    renderStagedFiles();
}

function renderStagedFiles() {
    if (stagedFiles.length === 0) {
        selectedFilesBox.style.display = 'none';
        return;
    }

    selectedFilesBox.style.display = 'block';
    stagedCount.textContent = stagedFiles.length;
    stagedFileList.innerHTML = '';

    stagedFiles.forEach((file, index) => {
        const li = document.createElement('li');
        li.className = 'file-item';
        li.innerHTML = `
            <div style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                <strong>${file.name}</strong>
                <span style="color:var(--text-muted); font-size:0.8rem; margin-right:8px;">(${formatBytes(file.size)})</span>
            </div>
            <button class="btn-text text-danger" onclick="removeStagedFile(${index})" title="حذف">✕</button>
        `;
        stagedFileList.appendChild(li);
    });
}

window.removeStagedFile = function(index) {
    stagedFiles.splice(index, 1);
    renderStagedFiles();
};

// Upload & Generate QR Code
uploadAndGenerateBtn.addEventListener('click', async () => {
    if (stagedFiles.length === 0) return;

    uploadAndGenerateBtn.disabled = true;
    uploadAndGenerateBtn.innerHTML = 'جاري المعالجة وإنشاء الكود...';

    const formData = new FormData();
    stagedFiles.forEach(f => formData.append('files', f));
    formData.append('direction', 'pc_to_phone');
    formData.append('note', shareNote.value.trim());

    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();
        if (data.status === 'success') {
            updateActiveShareQR(data.share_id);
            playChime('success');
            showToast('تم رفع الملفات وتوليد رمز الـ QR بنجاح! 🚀', 'success');

            // Reset staged files
            stagedFiles = [];
            fileInput.value = '';
            shareNote.value = '';
            renderStagedFiles();
            loadHistory();
        } else {
            showToast('حدث خطأ أثناء رفع الملفات', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('تعذر الاتصال بالخادم', 'error');
    } finally {
        uploadAndGenerateBtn.disabled = false;
        uploadAndGenerateBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
            إنشاء QR Code ومشاركة الملفات
        `;
    }
});

// Event Listeners (Clipboard & Open Folder)
function setupEventListeners() {
    copyQrUrlBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(activeQrUrl.textContent);
        showToast('تم نسخ الرابط إلى الحافظة! 📋');
    });

    copyReceiveUrlBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(receivePortalUrl.textContent);
        showToast('تم نسخ رابط بوابة الاستقبال! 📋');
    });

    modalCopyUrlBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(modalShareUrl.textContent);
        showToast('تم نسخ الرابط! 📋');
    });

    openFolderBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/open-folder', { method: 'POST' });
        } catch (e) {
            console.error(e);
        }
    });

    soundToggleBtn.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        soundIcon.textContent = soundEnabled ? '🔊' : '🔇';
        showToast(soundEnabled ? 'تم تفعيل التنبيهات الصوتية' : 'تم كتم الصوت');
    });

    refreshHistoryBtn.addEventListener('click', loadHistory);

    clearAllBtn.addEventListener('click', async () => {
        if (confirm('هل أنت متأكد من رغبتك في حذف جميع الملفات والمشاركات؟')) {
            await fetch('/api/clear-all', { method: 'DELETE' });
            loadHistory();
            showToast('تم تفريغ جميع الملفات');
        }
    });

    clearReceivedBtn.addEventListener('click', () => {
        incomingFilesList.innerHTML = `
            <div class="empty-state-small">
                تم مسح القائمة المؤقتة. الملفات لا تزال محفوظة على جهازك في مجلد uploads.
            </div>
        `;
    });

    closeQrModalBtn.addEventListener('click', () => {
        qrModal.style.display = 'none';
    });

    qrModal.addEventListener('click', (e) => {
        if (e.target === qrModal) qrModal.style.display = 'none';
    });
}

// Load History Table & Stats
async function loadHistory() {
    try {
        const res = await fetch('/api/files');
        const data = await res.json();
        const shares = data.shares || [];

        historyCount.textContent = shares.length;

        if (shares.length === 0) {
            historyTableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-4" style="color:var(--text-muted);">لا توجد أي ملفات منقولة حتى الآن</td>
                </tr>
            `;
            return;
        }

        historyTableBody.innerHTML = '';
        shares.forEach(share => {
            const tr = document.createElement('tr');
            const files = share.files_details || [];
            const isSingle = files.length === 1;
            const title = isSingle ? files[0].name : `حزمة (${files.length} ملفات)`;
            const isFromPhone = share.direction === 'phone_to_pc';

            tr.innerHTML = `
                <td>
                    <strong>${title}</strong>
                    ${share.note ? `<div style="font-size:0.75rem; color:var(--accent);">${share.note}</div>` : ''}
                </td>
                <td>
                    <span class="badge ${isFromPhone ? 'badge-success' : 'badge-cyan'}">
                        ${isFromPhone ? '📥 من الهاتف' : '📤 إلى الهاتف'}
                    </span>
                </td>
                <td>${share.total_size_formatted}</td>
                <td>${isSingle ? files[0].downloads : '-'}</td>
                <td>${share.created_at}</td>
                <td>
                    <div class="btn-group">
                        <button class="btn btn-secondary btn-sm" onclick="showShareModal('${share.id}', '${title}')" title="عرض الـ QR">
                            📱 QR
                        </button>
                        ${isSingle ? 
                            `<a href="/download/${files[0].id}" class="btn btn-secondary btn-sm" title="تحميل">⬇️</a>` :
                            `<a href="/download-zip/${share.id}" class="btn btn-secondary btn-sm" title="تحميل ZIP">📦 ZIP</a>`
                        }
                        <button class="btn btn-danger btn-sm" onclick="deleteShare('${share.id}')" title="حذف">🗑️</button>
                    </div>
                </td>
            `;
            historyTableBody.appendChild(tr);
        });
    } catch (e) {
        console.error('Error loading history:', e);
    }
}

// Modal View QR
window.showShareModal = function(shareId, title) {
    const downloadUrl = `http://${currentSelectedIp}:${activePort}/d/${shareId}`;
    modalShareTitle.textContent = title;
    modalShareUrl.textContent = downloadUrl;
    modalOpenUrlBtn.href = downloadUrl;
    modalQrImage.src = `/api/qr?text=${encodeURIComponent(downloadUrl)}`;
    qrModal.style.display = 'flex';
};

// Delete Share
window.deleteShare = async function(shareId) {
    if (confirm('هل أنت متأكد من حذف هذه المشاركة؟')) {
        await fetch(`/api/shares/${shareId}`, { method: 'DELETE' });
        loadHistory();
        showToast('تم حذف المشاركة بنجاح');
    }
};

// Add to Incoming Received Feed
function addIncomingFileCard(files, note) {
    const emptyState = incomingFilesList.querySelector('.empty-state-small');
    if (emptyState) emptyState.remove();

    files.forEach(f => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.style.marginBottom = '10px';
        item.style.padding = '12px';
        item.innerHTML = `
            <div style="flex:1; overflow:hidden;">
                <div style="font-weight:700; color:#fff;">${f.name}</div>
                <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">
                    الحجم: ${f.size_formatted} ${note ? `| 💬 "${note}"` : ''}
                </div>
            </div>
            <div class="btn-group">
                <a href="/download/${f.id}" class="btn btn-primary btn-sm">⬇️ تحميل</a>
                <a href="/preview/${f.id}" target="_blank" class="btn btn-secondary btn-sm">👁️ معاينة</a>
            </div>
        `;
        incomingFilesList.prepend(item);
    });
}

// WebSocket Live Updates
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('Connected to QR Drop WebSocket');
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.event === 'files_uploaded') {
                if (data.direction === 'phone_to_pc') {
                    playChime('receive');
                    showToast('🎉 استلمت ملفاً جديداً من الهاتف للتو!', 'success');
                    addIncomingFileCard(data.files, data.note);
                    loadHistory();
                } else {
                    loadHistory();
                }
            } else if (data.event === 'file_downloaded') {
                playChime('success');
                showToast('✅ الهاتف قام بتحميل الملف الآن!', 'success');
                loadHistory();
            } else if (data.event === 'share_deleted' || data.event === 'all_cleared') {
                loadHistory();
            }
        } catch (err) {
            console.error('Error handling WS message:', err);
        }
    };

    socket.onclose = () => {
        console.log('WebSocket closed, reconnecting in 3s...');
        setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (err) => {
        console.warn('WebSocket encountered error:', err);
    };
}
