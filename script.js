const API_KEY = 'AIzaSyACE-0Rptd3iNetYGrMKj-AkRf4Shut0jU';
const MODEL = 'gemini-1.5-flash';

let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let startTime;
let timerInterval;
let currentChart = null;
let recognition = null;
let transcriptionText = '';
let historyItems = JSON.parse(localStorage.getItem('emotionHistory') || '[]');

document.addEventListener('DOMContentLoaded', () => {
    initializeTabs();
    initializeRecording();
    initializeUpload();
    initializeSpeechRecognition();
    updateHistoryDisplay();
});

function initializeTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const tabContents = document.querySelectorAll('.tab-content');
            tabContents.forEach(content => content.style.display = 'none');
            
            const targetTab = document.getElementById(`${tab.dataset.tab}-tab`);
            targetTab.style.display = 'block';
        });
    });
}

function initializeRecording() {
    const recordBtn = document.getElementById('recordBtn');
    const stopBtn = document.getElementById('stopBtn');
    
    recordBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', stopRecording);
}

async function startRecording() {
    try {
        transcriptionText = '';
        updateTranscriptionText('');
        
        // Start speech recognition
        if (recognition) {
            recognition.start();
        }
        
        // Start audio recording
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            document.getElementById('finalTranscription').textContent = transcriptionText;
            
            // Process audio for emotion analysis
            await analyzeEmotion(audioBlob);
            
            // Display results
            document.querySelector('.results-container').style.display = 'block';
            
            // Set audio player source
            const audioUrl = URL.createObjectURL(audioBlob);
            const audioPlayer = document.getElementById('audioPlayer');
            audioPlayer.src = audioUrl;
        };

        mediaRecorder.start();
        isRecording = true;
        startTime = Date.now();
        updateTimer();
        
        document.getElementById('recordBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
        
    } catch (error) {
        console.error('Error starting recording:', error);
        alert('Error starting recording. Please make sure you have granted microphone permissions.');
    }
}

function stopRecording() {
    if (recognition) {
        recognition.stop();
    }
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        clearInterval(timerInterval);
        
        document.getElementById('recordBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
}

function updateTimer() {
    const timerElement = document.querySelector('.timer');
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }, 1000);
}

async function processRecording() {
    const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
    const audioUrl = URL.createObjectURL(audioBlob);
    
    const audioPlayer = document.getElementById('audioPlayer');
    audioPlayer.src = audioUrl;
    
    document.querySelector('.results-container').style.display = 'block';
    
    await analyzeEmotion(audioBlob);
    saveToHistory(audioUrl);
}

async function analyzeEmotion(audioBlob) {
    try {
        const base64Audio = await blobToBase64(audioBlob);
        
        const prompt = `Analyze this audio and provide emotion scores. IMPORTANT RULES:
        1. Make Neutral score very low (maximum 10%)
        2. Make one emotion clearly dominant (at least 40%)
        3. Format response EXACTLY like this:
        Happiness: [score]
        Sadness: [score]
        Anger: [score]
        Fear: [score]
        Surprise: [score]
        Disgust: [score]
        Neutral: [score]
        
        WINNER: [dominant emotion]

        Only provide the scores and winner, no other text.`;
            
        const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }, {
                        inline_data: {
                            mime_type: "audio/wav",
                            data: base64Audio
                        }
                    }]
                }],
                generationConfig: {
                    temperature: 0.9,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 100,
                }
            })
        });

        const data = await response.json();
        console.log('Gemini API Response:', data);

        if (data.candidates && data.candidates[0].content) {
            const results = parseEmotionResults(data.candidates[0].content.parts[0].text);
            displayResults(results);
        } else {
            throw new Error('Invalid API response format');
        }
    } catch (error) {
        console.error('Error analyzing emotion:', error);
        alert('Error analyzing emotion. Please try again.');
    }
}

function parseEmotionResults(text) {
    try {
        console.log('Parsing text:', text);
        
        const lines = text.trim().split('\n');
        const emotions = {};
        let winner = '';
        let total = 0;

        // Parse each emotion score
        lines.forEach(line => {
            const match = line.match(/^([A-Za-z]+):\s*(\d+)/);
            if (match) {
                const [, emotion, score] = match;
                emotions[emotion.toLowerCase()] = parseInt(score);
                total += parseInt(score);
            } else if (line.startsWith('WINNER:')) {
                winner = line.split(':')[1].trim();
            }
        });

        // Validate results
        if (!emotions || Object.keys(emotions).length === 0) {
            throw new Error('No emotion scores found');
        }

        if (emotions.neutral > 10) {
            // Redistribute excess neutral score
            const excess = emotions.neutral - 10;
            emotions.neutral = 10;
            const nonNeutralEmotions = Object.keys(emotions).filter(e => e !== 'neutral');
            const distribution = excess / nonNeutralEmotions.length;
            nonNeutralEmotions.forEach(emotion => {
                emotions[emotion] += distribution;
            });
        }

        // Normalize scores to total 100%
        const scaleFactor = 100 / Object.values(emotions).reduce((a, b) => a + b, 0);
        Object.keys(emotions).forEach(emotion => {
            emotions[emotion] = Math.round(emotions[emotion] * scaleFactor);
        });

        // Find the actual highest scoring emotion
        const highestEmotion = Object.entries(emotions).reduce(
            (max, [emotion, score]) => score > max[1] ? [emotion, score] : max,
            ['', 0]
        )[0];

        // Ensure at least one emotion is 40% or higher
        if (Math.max(...Object.values(emotions)) < 40) {
            const boost = 40 - emotions[highestEmotion];
            emotions[highestEmotion] += boost;
            
            // Reduce other emotions proportionally
            const otherEmotions = Object.keys(emotions).filter(e => e !== highestEmotion);
            const reduction = boost / otherEmotions.length;
            otherEmotions.forEach(emotion => {
                emotions[emotion] = Math.max(0, emotions[emotion] - reduction);
            });
        }

        // Use the actual highest emotion as winner
        winner = highestEmotion;

        return {
            emotions,
            winner
        };
    } catch (error) {
        console.error('Error parsing emotion results:', error);
        throw new Error('Failed to parse emotion results');
    }
}

function displayResults(results) {
    if (currentChart) {
        currentChart.destroy();
    }

    const ctx = document.getElementById('emotionChart').getContext('2d');
    currentChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: Object.keys(results.emotions),
            datasets: [{
                label: 'Emotion Intensity',
                data: Object.values(results.emotions),
                backgroundColor: 'rgba(108, 99, 255, 0.2)',
                borderColor: 'rgba(108, 99, 255, 1)',
                pointBackgroundColor: 'rgba(108, 99, 255, 1)',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgba(108, 99, 255, 1)'
            }]
        },
        options: {
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100
                }
            }
        }
    });

    const emotionList = document.querySelector('.emotion-list');
    emotionList.innerHTML = '';
    Object.entries(results.emotions)
        .forEach(([emotion, value]) => {
            const emotionItem = document.createElement('div');
            emotionItem.className = 'emotion-item';
            emotionItem.innerHTML = `
                <span class="emotion-label">${emotion}</span>
                <span class="emotion-value">${value}%</span>
            `;
            emotionList.appendChild(emotionItem);
        });

    // Add verdict
    const resultContainer = document.querySelector('.results-container');
    const existingVerdict = resultContainer.querySelector('.emotion-verdict');
    if (existingVerdict) {
        existingVerdict.remove();
    }
    
    const verdictDiv = document.createElement('div');
    verdictDiv.className = 'emotion-verdict';
    verdictDiv.innerHTML = `
        <h4>Verdict</h4>
        <div class="verdict-content">
            <i class="fas ${getEmotionIcon(results.winner)}"></i>
            <span>${results.winner}</span>
        </div>
    `;
    resultContainer.insertBefore(verdictDiv, resultContainer.querySelector('.results-grid'));
}

function getEmotionIcon(emotion) {
    const icons = {
        happiness: 'fa-smile-beam',
        sadness: 'fa-sad-tear',
        anger: 'fa-angry',
        fear: 'fa-fear',
        surprise: 'fa-surprise',
        disgust: 'fa-dizzy',
        neutral: 'fa-meh'
    };
    return icons[emotion] || 'fa-question';
}

function initializeUpload() {
    const dropZone = document.querySelector('.drop-zone');
    const fileInput = document.getElementById('fileInput');
    
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('audio/')) {
            handleFileUpload(file);
        } else {
            alert('Please upload an audio file.');
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleFileUpload(file);
        }
    });
}

async function handleFileUpload(file) {
    if (!file || !file.type.startsWith('audio/')) {
        alert('Please upload an audio file');
        return;
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(e.target.result);
        
        // Convert to WAV blob
        const audioBlob = await audioBufferToWav(audioBuffer);
        
        // Start transcription
        try {
            const transcript = await transcribeAudio(audioBlob);
            document.getElementById('transcriptionText').textContent = transcript;
            document.getElementById('finalTranscription').textContent = transcript;
            
            // Process audio for emotion analysis
            await analyzeEmotion(audioBlob);
            
            // Save to history
            const emotions = currentChart.data.datasets[0].data;
            saveToHistory(audioBlob, transcript, {
                happiness: emotions[0],
                sadness: emotions[1],
                anger: emotions[2],
                fear: emotions[3],
                surprise: emotions[4],
                disgust: emotions[5],
                neutral: emotions[6],
                winner: document.querySelector('.emotion-verdict span').textContent
            });
            
            // Display results
            document.querySelector('.results-container').style.display = 'block';
            
            // Set audio player source
            const audioUrl = URL.createObjectURL(audioBlob);
            const audioPlayer = document.getElementById('audioPlayer');
            audioPlayer.src = audioUrl;
        } catch (error) {
            console.error('Error processing audio:', error);
            alert('Error processing audio file. Please try again.');
        }
    };
    reader.readAsArrayBuffer(file);
}

// Convert AudioBuffer to WAV Blob
function audioBufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2;
    const buffer16Bit = new Int16Array(length);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < buffer.length; i++) {
        const sample = Math.max(-1, Math.min(1, data[i]));
        buffer16Bit[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    
    const wavBuffer = new ArrayBuffer(44 + buffer16Bit.length * 2);
    const view = new DataView(wavBuffer);
    
    // Write WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + buffer16Bit.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numOfChan, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, numOfChan * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, buffer16Bit.length * 2, true);
    
    // Write PCM data
    const length16 = buffer16Bit.length;
    let index = 44;
    for (let i = 0; i < length16; i++) {
        view.setInt16(index, buffer16Bit[i], true);
        index += 2;
    }
    
    return new Blob([wavBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

async function transcribeAudio(audioBlob) {
    // Use the Web Speech API for transcription
    return new Promise((resolve, reject) => {
        const recognition = new webkitSpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        
        let finalTranscript = '';
        
        recognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript + ' ';
                }
            }
        };
        
        recognition.onerror = (event) => {
            reject(new Error('Transcription error: ' + event.error));
        };
        
        recognition.onend = () => {
            resolve(finalTranscript || 'No speech detected');
        };
        
        // Convert blob to audio element and play it for transcription
        const audio = new Audio(URL.createObjectURL(audioBlob));
        audio.addEventListener('ended', () => recognition.stop());
        
        recognition.start();
        audio.play();
    });
}

function saveToHistory(audioBlob, transcript, emotions) {
    const timestamp = new Date().toISOString();
    const historyItem = {
        id: Date.now(),
        timestamp,
        transcript,
        emotions,
        audioUrl: URL.createObjectURL(audioBlob)
    };
    
    historyItems.unshift(historyItem);
    // Keep only last 10 items
    historyItems = historyItems.slice(0, 10);
    localStorage.setItem('emotionHistory', JSON.stringify(historyItems));
    updateHistoryDisplay();
}

function updateHistoryDisplay() {
    const historyList = document.querySelector('.history-list');
    historyList.innerHTML = '';
    
    historyItems.forEach(item => {
        const date = new Date(item.timestamp).toLocaleString();
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';
        historyItem.innerHTML = `
            <div class="history-header">
                <span class="history-date">${date}</span>
                <button class="history-play-btn" onclick="playHistoryAudio('${item.audioUrl}')">
                    <i class="fas fa-play"></i>
                </button>
            </div>
            <div class="history-transcript">${item.transcript}</div>
            <div class="history-emotion">Dominant: ${item.emotions.winner}</div>
        `;
        historyList.appendChild(historyItem);
    });
}

function playHistoryAudio(audioUrl) {
    const audioPlayer = document.getElementById('audioPlayer');
    audioPlayer.src = audioUrl;
    audioPlayer.play();
}

function initializeSpeechRecognition() {
    if ('webkitSpeechRecognition' in window) {
        recognition = new webkitSpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        
        recognition.onstart = () => {
            document.querySelector('.status-dot').classList.add('recording');
            document.querySelector('.status-text').textContent = 'Recording...';
            updateTranscriptionText('Listening...');
        };

        recognition.onend = () => {
            document.querySelector('.status-dot').classList.remove('recording');
            document.querySelector('.status-text').textContent = 'Ready';
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript + ' ';
                } else {
                    interimTranscript += transcript;
                }
            }

            if (finalTranscript) {
                transcriptionText += finalTranscript;
                updateTranscriptionText(transcriptionText + interimTranscript);
            } else {
                updateTranscriptionText(transcriptionText + interimTranscript);
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            document.querySelector('.status-text').textContent = 'Error: ' + event.error;
        };
    } else {
        alert('Speech recognition is not supported in this browser. Please use Chrome.');
    }
}

function updateTranscriptionText(text) {
    const transcriptionElement = document.getElementById('transcriptionText');
    transcriptionElement.textContent = text;
    
    // Update word count
    const wordCount = text.trim().split(/\s+/).length;
    document.getElementById('wordCount').textContent = wordCount;
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64String = reader.result.split(',')[1];
            resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
