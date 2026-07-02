// script.js

document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const body = document.body;

    const views = {
        'songs-view': $('songs-view'),
        'folders-view': $('folders-view'),
        'playlists-view': $('playlists-view'),
        'effects-panel': $('effects-panel'),
        'tools-panel': $('tools-panel')
    };
    const songListContainer = $('song-list');
    const foldersContainer = $('folders-container');
    const playlistsHome = $('playlists-home');
    const playlistDetail = $('playlist-detail');
    const playlistCardsContainer = $('playlists-container');
    const playlistSongList = $('playlist-song-list');
    const folderSongList = $('folder-song-list');

    const emptyState = $('empty-state');
    const searchBar = $('search-bar');
    const nowPlayingTitle = $('now-playing-title');
    const progressBar = $('progress-bar');
    const currentTimeEl = $('current-time');
    const totalTimeEl = $('total-time');

    const npProgressBar = $('np-progress-bar');
    const npCurrentTimeEl = $('np-current-time');
    const npTotalTimeEl = $('np-total-time');

    const visualizerCanvas = $('visualizer');
    const visualizerCtx = visualizerCanvas.getContext('2d');

    const audio = new Audio();
    let vinylMode = true;

    // FIX: Always disable the browser's built-in pitch-preservation algorithm.
    // We handle pitch shifting ourselves via the Tone.js node in the Web Audio
    // graph. Leaving the native one on (as the old code did whenever Vinyl Mode
    // was OFF) meant TWO different pitch-correction algorithms ran on the same
    // signal at once, which is what caused the "robotic" garbled sound.
    audio.preservesPitch = false;
    audio.mozPreservesPitch = false;
    audio.webkitPreservesPitch = false;

    let audioCtx, sourceNode, analyserNode;
    let audioCtxInitialized = false;

    const fx = { clarity: false, eq: false, vocal: false, comp: false, limit: false, echo: false, flanger: false, reverb: false, mono: false, invert: false, eightD: false, preamp: false, balance: false, warmth: false };
    let nodes = {};

    let trackList = [];
    let currentTrackIndex = -1;
    let isPlaying = false;
    let shuffleMode = false;
    let repeatMode = 'off';
    let exportFormat = 'mp3';
    let currentSort = 'name-asc';
    let trackMenuTargetId = null;
    let nextUpQueue = [];

    let customPlaylists = [];
    let activePlaylistId = null;

    let currentDisplayList = [];
    let currentlyRendered = 0;
    const RENDER_CHUNK = 50;

    let currentEq = 'flat';

    const uiClickSound = new Howl({
        src: ['data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'],
        volume: 0.05
    });

    let wavesurfer = null;
    try {
        if (window.WaveSurfer) {
            wavesurfer = WaveSurfer.create({
                container: '#np-waveform',
                waveColor: 'rgba(190, 181, 171, 0.4)',
                progressColor: 'rgba(190, 181, 171, 1)',
                height: 30,
                barWidth: 2,
                barRadius: 2,
                cursorWidth: 0,
                interact: true,
                media: audio
            });
        }
    } catch (e) { console.warn("WaveSurfer setup skipped"); }

    const outlineHeart = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    const filledHeart = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
    const dotsIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;
    const playIndicatorSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
    const pausedIndicatorSvg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

    document.querySelectorAll('.format-btn').forEach(b => {
        b.classList.remove('active');
        if (b.dataset.format === 'mp3') b.classList.add('active');
    });

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

    checkPersistedFolder();
    loadDefaultAssets();

    function showToast(message, type = '') {
        const container = $('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast' + (type ? ' ' + type : '');
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 4000);
    }

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

            cancelBtn.onclick = () => { cleanup(); resolve(options.showInput ? null : false); };
            confirmBtn.onclick = () => { cleanup(); resolve(options.showInput ? inputEl.value.trim() : true); };
            inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') { cleanup(); resolve(options.showInput ? inputEl.value.trim() : true); }
            };
            overlay.onclick = (e) => {
                if (e.target === overlay) { cleanup(); resolve(options.showInput ? null : false); }
            };
        });
    }

    function showPrompt(title, defaultValue = '') {
        return showModal(title, { showInput: true, defaultValue: defaultValue, showCancel: true });
    }

    function showConfirm(title, message) {
        return showModal(title, { message: message, showInput: false, showCancel: true, confirmText: 'Confirm' });
    }

    const colorPalette = ['#6BA661', '#325788', '#BEB5AB', '#CB1E1E', '#57612C'];

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
        if (wavesurfer) {
            wavesurfer.setOptions({ progressColor: hex, waveColor: hexToRgbGlow(hex) });
        }
    }

    function buildAccentSettingsUI() {
        const drawerBody = document.querySelector('.drawer-body');
        const section = document.createElement('div');
        section.className = 'drawer-section drawer-col-start';
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
    const savedAccent = localStorage.getItem('theme-accent') || '#BEB5AB';
    applyAccentColor(savedAccent);

    const currentTheme = localStorage.getItem('theme') || 'light';
    body.className = currentTheme + '-theme';
    $('theme-toggle').checked = currentTheme === 'light';
    $('theme-toggle').addEventListener('change', e => {
        const t = e.target.checked ? 'light' : 'dark';
        body.className = t + '-theme';
        localStorage.setItem('theme', t);
    });

    function setupCustomDropdown(btnId, dropdownId, textId, valueCallback) {
        const btn = $(btnId);
        const text = $(textId);
        const dropdown = $(dropdownId);

        btn.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-dropdown').forEach(d => {
                if (d.id !== dropdownId) d.classList.add('hidden');
            });
            dropdown.classList.toggle('hidden');
        };

        dropdown.querySelectorAll('.dropdown-option').forEach(opt => {
            opt.onclick = (e) => {
                e.stopPropagation();
                const val = opt.dataset.value;
                text.textContent = opt.textContent;
                dropdown.querySelectorAll('.dropdown-option').forEach(o => o.classList.remove('active-option'));
                opt.classList.add('active-option');
                dropdown.classList.add('hidden');
                if (valueCallback) valueCallback(val);
            };
        });
    }

    setupCustomDropdown('sort-btn', 'sort-dropdown', 'sort-btn-text', (val) => {
        currentSort = val;
        sortAndRenderTracks();
    });

    setupCustomDropdown('eq-preset-btn', 'eq-preset-dropdown', 'eq-preset-text', (val) => {
        currentEq = val;
        if (val === 'custom') return;
        const eqPresets = { 'flat': [0, 0, 0, 0], 'bass': [6, 2, 0, 0], 'acoustic': [-2, 2, 4, 3] };
        const vals = eqPresets[val];
        ['low', 'lmid', 'hmid', 'high'].forEach((b, i) => {
            $(`sl-eq-${b}`).value = vals[i];
            $(`val-eq-${b}`).textContent = (vals[i] > 0 ? '+' : '') + vals[i] + ' dB';
            if (audioCtx && nodes.eq) nodes.eq[i].gain.value = vals[i];
        });
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.add('hidden'));
    });

    $('opt-play-next').onclick = (e) => {
        e.stopPropagation();
        $('track-options-menu').classList.add('hidden');
        if (trackMenuTargetId) {
            nextUpQueue.push(trackMenuTargetId);
            showToast("Track queued to play next.");
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
        showPrompt(`Add to Playlist`, `Type one: ${plNames}`).then(name => {
            if (name) {
                let pList = customPlaylists.find(p => p.name.toLowerCase() === name.toLowerCase());
                if (pList) {
                    if (!pList.trackIds.includes(trackMenuTargetId)) {
                        pList.trackIds.push(trackMenuTargetId);
                        showToast(`Added to ${pList.name}`);
                    } else showToast("Already in playlist");
                } else showToast("Playlist not found", "error");
            }
        });
    };

    const formatBtns = document.querySelectorAll('.format-btn');
    formatBtns.forEach(btn => {
        btn.onclick = () => {
            formatBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            exportFormat = btn.dataset.format;
        };
    });

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
            uiClickSound.play();
            document.querySelectorAll('.tabs button').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            Object.values(views).forEach(v => v.classList.remove('active-view'));
            views[tab.dataset.view].classList.add('active-view');

            const tabsContainer = document.querySelector('.tabs');
            const tabRect = tab.getBoundingClientRect();
            const containerRect = tabsContainer.getBoundingClientRect();
            const scrollLeft = tab.offsetLeft - (containerRect.width / 2) + (tabRect.width / 2);
            tabsContainer.scrollTo({ left: scrollLeft, behavior: 'smooth' });

            if (tab.dataset.view === 'songs-view') {
                activePlaylistId = null;
                sortAndRenderTracks();
            } else if (tab.dataset.view === 'playlists-view') {
                renderPlaylistsHome();
            } else if (tab.dataset.view === 'folders-view') {
                renderFoldersHome();
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

    let arrowHoldTimer;
    let arrowHeld = false;
    let isArrowSeek = false;
    document.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        const k = e.key.toLowerCase();

        // FIX: Escape now closes the Now Playing overlay - previously desktop
        // users only had the small round X button to close it.
        if (e.key === 'Escape') {
            const npOverlay = $('now-playing-overlay');
            if (npOverlay && npOverlay.classList.contains('open')) {
                closeNowPlayingOverlay();
                return;
            }
        }

        if (k === ' ' || e.code === 'Space') {
            e.preventDefault();
            togglePlay();
            return;
        }
        if (k === 's') { $('drawer').classList.contains('open') ? cancelDrawer() : $('btn-menu').click(); }
        if (k === 'l') $('tab-library').click();
        if (k === 'p') $('tab-playlists').click();
        if (k === 'a') $('tab-adjustments').click();
        if (k === 'f') $('tab-folders').click();

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const v = document.querySelector('.view.active-view .custom-scrollbar');
            if (v) v.scrollTop -= 50;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const v = document.querySelector('.view.active-view .custom-scrollbar');
            if (v) v.scrollTop += 50;
        }

        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            if (!arrowHeld && trackList.length > 0) {
                arrowHeld = true;
                isArrowSeek = true;
                arrowHoldTimer = setTimeout(() => {
                    isArrowSeek = false;
                    e.key === 'ArrowRight' ? playNext() : playPrev();
                }, 2000);
            }
        }
    });

    document.addEventListener('keyup', (e) => {
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            arrowHeld = false;
            clearTimeout(arrowHoldTimer);
            if (isArrowSeek && audio.duration) {
                audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + (e.key === 'ArrowRight' ? 5 : -5)));
            }
        }
    });

    const btnFooterLocate = $('btn-footer-locate');
    const btnFooterHeart = $('btn-footer-heart');

    btnFooterLocate.onclick = () => {
        if (currentTrackIndex >= 0 && trackList[currentTrackIndex] && trackList[currentTrackIndex].element) {
            const activeTabBtn = document.querySelector('.tabs button.active');
            if (activeTabBtn.dataset.view !== 'songs-view') {
                $('tab-library').click();
            }
            setTimeout(() => {
                const el = trackList[currentTrackIndex].element;
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('blink-anim');
                setTimeout(() => el.classList.remove('blink-anim'), 1200);
            }, 50);
        }
    };

    btnFooterHeart.onclick = () => {
        if (currentTrackIndex >= 0 && trackList[currentTrackIndex]) {
            const t = trackList[currentTrackIndex];
            t.isFavorite = !t.isFavorite;
            updateFooterHeart();
            if (t.element) {
                const hBtn = t.element.querySelector('.heart-btn');
                hBtn.innerHTML = t.isFavorite ? filledHeart : outlineHeart;
                hBtn.style.color = t.isFavorite ? 'var(--accent)' : 'var(--text-muted)';
            }
        }
    };

    function updateFooterHeart() {
        if (currentTrackIndex >= 0 && trackList[currentTrackIndex]) {
            const isFav = trackList[currentTrackIndex].isFavorite;
            btnFooterHeart.innerHTML = isFav ? filledHeart : outlineHeart;
            btnFooterHeart.style.color = isFav ? 'var(--accent)' : 'var(--text-muted)';
            const npHeart = $('np-btn-heart');
            if (npHeart) {
                npHeart.innerHTML = isFav ? filledHeart : outlineHeart;
                npHeart.style.color = isFav ? 'var(--accent)' : 'var(--text-muted)';
            }
        }
    }

    const btnNpHeart = $('np-btn-heart');
    const btnNpLocate = $('np-btn-locate');
    if (btnNpHeart) btnNpHeart.onclick = () => btnFooterHeart.onclick();
    if (btnNpLocate) btnNpLocate.onclick = () => btnFooterLocate.onclick();

    let footerTouchStartY = 0;
    const playerBar = $('player-bar');
    const overlay = $('now-playing-overlay');

    playerBar.addEventListener('mousedown', e => {
        if (e.target.closest('button') || e.target.closest('input')) return;
        footerTouchStartY = e.clientY;
    });
    document.addEventListener('mousemove', e => {
        if (!footerTouchStartY) return;
        if (footerTouchStartY - e.clientY > 40) {
            openNowPlayingOverlay();
            footerTouchStartY = 0;
        }
    });
    document.addEventListener('mouseup', () => footerTouchStartY = 0);

    // Mobile Swipe up to open
    playerBar.addEventListener('touchstart', e => {
        if (e.target.closest('button') || e.target.closest('input')) return;
        footerTouchStartY = e.touches[0].clientY;
    }, { passive: true });

    playerBar.addEventListener('touchmove', e => {
        if (!footerTouchStartY) return;
        if (footerTouchStartY - e.touches[0].clientY > 40) {
            openNowPlayingOverlay();
            footerTouchStartY = 0;
        }
    }, { passive: true });

    // Mobile Swipe down to close
    let npTouchStartY = 0;
    overlay.addEventListener('touchstart', e => {
        if (e.target.closest('.np-lyrics-display') || e.target.closest('.np-art-container') || e.target.closest('input') || e.target.closest('button')) return;
        npTouchStartY = e.touches[0].clientY;
    }, { passive: true });

    overlay.addEventListener('touchmove', e => {
        if (!npTouchStartY) return;
        if (e.target.closest('.np-lyrics-display') || e.target.closest('.np-art-container') || e.target.closest('input') || e.target.closest('button')) return;
        if (e.touches[0].clientY - npTouchStartY > 60) {
            closeNowPlayingOverlay();
            npTouchStartY = 0;
        }
    }, { passive: true });

    visualizerCanvas.addEventListener('click', openNowPlayingOverlay);


    async function initAudioContext() {
        if (audioCtx) {
            if (audioCtx.state === 'suspended') await audioCtx.resume();
            return;
        }
        if (audioCtxInitialized) return;
        audioCtxInitialized = true;

        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            sourceNode = audioCtx.createMediaElementSource(audio);
            analyserNode = audioCtx.createAnalyser();
            analyserNode.fftSize = 256;

            buildEffectNodes(audioCtx);

            // FIX (critical): This is the STATIC tail of the audio graph.
            // It used to live at the bottom of routeAudio() and get re-run on
            // every single toggle/slider change WITHOUT ever being disconnected
            // first. That meant every interaction added another parallel,
            // never-removed signal path into your speakers - the volume/gain
            // would compound every time you touched a control, which is what
            // caused the runaway distortion (e.g. "warmth distorts even at 1%").
            // It must be connected exactly once, here, and routeAudio() must
            // never touch it again.
            analyserNode.connect(nodes.masterGain);
            nodes.masterGain.connect(audioCtx.destination);

            routeAudio();
            generateReverbIR();
        } catch (e) {
            console.error("Audio engine failed to start. Falling back to native.", e);
        }
    }

    function buildEffectNodes(ctx) {
        nodes.masterGain = ctx.createGain();
        nodes.masterGain.gain.value = 1.0;
        // Always-on transparent safety limiter - prevents clipping/distortion
        // when multiple effects (EQ bass boost + Warmth + Preamp + Reverb...)
        // stack gain and push the signal above 0dB.
        nodes.safetyLimiter = ctx.createDynamicsCompressor();
        nodes.safetyLimiter.threshold.value = -1;
        nodes.safetyLimiter.knee.value = 0;
        nodes.safetyLimiter.ratio.value = 20;
        nodes.safetyLimiter.attack.value = 0.003;
        nodes.safetyLimiter.release.value = 0.15;

        nodes.preampGain = ctx.createGain();
        nodes.preampGain.gain.value = 1.0;

        nodes.balancePan = ctx.createStereoPanner();
        nodes.balancePan.pan.value = 0;

        // FIX / REWORK: "Clarity+" previously just tilted the EQ (cut at
        // 4kHz, boost at 12kHz) which the ear reads as "pitched up" rather
        // than "clearer". This rework keeps a gentle tonal shape but adds
        // the two things that actually create clarity + spatial immersion:
        // (1) a harmonic exciter - a mild saturator on a HIGH-PASSED copy
        //     of the signal, blended back in, which reveals overtones/detail
        //     without just boosting a frequency band (this is the same
        //     principle behind BBE/Aphex-style "Aural Exciter" processing
        //     and is much closer to what you were asking for).
        // (2) a Haas-effect micro-delay stereo widener (a few ms of L/R
        //     offset) layered on top of the existing mid/side widener -
        //     this is the actual mechanism that creates "sense of space",
        //     since mid/side widening alone only affects panorama, not depth.
        nodes.clrBassSmooth = ctx.createBiquadFilter();
        nodes.clrBassSmooth.type = 'lowshelf';
        nodes.clrBassSmooth.frequency.value = 90;
        nodes.clrBassSmooth.gain.value = 1.2;

        nodes.clrMudCut = ctx.createBiquadFilter();
        nodes.clrMudCut.type = 'peaking';
        nodes.clrMudCut.frequency.value = 300;
        nodes.clrMudCut.Q.value = 0.9;
        nodes.clrMudCut.gain.value = -1.2;

        // Exciter send: split off a high-passed copy, saturate it gently,
        // and blend it back at low level. This is where "hidden detail"
        // actually comes from - added harmonics, not a raw volume boost.
        nodes.clrExciterHP = ctx.createBiquadFilter();
        nodes.clrExciterHP.type = 'highpass';
        nodes.clrExciterHP.frequency.value = 2800;
        nodes.clrExciterShaper = ctx.createWaveShaper();
        nodes.clrExciterShaper.oversample = '4x';
        {
            const n = 2048;
            const curve = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const x = (i * 2) / n - 1;
                curve[i] = Math.tanh(x * 2.2) * 0.85;
            }
            nodes.clrExciterShaper.curve = curve;
        }
        nodes.clrExciterGain = ctx.createGain();
        nodes.clrExciterGain.gain.value = 0.16;

        nodes.clrAirShelf = ctx.createBiquadFilter();
        nodes.clrAirShelf.type = 'highshelf';
        nodes.clrAirShelf.frequency.value = 13000;
        nodes.clrAirShelf.gain.value = 1.2;

        nodes.clrNormalizer = ctx.createDynamicsCompressor();
        nodes.clrNormalizer.threshold.value = -22;
        nodes.clrNormalizer.knee.value = 12;
        nodes.clrNormalizer.ratio.value = 1.4;
        nodes.clrNormalizer.attack.value = 0.02;
        nodes.clrNormalizer.release.value = 0.15;

        nodes.clrWidth = createStereoWidthNode(ctx);
        nodes.clrWidth.setWidth(1.25);

        // Haas widener: tiny (8ms) delay on one channel only, mixed back at
        // partial level. This is the real "sense of space" trick - it fools
        // the ear's interaural timing cues into perceiving a wider room
        // without any pitch or tonal side-effects.
        nodes.clrHaasSplit = ctx.createChannelSplitter(2);
        nodes.clrHaasMerge = ctx.createChannelMerger(2);
        nodes.clrHaasDelay = ctx.createDelay(0.05);
        nodes.clrHaasDelay.delayTime.value = 0.008;
        nodes.clrHaasWet = ctx.createGain();
        nodes.clrHaasWet.gain.value = 0.35;
        nodes.clrHaasDry = ctx.createGain();
        nodes.clrHaasDry.gain.value = 1.0;
        nodes.clrHaasSplit.connect(nodes.clrHaasMerge, 0, 0);
        nodes.clrHaasSplit.connect(nodes.clrHaasDry, 1);
        nodes.clrHaasDry.connect(nodes.clrHaasMerge, 0, 1);
        nodes.clrHaasSplit.connect(nodes.clrHaasDelay, 1);
        nodes.clrHaasDelay.connect(nodes.clrHaasWet);
        nodes.clrHaasWet.connect(nodes.clrHaasMerge, 0, 1);

        nodes.clrAntiDistort = ctx.createGain();
        nodes.clrAntiDistort.gain.value = 0.85;

        nodes.clrBassSmooth.connect(nodes.clrMudCut);
        nodes.clrMudCut.connect(nodes.clrAirShelf);
        nodes.clrMudCut.connect(nodes.clrExciterHP);
        nodes.clrExciterHP.connect(nodes.clrExciterShaper);
        nodes.clrExciterShaper.connect(nodes.clrExciterGain);
        nodes.clrExciterGain.connect(nodes.clrAirShelf);
        nodes.clrAirShelf.connect(nodes.clrNormalizer);
        nodes.clrNormalizer.connect(nodes.clrWidth.input);
        nodes.clrWidth.output.connect(nodes.clrHaasSplit);
        nodes.clrHaasMerge.connect(nodes.clrAntiDistort);

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

        nodes.warmthFilter = ctx.createBiquadFilter();
        nodes.warmthFilter.type = 'lowshelf';
        nodes.warmthFilter.frequency.value = 250;

        nodes.warmthShaper = ctx.createWaveShaper();
        nodes.warmthShaper.oversample = '4x';

        nodes.warmthHighCut = ctx.createBiquadFilter();
        nodes.warmthHighCut.type = 'highshelf';
        nodes.warmthHighCut.frequency.value = 8000;

        nodes.warmthFilter.connect(nodes.warmthShaper);
        nodes.warmthShaper.connect(nodes.warmthHighCut);

        updateWarmthParams();

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
        // FIX: added a damping filter inside the feedback loop. Without this,
        // repeated passes through the delay line accumulate high-frequency
        // energy every cycle (classic comb-filter buildup) which clips and
        // sounds like distortion, especially at higher feedback settings.
        nodes.flangFbDamp = ctx.createBiquadFilter();
        nodes.flangFbDamp.type = 'lowpass';
        nodes.flangFbDamp.frequency.value = 6000;
        nodes.flangLfo = ctx.createOscillator();
        nodes.flangLfo.type = 'sine';
        nodes.flangLfoGain = ctx.createGain();
        nodes.flangLfo.connect(nodes.flangLfoGain);
        nodes.flangLfoGain.connect(nodes.flangDelay.delayTime);
        nodes.flangLfo.start();
        nodes.flangIn.connect(nodes.flangOut);
        nodes.flangIn.connect(nodes.flangDelay);
        nodes.flangDelay.connect(nodes.flangFbDamp);
        nodes.flangFbDamp.connect(nodes.flangFb);
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
        if (!window.Tone) {
            console.warn("Tone.js not loaded, fallback bypassing pitch shift.");
            nodes.pitchIn = ctx.createGain();
            nodes.pitchOut = ctx.createGain();
            nodes.pitchIn.connect(nodes.pitchOut);
            return;
        }
        Tone.setContext(ctx);
        nodes.pitchIn = ctx.createGain();
        nodes.pitchOut = ctx.createGain();

        // FIX: windowSize 0.1 (100ms) is too small for anything beyond a
        // couple semitones of shift - it's the classic granular/robotic
        // artifact. A larger window trades a little latency for much
        // cleaner-sounding pitch shifts, which is exactly the tradeoff
        // Vinyl Mode avoids needing at all (it never pitch-shifts).
        nodes.tonePitch = new Tone.PitchShift({
            pitch: 0,
            windowSize: 0.15,
            delayTime: 0,
            feedback: 0
        });

        Tone.connect(nodes.pitchIn, nodes.tonePitch);
        Tone.connect(nodes.tonePitch, nodes.pitchOut);
    }

    // FIX: The pitch node is now the ONLY thing responsible for pitch.
    // In Vinyl Mode, no correction is applied at all - speed changes pitch
    // naturally, like a real turntable.
    // Out of Vinyl Mode ("Independent Pitch"), we now calculate how many
    // semitones the tempo change alone would shift the pitch by, and cancel
    // that out, THEN add whatever extra shift the user dialed in on the
    // slider. Combined with disabling the browser's native preservesPitch
    // (see top of file), this removes the double-processing that was making
    // it sound like a broken robot.
    function updatePitchShift() {
        if (!audioCtx || !nodes.tonePitch) return;
        if (vinylMode) {
            nodes.tonePitch.pitch = 0;
        } else {
            const tempo = parseFloat($('sl-tempo').value) || 1;
            const compensation = -12 * Math.log2(tempo);
            const userShift = parseFloat($('sl-pitch').value) || 0;
            nodes.tonePitch.pitch = compensation + userShift;
        }
    }

    function updateWarmthParams() {
        if (!audioCtx) return;
        const slider = $('sl-warmth');
        if (!slider) return;

        const amount = parseFloat(slider.value);
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);

        // FIX: gentler max drive/EQ so "Warmth" behaves like soft tape
        // saturation instead of a hard clipper. Combined with the routeAudio
        // fix above (which stopped signal from doubling every toggle), this
        // should now sound like actual warmth, not distortion.
        for (let i = 0; i < n_samples; ++i) {
            const x = (i * 2) / n_samples - 1;
            if (amount === 0) {
                curve[i] = x;
            } else {
                const drive = 1 + (amount * 0.012); // max drive ≈ 2.2 (was 3)
                curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
            }
        }

        if (nodes.warmthShaper) nodes.warmthShaper.curve = curve;

        if (nodes.warmthFilter && nodes.warmthHighCut) {
            nodes.warmthFilter.gain.value = amount * 0.02;      // max +2dB (was +3dB)
            nodes.warmthHighCut.gain.value = -(amount * 0.015); // max -1.5dB (was -2dB)
        }
    }

    function createStereoWidthNode(ctx) {
        const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
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
        return { input: split, output: merge, setWidth: w => { sideL.gain.value = w; sideR.gain.value = -w; } };
    }

    function routeAudio() {
        if (!audioCtx) return;
        sourceNode.disconnect();
        if (nodes.pitchOut) nodes.pitchOut.disconnect();
        if (nodes.warmthHighCut) nodes.warmthHighCut.disconnect();
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
        // NOTE: analyserNode / masterGain are intentionally NOT touched here.
        // That static tail is connected exactly once in initAudioContext().

        let curr = sourceNode;

        // FIX: pitch-shift node is now included whenever Vinyl Mode is OFF
        // (independent pitch mode), regardless of the raw slider value, so
        // tempo-compensation (see updatePitchShift) is always actually applied.
        if (!vinylMode && nodes.pitchIn) {
            curr.connect(nodes.pitchIn);
            curr = nodes.pitchOut;
        }

        if (fx.warmth) { curr.connect(nodes.warmthFilter); curr = nodes.warmthHighCut; }
        if (fx.preamp) { curr.connect(nodes.preampGain); curr = nodes.preampGain; }
        if (fx.clarity) { curr.connect(nodes.clrBassSmooth); curr = nodes.clrAntiDistort; }
        if (fx.eq) { curr.connect(nodes.eq[0]); curr = nodes.eq[3]; }
        if (fx.vocal) { curr.connect(nodes.vocSplit); curr = nodes.vocMerge; }
        if (fx.mono) { curr.connect(nodes.mono); curr = nodes.mono; }
        if (fx.invert) { curr.connect(nodes.invSplit); curr = nodes.invMerge; }
        if (fx.balance) { curr.connect(nodes.balancePan); curr = nodes.balancePan; }
        if (fx.flanger) { curr.connect(nodes.flangIn); curr = nodes.flangOut; }
        if (fx.echo) { curr.connect(nodes.echoIn); curr = nodes.echoOut; }
        if (fx.eightD) { curr.connect(nodes.eightDIn); curr = nodes.eightDOut; }
        if (fx.reverb) { curr.connect(nodes.revIn); curr = nodes.revOut; }
        if (fx.comp) { curr.connect(nodes.comp); curr = nodes.comp; }
        if (fx.limit) { curr.connect(nodes.limit); curr = nodes.limit; }

        // Route through the safety limiter last, so any combination of
        // effects gets a transparent ceiling instead of clipping.
        curr.connect(nodes.safetyLimiter);
        nodes.safetyLimiter.connect(analyserNode);
        // analyserNode -> masterGain -> destination: connected once, in initAudioContext().
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
        // FIX: the old modulation depth (up to 0.005s = 5ms swing) combined
        // with feedback up to 90% created runaway comb-filtering - at high
        // feedback the delayed signal re-enters the delay line faster than
        // it decays, which is what you heard as distortion/crackle.
        // Feedback is now capped lower and passed through a damping filter
        // in the loop so high frequencies don't build up unchecked.
        nodes.flangLfoGain.gain.value = depth * 0.003;
        nodes.flangDelay.delayTime.value = 0.003 + (depth * 0.0015);
        const rawFb = parseFloat($('sl-flang-fb').value) / 100;
        nodes.flangFb.gain.value = Math.min(rawFb, 0.75) * 0.85;
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
        'tgl-clarity': 'clarity', 'tgl-eq': 'eq', 'tgl-vocal': 'vocal', 'tgl-comp': 'comp',
        'tgl-limit': 'limit', 'tgl-echo': 'echo', 'tgl-flanger': 'flanger', 'tgl-reverb': 'reverb', 'tgl-mono': 'mono',
        'tgl-invert': 'invert', 'tgl-8d': 'eightD', 'tgl-preamp': 'preamp', 'tgl-balance': 'balance', 'tgl-warmth': 'warmth'
    };
    Object.keys(toggleMap).forEach(id => {
        $(id).onchange = e => {
            fx[toggleMap[id]] = e.target.checked;
            routeAudio();
        };
    });

    $('tgl-vinyl').onchange = e => {
        vinylMode = e.target.checked;
        const pitchGroup = $('pitch-group');
        if (vinylMode) {
            pitchGroup.classList.add('opacity-40-no-pointer');
            $('sl-pitch').value = 0;
            $('val-pitch').textContent = '0.0';
        } else {
            pitchGroup.classList.remove('opacity-40-no-pointer');
        }
        updatePitchShift();
        routeAudio();
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

    $('res-eq').onclick = () => {
        // FIX: '$('eq-preset')' does not exist - the real elements are
        // 'eq-preset-btn' / 'eq-preset-text' / 'eq-preset-dropdown'. The old
        // line threw a TypeError (reading .value of null), which silently
        // aborted the ENTIRE handler right there - none of the code below it
        // ever ran, so the sliders, labels, and gain nodes never reset.
        $('tgl-eq').checked = false;
        fx.eq = false;
        currentEq = 'flat';
        $('eq-preset-text').textContent = 'Flat';
        document.querySelectorAll('#eq-preset-dropdown .dropdown-option').forEach(o => {
            o.classList.toggle('active-option', o.dataset.value === 'flat');
        });
        ['low', 'lmid', 'hmid', 'high'].forEach((b, i) => {
            $(`sl-eq-${b}`).value = 0;
            $(`val-eq-${b}`).textContent = '0 dB';
            if (audioCtx) nodes.eq[i].gain.value = 0;
        });
        routeAudio();
    };
    $('res-comp').onclick = () => {
        $('tgl-comp').checked = false; fx.comp = false; $('sl-comp-thresh').value = -24; $('val-comp-thresh').textContent = '-24 dB';
        $('sl-comp-ratio').value = 12; $('val-comp-ratio').textContent = '12:1'; $('sl-comp-att').value = 3; $('val-comp-att').textContent = '3 ms';
        $('sl-comp-rel').value = 250; $('val-comp-rel').textContent = '250 ms'; updateCompParams(); routeAudio();
    };
    $('res-limit').onclick = () => {
        $('tgl-limit').checked = false; fx.limit = false; $('sl-lim-thresh').value = -2; $('val-lim-thresh').textContent = '-2 dB';
        $('sl-lim-rel').value = 50; $('val-lim-rel').textContent = '50 ms'; updateLimiterParams(); routeAudio();
    };
    $('res-echo').onclick = () => {
        $('tgl-echo').checked = false; fx.echo = false; $('sl-echo-mix').value = 40; $('val-echo-mix').textContent = '40%';
        $('sl-echo-time').value = 330; $('val-echo-time').textContent = '330 ms'; $('sl-echo-fb').value = 40; $('val-echo-fb').textContent = '40%';
        updateEchoParams(); routeAudio();
    };
    $('res-flanger').onclick = () => {
        $('tgl-flanger').checked = false; fx.flanger = false; $('sl-flang-rate').value = 0.5; $('val-flang-rate').textContent = '0.5 Hz';
        $('sl-flang-depth').value = 20; $('val-flang-depth').textContent = '20%'; $('sl-flang-fb').value = 50; $('val-flang-fb').textContent = '50%';
        updateFlangerParams(); routeAudio();
    };
    $('res-reverb').onclick = () => {
        $('tgl-reverb').checked = false; fx.reverb = false; $('sl-rev-wet').value = 45; $('val-rev-wet').textContent = '45%';
        $('sl-rev-stereo').value = 150; $('val-rev-stereo').textContent = '150%'; $('sl-rev-damp').value = 25; $('val-rev-damp').textContent = '25%';
        $('sl-rev-room').value = 75; $('val-rev-room').textContent = '75%'; $('sl-rev-pre').value = 0; $('val-rev-pre').textContent = '0 ms';
        $('sl-rev-low').value = 10; $('val-rev-low').textContent = '10 Hz'; updateReverbParams(); generateReverbIR(); routeAudio();
    };
    $('res-8d').onclick = () => {
        $('tgl-8d').checked = false; fx.eightD = false; $('sl-8d-speed').value = 0.12; $('val-8d-speed').textContent = '0.12 Hz';
        $('sl-8d-width').value = 85; $('val-8d-width').textContent = '85%'; $('sl-8d-rev').value = 40; $('val-8d-rev').textContent = '40%';
        updateEightDParams(); routeAudio();
    };
    $('res-preamp').onclick = () => {
        $('tgl-preamp').checked = false; fx.preamp = false; $('sl-preamp-gain').value = 0; $('val-preamp-gain').textContent = '0 dB';
        updatePreampParams(); routeAudio();
    };
    $('res-balance').onclick = () => {
        $('tgl-balance').checked = false; fx.balance = false; $('sl-balance-pan').value = 0; $('val-balance-pan').textContent = 'Center';
        updateBalanceParams(); routeAudio();
    };
    $('res-warmth').onclick = () => {
        $('tgl-warmth').checked = false; fx.warmth = false; $('sl-warmth').value = 0; $('val-warmth').textContent = '0%';
        updateWarmthParams(); routeAudio();
    };

    ['low', 'lmid', 'hmid', 'high'].forEach((b, i) => {
        $(`sl-eq-${b}`).oninput = (e) => {
            $('eq-preset-text').textContent = 'Custom';
            currentEq = 'custom';
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
        // FIX: tempo changes must recompute the pitch-compensation amount too,
        // otherwise "Independent Pitch" mode drifts out of tune as speed changes.
        updatePitchShift();
        routeAudio();
    });
    bindSlider('sl-pitch', 'val-pitch', '', () => {
        updatePitchShift();
        routeAudio();
    });
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
    bindSlider('sl-warmth', 'val-warmth', '%', updateWarmthParams);
    // ---------- Ambience ----------
    // Independent, always-looping background audio elements. They are NOT
    // routed through the effects chain and are NOT reset when the track
    // changes — only the user toggling the switch off stops them.
    const ambienceTracks = [
        { id: 'birds', file: 'optional/ambience/Birds.mp3' },
        { id: 'birds2', file: 'optional/ambience/Birds-2.mp3' },
        { id: 'campfire', file: 'optional/ambience/Campfire.mp3' },
        { id: 'crickets', file: 'optional/ambience/Crickets.mp3' },
        { id: 'kids', file: 'optional/ambience/Kids.mp3' },
        { id: 'lightrain', file: 'optional/ambience/Light-Rain.mp3' },
        { id: 'rain', file: 'optional/ambience/Rain.mp3' }
    ];
    const ambienceAudios = {};
    ambienceTracks.forEach(t => {
        const a = new Audio(t.file);
        a.loop = true; // loops indefinitely to cover the full song length
        a.volume = 0;
        ambienceAudios[t.id] = a;
    });
    let ambienceEnabled = false;

    function playActiveAmbience() {
        ambienceTracks.forEach(t => {
            const a = ambienceAudios[t.id];
            if (a.volume > 0) a.play().catch(() => { });
        });
    }
    function pauseAllAmbience() {
        Object.values(ambienceAudios).forEach(a => a.pause());
    }

    $('tgl-ambience').onchange = e => {
        ambienceEnabled = e.target.checked;
        if (ambienceEnabled) playActiveAmbience();
        else pauseAllAmbience();
    };

    ambienceTracks.forEach(t => {
        $(`sl-amb-${t.id}`).oninput = e => {
            const val = parseInt(e.target.value);
            $(`val-amb-${t.id}`).textContent = val + '%';
            ambienceAudios[t.id].volume = val / 100;
            if (val === 0) {
                ambienceAudios[t.id].pause();
            } else if (ambienceEnabled && isPlaying) {
                ambienceAudios[t.id].play().catch(() => { });
            }
        };
    });

    $('res-ambience').onclick = () => {
        $('tgl-ambience').checked = false;
        ambienceEnabled = false;
        ambienceTracks.forEach(t => {
            $(`sl-amb-${t.id}`).value = 0;
            $(`val-amb-${t.id}`).textContent = '0%';
            ambienceAudios[t.id].volume = 0;
            ambienceAudios[t.id].pause();
        });
    };

    $('sl-balance-pan').oninput = e => {
        const val = parseFloat(e.target.value);
        let text = 'Center';
        if (val < 0) text = 'L ' + Math.abs(Math.round(val * 100)) + '%';
        else if (val > 0) text = 'R ' + Math.abs(Math.round(val * 100)) + '%';
        $('val-balance-pan').textContent = text;
        updateBalanceParams();
    };

    function loadDefaultAssets() {
        const defaults = [];
        for (let i = 1; i <= 7; i++) {
            defaults.push({
                id: 'trk_def_' + i,
                title: `sample-${i}`,
                artist: 'Default Assets',
                url: `assets/sample-${i}.mp3`,
                file: null,
                duration: 0,
                index: trackList.length + i - 1,
                element: null,
                dateAdded: Date.now(),
                dateModified: Date.now(),
                albumArt: null,
                _isExtracting: false,
                lyrics: null,
                isFavorite: false,
                folderName: 'Default Assets'
            });
        }
        trackList = trackList.concat(defaults);
        searchBar.style.display = 'block';
        emptyState.style.display = 'none';
        sortAndRenderTracks();
        renderFoldersHome();
    }

    $('btn-open-folder').onclick = async () => {
        if (window.showDirectoryPicker) {
            try {
                const handle = await window.showDirectoryPicker({ mode: 'read' });
                await saveHandle(handle);
                await loadTracksFromHandle(handle);
            } catch (e) {
                if (e.name === 'AbortError' || e.name === 'NotAllowedError') {
                    showToast('Folder access denied. To protect privacy on some devices, select a subfolder instead.', 'error');
                } else {
                    $('folder-input').click();
                }
            }
        } else {
            $('folder-input').click();
        }
    };

    $('btn-open-file').onclick = () => $('file-input').click();

    async function checkPersistedFolder() {
        if (window.showDirectoryPicker) {
            const handle = await getHandle();
            if (handle) {
                try {
                    const perm = await handle.queryPermission({ mode: 'read' });
                    if (perm === 'granted') {
                        await loadTracksFromHandle(handle);
                        return;
                    }
                } catch (e) { }

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
                    } catch (e) { console.error(e); }
                };
                $('empty-state').appendChild(btn);
            }
        }
    }

    async function loadTracksFromHandle(dirHandle) {
        cancelDrawer();
        $('loading-overlay').classList.remove('hidden');
        $('loading-text').textContent = `Scanning ${dirHandle.name}...`;

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
                $('loading-overlay').classList.add('hidden');
                showToast('No audio files found in folder or subfolders.', 'error');
                return;
            }
            $('loading-text').textContent = `Processing ${files.length} tracks...`;
            await processNewFiles(files, dirHandle.name);
        } catch (e) {
            $('loading-overlay').classList.add('hidden');
            showToast('Permission denied or error reading folder', 'error');
        }
    }

    $('folder-input').onchange = async e => {
        cancelDrawer();
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|ogg|m4a|flac)$/i));
        // FIX: without resetting .value, selecting the exact same folder
        // again after a failed/empty scan wouldn't fire 'change' a second
        // time on some browsers, making the UI look permanently stuck.
        e.target.value = '';
        if (!files.length) {
            showToast('No audio files found.', 'error');
            return;
        }
        $('loading-overlay').classList.remove('hidden');
        $('loading-text').textContent = `Processing ${files.length} tracks...`;

        setTimeout(() => {
            processNewFiles(files, files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : 'Local Folder');
        }, 50);
    };

    $('file-input').onchange = e => {
        cancelDrawer();
        const files = Array.from(e.target.files);
        const validFiles = files.filter(f => f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|ogg|m4a|flac)$/i));
        if (!validFiles.length) {
            showToast('Please select an audio file.', 'error');
            return;
        }
        $('loading-overlay').classList.remove('hidden');
        $('loading-text').textContent = `Processing ${validFiles.length} tracks...`;

        setTimeout(() => {
            processNewFiles(validFiles, 'Local Files');
        }, 50);
    };

    async function processNewFiles(files, defaultFolderName) {
        const now = Date.now();
        const newTracks = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const folderPathParts = file.webkitRelativePath ? file.webkitRelativePath.split('/') : [];
            const folderName = folderPathParts.length > 1 ? folderPathParts[folderPathParts.length - 2] : (defaultFolderName || 'Local Files');

            newTracks.push({
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
            });

            if (i % 50 === 0) {
                $('loading-text').textContent = `Processed ${i}/${files.length} tracks...`;
                await new Promise(r => setTimeout(r, 0));
            }
        }

        trackList = trackList.concat(newTracks);
        searchBar.style.display = 'block';
        emptyState.style.display = 'none';
        $('loading-overlay').classList.add('hidden');
        sortAndRenderTracks();
        renderPlaylistsHome();
        renderFoldersHome();
    }

    async function extractAlbumArtForTrack(track) {
        if (track.albumArt !== null || track._isExtracting) return;
        track._isExtracting = true;
        try {
            let buffer;
            if (track.file) {
                const sliceSize = Math.min(track.file.size, 512 * 1024);
                buffer = await track.file.slice(0, sliceSize).arrayBuffer();
            } else if (track.url) {
                const resp = await fetch(track.url, { headers: { 'Range': 'bytes=0-512000' } });
                if (!resp.ok && resp.status !== 206) {
                    const fullResp = await fetch(track.url);
                    if (!fullResp.ok) throw new Error();
                    buffer = await fullResp.arrayBuffer();
                } else {
                    buffer = await resp.arrayBuffer();
                }
            }

            const view = new DataView(buffer);
            let offset = 0;
            if (view.byteLength >= 10 && (view.getUint32(0) === 0x49443303 || view.getUint32(0) === 0x49443302)) {
                const size = synchSafeToInt(view.getUint32(6));
                offset = 10;
                const end = Math.min(offset + size, view.byteLength);

                while (offset < end - 10) {
                    const frameId = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
                    const frameSize = view.getUint32(offset + 4);

                    if (frameId === 'APIC') {
                        let imgStart = offset + 10;
                        let found = false;

                        while (imgStart < offset + 10 + frameSize - 3 && imgStart < view.byteLength - 3) {
                            const b1 = view.getUint8(imgStart);
                            const b2 = view.getUint8(imgStart + 1);
                            const b3 = view.getUint8(imgStart + 2);
                            const b4 = view.getUint8(imgStart + 3);

                            if (b1 === 0xFF && b2 === 0xD8 && b3 === 0xFF) { found = true; break; }
                            if (b1 === 0x89 && b2 === 0x50 && b3 === 0x4E && b4 === 0x47) { found = true; break; }
                            imgStart++;
                        }

                        if (found && (imgStart + 100 < view.byteLength)) {
                            const safeFrameSize = Math.min(frameSize, view.byteLength - imgStart);
                            const imgData = new Uint8Array(buffer.slice(imgStart, imgStart + safeFrameSize));
                            const mimeType = (view.getUint8(imgStart) === 0xFF) ? 'image/jpeg' : 'image/png';
                            track.albumArt = URL.createObjectURL(new Blob([imgData], { type: mimeType }));
                            updateUIWithArt(track);
                        }
                        track._isExtracting = false;
                        return;
                    }
                    offset += 10 + frameSize;
                }
            }
            track.albumArt = false;
        } catch (e) { track.albumArt = false; }

        track._isExtracting = false;
        updateUIWithArt(track);
    }

    function updateUIWithArt(track) {
        const imgIndex = (track.index % 7) + 1;
        const imgSrc = track.albumArt ? track.albumArt : `assets/image-${imgIndex}.jpg`;

        if (track.element) {
            const coverDiv = track.element.querySelector('.song-cover');
            if (coverDiv) {
                const playingInd = coverDiv.querySelector('.playing-indicator');
                coverDiv.innerHTML = `<img class="cover-img" src="${imgSrc}">`;
                if (playingInd) coverDiv.appendChild(playingInd);
            }
        }
        if (currentTrackIndex >= 0 && trackList[currentTrackIndex].id === track.id) {
            updateNowPlayingOverlay();
        }
    }

    function synchSafeToInt(val) {
        return (val & 0x7F) << 21 | (val & 0x7F00) << 6 | (val & 0x7F0000) >> 9 | (val & 0x7F000000) >>> 24;
    }

    function sortAndRenderTracks() {
        const sortVal = currentSort;
        switch (sortVal) {
            case 'name-asc': trackList.sort((a, b) => a.title.localeCompare(b.title)); break;
            case 'name-desc': trackList.sort((a, b) => b.title.localeCompare(a.title)); break;
            case 'date-mod-desc': trackList.sort((a, b) => (b.dateModified || 0) - (a.dateModified || 0)); break;
            case 'date-mod-asc': trackList.sort((a, b) => (a.dateModified || 0) - (b.dateModified || 0)); break;
            case 'date-add-desc': trackList.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0)); break;
            case 'date-add-asc': trackList.sort((a, b) => (a.dateAdded || 0) - (b.dateAdded || 0)); break;
            case 'duration-desc': trackList.sort((a, b) => (b.duration || 0) - (a.duration || 0)); break;
            case 'duration-asc': trackList.sort((a, b) => (a.duration || 0) - (b.duration || 0)); break;
            default: trackList.sort((a, b) => a.title.localeCompare(b.title));
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

        const targetContainer = activePlaylistId ? (activePlaylistId.startsWith('folder_') ? folderSongList : playlistSongList) : songListContainer;
        targetContainer.innerHTML = '';
        renderMoreTracks();
    }

    function renderMoreTracks() {
        const targetContainer = activePlaylistId ? (activePlaylistId.startsWith('folder_') ? folderSongList : playlistSongList) : songListContainer;
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
                    <img class="cover-img" src="${imgSrc}" onerror="this.outerHTML='<svg width=\\'24\\' height=\\'24\\' viewBox=\\'0 0 24 24\\' fill=\\'currentColor\\'><path d=\\'M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z\\'/></svg>'">
                    <div class="playing-indicator" id="ind-${track.id}">
                        ${isPlaying && currentTrackIndex === idx ? playIndicatorSvg : pausedIndicatorSvg}
                    </div>
                </div>
                <div class="song-info"><h3>${escapeHtml(track.title)}</h3><p>${escapeHtml(track.artist)}</p></div>
                <button class="icon-btn heart-btn" aria-label="Favorite" style="color: ${heartColor};">${heartIcon}</button>
                <button class="icon-btn more-btn" aria-label="Options">${dotsIcon}</button>
            `;

            item.onclick = (e) => {
                if (e.target.closest('.heart-btn') || e.target.closest('.more-btn')) return;
                initAudioContext(); // Non-blocking invoke to prepare audiocontext immediately
                if (currentTrackIndex === idx) togglePlay();
                else playTrack(idx);
            };

            item.querySelector('.heart-btn').onclick = (e) => {
                e.stopPropagation();
                track.isFavorite = !track.isFavorite;
                e.currentTarget.innerHTML = track.isFavorite ? filledHeart : outlineHeart;
                e.currentTarget.style.color = track.isFavorite ? 'var(--accent)' : 'var(--text-muted)';
                updateFooterHeart();
                if (activePlaylistId === 'favorites' && !track.isFavorite) sortAndRenderTracks();
            };

            item.querySelector('.more-btn').onclick = (e) => {
                e.stopPropagation();
                trackMenuTargetId = track.id;
                const menu = $('track-options-menu');
                menu.classList.remove('hidden');
                const rect = e.currentTarget.getBoundingClientRect();
                menu.style.top = (rect.bottom + window.scrollY) + 'px';
                menu.style.left = Math.min((rect.right - 150), window.innerWidth - 160) + 'px';
            };

            fragment.appendChild(item);
            track.element = item;

            if (!track.duration) {
                const temp = new Audio();
                temp.addEventListener('loadedmetadata', () => { track.duration = temp.duration; });
                temp.src = track.url;
            }

            if (track.albumArt === null && !track._isExtracting) extractAlbumArtForTrack(track);
        }
        targetContainer.appendChild(fragment);
        currentlyRendered = end;
    }

    document.querySelectorAll('.custom-scrollbar').forEach(v => {
        v.addEventListener('scroll', function () {
            if (this.scrollHeight - this.scrollTop - this.clientHeight < 400) {
                if (currentlyRendered < currentDisplayList.length) renderMoreTracks();
            }
        });
    });

    function escapeHtml(t) {
        return t.replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;',
            '"': '&quot;', "'": '&#039;'
        })[m]);
    }

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
        $('playlist-detail').style.display = 'none';
        $('playlists-home').style.display = 'block';
    };

    $('btn-back-folders').onclick = () => {
        activePlaylistId = null;
        $('folder-detail').style.display = 'none';
        $('folders-home').style.display = 'block';
    };

    function renderPlaylistsHome() {
        playlistCardsContainer.innerHTML = '';

        const favCard = document.createElement('div');
        favCard.className = 'playlist-card';
        const favCount = trackList.filter(t => t.isFavorite).length;
        favCard.innerHTML = `<div class="playlist-card-info"><h3>Favorites</h3><p>${favCount} tracks</p></div>`;
        favCard.onclick = () => openPlaylistDetail('favorites', 'Favorites');
        playlistCardsContainer.appendChild(favCard);

        customPlaylists.forEach(pl => {
            const card = document.createElement('div');
            card.className = 'playlist-card';
            const count = trackList.filter(t => pl.trackIds.includes(t.id)).length;
            card.innerHTML = `
                <div class="playlist-card-info flex-1-ml-8-ellipsis">
                    <h3 class="flex-1-ml-8-ellipsis" style="margin:0">${escapeHtml(pl.name)}</h3>
                    <p>${count} tracks</p>
                </div>
                <button class="icon-btn delete-pl-btn" title="Delete Playlist" style="padding: 6px; z-index: 2; flex-shrink:0; margin-left:12px;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            `;

            card.querySelector('.delete-pl-btn').onclick = async (e) => {
                e.stopPropagation();
                const confirmed = await showConfirm('Delete Playlist', `Are you sure you want to delete "${pl.name}"?`);
                if (confirmed) {
                    customPlaylists = customPlaylists.filter(p => p.id !== pl.id);
                    renderPlaylistsHome();
                }
            };

            card.onclick = () => openPlaylistDetail(pl.id, pl.name);
            playlistCardsContainer.appendChild(card);
        });
    }

    function renderFoldersHome() {
        const fc = $('folders-container');
        fc.innerHTML = '';

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
                <div class="playlist-card-info flex-1-ml-8-ellipsis">
                    <h3 class="flex-1-ml-8-ellipsis" style="margin:0">${escapeHtml(folder)}</h3>
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
                    if (trackList.length === 0) {
                        $('empty-state').style.display = 'flex';
                        $('search-bar').style.display = 'none';
                    }
                    sortAndRenderTracks();
                    renderFoldersHome();
                }
            };

            fCard.onclick = () => {
                activePlaylistId = 'folder_' + folder;
                $('folder-detail-title').textContent = folder;
                $('folders-home').style.display = 'none';
                $('folder-detail').style.display = 'block';
                sortAndRenderTracks();
            };
            fc.appendChild(fCard);
        });
    }

    function openPlaylistDetail(id, title) {
        activePlaylistId = id;
        $('playlist-detail-title').textContent = title;
        $('playlists-home').style.display = 'none';
        $('playlist-detail').style.display = 'block';
        sortAndRenderTracks();
    }

    const npArtCont = $('np-art-container');
    let npSwipeStartX = 0;
    let npSwipeCurrentX = 0;
    let npIsSwiping = false;

    const startSwipe = (x) => {
        npSwipeStartX = x;
        // FIX: previously npSwipeCurrentX kept its value from the LAST swipe.
        // A plain click/tap (mousedown then mouseup with no movement) never
        // updates npSwipeCurrentX via moveSwipe(), so endSwipe() was computing
        // its "diff" against a stale, leftover coordinate from a previous
        // swipe - which could accidentally exceed the 80px threshold and
        // skip to the next/previous track on a simple click of the album art.
        npSwipeCurrentX = x;
        npIsSwiping = true;
        npArtCont.style.transition = 'none';
    };

    const moveSwipe = (x) => {
        if (!npIsSwiping) return;
        npSwipeCurrentX = x;
        const diff = npSwipeCurrentX - npSwipeStartX;
        npArtCont.style.transform = `translateX(${diff * 0.8}px)`;
    };

    const endSwipe = () => {
        if (!npIsSwiping) return;
        npIsSwiping = false;
        const diff = npSwipeCurrentX - npSwipeStartX;
        npArtCont.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)';

        if (diff > 80) {
            npArtCont.style.transform = `translateX(120vw)`;
            setTimeout(() => {
                playPrev();
                npArtCont.style.transition = 'none';
                npArtCont.style.transform = `translateX(-120vw)`;
                setTimeout(() => {
                    npArtCont.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)';
                    npArtCont.style.transform = `translateX(0)`;
                }, 50);
            }, 300);
        } else if (diff < -80) {
            npArtCont.style.transform = `translateX(-120vw)`;
            setTimeout(() => {
                playNext();
                npArtCont.style.transition = 'none';
                npArtCont.style.transform = `translateX(120vw)`;
                setTimeout(() => {
                    npArtCont.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)';
                    npArtCont.style.transform = `translateX(0)`;
                }, 50);
            }, 300);
        } else {
            npArtCont.style.transform = `translateX(0)`;
            // A plain tap (no real horizontal drag) toggles the lyrics
            // panel, which now sits above the album art.
            if (Math.abs(diff) < 10) {
                $('np-lyrics-section').classList.toggle('np-lyrics-hidden');
            }
        }
    };

    npArtCont.addEventListener('touchstart', (e) => startSwipe(e.touches[0].clientX), { passive: true });
    npArtCont.addEventListener('touchmove', (e) => moveSwipe(e.touches[0].clientX), { passive: true });
    npArtCont.addEventListener('touchend', endSwipe);

    npArtCont.addEventListener('mousedown', (e) => startSwipe(e.clientX));
    document.addEventListener('mousemove', (e) => { if (npIsSwiping) moveSwipe(e.clientX); });
    document.addEventListener('mouseup', endSwipe);

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

        // FIX: setting textContent directly (bare text node, no <p> wrapper)
        // vs. innerHTML with a <p> for the placeholder meant the two states
        // had different box models - the bare-text state had no element to
        // apply consistent padding/line-height to, which combined with the
        // missing min-height in CSS is what collapsed it to one line.
        // Both branches now consistently wrap content in a <p>.
        if (t.lyrics) {
            $('np-lyrics-display').innerHTML = `<p>${escapeHtml(t.lyrics).replace(/\n/g, '<br>')}</p>`;
        } else {
            $('np-lyrics-display').innerHTML =
                '<p class="lyrics-placeholder">Tap the icon to load a .lrc file, or add lyrics below.</p>';
        }
        $('np-lyrics-display').style.display = 'flex';
        $('np-lyrics-editor').style.display = 'none';
    }

    $('btn-close-np').onclick = closeNowPlayingOverlay;

    // FIX/NEW: desktop click-and-drag-down-to-close on the overlay content
    // itself, mirroring the mobile touch swipe-down that already existed.
    // Scoped away from interactive children (buttons, inputs, sliders,
    // lyrics box, art container which has its own prev/next swipe) so it
    // only triggers when dragging empty space.
    const npContent = $('np-overlay-content');
    let npDesktopDragStartY = 0;
    let npDesktopDragging = false;

    const isDragBlockedTarget = (target) =>
        target.closest('.np-lyrics-display') ||
        target.closest('.np-lyrics-editor') ||
        target.closest('.np-art-container') ||
        target.closest('input') ||
        target.closest('button') ||
        target.closest('textarea');

    npContent.addEventListener('mousedown', (e) => {
        if (isDragBlockedTarget(e.target)) return;
        npDesktopDragStartY = e.clientY;
        npDesktopDragging = true;
        overlay.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!npDesktopDragging) return;
        const diff = e.clientY - npDesktopDragStartY;
        if (diff > 0) {
            overlay.style.transform = `translateY(${diff}px)`;
        }
    });

    document.addEventListener('mouseup', (e) => {
        if (!npDesktopDragging) return;
        npDesktopDragging = false;
        overlay.style.transition = 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)';
        const diff = e.clientY - npDesktopDragStartY;
        if (diff > 100) {
            closeNowPlayingOverlay();
        }
        overlay.style.transform = '';
    });

    $('btn-load-lyrics').onclick = () => $('lyrics-input').click();

    $('lyrics-input').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // Guard against OS pickers that allow "All Files" to bypass accept=.
        if (!/\.(lrc|txt)$/i.test(file.name)) {
            showToast('Please select a .lrc or .txt file.', 'error');
            e.target.value = '';
            return;
        }
        const reader = new FileReader();

        reader.onload = () => {
            let text = parseLRC(reader.result);
            if (currentTrackIndex >= 0 && trackList[currentTrackIndex]) trackList[currentTrackIndex].lyrics = text;
            $('np-lyrics-display').innerHTML = `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
            $('np-lyrics-display').style.display = 'flex';
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
            if (currentTrackIndex >= 0 && trackList[currentTrackIndex]) trackList[currentTrackIndex].lyrics = newLyrics;
            display.innerHTML = newLyrics
                ? `<p>${escapeHtml(newLyrics).replace(/\n/g, '<br>')}</p>`
                : '<p class="lyrics-placeholder">No lyrics loaded.</p>';
            display.style.display = 'flex';
            editor.style.display = 'none';
            $('btn-edit-lyrics').textContent = 'Edit Lyrics';
        }
    };

    const updateTitleScroll = () => {
        const el = $('now-playing-title');
        el.classList.remove('scrolling-text');
        el.style.display = 'inline-block';
        const isOverflowing = el.scrollWidth > el.parentElement.clientWidth;
        if (isOverflowing) el.classList.add('scrolling-text');
    };

    // FIX: playTrack() used to set audio.src + audio.load() directly AND
    // THEN call wavesurfer.load() on the very same shared <audio> element
    // (WaveSurfer was created with `media: audio`). Both were racing to set
    // the element's source; WaveSurfer's async decode step could finish
    // AFTER our own audio.play() had already started, silently resetting
    // the element and killing playback a fraction of a second in - that's
    // the "plays for a second then stops, have to hit play/pause again" bug.
    // Now only ONE thing loads the shared element: WaveSurfer when present,
    // native audio.load() as a fallback otherwise.
    async function playTrack(idx) {
        if (idx < 0 || idx >= trackList.length) return;
        currentTrackIndex = idx;
        const t = trackList[idx];

        audio.pause();

        let loadedByWavesurfer = false;
        if (wavesurfer) {
            try {
                await wavesurfer.load(t.url);
                loadedByWavesurfer = true;
            } catch (err) {
                console.warn('WaveSurfer failed to load track, falling back to native audio element', err);
            }
        }
        if (!loadedByWavesurfer) {
            audio.src = t.url;
            audio.load();
        }

        // FIX: this is the "settings forgotten on new track" bug. Loading a
        // new source (whether via WaveSurfer re-attaching to the shared
        // <audio> element, or a plain audio.load()) resets playbackRate to
        // 1.0 on most browsers. The old code set playbackRate BEFORE the
        // load happened, so the reset always won and the track played at
        // normal speed/pitch until you touched a slider (which re-applied
        // the value after load had already settled). We now re-apply every
        // playback-affecting setting AFTER the new source is attached, and
        // again once metadata is confirmed loaded as a safety net for
        // browsers that reset it a second time on the loadedmetadata event.
        const reapplyPlaybackSettings = () => {
            audio.playbackRate = parseFloat($('sl-tempo').value) || 1.0;
            audio.preservesPitch = false;
            audio.mozPreservesPitch = false;
            audio.webkitPreservesPitch = false;
            updatePitchShift();
        };
        reapplyPlaybackSettings();
        audio.addEventListener('loadedmetadata', reapplyPlaybackSettings, { once: true });

        await initAudioContext();
        routeAudio();

        nowPlayingTitle.textContent = t.title;
        requestAnimationFrame(() => updateTitleScroll());

        document.querySelectorAll('.song-item').forEach(i => i.classList.remove('active-track'));
        if (t.element) {
            t.element.classList.add('active-track');
            const ind = t.element.querySelector('.playing-indicator');
            if (ind) ind.innerHTML = playIndicatorSvg;
        }
        $('btn-download').disabled = false;

        try {
            await audio.play();
            reapplyPlaybackSettings();
            setPlayState(true);
        } catch (e) {
            console.log(e);
            setPlayState(false);
        }

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
        if (ambienceEnabled) {
            p ? playActiveAmbience() : pauseAllAmbience();
        }
    }

    audio.ontimeupdate = () => {
        if (audio.duration) {
            const progress = (audio.currentTime / audio.duration) * 1000;
            progressBar.value = progress;
            npProgressBar.value = progress;
            const timeStr = formatTime(audio.currentTime);
            currentTimeEl.textContent = timeStr;
            npCurrentTimeEl.textContent = timeStr;
        }
    };
    audio.onloadedmetadata = () => {
        const totalStr = formatTime(audio.duration);
        totalTimeEl.textContent = totalStr;
        npTotalTimeEl.textContent = totalStr;
    };

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
            npProgressBar.value = 0;
        }
    };

    // FIX v2: the previous version treated EVERY 'error' event as fatal and
    // immediately skipped to the next track. But audio.pause() + audio.load()
    // on a new src reliably fires a transient MEDIA_ERR_ABORTED error on many
    // browsers/local servers (including VS Code Live Server) even when the
    // file is completely fine and plays correctly a moment later. That
    // false-positive was cascading through every track in the folder,
    // which is why all 7 sample tracks reported "could not play".
    // We now inspect the actual error code and only treat SRC_NOT_SUPPORTED
    // or NETWORK errors as fatal; ABORTED errors (interruptions from
    // switching tracks) are ignored.
    let stallWatchdog = null;
    let loadToken = 0;

    audio.onerror = () => {
        clearTimeout(stallWatchdog);
        const err = audio.error;
        if (!err) return;
        // MEDIA_ERR_ABORTED (1) fires whenever a load is interrupted by a
        // new src/load() call - not a real failure, ignore it.
        if (err.code === MediaError.MEDIA_ERR_ABORTED) return;
        const t = trackList[currentTrackIndex];
        showToast(`Couldn't play "${t ? t.title : 'track'}" - skipping.`, 'error');
        setPlayState(false);
        if (trackList.length > 1) {
            setTimeout(() => playNext(), 300);
        }
    };

    audio.onstalled = () => {
        clearTimeout(stallWatchdog);
        const myToken = ++loadToken;
        stallWatchdog = setTimeout(() => {
            // Only act if we're still waiting on the SAME load attempt and
            // genuinely never got any data - prevents false positives when
            // playback already succeeded or the user moved to another track.
            if (myToken === loadToken && !audio.currentTime && isPlaying && audio.readyState < 2) {
                const t = trackList[currentTrackIndex];
                showToast(`"${t ? t.title : 'Track'}" failed to load - skipping.`, 'error');
                playNext();
            }
        }, 8000);
    };

    audio.oncanplay = () => {
        clearTimeout(stallWatchdog);
        loadToken++;
    };

    progressBar.oninput = e => {
        if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration;
    };
    npProgressBar.oninput = e => {
        if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration;
    };

    function playNext() {
        if (nextUpQueue.length > 0) {
            const nextId = nextUpQueue.shift();
            const nextIdx = trackList.findIndex(t => t.id === nextId);
            if (nextIdx !== -1) {
                playTrack(nextIdx);
                return;
            }
        }

        if (trackList.length) {
            playTrack(shuffleMode ? Math.floor(Math.random() * trackList.length) : (currentTrackIndex + 1) % trackList.length);
        }
    }

    function playPrev() {
        if (trackList.length) {
            playTrack(audio.currentTime > 3 ? currentTrackIndex : (shuffleMode ? Math.floor(Math.random() * trackList.length) : (currentTrackIndex - 1 + trackList.length) % trackList.length));
        }
    }

    function formatTime(s) {
        if (!isFinite(s)) return '0:00';
        const m = Math.floor(s / 60),
            sec = Math.floor(s % 60).toString().padStart(2, '0'); return `${m}:${sec}`;
    }

    const toggleShuffle = () => {
        shuffleMode = !shuffleMode;
        document.querySelectorAll('.btn-shuffle, .np-btn-shuffle').forEach(btn => btn.classList.toggle('active', shuffleMode));
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
    }
    drawVisualizer();

    window.addEventListener('resize', () => { updateTitleScroll(); });

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
                buffer = await trackList[currentTrackIndex].file.arrayBuffer();
            } else {
                const response = await fetch(trackList[currentTrackIndex].url);
                if (!response.ok) throw new Error("Failed to fetch audio file");
                buffer = await response.arrayBuffer();
            }

            const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
            const decoded = await tempCtx.decodeAudioData(buffer);
            const length = (decoded.length / audio.playbackRate) + (fx.reverb || fx.echo || fx.eightD ? tempCtx.sampleRate * 5 : 0);
            const offCtx = new OfflineAudioContext(decoded.numberOfChannels, length, tempCtx.sampleRate);
            const src = offCtx.createBufferSource();
            src.buffer = decoded;
            src.playbackRate.value = audio.playbackRate;

            let curr = src;

            if (fx.warmth) {
                const oWarmthFilter = offCtx.createBiquadFilter();
                oWarmthFilter.type = 'lowshelf';
                oWarmthFilter.frequency.value = 250;
                oWarmthFilter.gain.value = nodes.warmthFilter.gain.value;

                const oWarmthShaper = offCtx.createWaveShaper();
                oWarmthShaper.oversample = '4x';
                oWarmthShaper.curve = nodes.warmthShaper.curve;

                const oWarmthHighCut = offCtx.createBiquadFilter();
                oWarmthHighCut.type = 'highshelf';
                oWarmthHighCut.frequency.value = 8000;
                oWarmthHighCut.gain.value = nodes.warmthHighCut.gain.value;

                curr.connect(oWarmthFilter);
                oWarmthFilter.connect(oWarmthShaper);
                oWarmthShaper.connect(oWarmthHighCut);
                curr = oWarmthHighCut;
            }

            if (fx.preamp) {
                const oPre = offCtx.createGain();
                oPre.gain.value = nodes.preampGain.gain.value;
                curr.connect(oPre);
                curr = oPre;
            }

            if (fx.clarity) {
                const oBass = offCtx.createBiquadFilter();
                oBass.type = 'lowshelf'; oBass.frequency.value = 60; oBass.gain.value = 1.5;
                const oMud = offCtx.createBiquadFilter();
                oMud.type = 'peaking'; oMud.frequency.value = 250; oMud.Q.value = 0.8; oMud.gain.value = -1.5;
                const oDetail = offCtx.createBiquadFilter();
                oDetail.type = 'peaking'; oDetail.frequency.value = 4000; oDetail.Q.value = 0.5; oDetail.gain.value = -1.0;
                const oAir = offCtx.createBiquadFilter();
                oAir.type = 'highshelf'; oAir.frequency.value = 12000; oAir.gain.value = 2.0;
                curr.connect(oBass); oBass.connect(oMud); oMud.connect(oDetail); oDetail.connect(oAir);
                curr = oAir;
            }

            if (fx.eightD) {
                const oPanner = offCtx.createStereoPanner();
                const oLfo = offCtx.createOscillator();
                oLfo.type = 'sine'; oLfo.frequency.value = parseFloat($('sl-8d-speed').value);
                const oGain = offCtx.createGain();
                oGain.gain.value = parseFloat($('sl-8d-width').value) / 100;
                oLfo.connect(oGain); oGain.connect(oPanner.pan); oLfo.start(0);
                const eightDRoot = offCtx.createGain();
                curr.connect(oPanner);
                const revGain = offCtx.createGain();
                const mix = parseFloat($('sl-8d-rev').value) / 100;
                if (nodes.revConvolver && nodes.revConvolver.buffer) {
                    const oConv = offCtx.createConvolver();
                    oConv.buffer = nodes.revConvolver.buffer;
                    oPanner.connect(oConv); oConv.connect(revGain);
                    revGain.gain.value = mix * 1.5;
                }
                const dryGain = offCtx.createGain();
                dryGain.gain.value = 1.0 - (mix * 0.5);
                oPanner.connect(dryGain); dryGain.connect(eightDRoot); revGain.connect(eightDRoot);
                curr = eightDRoot;
            }

            if (fx.reverb && nodes.revConvolver && nodes.revConvolver.buffer) {
                const oConv = offCtx.createConvolver();
                oConv.buffer = nodes.revConvolver.buffer;
                const oDry = offCtx.createGain(); oDry.gain.value = nodes.revDry.gain.value;
                const oWet = offCtx.createGain(); oWet.gain.value = nodes.revWet.gain.value;
                curr.connect(oDry); curr.connect(oConv); oConv.connect(oWet);
                oDry.connect(offCtx.destination); oWet.connect(offCtx.destination);
            } else {
                const oMasterGain = offCtx.createGain(); oMasterGain.gain.value = 1.0;
                curr.connect(oMasterGain); oMasterGain.connect(offCtx.destination);
            }

            src.start(0);
            const rendered = await offCtx.startRendering();
            clearInterval(progInterval);
            btn.style.setProperty('--dl-progress', '100%');

            let nCh = rendered.numberOfChannels;

            if (exportFormat === 'mp3' && window.lamejs) {
                const lameEnc = new lamejs.Mp3Encoder(nCh, rendered.sampleRate, 192);
                const mp3Data = [];
                const samples = rendered.length;
                const sampleBlockSize = 1152;
                let left = rendered.getChannelData(0);
                let right = nCh > 1 ? rendered.getChannelData(1) : left;
                let leftInt = new Int16Array(samples);
                let rightInt = new Int16Array(samples);

                for (let i = 0; i < samples; i++) {
                    leftInt[i] = left[i] < 0 ? left[i] * 32768 : left[i] * 32767;
                    rightInt[i] = right[i] < 0 ? right[i] * 32768 : right[i] * 32767;
                }

                for (let i = 0; i < samples; i += sampleBlockSize) {
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
            } else {
                let len = rendered.length * nCh * 2 + 44,
                    out = new ArrayBuffer(len),
                    view = new DataView(out),
                    chs = [], offset = 0, pos = 0;

                const set16 = d => { view.setUint16(pos, d, true); pos += 2; };
                const set32 = d => { view.setUint32(pos, d, true); pos += 4; };

                set32(0x46464952); set32(len - 8); set32(0x45564157); set32(0x20746d66);
                set32(16); set16(1); set16(nCh); set32(rendered.sampleRate);
                set32(rendered.sampleRate * 2 * nCh); set16(nCh * 2); set16(16);
                set32(0x61746164); set32(len - pos - 4);
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

// Block Access Start
(function () {
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.onkeydown = function (e) {
        if (e.keyCode === 123 ||
            (e.ctrlKey && e.shiftKey && e.keyCode === 73) ||
            (e.ctrlKey && e.shiftKey && e.keyCode === 67) ||
            (e.ctrlKey && e.shiftKey && e.keyCode === 74) ||
            (e.ctrlKey && e.keyCode === 85)) {
            return false;
        }
    };
    setInterval(() => {
        const threshold = 160;
        const widthThreshold = window.outerWidth - window.innerWidth > threshold;
        const heightThreshold = window.outerHeight - window.innerHeight > threshold;
        if (widthThreshold || heightThreshold) {
            console.log("%cStop!", "color: red; font-size: 50px; font-weight: bold;");
            debugger;
        }
    }, 1000);
})();
// Block Access End