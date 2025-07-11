document.addEventListener('DOMContentLoaded', () => {
    const elements = {
        visualBlock: document.getElementById('visual-upload-block'), visualInput: document.getElementById('visual-input'),
        audioBlock: document.getElementById('audio-upload-block'), audioInput: document.getElementById('audio-input'),
        songList: document.getElementById('song-list'), timeline: document.getElementById('timeline'),
        generateBtnContainer: document.getElementById('generate-button-container'), generateBtn: document.getElementById('generate-btn'),
        clearSongsBtn: document.getElementById('clear-songs-btn'), settingsIcon: document.getElementById('settings-icon'),
        settingsMenu: document.getElementById('settings-menu'), fpsSlider: document.getElementById('fps-slider'), fpsValue: document.getElementById('fps-value'),
        progressBar: document.getElementById('progress-bar'), progressText: document.getElementById('progress-text')
    };
    let songs = [], visualFile = null, visualPreviewUrl = null;

    // --- ОСЬ ВИПРАВЛЕННЯ: 'ws://' замінено на 'wss://' ---
    const socket = new WebSocket('wss://' + window.location.host);
    // ----------------------------------------------------

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'progress': updateProgressBar(data.progress, data.totalDuration); break;
                case 'done': finishGeneration(data); break;
                case 'error': alert(`Помилка на сервері: ${data.message}`); resetGenerateButton(); break;
            }
        } catch (e) { console.error("Помилка обробки повідомлення від WebSocket:", e); }
    };
    [elements.visualBlock, elements.audioBlock].forEach(block => {
        block.addEventListener('dragover', (e) => { e.preventDefault(); block.classList.add('dragover'); });
        block.addEventListener('dragleave', () => block.classList.remove('dragover'));
        block.addEventListener('drop', (e) => { e.preventDefault(); block.classList.remove('dragover'); const input = block.id.includes('visual') ? elements.visualInput : elements.audioInput; input.files = e.dataTransfer.files; input.dispatchEvent(new Event('change')); });
        block.addEventListener('click', () => { const input = block.id.includes('visual') ? elements.visualInput : elements.audioInput; input.click(); });
    });
    elements.visualInput.addEventListener('change', () => handleVisualFile(elements.visualInput.files[0]));
    elements.audioInput.addEventListener('change', () => handleAudioFiles(elements.audioInput.files));
    function handleVisualFile(file) {
        if (!file) return; visualFile = file; if (visualPreviewUrl) URL.revokeObjectURL(visualPreviewUrl);
        const prompt = elements.visualBlock.querySelector('.upload-prompt'); elements.visualBlock.querySelector('img')?.remove();
        visualPreviewUrl = URL.createObjectURL(file); const img = document.createElement('img'); img.src = visualPreviewUrl;
        elements.visualBlock.appendChild(img); if (prompt) prompt.style.display = 'none';
    }
    function handleAudioFiles(files) { for (const file of files) songs.push({ file, id: Date.now() + Math.random() }); renderSongList(); }
    function renderSongList() {
        elements.songList.innerHTML = ''; songs.forEach(song => {
        const li = document.createElement('li'); li.dataset.id = song.id;
        li.innerHTML = `<i class="fas fa-grip-lines grab-handle"></i><span class="song-name">${song.file.name}</span><i class="fas fa-times-circle delete-song" title="Видалити"></i>`;
        elements.songList.appendChild(li); }); updateTimeline();
    }
    Sortable.create(elements.songList, { animation: 150, ghostClass: 'sortable-ghost', dragClass: 'sortable-drag', onEnd: (evt) => {
        const [reorderedItem] = songs.splice(evt.oldIndex, 1); songs.splice(evt.newIndex, 0, reorderedItem); updateTimeline(); }});
    elements.songList.addEventListener('click', (e) => { if (e.target.classList.contains('delete-song')) { songs = songs.filter(song => song.id !== parseFloat(e.target.closest('li').dataset.id)); renderSongList(); } });
    elements.clearSongsBtn.addEventListener('click', () => { songs = []; renderSongList(); });
    async function updateTimeline() {
        if (songs.length === 0) { elements.timeline.innerHTML = ''; return; } let currentTime = 0, timelineText = '';
        for (const song of songs) { const duration = await getAudioDuration(song.file).catch(() => 0); timelineText += `${formatTime(currentTime)}  ${song.file.name}\n`; currentTime += duration; }
        elements.timeline.innerText = timelineText;
    }
    const getAudioDuration = (file) => new Promise((resolve, reject) => { const audio = new Audio(); audio.preload = 'metadata'; audio.onloadedmetadata = () => { URL.revokeObjectURL(audio.src); resolve(audio.duration); }; audio.onerror = reject; audio.src = URL.createObjectURL(file); });
    const formatTime = (time) => `${Math.floor(time / 60).toString().padStart(2, '0')}:${Math.floor(time % 60).toString().padStart(2, '0')}`;
    elements.generateBtn.addEventListener('click', async () => {
        if (!visualFile || songs.length === 0) { alert('Будь ласка, завантажте візуальний файл та хоча б одну пісню.'); return; }
        elements.generateBtnContainer.classList.add('in-progress');
        elements.progressBar.style.width = '0%';
        elements.progressText.textContent = 'Підготовка...';
        const formData = new FormData();
        formData.append('visual', visualFile); songs.forEach(song => formData.append('audio', song.file)); formData.append('fps', elements.fpsSlider.value);
        try { const response = await fetch('/generate', { method: 'POST', body: formData }); if (!response.ok) throw new Error(`Помилка сервера: ${response.statusText}`); }
        catch (error) { alert(`Не вдалося розпочати генерацію: ${error.message}`); resetGenerateButton(); }
    });
    function updateProgressBar(progress, totalDuration) {
        if (!totalDuration || totalDuration <= 0) return;
        const displayProgress = Math.min(progress, totalDuration);
        const percent = (displayProgress / totalDuration) * 100;
        elements.progressBar.style.width = `${percent}%`;
        const progressType = document.querySelector('input[name="progress-type"]:checked').value;
        if (progressType === 'time') {
            elements.progressText.textContent = `${formatTime(displayProgress)} / ${formatTime(totalDuration)}`;
        } else {
            elements.progressText.textContent = `${percent.toFixed(1)}%`;
        }
    }
    function finishGeneration({ downloadPath, fileName }) {
        elements.progressText.textContent = 'Готово!';
        elements.progressBar.style.width = '100%';
        const a = document.createElement('a'); a.style.display = 'none';
        a.href = downloadPath; a.download = fileName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(resetGenerateButton, 2000);
    }
    function resetGenerateButton() { elements.generateBtnContainer.classList.remove('in-progress'); }
    elements.settingsIcon.addEventListener('click', (e) => { e.stopPropagation(); elements.settingsMenu.style.display = elements.settingsMenu.style.display === 'block' ? 'none' : 'block'; });
    document.addEventListener('click', (e) => { if (!elements.settingsMenu.contains(e.target)) elements.settingsMenu.style.display = 'none'; });
    elements.fpsSlider.addEventListener('input', () => { elements.fpsValue.textContent = `${elements.fpsSlider.value} FPS`; });
});
