// ==========================================
// script.js — Native True Bypass DSP Engine
// Fixed: All 6 assets on mobile, download for URL tracks, viewport stability
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const body = document.body;

    // UI Connections
    const views = { 'songs-view': $('songs-view'), 'effects-panel': $('effects-panel') };
    const songListContainer = $('song-list');
    const emptyState = $('empty-state');
    const searchBar = $('search-bar');
    const nowPlayingTitle = $('now-playing-title');
    const progressBar = $('progress-bar');
    const currentTimeEl = $('current-time');
    const totalTimeEl = $('total-time');
    const playIcon = $('play-icon');
    const pauseIcon = $('pause-icon');
    const visualizerCanvas = $('visualizer');
    const visualizerCtx = visualizerCanvas.getContext('2d');

    // System States
    let trackList = [];
    let currentTrackIndex = -1;
    let isPlaying = false;
    let shuffleMode = false;
    let repeatMode = 'off';

    // ── MATERIAL YOU COLOR INFRASTRUCTURE ──
    const colorPalette = [
        '#6BA661', '#601515', '#A67A19', '#949494', '#325788',
        '#BEB5AB', '#CB1E1E', '#34806D', '#333333', '#57612C'
    ];

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

    // Default Fallback Swapped to #6BA661
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

    // ── SWIPE GESTURES FOR MOBILE NAVIGATION ──
    let touchStartX = 0;
    let touchStartY = 0;
    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    document.addEventListener('touchend', e => {
        let touchEndX = e.changedTouches[0].screenX;
        let touchEndY = e.changedTouches[0].screenY;
        let diffX = touchEndX - touchStartX;
        let diffY = touchEndY - touchStartY;

        // Ensure it's a horizontal swipe, not vertical scrolling
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
            const isDrawerOpen = $('drawer').classList.contains('open');
            const activeTab = document.querySelector('.tabs button.active').dataset.view;

            if (diffX > 0) { // Swiped Right
                if (isDrawerOpen) return;
                if (activeTab === 'effects-panel') {
                    document.querySelector('.tabs button[data-view="songs-view"]').click();
                } else if (activeTab === 'songs-view') {
                    $('btn-menu').click(); // Open Menu
                }
            } else { // Swiped Left
                if (isDrawerOpen) {
                    $('btn-close-drawer').click(); // Close Menu
                } else if (activeTab === 'songs-view') {
                    document.querySelector('.tabs button[data-view="effects-panel"]').click();
                }
            }
        }
    }, { passive: true });

    // Sidebar Layout Controls
    $('btn-menu').onclick = () => { $('drawer').classList.add('open'); $('drawer-overlay').classList.remove('hidden'); };
    const cancelDrawer = () => { $('drawer').classList.remove('open'); $('drawer-overlay').classList.add('hidden'); };
    $('btn-close-drawer').onclick = cancelDrawer;
    $('drawer-overlay').onclick = cancelDrawer;

    document.querySelectorAll('.tabs button').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.tabs button').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            Object.values(views).forEach(v => v.classList.remove('active-view'));
            views[tab.dataset.view].classList.add('active-view');
        };
    });

    document.querySelectorAll('.expandable .fx-header').forEach(header => {
        header.onclick = (e) => {
            if (e.target.closest('.switch') || e.target.closest('.reset-btn')) return;
            header.parentElement.classList.toggle('open');
        };
    });

    // Search Filtering
    $('search-input').oninput = e => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.song-item').forEach(item => {
            item.style.display = item.innerText.toLowerCase().includes(q) ? 'flex' : 'none';
        });
    };

    // ── NATIVE AUDIO ENGINE GRAPH ASSEMBLY ──
    const audio = new Audio();
    audio.preservesPitch = true;

    let audioCtx, sourceNode, analyserNode;

    const fx = {
        clarity: false, eq: false, vocal: false, comp: false, limit: false,
        echo: false, flanger: false, reverb: false, mono: false, invert: false
    };

    let nodes = {};

    async function initAudioContext() {
        if (audioCtx) {
            if (audioCtx.state === 'suspended') await audioCtx.resume();
            return;
        }
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        sourceNode = audioCtx.createMediaElementSource(audio);
        analyserNode = audioCtx.createAnalyser();
        analyserNode.fftSize = 256;

        buildEffectNodes(audioCtx);
        routeAudio();
        generateReverbIR();
    }

    function buildEffectNodes(ctx) {
        nodes.masterGain = ctx.createGain();
        nodes.masterGain.gain.value = 0.95;

        // 1. Clearity+ 
        nodes.clrMudCut = ctx.createBiquadFilter();
        nodes.clrMudCut.type = 'peaking'; nodes.clrMudCut.frequency.value = 250; nodes.clrMudCut.Q.value = 0.8; nodes.clrMudCut.gain.value = -2.5;
        nodes.clrAirBoost = ctx.createBiquadFilter();
        nodes.clrAirBoost.type = 'highshelf'; nodes.clrAirBoost.frequency.value = 8000; nodes.clrAirBoost.gain.value = 3.5;
        nodes.clrComp = ctx.createDynamicsCompressor();
        nodes.clrComp.threshold.value = -10; nodes.clrComp.ratio.value = 2.5; nodes.clrComp.attack.value = 0.01; nodes.clrComp.release.value = 0.1;
        nodes.clrMudCut.connect(nodes.clrAirBoost); nodes.clrAirBoost.connect(nodes.clrComp);

        // 2. Pitch Shift
        nodes.pitchIn = ctx.createGain(); nodes.pitchOut = ctx.createGain();
        nodes.pitchDelay1 = ctx.createDelay(1.0); nodes.pitchDelay2 = ctx.createDelay(1.0);
        nodes.pitchDelay1.delayTime.value = 0.1; nodes.pitchDelay2.delayTime.value = 0.1;
        nodes.pitchGain1 = ctx.createGain(); nodes.pitchGain2 = ctx.createGain();
        nodes.pitchModLfo = ctx.createOscillator(); nodes.pitchModLfo.type = 'sawtooth'; nodes.pitchModLfo.frequency.value = 4.5;
        nodes.pitchModGain = ctx.createGain(); nodes.pitchModGain.gain.value = 0.0;
        nodes.pitchModLfo.connect(nodes.pitchModGain); nodes.pitchModGain.connect(nodes.pitchDelay1.delayTime);
        nodes.pitchIn.connect(nodes.pitchDelay1); nodes.pitchDelay1.connect(nodes.pitchGain1); nodes.pitchGain1.connect(nodes.pitchOut);
        nodes.pitchIn.connect(nodes.pitchDelay2); nodes.pitchDelay2.connect(nodes.pitchGain2); nodes.pitchGain2.connect(nodes.pitchOut);
        nodes.pitchModLfo.start();

        // 3. EQ
        nodes.eq = [ctx.createBiquadFilter(), ctx.createBiquadFilter(), ctx.createBiquadFilter(), ctx.createBiquadFilter()];
        nodes.eq[0].type = 'lowshelf'; nodes.eq[0].frequency.value = 100;
        nodes.eq[1].type = 'peaking'; nodes.eq[1].frequency.value = 500; nodes.eq[1].Q.value = 1.0;
        nodes.eq[2].type = 'peaking'; nodes.eq[2].frequency.value = 2500; nodes.eq[2].Q.value = 1.0;
        nodes.eq[3].type = 'highshelf'; nodes.eq[3].frequency.value = 8000;
        nodes.eq[0].connect(nodes.eq[1]); nodes.eq[1].connect(nodes.eq[2]); nodes.eq[2].connect(nodes.eq[3]);

        // 4. Compressor
        nodes.comp = ctx.createDynamicsCompressor(); updateCompParams();

        // 5. Limiter
        nodes.limit = ctx.createDynamicsCompressor();
        nodes.limit.ratio.value = 20; nodes.limit.attack.value = 0.001; nodes.limit.knee.value = 0;
        updateLimiterParams();

        // 6. Echo
        nodes.echoIn = ctx.createGain(); nodes.echoOut = ctx.createGain();
        nodes.echoDry = ctx.createGain(); nodes.echoWet = ctx.createGain();
        nodes.echoDelay = ctx.createDelay(2.0); nodes.echoFb = ctx.createGain();
        nodes.echoIn.connect(nodes.echoDry); nodes.echoIn.connect(nodes.echoDelay);
        nodes.echoDelay.connect(nodes.echoFb); nodes.echoFb.connect(nodes.echoDelay);
        nodes.echoDelay.connect(nodes.echoWet); nodes.echoDry.connect(nodes.echoOut); nodes.echoWet.connect(nodes.echoOut);
        updateEchoParams();

        // 7. Flanger
        nodes.flangIn = ctx.createGain(); nodes.flangOut = ctx.createGain();
        nodes.flangDelay = ctx.createDelay(1.0); nodes.flangFb = ctx.createGain();
        nodes.flangLfo = ctx.createOscillator(); nodes.flangLfo.type = 'sine'; nodes.flangLfoGain = ctx.createGain();
        nodes.flangLfo.connect(nodes.flangLfoGain); nodes.flangLfoGain.connect(nodes.flangDelay.delayTime); nodes.flangLfo.start();
        nodes.flangIn.connect(nodes.flangOut); nodes.flangIn.connect(nodes.flangDelay);
        nodes.flangDelay.connect(nodes.flangFb); nodes.flangFb.connect(nodes.flangDelay); nodes.flangDelay.connect(nodes.flangOut);
        updateFlangerParams();

        // 8. Mon/Inv
        nodes.mono = ctx.createChannelMerger(1);
        nodes.invSplit = ctx.createChannelSplitter(2); nodes.invMerge = ctx.createChannelMerger(2);
        nodes.invSplit.connect(nodes.invMerge, 0, 1); nodes.invSplit.connect(nodes.invMerge, 1, 0);

        // 9. Vocal Reducer
        nodes.vocSplit = ctx.createChannelSplitter(2); nodes.vocMerge = ctx.createChannelMerger(2);
        nodes.vocInvert = ctx.createGain(); nodes.vocInvert.gain.value = -1;
        nodes.vocSplit.connect(nodes.vocMerge, 0, 0); nodes.vocSplit.connect(nodes.vocMerge, 0, 1);
        nodes.vocSplit.connect(nodes.vocInvert, 1);
        nodes.vocInvert.connect(nodes.vocMerge, 0, 0); nodes.vocInvert.connect(nodes.vocMerge, 0, 1);

        // 10. Reverb
        nodes.revIn = ctx.createGain(); nodes.revOut = ctx.createGain();
        nodes.revDry = ctx.createGain(); nodes.revWet = ctx.createGain();
        nodes.revPreDelay = ctx.createDelay(1.0); nodes.revConvolver = ctx.createConvolver();
        nodes.revLowCut = ctx.createBiquadFilter(); nodes.revLowCut.type = 'highpass';
        nodes.revWidth = createStereoWidthNode(ctx);

        nodes.revIn.connect(nodes.revDry); nodes.revIn.connect(nodes.revPreDelay);
        nodes.revPreDelay.connect(nodes.revConvolver); nodes.revConvolver.connect(nodes.revLowCut);
        nodes.revLowCut.connect(nodes.revWidth.input); nodes.revWidth.output.connect(nodes.revWet);
        nodes.revDry.connect(nodes.revOut); nodes.revWet.connect(nodes.revOut);
        updateReverbParams();
    }

    function routeAudio() {
        if (!audioCtx) return;
        sourceNode.disconnect();
        if (nodes.pitchOut) nodes.pitchOut.disconnect();
        if (nodes.clrComp) nodes.clrComp.disconnect();
        if (nodes.eq) nodes.eq[3].disconnect();
        if (nodes.vocMerge) nodes.vocMerge.disconnect();
        if (nodes.mono) nodes.mono.disconnect();
        if (nodes.invMerge) nodes.invMerge.disconnect();
        if (nodes.flangOut) nodes.flangOut.disconnect();
        if (nodes.echoOut) nodes.echoOut.disconnect();
        if (nodes.revOut) nodes.revOut.disconnect();
        if (nodes.comp) nodes.comp.disconnect();
        if (nodes.limit) nodes.limit.disconnect();

        let curr = sourceNode;

        const pitchVal = parseFloat($('sl-pitch').value);
        if (pitchVal !== 0) {
            curr.connect(nodes.pitchIn);
            curr = nodes.pitchOut;
        }

        if (fx.clarity) { curr.connect(nodes.clrMudCut); curr = nodes.clrComp; }
        if (fx.eq) { curr.connect(nodes.eq[0]); curr = nodes.eq[3]; }
        if (fx.vocal) { curr.connect(nodes.vocSplit); curr = nodes.vocMerge; }
        if (fx.mono) { curr.connect(nodes.mono); curr = nodes.mono; }
        if (fx.invert) { curr.connect(nodes.invSplit); curr = nodes.invMerge; }
        if (fx.flanger) { curr.connect(nodes.flangIn); curr = nodes.flangOut; }
        if (fx.echo) { curr.connect(nodes.echoIn); curr = nodes.echoOut; }
        if (fx.reverb) { curr.connect(nodes.revIn); curr = nodes.revOut; }
        if (fx.comp) { curr.connect(nodes.comp); curr = nodes.comp; }
        if (fx.limit) { curr.connect(nodes.limit); curr = nodes.limit; }

        curr.connect(analyserNode);
        analyserNode.connect(nodes.masterGain);
        nodes.masterGain.connect(audioCtx.destination);
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

    async function generateReverbIR() {
        if (!audioCtx) return;
        const decay = parseFloat($('sl-rev-room').value) / 100 * 5 + 0.1;
        const dampPct = parseFloat($('sl-rev-damp').value) / 100;
        const dampFreq = 20000 - (dampPct * 18000);
        const rate = audioCtx.sampleRate, length = rate * decay;
        const offCtx = new OfflineAudioContext(2, length, rate);
        const noise = offCtx.createBuffer(2, length, rate);
        for (let c = 0; c < 2; c++) {
            let data = noise.getChannelData(c);
            for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay * 2);
        }
        const src = offCtx.createBufferSource(); src.buffer = noise;
        const filter = offCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = dampFreq;
        src.connect(filter); filter.connect(offCtx.destination);
        src.start();
        nodes.revConvolver.buffer = await offCtx.startRendering();
    }

    function updatePitchShift() {
        if (!audioCtx) return;
        const semitones = parseFloat($('sl-pitch').value);
        nodes.pitchModGain.gain.value = (semitones / 12) * 0.025;
        nodes.pitchGain1.gain.value = semitones !== 0 ? 0.7 : 1.0;
        nodes.pitchGain2.gain.value = semitones !== 0 ? 0.7 : 0.0;
    }
    function updateReverbParams() {
        if (!audioCtx) return;
        const wet = parseFloat($('sl-rev-wet').value) / 100;
        nodes.revWet.gain.value = wet; nodes.revDry.gain.value = 1 - (wet * 0.5);
        nodes.revWidth.setWidth(parseFloat($('sl-rev-stereo').value) / 100);
        nodes.revPreDelay.delayTime.value = parseFloat($('sl-rev-pre').value) / 1000;
        nodes.revLowCut.frequency.value = parseFloat($('sl-rev-low').value);
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
        nodes.echoWet.gain.value = mix; nodes.echoDry.gain.value = 1 - (mix * 0.5);
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

    const toggleMap = {
        'tgl-clarity': 'clarity', 'tgl-eq': 'eq', 'tgl-vocal': 'vocal', 'tgl-comp': 'comp', 'tgl-limit': 'limit',
        'tgl-echo': 'echo', 'tgl-flanger': 'flanger', 'tgl-reverb': 'reverb', 'tgl-mono': 'mono', 'tgl-invert': 'invert'
    };
    Object.keys(toggleMap).forEach(id => {
        $(id).onchange = e => { fx[toggleMap[id]] = e.target.checked; routeAudio(); };
    });

    $('res-speed').onclick = () => {
        $('sl-tempo').value = 1.0; audio.playbackRate = 1.0; $('val-tempo').textContent = '1.00x';
        $('sl-pitch').value = 0; updatePitchShift(); $('val-pitch').textContent = '0.0';
        routeAudio();
    };
    $('res-clarity').onclick = () => { $('tgl-clarity').checked = false; fx.clarity = false; routeAudio(); };
    $('res-eq').onclick = () => {
        $('tgl-eq').checked = false; fx.eq = false; $('eq-preset').value = 'flat';
        ['low', 'lmid', 'hmid', 'high'].forEach((b, i) => {
            $(`sl-eq-${b}`).value = 0; $(`val-eq-${b}`).textContent = '0 dB';
            if (audioCtx) nodes.eq[i].gain.value = 0;
        });
        routeAudio();
    };
    $('res-comp').onclick = () => {
        $('tgl-comp').checked = false; fx.comp = false;
        $('sl-comp-thresh').value = -24; $('val-comp-thresh').textContent = '-24 dB';
        $('sl-comp-ratio').value = 12; $('val-comp-ratio').textContent = '12:1';
        $('sl-comp-att').value = 3; $('val-comp-att').textContent = '3 ms';
        $('sl-comp-rel').value = 250; $('val-comp-rel').textContent = '250 ms';
        updateCompParams(); routeAudio();
    };
    $('res-limit').onclick = () => {
        $('tgl-limit').checked = false; fx.limit = false;
        $('sl-lim-thresh').value = -2; $('val-lim-thresh').textContent = '-2 dB';
        $('sl-lim-rel').value = 50; $('val-lim-rel').textContent = '50 ms';
        updateLimiterParams(); routeAudio();
    };
    $('res-echo').onclick = () => {
        $('tgl-echo').checked = false; fx.echo = false;
        $('sl-echo-mix').value = 40; $('val-echo-mix').textContent = '40%';
        $('sl-echo-time').value = 330; $('val-echo-time').textContent = '330 ms';
        $('sl-echo-fb').value = 40; $('val-echo-fb').textContent = '40%';
        updateEchoParams(); routeAudio();
    };
    $('res-flanger').onclick = () => {
        $('tgl-flanger').checked = false; fx.flanger = false;
        $('sl-flang-rate').value = 0.5; $('val-flang-rate').textContent = '0.5 Hz';
        $('sl-flang-depth').value = 20; $('val-flang-depth').textContent = '20%';
        $('sl-flang-fb').value = 50; $('val-flang-fb').textContent = '50%';
        updateFlangerParams(); routeAudio();
    };
    $('res-reverb').onclick = () => {
        $('tgl-reverb').checked = false; fx.reverb = false;
        $('sl-rev-wet').value = 35; $('val-rev-wet').textContent = '35%';
        $('sl-rev-stereo').value = 100; $('val-rev-stereo').textContent = '100%';
        $('sl-rev-damp').value = 25; $('val-rev-damp').textContent = '25%';
        $('sl-rev-room').value = 75; $('val-rev-room').textContent = '75%';
        $('sl-rev-pre').value = 0; $('val-rev-pre').textContent = '0 ms';
        $('sl-rev-low').value = 10; $('val-rev-low').textContent = '10 Hz';
        updateReverbParams(); generateReverbIR(); routeAudio();
    };

    const eqPresets = { 'flat': [0, 0, 0, 0], 'bass': [6, 2, 0, 0], 'acoustic': [-2, 2, 4, 3] };
    $('eq-preset').onchange = (e) => {
        if (e.target.value === 'custom') return;
        const vals = eqPresets[e.target.value];
        ['low', 'lmid', 'hmid', 'high'].forEach((b, i) => {
            $(`sl-eq-${b}`).value = vals[i];
            $(`val-eq-${b}`).textContent = (vals[i] > 0 ? '+' : '') + vals[i] + ' dB';
            if (audioCtx) nodes.eq[i].gain.value = vals[i];
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
            $(valId).textContent = e.target.value + suffix;
            if (updater) updater();
            if (isIR) { clearTimeout(timer); timer = setTimeout(generateReverbIR, 300); }
        };
    };

    bindSlider('sl-tempo', 'val-tempo', 'x', () => { audio.playbackRate = parseFloat($('sl-tempo').value); $('val-tempo').textContent = parseFloat($('sl-tempo').value).toFixed(2) + 'x'; });
    bindSlider('sl-pitch', 'val-pitch', '', () => { updatePitchShift(); routeAudio(); });
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

    // ── ASSETS LOADER — FIXED: All 6 samples + directory scraping fallback ──
    async function loadDefaultAssets() {
        // Try directory scraping first (works with basic HTTP servers)
        try {
            const response = await fetch('assets/');
            if (response.ok) {
                const text = await response.text();
                // Aggressive regex to catch any valid audio link in the directory listing
                const matches = text.match(/href="([^"]+\.(mp3|wav|ogg|m4a|flac))"/gi);

                if (matches && matches.length > 0) {
                    let audioFiles = matches.map(m => m.split('"')[1]).map(f => f.split('/').pop());
                    audioFiles = [...new Set(audioFiles)]; // Distinct

                    trackList = audioFiles.map((filename, i) => ({
                        title: decodeURIComponent(filename.replace(/\.[^/.]+$/, '')),
                        artist: 'Assets Directory',
                        url: 'assets/' + filename,
                        file: null, duration: 0, index: i, element: null
                    }));

                    if (trackList.length > 0) {
                        searchBar.style.display = 'block';
                        emptyState.style.display = 'none';
                        sortAndRenderTracks();
                        return;
                    }
                }
            }
        } catch (e) {
            console.log("Directory scraping unavailable. Using built-in asset list.");
        }

        // FULL FALLBACK — all 6 samples explicitly listed (works everywhere including mobile)
        const allSamples = [
            'sample-1.mp3', 'sample-2.mp3', 'sample-3.mp3',
            'sample-4.mp3', 'sample-5.mp3', 'sample-6.mp3'
        ];

        trackList = allSamples.map((filename, i) => ({
            title: filename.replace(/\.[^/.]+$/, ''),
            artist: 'Assets Directory',
            url: 'assets/' + filename,
            file: null,
            duration: 0,
            index: i,
            element: null
        }));

        searchBar.style.display = 'block';
        emptyState.style.display = 'none';
        sortAndRenderTracks();
    }
    loadDefaultAssets();

    // ── FILE MANAGEMENT ──
    $('btn-open-folder').onclick = () => $('folder-input').click();
    $('folder-input').onchange = e => {
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('audio/'));
        if (!files.length) return alert('No audio files found.');

        trackList = files.map((file, i) => ({
            title: file.name.replace(/\.[^/.]+$/, ''), artist: 'Local File',
            url: URL.createObjectURL(file), file: file, duration: 0, index: i, element: null
        }));

        searchBar.style.display = 'block';
        emptyState.style.display = 'none';
        sortAndRenderTracks();
        cancelDrawer();
    };

    $('sort-select').onchange = sortAndRenderTracks;

    function sortAndRenderTracks() {
        trackList.sort((a, b) => $('sort-select').value === 'name-asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title));
        trackList.forEach((t, i) => t.index = i);
        songListContainer.innerHTML = '';

        trackList.forEach((track, idx) => {
            const item = document.createElement('div');
            item.className = 'song-item';
            item.innerHTML = `
                <div class="song-cover"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>
                <div class="song-info"><h3>${escapeHtml(track.title)}</h3><p>${escapeHtml(track.artist)}</p></div>
                <span class="song-duration">--:--</span>
            `;

            // Initialization + Play handled here
            item.onclick = async () => {
                await initAudioContext();
                if (currentTrackIndex === idx) togglePlay();
                else playTrack(idx);
            };

            songListContainer.appendChild(item);
            track.element = item;

            const temp = new Audio(track.url);
            temp.onloadedmetadata = () => {
                track.duration = temp.duration;
                const durEl = item.querySelector('.song-duration');
                if (durEl) durEl.textContent = formatTime(track.duration);
            };
            temp.onerror = () => {
                // If metadata fails to load, keep "--:--" but track is still playable
                const durEl = item.querySelector('.song-duration');
                if (durEl && durEl.textContent === '--:--') {
                    // Will update on actual play via onloadedmetadata on main audio
                }
            };
        });
    }

    function escapeHtml(t) { return t.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]); }

    // ── MEDIA PLAYER CONTROL CYCLE ──
    async function playTrack(idx) {
        if (idx < 0 || idx >= trackList.length) return;
        currentTrackIndex = idx;
        const t = trackList[idx];
        audio.src = t.url; audio.load();
        nowPlayingTitle.textContent = `${t.title}`;
        document.querySelectorAll('.song-item').forEach(i => i.classList.remove('active-track'));
        if (t.element) t.element.classList.add('active-track');

        // FIXED: Enable download for ALL tracks (URL-based assets AND uploaded files)
        $('btn-download').disabled = false;

        await initAudioContext();
        audio.play().then(() => setPlayState(true)).catch(e => console.log("Playback error or Default asset missing: ", e));
    }

    async function togglePlay() {
        if (!audio.src) return trackList.length ? playTrack(0) : null;
        await initAudioContext();
        isPlaying ? audio.pause() : audio.play();
        setPlayState(!isPlaying);
    }

    function setPlayState(p) {
        isPlaying = p;
        playIcon.style.display = p ? 'none' : 'block';
        pauseIcon.style.display = p ? 'block' : 'none';
    }

    audio.ontimeupdate = () => { if (audio.duration) { progressBar.value = (audio.currentTime / audio.duration) * 1000; currentTimeEl.textContent = formatTime(audio.currentTime); } };
    audio.onloadedmetadata = () => { totalTimeEl.textContent = formatTime(audio.duration); };
    audio.onended = () => {
        if (repeatMode === 'one') { audio.currentTime = 0; audio.play(); }
        else if (repeatMode === 'all' || currentTrackIndex < trackList.length - 1 || shuffleMode) playNext();
        else { setPlayState(false); audio.currentTime = 0; progressBar.value = 0; }
    };
    progressBar.oninput = e => { if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration; };

    function playNext() { if (trackList.length) playTrack(shuffleMode ? Math.floor(Math.random() * trackList.length) : (currentTrackIndex + 1) % trackList.length); }
    function playPrev() { if (trackList.length) playTrack(audio.currentTime > 3 ? currentTrackIndex : (shuffleMode ? Math.floor(Math.random() * trackList.length) : (currentTrackIndex - 1 + trackList.length) % trackList.length)); }
    function formatTime(s) { if (!isFinite(s)) return '0:00'; const m = Math.floor(s / 60), sec = Math.floor(s % 60).toString().padStart(2, '0'); return `${m}:${sec}`; }

    $('btn-play').onclick = togglePlay;
    $('btn-next').onclick = playNext;
    $('btn-prev').onclick = playPrev;
    $('btn-shuffle').onclick = () => { shuffleMode = !shuffleMode; $('btn-shuffle').classList.toggle('active', shuffleMode); };
    $('btn-repeat').onclick = () => { repeatMode = repeatMode === 'off' ? 'all' : (repeatMode === 'all' ? 'one' : 'off'); $('btn-repeat').classList.toggle('active', repeatMode !== 'off'); };

    // ── VISUALIZER ENGINE ──
    function drawVisualizer() {
        requestAnimationFrame(drawVisualizer);
        if (!analyserNode) return;
        const w = visualizerCanvas.width, h = visualizerCanvas.height, data = new Uint8Array(analyserNode.frequencyBinCount);
        analyserNode.getByteFrequencyData(data);
        visualizerCtx.clearRect(0, 0, w, h);

        visualizerCtx.fillStyle = getComputedStyle(body).getPropertyValue('--accent').trim();
        visualizerCtx.globalAlpha = 0.6;
        for (let i = 0; i < 64; i++) {
            let barH = Math.max(3, (data[i] / 255) * h);
            visualizerCtx.beginPath();
            visualizerCtx.roundRect(i * (w / 64), h - barH, (w / 64) - 2, barH, 4);
            visualizerCtx.fill();
        }
        visualizerCtx.globalAlpha = 1.0;
    }
    drawVisualizer();

    // ── HIGH-FIDELITY OFFLINE EXPORT (FIXED: Works for URL-based assets too) ──
    $('btn-download').onclick = async () => {
        if (currentTrackIndex < 0) return;

        const track = trackList[currentTrackIndex];
        const pitchVal = parseFloat($('sl-pitch').value);

        // Quick export: no effects, no pitch shift, normal speed → direct download
        const hasActiveFx = Object.values(fx).some(v => v);
        if (!hasActiveFx && audio.playbackRate === 1.0 && pitchVal === 0) {
            // For URL-based tracks, fetch and re-serve; for File-based, use blob URL
            if (track.file) {
                const a = document.createElement('a');
                a.href = track.url;
                a.download = track.file.name;
                a.click();
            } else {
                // Fetch the URL and trigger download
                try {
                    const resp = await fetch(track.url);
                    const blob = await resp.blob();
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = track.title + '.' + (blob.type.split('/')[1] || 'mp3');
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                } catch (e) {
                    console.error('Direct download failed:', e);
                    alert('Could not download this track directly. Try applying an effect first.');
                }
            }
            return;
        }

        const btn = $('btn-download');
        btn.disabled = true;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>`;

        // Circular Progress Border Animation via CSS Background
        btn.style.border = '2px solid transparent';
        btn.style.backgroundOrigin = 'border-box';
        btn.style.backgroundClip = 'padding-box, border-box';

        let simProgress = 0;
        let progInterval = setInterval(() => {
            simProgress += (95 - simProgress) * 0.08;
            btn.style.backgroundImage = `linear-gradient(var(--bg-app), var(--bg-app)), conic-gradient(var(--accent) ${simProgress}%, transparent 0)`;
        }, 150);

        try {
            // FIXED: Get audio data from URL if no File object available
            let arrayBuffer;
            if (track.file) {
                arrayBuffer = await track.file.arrayBuffer();
            } else {
                const resp = await fetch(track.url);
                arrayBuffer = await resp.arrayBuffer();
            }

            const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
            const decoded = await tempCtx.decodeAudioData(arrayBuffer);

            const length = (decoded.length / audio.playbackRate) + (fx.reverb || fx.echo ? tempCtx.sampleRate * 4 : 0);
            const offCtx = new OfflineAudioContext(decoded.numberOfChannels, length, tempCtx.sampleRate);
            const src = offCtx.createBufferSource(); src.buffer = decoded; src.playbackRate.value = audio.playbackRate;

            let curr = src;

            if (fx.clarity) {
                const oMudCut = offCtx.createBiquadFilter(); oMudCut.type = 'peaking'; oMudCut.frequency.value = 250; oMudCut.Q.value = 0.8; oMudCut.gain.value = -2.5;
                const oAirBoost = offCtx.createBiquadFilter(); oAirBoost.type = 'highshelf'; oAirBoost.frequency.value = 8000; oAirBoost.gain.value = 3.5;
                const oComp = offCtx.createDynamicsCompressor(); oComp.threshold.value = -10; oComp.ratio.value = 2.5; oComp.attack.value = 0.01; oComp.release.value = 0.1;
                curr.connect(oMudCut); oMudCut.connect(oAirBoost); oAirBoost.connect(oComp);
                curr = oComp;
            }

            if (fx.reverb && nodes.revConvolver.buffer) {
                const oConv = offCtx.createConvolver(); oConv.buffer = nodes.revConvolver.buffer;
                const oDry = offCtx.createGain(); oDry.gain.value = nodes.revDry.gain.value;
                const oWet = offCtx.createGain(); oWet.gain.value = nodes.revWet.gain.value;
                curr.connect(oDry); curr.connect(oConv); oConv.connect(oWet);
                oDry.connect(offCtx.destination); oWet.connect(offCtx.destination);
            } else {
                curr.connect(offCtx.destination);
            }

            src.start(0);
            const rendered = await offCtx.startRendering();

            clearInterval(progInterval);
            btn.style.backgroundImage = `linear-gradient(var(--bg-app), var(--bg-app)), conic-gradient(var(--accent) 100%, transparent 0)`;

            let nCh = rendered.numberOfChannels, len = rendered.length * nCh * 2 + 44,
                out = new ArrayBuffer(len), view = new DataView(out), chs = [], offset = 0, pos = 0;
            const set16 = d => { view.setUint16(pos, d, true); pos += 2; }; const set32 = d => { view.setUint32(pos, d, true); pos += 4; };
            set32(0x46464952); set32(len - 8); set32(0x45564157);
            set32(0x20746d66); set32(16); set16(1); set16(nCh);
            set32(rendered.sampleRate); set32(rendered.sampleRate * 2 * nCh); set16(nCh * 2); set16(16);
            set32(0x61746164); set32(len - pos - 4);

            for (let i = 0; i < nCh; i++) chs.push(rendered.getChannelData(i));
            while (pos < len) {
                for (let i = 0; i < nCh; i++) {
                    let s = Math.max(-1, Math.min(1, chs[i][offset]));
                    view.setInt16(pos, s < 0 ? s * 32768 : s * 32767, true); pos += 2;
                } offset++;
            }

            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([out], { type: "audio/wav" }));
            a.download = `Processed_${track.title}.wav`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            tempCtx.close();
        } catch (e) {
            console.error(e);
            alert('Export failed: ' + (e.message || 'Unknown error'));
            clearInterval(progInterval);
        }

        setTimeout(() => {
            btn.style.border = '';
            btn.style.backgroundOrigin = '';
            btn.style.backgroundClip = '';
            btn.style.backgroundImage = '';
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }, 1000);
    };
});