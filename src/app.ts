let audioContext: AudioContext | null = null;
let midiAccess: MIDIAccess | null = null;
let midiInput: MIDIInput | undefined;
let gameRunning: boolean = false;
let score: number = 0;
/** Starting lives, and the number of heart pips the HUD renders. */
const MAX_LIVES: number = 3;
let lives: number = MAX_LIVES;

interface Circle {
  element: HTMLElement;
  noteOrChordName: string;
  noteOrChordNotes: string[];
  y: number;
  speed: number;
  destroyed: boolean;
  /** Measured diameter of this orb, in px (see measureOrbSize). */
  size: number;
  /**
   * Horizontal position as a 0..1 fraction of the available track rather
   * than a fixed pixel offset, so a mid-game resize can't leave the orb
   * hanging outside the play area (see updateCircles).
   */
  xFraction: number;
}

interface PlayedNote {
  noteName: string;
  midiNumber: number;
}

let circles: Circle[] = [];
let noteOnStack: PlayedNote[] = [];
let chosenKey: string = "C";
/** The scale being practised. Named `chosenMode` since the diatonic modes
    are what it holds, "major" and "minor" (aeolian) among them. */
let chosenMode: ScaleName = "major";
let chosenGenre: string = "pop";
let progressionIndex: number = 0;
let chordIndex: number = 0;
/** Whether orbs currently spell out their notes -- owned by the difficulty
    ramp (see DIFFICULTY_STAGES), not by the player. */
let showNotes: boolean = true;
let lastSpawn: number = 0;
let lastFrameTime: number = 0;
let activeOscillators: { [key: number]: { osc: OscillatorNode; gain: GainNode } } = {};
let selectedLevel: number = 4;

type ChordQuality =
  | "maj"
  | "min"
  | "dim"
  | "aug"
  | "dom7"
  | "maj7"
  | "min7"
  | "hdim7"
  | "dim7"
  | "maj9"
  | "min9"
  | "dom9"
  | "hdim9";

const noteNames: string[] = [
  "C","C#","D","D#","E","F","F#","G","G#","A","A#","B"
];

const enhMapToSharp: { [key:string]:string } = {
  "Bb":"A#","Eb":"D#","Ab":"G#","Db":"C#","Gb":"F#","Cb":"B","Fb":"E",
  // The C#/F# major and D#/A# minor scales below spell their 3rd/7th
  // degrees as E#/B# (standard music notation for those keys), but
  // MIDI-derived note names (midiNoteToName) only ever produce the 12
  // noteNames spellings -- "F"/"C" never "E#"/"B#". Without these, a
  // correctly-played chord in one of those keys could never match,
  // since the chord spec's note names and the played notes' names
  // would never normalize to the same string. This was TODO.org's
  // "not recognising F as E#" bug.
  "E#":"F","B#":"C"
};

const majorScales:{[key:string]:string[]}={
  "C": ["C","D","E","F","G","A","B"],
  "G": ["G","A","B","C","D","E","F#"],
  "D": ["D","E","F#","G","A","B","C#"],
  "A": ["A","B","C#","D","E","F#","G#"],
  "E": ["E","F#","G#","A","B","C#","D#"],
  "B": ["B","C#","D#","E","F#","G#","A#"],
  "F#":["F#","G#","A#","B","C#","D#","E#"],
  "C#":["C#","D#","E#","F#","G#","A#","B#"],
  "F": ["F","G","A","Bb","C","D","E"],
  "Bb":["Bb","C","D","Eb","F","G","A"],
  "Eb":["Eb","F","G","Ab","Bb","C","D"],
  "Ab":["Ab","Bb","C","Db","Eb","F","G"],
  "Db":["Db","Eb","F","Gb","Ab","Bb","C"],
  "Gb":["Gb","Ab","Bb","Cb","Db","Eb","F"]
};

// --- Scales -------------------------------------------------------
// Every diatonic mode is a rotation of some major scale, so majorScales
// above is the only spelled table this file needs: minor (aeolian) is the
// major scale started on its 6th degree, dorian on its 2nd, and so on.
// That's what lets the game offer seven scales without seven tables, and
// it's why the scale spellings stay musically correct in every key (Eb
// dorian comes out of Db major, not C# major).

type ScaleName =
  | "major"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "minor"
  | "locrian";

/** Which degree of the parent major scale each mode starts on. */
const MODE_ROTATION: { [key in ScaleName]: number } = {
  major: 0,
  dorian: 1,
  phrygian: 2,
  lydian: 3,
  mixolydian: 4,
  minor: 5,
  locrian: 6
};

const SCALE_LABELS: { [key in ScaleName]: string } = {
  major: "Major",
  dorian: "Dorian",
  phrygian: "Phrygian",
  lydian: "Lydian",
  mixolydian: "Mixolydian",
  minor: "Minor",
  locrian: "Locrian"
};

/** majorScales' keys in circle-of-fifths order, which is the order the key
    dropdown has always listed and the order derived tonics inherit. */
const MAJOR_KEY_ORDER: string[] = [
  "C","G","D","A","E","B","F#","C#","F","Bb","Eb","Ab","Db","Gb"
];

/** Semitones above the tonic for each degree of a major scale. */
const MAJOR_SCALE_SEMITONES: number[] = [0,2,4,5,7,9,11];

function pitchClass(note:string):number {
  return noteNames.indexOf(toSharpName(note));
}

/**
 * The spelled notes of a scale, e.g. buildScale("D","dorian") is
 * D E F G A B C. Found by locating the major scale that spells `tonic` at
 * this mode's rotation and rotating it to start there.
 */
function buildScale(tonic:string, scale:ScaleName):string[] {
  let rotation= MODE_ROTATION[scale];
  // Exact spelling first: both Db major and C# major have a 2nd degree at
  // pitch class 3, but only Db major spells it "Eb", which is what makes
  // Eb dorian come out as Eb F Gb Ab Bb C Db instead of D# E# F# ...
  for(const key of MAJOR_KEY_ORDER){
    let parent= majorScales[key];
    if(parent[rotation]=== tonic){
      return parent.slice(rotation).concat(parent.slice(0, rotation));
    }
  }
  // Enharmonic fallback for a tonic no major key spells that way (G# dorian,
  // say): same pitches, spelled as its parent key spells them.
  for(const key of MAJOR_KEY_ORDER){
    let parent= majorScales[key];
    if(pitchClass(parent[rotation])=== pitchClass(tonic)){
      return parent.slice(rotation).concat(parent.slice(0, rotation));
    }
  }
  return majorScales["C"];
}

/** The scale currently being played. */
function currentScale():string[] {
  return buildScale(chosenKey, chosenMode);
}

/** Tonics offered for a scale: one per major key, so minor yields the same
    14 keys the old hardcoded minor table listed, in the same order. */
function getKeysForScale(scale:ScaleName):string[] {
  let rotation= MODE_ROTATION[scale];
  let keys:string[]=[];
  for(const key of MAJOR_KEY_ORDER){
    let tonic= majorScales[key][rotation];
    if(keys.indexOf(tonic)<0) keys.push(tonic);
  }
  return keys;
}

/** Prefers the scale's own spelling of a pitch, so a Bb key reads "Bb"
    rather than the sharp-normalised "A#" that note matching works in.
    Pitches outside the scale (level 7's dim/aug, level 8's chromatics)
    keep the spelling they arrive with. */
function spellNoteInScale(note:string, scale:string[]):string {
  let pc= pitchClass(note);
  for(const scaleNote of scale){
    if(pitchClass(scaleNote)=== pc) return scaleNote;
  }
  return note;
}

/**
 * Web Audio's constructor. Safari below 14.1 only exposes the prefixed
 * one, and browsers without Web Audio at all get null rather than a
 * ReferenceError.
 */
function audioContextConstructor():{ new(): AudioContext }|null {
  if(typeof AudioContext!=='undefined') return AudioContext;
  if(typeof window!=='undefined'){
    let prefixed= (window as any).webkitAudioContext;
    if(prefixed) return prefixed;
  }
  return null;
}

function ensureAudioContext():void {
  if(!audioContext){
    let ctor= audioContextConstructor();
    if(!ctor) return;
    audioContext= new ctor();
  }
  // Autoplay policy: a context first created outside a user gesture comes
  // back suspended and stays completely silent until something resumes it.
  // Playing a MIDI note doesn't count as a gesture in Chrome, so without
  // this the game could run with no sound at all.
  if(audioContext.state==='suspended' && typeof audioContext.resume==='function'){
    audioContext.resume();
  }
}

function midiNoteToName(noteNumber:number): string {
  return noteNames[noteNumber % 12];
}

function freqFromMidiNote(m:number):number {
  return 440*Math.pow(2,(m-69)/12);
}

function toSharpName(n:string):string {
  if(enhMapToSharp[n]) return enhMapToSharp[n];
  return n;
}

function normalizeChordNote(n:string):string {
  return toSharpName(n);
}

function playNoteSound(noteNumber:number,velocity:number):void {
  ensureAudioContext();
  let ctx= audioContext;
  if(!ctx) return;
  let freq= freqFromMidiNote(noteNumber);
  let osc= ctx.createOscillator();
  osc.type='sine';
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  let gainNode= ctx.createGain();
  gainNode.gain.setValueAtTime(velocity/127*0.3, ctx.currentTime);
  osc.connect(gainNode).connect(ctx.destination);
  osc.start();
  activeOscillators[noteNumber]={osc:osc, gain:gainNode};
}

function stopNoteSound(noteNumber:number):void {
  let oscData= activeOscillators[noteNumber];
  if(oscData){
    oscData.osc.stop();
    delete activeOscillators[noteNumber];
  }
}

function onMIDIMessage(event:MIDIMessageEvent):void {
  let arr= event.data;
  if(!arr || arr.length<3) return;
  const status= arr[0];
  const midiNumber= arr[1];
  const velocity= arr[2];
  if(status>=0x90&&status<=0x9f&&velocity>0){
    let noteName= midiNoteToName(midiNumber);
    noteOnStack.push({ noteName, midiNumber });
    playNoteSound(midiNumber, velocity);
    checkChords();
  } else if((status>=0x80&&status<=0x8f)||(status>=0x90&&status<=0x9f&&velocity===0)){
    let idx= noteOnStack.findIndex(obj => obj.midiNumber=== midiNumber);
    if(idx>-1) noteOnStack.splice(idx,1);
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

function checkChords():void {
  for(let i= circles.length-1; i>=0; i--){
    let c= circles[i];
    if(!c.destroyed){
      if(selectedLevel===4){
        if(matchesLevel4(c.noteOrChordNotes)){
          playChordSound(c.noteOrChordNotes);
          flashMatch(c.element);
          c.destroyed=true;
          score++;
          updateScore();
        }
      } else if(selectedLevel===5){
        if(matchesLevel5(c.noteOrChordNotes)){
          playChordSound(c.noteOrChordNotes);
          flashMatch(c.element);
          c.destroyed=true;
          score++;
          updateScore();
        }
      } else if(selectedLevel>=6){
        if(matchesLevel1to3(c.noteOrChordNotes)){
          playChordSound(c.noteOrChordNotes);
          flashMatch(c.element);
          c.destroyed=true;
          score++;
          updateScore();
        }
      } else {
        if(matchesLevel1to3(c.noteOrChordNotes)){
          playChordSound(c.noteOrChordNotes);
          flashMatch(c.element);
          c.destroyed=true;
          score++;
          updateScore();
        }
      }
    }
  }
}

function matchesLevel1to3(chordNotes:string[]):boolean {
  if(chordNotes.length!== noteOnStack.length) return false;
  let chordSet= new Set(chordNotes.map(normalizeChordNote));
  let playedSet= new Set(noteOnStack.map(o=> toSharpName(midiNoteToName(o.midiNumber))));
  if(chordSet.size!== playedSet.size) return false;
  for(let note of chordSet){
    if(!playedSet.has(note)) return false;
  }
  return true;
}

function matchesLevel4(chordNotes:string[]):boolean {
  if(chordNotes.length!== noteOnStack.length) return false;
  let chordAsc= chordNotes
    .map(normalizeChordNote)
    .sort((a,b)=> noteNames.indexOf(a)- noteNames.indexOf(b));
  let playedAsc= [...noteOnStack].sort((a,b)=> a.midiNumber- b.midiNumber);
  for(let i=0; i<chordAsc.length; i++){
    let playedName= toSharpName(midiNoteToName(playedAsc[i].midiNumber));
    if(chordAsc[i]!== playedName) return false;
  }
  return true;
}

function matchesLevel5(chordNotes:string[]):boolean {
  if(chordNotes.length!== noteOnStack.length) return false;
  let playedAsc= [...noteOnStack].sort((a,b)=> a.midiNumber- b.midiNumber);
  // chordNotes is listed bass-first, so comparing it against the played
  // notes in pitch order is what enforces "root in the bass": the lowest
  // note played has to be the one the orb lists first.
  for(let i=0; i<chordNotes.length; i++){
    let cNote= toSharpName(chordNotes[i]);
    let pNote= toSharpName(midiNoteToName(playedAsc[i].midiNumber));
    if(cNote!== pNote) return false;
  }
  return true;
}

// The "Score:"/"Lives:" labels now live in index.html as part of the HUD
// panel markup, so these only write the value itself.

function updateScore():void {
  let s= document.getElementById('scoreDisplay');
  if(s) s.innerText= String(score);
}

function updateLives():void {
  let l= document.getElementById('livesDisplay');
  if(!l) return;
  let remaining= Math.max(0, Math.min(lives, MAX_LIVES));
  let pips= "";
  for(let i=0;i<MAX_LIVES;i++){
    pips+= i<remaining? "♥": '<span class="lifeSpent">♥</span>';
  }
  l.innerHTML= pips;
}

// --- Correct/miss feedback ---
// Previously a correct match had a chime (playChordSound) and the circle
// vanishing; a missed circle had nothing at all -- no visual or audio cue
// that anything had gone wrong, just the lives counter silently ticking
// down. These are deliberately decoupled from the falling-circle
// removal/scoring logic (self-contained elements/classes that clean up
// after themselves via setTimeout) so they can't affect gameplay timing.

/** Brief "pop" at a matched circle's position -- a new, throwaway element, not the circle itself, so it can't interfere with updateCircles' own removal timing. */
function flashMatch(circleElement:HTMLElement):void {
  let gameArea= document.getElementById('gameArea');
  if(!gameArea) return;
  let pop= document.createElement('div');
  pop.className= 'matchPop';
  pop.style.left= circleElement.style.left;
  pop.style.top= circleElement.style.top;
  gameArea.appendChild(pop);
  setTimeout(()=>{ if(pop.parentNode) pop.parentNode.removeChild(pop); }, 400);
}

/** Brief red pulse around the play area when a circle is missed. */
function flashMiss():void {
  let gameArea= document.getElementById('gameArea');
  if(!gameArea) return;
  gameArea.classList.add('missFlash');
  setTimeout(()=> gameArea.classList.remove('missFlash'), 300);
}

/** Short, deliberately unpleasant buzz for a miss -- distinct from playChordSound's chime. */
function playMissSound():void {
  ensureAudioContext();
  let ctx= audioContext;
  if(!ctx) return;
  let startTime= ctx.currentTime;
  let osc= ctx.createOscillator();
  osc.type= 'sawtooth';
  osc.frequency.setValueAtTime(110, startTime);
  let gainNode= ctx.createGain();
  gainNode.gain.setValueAtTime(0.15, startTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime+0.2);
  osc.connect(gainNode).connect(ctx.destination);
  osc.start();
  setTimeout(()=> osc.stop(), 220);
}

// --- Engine pulse ---------------------------------------------------
// A chiptune bass ostinato ("ba ba ba ba") that runs while objects are
// falling, so the play area feels like something slowly under way rather
// than silent between chords.
//
// It has to sit *under* playChordSound without ever fighting it, which is
// what every constant here is chosen for:
//   * Register. Pulses live at MIDI 36-59 (65-247Hz). playChordSound's
//     triangles sit in the C4-B4 octave (261-494Hz), so the two never
//     overlap in pitch.
//   * Harmony. The pattern is keyed off the current tonic and uses only
//     the root, its octave and its fifth, so it works as a pedal tone
//     under any chord the level can generate instead of clashing with
//     some of them.
//   * Level. Peak gain is 0.06 against the chords' 0.3, and the lowpass
//     tames the square wave's upper harmonics -- keeping the 8-bit
//     character while leaving the midrange clear for the chords.
const ENGINE_STEP_SECONDS = 0.42;
const ENGINE_PEAK_GAIN = 0.06;
/** Semitone offsets from the tonic -- root, root, octave, fifth. */
const ENGINE_PATTERN = [0, 0, 12, 7];
/** How far ahead of the audio clock pulses get scheduled. */
const ENGINE_SCHEDULE_AHEAD = 0.3;

let engineInput: BiquadFilterNode | null = null;
let engineTimer: number | null = null;
let engineNextStepTime: number = 0;
let engineStep: number = 0;

/** Tonic of the current key, two octaves below middle C. */
function engineRootMidi():number {
  let pc= noteNames.indexOf(toSharpName(chosenKey));
  return 36+ (pc<0? 0: pc);
}

function ensureEngineChain():BiquadFilterNode {
  let ctx= audioContext!;
  if(!engineInput){
    let filter= ctx.createBiquadFilter();
    filter.type= 'lowpass';
    filter.frequency.setValueAtTime(900, ctx.currentTime);
    let bus= ctx.createGain();
    bus.gain.setValueAtTime(1, ctx.currentTime);
    filter.connect(bus).connect(ctx.destination);
    engineInput= filter;
  }
  return engineInput;
}

/** One short square-wave "ba", scheduled at audio-clock time `at`. */
function playEnginePulse(at:number, midi:number):void {
  let ctx= audioContext!;
  let dest= ensureEngineChain();
  let osc= ctx.createOscillator();
  osc.type= 'square';
  osc.frequency.setValueAtTime(freqFromMidiNote(midi), at);
  let gainNode= ctx.createGain();
  // Fast attack into a short decay: staccato, so the pulses read as
  // separate hits rather than one continuous hum.
  gainNode.gain.setValueAtTime(0.0001, at);
  gainNode.gain.linearRampToValueAtTime(ENGINE_PEAK_GAIN, at+0.015);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, at+0.19);
  osc.connect(gainNode).connect(dest);
  osc.start(at);
  osc.stop(at+0.22);
}

/** Lookahead scheduler: setInterval alone is too jittery to keep a beat. */
function scheduleEnginePulses():void {
  let ctx= audioContext!;
  // gameLoop (and so syncEngineDrone) is driven by rAF, which pauses while
  // the tab is hidden -- without this the scheduler would keep firing
  // pulses into a tab nobody is looking at.
  if(typeof document!=='undefined' && document.hidden){
    engineNextStepTime= ctx.currentTime;
    return;
  }
  let root= engineRootMidi();
  while(engineNextStepTime< ctx.currentTime+ ENGINE_SCHEDULE_AHEAD){
    let offset= ENGINE_PATTERN[engineStep% ENGINE_PATTERN.length];
    playEnginePulse(Math.max(engineNextStepTime, ctx.currentTime), root+ offset);
    engineStep++;
    engineNextStepTime+= ENGINE_STEP_SECONDS;
  }
}

function startEngineDrone():void {
  if(engineTimer!==null) return;
  // No-op under the test sandbox / any environment without Web Audio.
  if(!audioContextConstructor()) return;
  ensureAudioContext();
  if(!audioContext) return;
  engineStep= 0;
  engineNextStepTime= audioContext.currentTime+ 0.05;
  scheduleEnginePulses();
  engineTimer= setInterval(scheduleEnginePulses, 120);
}

function stopEngineDrone():void {
  if(engineTimer===null) return;
  clearInterval(engineTimer);
  engineTimer= null;
  // Pulses already scheduled (< ENGINE_SCHEDULE_AHEAD away) are left to
  // ring out on their own envelopes rather than being cut off.
}

/** Runs the pulse whenever at least one circle is still falling. */
function syncEngineDrone():void {
  let anyFalling= gameRunning && circles.some(c=> !c.destroyed);
  if(anyFalling) startEngineDrone(); else stopEngineDrone();
}

// Reference frame interval (60fps) that circle speed values are tuned
// against -- see updateCircles' deltaFactor.
const REFERENCE_FRAME_MS = 1000/60;
// Caps a single frame's delta so a backgrounded/throttled tab (rAF pauses
// while hidden; `timestamp` can jump by seconds on refocus) doesn't teleport
// circles instead of just resuming normally.
const MAX_FRAME_DELTA_MS = REFERENCE_FRAME_MS*5;

function gameLoop(timestamp:number):void {
  if(!gameRunning) return;
  let deltaMs= lastFrameTime===0? REFERENCE_FRAME_MS: Math.min(timestamp-lastFrameTime, MAX_FRAME_DELTA_MS);
  lastFrameTime= timestamp;
  updateCirclesAndSpawn(timestamp, deltaMs);
  requestAnimationFrame(gameLoop);
}

function playChordSound(chord:string[]):void {
  ensureAudioContext();
  let ctx= audioContext;
  if(!ctx) return;
  let startTime= ctx.currentTime;
  for(const n of chord){
    let freq= noteNameToFreq(n);
    let osc= ctx.createOscillator();
    osc.type= 'triangle';
    osc.frequency.setValueAtTime(freq, startTime);
    let gainNode= ctx.createGain();
    gainNode.gain.setValueAtTime(0.3, startTime);
    osc.connect(gainNode).connect(ctx.destination);
    osc.start();
    setTimeout(()=> osc.stop(),300);
  }
}

function noteNameToFreq(name:string):number {
  ensureAudioContext();
  let sharps= toSharpName(name);
  let baseIndex= noteNames.indexOf("A");
  let noteIndex= noteNames.indexOf(sharps);
  if(noteIndex<0) noteIndex= noteNames.indexOf(sharps.replace('b','#'));
  if(noteIndex<0) noteIndex=0;
  let semitoneDiff= noteIndex- baseIndex;
  return 440*Math.pow(2, semitoneDiff/12);
}

/** Semitones above the root for every chord the game can build. Read in
    both directions (see qualityFromIntervals), so a quality's formula and
    the recognition of that formula can't drift apart. */
const QUALITY_INTERVALS: { [key in ChordQuality]: number[] } = {
  maj:  [0,4,7],
  min:  [0,3,7],
  dim:  [0,3,6],
  aug:  [0,4,8],
  dom7: [0,4,7,10],
  maj7: [0,4,7,11],
  min7: [0,3,7,10],
  hdim7:[0,3,6,10],
  dim7: [0,3,6,9],
  maj9: [0,4,7,11,14],
  min9: [0,3,7,10,14],
  dom9: [0,4,7,10,14],
  hdim9:[0,3,6,10,14]
};

function chordQualityToIntervals(quality: ChordQuality): number[] {
  return QUALITY_INTERVALS[quality]|| QUALITY_INTERVALS.maj;
}

/** The quality whose formula is exactly `semitones`, or null if the stack
    isn't one of the chords in the vocabulary. */
function qualityFromIntervals(semitones: number[]): ChordQuality|null {
  for(const quality of Object.keys(QUALITY_INTERVALS) as ChordQuality[]){
    let intervals= QUALITY_INTERVALS[quality];
    if(intervals.length!== semitones.length) continue;
    let same= true;
    for(let i=0;i<intervals.length;i++){
      if(intervals[i]!== semitones[i]){ same= false; break; }
    }
    if(same) return quality;
  }
  return null;
}

function chordQualityToLabel(quality: ChordQuality): string {
  switch(quality){
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

function buildChordFromRoot(root: string, quality: ChordQuality): string[] {
  let rootSharp= toSharpName(root);
  let rootIndex= noteNames.indexOf(rootSharp);
  if(rootIndex<0) rootIndex= 0;
  let intervals= chordQualityToIntervals(quality);
  return intervals.map(semi => noteNames[(rootIndex+ semi)%12]);
}

// --- Diatonic chords ----------------------------------------------
// Qualities are derived from the scale rather than tabulated per mode:
// stack every other scale note, measure the intervals, look the formula
// up. That's the same answer the old hardcoded major/minor tables gave,
// and it holds for the five other modes for free.

/** The `size`-note chord on a scale degree: every other note from there. */
function diatonicChordNotes(scale:string[], degreeIndex:number, size:number):string[] {
  let notes:string[]=[];
  for(let i=0;i<size;i++){
    notes.push(scale[(degreeIndex+ i*2)% scale.length]);
  }
  return notes;
}

/**
 * Semitones from `root` up to `note`, lifted past `atLeast` so a stack of
 * thirds reads as ascending intervals (a 9th comes out 14, not 2).
 */
function intervalAbove(root:string, note:string, atLeast:number):number {
  let semis= ((pitchClass(note)- pitchClass(root))% 12+ 12)% 12;
  while(semis< atLeast) semis+= 12;
  return semis;
}

/** Quality of the diatonic chord of `size` notes on a scale degree. */
function diatonicQuality(scale:string[], degreeIndex:number, size:number):ChordQuality {
  let notes= diatonicChordNotes(scale, degreeIndex, size);
  let semitones= [0];
  let previous= 0;
  for(let i=1;i<notes.length;i++){
    previous= intervalAbove(notes[0], notes[i], previous+1);
    semitones.push(previous);
  }
  return qualityFromIntervals(semitones)|| (size>=4? "dom7": "maj");
}

const ROMAN_NUMERALS: string[] = ["I","II","III","IV","V","VI","VII"];

/**
 * Roman-numeral function label for a degree: "V", "ii", "ii°", "bVII".
 *
 * Case follows the chord's third and the accidental compares the degree's
 * root against the major scale's degree of the same number, which is what
 * writing "bIII" in a minor key or "bII" in phrygian actually means.
 * Generating these is what lets a new mode arrive without a label table.
 */
function degreeLabel(scale:string[], degreeIndex:number, quality:ChordQuality):string {
  let index= degreeIndex% scale.length;
  let expected= (pitchClass(scale[0])+ MAJOR_SCALE_SEMITONES[index])% 12;
  let actual= pitchClass(scale[index]);
  // Shortest signed distance, so 11 semitones up reads as one semitone flat.
  let offset= ((actual- expected+ 18)% 12)- 6;
  let accidental= "";
  for(let i=0;i<Math.abs(offset);i++) accidental+= offset<0? "b": "#";
  let intervals= chordQualityToIntervals(quality);
  let numeral= ROMAN_NUMERALS[index];
  let label= accidental+ (intervals[1]===3? numeral.toLowerCase(): numeral);
  // Every diminished flavour gets the same mark: the chord name beside it
  // ("m7b5") already draws the half-diminished distinction, and the pixel
  // font has no slashed-o glyph to draw it with here.
  if(quality==="dim"|| quality==="dim7"|| quality==="hdim7"|| quality==="hdim9") label+= "°";
  else if(quality==="aug") label+= "+";
  return label;
}

/** Degree index of the dominant, the one degree that takes a dom7 even
    where the scale wouldn't produce one. */
function isDominantDegree(degreeIndex: number): boolean {
  return degreeIndex% 7=== 4;
}

function chooseLevel8Quality(baseQuality: ChordQuality, degreeIndex: number): ChordQuality {
  let options: ChordQuality[] = [baseQuality];
  if(baseQuality==="maj"){
    options.push("maj7","maj9");
  } else if(baseQuality==="min"){
    options.push("min7","min9");
  } else if(baseQuality==="dim"){
    options.push("hdim7","hdim9","dim7");
  }
  if(isDominantDegree(degreeIndex)){
    options.push("dom7","dom9");
  }
  if(Math.random()<0.2){
    options.push("aug");
  }
  if(Math.random()<0.15 && baseQuality!=="dim"){
    options.push("dim");
  }
  return options[Math.floor(Math.random()*options.length)];
}

function getChordRootFromDegree(key: string, degreeIndex: number, mode: ScaleName): string {
  let scale= buildScale(key, mode);
  return scale[degreeIndex% scale.length]|| "C";
}

interface ChordSpec {
  /** Scale spelling of the root, e.g. "Eb" rather than "D#". */
  root: string;
  quality: ChordQuality;
  /** Sharp-normalised pitches, which is what note matching compares. */
  notes: string[];
  /** Roman-numeral function of this degree in the current scale. */
  functionLabel: string;
}

function getChordSpecForLevel(degreeIndex: number): ChordSpec {
  let scale= currentScale();
  let root= getChordRootFromDegree(chosenKey, degreeIndex, chosenMode);
  let triad= diatonicQuality(scale, degreeIndex, 3);
  let quality: ChordQuality;
  if(selectedLevel===6){
    quality= diatonicQuality(scale, degreeIndex, 4);
  } else if(selectedLevel===7){
    quality= Math.random()<0.5 ? "dim" : "aug";
  } else if(selectedLevel===8){
    quality= chooseLevel8Quality(triad, degreeIndex);
  } else {
    quality= triad;
  }
  let notes= buildChordFromRoot(root, quality);
  return { root, quality, notes, functionLabel: degreeLabel(scale, degreeIndex, quality) };
}

// --- Genres and progressions ---------------------------------------
// Progressions are stored as 0-based scale degrees, not roman numerals, so
// the same shape works in any scale and the numerals shown on the orbs can
// be generated from the scale (see degreeLabel). Each genre lists only the
// scales that genre's harmony actually lives in, and the scale selector is
// built from that list.

interface Progression {
  /** How the progression is written, for the setup screen's preview. */
  label: string;
  scale: ScaleName;
  /** Scale degrees in playing order, 0 being the tonic. */
  degrees: number[];
}

interface Genre {
  id: string;
  label: string;
  progressions: Progression[];
}

const GENRES: Genre[] = [
  {
    id: "pop",
    label: "Pop",
    progressions: [
      { label: "I-V-vi-IV",     scale: "major", degrees: [0,4,5,3] },
      { label: "vi-IV-I-V",     scale: "major", degrees: [5,3,0,4] },
      { label: "I-vi-IV-V",     scale: "major", degrees: [0,5,3,4] },
      { label: "I-IV-vi-V",     scale: "major", degrees: [0,3,5,4] },
      { label: "i-bVI-bIII-bVII", scale: "minor", degrees: [0,5,2,6] },
      { label: "i-bVII-bVI-bVII", scale: "minor", degrees: [0,6,5,6] }
    ]
  },
  {
    id: "rock",
    label: "Rock",
    progressions: [
      { label: "I-IV-V-I",       scale: "major",      degrees: [0,3,4,0] },
      { label: "I-V-IV-I",       scale: "major",      degrees: [0,4,3,0] },
      { label: "I-bVII-IV-I",    scale: "mixolydian", degrees: [0,6,3,0] },
      { label: "I-IV-bVII-IV",   scale: "mixolydian", degrees: [0,3,6,3] },
      { label: "i-bVII-bVI-bVII", scale: "minor",     degrees: [0,6,5,6] },
      { label: "i-iv-i-v",       scale: "minor",      degrees: [0,3,0,4] },
      { label: "i-IV vamp",      scale: "dorian",     degrees: [0,3,0,3] }
    ]
  },
  {
    id: "jazz",
    label: "Jazz",
    progressions: [
      { label: "ii-V-I",          scale: "major",  degrees: [1,4,0] },
      { label: "I-vi-ii-V",       scale: "major",  degrees: [0,5,1,4] },
      { label: "iii-vi-ii-V",     scale: "major",  degrees: [2,5,1,4] },
      { label: "I-IV-iii-vi",     scale: "major",  degrees: [0,3,2,5] },
      { label: "ii-v-i",          scale: "minor",  degrees: [1,4,0] },
      { label: "i-iv-bVII-bIII",  scale: "minor",  degrees: [0,3,6,2] },
      { label: "i-IV vamp",       scale: "dorian", degrees: [0,3,0,3] },
      { label: "i-ii-bIII-ii",    scale: "dorian", degrees: [0,1,2,1] }
    ]
  },
  {
    id: "blues",
    label: "Blues",
    progressions: [
      { label: "12-bar (condensed)", scale: "mixolydian", degrees: [0,3,0,4,3,0] },
      { label: "quick change",       scale: "mixolydian", degrees: [0,3,0,0] },
      { label: "I-IV-I-V turnaround", scale: "mixolydian", degrees: [0,3,0,4] },
      { label: "minor blues i-iv-i-v", scale: "minor",    degrees: [0,3,0,4] }
    ]
  },
  {
    id: "classical",
    label: "Classical",
    progressions: [
      { label: "I-IV-V-I (authentic)", scale: "major", degrees: [0,3,4,0] },
      { label: "I-IV-I-V (plagal)",    scale: "major", degrees: [0,3,0,4] },
      { label: "I-vi-IV-V-I",          scale: "major", degrees: [0,5,3,4,0] },
      { label: "circle of fifths",     scale: "major", degrees: [0,3,6,2,5,1,4,0] },
      { label: "i-iv-v-i",             scale: "minor", degrees: [0,3,4,0] },
      { label: "i-bVI-ii-v",           scale: "minor", degrees: [0,5,1,4] }
    ]
  },
  {
    id: "folk",
    label: "Folk / Country",
    progressions: [
      { label: "I-IV-V-V",    scale: "major",      degrees: [0,3,4,4] },
      { label: "I-V-IV-I",    scale: "major",      degrees: [0,4,3,0] },
      { label: "I-V-vi-IV",   scale: "major",      degrees: [0,4,5,3] },
      { label: "I-IV-I-V",    scale: "major",      degrees: [0,3,0,4] },
      { label: "I-bVII-IV-I", scale: "mixolydian", degrees: [0,6,3,0] }
    ]
  },
  {
    id: "funk",
    label: "Funk / R&B",
    progressions: [
      { label: "i-IV vamp",     scale: "dorian", degrees: [0,3,0,3] },
      { label: "i-ii-i-IV",     scale: "dorian", degrees: [0,1,0,3] },
      { label: "ii-V vamp",     scale: "major",  degrees: [1,4,1,4] },
      { label: "i-bVII-bVI-v",  scale: "minor",  degrees: [0,6,5,4] }
    ]
  },
  {
    id: "edm",
    label: "EDM",
    progressions: [
      { label: "i-bVI-bIII-bVII", scale: "minor",    degrees: [0,5,2,6] },
      { label: "i-bVII-bVI-bVII", scale: "minor",    degrees: [0,6,5,6] },
      { label: "vi-IV-I-V",       scale: "major",    degrees: [5,3,0,4] },
      { label: "i-bII-i-bVII",    scale: "phrygian", degrees: [0,1,0,6] },
      { label: "i-bVI-bVII-i",    scale: "phrygian", degrees: [0,5,6,0] }
    ]
  }
];

function getGenre(id: string): Genre {
  for(const genre of GENRES){
    if(genre.id=== id) return genre;
  }
  return GENRES[0];
}

/** The scales a genre's progressions use, in the order they first appear.
    This is the whole of "limit each genre to its own scales": the scale
    selector is built from it. */
function getScalesForGenre(id: string): ScaleName[] {
  let scales: ScaleName[] = [];
  for(const progression of getGenre(id).progressions){
    if(scales.indexOf(progression.scale)<0) scales.push(progression.scale);
  }
  return scales;
}

function getProgressionsFor(genreId: string, scale: ScaleName): Progression[] {
  let matching= getGenre(genreId).progressions.filter(p=> p.scale=== scale);
  // A scale the genre doesn't cover can only be reached by tampering with
  // the selects; fall back to the genre's own progressions rather than
  // leaving the game with nothing to spawn.
  return matching.length>0? matching: getGenre(genreId).progressions;
}

function getProgressions():number[][] {
  return getProgressionsFor(chosenGenre, chosenMode).map(p=> p.degrees);
}

/** Walks the current progression one chord at a time, then moves on to the
    next progression of the genre and wraps. */
function getNextChordDegree():number {
  let p= getProgressions();
  let progression= p[progressionIndex% p.length];
  let degree= progression[chordIndex% progression.length];
  chordIndex++;
  if(chordIndex>= progression.length){
    chordIndex=0;
    progressionIndex=(progressionIndex+1)% p.length;
  }
  return degree;
}

function invertChord(notes:string[], inversion:number):string[] {
  let arr= notes.slice();
  for(let i=0; i<inversion; i++){
    let x= arr.shift();
    if(x) arr.push(x);
  }
  return arr;
}

function voiceLeadingDistance(ch1:string[],ch2:string[]):number {
  let dist=0;
  for(let i=0; i<ch1.length; i++){
    dist+= noteDistance(ch1[i], ch2[i]);
  }
  return dist;
}

function noteDistance(a:string,b:string):number {
  let A= toSharpName(a);
  let B= toSharpName(b);
  let iA= noteNames.indexOf(A);
  let iB= noteNames.indexOf(B);
  if(iA<0|| iB<0) return 12;
  let d= Math.abs(iA- iB);
  if(d>6) d=12-d;
  return d;
}

function closestInversion(prevChord:string[]| null, chord:string[]):{inv:string[],inversion:number} {
  if(!prevChord) return {inv:chord, inversion:0};
  let candidates:{inv:string[], dist:number, inversion:number}[]=[];
  for(let i=0; i<chord.length; i++){
    let inv= invertChord(chord, i);
    let dist= voiceLeadingDistance(prevChord, inv);
    candidates.push({inv:inv, dist:dist, inversion:i});
  }
  candidates.sort((a,b)=> a.dist- b.dist);
  return {inv: candidates[0].inv, inversion: candidates[0].inversion};
}

function getNextSingleNote():string {
  let scale= currentScale();
  if(selectedLevel===1){
    let note= scale[chordIndex];
    chordIndex++;
    if(chordIndex>= scale.length) chordIndex=0;
    return note|| "C";
  } else {
    let idx= Math.floor(Math.random()* scale.length);
    return scale[idx]|| "C";
  }
}

/**
 * Display name of a chord: the root as the scale spells it, plus the
 * quality's suffix ("Eb", "Ebm7", "Gdim").
 *
 * The root has to come from the scale, not from the chord's note list --
 * that list is sharp-normalised for matching, so reading the root off it
 * showed Eb major's tonic chord as "D#" and Bb minor's as "A#".
 */
function getChordFullName(root: string, quality: ChordQuality): string {
  return root+ chordQualityToLabel(quality);
}

function noteNameToMidi(noteName:string, octave:number=2):number {
  let sharps= toSharpName(noteName);
  let i= noteNames.indexOf(sharps);
  if(i<0) i=0;
  return octave*12 + i;
}

function createBassForLevel5(baseChord:string[]):string {
  let root= baseChord[0];
  let bassMidi= noteNameToMidi(root,2);
  if(bassMidi<0) bassMidi=0;
  let bassNote= noteNames[bassMidi%12]|| root;
  return bassNote;
}

/** Diameter of a falling orb, in px. Mirrors --orb-size in style.css. */
const ORB_SIZE_PX = 150;

/**
 * The orb's real diameter, so this file never has to know about style.css's
 * small-screen override of --orb-size. Falls back to ORB_SIZE_PX when the
 * element isn't laid out (no stylesheet, or a test's fake element).
 */
function measureOrbSize(element:HTMLElement):number {
  return element.offsetWidth|| ORB_SIZE_PX;
}

/**
 * Size of the play area. Orbs are positioned inside #gameArea, which is
 * 70vw wide and centred, so measuring the window instead put spawns past
 * its right edge where overflow:hidden cut them in half -- and put the
 * miss line below the visible bottom, so a missed orb sat invisible for a
 * second or two while still counting as playable. Falls back to the window
 * only when there's no play area to measure.
 */
function playField():{ width:number; height:number } {
  let gameArea= document.getElementById('gameArea');
  return {
    width: gameArea && gameArea.clientWidth? gameArea.clientWidth: window.innerWidth,
    height: gameArea && gameArea.clientHeight? gameArea.clientHeight: window.innerHeight
  };
}

/**
 * Left offset for an orb sitting at `fraction` along the horizontal track.
 * Clamped at both ends, so the whole orb is always inside the field even if
 * the field is narrower than one orb.
 */
function spawnLeftPx(fieldWidth:number, orbSize:number, fraction:number):number {
  return Math.max(0, (fieldWidth- orbSize)* Math.min(Math.max(fraction, 0), 1));
}

/**
 * Places a freshly built orb in the play area and registers it as falling.
 * Both generators funnel through here so spawn geometry lives in one place.
 */
function spawnCircle(element:HTMLElement, name:string, notes:string[]):void {
  let gameArea= document.getElementById('gameArea')!;
  gameArea.appendChild(element);
  // Measured only after appending -- offsetWidth is 0 for a detached node.
  let size= measureOrbSize(element);
  let xFraction= Math.random();
  element.style.left= spawnLeftPx(playField().width, size, xFraction)+"px";
  element.style.top= (-size)+"px";

  circles.push({
    element,
    noteOrChordName: name,
    noteOrChordNotes: notes,
    y: -size,
    // Read once, at spawn: orbs already falling keep the pace they started
    // at rather than accelerating under the player mid-descent.
    speed: currentStage().speed,
    destroyed: false,
    size,
    xFraction
  });
}

function generateNoteCircle():void {
  let note= getNextSingleNote();
  let element= document.createElement('div');
  element.className= "chordCircle";
  element.innerHTML= note;
  spawnCircle(element, note, [note]);
}

function generateChordCircle():void {
  let scale= currentScale();
  let chordSpec= getChordSpecForLevel(getNextChordDegree());
  let baseChord= chordSpec.notes;
  let lastChord= circles.length>0? circles[circles.length-1].noteOrChordNotes: null;
  let ci= closestInversion(lastChord, baseChord);
  let invertedChord= ci.inv;
  let chordAsc= [...invertedChord].sort((a,b)=> noteNames.indexOf(a)- noteNames.indexOf(b));
  let chordLabel= getChordFullName(chordSpec.root, chordSpec.quality);

  let finalChord= chordAsc;
  if(selectedLevel===5){
    let bass= createBassForLevel5(baseChord);
    finalChord= [bass, ...chordAsc];
  }

  let displayChord: string[];
  if(selectedLevel===4){
    displayChord= chordAsc;
  } else if(selectedLevel===3){
    displayChord= baseChord.slice();
  } else if(selectedLevel===5){
    displayChord= chordAsc; 
  } else {
    displayChord= invertedChord;
  }

  let element= document.createElement('div');
  element.className= "chordCircle";
  // Notes are shown in the scale's own spelling ("Bb-D-F"), not the
  // sharp-normalised form the matcher compares ("A#-D-F").
  element.innerHTML= orbInnerHtml(
    chordSpec.functionLabel,
    chordLabel,
    displayChord.map(n=> spellNoteInScale(n, scale)),
    showNotes
  );

  spawnCircle(element, chordLabel, finalChord);
}

/**
 * The three stacked lines inside a chord orb: scale-degree function, chord
 * name, and (until the ramp takes them away) the notes to play.
 *
 * Each line is classed so style.css can size it independently -- the note
 * list is much the longest string ("G-B-D-F", or five notes on level 5) and
 * overflowed the orb art at a single shared font size.
 */
function orbInnerHtml(
  functionLabel: string,
  chordLabel: string,
  notes: string[],
  withNotes: boolean
): string {
  let html= `<div class="ccFunction">${functionLabel}</div>`;
  html+= `<div class="ccLabel">${chordLabel}</div>`;
  if(withNotes) html+= `<div class="ccNotes">${notes.join("-")}</div>`;
  return html;
}

interface DifficultyStage {
  /** Score at which this stage takes over. */
  minScore: number;
  /** Whether orbs spell out their notes. */
  showNotes: boolean;
  /** Fall speed in px per 60fps frame (see updateCircles' deltaFactor). */
  speed: number;
  /** Gap between spawns, in ms. */
  spawnMs: number;
}

// The one difficulty ramp, driven by score. The player picks the level
// (which chord vocabulary they're practising); this decides how much help
// they get and how fast it comes.
//
// Note names are the first thing to go: reading "C-E-G" off the orb is a
// different skill from knowing what a C chord is, and the second is the one
// worth training. The chord name and its function stay visible for good,
// since they're the vocabulary the game is teaching rather than a crutch.
// Everything after that is pace: each stage falls faster and spawns sooner.
const DIFFICULTY_STAGES: DifficultyStage[] = [
  { minScore:  0, showNotes: true,  speed: 1.00, spawnMs: 3400 },
  { minScore:  6, showNotes: false, speed: 1.15, spawnMs: 3100 },
  { minScore: 14, showNotes: false, speed: 1.35, spawnMs: 2800 },
  { minScore: 24, showNotes: false, speed: 1.60, spawnMs: 2500 },
  { minScore: 36, showNotes: false, speed: 1.90, spawnMs: 2200 },
  { minScore: 50, showNotes: false, speed: 2.25, spawnMs: 2000 },
];

/** The highest stage the current score has reached. */
function currentStage():DifficultyStage {
  let stage= DIFFICULTY_STAGES[0];
  for(let s of DIFFICULTY_STAGES){
    if(score>= s.minScore) stage= s;
  }
  return stage;
}

function generateCircleByLevel():void {
  showNotes= currentStage().showNotes;
  if(selectedLevel===1|| selectedLevel===2){
    generateNoteCircle();
  } else {
    generateChordCircle();
  }
}

function updateCircles(deltaMs:number):void {
  // c.speed is tuned per-frame at REFERENCE_FRAME_MS (60fps); deltaFactor
  // normalizes movement to real elapsed time instead of frames actually
  // rendered, so fall speed no longer depends on the display's refresh
  // rate or on how expensive rendering the current frame was -- both
  // previously made circles speed up or slow down for reasons unrelated
  // to gameplay (TODO.org's "speed up by time" bug).
  let deltaFactor= deltaMs/REFERENCE_FRAME_MS;
  let field= playField();
  for(let i= circles.length-1;i>=0;i--){
    let c= circles[i];
    if(!c.destroyed){
      c.y+= c.speed*deltaFactor;
      c.element.style.top= c.y+"px";
      // Recomputed every frame rather than only at spawn: resizing the
      // window mid-game shrinks the play area under orbs already falling,
      // which used to leave them clipped by its right edge.
      c.element.style.left= spawnLeftPx(field.width, c.size, c.xFraction)+"px";
      // Missed once the orb's *bottom* reaches the field's bottom, which is
      // the moment it visually touches the edge -- what How to Play
      // promises, and no longer tied to the window's height.
      if(c.y+ c.size>= field.height){
        if(c.element.parentNode) c.element.parentNode.removeChild(c.element);
        circles.splice(i,1);
        lives--;
        updateLives();
        flashMiss();
        playMissSound();
        if(lives<=0) endGame();
      }
    } else {
      if(c.element.parentNode) c.element.parentNode.removeChild(c.element);
      circles.splice(i,1);
    }
  }
}

function updateCirclesAndSpawn(timestamp:number, deltaMs:number):void {
  updateCircles(deltaMs);
  syncEngineDrone();
  if(timestamp- lastSpawn> currentStage().spawnMs){
    generateCircleByLevel();
    lastSpawn= timestamp;
  }
}

/**
 * Empties the play area of orbs, both the tracking array and the actual
 * DOM nodes. startGame used to reset `circles` alone, which left every
 * <div> from the previous run appended to #gameArea -- so a restart began
 * with the dead orbs of the game before it still painted on screen.
 *
 * The stray sweep catches elements no longer in `circles`: a matchPop whose
 * 400ms cleanup timer hadn't fired when the game ended. It matches those
 * two classes only, so the #gameFx canvas survives.
 */
function clearCircles():void {
  for(const c of circles){
    if(c.element.parentNode) c.element.parentNode.removeChild(c.element);
  }
  circles= [];
  let gameArea= document.getElementById('gameArea');
  if(!gameArea|| typeof gameArea.querySelectorAll!=='function') return;
  gameArea.querySelectorAll('.chordCircle, .matchPop').forEach(el=>{
    if(el.parentNode) el.parentNode.removeChild(el);
  });
}

function endGame():void {
  gameRunning= false;
  clearCircles();
  let finalScore= document.getElementById('finalScore');
  if(finalScore) finalScore.innerText= "Your score: "+score;
  let gameScreen= document.getElementById('gameScreen');
  let endScreen= document.getElementById('endScreen');
  if(gameScreen) gameScreen.classList.remove('active');
  if(endScreen) endScreen.classList.add('active');
  stopAllSounds();
}

function stopAllSounds():void {
  for(let note in activeOscillators){
    activeOscillators[note].osc.stop();
  }
  activeOscillators={};
  stopEngineDrone();
}

async function startGame():Promise<void> {
  let midi= document.getElementById('midiSelect') as HTMLSelectElement|null;
  let keySel= document.getElementById('keySelect') as HTMLSelectElement|null;
  let genreSel= document.getElementById('genreSelect') as HTMLSelectElement|null;
  let scaleSel= document.getElementById('scaleSelect') as HTMLSelectElement|null;
  let levelSelect= document.getElementById('levelSelect') as HTMLSelectElement|null;
  let setupScreen= document.getElementById('setupScreen');
  let gameScreen= document.getElementById('gameScreen');
  let endScreen= document.getElementById('endScreen');

  if(levelSelect){
    selectedLevel= parseInt(levelSelect.value,10);
    if(isNaN(selectedLevel)|| selectedLevel<1|| selectedLevel>8){
      selectedLevel=4;
    }
  } else {
    selectedLevel=4;
  }

  // Real enforcement point -- disabling the <option> elements (see
  // refreshUnlockUI) is only a UI nicety, not what actually stops a
  // locked level from starting.
  if(!isLevelAllowed(selectedLevel, await isUnlocked())){
    alert("Level "+selectedLevel+" needs the paid unlock. Levels 1-3 are free -- see the unlock section to buy or enter a license key.");
    return;
  }

  if(genreSel&& genreSel.value) chosenGenre= genreSel.value;
  if(scaleSel&& scaleSel.value) chosenMode= scaleSel.value as ScaleName;
  if(keySel&& keySel.value) chosenKey= keySel.value;

  if(!isValidMidiInput(midi?.options)){
    alert("Please select a valid MIDI input device");
    return;
  }

  let selectedId= midi ? midi.value: "";
  let inputs:MIDIInput[]=[];
  midiAccess!.inputs.forEach(inp=> inputs.push(inp));
  midiInput= inputs.find(i=> i.id=== selectedId);
  if(midiInput) midiInput.onmidimessage= onMIDIMessage;

  score=0;
  lives=MAX_LIVES;
  updateScore();
  updateLives();
  // Back to stage one's settings for the new run.
  showNotes= currentStage().showNotes;

  if(setupScreen) setupScreen.classList.remove('active');
  if(gameScreen) gameScreen.classList.add('active');
  if(endScreen) endScreen.classList.remove('active');

  clearCircles();
  // Any notes still held from the previous run would otherwise count
  // towards matching the first orb of this one.
  noteOnStack= [];
  gameRunning= true;
  progressionIndex= 0;
  chordIndex= 0;
  lastSpawn= 0;
  lastFrameTime= 0;

  requestAnimationFrame(gameLoop);
}

/**
 * Whether a MIDI port is something you can actually play. ALSA on Linux
 * always exposes a "Midi Through Port-0" loopback, and it shows up in the
 * device list next to real keyboards while carrying no input of its own --
 * confusing, and picking it silently produces a game that never responds.
 */
function isUsableMidiInputName(name:string):boolean {
  return !/midi\s*through/i.test(name);
}

/** Marks the "nothing to select" option, which isValidMidiInput rejects. */
const NO_MIDI_OPTION_VALUE = "";

function populateMIDIInputs():void {
  let select= document.getElementById('midiSelect') as HTMLSelectElement|null;
  if(!select) return;
  select.innerHTML= "";
  let inputs:MIDIInput[]=[];
  midiAccess!.inputs.forEach(inp=>{
    if(isUsableMidiInputName(inp.name|| "")) inputs.push(inp);
  });
  if(inputs.length===0){
    let option= document.createElement('option');
    option.value= NO_MIDI_OPTION_VALUE;
    option.innerText= "No MIDI keyboard found";
    select.appendChild(option);
  } else {
    inputs.forEach(input=>{
      let option= document.createElement('option');
      option.value= input.id;
      option.innerText= input.name|| "";
      select.appendChild(option);
    });
  }
}

/**
 * True when the dropdown holds at least one real device. Every real option
 * carries the MIDIInput's id as its value; the "No MIDI keyboard found"
 * placeholder deliberately has none, which is what distinguishes them.
 */
function isValidMidiInput(midiInputs:HTMLOptionsCollection| undefined):boolean {
  if(!midiInputs|| midiInputs.length===0) return false;
  for(let i=0;i<midiInputs.length;i++){
    if((midiInputs[i] as HTMLOptionElement).value!== NO_MIDI_OPTION_VALUE) return true;
  }
  return false;
}

// --- Paid-level unlock ---
//
// Levels 1-3 (single notes, basic triads) are free; levels 4-8 need a
// verified one-time purchase. See worker/README.md for the full design
// rationale -- summary: a static GitHub Pages site can't securely gate
// anything (any check here can be patched out in devtools by a
// sufficiently determined user), so this isn't real DRM. What it does do:
// require an actual Gumroad purchase (checked server-side, since only
// Gumroad's API knows about refunds/chargebacks) before minting an
// unlock token, and let that token verify itself entirely offline
// afterward via a real ECDSA signature, so normal page loads never
// re-contact the Worker or Gumroad.

const FREE_LEVEL_MAX = 3;
const UNLOCK_TOKEN_STORAGE_KEY = "chordNebulaUnlockToken";
// Set these two after deploying worker/ and creating the Gumroad product
// (see worker/README.md) -- placeholders won't work.
const LICENSE_VERIFY_URL = "https://REPLACE_ME.workers.dev/verify";
const GUMROAD_PRODUCT_URL = "https://REPLACE_ME.gumroad.com/l/chord-nebula";
// The public half of the Worker's signing keypair. Safe to commit: a
// public key can verify a signature but can't forge one. Generate
// alongside the Worker's PRIVATE_KEY_JWK secret -- see worker/README.md.
const UNLOCK_PUBLIC_KEY_JWK: JsonWebKey = {
  kty: "REPLACE_ME",
};

function base64UrlToBytes(value: string): Uint8Array {
  let padded= value.replace(/-/g,'+').replace(/_/g,'/');
  while(padded.length%4!==0) padded+= '=';
  let binary= atob(padded);
  let bytes= new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]= binary.charCodeAt(i);
  return bytes;
}

/** Verifies an unlock token's ECDSA signature against UNLOCK_PUBLIC_KEY_JWK, entirely offline -- no network call. */
async function verifyLicenseToken(token:string):Promise<boolean> {
  let parts= token.split('.');
  if(parts.length!==2) return false;
  try {
    let payloadBytes= base64UrlToBytes(parts[0]);
    let signature= base64UrlToBytes(parts[1]);
    let key= await crypto.subtle.importKey(
      "jwk", UNLOCK_PUBLIC_KEY_JWK, {name:"ECDSA", namedCurve:"P-256"}, false, ["verify"]
    );
    let valid= await crypto.subtle.verify({name:"ECDSA", hash:"SHA-256"}, key, signature, payloadBytes);
    if(!valid) return false;
    let payload= JSON.parse(new TextDecoder().decode(payloadBytes));
    return payload.unlocked===true;
  } catch(e) {
    return false;
  }
}

/** Whether the stored unlock token (if any) is present and cryptographically valid. */
async function isUnlocked():Promise<boolean> {
  let token= localStorage.getItem(UNLOCK_TOKEN_STORAGE_KEY);
  if(!token) return false;
  return verifyLicenseToken(token);
}

interface UnlockResult { ok:boolean; error?:string; }

/** Submits a license key to the verification Worker; stores the returned token on success. */
async function unlockWithLicenseKey(licenseKey:string):Promise<UnlockResult> {
  try {
    let res= await fetch(LICENSE_VERIFY_URL, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({licenseKey})
    });
    let data= await res.json();
    if(!res.ok){
      return {ok:false, error: data.error|| "Could not verify that license key."};
    }
    localStorage.setItem(UNLOCK_TOKEN_STORAGE_KEY, data.token);
    return {ok:true};
  } catch(e) {
    return {ok:false, error:"Network error while verifying your license key."};
  }
}

/** Whether LEVEL is playable given the current unlock state. */
function isLevelAllowed(level:number, unlocked:boolean):boolean {
  return level<=FREE_LEVEL_MAX|| unlocked;
}

/**
 * Reflects unlock state in the UI: disables levels 4-8 in the dropdown
 * (a nicety -- startGame's own check is what actually enforces this) and
 * toggles the unlock form vs. an "unlocked" message.
 */
async function refreshUnlockUI():Promise<void> {
  let unlocked= await isUnlocked();

  let levelSelect= document.getElementById('levelSelect') as HTMLSelectElement|null;
  if(levelSelect){
    for(let i=0;i<levelSelect.options.length;i++){
      let opt= levelSelect.options[i];
      let lvl= parseInt(opt.value,10);
      if(!isNaN(lvl)) opt.disabled= !isLevelAllowed(lvl, unlocked);
    }
  }

  let unlockForm= document.getElementById('unlockForm');
  let unlockedMessage= document.getElementById('unlockedMessage');
  if(unlockForm) unlockForm.style.display= unlocked? 'none':'';
  if(unlockedMessage) unlockedMessage.style.display= unlocked? '':'none';

  let purchaseLink= document.getElementById('purchaseLink') as HTMLAnchorElement|null;
  if(purchaseLink) purchaseLink.href= GUMROAD_PRODUCT_URL;
}

/** Shows the screen with ID `id`, hiding every other `.screen` element. */
function showScreen(id: string): void {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  let target= document.getElementById(id);
  if(target) target.classList.add('active');
}

/**
 * Builds the About screen's contact link at runtime from the two data
 * attributes on #contactEmail. The complete address is never present in
 * index.html, and the "@" is assembled from its char code so it isn't a
 * literal in dist/app.js either -- address harvesters read both files.
 */
function renderContactEmail():void {
  let holder= document.getElementById('contactEmail');
  if(!holder) return;
  let user= holder.dataset.user|| "";
  let domain= holder.dataset.domain|| "";
  if(!user|| !domain) return;
  let address= user+ String.fromCharCode(64)+ domain;
  let link= document.createElement('a');
  link.href= "mailto:"+ address;
  link.textContent= address;
  holder.appendChild(link);
}

// --- Setup screen: genre -> scale -> key ---------------------------
// Each select narrows the next one: a genre offers only the scales its
// progressions use, and a scale offers only the tonics that spell it
// correctly. Options are built here rather than listed in index.html
// because both lists are derived (see getScalesForGenre, getKeysForScale).

function addOption(select:HTMLSelectElement, value:string, text:string):void {
  let option= document.createElement('option');
  option.value= value;
  option.innerText= text;
  select.appendChild(option);
}

function populateGenreSelect():void {
  let select= document.getElementById('genreSelect') as HTMLSelectElement|null;
  if(!select) return;
  select.innerHTML= "";
  for(const genre of GENRES) addOption(select, genre.id, genre.label);
  select.value= chosenGenre;
}

function populateScaleSelect():void {
  let select= document.getElementById('scaleSelect') as HTMLSelectElement|null;
  if(!select) return;
  let scales= getScalesForGenre(chosenGenre);
  select.innerHTML= "";
  for(const scale of scales) addOption(select, scale, SCALE_LABELS[scale]);
  // Keep the current scale if the new genre also uses it, so switching
  // genres doesn't silently drop you out of the minor you were practising.
  if(scales.indexOf(chosenMode)<0) chosenMode= scales[0];
  select.value= chosenMode;
}

function populateKeySelect():void {
  let select= document.getElementById('keySelect') as HTMLSelectElement|null;
  if(!select) return;
  let keys= getKeysForScale(chosenMode);
  // Modes spell their tonics differently (A minor, C major, D dorian are
  // all the white notes), so the old key is matched by pitch rather than by
  // name: picking Bb major then switching to dorian lands on Bb dorian.
  let wanted= pitchClass(chosenKey);
  let match= keys.filter(k=> pitchClass(k)=== wanted)[0];
  chosenKey= match|| keys[0];
  select.innerHTML= "";
  for(const key of keys) addOption(select, key, key);
  select.value= chosenKey;
}

/** Lists what the current genre and scale will actually throw at you. */
function renderProgressionPreview():void {
  let preview= document.getElementById('progressionPreview');
  if(!preview) return;
  let labels= getProgressionsFor(chosenGenre, chosenMode).map(p=> p.label);
  preview.innerText= "Progressions: "+ labels.join("  |  ");
}

function refreshSetupSelects():void {
  populateScaleSelect();
  populateKeySelect();
  renderProgressionPreview();
}

/**
 * Explains an empty device list and takes Start away, since there is
 * nothing to start. Web MIDI support is not universal: Chrome, Edge, Opera
 * and Brave have it, Firefox needs its Web MIDI site-permission add-on, and
 * Safari has none. Before this, those browsers showed an empty dropdown and
 * left the player to guess why.
 */
function showMidiNotice(message:string):void {
  let notice= document.getElementById('midiUnsupported');
  if(notice){
    notice.innerText= message;
    notice.style.display= '';
  }
  let start= document.getElementById('startButton') as HTMLButtonElement|null;
  if(start) start.disabled= true;
}

// --- Pure logic ends here; DOM/browser wiring runs immediately below ---
// (test/support/loadApp.ts slices the file at this exact comment to load
// the chord/game logic above it in Node without a DOM, so tests can call
// functions like matchesLevel4/getChordSpecForLevel directly. Nothing at
// or above this line may execute top-level code that touches document/
// window/navigator, or the test loader breaks.)

const menuButtonTargets: {[buttonId:string]:string} = {
  menuStartButton: 'setupScreen',
  menuHowToPlayButton: 'howToPlayScreen',
  menuAboutButton: 'aboutScreen',
  menuSubscribeButton: 'subscribeScreen'
};
for(let buttonId in menuButtonTargets){
  let button= document.getElementById(buttonId);
  let targetId= menuButtonTargets[buttonId];
  if(button) button.addEventListener('click', ()=> showScreen(targetId));
}

renderContactEmail();

document.querySelectorAll('.backButton').forEach(button=>{
  let targetId= (button as HTMLElement).dataset.backTo|| 'mainMenuScreen';
  button.addEventListener('click', ()=> showScreen(targetId));
});

// Arrow-key navigation between the buttons of whichever nav is showing --
// Tab/Enter/Space already work via native <button> focus semantics, this
// just adds the arcade-y up/down cycling on top of that (mouse/touch
// works regardless).
document.querySelectorAll('.screenNav').forEach(nav=>{
  let navButtons= Array.from(nav.querySelectorAll('button')) as HTMLButtonElement[];
  nav.addEventListener('keydown', (e)=>{
    let key= (e as KeyboardEvent).key;
    let idx= navButtons.indexOf(document.activeElement as HTMLButtonElement);
    if(key==='ArrowDown'){
      e.preventDefault();
      navButtons[(idx+1+navButtons.length)% navButtons.length]?.focus();
    } else if(key==='ArrowUp'){
      e.preventDefault();
      navButtons[(idx-1+navButtons.length)% navButtons.length]?.focus();
    }
  });
});

const genreSelect= document.getElementById('genreSelect') as HTMLSelectElement|null;
if(genreSelect) genreSelect.addEventListener('change', ()=>{
  chosenGenre= genreSelect.value;
  refreshSetupSelects();
});

const scaleSelect= document.getElementById('scaleSelect') as HTMLSelectElement|null;
if(scaleSelect) scaleSelect.addEventListener('change', ()=>{
  chosenMode= scaleSelect.value as ScaleName;
  populateKeySelect();
  renderProgressionPreview();
});

const keySelectEl= document.getElementById('keySelect') as HTMLSelectElement|null;
if(keySelectEl) keySelectEl.addEventListener('change', ()=>{
  chosenKey= keySelectEl.value;
});

populateGenreSelect();
refreshSetupSelects();

const startButton= document.getElementById('startButton');
if(startButton) startButton.addEventListener('click', startGame);

refreshUnlockUI();

const unlockButton= document.getElementById('unlockButton');
const licenseKeyInput= document.getElementById('licenseKeyInput') as HTMLInputElement|null;
const unlockError= document.getElementById('unlockError');
if(unlockButton) unlockButton.addEventListener('click', async ()=>{
  let key= licenseKeyInput? licenseKeyInput.value: "";
  if(unlockError) unlockError.textContent= "";
  (unlockButton as HTMLButtonElement).disabled= true;
  (unlockButton as HTMLButtonElement).textContent= "Verifying...";
  let result= await unlockWithLicenseKey(key);
  (unlockButton as HTMLButtonElement).disabled= false;
  (unlockButton as HTMLButtonElement).textContent= "Unlock";
  if(result.ok){
    await refreshUnlockUI();
  } else if(unlockError){
    unlockError.textContent= result.error|| "Could not verify that license key.";
  }
});

const restartButton= document.getElementById('restartButton');
if(restartButton) restartButton.addEventListener('click', ()=>{
  clearCircles();
  showScreen('setupScreen');
});

if(navigator.requestMIDIAccess){
  navigator.requestMIDIAccess()
    .then((access: MIDIAccess)=>{
      midiAccess= access;
      populateMIDIInputs();
      // Keyboards get plugged in after the page is already open more often
      // than not; without this the list stayed stale until a reload.
      access.onstatechange= ()=> populateMIDIInputs();
    })
    .catch((err:any)=>{
      console.error("Failed to access MIDI devices:", err);
      showMidiNotice(
        "MIDI access was blocked, so your keyboard can't be read. Allow MIDI "+
        "for this site in your browser's settings, then reload."
      );
    });
} else {
  showMidiNotice(
    "This browser has no Web MIDI support, so it can't read your keyboard. "+
    "Chrome, Edge, Opera and Brave work; Firefox needs its Web MIDI site "+
    "permission add-on, and Safari has no support yet."
  );
}

// --- Decorative play-area canvas overlay ---------------------------
// Ambient equalizer/waveform/matrix-rain drawn over images/gameArea-bg.png
// (the delivered v2b art), per the asset drop's README: animating on a
// transparent canvas is far lighter than shipping an animated raster.
//
// Three constraints shape this:
//   * It must never compete with gameplay. The play area's centre is left
//     empty -- the art was authored with a quiet centre for exactly this
//     reason -- and #gameFx sits at z-index 0, below .chordCircle.
//   * It must cost nothing off the game screen. The rAF loop only runs
//     while #gameScreen is .active and the tab is visible.
//   * prefers-reduced-motion gets a single static frame, not a loop.
(function setUpGameFx(): void {
  const canvas= document.getElementById('gameFx') as HTMLCanvasElement|null;
  const gameArea= document.getElementById('gameArea');
  const gameScreen= document.getElementById('gameScreen');
  if(!canvas|| !gameArea|| !gameScreen) return;
  const ctx= canvas.getContext('2d');
  if(!ctx) return;
  runGameFx(canvas, ctx, gameArea, gameScreen);
})();

function runGameFx(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  gameArea: HTMLElement,
  gameScreen: HTMLElement
): void {
  const GREEN= '#00ff66';
  const GREEN_SOFT= '#51ff9a';

  const reduceMotion= typeof window.matchMedia==='function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const streams: { x:number; y:number; speed:number; char:string }[] = [];
  for(let i=0;i<34;i++){
    streams.push({
      x: Math.random(),
      y: Math.random(),
      speed: 0.025+ Math.random()*0.07,
      char: Math.random()>0.5? '1':'0'
    });
  }

  let W= 0, H= 0, t= 0, last= 0, rafId= 0;

  function resize(): void {
    const dpr= Math.min(window.devicePixelRatio|| 1, 2);
    W= gameArea.clientWidth;
    H= gameArea.clientHeight;
    canvas.width= Math.max(1, Math.round(W*dpr));
    canvas.height= Math.max(1, Math.round(H*dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function glow(alpha: number, blur: number): void {
    ctx.globalAlpha= alpha;
    ctx.shadowColor= GREEN;
    ctx.shadowBlur= blur;
  }

  function clearGlow(): void {
    ctx.shadowBlur= 0;
    ctx.globalAlpha= 1;
  }

  function drawEqualizer(x:number, y:number, w:number, h:number, time:number, bars:number): void {
    const gap= w*0.018;
    const bw= (w- gap*(bars-1))/bars;
    for(let i=0;i<bars;i++){
      const phase= i*0.72;
      const a= (Math.sin(time*3.2+ phase)+1)/2;
      const b= (Math.sin(time*5.1+ phase*0.6)+1)/2;
      const level= 0.10+ 0.90*(a*0.58+ b*0.42);
      const bh= h*level;
      // Deliberately faint: images/gameArea-bg.png already has equalizers and
      // dials painted into these corners, so at full opacity the overlay read
      // as a second set of widgets sitting on top of them. Kept low, it
      // instead looks like the art's own widgets have come alive.
      glow(0.15+ 0.17*level, 8);
      ctx.fillStyle= GREEN;
      ctx.fillRect(x+ i*(bw+gap), y+ h- bh, bw, bh);
    }
    clearGlow();
  }

  function drawWaveform(x:number, y:number, w:number, h:number, time:number): void {
    ctx.beginPath();
    for(let i=0;i<=180;i++){
      const px= x+ (i/180)*w;
      const env= Math.sin(Math.PI*i/180);
      const v=
        Math.sin(i*0.22+ time*6.0)*0.42+
        Math.sin(i*0.53- time*4.2)*0.20+
        Math.sin(i*0.09+ time*2.5)*0.16;
      const py= y+ h/2+ v*env*h*0.34;
      if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    glow(0.4, 10);
    ctx.strokeStyle= GREEN_SOFT;
    ctx.lineWidth= 1.5;
    ctx.stroke();
    clearGlow();

    ctx.globalAlpha= 0.10;
    ctx.strokeStyle= GREEN;
    ctx.beginPath();
    ctx.moveTo(x, y+h/2);
    ctx.lineTo(x+w, y+h/2);
    ctx.stroke();
    ctx.globalAlpha= 1;
  }

  function drawMatrixRain(dt:number): void {
    ctx.font= Math.max(9, W*0.006)+"px monospace";
    ctx.textAlign= 'center';
    ctx.fillStyle= GREEN;
    for(let i=0;i<streams.length;i++){
      const s= streams[i];
      s.y+= s.speed*dt;
      if(s.y>1.1){ s.y= -0.1; s.x= Math.random(); s.char= Math.random()>0.5? '1':'0'; }
      ctx.globalAlpha= 0.05+ (i%5)*0.012;
      ctx.fillText(s.char, s.x*W, s.y*H);
    }
    ctx.globalAlpha= 1;
  }

  /** One frame at the current time `t`. Corners only -- the centre band is
      left untouched so falling circles stay readable. */
  function render(dt:number): void {
    ctx.clearRect(0, 0, W, H);
    drawMatrixRain(dt);
    drawEqualizer(W*0.80, H*0.14, W*0.15, H*0.15, t, 24);
    drawWaveform(W*0.72, H*0.82, W*0.22, H*0.10, t);
    drawEqualizer(W*0.055, H*0.72, W*0.11, H*0.16, t+0.7, 14);
    drawWaveform(W*0.045, H*0.23, W*0.20, H*0.075, t+1.1);
  }

  function frame(ms:number): void {
    const dt= Math.min(last? (ms-last)/1000: 0, 0.05);
    last= ms;
    t+= dt;
    render(dt);
    rafId= requestAnimationFrame(frame);
  }

  function start(): void {
    if(rafId) return;
    last= 0;
    rafId= requestAnimationFrame(frame);
  }

  function stop(): void {
    if(!rafId) return;
    cancelAnimationFrame(rafId);
    rafId= 0;
  }

  function redraw(): void {
    resize();
    if(reduceMotion) render(0);
  }

  /** Starts/stops purely off #gameScreen's .active class, so every path
      that shows or hides the game screen (startGame, endGame, showScreen,
      the restart button) is covered without touching any of them. */
  function sync(): void {
    if(gameScreen.classList.contains('active') && !document.hidden){
      redraw();
      if(!reduceMotion) start();
    } else {
      stop();
    }
  }

  new MutationObserver(sync).observe(gameScreen, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', sync);

  if(typeof ResizeObserver==='function'){
    new ResizeObserver(redraw).observe(gameArea);
  } else {
    window.addEventListener('resize', redraw);
  }

  sync();
}
