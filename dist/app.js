"use strict";
let audioContext = null;
let midiAccess = null;
let midiInput;
let gameRunning = false;
let score = 0;
let lives = 3;
let circles = [];
let noteOnStack = [];
let chosenKey = "C";
let chosenMode = "major";
let progressionIndex = 0;
let chordIndex = 0;
let showNotes = true;
let lastSpawn = 0;
let activeOscillators = {};
const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const enhMapToSharp = {
    "Bb": "A#", "Eb": "D#", "Ab": "G#", "Db": "C#", "Gb": "F#", "Cb": "B", "Fb": "E"
};
const majorScales = {
    "C": ["C", "D", "E", "F", "G", "A", "B"],
    "G": ["G", "A", "B", "C", "D", "E", "F#"],
    "D": ["D", "E", "F#", "G", "A", "B", "C#"],
    "A": ["A", "B", "C#", "D", "E", "F#", "G#"],
    "E": ["E", "F#", "G#", "A", "B", "C#", "D#"],
    "B": ["B", "C#", "D#", "E", "F#", "G#", "A#"],
    "F#": ["F#", "G#", "A#", "B", "C#", "D#", "E#"],
    "C#": ["C#", "D#", "E#", "F#", "G#", "A#", "B#"],
    "F": ["F", "G", "A", "Bb", "C", "D", "E"],
    "Bb": ["Bb", "C", "D", "Eb", "F", "G", "A"],
    "Eb": ["Eb", "F", "G", "Ab", "Bb", "C", "D"],
    "Ab": ["Ab", "Bb", "C", "Db", "Eb", "F", "G"],
    "Db": ["Db", "Eb", "F", "Gb", "Ab", "Bb", "C"],
    "Gb": ["Gb", "Ab", "Bb", "Cb", "Db", "Eb", "F"]
};
const minorScales = {
    "A": ["A", "B", "C", "D", "E", "F", "G"],
    "E": ["E", "F#", "G", "A", "B", "C", "D"],
    "B": ["B", "C#", "D", "E", "F#", "G", "A"],
    "F#": ["F#", "G#", "A", "B", "C#", "D", "E"],
    "C#": ["C#", "D#", "E", "F#", "G#", "A", "B"],
    "G#": ["G#", "A#", "B", "C#", "D#", "E", "F#"],
    "D#": ["D#", "E#", "F#", "G#", "A#", "B", "C#"],
    "A#": ["A#", "B#", "C#", "D#", "E#", "F#", "G#"],
    "D": ["D", "E", "F", "G", "A", "Bb", "C"],
    "G": ["G", "A", "Bb", "C", "D", "Eb", "F"],
    "C": ["C", "D", "Eb", "F", "G", "Ab", "Bb"],
    "F": ["F", "G", "Ab", "Bb", "C", "Db", "Eb"],
    "Bb": ["Bb", "C", "Db", "Eb", "F", "Gb", "Ab"],
    "Eb": ["Eb", "F", "Gb", "Ab", "Bb", "Cb", "Db"]
};
const degreeMapMajor = { "I": 0, "ii": 1, "iii": 2, "IV": 3, "V": 4, "vi": 5, "vii": 6 };
const degreeMapMinor = { "i": 0, "ii°": 1, "III": 2, "iv": 3, "v": 4, "VI": 5, "VII": 6 };
const degreeQualityMapMajor = {
    "I": "maj", "ii": "min", "iii": "min", "IV": "maj", "V": "maj", "vi": "min", "vii": "dim"
};
const degreeQualityMapMinor = {
    "i": "min", "ii°": "dim", "III": "maj", "iv": "min", "v": "min", "VI": "maj", "VII": "maj"
};
const majorProgressions = [
    ["I", "IV", "V", "I"],
    ["I", "vi", "IV", "V"],
    ["ii", "V", "I", "I"]
];
const minorProgressions = [
    ["i", "iv", "v", "i"],
    ["i", "VI", "III", "VII"],
    ["ii°", "v", "i", "i"]
];
function ensureAudioContext() {
    if (!audioContext) {
        audioContext = new AudioContext();
    }
}
function midiNoteToName(noteNumber) {
    return noteNames[noteNumber % 12];
}
function freqFromMidiNote(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
}
function toSharpName(n) {
    if (enhMapToSharp[n])
        return enhMapToSharp[n];
    return n;
}
function normalizePlayedNote(n) {
    // played notes come in sharps mostly from midiNoteToName, but if needed we can ensure they are in sharp form
    // midiNoteToName never returns flats, so this is fine
    return n;
}
function normalizeChordNote(n) {
    n = toSharpName(n);
    return n;
}
function playNoteSound(noteNumber, velocity) {
    ensureAudioContext();
    let ctx = audioContext;
    let freq = freqFromMidiNote(noteNumber);
    let osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    let gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(velocity / 127 * 0.3, ctx.currentTime);
    osc.connect(gainNode).connect(ctx.destination);
    osc.start();
    activeOscillators[noteNumber] = { osc: osc, gain: gainNode };
}
function stopNoteSound(noteNumber) {
    let oscData = activeOscillators[noteNumber];
    if (oscData) {
        oscData.osc.stop();
        delete activeOscillators[noteNumber];
    }
}
function checkChords() {
    for (let i = circles.length - 1; i >= 0; i--) {
        let c = circles[i];
        if (!c.destroyed) {
            if (chordMatchesPlayedNotes(c.chordNotes, noteOnStack)) {
                playChordSound(c.chordNotes);
                c.destroyed = true;
                score++;
                updateScore();
            }
        }
    }
}
function updateScore() {
    const s = document.getElementById('scoreDisplay');
    if (s)
        s.innerText = "Score: " + score;
}
function updateLives() {
    const l = document.getElementById('livesDisplay');
    if (l)
        l.innerText = "Lives: " + lives;
}
function gameLoop(timestamp) {
    if (!gameRunning)
        return;
    updateCirclesAndSpawn(timestamp);
    requestAnimationFrame(gameLoop);
}
function playChordSound(chord) {
    ensureAudioContext();
    let ctx = audioContext;
    let startTime = ctx.currentTime;
    for (const noteNameStr of chord) {
        let freq = noteNameToFreq(noteNameStr);
        let osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);
        let gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0.3, startTime);
        osc.connect(gainNode).connect(ctx.destination);
        osc.start();
        setTimeout(() => { osc.stop(); }, 300);
    }
}
function noteNameToFreq(name) {
    ensureAudioContext();
    name = toSharpName(name);
    let baseFreq = 440;
    let baseIndex = noteNames.indexOf("A");
    let noteIndex = noteNames.indexOf(name);
    if (noteIndex < 0)
        noteIndex = noteNames.indexOf(name.replace('b', '#'));
    if (noteIndex < 0)
        noteIndex = 0;
    let semitoneDiff = noteIndex - baseIndex;
    return baseFreq * Math.pow(2, semitoneDiff / 12);
}
function onMIDIMessage(event) {
    const data = event.data;
    if (!data || data.length < 3)
        return;
    const arr = data;
    const [status, note, velocity] = arr;
    if (status >= 0x90 && status <= 0x9f && velocity > 0) {
        let noteNameStr = midiNoteToName(note);
        noteNameStr = normalizePlayedNote(noteNameStr);
        noteOnStack.push(noteNameStr);
        playNoteSound(note, velocity);
        checkChords();
    }
    if ((status >= 0x80 && status <= 0x8f) || (status >= 0x90 && status <= 0x9f && velocity === 0)) {
        let noteNameStr = midiNoteToName(note);
        noteNameStr = normalizePlayedNote(noteNameStr);
        let idx = noteOnStack.indexOf(noteNameStr);
        if (idx > -1)
            noteOnStack.splice(idx, 1);
        stopNoteSound(note);
    }
}
function chordMatchesPlayedNotes(chord, played) {
    if (chord.length !== played.length)
        return false;
    // normalize chord and played notes to sharps so they match
    let normalizedChord = chord.map(n => normalizeChordNote(n));
    let normalizedPlayed = played.map(n => toSharpName(n));
    let chordSet = new Set(normalizedChord);
    let playedSet = new Set(normalizedPlayed);
    if (chordSet.size !== playedSet.size)
        return false;
    for (let note of chordSet) {
        if (!playedSet.has(note))
            return false;
    }
    return true;
}
function chordDegreesToChordNotes(key, degree, mode) {
    const scale = mode === "major" ? majorScales[key] : minorScales[key];
    const degMap = mode === "major" ? degreeMapMajor : degreeMapMinor;
    const root = scale[degMap[degree]];
    const third = scale[(degMap[degree] + 2) % 7];
    const fifth = scale[(degMap[degree] + 4) % 7];
    return [root, third, fifth];
}
function getNextChordName() {
    const progressions = chosenMode === "major" ? majorProgressions : minorProgressions;
    let progression = progressions[progressionIndex];
    let chordName = progression[chordIndex];
    chordIndex++;
    if (chordIndex >= progression.length) {
        chordIndex = 0;
        progressionIndex = (progressionIndex + 1) % progressions.length;
    }
    return chordName;
}
function getChordFullName(key, degree, originalChord, finalChord, inversion, mode) {
    const qmap = mode === "major" ? degreeQualityMapMajor : degreeQualityMapMinor;
    const quality = qmap[degree];
    const root = originalChord[0];
    let chordName = `${root} ${quality}`;
    if (inversion > 0) {
        chordName = chordName.split(' ')[0];
        chordName += `/${finalChord[0]}`;
    }
    return chordName;
}
function invertChord(notes, inversion) {
    let arr = notes.slice();
    for (let i = 0; i < inversion; i++) {
        let x = arr.shift();
        if (x)
            arr.push(x);
    }
    return arr;
}
function voiceLeadingDistance(ch1, ch2) {
    let dist = 0;
    for (let i = 0; i < ch1.length; i++) {
        dist += noteDistance(ch1[i], ch2[i]);
    }
    return dist;
}
function noteDistance(a, b) {
    const enhToSharp = (n) => {
        const map = { "Bb": "A#", "Eb": "D#", "Ab": "G#", "Db": "C#", "Gb": "F#", "Cb": "B", "Fb": "E" };
        return map[n] || n;
    };
    let A = enhToSharp(a);
    let B = enhToSharp(b);
    let iA = noteNames.indexOf(A);
    let iB = noteNames.indexOf(B);
    if (iA < 0 || iB < 0)
        return 12;
    let d = Math.abs(iA - iB);
    if (d > 6)
        d = 12 - d;
    return d;
}
function closestInversion(prevChord, chord) {
    if (!prevChord)
        return { inv: chord, inversion: 0 };
    let candidates = [];
    for (let i = 0; i < chord.length; i++) {
        let inv = invertChord(chord, i);
        let dist = voiceLeadingDistance(prevChord, inv);
        candidates.push({ inv: inv, dist: dist, inversion: i });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    return { inv: candidates[0].inv, inversion: candidates[0].inversion };
}
function generateChordCircle() {
    let chordDegree = getNextChordName();
    let originalChord = chordDegreesToChordNotes(chosenKey, chordDegree, chosenMode);
    originalChord = originalChord.map(n => normalizeChordNote(n));
    let lastChord = circles.length > 0 ? circles[circles.length - 1].chordNotes : null;
    let ci = closestInversion(lastChord, originalChord);
    let invertedChord = ci.inv.map(n => normalizeChordNote(n));
    let chordFullName = getChordFullName(chosenKey, chordDegree, originalChord, invertedChord, ci.inversion, chosenMode);
    let element = document.createElement('div');
    element.className = 'chordCircle';
    let htmlContent = `<div>${chordDegree}</div><div>${chordFullName}</div>`;
    if (showNotes) {
        htmlContent += `<div>${invertedChord.join("-")}</div>`;
    }
    element.innerHTML = htmlContent;
    const gameArea = document.getElementById('gameArea');
    element.style.left = (Math.random() * (window.innerWidth - 100)) + "px";
    element.style.top = "-100px";
    gameArea.appendChild(element);
    circles.push({ element: element, chordName: chordDegree, chordNotes: invertedChord, y: -100, speed: 1 + Math.random(), destroyed: false });
}
function updateCircles() {
    for (let i = circles.length - 1; i >= 0; i--) {
        let c = circles[i];
        if (!c.destroyed) {
            c.y += c.speed;
            c.element.style.top = c.y + "px";
            if (c.y > (window.innerHeight - 50)) {
                if (c.element.parentNode)
                    c.element.parentNode.removeChild(c.element);
                circles.splice(i, 1);
                lives--;
                updateLives();
                if (lives <= 0)
                    endGame();
            }
        }
        else {
            if (c.element.parentNode)
                c.element.parentNode.removeChild(c.element);
            circles.splice(i, 1);
        }
    }
}
function updateCirclesAndSpawn(timestamp) {
    updateCircles();
    if (timestamp - lastSpawn > 3000) {
        generateChordCircle();
        lastSpawn = timestamp;
    }
}
function endGame() {
    gameRunning = false;
    const finalScore = document.getElementById('finalScore');
    if (finalScore)
        finalScore.innerText = "Your score: " + score;
    const gameScreen = document.getElementById('gameScreen');
    const endScreen = document.getElementById('endScreen');
    if (gameScreen)
        gameScreen.classList.remove('active');
    if (endScreen)
        endScreen.classList.add('active');
    stopAllSounds();
}
function stopAllSounds() {
    for (let note in activeOscillators) {
        let oscData = activeOscillators[note];
        oscData.osc.stop();
    }
    activeOscillators = {};
}
function startGame() {
    const select = document.getElementById('midiSelect');
    const keySel = document.getElementById('keySelect');
    const notesCheck = document.getElementById('showNotesCheckbox');
    if (notesCheck)
        showNotes = notesCheck.checked;
    if (keySel)
        chosenKey = keySel.value;
    const modeInputs = document.querySelectorAll('input[name="mode"]');
    modeInputs.forEach(m => { if (m.checked)
        chosenMode = m.value; });
    const selectedId = select ? select.value : "";
    let inputs = [];
    midiAccess.inputs.forEach((input) => { inputs.push(input); });
    midiInput = inputs.find((i) => i.id === selectedId);
    if (midiInput)
        midiInput.onmidimessage = onMIDIMessage;
    score = 0;
    lives = 3;
    updateScore();
    updateLives();
    const setupScreen = document.getElementById('setupScreen');
    const gameScreen = document.getElementById('gameScreen');
    const endScreen = document.getElementById('endScreen');
    if (setupScreen)
        setupScreen.classList.remove('active');
    if (gameScreen)
        gameScreen.classList.add('active');
    if (endScreen)
        endScreen.classList.remove('active');
    circles = [];
    gameRunning = true;
    progressionIndex = 0;
    chordIndex = 0;
    lastSpawn = 0;
    requestAnimationFrame(gameLoop);
}
function populateMIDIInputs() {
    const select = document.getElementById('midiSelect');
    if (!select)
        return;
    select.innerHTML = "";
    let inputs = [];
    midiAccess.inputs.forEach((input) => { inputs.push(input); });
    if (inputs.length === 0) {
        let option = document.createElement('option');
        option.innerText = "No MIDI devices found";
        select.appendChild(option);
    }
    else {
        inputs.forEach((input) => {
            let option = document.createElement('option');
            option.value = input.id;
            option.innerText = input.name || "";
            select.appendChild(option);
        });
    }
}
const startButton = document.getElementById('startButton');
if (startButton)
    startButton.addEventListener('click', startGame);
const restartButton = document.getElementById('restartButton');
if (restartButton)
    restartButton.addEventListener('click', () => {
        const setupScreen = document.getElementById('setupScreen');
        const gameScreen = document.getElementById('gameScreen');
        const endScreen = document.getElementById('endScreen');
        if (setupScreen)
            setupScreen.classList.add('active');
        if (gameScreen)
            gameScreen.classList.remove('active');
        if (endScreen)
            endScreen.classList.remove('active');
    });
if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then((access) => {
        midiAccess = access;
        populateMIDIInputs();
    });
}
