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
let showFunctions = false;
let lastSpawn = 0;
let lastFrameTime = 0;
let activeOscillators = {};
let selectedLevel = 4;
let circleSpawnCount = 0;
const noteNames = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"
];
const enhMapToSharp = {
    "Bb": "A#", "Eb": "D#", "Ab": "G#", "Db": "C#", "Gb": "F#", "Cb": "B", "Fb": "E",
    // The C#/F# major and D#/A# minor scales below spell their 3rd/7th
    // degrees as E#/B# (standard music notation for those keys), but
    // MIDI-derived note names (midiNoteToName) only ever produce the 12
    // noteNames spellings -- "F"/"C" never "E#"/"B#". Without these, a
    // correctly-played chord in one of those keys could never match,
    // since the chord spec's note names and the played notes' names
    // would never normalize to the same string. This was TODO.org's
    // "not recognising F as E#" bug.
    "E#": "F", "B#": "C"
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
const degreeMapMajor = {
    "I": 0, "ii": 1, "iii": 2, "IV": 3, "V": 4, "vi": 5, "vii": 6
};
const degreeMapMinor = {
    "i": 0, "ii°": 1, "III": 2, "iv": 3, "v": 4, "VI": 5, "VII": 6
};
const degreeQualityMapMajor = {
    "I": "maj", "ii": "min", "iii": "min", "IV": "maj", "V": "maj", "vi": "min", "vii": "dim"
};
const degreeQualityMapMinor = {
    "i": "min", "ii°": "dim", "III": "maj", "iv": "min", "v": "min", "VI": "maj", "VII": "maj"
};
const degreeSeventhQualityMapMajor = {
    "I": "maj7", "ii": "min7", "iii": "min7", "IV": "maj7", "V": "dom7", "vi": "min7", "vii": "hdim7"
};
const degreeSeventhQualityMapMinor = {
    "i": "min7", "ii°": "hdim7", "III": "maj7", "iv": "min7", "v": "min7", "VI": "maj7", "VII": "dom7"
};
const degreeNinthQualityMapMajor = {
    "I": "maj9", "ii": "min9", "iii": "min9", "IV": "maj9", "V": "dom9", "vi": "min9", "vii": "hdim9"
};
const degreeNinthQualityMapMinor = {
    "i": "min9", "ii°": "hdim9", "III": "maj9", "iv": "min9", "v": "min9", "VI": "maj9", "VII": "dom9"
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
    if (!audioContext)
        audioContext = new AudioContext();
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
function normalizeChordNote(n) {
    return toSharpName(n);
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
function onMIDIMessage(event) {
    let arr = event.data;
    if (!arr || arr.length < 3)
        return;
    const status = arr[0];
    const midiNumber = arr[1];
    const velocity = arr[2];
    if (status >= 0x90 && status <= 0x9f && velocity > 0) {
        let noteName = midiNoteToName(midiNumber);
        noteOnStack.push({ noteName, midiNumber });
        playNoteSound(midiNumber, velocity);
        checkChords();
    }
    else if ((status >= 0x80 && status <= 0x8f) || (status >= 0x90 && status <= 0x9f && velocity === 0)) {
        let idx = noteOnStack.findIndex(obj => obj.midiNumber === midiNumber);
        if (idx > -1)
            noteOnStack.splice(idx, 1);
        stopNoteSound(midiNumber);
        // checkChords() must run here too, not just on note-on: if the player
        // adds an extra wrong note alongside the correct ones and then
        // releases just that wrong note (rather than pressing another note),
        // the chord only becomes correct as a result of this release. Without
        // this, that completion was never detected until some unrelated
        // note-on happened later, if ever -- the "continuous note" bug from
        // TODO.org, which only showed up on the wrong-note path since a
        // chord played with only correct notes always completes via a
        // note-on and never needs the release to be checked.
        checkChords();
    }
}
function checkChords() {
    for (let i = circles.length - 1; i >= 0; i--) {
        let c = circles[i];
        if (!c.destroyed) {
            if (selectedLevel === 4) {
                if (matchesLevel4(c.noteOrChordNotes)) {
                    playChordSound(c.noteOrChordNotes);
                    flashMatch(c.element);
                    c.destroyed = true;
                    score++;
                    updateScore();
                }
            }
            else if (selectedLevel === 5) {
                if (matchesLevel5(c.noteOrChordNotes)) {
                    playChordSound(c.noteOrChordNotes);
                    flashMatch(c.element);
                    c.destroyed = true;
                    score++;
                    updateScore();
                }
            }
            else if (selectedLevel >= 6) {
                if (matchesLevel1to3(c.noteOrChordNotes)) {
                    playChordSound(c.noteOrChordNotes);
                    flashMatch(c.element);
                    c.destroyed = true;
                    score++;
                    updateScore();
                }
            }
            else {
                if (matchesLevel1to3(c.noteOrChordNotes)) {
                    playChordSound(c.noteOrChordNotes);
                    flashMatch(c.element);
                    c.destroyed = true;
                    score++;
                    updateScore();
                }
            }
        }
    }
}
function matchesLevel1to3(chordNotes) {
    if (chordNotes.length !== noteOnStack.length)
        return false;
    let chordSet = new Set(chordNotes.map(normalizeChordNote));
    let playedSet = new Set(noteOnStack.map(o => toSharpName(midiNoteToName(o.midiNumber))));
    if (chordSet.size !== playedSet.size)
        return false;
    for (let note of chordSet) {
        if (!playedSet.has(note))
            return false;
    }
    return true;
}
function matchesLevel4(chordNotes) {
    if (chordNotes.length !== noteOnStack.length)
        return false;
    let chordAsc = chordNotes
        .map(normalizeChordNote)
        .sort((a, b) => noteNames.indexOf(a) - noteNames.indexOf(b));
    let playedAsc = [...noteOnStack].sort((a, b) => a.midiNumber - b.midiNumber);
    for (let i = 0; i < chordAsc.length; i++) {
        let playedName = toSharpName(midiNoteToName(playedAsc[i].midiNumber));
        if (chordAsc[i] !== playedName)
            return false;
    }
    return true;
}
function matchesLevel5(chordNotes) {
    if (chordNotes.length !== noteOnStack.length)
        return false;
    let playedAsc = [...noteOnStack].sort((a, b) => a.midiNumber - b.midiNumber);
    for (let i = 0; i < chordNotes.length; i++) {
        let cNote = toSharpName(chordNotes[i]);
        let pNote = toSharpName(midiNoteToName(playedAsc[i].midiNumber));
        if (cNote !== pNote)
            return false;
    }
    if (playedAsc.length >= 2) {
        let bassMidi = playedAsc[0].midiNumber;
        let secondMidi = playedAsc[1].midiNumber;
        if (bassMidi > secondMidi)
            return false;
        //    if(secondMidi- bassMidi<12) return false;
    }
    return true;
}
function updateScore() {
    let s = document.getElementById('scoreDisplay');
    if (s)
        s.innerText = "Score: " + score;
}
function updateLives() {
    let l = document.getElementById('livesDisplay');
    if (l)
        l.innerText = "Lives: " + lives;
}
// --- Correct/miss feedback ---
// Previously a correct match had a chime (playChordSound) and the circle
// vanishing; a missed circle had nothing at all -- no visual or audio cue
// that anything had gone wrong, just the lives counter silently ticking
// down. These are deliberately decoupled from the falling-circle
// removal/scoring logic (self-contained elements/classes that clean up
// after themselves via setTimeout) so they can't affect gameplay timing.
/** Brief "pop" at a matched circle's position -- a new, throwaway element, not the circle itself, so it can't interfere with updateCircles' own removal timing. */
function flashMatch(circleElement) {
    let gameArea = document.getElementById('gameArea');
    if (!gameArea)
        return;
    let pop = document.createElement('div');
    pop.className = 'matchPop';
    pop.style.left = circleElement.style.left;
    pop.style.top = circleElement.style.top;
    gameArea.appendChild(pop);
    setTimeout(() => { if (pop.parentNode)
        pop.parentNode.removeChild(pop); }, 400);
}
/** Brief red pulse around the play area when a circle is missed. */
function flashMiss() {
    let gameArea = document.getElementById('gameArea');
    if (!gameArea)
        return;
    gameArea.classList.add('missFlash');
    setTimeout(() => gameArea.classList.remove('missFlash'), 300);
}
/** Short, deliberately unpleasant buzz for a miss -- distinct from playChordSound's chime. */
function playMissSound() {
    ensureAudioContext();
    let ctx = audioContext;
    let startTime = ctx.currentTime;
    let osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, startTime);
    let gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.15, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);
    osc.connect(gainNode).connect(ctx.destination);
    osc.start();
    setTimeout(() => osc.stop(), 220);
}
// Reference frame interval (60fps) that circle speed values are tuned
// against -- see updateCircles' deltaFactor.
const REFERENCE_FRAME_MS = 1000 / 60;
// Caps a single frame's delta so a backgrounded/throttled tab (rAF pauses
// while hidden; `timestamp` can jump by seconds on refocus) doesn't teleport
// circles instead of just resuming normally.
const MAX_FRAME_DELTA_MS = REFERENCE_FRAME_MS * 5;
function gameLoop(timestamp) {
    if (!gameRunning)
        return;
    let deltaMs = lastFrameTime === 0 ? REFERENCE_FRAME_MS : Math.min(timestamp - lastFrameTime, MAX_FRAME_DELTA_MS);
    lastFrameTime = timestamp;
    updateCirclesAndSpawn(timestamp, deltaMs);
    requestAnimationFrame(gameLoop);
}
function playChordSound(chord) {
    ensureAudioContext();
    let ctx = audioContext;
    let startTime = ctx.currentTime;
    for (const n of chord) {
        let freq = noteNameToFreq(n);
        let osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);
        let gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0.3, startTime);
        osc.connect(gainNode).connect(ctx.destination);
        osc.start();
        setTimeout(() => osc.stop(), 300);
    }
}
function noteNameToFreq(name) {
    ensureAudioContext();
    let sharps = toSharpName(name);
    let baseIndex = noteNames.indexOf("A");
    let noteIndex = noteNames.indexOf(sharps);
    if (noteIndex < 0)
        noteIndex = noteNames.indexOf(sharps.replace('b', '#'));
    if (noteIndex < 0)
        noteIndex = 0;
    let semitoneDiff = noteIndex - baseIndex;
    return 440 * Math.pow(2, semitoneDiff / 12);
}
function chordDegreesToChordNotes(key, degree, mode) {
    let scale = (mode === "major" ? majorScales[key] : minorScales[key]) || [];
    let degMap = (mode === "major" ? degreeMapMajor : degreeMapMinor);
    let idx = degMap[degree];
    if (idx === undefined)
        return ["C", "E", "G"];
    let root = scale[idx];
    let third = scale[(idx + 2) % 7];
    let fifth = scale[(idx + 4) % 7];
    return [root, third, fifth].map(normalizeChordNote);
}
function chordQualityToIntervals(quality) {
    switch (quality) {
        case "maj":
            return [0, 4, 7];
        case "min":
            return [0, 3, 7];
        case "dim":
            return [0, 3, 6];
        case "aug":
            return [0, 4, 8];
        case "dom7":
            return [0, 4, 7, 10];
        case "maj7":
            return [0, 4, 7, 11];
        case "min7":
            return [0, 3, 7, 10];
        case "hdim7":
            return [0, 3, 6, 10];
        case "dim7":
            return [0, 3, 6, 9];
        case "maj9":
            return [0, 4, 7, 11, 14];
        case "min9":
            return [0, 3, 7, 10, 14];
        case "dom9":
            return [0, 4, 7, 10, 14];
        case "hdim9":
            return [0, 3, 6, 10, 14];
        default:
            return [0, 4, 7];
    }
}
function chordQualityToLabel(quality) {
    switch (quality) {
        case "maj":
            return "";
        case "min":
            return "m";
        case "dim":
            return "dim";
        case "aug":
            return "aug";
        case "dom7":
            return "7";
        case "maj7":
            return "maj7";
        case "min7":
            return "m7";
        case "hdim7":
            return "m7b5";
        case "dim7":
            return "dim7";
        case "maj9":
            return "maj9";
        case "min9":
            return "m9";
        case "dom9":
            return "9";
        case "hdim9":
            return "m9b5";
        default:
            return "";
    }
}
function buildChordFromRoot(root, quality) {
    let rootSharp = toSharpName(root);
    let rootIndex = noteNames.indexOf(rootSharp);
    if (rootIndex < 0)
        rootIndex = 0;
    let intervals = chordQualityToIntervals(quality);
    return intervals.map(semi => noteNames[(rootIndex + semi) % 12]);
}
function getTriadQuality(degree) {
    let mapRef = (chosenMode === "major" ? degreeQualityMapMajor : degreeQualityMapMinor);
    return mapRef[degree] || "maj";
}
function getSeventhQuality(degree) {
    let mapRef = (chosenMode === "major" ? degreeSeventhQualityMapMajor : degreeSeventhQualityMapMinor);
    return mapRef[degree] || "dom7";
}
function getNinthQuality(degree) {
    let mapRef = (chosenMode === "major" ? degreeNinthQualityMapMajor : degreeNinthQualityMapMinor);
    return mapRef[degree] || "dom9";
}
function isDominantDegree(degree) {
    let clean = degree.replace("°", "");
    return clean === "V" || clean === "v";
}
function chooseLevel8Quality(degree) {
    let baseQuality = getTriadQuality(degree);
    let options = [baseQuality];
    if (baseQuality === "maj") {
        options.push("maj7", "maj9");
    }
    else if (baseQuality === "min") {
        options.push("min7", "min9");
    }
    else if (baseQuality === "dim") {
        options.push("hdim7", "hdim9", "dim7");
    }
    if (isDominantDegree(degree)) {
        options.push("dom7", "dom9");
    }
    if (Math.random() < 0.2) {
        options.push("aug");
    }
    if (Math.random() < 0.15 && baseQuality !== "dim") {
        options.push("dim");
    }
    return options[Math.floor(Math.random() * options.length)];
}
function getChordRootFromDegree(key, degree, mode) {
    let scale = (mode === "major" ? majorScales[key] : minorScales[key]) || [];
    let degMap = (mode === "major" ? degreeMapMajor : degreeMapMinor);
    let idx = degMap[degree];
    if (idx === undefined)
        return "C";
    return scale[idx] || "C";
}
function getChordSpecForLevel(degree) {
    let root = getChordRootFromDegree(chosenKey, degree, chosenMode);
    let quality;
    if (selectedLevel === 6) {
        quality = getSeventhQuality(degree);
    }
    else if (selectedLevel === 7) {
        quality = Math.random() < 0.5 ? "dim" : "aug";
    }
    else if (selectedLevel === 8) {
        quality = chooseLevel8Quality(degree);
    }
    else {
        quality = getTriadQuality(degree);
    }
    let notes = buildChordFromRoot(root, quality);
    return { root, quality, notes };
}
function getProgressions() {
    return (chosenMode === "major" ? majorProgressions : minorProgressions);
}
function getNextChordName() {
    let p = getProgressions();
    let progression = p[progressionIndex];
    let chordName = progression[chordIndex];
    chordIndex++;
    if (chordIndex >= progression.length) {
        chordIndex = 0;
        progressionIndex = (progressionIndex + 1) % p.length;
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
    let A = toSharpName(a);
    let B = toSharpName(b);
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
function getNextSingleNote() {
    let scale = (chosenMode === "major" ? majorScales[chosenKey] : minorScales[chosenKey]) || [];
    if (selectedLevel === 1) {
        let note = scale[chordIndex];
        chordIndex++;
        if (chordIndex >= scale.length)
            chordIndex = 0;
        return note || "C";
    }
    else {
        let idx = Math.floor(Math.random() * scale.length);
        return scale[idx] || "C";
    }
}
function getChordFullName(key, degree, baseChord, finalChord, quality) {
    let root = baseChord[0];
    let resolvedQuality = quality || getTriadQuality(degree);
    let labelSuffix = chordQualityToLabel(resolvedQuality);
    if (labelSuffix === "")
        return root;
    return `${root}${labelSuffix}`;
}
function noteNameToMidi(noteName, octave = 2) {
    let sharps = toSharpName(noteName);
    let i = noteNames.indexOf(sharps);
    if (i < 0)
        i = 0;
    return octave * 12 + i;
}
function createBassForLevel5(baseChord, chordAsc) {
    let root = baseChord[0];
    let bassMidi = noteNameToMidi(root, 2);
    if (bassMidi < 0)
        bassMidi = 0;
    let bassNote = noteNames[bassMidi % 12] || root;
    return bassNote;
}
function generateNoteCircle() {
    let note = getNextSingleNote();
    let element = document.createElement('div');
    element.className = "chordCircle";
    element.innerHTML = note;
    let gameArea = document.getElementById('gameArea');
    element.style.left = (Math.random() * (window.innerWidth - 100)) + "px";
    element.style.top = "-100px";
    gameArea.appendChild(element);
    circleSpawnCount++;
    let speedScale = 1 + circleSpawnCount * 0.01;
    circles.push({
        element,
        noteOrChordName: note,
        noteOrChordNotes: [note],
        y: -100,
        speed: speedScale,
        destroyed: false
    });
}
function generateChordCircle() {
    let chordDegree = getNextChordName();
    let chordSpec = getChordSpecForLevel(chordDegree);
    let baseChord = chordSpec.notes;
    let lastChord = circles.length > 0 ? circles[circles.length - 1].noteOrChordNotes : null;
    let ci = closestInversion(lastChord, baseChord);
    let invertedChord = ci.inv;
    let chordAsc = [...invertedChord].sort((a, b) => noteNames.indexOf(a) - noteNames.indexOf(b));
    let chordLabel = getChordFullName(chosenKey, chordDegree, baseChord, invertedChord, chordSpec.quality);
    let finalChord = chordAsc;
    if (selectedLevel === 5) {
        let bass = createBassForLevel5(baseChord, chordAsc);
        finalChord = [bass, ...chordAsc];
    }
    let displayChord;
    if (selectedLevel === 4) {
        displayChord = chordAsc;
    }
    else if (selectedLevel === 3) {
        displayChord = baseChord.slice();
    }
    else if (selectedLevel === 5) {
        displayChord = chordAsc;
    }
    else {
        displayChord = invertedChord;
    }
    let element = document.createElement('div');
    element.className = "chordCircle";
    let htmlContent = "";
    if (showFunctions) {
        htmlContent += `<div>${chordDegree}</div>`;
    }
    htmlContent += `<div>${chordLabel}</div>`;
    if (score > 5)
        showNotes = false;
    if (showNotes) {
        htmlContent += `<div>${displayChord.join("-")}</div>`;
    }
    element.innerHTML = htmlContent;
    let gameArea = document.getElementById('gameArea');
    element.style.left = (Math.random() * (window.innerWidth - 100)) + "px";
    element.style.top = "-100px";
    gameArea.appendChild(element);
    circleSpawnCount++;
    let speedScale = 1 + circleSpawnCount * 0.01;
    circles.push({
        element,
        noteOrChordName: chordLabel,
        noteOrChordNotes: finalChord,
        y: -100,
        speed: speedScale,
        destroyed: false
    });
}
function generateCircleByLevel() {
    if (selectedLevel === 1 || selectedLevel === 2) {
        generateNoteCircle();
    }
    else {
        generateChordCircle();
    }
}
function updateCircles(deltaMs) {
    // c.speed is tuned per-frame at REFERENCE_FRAME_MS (60fps); deltaFactor
    // normalizes movement to real elapsed time instead of frames actually
    // rendered, so fall speed no longer depends on the display's refresh
    // rate or on how expensive rendering the current frame was -- both
    // previously made circles speed up or slow down for reasons unrelated
    // to gameplay (TODO.org's "speed up by time" bug).
    let deltaFactor = deltaMs / REFERENCE_FRAME_MS;
    for (let i = circles.length - 1; i >= 0; i--) {
        let c = circles[i];
        if (!c.destroyed) {
            c.y += c.speed * deltaFactor;
            c.element.style.top = c.y + "px";
            if (c.y > (window.innerHeight - 50)) {
                if (c.element.parentNode)
                    c.element.parentNode.removeChild(c.element);
                circles.splice(i, 1);
                lives--;
                updateLives();
                flashMiss();
                playMissSound();
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
function updateCirclesAndSpawn(timestamp, deltaMs) {
    updateCircles(deltaMs);
    if (timestamp - lastSpawn > 3000) {
        generateCircleByLevel();
        lastSpawn = timestamp;
    }
}
function endGame() {
    gameRunning = false;
    let finalScore = document.getElementById('finalScore');
    if (finalScore)
        finalScore.innerText = "Your score: " + score;
    let gameScreen = document.getElementById('gameScreen');
    let endScreen = document.getElementById('endScreen');
    if (gameScreen)
        gameScreen.classList.remove('active');
    if (endScreen)
        endScreen.classList.add('active');
    stopAllSounds();
}
function stopAllSounds() {
    for (let note in activeOscillators) {
        activeOscillators[note].osc.stop();
    }
    activeOscillators = {};
}
function startGame() {
    let midi = document.getElementById('midiSelect');
    let keySel = document.getElementById('keySelect');
    let notesCheck = document.getElementById('showNotesCheckbox');
    let functionsCheck = document.getElementById('showFunctionsCheckbox');
    let modeInputs = document.querySelectorAll('input[name="mode"]');
    let levelSelect = document.getElementById('levelSelect');
    let setupScreen = document.getElementById('setupScreen');
    let gameScreen = document.getElementById('gameScreen');
    let endScreen = document.getElementById('endScreen');
    circleSpawnCount = 0;
    if (levelSelect) {
        selectedLevel = parseInt(levelSelect.value, 10);
        if (isNaN(selectedLevel) || selectedLevel < 1 || selectedLevel > 8) {
            selectedLevel = 4;
        }
    }
    else {
        selectedLevel = 4;
    }
    if (notesCheck)
        showNotes = notesCheck.checked;
    if (functionsCheck)
        showFunctions = functionsCheck.checked;
    if (keySel)
        chosenKey = keySel.value;
    if (!isValidMidiInput(midi === null || midi === void 0 ? void 0 : midi.options)) {
        alert("Please select a valid MIDI input device");
        return;
    }
    modeInputs.forEach(m => {
        if (m.checked)
            chosenMode = m.value;
    });
    let selectedId = midi ? midi.value : "";
    let inputs = [];
    midiAccess.inputs.forEach(inp => inputs.push(inp));
    midiInput = inputs.find(i => i.id === selectedId);
    if (midiInput)
        midiInput.onmidimessage = onMIDIMessage;
    score = 0;
    lives = 3;
    updateScore();
    updateLives();
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
    lastFrameTime = 0;
    requestAnimationFrame(gameLoop);
}
function populateMIDIInputs() {
    let select = document.getElementById('midiSelect');
    if (!select)
        return;
    select.innerHTML = "";
    let inputs = [];
    midiAccess.inputs.forEach(inp => inputs.push(inp));
    if (inputs.length === 0) {
        let option = document.createElement('option');
        option.innerText = "No MIDI devices found";
        select.appendChild(option);
    }
    else {
        inputs.forEach(input => {
            let option = document.createElement('option');
            option.value = input.id;
            option.innerText = input.name || "";
            select.appendChild(option);
        });
    }
}
function isValidMidiInput(midiInputs) {
    if (!midiInputs || midiInputs.length === 0)
        return false;
    if (midiInputs.length === 1 && midiInputs[0].innerText === "Midi Through Port-0") {
        return false;
    }
    return true;
}
function showPopup() {
    if (popupOverlay) {
        popupOverlay.classList.add('active');
    }
}
function hidePopup() {
    if (popupOverlay) {
        popupOverlay.classList.remove('active');
    }
}
// --- Pure logic ends here; DOM/browser wiring runs immediately below ---
// (test/support/loadApp.ts slices the file at this exact comment to load
// the chord/game logic above it in Node without a DOM, so tests can call
// functions like matchesLevel4/getChordSpecForLevel directly. Nothing at
// or above this line may execute top-level code that touches document/
// window/navigator, or the test loader breaks.)
if (closePopupButton) {
    closePopupButton.addEventListener('click', hidePopup);
}
window.addEventListener('load', showPopup);
function displayErrorMessage(message) {
    const errorMessageDiv = document.getElementById("error-message");
    if (errorMessageDiv) {
        errorMessageDiv.textContent = message;
    }
}
const startButton = document.getElementById('startButton');
if (startButton)
    startButton.addEventListener('click', startGame);
const restartButton = document.getElementById('restartButton');
if (restartButton)
    restartButton.addEventListener('click', () => {
        let setupScreen = document.getElementById('setupScreen');
        let gameScreen = document.getElementById('gameScreen');
        let endScreen = document.getElementById('endScreen');
        if (setupScreen)
            setupScreen.classList.add('active');
        if (gameScreen)
            gameScreen.classList.remove('active');
        if (endScreen)
            endScreen.classList.remove('active');
    });
if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess()
        .then((access) => {
        midiAccess = access;
        populateMIDIInputs();
    })
        .catch((err) => {
        console.error("Failed to access MIDI devices:", err);
        alert("MIDI access was denied. Please allow MIDI access to use Chord Nebula.");
    });
}
