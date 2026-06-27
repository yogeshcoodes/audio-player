// ==========================================
// script.js — Full-featured Audio Player
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // ── DOM Elements ──
    const body = document.body;
    const drawer = document.getElementById('drawer');
    const drawerOverlay = document.getElementById('drawer-overlay');
    const btnMenu = document.getElementById('btn-menu');
    const btnCloseDrawer = document.getElementById('btn-close-drawer');
    const themeToggle = document.getElementById('theme-toggle');
    const themeLabel = document.getElementById('theme-label');
    const btnOpenFolder = document.getElementById('btn-open-folder');
    const folderInput = document.getElementById('folder-input');
    const sortSelect = document.getElementById('sort-select');
    const btnDownload = document.getElementById('btn-download');
    const btnSearch = document.getElementById('btn-search');
    const searchBar = document.getElementById('search-bar');
    const searchInput = document.getElementById('search-input');
    const btnClearSearch = document.getElementById('btn-clear-search');
    const tabs = document.querySelectorAll('.tabs button[data-view]');
    const views = {
        'albums-view': document.getElementById('albums-view'),
        'artists-view': document.getElementById('artists-view'),
        'playlists-view': document.getElementById('playlists-view'),
        'songs-view': document.getElementById('songs-view'),
        'effects-panel': document.getElementById('effects-panel'),
    };
    const songListContainer = document.getElementById('song-list');
    const btnEffects = document.getElementById('btn-effects');
    const btnList = document.getElementById('btn-list');
    const btnPlay = document.getElementById('btn-play');
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnShuffle = document.getElementById('btn-shuffle');
    const btnRepeat = document.getElementById('btn-repeat');
    const progressBar = document.getElementById('progress-bar');
    const currentTimeEl = document.getElementById('current-time');
    const totalTimeEl = document.getElementById('total-time');
    const nowPlayingTitle = document.getElementById('now-playing-title');
    const visualizerCanvas = document.getElementById('visualizer');
    const visualizerCtx = visualizerCanvas.getContext('2d');

    // Effect UI elements
    const reverbToggle = document.getElementById('reverb-toggle');
    const wetSlider = document.getElementById('wet-slider');
    const wetVal = document.getElementById('wet-val');
    const roomSlider = document.getElementById('room-slider');
    const roomVal = document.getElementById('room-val');
    const stereoSllider = document.getElementById('stereo-slider');
    const stereoVal = document.getElementById('stereo-val');
    const bassSlider = document.getElementById('bass-slider');
    const bassVal = document.getElementById('bass-val');
    const trebleSlider = document.getElementById('treble-slider');
    const trebleVal = document.getElementById('treble-val');
    const volumeSlider = document.getElementById('volume-slider');
    const volumeVal = document.getElementById('volume-val');
    const speedSlider = document.getElementById('speed-slider');
    const speedVal = document.getElementById('speed-val');

    // ── Audio Engine ──
    const audio = new Audio();
    let audioCtx = null;
    let audioSourceNode = null;
    let isPlaying = false;
    let currentTrackIndex = -1;
    let shuffleMode = false;
    let repeatMode = 'off'; // 'off' | 'one' | 'all'
    let trackList = [];     // { file, blobUrl, title, artist, duration }
    let folderFiles = [];   // original File objects

    // DSP nodes
    let bassFilter, trebleFilter, convolver, dryGain, wetGain, stereoWidthProcessor, masterGain, analyserNode;
    let roomDebounceTimer = null;

    // ── Theme Management ──
    const currentTheme = localStorage.getItem('audio-player-theme') || 'dark';
    body.className = currentTheme === 'light' ? 'light-theme' : 'dark-theme';
    themeToggle.checked = currentTheme === 'light';
    themeLabel.textContent = currentTheme === 'light' ? 'Light' : 'Dark';

    themeToggle.addEventListener('change', () => {
        const isLight = themeToggle.checked;
        body.className = isLight ? 'light-theme' : 'dark-theme';
        themeLabel.textContent = isLight ? 'Light' : 'Dark';
        localStorage.setItem('audio-player-theme', isLight ? 'light' : 'dark');
    });

    // ── Drawer ──
    function openDrawer() { drawer.classList.add('open'); drawerOverlay.classList.remove('hidden'); }
    function closeDrawer() { drawer.classList.remove('open'); drawerOverlay.classList.add('hidden'); }
    btnMenu.addEventListener('click', openDrawer);
    btnCloseDrawer.addEventListener('click', closeDrawer);
    drawerOverlay.addEventListener('click', closeDrawer);

    // ── Folder Selection ──
    btnOpenFolder.addEventListener('click', () => folderInput.click());
    folderInput.addEventListener('change', handleFolderSelect);

    function handleFolderSelect(e) {
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('audio/'));
        if (files.length === 0) {
            alert('No audio files found in the selected folder.');
            return;
        }
        folderFiles = files;
        buildTrackListFromFiles(files);
        sortAndRenderTracks();
        closeDrawer();
    }

    function buildTrackListFromFiles(files) {
        trackList = files.map((file, i) => {
            const blobUrl = URL.createObjectURL(file);
            const name = file.name.replace(/\.[^/.]+$/, '');
            return {
                file,
                blobUrl,
                title: name,
                artist: 'Unknown artist',
                duration: null, // will be filled later
                element: null,
                index: i,
            };
        });
    }

    function sortAndRenderTracks() {
        const sortBy = sortSelect.value;
        trackList.sort((a, b) => {
            switch (sortBy) {
                case 'name-asc': return a.title.localeCompare(b.title);
                case 'name-desc': return b.title.localeCompare(a.title);
                case 'date-desc': return (b.file.lastModified || 0) - (a.file.lastModified || 0);
                case 'date-asc': return (a.file.lastModified || 0) - (b.file.lastModified || 0);
                default: return 0;
            }
        });
        trackList.forEach((t, idx) => t.index = idx);
        renderSongList();
    }

    sortSelect.addEventListener('change', () => {
        if (trackList.length > 0) {
            sortAndRenderTracks();
            // If a track was playing, find its new index
            if (currentTrackIndex >= 0 && trackList[currentTrackIndex]) {
                currentTrackIndex = trackList.findIndex(t => t.blobUrl === audio.src);
                if (currentTrackIndex === -1) currentTrackIndex = 0;
                highlightTrack(currentTrackIndex);
            }
        }
    });

    function renderSongList() {
        songListContainer.innerHTML = '';
        if (trackList.length === 0) {
            songListContainer.innerHTML = `<div class="empty-view"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><p>Open a folder from the menu to load your music.</p></div>`;
            return;
        }
        trackList.forEach((track, idx) => {
            const item = document.createElement('div');
            item.className = 'song-item';
            item.dataset.index = idx;
            item.innerHTML = `
                <div class="song-cover">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>
                <div class="song-info">
                    <h3>${escapeHtml(track.title)}</h3>
                    <p>${track.artist}</p>
                </div>
                <span class="song-duration">--:--</span>
            `;
            item.addEventListener('click', (e) => onSongClick(e, idx));
            songListContainer.appendChild(item);
            track.element = item;
        });
        // Load durations asynchronously
        trackList.forEach((track, idx) => {
            const tempAudio = new Audio(track.blobUrl);
            tempAudio.addEventListener('loadedmetadata', () => {
                track.duration = tempAudio.duration;
                const durationEl = track.element?.querySelector('.song-duration');
                if (durationEl) durationEl.textContent = formatTime(tempAudio.duration);
            }, { once: true });
        });
    }

    function escapeHtml(text) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    // ── Search ──
    btnSearch.addEventListener('click', () => {
        searchBar.classList.toggle('hidden');
        if (!searchBar.classList.contains('hidden')) searchInput.focus();
        else { searchInput.value = ''; filterSongList(''); }
    });
    btnClearSearch.addEventListener('click', () => {
        searchInput.value = '';
        filterSongList('');
        searchBar.classList.add('hidden');
    });
    searchInput.addEventListener('input', () => filterSongList(searchInput.value.toLowerCase()));

    function filterSongList(query) {
        const items = songListContainer.querySelectorAll('.song-item');
        items.forEach(item => {
            const track = trackList[item.dataset.index];
            if (!track) return;
            const matches = !query || track.title.toLowerCase().includes(query) || track.artist.toLowerCase().includes(query);
            item.style.display = matches ? '' : 'none';
        });
    }

    // ── Tab Switching ──
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const viewId = tab.dataset.view;
            switchToView(viewId);
        });
    });

    function switchToView(viewId) {
        Object.values(views).forEach(v => v.classList.remove('active-view'));
        if (views[viewId]) views[viewId].classList.add('active-view');
        // If switching to effects, we need to handle separately
        if (viewId === 'effects-panel') {
            // Effects panel is also a view, just show it
        }
    }

    btnEffects.addEventListener('click', () => {
        switchToView('effects-panel');
        tabs.forEach(t => t.classList.remove('active')); // deselect tabs
    });
    btnList.addEventListener('click', () => {
        switchToView('songs-view');
        document.querySelector('.tabs button[data-view="songs-view"]').classList.add('active');
    });

    // ── Audio Context Init ──
    function initAudioContext() {
        if (audioCtx) {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            return;
        }
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();

        audioSourceNode = audioCtx.createMediaElementSource(audio);

        bassFilter = audioCtx.createBiquadFilter();
        bassFilter.type = 'lowshelf';
        bassFilter.frequency.value = 280;
        bassFilter.gain.value = 0;

        trebleFilter = audioCtx.createBiquadFilter();
        trebleFilter.type = 'highshelf';
        trebleFilter.frequency.value = 4000;
        trebleFilter.gain.value = 0;

        convolver = audioCtx.createConvolver();
        convolver.buffer = generateImpulseResponse(2.0, 1.2);

        dryGain = audioCtx.createGain();
        dryGain.gain.value = 0.65;
        wetGain = audioCtx.createGain();
        wetGain.gain.value = 0.35;

        stereoWidthProcessor = createStereoWidthNode(audioCtx);
        stereoWidthProcessor.setWidth(1.0);

        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.8;

        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;
        analyserNode.smoothingTimeConstant = 0.75;

        // Routing
        audioSourceNode.connect(bassFilter);
        bassFilter.connect(trebleFilter);

        trebleFilter.connect(dryGain);
        dryGain.connect(stereoWidthProcessor.input);
        stereoWidthProcessor.output.connect(masterGain);

        trebleFilter.connect(convolver);
        convolver.connect(wetGain);
        wetGain.connect(masterGain);

        masterGain.connect(analyserNode);
        analyserNode.connect(audioCtx.destination);

        updateWetMix();
        updateReverbEnabled();
    }

    function generateImpulseResponse(durationSec, decayTime) {
        if (!audioCtx) return null;
        const sampleRate = audioCtx.sampleRate;
        const length = Math.floor(sampleRate * Math.min(durationSec, 4.0));
        const buffer = audioCtx.createBuffer(2, length, sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);
            let seed = ch * 13763 + 7919;
            for (let i = 0; i < length; i++) {
                const t = i / sampleRate;
                const envelope = Math.exp(-t / decayTime);
                const endFade = i > length - 200 ? Math.max(0, (length - i) / 200) : 1.0;
                seed = (seed * 16807 + 0) % 2147483647;
                const noise = (seed / 2147483647) * 2 - 1;
                data[i] = noise * envelope * endFade;
            }
            smoothBuffer(data, 3);
        }
        return buffer;
    }

    function smoothBuffer(data, passes) {
        for (let p = 0; p < passes; p++) {
            for (let i = 1; i < data.length - 1; i++) {
                data[i] = data[i] * 0.6 + (data[i - 1] + data[i + 1]) * 0.2;
            }
        }
    }

    function createStereoWidthNode(ctx) {
        const splitter = ctx.createChannelSplitter(2);
        const merger = ctx.createChannelMerger(2);
        const lToMid = ctx.createGain(); lToMid.gain.value = 0.5;
        const rToMid = ctx.createGain(); rToMid.gain.value = 0.5;
        const midSum = ctx.createGain(); midSum.gain.value = 1.0;
        const lToSide = ctx.createGain(); lToSide.gain.value = 0.5;
        const rToSide = ctx.createGain(); rToSide.gain.value = -0.5;
        const sideSum = ctx.createGain(); sideSum.gain.value = 1.0;
        const midToL = ctx.createGain(); midToL.gain.value = 1.0;
        const midToR = ctx.createGain(); midToR.gain.value = 1.0;
        const sideToL = ctx.createGain(); sideToL.gain.value = 1.0;
        const sideToR = ctx.createGain(); sideToR.gain.value = -1.0;

        splitter.connect(lToMid, 0); splitter.connect(lToSide, 0);
        splitter.connect(rToMid, 1); splitter.connect(rToSide, 1);
        lToMid.connect(midSum); rToMid.connect(midSum);
        lToSide.connect(sideSum); rToSide.connect(sideSum);
        midSum.connect(midToL); midSum.connect(midToR);
        sideSum.connect(sideToL); sideSum.connect(sideToR);
        midToL.connect(merger, 0, 0); sideToL.connect(merger, 0, 0);
        midToR.connect(merger, 0, 1); sideToR.connect(merger, 0, 1);

        return {
            input: splitter,
            output: merger,
            setWidth: (width) => { sideToL.gain.value = width; sideToR.gain.value = -width; }
        };
    }

    // ── DSP Updates ──
    function updateWetMix() {
        if (!dryGain || !wetGain) return;
        const wetPercent = parseInt(wetSlider.value) / 100;
        wetGain.gain.value = wetPercent;
        dryGain.gain.value = Math.max(0.05, 1 - wetPercent * 0.7);
    }

    function updateReverbEnabled() {
        if (!wetGain) return;
        wetGain.gain.value = reverbToggle.checked ? parseInt(wetSlider.value) / 100 : 0;
    }

    function updateRoomSize() {
        if (!convolver || !audioCtx) return;
        const roomPercent = parseInt(roomSlider.value) / 100;
        const decayTime = 0.3 + roomPercent * 2.7;
        convolver.buffer = generateImpulseResponse(2.0, decayTime);
        const labels = ['Tiny', 'Small', 'Medium', 'Large', 'Hall', 'Cavern'];
        const idx = Math.min(labels.length - 1, Math.floor(roomPercent * labels.length));
        roomVal.textContent = labels[idx] || 'Medium';
    }

    function updateStereoWidth() {
        if (!stereoWidthProcessor) return;
        const widthPercent = parseInt(stereoSllider.value) / 100;
        stereoWidthProcessor.setWidth(widthPercent);
        stereoVal.textContent = Math.round(widthPercent * 100) + '%';
    }

    function updateBass() {
        if (!bassFilter) return;
        const val = parseInt(bassSlider.value);
        bassFilter.gain.value = val;
        bassVal.textContent = (val >= 0 ? '+' : '') + val + ' dB';
    }

    function updateTreble() {
        if (!trebleFilter) return;
        const val = parseInt(trebleSlider.value);
        trebleFilter.gain.value = val;
        trebleVal.textContent = (val >= 0 ? '+' : '') + val + ' dB';
    }

    function updateVolume() {
        if (!masterGain) return;
        const val = parseInt(volumeSlider.value) / 100;
        masterGain.gain.value = val;
        volumeVal.textContent = Math.round(val * 100) + '%';
    }

    function updateSpeed() {
        audio.playbackRate = parseFloat(speedSlider.value);
        speedVal.textContent = speedSlider.value + 'x';
    }

    // ── Playback ──
    function loadTrack(index) {
        if (index < 0 || index >= trackList.length) return;
        currentTrackIndex = index;
        const track = trackList[index];
        audio.src = track.blobUrl;
        audio.load();
        nowPlayingTitle.textContent = track.title + ' — ' + track.artist;
        highlightTrack(index);
        totalTimeEl.textContent = track.duration ? formatTime(track.duration) : '0:00';
        currentTimeEl.textContent = '0:00';
        progressBar.value = 0;
        btnDownload.disabled = false;
    }

    function onSongClick(e, index) {
        if (currentTrackIndex === index) {
            togglePlay();
        } else {
            loadTrack(index);
            if (!isPlaying) togglePlay();
        }
    }

    function togglePlay() {
        if (!audio.src || currentTrackIndex < 0) {
            if (trackList.length > 0) loadTrack(0);
            else return;
        }
        initAudioContext();
        if (isPlaying) {
            audio.pause();
            setPlayState(false);
        } else {
            audio.play().then(() => setPlayState(true)).catch(() => setPlayState(false));
        }
    }

    function setPlayState(playing) {
        isPlaying = playing;
        playIcon.style.display = playing ? 'none' : 'block';
        pauseIcon.style.display = playing ? 'block' : 'none';
    }

    function playNext() {
        if (trackList.length === 0) return;
        let nextIdx;
        if (shuffleMode) {
            nextIdx = Math.floor(Math.random() * trackList.length);
            if (nextIdx === currentTrackIndex && trackList.length > 1) nextIdx = (nextIdx + 1) % trackList.length;
        } else {
            nextIdx = (currentTrackIndex + 1) % trackList.length;
        }
        loadTrack(nextIdx);
        if (isPlaying) audio.play().then(() => setPlayState(true)).catch(() => setPlayState(false));
        else togglePlay();
    }

    function playPrev() {
        if (trackList.length === 0) return;
        if (audio.currentTime > 3) {
            audio.currentTime = 0;
            if (!isPlaying) togglePlay();
            return;
        }
        let prevIdx;
        if (shuffleMode) {
            prevIdx = Math.floor(Math.random() * trackList.length);
        } else {
            prevIdx = (currentTrackIndex - 1 + trackList.length) % trackList.length;
        }
        loadTrack(prevIdx);
        if (isPlaying) audio.play().then(() => setPlayState(true)).catch(() => setPlayState(false));
        else togglePlay();
    }

    function highlightTrack(index) {
        document.querySelectorAll('.song-item').forEach(item => item.classList.remove('active-track'));
        if (index >= 0 && trackList[index]?.element) trackList[index].element.classList.add('active-track');
    }

    // ── Download ──
    btnDownload.addEventListener('click', () => {
        if (currentTrackIndex < 0 || !trackList[currentTrackIndex]?.file) return;
        const file = trackList[currentTrackIndex].file;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
    });

    // ── Progress & Time ──
    audio.addEventListener('timeupdate', () => {
        if (audio.duration && isFinite(audio.duration)) {
            progressBar.value = Math.round((audio.currentTime / audio.duration) * 1000);
            currentTimeEl.textContent = formatTime(audio.currentTime);
        }
    });

    audio.addEventListener('loadedmetadata', () => {
        if (isFinite(audio.duration)) {
            totalTimeEl.textContent = formatTime(audio.duration);
            // Update track duration if unknown
            if (currentTrackIndex >= 0 && !trackList[currentTrackIndex]?.duration) {
                trackList[currentTrackIndex].duration = audio.duration;
                const durEl = trackList[currentTrackIndex]?.element?.querySelector('.song-duration');
                if (durEl) durEl.textContent = formatTime(audio.duration);
            }
        }
    });

    audio.addEventListener('ended', () => {
        if (repeatMode === 'one') {
            audio.currentTime = 0;
            audio.play().then(() => setPlayState(true)).catch(() => setPlayState(false));
        } else if (repeatMode === 'all' || currentTrackIndex < trackList.length - 1 || shuffleMode) {
            playNext();
        } else {
            setPlayState(false);
            audio.currentTime = 0;
            progressBar.value = 0;
            currentTimeEl.textContent = '0:00';
        }
    });

    progressBar.addEventListener('input', (e) => {
        if (audio.duration && isFinite(audio.duration)) {
            audio.currentTime = (e.target.value / 1000) * audio.duration;
        }
    });

    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        return `${min}:${sec < 10 ? '0' : ''}${sec}`;
    }

    // ── Controls ──
    btnPlay.addEventListener('click', togglePlay);
    btnNext.addEventListener('click', playNext);
    btnPrev.addEventListener('click', playPrev);
    btnShuffle.addEventListener('click', () => {
        shuffleMode = !shuffleMode;
        btnShuffle.classList.toggle('active', shuffleMode);
    });
    btnRepeat.addEventListener('click', () => {
        if (repeatMode === 'off') repeatMode = 'all';
        else if (repeatMode === 'all') repeatMode = 'one';
        else repeatMode = 'off';
        btnRepeat.classList.toggle('active', repeatMode !== 'off');
        btnRepeat.title = 'Repeat: ' + (repeatMode === 'off' ? 'Off' : repeatMode === 'all' ? 'All' : 'One');
    });

    // ── Effect Sliders ──
    wetSlider.addEventListener('input', () => { wetVal.textContent = wetSlider.value + '%'; if (reverbToggle.checked) updateWetMix(); });
    reverbToggle.addEventListener('change', updateReverbEnabled);
    roomSlider.addEventListener('input', () => {
        if (roomDebounceTimer) clearTimeout(roomDebounceTimer);
        roomDebounceTimer = setTimeout(updateRoomSize, 180);
    });
    roomSlider.addEventListener('change', () => { if (roomDebounceTimer) clearTimeout(roomDebounceTimer); updateRoomSize(); });
    stereoSllider.addEventListener('input', updateStereoWidth);
    bassSlider.addEventListener('input', updateBass);
    trebleSlider.addEventListener('input', updateTreble);
    volumeSlider.addEventListener('input', updateVolume);
    speedSlider.addEventListener('input', updateSpeed);

    // ── Visualizer ──
    function drawVisualizer() {
        if (!analyserNode || !visualizerCtx) {
            requestAnimationFrame(drawVisualizer);
            return;
        }
        const w = visualizerCanvas.width;
        const h = visualizerCanvas.height;
        const ctx = visualizerCtx;
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, w, h);
        const barCount = 48;
        const barWidth = (w / barCount) * 0.75;
        const gap = (w / barCount) * 0.25;
        for (let i = 0; i < barCount; i++) {
            const value = dataArray[Math.floor(i * bufferLength / barCount)] || 0;
            const barHeight = Math.max(2, (value / 255) * h * 0.8);
            const x = i * (barWidth + gap) + gap / 2;
            const y = h - barHeight;
            ctx.fillStyle = getComputedStyle(body).getPropertyValue('--accent').trim() || '#3b82f6';
            ctx.globalAlpha = 0.7;
            ctx.fillRect(x, y, barWidth, barHeight);
        }
        ctx.globalAlpha = 1;
        requestAnimationFrame(drawVisualizer);
    }
    drawVisualizer();

    // ── Keyboard shortcuts ──
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        switch (e.code) {
            case 'Space': e.preventDefault(); togglePlay(); break;
            case 'ArrowRight': e.preventDefault(); if (e.ctrlKey || e.metaKey) playNext(); else audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); break;
            case 'ArrowLeft': e.preventDefault(); if (e.ctrlKey || e.metaKey) playPrev(); else audio.currentTime = Math.max(0, audio.currentTime - 5); break;
            case 'ArrowUp': e.preventDefault(); volumeSlider.value = Math.min(150, parseInt(volumeSlider.value) + 5); updateVolume(); break;
            case 'ArrowDown': e.preventDefault(); volumeSlider.value = Math.max(0, parseInt(volumeSlider.value) - 5); updateVolume(); break;
        }
    });

    // ── Initial State ──
    updateRoomSize();
    updateStereoWidth();
    updateBass();
    updateTreble();
    updateVolume();
    updateSpeed();
    setPlayState(false);
    btnDownload.disabled = true;
});