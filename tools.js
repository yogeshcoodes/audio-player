// tools.js

document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const fileInput = $('tools-reverse-input');
    const btnChoose = $('btn-tools-reverse-choose');
    const btnRun = $('btn-tools-reverse-run');
    const statusEl = $('tools-reverse-status');
    if (!btnChoose) return; // Tools panel not on this page

    let selectedFile = null;

    btnChoose.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
        selectedFile = e.target.files[0] || null;
        statusEl.textContent = selectedFile ? `Selected: ${selectedFile.name}` : '';
        btnRun.disabled = !selectedFile;
    };

    btnRun.onclick = async () => {
        if (!selectedFile) return;
        btnRun.disabled = true;
        statusEl.textContent = 'Reversing...';
        try {
            const buffer = await selectedFile.arrayBuffer();
            const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
            const decoded = await tempCtx.decodeAudioData(buffer);

            const reversed = tempCtx.createBuffer(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
            for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
                const src = decoded.getChannelData(ch);
                const dst = reversed.getChannelData(ch);
                for (let i = 0, j = src.length - 1; i < src.length; i++, j--) dst[i] = src[j];
            }

            const nCh = reversed.numberOfChannels;
            let len = reversed.length * nCh * 2 + 44,
                out = new ArrayBuffer(len),
                view = new DataView(out),
                chs = [], pos = 0, offset = 0;

            const set16 = d => { view.setUint16(pos, d, true); pos += 2; };
            const set32 = d => { view.setUint32(pos, d, true); pos += 4; };

            set32(0x46464952); set32(len - 8); set32(0x45564157); set32(0x20746d66);
            set32(16); set16(1); set16(nCh); set32(reversed.sampleRate);
            set32(reversed.sampleRate * 2 * nCh); set16(nCh * 2); set16(16);
            set32(0x61746164); set32(len - pos - 4);
            for (let i = 0; i < nCh; i++) chs.push(reversed.getChannelData(i));
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
            a.download = `Reversed_${selectedFile.name.replace(/\.[^/.]+$/, '')}.wav`;
            a.click();
            statusEl.textContent = 'Done! Check your downloads.';
            tempCtx.close();
        } catch (err) {
            console.error(err);
            statusEl.textContent = 'Failed to reverse audio.';
        }
        btnRun.disabled = false;
    };
});