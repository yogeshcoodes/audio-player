document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const body = document.body;

    // UI Connections
    const views = {
        'songs-view': $('songs-view'),
        'playlists-view': $('playlists-view'),
        'effects-panel': $('effects-panel')
    };
    const songListContainer = $('song-list');
    const playlistsHome = $('playlists-home');
    const playlistDetail = $('playlist-detail');
    const playlistCardsContainer = $('playlists-container');
    const playlistSongList = $('playlist-song-list');

    const emptyState = $('empty-state');
    const searchBar = $('search-bar');
    const nowPlayingTitle = $('now-playing-title');
    const progressBar = $('progress-bar');
    const currentTimeEl = $('current-time');
    const totalTimeEl = $('total-time');
    
    // Both Footer and Overlay Canvas visualizers
    const visualizerCanvas = $('visualizer');
    const visualizerCtx = visualizerCanvas.getContext('2d');
    const npVisualizerCanvas = $('np-visualizer');
    const npVisualizerCtx = npVisualizerCanvas ? npVisualizerCanvas.getContext('2d') : null;

    // Dynamically update the Normalizer UI attributes 
    const slNormTarget = $('sl-norm-target');
    const valNormTarget = $('val-norm-target');
    if (slNormTarget && valNormTarget) {
        slNormTarget.min = -24;
        slNormTarget.max = 0;
        slNormTarget.value = -12;
        valNormTarget.textContent = '-12 dB';
    }

    // SVG Icons
    const outlineHeart = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    const filledHeart = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    const dotsIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;
    const playIndicatorSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
    const pausedIndicatorSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

    // System States
    let trackList = [];
    let currentTrackIndex = -1;
    let isPlaying = false;
    let shuffleMode = false;
    let repeatMode = 'off';
    let exportFormat = 'wav'; 
    let currentSort = 'name-asc';
    let trackMenuTargetId = null; 

    // Playlists State
    let customPlaylists = [];
    let activePlaylistId = null;

    // Scrolling & Virtualization State
    let currentDisplayList = [];
    let currentlyRendered = 0;
    const RENDER_CHUNK = 50;

    // ── NATIVE AUDIO ENGINE ──
    const audio = new Audio();
    let vinylMode = true;
    audio.preservesPitch = !vinylMode;

    let audioCtx, sourceNode, analyserNode;
    let audioCtxInitialized = false; 
    
    const fx = { normalizer: false, clarity: false, eq: false, vocal: false, comp: false, limit: false, echo: false, flanger: false, reverb: false, mono: false, invert: false, eightD: false, preamp: false, balance: false };
    let nodes = {};

    // ── TRUE PEAK & RMS AGC NORMALIZER WORKLET (Fixed Over-boosting & Distortion) ──
    const agcWorkletCode = `
    class AGCProcessor extends AudioWorkletProcessor {
        constructor() {
            super();
            this.targetLevel = Math.pow(10, -12 / 20); // Default -12dB Target
            this.currentGain = 1.0;
            this.rms = 0; 
            
            this.port.onmessage = (e) => {
                if (e.data.targetDb !== undefined) {
                    this.targetLevel = Math.pow(10, e.data.targetDb / 20);
                }
            };
        }

        process(inputs, outputs) {
            const input = inputs[0];
            const output = outputs[0];
            if (!input || !input.length) return true;

            const channels = input.length;
            const frames = input[0].length;
            
            // Calculate instantaneous block RMS
            let sumSquare = 0;
            for (let c = 0; c < channels; c++) {
                for (let i = 0; i < frames; i++) {
                    sumSquare += input[c][i] * input[c][i];
                }
            }
            let blockRms = Math.sqrt(sumSquare / (frames * channels));

            // Extremely slow decay for RMS window (avoids pumping on drums)
            this.rms = 0.999 * this.rms + 0.001 * blockRms;
            let safeRms = Math.max(this.rms, 0.001); 
            
            // Determine desired gain based on Target / RMS
            let desiredGain = this.targetLevel / safeRms;
            
            // Allow larger boosts but restrict crazy peaks
            desiredGain = Math.max(0.1, Math.min(desiredGain, 4.0)); 

            for (let i = 0; i < frames; i++) {
                // Smooth gain transition at audio rate
                this.currentGain += 0.001 * (desiredGain - this.currentGain);
                
                for (let c = 0; c < channels; c++) {
                    let outVal = input[c][i] * this.currentGain;
                    
                    // Soft clipping safety net to prevent any accidental distortion
                    if (outVal > 0.95) {
                        outVal = 0.95 + 0.05 * Math.tanh((outVal - 0.95) * 20);
                    } else if (outVal < -0.95) {
                        outVal = -0.95 + 0.05 * Math.tanh((outVal + 0.95) * 20);
                    }
                    output[c][i] = outVal;
                }
            }
            return true;
        }
    }
    registerProcessor('agc-processor', AGCProcessor);
    `;

    // Apply default format styling
    document.querySelectorAll('.format-btn').forEach(b => {
        b.classList.remove('active');
        if (b.dataset.format === 'wav') b.classList.add('active'); // default
    });

    // ── INDEXED DB FOR FOLDER PERSISTENCE ──
    const dbName = 'AudioPlayerDB';
    function initDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(dbName, 1);
            req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
            req.onsuccess = e => resolve(e.target.result);
            req.onerror = e => reject(e);
        });
    }
    async function saveHandle(handle) {
        try {
            const db = await initDB();
            const tx = db.transaction('handles', 'readwrite');
            tx.objectStore('handles').put(handle, 'folderHandle');
        } catch (e) { console.warn("IDB Save Error", e); }
    }
    async function getHandle() {
        try {
            const db = await initDB();
            return new Promise(resolve => {
                const tx = db.transaction('handles', 'readonly');
                const req = tx.objectStore('handles').get('folderHandle');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });
        } catch (e) { return null; }
    }

    // ── TOAST SYSTEM ──
    function showToast(message, type = '') {
        const container = $('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast' + (type ? ' ' + type : '');
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 3000);
    }

    // ── CUSTOM MODAL SYSTEM ──
    let modalResolve = null;
    function showModal(title, options = {}) {
        return new Promise((resolve) => {
            modalResolve = resolve;
            const overlay = $('custom-modal-overlay');
            const titleEl = $('custom-modal-title');
            const messageEl = $('custom-modal-message');
            const inputEl = $('custom-modal-input');
            const cancelBtn = $('custom-modal-cancel');
            const confirmBtn = $('custom-modal-confirm');

            titleEl.textContent = title;

            if (options.message) {
                messageEl.textContent = options.message;
                messageEl.style.display = 'block';
            } else {
                messageEl.style.display = 'none';
            }

            if (options.showInput) {
                inputEl.style.display = 'block';
                inputEl.value = options.defaultValue || '';
                inputEl.focus();
            } else {
                inputEl.style.display = 'none';
            }

            confirmBtn.textContent = options.confirmText || 'OK';
            cancelBtn.style.display = options.showCancel !== false ? 'flex' : 'none';

            overlay.classList.remove('hidden');

            const cleanup = () => {
                overlay.classList.add('hidden');
                cancelBtn.onclick = null;
                confirmBtn.onclick = null;
                inputEl.onkeydown = null;
            };

            cancelBtn.onclick = () => {
                cleanup();
                resolve(options.showInput ? null : false);
            };

            confirmBtn.onclick = () => {
                const value = options.showInput ? inputEl.value.trim() : true;
                cleanup();
                resolve(value);
            };

            inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    const value = options.showInput ? inputEl.value.trim() : true;
                    cleanup();
                    resolve(value);
                }
            };

            overlay.onclick = (e) => {
                if (e.target === overlay) {
                    cleanup();
                    resolve(options.showInput ? null : false);
                }
            };
        });
    }

    function showPrompt(title, defaultValue = '') {
        return showModal(title, { showInput: true, defaultValue: defaultValue, showCancel: true });
    }

    function showConfirm(title, message) {
        return showModal(title, { message: message, showInput: false, showCancel: true, confirmText: 'Confirm' });
    }

    // ── MATERIAL YOU COLOR INFRASTRUCTURE ──
    const colorPalette = ['#6BA661', '#601515', '#A67A19', '#949494', '#325788', '#BEB5AB', '#CB1E1E', '#34806D', '#333333', '#57612C'];

    function hexToRgbGlow(hex) {
        let c = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return c ? `rgba(${parseInt(c[1], 16)}, ${parseInt(c[2], 16)}, ${parseInt(c[3], 16)}, 0.18)` : 'rgba(0,0,0,0.1)';
    }

    function applyAccentColor(hex) {
        document.documentElement.style.setProperty('--accent', hex);
        document.documentElement.style.setProperty('--accent-glow', hexToRgbGlow(hex));
        localStorage.setItem('theme-accent', hex);
        document.querySelectorAll('.color-dot').forEach(dot => {
            dot.classList.toggle('active-accent', dot.dataset.color === hex);
        });
    }

    function buildAccentSettingsUI() {
        const drawerBody = document.querySelector('.drawer-body');
        const section = document.createElement('div');
        section.className = 'drawer-section';
        section.style.flexDirection = 'column';
        section.style.alignItems = 'flex-start';
        section.style.gap = '12px';
        section.style.marginTop = '8px';
        const label = document.createElement('label');
        label.className = 'drawer-label';
        label.textContent = 'Accent Color';
        const grid = document.createElement('div');
        grid.className = 'palette-grid';
        colorPalette.forEach(hex => {
            const dot = document.createElement('div');
            dot.className = 'color-dot';
            dot.style.backgroundColor = hex;
            dot.dataset.color = hex;
            dot.onclick = () => applyAccentColor(hex);
            grid.appendChild(dot);
        });
        section.appendChild(label);
        section.appendChild(grid);
        drawerBody.appendChild(section);
    }
    buildAccentSettingsUI();
    const savedAccent = localStorage.getItem('theme-accent') || '#6BA661';
    applyAccentColor(savedAccent);

    // Theme Routing
    const currentTheme = localStorage.getItem('theme') || 'light';
    body.className = currentTheme + '-theme';
    $('theme-toggle').checked = currentTheme === 'light';
    $('theme-toggle').addEventListener('change', e => {
        const t = e.target.checked ? 'light' : 'dark';
        body.className = t + '-theme';
        localStorage.setItem('theme', t);
    });

    // Dropdown Logic
    const sortBtn = $('sort-btn');
    const sortBtnText = $('sort-btn-text');
    const sortDropdown = $('sort-dropdown');
    sortBtn.onclick = (e) => { e.stopPropagation(); sortDropdown.classList.toggle('hidden'); };
    document.addEventListener('click', () => { 
        sortDropdown.classList.add('hidden');
        $('track-options-menu').classList.add('hidden'); // Also close track options menu
    });

    sortDropdown.querySelectorAll('.dropdown-option').forEach(opt => {
        opt.onclick = (e) => {
            e.stopPropagation();
            currentSort = opt.dataset.value;
            sortBtnText.textContent = opt.textContent;
            sortDropdown.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('active-option'));
            opt.classList.add('active-option');
            sortDropdown.classList.add('hidden');
            sortAndRenderTracks();
        };
    });
    const defaultSortOpt = sortDropdown.querySelector('[data-value="name-asc"]');
    if (defaultSortOpt) defaultSortOpt.classList.add('active-option');

    // Track Options Menu logic
    $('opt-play-next').onclick = (e) => {
        e.stopPropagation();
        $('track-options-menu').classList.add('hidden');
        showToast("Track queued to play next.");
        // Basic queue next implementation
        if (trackMenuTargetId) {
            const idx = trackList.findIndex(t => t.id === trackMenuTargetId);
            if (idx >= 0 && idx !== currentTrackIndex) {
                // Move item array logic would go here if full queue system existed
                const t = trackList.splice(idx, 1)[0];
                trackList.splice(currentTrackIndex + 1, 0, t);
                sortAndRenderTracks(); // Redraw UI
            }
        }
    };
    
    $('opt-add-playlist').onclick = (e) => {
        e.stopPropagation();
        $('track-options-menu').classList.add('hidden');
        if (!trackMenuTargetId || customPlaylists.length === 0) {
            showToast(customPlaylists.length === 0 ? "No playlists exist. Create one first!" : "Select track error.");
            return;
        }
        
        let plNames = customPlaylists.map(p => p.name).join(', ');
        showPrompt(`Add to Playlist (${plNames}):`, customPlaylists[0].name).then(name => {
            if (name) {
                let pList = customPlaylists.find(p => p.name.toLowerCase() === name.toLowerCase());
                if(pList) {
                    if (!pList.trackIds.includes(trackMenuTargetId)) {
                        pList.trackIds.push(trackMenuTargetId);
                        showToast(`Added to ${pList.name}`);
                    } else showToast("Already in playlist");
                } else showToast("Playlist not found", "error");
            }
        });
    };

    // Export Format Selector
    const formatBtns = document.querySelectorAll('.format-btn');
    formatBtns.forEach(btn => {
        btn.onclick = () => {
            formatBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            exportFormat = btn.dataset.format;
        };
    });

    // Swipe Gestures
    let touchStartX = 0,
        touchStartY = 0,
        swipeFromFooter = false;
    document.addEventListener('touchstart', e => {
        if (e.target.closest('input[type="range"]') || e.target.closest('.switch') || e.target.closest('textarea')) {
            window.preventSwipe = true;
            return;
        }
        window.preventSwipe = false;
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
        const footer = document.querySelector('footer');
        if (e.changedTouches[0].clientY >= footer.getBoundingClientRect().top - 30) swipeFromFooter = true;
        else swipeFromFooter = false;
    }, { passive: true });

    document.addEventListener('touchend', e => {
        if (window.preventSwipe) return;
        let diffX = e.changedTouches[0].screenX - touchStartX;
        let diffY = e.changedTouches[0].screenY - touchStartY;

        if (swipeFromFooter && diffY < -50 && Math.abs(diffY) > Math.abs(diffX)) {
            if (!$('drawer').classList.contains('open')) {
                openNowPlayingOverlay();
            }
            return;
        }

        const npOverlay = $('now-playing-overlay');
        const overlayContent = document.querySelector('.np-overlay-content');
        if (npOverlay.classList.contains('open') && diffY > 60 && Math.abs(diffY) > Math.abs(diffX)) {
            if (!overlayContent || overlayContent.scrollTop <= 0) {
                closeNowPlayingOverlay();
                return;
            }
        }

        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
            const isDrawerOpen = $('drawer').classList.contains('open');
            const activeTab = document.querySelector('.tabs button.active').dataset.view;
            if (diffX > 0) {
                if (isDrawerOpen) return;
                if (activeTab === 'effects-panel') document.querySelector('.tabs button[data-view="playlists-view"]')
                    .click();
                else if (activeTab === 'playlists-view') document.querySelector(
                    '.tabs button[data-view="songs-view"]').click();
                else if (activeTab === 'songs-view') $('btn-menu').click();
            } else {
                if (isDrawerOpen) $('btn-close-drawer').click();
                else if (activeTab === 'songs-view') document.querySelector(
                    '.tabs button[data-view="playlists-view"]').click();
                else if (activeTab === 'playlists-view') document.querySelector(
                    '.tabs button[data-view="effects-panel"]').click();
            }
        }
    }, { passive: true });

    // Overlay Handling
    function openNowPlayingOverlay() {
        const overlay = $('now-playing-overlay');
        overlay.classList.remove('hidden');
        overlay.classList.add('open');
        updateNowPlayingOverlay();
    }

    function closeNowPlayingOverlay() {
        const overlay = $('now-playing-overlay');
        overlay.classList.remove('open');
        setTimeout(() => overlay.classList.add('hidden'), 400);
    }

    function updateNowPlayingOverlay() {
        if (currentTrackIndex < 0 || !trackList[currentTrackIndex]) {
            $('np-title').textContent = 'No track selected';
            $('np-artist').textContent = '';
            $('np-album-art').style.display = 'none';
            $('np-art-placeholder').style.display = 'flex';
            return;
        }
        const t = trackList[currentTrackIndex];
        $('np-title').textContent = t.title;
        $('np-artist').textContent = t.artist || '';

        if (t.albumArt) {
            $('np-album-art').src = t.albumArt;
        } else {
            const imgIndex = (t.index % 7) + 1;
            $('np-album-art').src = `assets/image-${imgIndex}.jpg`;
        }
        $('np-album-art').style.display = 'block';
        $('np-art-placeholder').style.display = 'none';

        if (t.lyrics) {
            $('np-lyrics-display').textContent = t.lyrics;
            $('np-lyrics-display').style.display = 'block';
            $('np-lyrics-editor').style.display = 'none';
        } else {
            $('np-lyrics-display').innerHTML =
                '<p class="lyrics-placeholder">No lyrics loaded. Tap the icon to load a .lrc file, or add lyrics below.</p>';
            $('np-lyrics-display').style.display = 'block';
            $('np-lyrics-editor').style.display = 'none';
        }
    }
    document.querySelector('.np-overlay-handle').onclick = closeNowPlayingOverlay;

    // Lyrics
    $('btn-load-lyrics').onclick = () => $('lyrics-input').click();
    $('lyrics-input').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            let text = parseLRC(reader.result);
            if (currentTrackIndex >= 0 && trackList[currentTrackIndex]) trackList[currentTrackIndex].lyrics =
                text;
            $('np-lyrics-display').textContent = text;
            $('np-lyrics-display').style.display = 'block';
            $('np-lyrics-editor').style.display = 'none';
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    function parseLRC(text) {
        return text.split('\n').map(line => {
            const match = line.match(/^\[\d{2}:\d{2}(?:\.\d{2,3})?\](.*)/);
            return match ? match[1].trim() : line.trim();
        }).filter(l => l.length > 0).join('\n') || text;
    }
    $('btn-edit-lyrics').onclick = () => {
        const display = $('np-lyrics-display');
        const editor = $('np-lyrics-editor');
        if (editor.style.display === 'none' || !editor.style.display) {
            editor.value = display.textContent.replace(/No lyrics loaded.*/, '');
            display.style.display = 'none';
            editor.style.display = 'block';
            editor.focus();
            $('btn-edit-lyrics').textContent = 'Save Lyrics';
        } else {
            const newLyrics = editor.value.trim();
            if (currentTrackIndex >= 0 && trackList[currentTrackIndex]) trackList[currentTrackIndex].lyrics =
                newLyrics;
            display.textContent = newLyrics || 'No lyrics loaded.';
            display.style.display = 'block';
            editor.style.display = 'none';
            $('btn-edit-lyrics').textContent = 'Edit Lyrics';
        }
    };

    // Sidebar & View
    $('btn-menu').onclick = () => {
        $('drawer').classList.add('open');
        $('drawer-overlay').classList.remove('hidden');
    };
    const cancelDrawer = () => {
        $('drawer').classList.remove('open');
        $('drawer-overlay').classList.add('hidden');
    };
    $('btn-close-drawer').onclick = cancelDrawer;
    $('drawer-overlay').onclick = cancelDrawer;

    document.querySelectorAll('.tabs button').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.tabs button').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            Object.values(views).forEach(v => v.classList.remove('active-view'));
            views[tab.dataset.view].classList.add('active-view');

            if (tab.dataset.view === 'songs-view') {
                activePlaylistId = null;
                sortAndRenderTracks();
            } else if (tab.dataset.view === 'playlists-view') {
                renderPlaylistsHome();
            }
        };
    });

    document.querySelectorAll('.expandable .fx-header').forEach(header => {
        header.onclick = (e) => {
            if (e.target.closest('.switch') || e.target.closest('.reset-btn')) return;
            header.parentElement.classList.toggle('open');
        };
    });

    $('search-input').oninput = e => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.song-item').forEach(item => {
            const title = item.querySelector('h3').innerText.toLowerCase();
            const artist = item.querySelector('p').innerText.toLowerCase();
            item.style.display = (title.includes(q) || artist.includes(q)) ? 'flex' : 'none';
        });
    };

    // Audio Context Setup
    async function initAudioContext() {
        if (audioCtx) {
            if (audioCtx.state === 'suspended') await audioCtx.resume();
            return;
        }
        if (audioCtxInitialized) return; 
        audioCtxInitialized = true;

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Inject Custom Worklet for high fidelity Normalizer
        const blob = new Blob([agcWorkletCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await audioCtx.audioWorklet.addModule(url);

        sourceNode = audioCtx.createMediaElementSource(audio);
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;

        buildEffectNodes(audioCtx);
        routeAudio();
        generateReverbIR();
    }

    function buildEffectNodes(ctx) {
        nodes.masterGain = ctx.createGain();
        nodes.masterGain.gain.value = 0.65; 

        nodes.masterLimiter = ctx.createDynamicsCompressor();
        nodes.masterLimiter.threshold.value = -0.5;
        nodes.masterLimiter.knee.value = 0.0;
        nodes.masterLimiter.ratio.value = 20.0;
        nodes.masterLimiter.attack.value = 0.002;
        nodes.masterLimiter.release.value = 0.100;

        // --- NEW: Transparent Peak AGC Normalizer ---
        try {
            nodes.normAGC = new AudioWorkletNode(ctx, 'agc-processor');
            updateNormalizerParams();
        } catch (e) {
            console.error("AGC Worklet failed", e);
            nodes.normAGC = ctx.createGain();
        }

        nodes.preampGain = ctx.createGain();
        nodes.preampGain.gain.value = 1.0;

        nodes.balancePan = ctx.createStereoPanner();
        nodes.balancePan.pan.value = 0;

        // --- REVISED: Clearity+ (Spacious, Natural, Non-Fatiguing Atmos Style) ---
        nodes.clrBassSmooth = ctx.createBiquadFilter();
        nodes.clrBassSmooth.type = 'lowshelf';
        nodes.clrBassSmooth.frequency.value = 60; // Gentle sub-warmth
        nodes.clrBassSmooth.gain.value = 1.5;
        
        nodes.clrMudCut = ctx.createBiquadFilter();
        nodes.clrMudCut.type = 'peaking';
        nodes.clrMudCut.frequency.value = 250; 
        nodes.clrMudCut.Q.value = 0.8;
        nodes.clrMudCut.gain.value = -1.5; // Clear muddiness safely

        nodes.clrDetailBoost = ctx.createBiquadFilter();
        nodes.clrDetailBoost.type = 'peaking';
        nodes.clrDetailBoost.frequency.value = 4000;
        nodes.clrDetailBoost.Q.value = 0.5;
        nodes.clrDetailBoost.gain.value = -1.0; // DIP harshness slightly to prevent fatigue

        nodes.clrAirShelf = ctx.createBiquadFilter();
        nodes.clrAirShelf.type = 'highshelf';
        nodes.clrAirShelf.frequency.value = 12000; // Breath & air
        nodes.clrAirShelf.gain.value = 2.0;

        nodes.clrNormalizer = ctx.createDynamicsCompressor();
        nodes.clrNormalizer.threshold.value = -22;
        nodes.clrNormalizer.knee.value = 12;
        nodes.clrNormalizer.ratio.value = 1.4;
        nodes.clrNormalizer.attack.value = 0.02;
        nodes.clrNormalizer.release.value = 0.15;
        
        nodes.clrWidth = createStereoWidthNode(ctx);
        nodes.clrWidth.setWidth(1.4); // Enhanced realistic width
        
        nodes.clrAntiDistort = ctx.createGain();
        nodes.clrAntiDistort.gain.value = 0.85;

        nodes.clrBassSmooth.connect(nodes.clrMudCut);
        nodes.clrMudCut.connect(nodes.clrDetailBoost);
        nodes.clrDetailBoost.connect(nodes.clrAirShelf);
        nodes.clrAirShelf.connect(nodes.clrNormalizer);
        nodes.clrNormalizer.connect(nodes.clrWidth.input);
        nodes.clrWidth.output.connect(nodes.clrAntiDistort);

        buildPitchShifter(ctx);

        nodes.eq = [ctx.createBiquadFilter(), ctx.createBiquadFilter(), ctx.createBiquadFilter(), ctx.createBiquadFilter()];
        nodes.eq[0].type = 'lowshelf';
        nodes.eq[0].frequency.value = 100;
        nodes.eq[1].type = 'peaking';
        nodes.eq[1].frequency.value = 500;
        nodes.eq[1].Q.value = 1.0;
        nodes.eq[2].type = 'peaking';
        nodes.eq[2].frequency.value = 2500;
        nodes.eq[2].Q.value = 1.0;
        nodes.eq[3].type = 'highshelf';
        nodes.eq[3].frequency.value = 8000;
        nodes.eq[0].connect(nodes.eq[1]);
        nodes.eq[1].connect(nodes.eq[2]);
        nodes.eq[2].connect(nodes.eq[3]);

        nodes.comp = ctx.createDynamicsCompressor();
        updateCompParams();
        nodes.limit = ctx.createDynamicsCompressor();
        nodes.limit.ratio.value = 20;
        nodes.limit.attack.value = 0.001;
        nodes.limit.knee.value = 0;
        updateLimiterParams();

        nodes.echoIn = ctx.createGain();
        nodes.echoOut = ctx.createGain();
        nodes.echoDry = ctx.createGain();
        nodes.echoWet = ctx.createGain();
        nodes.echoDelay = ctx.createDelay(2.0);
        nodes.echoFb = ctx.createGain();
        nodes.echoIn.connect(nodes.echoDry);
        nodes.echoIn.connect(nodes.echoDelay);
        nodes.echoDelay.connect(nodes.echoFb);
        nodes.echoFb.connect(nodes.echoDelay);
        nodes.echoDelay.connect(nodes.echoWet);
        nodes.echoDry.connect(nodes.echoOut);
        nodes.echoWet.connect(nodes.echoOut);
        updateEchoParams();

        nodes.flangIn = ctx.createGain();
        nodes.flangOut = ctx.createGain();
        nodes.flangDelay = ctx.createDelay(1.0);
        nodes.flangFb = ctx.createGain();
        nodes.flangLfo = ctx.createOscillator();
        nodes.flangLfo.type = 'sine';
        nodes.flangLfoGain = ctx.createGain();
        nodes.flangLfo.connect(nodes.flangLfoGain);
        nodes.flangLfoGain.connect(nodes.flangDelay.delayTime);
        nodes.flangLfo.start();
        nodes.flangIn.connect(nodes.flangOut);
        nodes.flangIn.connect(nodes.flangDelay);
        nodes.flangDelay.connect(nodes.flangFb);
        nodes.flangFb.connect(nodes.flangDelay);
        nodes.flangDelay.connect(nodes.flangOut);
        updateFlangerParams();

        nodes.eightDIn = ctx.createGain();
        nodes.eightDOut = ctx.createGain();
        nodes.eightDPan = ctx.createStereoPanner();
        nodes.eightDLfo = ctx.createOscillator();
        nodes.eightDLfo.type = 'sine';
        nodes.eightDLfoGain = ctx.createGain();
        nodes.eightDLfo.connect(nodes.eightDLfoGain);
        nodes.eightDLfoGain.connect(nodes.eightDPan.pan);
        nodes.eightDLfo.start();
        nodes.eightDRevConvolver = ctx.createConvolver();
        nodes.eightDRevWet = ctx.createGain();
        nodes.eightDRevDry = ctx.createGain();
        nodes.eightDIn.connect(nodes.eightDPan);
        nodes.eightDPan.connect(nodes.eightDRevDry);
        nodes.eightDPan.connect(nodes.eightDRevConvolver);
        nodes.eightDRevConvolver.connect(nodes.eightDRevWet);
        nodes.eightDRevDry.connect(nodes.eightDOut);
        nodes.eightDRevWet.connect(nodes.eightDOut);
        updateEightDParams();

        nodes.mono = ctx.createChannelMerger(1);
        nodes.invSplit = ctx.createChannelSplitter(2);
        nodes.invMerge = ctx.createChannelMerger(2);
        nodes.invSplit.connect(nodes.invMerge, 0, 1);
        nodes.invSplit.connect(nodes.invMerge, 1, 0);
        nodes.vocSplit = ctx.createChannelSplitter(2);
        nodes.vocMerge = ctx.createChannelMerger(2);
        nodes.vocInvert = ctx.createGain();
        nodes.vocInvert.gain.value = -1;
        nodes.vocSplit.connect(nodes.vocMerge, 0, 0);
        nodes.vocSplit.connect(nodes.vocMerge, 0, 1);
        nodes.vocSplit.connect(nodes.vocInvert, 1);
        nodes.vocInvert.connect(nodes.vocMerge, 0, 0);
        nodes.vocInvert.connect(nodes.vocMerge, 0, 1);

        nodes.revIn = ctx.createGain();
        nodes.revOut = ctx.createGain();
        nodes.revDry = ctx.createGain();
        nodes.revWet = ctx.createGain();
        nodes.revPreDelay = ctx.createDelay(1.0);
        nodes.revConvolver = ctx.createConvolver();
        nodes.revLowCut = ctx.createBiquadFilter();
        nodes.revLowCut.type = 'highpass';
        nodes.revWidth = createStereoWidthNode(ctx);
        nodes.revIn.connect(nodes.revDry);
        nodes.revIn.connect(nodes.revPreDelay);
        nodes.revPreDelay.connect(nodes.revConvolver);
        nodes.revConvolver.connect(nodes.revLowCut);
        nodes.revLowCut.connect(nodes.revWidth.input);
        nodes.revWidth.output.connect(nodes.revWet);
        nodes.revDry.connect(nodes.revOut);
        nodes.revWet.connect(nodes.revOut);
        updateReverbParams();
    }

    function buildPitchShifter(ctx) {
        const grainSec = 0.045;
        const lfoFreq = 1 / (grainSec * 2);
        nodes.pitchIn = ctx.createGain();
        nodes.pitchOut = ctx.createGain();
        nodes.pitchDelayA = ctx.createDelay(0.3);
        nodes.pitchDelayB = ctx.createDelay(0.3);
        nodes.pitchDelayA.delayTime.value = grainSec;
        nodes.pitchDelayB.delayTime.value = grainSec;
        nodes.pitchGainA = ctx.createGain();
        nodes.pitchGainB = ctx.createGain();
        nodes.pitchLfo = ctx.createOscillator();
        nodes.pitchLfo.type = 'triangle';
        nodes.pitchLfo.frequency.value = lfoFreq;
        nodes.pitchModGainA = ctx.createGain();
        nodes.pitchModGainA.gain.value = 0;
        nodes.pitchModGainB = ctx.createGain();
        nodes.pitchModGainB.gain.value = 0;
        nodes.pitchLfoInvert = ctx.createGain();
        nodes.pitchLfoInvert.gain.value = -1;
        nodes.pitchXfadeLfo = ctx.createOscillator();
        nodes.pitchXfadeLfo.type = 'sine';
        nodes.pitchXfadeLfo.frequency.value = lfoFreq;
        nodes.pitchXfadeGainA = ctx.createGain();
        nodes.pitchXfadeGainB = ctx.createGain();
        nodes.pitchXfadeInvert = ctx.createGain();
        nodes.pitchXfadeInvert.gain.value = -1;
        nodes.pitchXfadeOffsetA = ctx.createGain();
        nodes.pitchXfadeOffsetA.gain.value = 0.5;
        nodes.pitchXfadeOffsetB = ctx.createGain();
        nodes.pitchXfadeOffsetB.gain.value = 0.5;
        nodes.pitchLfo.connect(nodes.pitchModGainA);
        nodes.pitchModGainA.connect(nodes.pitchDelayA.delayTime);
        nodes.pitchLfo.connect(nodes.pitchLfoInvert);
        nodes.pitchLfoInvert.connect(nodes.pitchModGainB);
        nodes.pitchModGainB.connect(nodes.pitchDelayB.delayTime);
        nodes.pitchXfadeLfo.connect(nodes.pitchXfadeGainA);
        nodes.pitchXfadeGainA.connect(nodes.pitchXfadeOffsetA);
        nodes.pitchXfadeOffsetA.connect(nodes.pitchGainA.gain);
        nodes.pitchXfadeLfo.connect(nodes.pitchXfadeInvert);
        nodes.pitchXfadeInvert.connect(nodes.pitchXfadeGainB);
        nodes.pitchXfadeGainB.connect(nodes.pitchXfadeOffsetB);
        nodes.pitchXfadeOffsetB.connect(nodes.pitchGainB.gain);
        nodes.pitchIn.connect(nodes.pitchDelayA);
        nodes.pitchIn.connect(nodes.pitchDelayB);
        nodes.pitchDelayA.connect(nodes.pitchGainA);
        nodes.pitchDelayB.connect(nodes.pitchGainB);
        nodes.pitchGainA.connect(nodes.pitchOut);
        nodes.pitchGainB.connect(nodes.pitchOut);
        nodes.pitchLfo.start();
        nodes.pitchXfadeLfo.start();
    }

    function updatePitchShift() {
        if (!audioCtx) return;
        const semitones = vinylMode ? 0 : parseFloat($('sl-pitch').value);
        if (semitones === 0) {
            nodes.pitchModGainA.gain.value = 0;
            nodes.pitchModGainB.gain.value = 0;
            nodes.pitchGainA.gain.value = 1;
            nodes.pitchGainB.gain.value = 1;
            return;
        }
        const depth = (Math.abs(semitones) / 12) * 0.025;
        nodes.pitchModGainA.gain.value = depth;
        nodes.pitchModGainB.gain.value = depth;
        nodes.pitchXfadeGainA.gain.value = 0.5;
        nodes.pitchXfadeGainB.gain.value = 0.5;
        nodes.pitchLfoInvert.gain.value = semitones < 0 ? 1 : -1;
    }

    function routeAudio() {
        if (!audioCtx) return;
        sourceNode.disconnect();
        if (nodes.pitchOut) nodes.pitchOut.disconnect();
        if (nodes.normAGC) nodes.normAGC.disconnect();
        if (nodes.preampGain) nodes.preampGain.disconnect();
        if (nodes.clrAntiDistort) nodes.clrAntiDistort.disconnect();
        if (nodes.eq) nodes.eq[3].disconnect();
        if (nodes.vocMerge) nodes.vocMerge.disconnect();
        if (nodes.mono) nodes.mono.disconnect();
        if (nodes.invMerge) nodes.invMerge.disconnect();
        if (nodes.balancePan) nodes.balancePan.disconnect();
        if (nodes.flangOut) nodes.flangOut.disconnect();
        if (nodes.echoOut) nodes.echoOut.disconnect();
        if (nodes.eightDOut) nodes.eightDOut.disconnect();
        if (nodes.revOut) nodes.revOut.disconnect();
        if (nodes.comp) nodes.comp.disconnect();
        if (nodes.limit) nodes.limit.disconnect();

        let curr = sourceNode;
        const pitchVal = vinylMode ? 0 : parseFloat($('sl-pitch').value);
        
        if (pitchVal !== 0) {
            curr.connect(nodes.pitchIn);
            curr = nodes.pitchOut;
        }
        if (fx.normalizer && nodes.normAGC) {
            curr.connect(nodes.normAGC);
            curr = nodes.normAGC;
        }
        if (fx.preamp) {
            curr.connect(nodes.preampGain);
            curr = nodes.preampGain;
        }
        if (fx.clarity) {
            curr.connect(nodes.clrBassSmooth);
            curr = nodes.clrAntiDistort;
        }
        if (fx.eq) {
            curr.connect(nodes.eq[0]);
            curr = nodes.eq[3];
        }
        if (fx.vocal) {
            curr.connect(nodes.vocSplit);
            curr = nodes.vocMerge;
        }
        if (fx.mono) {
            curr.connect(nodes.mono);
            curr = nodes.mono;
        }
        if (fx.invert) {
            curr.connect(nodes.invSplit);
            curr = nodes.invMerge;
        }
        if (fx.balance) {
            curr.connect(nodes.balancePan);
            curr = nodes.balancePan;
        }
        if (fx.flanger) {
            curr.connect(nodes.flangIn);
            curr = nodes.flangOut;
        }
        if (fx.echo) {
            curr.connect(nodes.echoIn);
            curr = nodes.echoOut;
        }
        if (fx.eightD) {
            curr.connect(nodes.eightDIn);
            curr = nodes.eightDOut;
        }
        if (fx.reverb) {
            curr.connect(nodes.revIn);
            curr = nodes.revOut;
        }
        if (fx.comp) {
            curr.connect(nodes.comp);
            curr = nodes.comp;
        }
        if (fx.limit) {
            curr.connect(nodes.limit);
            curr = nodes.limit;
        }

        curr.connect(analyserNode);
        analyserNode.connect(nodes.masterGain);
        nodes.masterGain.connect(nodes.masterLimiter);
        nodes.masterLimiter.connect(audioCtx.destination);
    }

    function createStereoWidthNode(ctx) {
        const split = ctx.createChannelSplitter(2),
            merge = ctx.createChannelMerger(2);
        const lMid = ctx.createGain(), rMid = ctx.createGain(), midSum = ctx.createGain();
        const lSide = ctx.createGain(), rSide = ctx.createGain(), sideSum = ctx.createGain();
        const midL = ctx.createGain(), midR = ctx.createGain(), sideL = ctx.createGain(), sideR = ctx.createGain();
        lMid.gain.value = 0.5; rMid.gain.value = 0.5; midSum.gain.value = 1;
        lSide.gain.value = 0.5; rSide.gain.value = -0.5; sideSum.gain.value = 1;
        midL.gain.value = 1; midR.gain.value = 1; sideL.gain.value = 1; sideR.gain.value = -1;
        split.connect(lMid, 0); split.connect(lSide, 0); split.connect(rMid, 1); split.connect(rSide, 1);
        lMid.connect(midSum); rMid.connect(midSum); lSide.connect(sideSum); rSide.connect(sideSum);
        midSum.connect(midL); midSum.connect(midR); sideSum.connect(sideL); sideSum.connect(sideR);
        midL.connect(merge, 0, 0); sideL.connect(merge, 0, 0); midR.connect(merge, 0, 1); sideR.connect(merge, 0, 1);
        return {
            input: split, output: merge, setWidth: w => {
                sideL.gain.value = w;
                sideR.gain.value = -w;
            }
        };
    }

    async function generateReverbIR() {
        if (!audioCtx) return;
        const roomSize = parseFloat($('sl-rev-room').value) / 100;
        const decay = (roomSize * 4.5) + 0.5;
        const dampPct = parseFloat($('sl-rev-damp').value) / 100;
        const dampFreq = 20000 - (dampPct * 18000);
        const rate = audioCtx.sampleRate;
        const length = Math.floor(rate * decay);
        const offCtx = new OfflineAudioContext(2, length, rate);
        const noise = offCtx.createBuffer(2, length, rate);
        const chL = noise.getChannelData(0);
        const chR = noise.getChannelData(1);
        for (let i = 0; i < length; i++) {
            const attack = 1 - Math.exp(-i / (rate * 0.02));
            const decayEnv = Math.pow(1 - i / length, decay * 2);
            const envelope = attack * decayEnv;
            chL[i] = (Math.random() * 2 - 1) * envelope;
            chR[i] = (Math.random() * 2 - 1) * envelope;
        }
        const src = offCtx.createBufferSource();
        src.buffer = noise;
        const lpFilter = offCtx.createBiquadFilter();
        lpFilter.type = 'lowpass';
        lpFilter.frequency.value = dampFreq;
        lpFilter.Q.value = 0.5;
        const hpFilter = offCtx.createBiquadFilter();
        hpFilter.type = 'highpass';
        hpFilter.frequency.value = parseFloat($('sl-rev-low').value) || 20;
        src.connect(lpFilter);
        lpFilter.connect(hpFilter);
        hpFilter.connect(offCtx.destination);
        src.start();
        const irBuffer = await offCtx.startRendering();
        nodes.revConvolver.buffer = irBuffer;
        if (nodes.eightDRevConvolver) nodes.eightDRevConvolver.buffer = irBuffer;
    }

    function updateNormalizerParams() {
        if (!audioCtx || !nodes.normAGC || !nodes.normAGC.port) return;
        nodes.normAGC.port.postMessage({ targetDb: parseFloat($('sl-norm-target').value) });
    }

    function updateReverbParams() {
        if (!audioCtx) return;
        const wet = parseFloat($('sl-rev-wet').value) / 100;
        nodes.revDry.gain.value = 1.0;
        nodes.revWet.gain.value = wet * 1.5;
        nodes.revWidth.setWidth(parseFloat($('sl-rev-stereo').value) / 100);
        nodes.revPreDelay.delayTime.value = parseFloat($('sl-rev-pre').value) / 1000;
        nodes.revLowCut.frequency.value = parseFloat($('sl-rev-low').value);
    }

    function updateEightDParams() {
        if (!audioCtx || !nodes.eightDLfo) return;
        nodes.eightDLfo.frequency.value = parseFloat($('sl-8d-speed').value);
        nodes.eightDLfoGain.gain.value = parseFloat($('sl-8d-width').value) / 100;
        const mix = parseFloat($('sl-8d-rev').value) / 100;
        nodes.eightDRevDry.gain.value = 1.0 - (mix * 0.5);
        nodes.eightDRevWet.gain.value = mix * 1.5;
    }

    function updateCompParams() {
        if (!audioCtx) return;
        nodes.comp.threshold.value = parseFloat($('sl-comp-thresh').value);
        nodes.comp.ratio.value = parseFloat($('sl-comp-ratio').value);
        nodes.comp.attack.value = parseFloat($('sl-comp-att').value) / 1000;
        nodes.comp.release.value = parseFloat($('sl-comp-rel').value) / 1000;
    }

    function updateLimiterParams() {
        if (!audioCtx) return;
        nodes.limit.threshold.value = parseFloat($('sl-lim-thresh').value);
        nodes.limit.release.value = parseFloat($('sl-lim-rel').value) / 1000;
    }

    function updateEchoParams() {
        if (!audioCtx) return;
        const mix = parseFloat($('sl-echo-mix').value) / 100;
        nodes.echoWet.gain.value = mix;
        nodes.echoDry.gain.value = 1 - (mix * 0.5);
        nodes.echoDelay.delayTime.value = parseFloat($('sl-echo-time').value) / 1000;
        nodes.echoFb.gain.value = parseFloat($('sl-echo-fb').value) / 100;
    }

    function updateFlangerParams() {
        if (!audioCtx) return;
        nodes.flangLfo.frequency.value = parseFloat($('sl-flang-rate').value);
        const depth = parseFloat($('sl-flang-depth').value) / 100;
        nodes.flangLfoGain.gain.value = depth * 0.005;
        nodes.flangDelay.delayTime.value = 0.005 + (depth * 0.002);
        nodes.flangFb.gain.value = parseFloat($('sl-flang-fb').value) / 100;
    }

    function updatePreampParams() {
        if (!audioCtx) return;
        const db = parseFloat($('sl-preamp-gain').value);
        nodes.preampGain.gain.value = Math.pow(10, db / 20);
    }

    function updateBalanceParams() {
        if (!audioCtx) return;
        nodes.balancePan.pan.value = parseFloat($('sl-balance-pan').value);
    }

    const toggleMap = {
        'tgl-normalizer': 'normalizer',
        'tgl-clarity': 'clarity', 'tgl-eq': 'eq', 'tgl-vocal': 'vocal', 'tgl-comp': 'comp',
        'tgl-limit': 'limit', 'tgl-echo': 'echo', 'tgl-flanger': 'flanger', 'tgl-reverb': 'reverb', 'tgl-mono': 'mono',
        'tgl-invert': 'invert', 'tgl-8d': 'eightD', 'tgl-preamp': 'preamp', 'tgl-balance': 'balance'
    };
    Object.keys(toggleMap).forEach(id => {
        $(id).onchange = e => {
            fx[toggleMap[id]] = e.target.checked;
            routeAudio();
        };
    });

    $('tgl-vinyl').onchange = e => {
        vinylMode = e.target.checked;
        audio.preservesPitch = !vinylMode;
        $('pitch-group').style.opacity = vinylMode ? '0.4' : '1';
        $('pitch-group').style.pointerEvents = vinylMode ? 'none' : 'auto';
        if (vinylMode) {
            $('sl-pitch').value = 0;
            $('val-pitch').textContent = '0.0';
            updatePitchShift();
            routeAudio();
        }
    };

    $('res-speed').onclick = () => {
        $('sl-tempo').value = 1.0;
        audio.playbackRate = 1.0;
        $('val-tempo').textContent = '1.00x';
        $('sl-pitch').value = 0;
        $('val-pitch').textContent = '0.0';
        updatePitchShift();
        routeAudio();
    };

    $('res-normalizer').onclick = () => {
        $('tgl-normalizer').checked = false;
        fx.normalizer = false;
        $('sl-norm-target').value = -12;
        $('val-norm-target').textContent = '-12 dB';
        updateNormalizerParams();
        routeAudio();
    };
    $('res-clarity').onclick = () => {
        $('tgl-clarity').checked = false;
        fx.clarity = false;
        routeAudio();
    };
    $('res-eq').onclick = () => {
        $('tgl-eq').checked = false;
        fx.eq = false;
        $('eq-preset').value = 'flat';
        ['low', 'lmid', 'hmid', 'high'].forEach((b, i) => {
            $(`sl-eq-${b}`).value = 0;
            $(`val-eq-${b}`).textContent = '0 dB'; if (audioCtx) nodes.eq[i].gain.value = 0;
        });
        routeAudio();
    };
    $('res-comp').onclick = () => {
        $('tgl-comp').checked = false;
        fx.comp = false;
        $('sl-comp-thresh').value = -24;
        $('val-comp-thresh').textContent = '-24 dB';
        $('sl-comp-ratio').value = 12;
        $('val-comp-ratio').textContent = '12:1';
        $('sl-comp-att').value = 3;
        $('val-comp-att').textContent = '3 ms';
        $('sl-comp-rel').value = 250;
        $('val-comp-rel').textContent = '250 ms';
        updateCompParams();
        routeAudio();
    };
    $('res-limit').onclick = () => {
        $('tgl-limit').checked = false;
        fx.limit = false;
        $('sl-lim-thresh').value = -2;
        $('val-lim-thresh').textContent = '-2 dB';
        $('sl-lim-rel').value = 50;
        $('val-lim-rel').textContent = '50 ms';
        updateLimiterParams();
        routeAudio();
    };
    $('res-echo').onclick = () => {
        $('tgl-echo').checked = false;
        fx.echo = false;
        $('sl-echo-mix').value = 40;
        $('val-echo-mix').textContent = '40%';
        $('sl-echo-time').value = 330;
        $('val-echo-time').textContent = '330 ms';
        $('sl-echo-fb').value = 40;
        $('val-echo-fb').textContent = '40%';
        updateEchoParams();
        routeAudio();
    };
    $('res-flanger').onclick = () => {
        $('tgl-flanger').checked = false;
        fx.flanger = false;
        $('sl-flang-rate').value = 0.5;
        $('val-flang-rate').textContent = '0.5 Hz';
        $('sl-flang-depth').value = 20;
        $('val-flang-depth').textContent = '20%';
        $('sl-flang-fb').value = 50;
        $('val-flang-fb').textContent = '50%';
        updateFlangerParams();
        routeAudio();
    };
    $('res-reverb').onclick = () => {
        $('tgl-reverb').checked = false;
        fx.reverb = false;
        $('sl-rev-wet').value = 45;
        $('val-rev-wet').textContent = '45%';
        $('sl-rev-stereo').value = 150;
        $('val-rev-stereo').textContent = '150%';
        $('sl-rev-damp').value = 25;
        $('val-rev-damp').textContent = '25%';
        $('sl-rev-room').value = 75;
        $('val-rev-room').textContent = '75%';
        $('sl-rev-pre').value = 0;
        $('val-rev-pre').textContent = '0 ms';
        $('sl-rev-low').value = 10;
        $('val-rev-low').textContent = '10 Hz';
        updateReverbParams();
        generateReverbIR();
        routeAudio();
    };
    $('res-8d').onclick = () => {
        $('tgl-8d').checked = false;
        fx.eightD = false;
        $('sl-8d-speed').value = 0.12;
        $('val-8d-speed').textContent = '0.12 Hz';
        $('sl-8d-width').value = 85;
        $('val-8d-width').textContent = '85%';
        $('sl-8d-rev').value = 40;
        $('val-8d-rev').textContent = '40%';
        updateEightDParams();
        routeAudio();
    };
    $('res-preamp').onclick = () => {
        $('tgl-preamp').checked = false;
        fx.preamp = false;
        $('sl-preamp-gain').value = 0;
        $('val-preamp-gain').textContent = '0 dB';
        updatePreampParams();
        routeAudio();
    };
    $('res-balance').onclick = () => {
        $('tgl-balance').checked = false;
        fx.balance = false;
        $('sl-balance-pan').value = 0;
        $('val-balance-pan').textContent = 'Center';
        updateBalanceParams();
        routeAudio();
    };

    const eqPresets = { 'flat': [0, 0, 0, 0], 'bass': [6, 2, 0, 0], 'acoustic': [-2, 2, 4, 3] };
    $('eq-preset').onchange = (e) => {
        if (e.target.value === 'custom') return;
        const vals = eqPresets[e.target.value];
        ['low', 'lmid', 'hmid', 'high'].forEach((b, i) => {
            $(`sl-eq-${b}`).value = vals[i];
            $(`val-eq-${b}`).textContent = (vals[i] > 0 ? '+' : '') + vals[i] + ' dB'; if (audioCtx) nodes.eq[i]
                .gain.value = vals[i];
        });
    };
    ['low', 'lmid', 'hmid', 'high'].forEach((b, i) => {
        $(`sl-eq-${b}`).oninput = (e) => {
            $('eq-preset').value = 'custom';
            $(`val-eq-${b}`).textContent = (e.target.value > 0 ? '+' : '') + e.target.value + ' dB'; 
            if (audioCtx) nodes.eq[i].gain.value = e.target.value;
        };
    });

    const bindSlider = (id, valId, suffix, updater, isIR = false) => {
        let timer;
        $(id).oninput = e => {
            let val = e.target.value;
            if (suffix.includes('dB') && parseFloat(val) > 0) val = '+' + val;
            $(valId).textContent = val + suffix; 
            if (updater) updater(); 
            if (isIR) {
                clearTimeout(timer);
                timer = setTimeout(generateReverbIR, 300);
            }
        };
    };

    bindSlider('sl-tempo', 'val-tempo', 'x', () => {
        audio.playbackRate = parseFloat($('sl-tempo').value);
        $('val-tempo').textContent = parseFloat($('sl-tempo').value).toFixed(2) + 'x';
    });
    bindSlider('sl-pitch', 'val-pitch', '', () => {
        updatePitchShift();
        routeAudio();
    });
    bindSlider('sl-norm-target', 'val-norm-target', ' dB', updateNormalizerParams);
    bindSlider('sl-comp-thresh', 'val-comp-thresh', ' dB', updateCompParams);
    bindSlider('sl-comp-ratio', 'val-comp-ratio', ':1', updateCompParams);
    bindSlider('sl-comp-att', 'val-comp-att', ' ms', updateCompParams);
    bindSlider('sl-comp-rel', 'val-comp-rel', ' ms', updateCompParams);
    bindSlider('sl-lim-thresh', 'val-lim-thresh', ' dB', updateLimiterParams);
    bindSlider('sl-lim-rel', 'val-lim-rel', ' ms', updateLimiterParams);
    bindSlider('sl-echo-mix', 'val-echo-mix', '%', updateEchoParams);
    bindSlider('sl-echo-time', 'val-echo-time', ' ms', updateEchoParams);
    bindSlider('sl-echo-fb', 'val-echo-fb', '%', updateEchoParams);
    bindSlider('sl-flang-rate', 'val-flang-rate', ' Hz', updateFlangerParams);
    bindSlider('sl-flang-depth', 'val-flang-depth', '%', updateFlangerParams);
    bindSlider('sl-flang-fb', 'val-flang-fb', '%', updateFlangerParams);
    bindSlider('sl-rev-wet', 'val-rev-wet', '%', updateReverbParams);
    bindSlider('sl-rev-stereo', 'val-rev-stereo', '%', updateReverbParams);
    bindSlider('sl-rev-damp', 'val-rev-damp', '%', updateReverbParams, true);
    bindSlider('sl-rev-room', 'val-rev-room', '%', updateReverbParams, true);
    bindSlider('sl-rev-pre', 'val-rev-pre', ' ms', updateReverbParams);
    bindSlider('sl-rev-low', 'val-rev-low', ' Hz', updateReverbParams);
    bindSlider('sl-8d-speed', 'val-8d-speed', ' Hz', updateEightDParams);
    bindSlider('sl-8d-width', 'val-8d-width', '%', updateEightDParams);
    bindSlider('sl-8d-rev', 'val-8d-rev', '%', updateEightDParams);
    bindSlider('sl-preamp-gain', 'val-preamp-gain', ' dB', updatePreampParams);

    $('sl-balance-pan').oninput = e => {
        const val = parseFloat(e.target.value);
        let text = 'Center';
        if (val < 0) text = 'L ' + Math.abs(Math.round(val * 100)) + '%';
        else if (val > 0) text = 'R ' + Math.abs(Math.round(val * 100)) + '%';
        $('val-balance-pan').textContent = text;
        updateBalanceParams();
    };

    // ── PLAYLIST MANAGEMENT ──
    function createPlaylist(name) {
        if (!name || name.trim() === '') return;
        const newPl = { id: 'pl_' + Date.now(), name: name.trim(), trackIds: [], isFolder: false };
        customPlaylists.push(newPl);
        renderPlaylistsHome();
    }

    $('btn-create-playlist').onclick = async () => {
        const name = await showPrompt('New Playlist', '');
        if (name && name.trim()) createPlaylist(name);
    };

    $('btn-back-playlists').onclick = () => {
        activePlaylistId = null;
        playlistDetail.style.display = 'none';
        playlistsHome.style.display = 'block';
    };

    function renderPlaylistsHome() {
        playlistCardsContainer.innerHTML = '';

        const favCard = document.createElement('div');
        favCard.className = 'playlist-card';
        const favCount = trackList.filter(t => t.isFavorite).length;
        favCard.innerHTML =
            `<div class="playlist-card-info"><h3>Favorites</h3><p>${favCount} tracks</p></div>`;
        favCard.onclick = () => openPlaylistDetail('favorites', 'Favorites');
        playlistCardsContainer.appendChild(favCard);

        const foldersMap = {};
        trackList.forEach(t => {
            if (t.folderName) {
                if (!foldersMap[t.folderName]) foldersMap[t.folderName] = 0;
                foldersMap[t.folderName]++;
            }
        });
        Object.keys(foldersMap).forEach(folder => {
            const fCard = document.createElement('div');
            fCard.className = 'playlist-card';
            fCard.innerHTML = `
                <div class="playlist-card-info" style="flex:1; overflow:hidden;">
                    <h3 style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(folder)}</h3>
                    <p>${foldersMap[folder]} tracks (Folder)</p>
                </div>
                <button class="icon-btn delete-folder-btn" title="Unload/Remove completely" style="padding: 6px; z-index: 2; flex-shrink:0; margin-left:12px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            `;

            fCard.querySelector('.delete-folder-btn').onclick = async (e) => {
                e.stopPropagation();
                const confirmed = await showConfirm('Remove Folder', `Are you sure you want to completely unload "${folder}" from your library?`);
                if (confirmed) {
                    trackList = trackList.filter(t => t.folderName !== folder);
                    if (currentTrackIndex >= trackList.length) {
                        currentTrackIndex = -1; 
                        updateNowPlayingOverlay();
                    }
                    if(trackList.length === 0) {
                        $('empty-state').style.display = 'flex';
                        $('search-bar').style.display = 'none';
                    }
                    sortAndRenderTracks();
                    renderPlaylistsHome();
                }
            };

            fCard.onclick = () => openPlaylistDetail('folder_' + folder, folder);
            playlistCardsContainer.appendChild(fCard);
        });

        customPlaylists.forEach(pl => {
            const card = document.createElement('div');
            card.className = 'playlist-card';
            const count = trackList.filter(t => pl.trackIds.includes(t.id)).length;
            card.innerHTML = `
                <div class="playlist-card-info" style="flex:1; overflow:hidden;">
                    <h3 style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(pl.name)}</h3>
                    <p>${count} tracks</p>
                </div>
                <button class="icon-btn delete-pl-btn" title="Delete Playlist" style="padding: 6px; z-index: 2; flex-shrink:0; margin-left:12px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            `;

            card.querySelector('.delete-pl-btn').onclick = async (e) => {
                e.stopPropagation();
                const confirmed = await showConfirm('Delete Playlist',
                    `Are you sure you want to delete "${pl.name}"?`);
                if (confirmed) {
                    customPlaylists = customPlaylists.filter(p => p.id !== pl.id);
                    renderPlaylistsHome();
                }
            };

            card.onclick = () => openPlaylistDetail(pl.id, pl.name);
            playlistCardsContainer.appendChild(card);
        });
    }

    function openPlaylistDetail(id, title) {
        activePlaylistId = id;
        $('playlist-detail-title').textContent = title;
        playlistsHome.style.display = 'none';
        playlistDetail.style.display = 'block';
        sortAndRenderTracks();
    }

    // ── DYNAMIC ASSET LOADING & PERSISTENCE ──
    async function checkPersistedFolder() {
        if (window.showDirectoryPicker) {
            const handle = await getHandle();
            if (handle) {
                try {
                    // Ask browser for read permission (auto-resolves if already granted in this session)
                    const perm = await handle.queryPermission({ mode: 'read' });
                    if (perm === 'granted') {
                        // Automatically restore tracks without extra clicks
                        await loadTracksFromHandle(handle);
                        return;
                    } 
                } catch(e) {}
                
                // If it needs user interaction to restore permissions
                const btn = document.createElement('button');
                btn.className = 'drawer-btn';
                btn.style.marginTop = '15px';
                btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Restore Previous Folder`;
                btn.onclick = async () => {
                    try {
                        const perm = await handle.requestPermission({ mode: 'read' });
                        if (perm === 'granted') {
                            btn.remove();
                            await loadTracksFromHandle(handle);
                        }
                    } catch(e) { console.error(e); }
                };
                $('empty-state').appendChild(btn);
            }
        }
    }

    async function loadDefaultAssets() {
        try {
            const response = await fetch('assets/');
            if (response.ok) {
                const text = await response.text();
                const matches = text.match(/href="([^"]+\.(mp3|wav|ogg|m4a|flac))"/gi);
                if (matches && matches.length > 0) {
                    let audioFiles = matches.map(m => m.split('"')[1]).map(f => f.split('/').pop());
                    audioFiles = [...new Set(audioFiles)];
                    trackList = audioFiles.map((filename, i) => ({
                        id: 'trk_' + Date.now() + i,
                        title: decodeURIComponent(filename.replace(/\.[^/.]+$/, '')),
                        artist: 'Assets Directory',
                        url: 'assets/' + filename,
                        file: null,
                        duration: 0,
                        index: i,
                        element: null,
                        dateAdded: Date.now(),
                        dateModified: Date.now(),
                        albumArt: null,
                        _isExtracting: false,
                        lyrics: null,
                        isFavorite: false,
                        folderName: 'Default'
                    }));
                    searchBar.style.display = 'block';
                    emptyState.style.display = 'none';
                    sortAndRenderTracks();
                    checkPersistedFolder();
                    return;
                }
            }
        } catch (e) {
            console.log("Directory scraping unavailable. Falling back to predefined injection.");
        }
        trackList = [1, 2, 3, 4, 5].map(i => ({
            id: 'trk_' + Date.now() + i,
            title: `sample-${i}`,
            artist: 'Assets Directory',
            url: `assets/sample-${i}.mp3`,
            file: null,
            duration: 0,
            index: i - 1,
            element: null,
            dateAdded: Date.now(),
            dateModified: Date.now(),
            albumArt: null,
            _isExtracting: false,
            lyrics: null,
            isFavorite: false,
            folderName: 'Default Assets'
        }));
        searchBar.style.display = 'block';
        emptyState.style.display = 'none';
        sortAndRenderTracks();
        checkPersistedFolder();
    }
    loadDefaultAssets();

    $('btn-open-folder').onclick = async () => {
        if (window.showDirectoryPicker) {
            try {
                const handle = await window.showDirectoryPicker({ mode: 'read' });
                await saveHandle(handle);
                await loadTracksFromHandle(handle);
            } catch (e) {
                if (e.name !== 'AbortError') $('folder-input').click(); 
            }
        } else {
            $('folder-input').click();
        }
    };

    $('btn-open-file').onclick = () => $('file-input').click();

    async function loadTracksFromHandle(dirHandle) {
        cancelDrawer();
        showToast('Loading folder...', '');
        const files = [];
        async function traverse(handle, path = '') {
            for await (const entry of handle.values()) {
                if (entry.kind === 'file' && entry.name.match(/\.(mp3|wav|ogg|m4a|flac)$/i)) {
                    const file = await entry.getFile();
                    Object.defineProperty(file, 'webkitRelativePath', {
                        value: path + entry.name,
                        writable: false
                    });
                    files.push(file);
                } else if (entry.kind === 'directory') {
                    await traverse(entry, path + entry.name + '/');
                }
            }
        }
        try {
            await traverse(dirHandle, dirHandle.name + '/');
            if (!files.length) {
                showToast('No audio files found.', 'error');
                return;
            }
            processNewFiles(files, dirHandle.name);
        } catch(e) {
            showToast('Permission denied or error reading folder', 'error');
        }
    }

    $('folder-input').onchange = e => {
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('audio/'));
        if (!files.length) {
            showToast('No audio files found.', 'error');
            return;
        }
        processNewFiles(files, files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : 'Local Folder');
        cancelDrawer();
    };

    $('file-input').onchange = e => {
        const files = Array.from(e.target.files);
        const validFiles = files.filter(f => f.type.startsWith('audio/'));
        if (!validFiles.length) {
            showToast('Please select an audio file.', 'error');
            return;
        }
        processNewFiles(validFiles, 'Local Files');
        cancelDrawer();
    };

    function processNewFiles(files, defaultFolderName) {
        const now = Date.now();
        const newTracks = files.map((file, i) => {
            const folderPathParts = file.webkitRelativePath ? file.webkitRelativePath.split('/') : [];
            const folderName = folderPathParts.length > 1 ? folderPathParts[0] : (defaultFolderName || 'Local Files');
            return {
                id: 'trk_' + Math.random().toString(36).substr(2, 9),
                title: file.name.replace(/\.[^/.]+$/, ''),
                artist: 'Local File',
                url: URL.createObjectURL(file),
                file: file,
                duration: 0,
                index: trackList.length + i,
                element: null,
                dateAdded: now,
                dateModified: file.lastModified || now,
                albumArt: null,
                _isExtracting: false,
                lyrics: null,
                isFavorite: false,
                folderName: folderName
            };
        });
        
        trackList = trackList.concat(newTracks);
        searchBar.style.display = 'block';
        emptyState.style.display = 'none';
        sortAndRenderTracks();
    }

    async function extractAlbumArtForTrack(track) {
        if (track.albumArt !== null || track._isExtracting) return;
        track._isExtracting = true;
        try {
            let buffer;
            if (track.file) {
                buffer = await track.file.arrayBuffer();
            } else if (track.url) {
                const resp = await fetch(track.url);
                if (!resp.ok) {
                    track.albumArt = false;
                    track._isExtracting = false;
                    return;
                }
                buffer = await resp.arrayBuffer();
            } else {
                track.albumArt = false;
                track._isExtracting = false;
                return;
            }

            const view = new DataView(buffer);
            let offset = 0;
            if (view.getUint32(0) === 0x49443303 || view.getUint32(0) === 0x49443302) {
                const size = synchSafeToInt(view.getUint32(6));
                offset = 10;
                const end = offset + size;
                while (offset < end - 10) {
                    const frameId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
                    const frameSize = view.getUint32(offset + 4);
                    if (frameId === 'APIC') {
                        let imgStart = offset + 10;
                        while (imgStart < offset + 10 + frameSize && view.getUint8(imgStart) !== 0) imgStart++;
                        imgStart++; imgStart++; 
                        while (imgStart < offset + 10 + frameSize && view.getUint8(imgStart) !== 0) imgStart++;
                        imgStart++; 
                        
                        if (imgStart < offset + 10 + frameSize) {
                            const imgData = new Uint8Array(buffer.slice(imgStart, offset + 10 + frameSize));
                            track.albumArt = URL.createObjectURL(new Blob([imgData]));
                            
                            if (track.element) {
                                const coverDiv = track.element.querySelector('.song-cover');
                                if (coverDiv) {
                                    const playingInd = coverDiv.querySelector('.playing-indicator');
                                    coverDiv.innerHTML = `<img src="${track.albumArt}" style="width:100%; height:100%; object-fit:cover;">`;
                                    if (playingInd) coverDiv.appendChild(playingInd);
                                }
                            }
                            if (currentTrackIndex >= 0 && trackList[currentTrackIndex].id === track.id) {
                                updateNowPlayingOverlay();
                            }
                        }
                        track._isExtracting = false;
                        return;
                    }
                    offset += 10 + frameSize;
                }
            }
            track.albumArt = false;
        } catch (e) {
            track.albumArt = false;
        }
        track._isExtracting = false;
    }

    function synchSafeToInt(val) {
        return (val & 0x7F) << 21 | (val & 0x7F00) << 6 | (val & 0x7F0000) >> 9 | (val &
            0x7F000000) >>> 24;
    }

    function sortAndRenderTracks() {
        const sortVal = currentSort;
        switch (sortVal) {
            case 'name-asc':
                trackList.sort((a, b) => a.title.localeCompare(b.title));
                break;
            case 'name-desc':
                trackList.sort((a, b) => b.title.localeCompare(a.title));
                break;
            case 'date-mod-desc':
                trackList.sort((a, b) => (b.dateModified || 0) - (a.dateModified || 0));
                break;
            case 'date-mod-asc':
                trackList.sort((a, b) => (a.dateModified || 0) - (b.dateModified || 0));
                break;
            case 'date-add-desc':
                trackList.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
                break;
            case 'date-add-asc':
                trackList.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0));
                break;
            case 'duration-desc':
                trackList.sort((a, b) => (b.duration || 0) - (a.duration || 0));
                break;
            case 'duration-asc':
                trackList.sort((a, b) => (a.duration || 0) - (b.duration || 0));
                break;
            default:
                trackList.sort((a, b) => a.title.localeCompare(b.title));
        }

        let displayList = trackList;
        if (activePlaylistId === 'favorites') {
            displayList = trackList.filter(t => t.isFavorite);
        } else if (activePlaylistId && activePlaylistId.startsWith('folder_')) {
            const fName = activePlaylistId.replace('folder_', '');
            displayList = trackList.filter(t => t.folderName === fName);
        } else if (activePlaylistId) {
            const pl = customPlaylists.find(p => p.id === activePlaylistId);
            if (pl) displayList = trackList.filter(t => pl.trackIds.includes(t.id));
        }

        currentDisplayList = displayList;
        currentlyRendered = 0;

        const targetContainer = activePlaylistId ? playlistSongList : songListContainer;
        targetContainer.innerHTML = '';
        renderMoreTracks();
    }

    function renderMoreTracks() {
        const targetContainer = activePlaylistId ? playlistSongList : songListContainer;
        const fragment = document.createDocumentFragment();
        const end = Math.min(currentlyRendered + RENDER_CHUNK, currentDisplayList.length);

        for (let i = currentlyRendered; i < end; i++) {
            const track = currentDisplayList[i];
            const idx = trackList.indexOf(track);
            const item = document.createElement('div');
            item.className = 'song-item';
            if (currentTrackIndex === idx) item.classList.add('active-track');

            const imgIndex = (track.index % 7) + 1;
            const imgSrc = track.albumArt ? track.albumArt : `assets/image-${imgIndex}.jpg`;
            const heartColor = track.isFavorite ? 'var(--accent)' : 'var(--text-muted)';
            const heartIcon = track.isFavorite ? filledHeart : outlineHeart;

            item.innerHTML = `
                <div class="song-cover">
                    <img src="${imgSrc}" style="width:100%; height:100%; object-fit:cover;" onerror="this.outerHTML='<svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'currentColor\\'><path d=\\'M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z\\'/></svg>'">
                    <div class="playing-indicator" id="ind-${track.id}">
                        ${isPlaying && currentTrackIndex === idx ? playIndicatorSvg : pausedIndicatorSvg}
                    </div>
                </div>
                <div class="song-info"><h3>${escapeHtml(track.title)}</h3><p>${escapeHtml(track.artist)}</p></div>
                <button class="icon-btn heart-btn" aria-label="Favorite" style="color: ${heartColor};">${heartIcon}</button>
                <button class="icon-btn more-btn" aria-label="Options">${dotsIcon}</button>
            `;

            item.onclick = async (e) => {
                if (e.target.closest('.heart-btn') || e.target.closest('.more-btn')) return;
                await initAudioContext();
                if (currentTrackIndex === idx) togglePlay();
                else playTrack(idx);
            };

            item.querySelector('.heart-btn').onclick = (e) => {
                e.stopPropagation();
                track.isFavorite = !track.isFavorite;
                e.currentTarget.innerHTML = track.isFavorite ? filledHeart : outlineHeart;
                e.currentTarget.style.color = track.isFavorite ? 'var(--accent)' : 'var(--text-muted)';
                if (activePlaylistId === 'favorites' && !track.isFavorite) {
                    sortAndRenderTracks();
                }
            };
            
            // 3 Dots Context Menu
            item.querySelector('.more-btn').onclick = (e) => {
                e.stopPropagation();
                trackMenuTargetId = track.id;
                
                const menu = $('track-options-menu');
                menu.classList.remove('hidden');
                
                // Positioning
                const rect = e.currentTarget.getBoundingClientRect();
                menu.style.top = (rect.bottom + window.scrollY) + 'px';
                menu.style.left = Math.min((rect.right - 150), window.innerWidth - 160) + 'px';
            };

            fragment.appendChild(item);
            track.element = item;

            if (!track.duration) {
                const temp = new Audio();
                temp.addEventListener('loadedmetadata', () => {
                    track.duration = temp.duration;
                });
                temp.src = track.url;
            }

            if (track.albumArt === null && !track._isExtracting) {
                extractAlbumArtForTrack(track);
            }
        }
        targetContainer.appendChild(fragment);
        currentlyRendered = end;
    }

    $('main-content').addEventListener('scroll', function() {
        if (this.scrollHeight - this.scrollTop - this.clientHeight < 400) {
            if (currentlyRendered < currentDisplayList.length) {
                renderMoreTracks();
            }
        }
    });

    function escapeHtml(t) {
        return t.replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;',
            '"': '&quot;', "'": '&#039;'
        })[m]);
    }

    // ── PLAYER CONTROL ──
    const updateTitleScroll = () => {
        const el = $('now-playing-title');
        el.classList.remove('scrolling-text');
        
        // Resetting layout briefly to accurately measure width without animation
        el.style.display = 'inline-block'; 
        const isOverflowing = el.scrollWidth > el.parentElement.clientWidth;
        
        if (isOverflowing) {
            el.classList.add('scrolling-text');
        }
    };

    async function playTrack(idx) {
        if (idx < 0 || idx >= trackList.length) return;
        currentTrackIndex = idx;
        const t = trackList[idx];
        audio.src = t.url;
        audio.load();
        
        nowPlayingTitle.textContent = t.title;
        // Evaluate scrolling after a tiny paint cycle
        requestAnimationFrame(() => updateTitleScroll());

        document.querySelectorAll('.song-item').forEach(i => i.classList.remove('active-track'));
        if (t.element) {
            t.element.classList.add('active-track');
            const ind = t.element.querySelector('.playing-indicator');
            if (ind) ind.innerHTML = playIndicatorSvg;
        }
        $('btn-download').disabled = false;
        await initAudioContext();
        audio.play().then(() => setPlayState(true)).catch(e => console.log(e));
        updateNowPlayingOverlay();
    }

    async function togglePlay() {
        if (!audio.src) return trackList.length ? playTrack(0) : null;
        await initAudioContext();
        isPlaying ? audio.pause() : audio.play();
        setPlayState(!isPlaying);
    }

    function setPlayState(p) {
        isPlaying = p;
        const playIcons = document.querySelectorAll('.play-icon, .np-play-icon');
        const pauseIcons = document.querySelectorAll('.pause-icon, .np-pause-icon');
        playIcons.forEach(icon => icon.style.display = p ? 'none' : 'block');
        pauseIcons.forEach(icon => icon.style.display = p ? 'block' : 'none');
        if (currentTrackIndex >= 0 && trackList[currentTrackIndex] && trackList[currentTrackIndex].element) {
            const ind = trackList[currentTrackIndex].element.querySelector('.playing-indicator');
            if (ind) ind.innerHTML = p ? playIndicatorSvg : pausedIndicatorSvg;
        }
    }

    audio.ontimeupdate = () => {
        if (audio.duration) {
            progressBar.value = (audio.currentTime / audio.duration) * 1000;
            currentTimeEl.textContent = formatTime(audio.currentTime);
        }
    };
    audio.onloadedmetadata = () => { totalTimeEl.textContent = formatTime(audio.duration); };

    audio.onended = () => {
        if (repeatMode === 'one') {
            audio.currentTime = 0;
            audio.play();
        } else if (repeatMode === 'all' || currentTrackIndex < trackList.length - 1 || shuffleMode) {
            playNext();
        } else {
            setPlayState(false);
            audio.currentTime = 0;
            progressBar.value = 0;
        }
    };

    progressBar.oninput = e => {
        if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio
            .duration;
    };

    function playNext() {
        if (trackList.length) playTrack(shuffleMode ? Math.floor(Math.random() * trackList.length) :
            (currentTrackIndex + 1) % trackList.length);
    }

    function playPrev() {
        if (trackList.length) playTrack(audio.currentTime > 3 ? currentTrackIndex : (shuffleMode ? Math
            .floor(Math.random() * trackList.length) : (currentTrackIndex - 1 + trackList.length) % trackList
                .length));
    }

    function formatTime(s) {
        if (!isFinite(s)) return '0:00';
        const m = Math.floor(s / 60),
            sec = Math.floor(s % 60).toString().padStart(2, '0'); return `${m}:${sec}`;
    }

    const toggleShuffle = () => {
        shuffleMode = !shuffleMode;
        document.querySelectorAll('.btn-shuffle, .np-btn-shuffle').forEach(btn => btn.classList.toggle('active',
            shuffleMode));
    };

    const toggleRepeat = () => {
        repeatMode = repeatMode === 'off' ? 'all' : (repeatMode === 'all' ? 'one' : 'off');
        document.querySelectorAll('.btn-repeat, .np-btn-repeat').forEach(btn => {
            btn.classList.toggle('active', repeatMode !== 'off');
            if (repeatMode === 'one') {
                btn.innerHTML =
                    `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /><text x="12" y="15" font-size="9" text-anchor="middle" font-weight="900" fill="currentColor" stroke="none">1</text></svg>`;
            } else {
                btn.innerHTML =
                    `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>`;
            }
        });
    };

    document.querySelectorAll('.btn-play, .np-btn-play').forEach(btn => btn.onclick = togglePlay);
    document.querySelectorAll('.btn-next, .np-btn-next').forEach(btn => btn.onclick = playNext);
    document.querySelectorAll('.btn-prev, .np-btn-prev').forEach(btn => btn.onclick = playPrev);
    document.querySelectorAll('.btn-shuffle, .np-btn-shuffle').forEach(btn => btn.onclick = toggleShuffle);
    document.querySelectorAll('.btn-repeat, .np-btn-repeat').forEach(btn => btn.onclick = toggleRepeat);

    // Visualizer (Drawn to Both Canvases)
    function drawVisualizer() {
        requestAnimationFrame(drawVisualizer);
        if (!analyserNode) return;
        
        const data = new Uint8Array(analyserNode.frequencyBinCount);
        analyserNode.getByteFrequencyData(data);
        const activeColor = getComputedStyle(body).getPropertyValue('--accent').trim();

        const drawBars = (ctx, canvasEl) => {
            if (!ctx) return;
            const w = canvasEl.width;
            const h = canvasEl.height;
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = activeColor;
            ctx.globalAlpha = 0.6;
            for (let i = 0; i < 64; i++) {
                let barH = Math.max(3, (data[i] / 255) * h);
                ctx.beginPath();
                ctx.roundRect(i * (w / 64), h - barH, (w / 64) - 2, barH, 4);
                ctx.fill();
            }
            ctx.globalAlpha = 1.0;
        };

        drawBars(visualizerCtx, visualizerCanvas);
        if ($('now-playing-overlay').classList.contains('open')) {
            drawBars(npVisualizerCtx, npVisualizerCanvas);
        }
    }
    drawVisualizer();

    window.addEventListener('resize', () => {
        updateTitleScroll(); 
    });

    // Export Logic
    $('btn-download').onclick = async () => {
        if (currentTrackIndex < 0 || !trackList[currentTrackIndex]) return;
        const pitchVal = parseFloat($('sl-pitch').value);
        if (!Object.values(fx).some(v => v) && audio.playbackRate === 1.0 && (pitchVal === 0 || vinylMode)) {
            const a = document.createElement('a');
            a.href = trackList[currentTrackIndex].url;
            a.download = trackList[currentTrackIndex].file ? trackList[currentTrackIndex].file.name :
                `${trackList[currentTrackIndex].title}.${exportFormat}`;
            a.click();
            return;
        }

        const btn = $('btn-download');
        btn.disabled = true;
        btn.classList.add('progress-active');
        btn.style.setProperty('--dl-progress', '0%');
        let simProgress = 0;
        let progInterval = setInterval(() => {
            simProgress += (95 - simProgress) * 0.08;
            btn.style.setProperty('--dl-progress', simProgress + '%');
        }, 150);

        try {
            let buffer;
            if (trackList[currentTrackIndex].file) {
                buffer = await trackList[currentTrackIndex].file
                    .arrayBuffer();
            } else {
                const response = await fetch(trackList[currentTrackIndex].url); if (!response
                    .ok) throw new Error("Failed to fetch audio file");
                buffer = await response.arrayBuffer();
            }

            const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
            const decoded = await tempCtx.decodeAudioData(buffer);
            const length = (decoded.length / audio.playbackRate) + (fx.reverb || fx.echo || fx.eightD ? tempCtx
                .sampleRate * 5 : 0);
            const offCtx = new OfflineAudioContext(decoded.numberOfChannels, length, tempCtx.sampleRate);
            const src = offCtx.createBufferSource();
            src.buffer = decoded;
            src.playbackRate.value = audio.playbackRate;

            let curr = src;

            if (fx.normalizer) {
                const blob = new Blob([agcWorkletCode], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);
                await offCtx.audioWorklet.addModule(url);
                const oNormAGC = new AudioWorkletNode(offCtx, 'agc-processor');
                oNormAGC.port.postMessage({ targetDb: parseFloat($('sl-norm-target').value) });
                curr.connect(oNormAGC);
                curr = oNormAGC;
            }

            if (fx.preamp) {
                const oPre = offCtx.createGain();
                oPre.gain.value = nodes.preampGain.gain.value;
                curr.connect(oPre);
                curr = oPre;
            }

            if (fx.clarity) {
                const oBass = offCtx.createBiquadFilter();
                oBass.type = 'lowshelf';
                oBass.frequency.value = 60;
                oBass.gain.value = 1.5;
                const oMud = offCtx.createBiquadFilter();
                oMud.type = 'peaking';
                oMud.frequency.value = 250;
                oMud.Q.value = 0.8;
                oMud.gain.value = -1.5;
                const oDetail = offCtx.createBiquadFilter();
                oDetail.type = 'peaking';
                oDetail.frequency.value = 4000;
                oDetail.Q.value = 0.5;
                oDetail.gain.value = -1.0; 
                const oAir = offCtx.createBiquadFilter();
                oAir.type = 'highshelf';
                oAir.frequency.value = 12000;
                oAir.gain.value = 2.0;
                curr.connect(oBass);
                oBass.connect(oMud);
                oMud.connect(oDetail);
                oDetail.connect(oAir);
                curr = oAir;
            }

            if (fx.eightD) {
                const oPanner = offCtx.createStereoPanner();
                const oLfo = offCtx.createOscillator();
                oLfo.type = 'sine';
                oLfo.frequency.value = parseFloat($('sl-8d-speed').value);
                const oGain = offCtx.createGain();
                oGain.gain.value = parseFloat($('sl-8d-width').value) / 100;
                oLfo.connect(oGain);
                oGain.connect(oPanner.pan);
                oLfo.start(0);
                const eightDRoot = offCtx.createGain();
                curr.connect(oPanner);
                const revGain = offCtx.createGain();
                const mix = parseFloat($('sl-8d-rev').value) / 100;
                if (nodes.revConvolver && nodes.revConvolver.buffer) {
                    const oConv = offCtx.createConvolver();
                    oConv.buffer = nodes.revConvolver.buffer;
                    oPanner.connect(oConv);
                    oConv.connect(revGain);
                    revGain.gain.value = mix * 1.5;
                }
                const dryGain = offCtx.createGain();
                dryGain.gain.value = 1.0 - (mix * 0.5);
                oPanner.connect(dryGain);
                dryGain.connect(eightDRoot);
                revGain.connect(eightDRoot);
                curr = eightDRoot;
            }

            if (fx.reverb && nodes.revConvolver && nodes.revConvolver.buffer) {
                const oConv = offCtx.createConvolver();
                oConv.buffer = nodes.revConvolver.buffer;
                const oDry = offCtx.createGain();
                oDry.gain.value = nodes.revDry.gain.value;
                const oWet = offCtx.createGain();
                oWet.gain.value = nodes.revWet.gain.value;
                curr.connect(oDry);
                curr.connect(oConv);
                oConv.connect(oWet);
                oDry.connect(offCtx.destination);
                oWet.connect(offCtx.destination);
            } else { 
                const oMasterLimiter = offCtx.createDynamicsCompressor();
                oMasterLimiter.threshold.value = -0.5;
                oMasterLimiter.ratio.value = 20.0;
                oMasterLimiter.attack.value = 0.002;
                oMasterLimiter.release.value = 0.100;

                const oMasterGain = offCtx.createGain();
                oMasterGain.gain.value = 0.65;
                
                curr.connect(oMasterGain);
                oMasterGain.connect(oMasterLimiter);
                oMasterLimiter.connect(offCtx.destination); 
            }

            src.start(0);
            const rendered = await offCtx.startRendering();
            clearInterval(progInterval);
            btn.style.setProperty('--dl-progress', '100%');

            let nCh = rendered.numberOfChannels;
            
            // True LAME MP3 EXPORT LOGIC
            if (exportFormat === 'mp3' && window.lamejs) {
                const lameEnc = new lamejs.Mp3Encoder(nCh, rendered.sampleRate, 192); // 192kbps
                const mp3Data = [];
                const samples = rendered.length;
                const sampleBlockSize = 1152; // Needs to be multiple of 576
                
                let left = rendered.getChannelData(0);
                let right = nCh > 1 ? rendered.getChannelData(1) : left;
                
                // Int16 Conversions needed for LameJS
                let leftInt = new Int16Array(samples);
                let rightInt = new Int16Array(samples);
                
                for(let i = 0; i < samples; i++) {
                    leftInt[i] = left[i] < 0 ? left[i] * 32768 : left[i] * 32767;
                    rightInt[i] = right[i] < 0 ? right[i] * 32768 : right[i] * 32767;
                }
                
                for(let i = 0; i < samples; i += sampleBlockSize) {
                    let leftChunk = leftInt.subarray(i, i + sampleBlockSize);
                    let rightChunk = rightInt.subarray(i, i + sampleBlockSize);
                    let mp3buf = lameEnc.encodeBuffer(leftChunk, rightChunk);
                    if (mp3buf.length > 0) mp3Data.push(mp3buf);
                }
                
                let mp3buf = lameEnc.flush(); 
                if (mp3buf.length > 0) mp3Data.push(mp3buf);
                
                const blob = new Blob(mp3Data, { type: 'audio/mp3' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `Processed_${trackList[currentTrackIndex].title}.mp3`;
                a.click();
            } 
            else {
                // FALLBACK & DEFAULT WAV EXPORT LOGIC
                let len = rendered.length * nCh * 2 + 44,
                    out = new ArrayBuffer(len),
                    view = new DataView(out),
                    chs = [],
                    offset = 0,
                    pos = 0;
                    
                const set16 = d => { view.setUint16(pos, d, true); pos += 2; };
                const set32 = d => { view.setUint32(pos, d, true); pos += 4; };
                
                set32(0x46464952); // "RIFF"
                set32(len - 8);
                set32(0x45564157); // "WAVE"
                set32(0x20746d66); // "fmt "
                set32(16);
                set16(1);
                set16(nCh);
                set32(rendered.sampleRate);
                set32(rendered.sampleRate * 2 * nCh);
                set16(nCh * 2);
                set16(16);
                set32(0x61746164); // "data"
                set32(len - pos - 4);
                for (let i = 0; i < nCh; i++) chs.push(rendered.getChannelData(i));
                while (pos < len) {
                    for (let i = 0; i < nCh; i++) {
                        let s = Math.max(-1, Math.min(1, chs[i][offset]));
                        view.setInt16(pos, s < 0 ? s * 32768 : s * 32767, true);
                        pos += 2;
                    }
                    offset++;
                }

                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([out], { type: 'audio/wav' }));
                a.download = `Processed_${trackList[currentTrackIndex].title}.wav`;
                a.click();
            }
            tempCtx.close();
        } catch (e) {
            console.error(e);
            showToast('Export failed', 'error');
            clearInterval(progInterval);
        }
        setTimeout(() => {
            btn.classList.remove('progress-active');
            btn.style.setProperty('--dl-progress', '0%');
            btn.disabled = false;
        }, 800);
    };
});