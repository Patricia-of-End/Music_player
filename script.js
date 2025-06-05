// DOM要素の取得
const audioFileEl = document.getElementById('audioFile');
const lrcFileEl = document.getElementById('lrcFile');
const clearLrcBtn = document.getElementById('clearLrcBtn');
const audioPlayer = document.getElementById('audioPlayer');
const playPauseBtn = document.getElementById('playPauseBtn');
const seekBar = document.getElementById('seekBar');
const timeDisplay = document.getElementById('timeDisplay');
const volumeBar = document.getElementById('volumeBar');
const lyricsContainer = document.getElementById('lyricsContainer');
const messageArea = document.getElementById('messageArea');
let visualizerCanvas, visualizerCtx; 

// ファイル情報表示用要素
const fileTypeEl = document.getElementById('fileType');
const sampleRateEl = document.getElementById('sampleRate');
const bitRateEl = document.getElementById('bitRate');
const fileSizeEl = document.getElementById('fileSize'); // ファイルサイズ表示用要素を追加


let lrcData = []; 
let currentLrcLineIndex = -1;
let audioLoaded = false; 
let metadataLyricsSource = null; 

const marqueeTimeouts = new Map();
const marqueeAnimationEndListeners = new Map();


let audioContext;
let analyser;
let sourceNode; 
let frequencyData;
let renderFrameId; 

let currentObjectURL = null;
let currentFile = null; 
let currentFileSize = 0; // ファイルサイズを格納する変数を追加 (前回の提案)

// --- 初期化 ---
function initializePlayer() {
    console.log("initializePlayer called");
    const albumArtEl = document.getElementById('albumArt'); 
    const albumArtPlaceholderEl = document.getElementById('albumArtPlaceholder');
    albumArtEl.classList.add('hidden');
    albumArtPlaceholderEl.classList.remove('hidden');
    
    const initialTags = { title: '曲名未選択', artist: 'アーティスト不明', album: 'アルバム不明' };
    displayMetadata(initialTags); 
    resetFileInfoDisplay(); 

    resetLrcState(); 

    playPauseBtn.classList.add('disabled-button');
    playPauseBtn.disabled = true;
    seekBar.disabled = true;
    audioLoaded = false;
    messageArea.textContent = '';

    currentFileSize = 0; // 初期化時にファイルサイズもリセット (前回の提案)
    audioPlayer.volume = 0.5;
    volumeBar.value = 0.5;

    initVisualizerElements(); 
    setupMediaSession(); 

    window.addEventListener('beforeunload', () => {
        if (currentObjectURL) {
            URL.revokeObjectURL(currentObjectURL);
            console.log("Object URL revoked on page unload:", currentObjectURL);
            currentObjectURL = null;
        }
        if (audioContext && audioContext.state !== 'closed') {
            audioContext.close().then(() => console.log("AudioContext closed on page unload."));
        }
    });
}

function initVisualizerElements() {
    console.log("initVisualizerElements called");
    visualizerCanvas = document.getElementById('visualizerCanvas');
    if (visualizerCanvas) {
        visualizerCtx = visualizerCanvas.getContext('2d');
        console.log('Visualizer Canvas Element:', visualizerCanvas, 'Context:', visualizerCtx);
        resizeVisualizerCanvas(); 
        window.addEventListener('resize', resizeVisualizerCanvas); 
    } else {
        console.error('ビジュアライザーのcanvasが見つかりません！');
    }
}

function resizeVisualizerCanvas() {
    if (visualizerCanvas) {
        visualizerCanvas.width = window.innerWidth;
        visualizerCanvas.height = window.innerHeight;
        console.log(`Visualizer canvas resized to: ${visualizerCanvas.width}x${visualizerCanvas.height}`);
    }
}

function setupVisualizer() {
    console.log('Attempting to setup visualizer...');
    if (!audioPlayer.src || !visualizerCanvas) { 
        console.warn("ビジュアライザーのセットアップをスキップ: srcなし、またはcanvasなし。", "audioPlayer.src:", audioPlayer.src, "visualizerCanvas:", visualizerCanvas);
        return;
    }

    if (!audioContext || audioContext.state === 'closed') { 
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log("AudioContext created/recreated. State:", audioContext.state);
            updateSampleRateDisplay(); 
            sourceNode = null; 
            analyser = null;   
        } catch (e) {
            console.error("AudioContextの作成に失敗:", e);
            setErrorMessage("オーディオ機能の初期化に失敗しました。ブラウザが対応していない可能性があります。");
            return;
        }
    }
    
    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log("AudioContextが正常に再開されました。 State:", audioContext.state);
            updateSampleRateDisplay(); 
            proceedWithVisualizerSetup();
        }).catch(e => {
            console.error("AudioContextの再開エラー:", e);
        });
    } else if (audioContext.state === 'running') {
        console.log("AudioContext is already running. State:", audioContext.state);
        updateSampleRateDisplay(); 
        proceedWithVisualizerSetup();
    }
}

function proceedWithVisualizerSetup() {
    console.log("Proceeding with visualizer setup...");
    if (!audioContext || audioContext.state !== 'running') { 
        console.error("proceedWithVisualizerSetup: AudioContextが存在しないか、実行状態ではありません。State:", audioContext ? audioContext.state : "N/A");
        return;
    }
    if (!analyser) { 
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256; 
        frequencyData = new Uint8Array(analyser.frequencyBinCount);
        console.log("Analyser created. fftSize:", analyser.fftSize, "frequencyBinCount:", analyser.frequencyBinCount);
    }

    if (!sourceNode) { 
        try {
             console.log("Creating new MediaElementAudioSourceNode.");
             sourceNode = audioContext.createMediaElementSource(audioPlayer);
        } catch (e) {
            console.error("MediaElementAudioSourceNodeの作成エラー:", e);
            setErrorMessage("ビジュアライザーの音声ソース設定に失敗しました。(M01)");
            return; 
        }
    }
    
    try {
        console.log("Attempting to connect nodes: sourceNode -> analyser -> destination");
        sourceNode.disconnect(); 
        analyser.disconnect();   
        
        sourceNode.connect(analyser);
        analyser.connect(audioContext.destination); 
        console.log("ビジュアライザーのセットアップ完了。ノード接続済み。");
    } catch (e) {
        console.error("ビジュアライザーのノード接続エラー:", e);
        setErrorMessage("ビジュアライザーの音声ソース設定に失敗しました。(N01)");
        return; 
    }

    if (renderFrameId) {
        cancelAnimationFrame(renderFrameId);
    }
    renderVisualizerFrame();
}


function renderVisualizerFrame() {
    if (!analyser || !visualizerCtx || !frequencyData || !visualizerCanvas) {
        return;
    }
    renderFrameId = requestAnimationFrame(renderVisualizerFrame);
    analyser.getByteFrequencyData(frequencyData);

    visualizerCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    // 背景グラデーションは透明にしたので、ここでは描画しないか、非常に薄いものにする
    // const gradient = visualizerCtx.createLinearGradient(0, 0, 0, visualizerCanvas.height);
    // gradient.addColorStop(0, 'rgba(30, 64, 175, 0.05)'); // sky-700 系統の薄い色
    // gradient.addColorStop(1, 'rgba(56, 189, 248, 0.1)'); // sky-400 系統の薄い色
    // visualizerCtx.fillStyle = gradient;
    // visualizerCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

    const numBars = analyser.frequencyBinCount * 0.7; 
    const barWidth = visualizerCanvas.width / numBars;
    let x = 0;
    for (let i = 0; i < numBars; i++) {
        const barHeightValue = frequencyData[i];
        const barHeight = (barHeightValue / 255) * (visualizerCanvas.height * 0.5); 
        const hue = (i / numBars) * 180 + 180; // 青から紫、ピンク系
        const saturation = 70 + (barHeightValue / 255) * 30; 
        const lightness = Math.min(45 + (barHeightValue / 255) * 30, 75); // 少し明るめ
        visualizerCtx.fillStyle = `hsl(${hue % 360}, ${saturation}%, ${lightness}%)`;
        visualizerCtx.fillRect(x, visualizerCanvas.height - barHeight, Math.max(1, barWidth - 1), barHeight); 
        x += barWidth;
    }
}

function setupMediaSession() {
    if ('mediaSession' in navigator) {
        console.log("Media Session API is available.");
        navigator.mediaSession.setActionHandler('play', () => {
            console.log("Media Session: Play action received.");
            if (audioPlayer.paused) {
                togglePlayPause(); 
            }
        });
        navigator.mediaSession.setActionHandler('pause', () => {
            console.log("Media Session: Pause action received.");
            if (!audioPlayer.paused) {
                togglePlayPause();
            }
        });
        navigator.mediaSession.setActionHandler('stop', () => {
            console.log("Media Session: Stop action received.");
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
            // 必要であれば、さらにUIの状態をリセットする処理を呼び出す
            // initializePlayer(); // UI全体をリセットする場合
            updatePlayPauseButton(); // ボタン表示のみ更新
            updateTimeDisplay();
            if (renderFrameId) {
                cancelAnimationFrame(renderFrameId);
                renderFrameId = null;
            }
        });
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            console.log("Media Session: Seek backward action received.", details);
            audioPlayer.currentTime = Math.max(audioPlayer.currentTime - (details.seekOffset || 10), 0);
        });
        navigator.mediaSession.setActionHandler('seekforward', (details) => {
            console.log("Media Session: Seek forward action received.", details);
            audioPlayer.currentTime = Math.min(audioPlayer.currentTime + (details.seekOffset || 10), audioPlayer.duration);
        });
    } else {
        console.log("Media Session API is not available.");
    }
}

async function updateMediaSessionMetadata(tags) {
    if ('mediaSession' in navigator) {
        console.log("Updating Media Session metadata with:", tags);
        const artwork = [];
        if (tags.picture) {
            try {
                const { data, format } = tags.picture;
                let base64String = "";
                for (let i = 0; i < data.length; i++) {
                    base64String += String.fromCharCode(data[i]);
                }
                const blob = await fetch(`data:${format};base64,${window.btoa(base64String)}`).then(res => res.blob());
                const artworkObjectURL = URL.createObjectURL(blob); 
                artwork.push({ src: artworkObjectURL, sizes: '512x512', type: blob.type }); 
            } catch (e) {
                console.error("Error creating blob from picture data for Media Session:", e);
            }
        }

        navigator.mediaSession.metadata = new MediaMetadata({
            title: tags.title || 'タイトル不明',
            artist: tags.artist || 'アーティスト不明',
            album: tags.album || 'アルバム不明',
            artwork: artwork
        });
        console.log("Media Session metadata updated.");
    }
}

function resetFileInfoDisplay() {
    console.log("resetFileInfoDisplay called");
    if (fileTypeEl) fileTypeEl.textContent = 'N/A';
    if (sampleRateEl) sampleRateEl.textContent = 'N/A';
    if (bitRateEl) bitRateEl.textContent = 'N/A';
    if (fileSizeEl) fileSizeEl.textContent = 'N/A'; // ファイルサイズ表示もリセット
}

function updateFileInfoDisplay() {
    console.log("--- updateFileInfoDisplay called ---"); // 関数の開始を明確にログ
    console.log("  bitRateEl element:", bitRateEl); // bitRateElが取得できているか
    console.log("  currentFile object:", currentFile);
    if (currentFile) {
        console.log("  currentFile.size:", currentFile.size, "(type:", typeof currentFile.size, ")");
    }
    console.log("  audioPlayer.duration:", audioPlayer.duration, "(type:", typeof audioPlayer.duration, ")");

    // ファイル形式
    if (fileTypeEl && currentFile) {
        const fileName = currentFile.name;
        const extension = fileName.split('.').pop();
        if (extension && extension !== fileName) { 
            fileTypeEl.textContent = extension.toUpperCase();
        } else if (currentFile.type && currentFile.type.trim() !== "") { 
            fileTypeEl.textContent = currentFile.type.toUpperCase().replace('AUDIO/', '');
        } else {
            fileTypeEl.textContent = '不明';
        }
    } else if (fileTypeEl) {
        fileTypeEl.textContent = 'N/A';
    }

    updateSampleRateDisplay();

    // ビットレート
    if (bitRateEl) { // まず要素が存在するか
        const isCurrentFileValid = !!(currentFile && typeof currentFile.size === 'number' && currentFile.size > 0);
        const isDurationValid = !!(typeof audioPlayer.duration === 'number' && !isNaN(audioPlayer.duration) && audioPlayer.duration > 0);
        
        // ★★★ 各条件の評価結果をログに出力 ★★★
        console.log(`  Bitrate calculation conditions:`);
        console.log(`    - bitRateEl exists: ${!!bitRateEl}`);
        console.log(`    - currentFile is valid: ${isCurrentFileValid}`);
        if (currentFile) {
            console.log(`        - currentFile.size: ${currentFile.size}`);
        }
        console.log(`    - audioPlayer.duration is valid: ${isDurationValid}`);
        if (typeof audioPlayer.duration === 'number'){
            console.log(`        - audioPlayer.duration value: ${audioPlayer.duration}`);
        }


        if (isCurrentFileValid && isDurationValid) {
            const fileSizeInBits = currentFile.size * 8;
            const calculatedBitRate = Math.round(fileSizeInBits / audioPlayer.duration / 1000);
            bitRateEl.textContent = `${calculatedBitRate} kbps`;
            console.log(`  >>> BITRATE CALCULATED: ${calculatedBitRate} kbps`);
        } else {
            bitRateEl.textContent = 'N/A';
            console.warn(`  >>> BITRATE N/A. Reasons: currentFile valid: ${isCurrentFileValid}, duration valid: ${isDurationValid}.`);
        }
    } else {
        console.warn("  bitRateEl element not found in DOM, cannot display bitrate.");
    }

    // ファイルサイズ表示の更新
    if (fileSizeEl) {
        if (currentFileSize > 0) {
            fileSizeEl.textContent = formatFileSize(currentFileSize);
        } else {
            fileSizeEl.textContent = 'N/A';
        }
    }
    console.log("--- end updateFileInfoDisplay ---");
}

function updateSampleRateDisplay() {
    if (sampleRateEl && audioContext && audioContext.sampleRate && audioContext.state === 'running') {
        sampleRateEl.textContent = `${audioContext.sampleRate / 1000} kHz (再生時)`;
        console.log("Sample rate updated to:", sampleRateEl.textContent); 
    } else if (sampleRateEl) {
        // console.warn("Sample rate not updated. audioContext state:", audioContext ? audioContext.state : "N/A");
    }
}


// --- イベントリスナー ---
audioFileEl.addEventListener('change', (event) => {
    const file = event.target.files[0];
    currentFile = file; 
    currentFileSize = file ? file.size : 0; // ファイルサイズを更新 (前回の提案)
    if (file) {
        if (currentObjectURL) {
            URL.revokeObjectURL(currentObjectURL);
            console.log("Previous Object URL revoked:", currentObjectURL);
        }
        currentObjectURL = URL.createObjectURL(file); 
        audioPlayer.src = currentObjectURL;
        console.log("Audio file selected. src set to:", currentObjectURL);
        
        if (renderFrameId) {
            cancelAnimationFrame(renderFrameId);
            renderFrameId = null;
            console.log("Previous renderFrame cancelled.");
        }
        
        let visualizerSetupAttempted = false;
        const attemptVisualizerSetup = () => {
            if (!visualizerSetupAttempted && audioPlayer.readyState >= 2) { 
                console.log("音声の準備状況に基づいてビジュアライザーのセットアップを試行中 (readyState:", audioPlayer.readyState,")");
                setupVisualizer(); 
                visualizerSetupAttempted = true;
            } else if (!visualizerSetupAttempted) {
                console.log("Visualizer setup attempt skipped, readyState:", audioPlayer.readyState);
            }
        };
        
        const cleanupAudioEventListeners = () => {
            audioPlayer.onloadeddata = null;
            audioPlayer.oncanplay = null;
            audioPlayer.onloadedmetadata = null; 
        };
        cleanupAudioEventListeners(); 

        audioPlayer.onloadedmetadata = () => { 
            console.log("audioPlayer event: onloadedmetadata fired. Duration:", audioPlayer.duration); 
            updateFileInfoDisplay(); 
            seekBar.max = audioPlayer.duration; 
            updateTimeDisplay(); 
            attemptVisualizerSetup(); 
        };
         audioPlayer.oncanplay = () => { 
            console.log("audioPlayer event: oncanplay fired.");
            updateFileInfoDisplay(); 
            attemptVisualizerSetup();
            cleanupAudioEventListeners(); 
        };


        resetLrcState(); 
        resetFileInfoDisplay(); 
        updateFileInfoDisplay(); 


        window.jsmediatags.read(file, {
            onSuccess: (tag) => {
                console.log('メタデータ読み込み完了 (全tagオブジェクト):', tag); 
                console.log('特に tag.tags:', tag.tags); 
                
                displayMetadata(tag.tags); 
                updateMediaSessionMetadata(tag.tags); 
                audioLoaded = true; 
                enableControls();
                setSuccessMessage('音声ファイルを読み込みました。');

                if (fileTypeEl && tag.type) { 
                    fileTypeEl.textContent = tag.type.toUpperCase();
                }
                updateSampleRateDisplay(); 

                let lyricsText = null;
                if (tag.tags.lyrics) {
                    if (typeof tag.tags.lyrics === 'string') lyricsText = tag.tags.lyrics;
                    else if (typeof tag.tags.lyrics === 'object' && tag.tags.lyrics.lyrics) lyricsText = tag.tags.lyrics.lyrics;
                    else if (Array.isArray(tag.tags.lyrics) && tag.tags.lyrics.length > 0 && tag.tags.lyrics[0].lyrics) lyricsText = tag.tags.lyrics[0].lyrics;
                }
                 if (!lyricsText) { 
                    const commonVorbisContainers = ['vorbisComments', 'comment', 'comments', 'userDefinedInformation'];
                    for (const containerName of commonVorbisContainers) {
                        if (tag.tags[containerName] && Array.isArray(tag.tags[containerName])) {
                            const lyricsComment = tag.tags[containerName].find(comment =>
                                comment && typeof comment.key === 'string' && (comment.key.toUpperCase() === 'LYRICS' || comment.key.toUpperCase() === 'UNSYNCEDLYRICS')
                            );
                            if (lyricsComment && typeof lyricsComment.value === 'string') {
                                lyricsText = lyricsComment.value;
                                console.log(`tag.tags.${containerName} 内にキー: ${lyricsComment.key} で歌詞を発見`);
                                break; 
                            }
                        }
                        else if (tag.tags[containerName] && typeof tag.tags[containerName] === 'object') {
                            const commentsObject = tag.tags[containerName];
                            if (typeof commentsObject.LYRICS === 'string') {
                                lyricsText = commentsObject.LYRICS;
                                console.log(`tag.tags.${containerName}.LYRICS 内に歌詞を発見`);
                                break;
                            } else if (typeof commentsObject.UNSYNCEDLYRICS === 'string') {
                                lyricsText = commentsObject.UNSYNCEDLYRICS;
                                console.log(`tag.tags.${containerName}.UNSYNCEDLYRICS 内に歌詞を発見`);
                                break;
                            }
                        }
                    }
                }
                if (!lyricsText && typeof tag.tags.LYRICS === 'string') {
                    lyricsText = tag.tags.LYRICS;
                    console.log('tag.tags.LYRICS 直下に歌詞を発見。');
                } else if (!lyricsText && typeof tag.tags.USLT === 'string') { 
                    lyricsText = tag.tags.USLT;
                    console.log('tag.tags.USLT 直下に歌詞を発見。');
                }
                 if (lyricsText && lyricsText.trim()) { 
                    console.log('埋め込み歌詞の内容を取得:', lyricsText.substring(0, 100) + "...");
                    if (isLrcString(lyricsText)) {
                        console.log('メタデータ歌詞をLRC形式として認識。');
                        try {
                            parseLRC(lyricsText);
                            if (lrcData.length > 0) {
                                displayLyrics(); 
                                setSuccessMessage('メタデータからLRC形式の歌詞を読み込みました。');
                                metadataLyricsSource = 'lrc';
                                enableClearLrcButton();
                            } else {
                                lyricsContainer.innerHTML = '<p class="text-gray-500">メタデータ歌詞(LRC)のパース結果が空です。</p>';
                                console.warn('埋め込みLRC歌詞をパースしましたが結果は空でした。');
                            }
                        } catch (err) {
                            console.error("埋め込みLRC歌詞のパースエラー:", err);
                            setWarningMessage('メタデータ内のLRC歌詞のパースに失敗しました。テキストとして表示します。');
                            displayPlainTextLyrics(lyricsText); 
                            metadataLyricsSource = 'plain_parse_failed';
                            enableClearLrcButtonIfLyrics();
                        }
                    } else {
                        console.log('メタデータ歌詞をプレーンテキストとして認識。');
                        displayPlainTextLyrics(lyricsText); 
                        metadataLyricsSource = 'plain';
                        enableClearLrcButtonIfLyrics();
                    }
                } else {
                    console.log('様々なフィールドを確認しましたが、埋め込み歌詞の内容は見つかりませんでした。');
                }
            },
            onError: (error) => {
                console.error('jsmediatagsでのメタデータ読み込みエラー:', error);
                displayMetadata({}); 
                updateMediaSessionMetadata({}); 
                audioLoaded = true; 
                enableControls();
                setErrorMessage('メタデータの読み込みに失敗しました。');
            }
        });
    } else { 
        if (currentObjectURL) { 
            URL.revokeObjectURL(currentObjectURL);
            console.log("Object URL revoked on file selection cancel:", currentObjectURL);
            currentObjectURL = null;
        }
        audioPlayer.src = ""; 
        currentFile = null; 
        currentFileSize = 0; // ファイル選択解除時もリセット (前回の提案)
        initializePlayer(); 
        if ('mediaSession' in navigator) { 
            navigator.mediaSession.metadata = null;
            navigator.mediaSession.playbackState = "none";
        }
    }
});

// (LRCファイル選択、クリアボタン、再生/一時停止ボタンのイベントリスナーは変更なし)
lrcFileEl.addEventListener('change', (event) => { 
    const file = event.target.files[0];
    if (file && audioLoaded) {
        const reader = new FileReader();
        reader.onload = (e) => {
            resetLrcState(); 
            try {
                parseLRC(e.target.result);
                displayLyrics(); 
                if (lrcData.length > 0) {
                    setSuccessMessage('LRCファイルを読み込みました。');
                    enableClearLrcButton();
                } else {
                    setWarningMessage('LRCファイルに有効な歌詞データがありませんでした。');
                }
            } catch (err) {
                console.error("LRCファイルのパースエラー:", err);
                setErrorMessage('LRCファイルの形式が正しくありません。');
            }
        };
        reader.onerror = () => {
            setErrorMessage('LRCファイルの読み込みに失敗しました。');
            console.error("LRCファイルの読み込みエラー");
            resetLrcState();
        }
        reader.readAsText(file);
    } else if (!audioLoaded) {
        setErrorMessage('先に音声ファイルを選択してください。');
        lrcFileEl.value = '';
    }
});

clearLrcBtn.addEventListener('click', () => { 
    resetLrcState();
    lrcFileEl.value = ''; 
    setSuccessMessage('歌詞情報をクリアしました。');
});

playPauseBtn.addEventListener('click', () => {
    if (!audioLoaded) return;

    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log("再生時にAudioContextが再開されました。");
            if (audioPlayer.src && visualizerCanvas && !sourceNode) { 
                console.log("再開後、再生時にビジュアライザーのセットアップを試行。");
                setupVisualizer(); 
            }
            togglePlayPause();
        }).catch(e => {
            console.error("再生時のAudioContext再開エラー:", e);
            togglePlayPause(); 
        });
    } else {
        if (audioPlayer.src && visualizerCanvas && (!audioContext || !sourceNode)) { 
             console.log("ビジュアライザー未セットアップまたはAudioContext未作成、再生時に試行。");
             setupVisualizer(); 
        }
        togglePlayPause();
    }
});

function togglePlayPause() {
    if (audioPlayer.paused || audioPlayer.ended) {
        audioPlayer.play().catch(e => {
            console.error("再生エラー:", e);
            setErrorMessage('再生に失敗しました。');
        });
    } else {
        audioPlayer.pause();
    }
}

function updatePlayPauseButton() {
    const isPlaying = !audioPlayer.paused && !audioPlayer.ended;
    playIcon.classList.toggle('hidden', isPlaying);
    pauseIcon.classList.toggle('hidden', !isPlaying);
}

audioPlayer.addEventListener('play', () => { 
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
    if (audioContext && audioContext.state === 'running' && audioPlayer.src && visualizerCanvas && !sourceNode) {
        console.log("音声再生開始、sourceNode未作成のためビジュアライザーのセットアップを確認。");
        setupVisualizer();
    }
    if (renderFrameId === null && analyser && visualizerCtx && audioContext && audioContext.state === 'running') { 
        console.log("再生開始、ビジュアライザー描画ループを再開。");
        renderVisualizerFrame();
    }
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = "playing";
    }
});

audioPlayer.addEventListener('pause', () => { 
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = "paused";
    }
    if (renderFrameId) {
       cancelAnimationFrame(renderFrameId);
       renderFrameId = null; 
       console.log("Audio paused, visualizer frame rendering stopped.");
    }
});

audioPlayer.addEventListener('ended', () => {
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
    if (renderFrameId) {
        cancelAnimationFrame(renderFrameId);
        renderFrameId = null;
        console.log("音声終了、ビジュアライザー描画ループ停止。");
        if (visualizerCtx && visualizerCanvas) {
            visualizerCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
        }
    }
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = "none";
    }
});


audioPlayer.addEventListener('loadedmetadata', () => { 
    console.log("audioPlayer event: loadedmetadata fired. Duration:", audioPlayer.duration);
    seekBar.max = audioPlayer.duration;
    updateTimeDisplay();
    updateFileInfoDisplay(); 
});

audioPlayer.addEventListener('timeupdate', () => { 
    seekBar.value = audioPlayer.currentTime;
    updateTimeDisplay();
    if (lrcData.length > 0 && (lrcFileEl.files.length > 0 || metadataLyricsSource === 'lrc')) {
        updateLyricsHighlight(); 
    }
});

seekBar.addEventListener('input', () => { 
    if (!audioLoaded) return;
    audioPlayer.currentTime = seekBar.value;
});

volumeBar.addEventListener('input', (event) => { 
    audioPlayer.volume = event.target.value;
});

// --- ヘルパー関数 ---
// (以下、変更なしのヘルパー関数群)
function escapeHtml(unsafe) { 
    if (typeof unsafe !== 'string') return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function isLrcString(text) { 
    if (typeof text !== 'string' || !text.trim()) return false;
    const lines = text.split('\n').slice(0, 10); 
    const lrcTimePattern = /\[\d{2}:\d{2}\.\d{2,3}\]/;
    return lines.some(line => lrcTimePattern.test(line));
}

function enableControls() { 
    playPauseBtn.classList.remove('disabled-button');
    playPauseBtn.disabled = false;
    seekBar.disabled = false;
}

function enableClearLrcButton() { 
    clearLrcBtn.disabled = false;
    clearLrcBtn.classList.remove('disabled-button');
}
function enableClearLrcButtonIfLyrics() { 
    if (lyricsContainer.innerHTML.trim() !== "" && !lyricsContainer.firstChild?.classList?.contains('text-gray-500')) {
        enableClearLrcButton();
    }
}


function resetLrcState() { 
    lrcData = [];
    lyricsContainer.innerHTML = '<p class="text-gray-500">LRCファイルを読み込むか、音声ファイルに歌詞情報が含まれていれば表示されます。</p>';
    currentLrcLineIndex = -1;
    clearLrcBtn.disabled = true;
    clearLrcBtn.classList.add('disabled-button');
    metadataLyricsSource = null; 
}

function displayMetadata(tags) { 
    const titleContainerEl = document.getElementById('trackTitle'); 
    const titleTextEl = titleContainerEl.querySelector('.marquee-child'); 
    const artistContainerEl = document.getElementById('trackArtist'); 
    const artistTextEl = artistContainerEl.querySelector('.marquee-child');
    const albumContainerEl = document.getElementById('trackAlbum'); 
    const albumTextEl = albumContainerEl.querySelector('.marquee-child');

    titleTextEl.textContent = tags.title || 'タイトル不明';
    artistTextEl.textContent = tags.artist || 'アーティスト不明';
    albumTextEl.textContent = tags.album || 'アルバム不明';
    titleContainerEl.title = tags.title || 'タイトル不明';
    artistContainerEl.title = tags.artist || 'アーティスト不明';
    albumContainerEl.title = tags.album || 'アルバム不明';

    checkAndApplyMarquee(titleContainerEl, titleTextEl);
    checkAndApplyMarquee(artistContainerEl, artistTextEl);
    checkAndApplyMarquee(albumContainerEl, albumTextEl);

    const albumArtEl = document.getElementById('albumArt');
    const albumArtPlaceholderEl = document.getElementById('albumArtPlaceholder');
    if (tags.picture) {
        albumArtPlaceholderEl.classList.add('hidden');
        albumArtEl.classList.remove('hidden');
        const { data, format } = tags.picture;
        let base64String = "";
        for (let i = 0; i < data.length; i++) base64String += String.fromCharCode(data[i]);
        albumArtEl.src = `data:${format};base64,${window.btoa(base64String)}`;
    } else {
        albumArtEl.classList.add('hidden');
        albumArtPlaceholderEl.classList.remove('hidden');
        albumArtEl.src = 'https://placehold.co/300x300/374151/9ca3af?text=Album+Art'; 
    }
}

function checkAndApplyMarquee(parentElement, textElement) {
    const existingListener = marqueeAnimationEndListeners.get(textElement);
    if (existingListener) {
        textElement.removeEventListener('animationend', existingListener);
        marqueeAnimationEndListeners.delete(textElement);
    }
    if (marqueeTimeouts.has(textElement)) {
        clearTimeout(marqueeTimeouts.get(textElement));
        marqueeTimeouts.delete(textElement);
    }

    textElement.classList.remove('start-scroll-setup', 'animate-scroll');
    parentElement.style.textOverflow = 'ellipsis'; 
    textElement.style.removeProperty('--animation-duration');
    textElement.style.removeProperty('--marquee-transform-x-target');
    textElement.style.paddingLeft = '0';
    textElement.style.transform = 'translateX(0px)';

    requestAnimationFrame(() => {
        const parentWidth = parentElement.clientWidth;
        const textWidth = textElement.scrollWidth;

        if (textWidth > parentWidth) {
            const startMarqueeAnimation = () => {
                parentElement.style.textOverflow = 'clip'; 
                textElement.classList.add('start-scroll-setup'); 
                void textElement.offsetWidth; 
                textElement.classList.add('animate-scroll');

                const computedStyle = window.getComputedStyle(textElement);
                const fontSize = parseFloat(computedStyle.fontSize);
                const gapWidth = Math.max(20, 2.5 * fontSize); 

                const transformTargetX = -(parentWidth + textWidth + gapWidth);
                textElement.style.setProperty('--marquee-transform-x-target', `${transformTargetX}px`);

                const effectiveScrollDistance = parentWidth + textWidth + gapWidth;
                const speed = 75; 
                let duration = effectiveScrollDistance / speed;
                duration = Math.max(3, Math.min(duration, 20)); 
                
                textElement.style.setProperty('--animation-duration', `${duration}s`);
            };

            const animationEndHandler = () => {
                console.log("Marquee animation ended for:", textElement.textContent.substring(0,10));
                textElement.classList.remove('start-scroll-setup', 'animate-scroll');
                textElement.style.paddingLeft = '0'; 
                textElement.style.transform = 'translateX(0px)';
                const loopTimeoutId = setTimeout(startMarqueeAnimation, 2000);
                marqueeTimeouts.set(textElement, loopTimeoutId);
            };
            
            textElement.addEventListener('animationend', animationEndHandler);
            marqueeAnimationEndListeners.set(textElement, animationEndHandler); 

            const initialTimeoutId = setTimeout(startMarqueeAnimation, 2000); 
            marqueeTimeouts.set(textElement, initialTimeoutId);
        }
    });
}

function parseLRC(lrcContent) { 
    lrcData = []; 
    const lines = lrcContent.split('\n');
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    const metaRegex = /\[(ar|ti|al|by|offset):(.+)\]/; 
    let lrcOffset = 0;
    for (const line of lines) {
        const metaMatch = line.match(metaRegex);
        if (metaMatch) {
            const key = metaMatch[1].toLowerCase();
            const value = metaMatch[2].trim();
            if (key === 'offset') lrcOffset = parseInt(value, 10) / 1000;
            continue; 
        }
        const match = line.match(timeRegex);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const milliseconds = parseInt(match[3].padEnd(3, '0'), 10);
            const time = minutes * 60 + seconds + milliseconds / 1000 + lrcOffset;
            const text = match[4].trim();
            if (text) lrcData.push({ time, text });
        }
    }
    lrcData.sort((a, b) => a.time - b.time);
    console.log('LRC Parsed:', lrcData);
}

function displayPlainTextLyrics(plainText) { 
    lrcData = []; 
    currentLrcLineIndex = -1; 
    lyricsContainer.innerHTML = ''; 
    if (!plainText || !plainText.trim()) {
        lyricsContainer.innerHTML = '<p class="text-slate-500">メタデータに歌詞はありますが、内容は空です。</p>';
        return;
    }
    const lines = plainText.split('\n');
    lines.forEach(line => {
        const p = document.createElement('p');
        p.textContent = escapeHtml(line.trim());
        p.classList.add('lyrics-line'); 
        p.style.cursor = 'default'; 
        lyricsContainer.appendChild(p);
    });
    setSuccessMessage('メタデータから歌詞をテキストとして表示しました（時間同期なし）。');
}

function displayLyrics() { 
    if (lrcData.length === 0) {
        lyricsContainer.innerHTML = '<p class="text-slate-500">LRC形式の歌詞データが空か、パースに失敗しました。</p>';
        if (!lrcFileEl.files || lrcFileEl.files.length === 0) {
            if (!metadataLyricsSource) { 
                 clearLrcBtn.disabled = true;
                 clearLrcBtn.classList.add('disabled-button');
            }
        }
        return;
    }
    lyricsContainer.innerHTML = '';
    lrcData.forEach((line, index) => {
        const p = document.createElement('p');
        p.textContent = escapeHtml(line.text); 
        p.classList.add('lyrics-line');
        p.dataset.index = index;
        p.dataset.time = line.time; 
        p.addEventListener('click', () => {
            if (audioLoaded && typeof line.time === 'number') {
                audioPlayer.currentTime = line.time;
                if (audioPlayer.paused) audioPlayer.play().catch(e => console.error("Play error on lyric click:", e));
            }
        });
        lyricsContainer.appendChild(p);
    });
    enableClearLrcButton();
}

function updateLyricsHighlight() { 
    const currentTime = audioPlayer.currentTime;
    let newCurrentLineIndex = -1;
    for (let i = lrcData.length - 1; i >= 0; i--) {
        if (currentTime >= lrcData[i].time) {
            newCurrentLineIndex = i;
            break;
        }
    }
    if (newCurrentLineIndex !== currentLrcLineIndex) {
        if (currentLrcLineIndex !== -1) {
            const prevLineEl = lyricsContainer.querySelector(`.lyrics-line[data-index="${currentLrcLineIndex}"]`);
            if (prevLineEl) prevLineEl.classList.remove('highlighted');
        }
        if (newCurrentLineIndex !== -1) {
            const currentLineEl = lyricsContainer.querySelector(`.lyrics-line[data-index="${newCurrentLineIndex}"]`);
            if (currentLineEl) {
                currentLineEl.classList.add('highlighted');
                const containerRect = lyricsContainer.getBoundingClientRect();
                const lineRect = currentLineEl.getBoundingClientRect();
                const lineOffsetTopInContainer = currentLineEl.offsetTop - lyricsContainer.offsetTop;
                const desiredScrollTop = lineOffsetTopInContainer - (containerRect.height / 2) + (lineRect.height / 2);
                lyricsContainer.scrollTop = desiredScrollTop;
            }
        }
        currentLrcLineIndex = newCurrentLineIndex;
    }
}

function formatTime(timeInSeconds) { 
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function formatFileSize(bytes, decimals = 2) { // test.html から移植
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function updateTimeDisplay() { 
    timeDisplay.textContent = `${formatTime(audioPlayer.currentTime)} / ${formatTime(audioPlayer.duration || 0)}`;
}

function showMessage(text, type = 'error') { 
    messageArea.textContent = text;
    messageArea.classList.remove('text-red-400', 'text-green-400', 'text-yellow-400'); 
    if (type === 'error') messageArea.classList.add('text-red-400');
    else if (type === 'success') messageArea.classList.add('text-green-400');
    else if (type === 'warning') messageArea.classList.add('text-yellow-400');
}
function setErrorMessage(message) { showMessage(message, 'error'); }
function setSuccessMessage(message) { showMessage(message, 'success'); }
function setWarningMessage(message) { showMessage(message, 'warning'); }


// 初期化関数の呼び出し
document.addEventListener('DOMContentLoaded', initializePlayer);
