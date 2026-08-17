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
let chosenMode: "major" | "minor" = "major";
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

const minorScales:{[key:string]:string[]}={
  "A": ["A","B","C","D","E","F","G"],
  "E": ["E","F#","G","A","B","C","D"],
  "B": ["B","C#","D","E","F#","G","A"],
  "F#":["F#","G#","A","B","C#","D","E"],
  "C#":["C#","D#","E","F#","G#","A","B"],
  "G#":["G#","A#","B","C#","D#","E","F#"],
  "D#":["D#","E#","F#","G#","A#","B","C#"],
  "A#":["A#","B#","C#","D#","E#","F#","G#"],
  "D": ["D","E","F","G","A","Bb","C"],
  "G": ["G","A","Bb","C","D","Eb","F"],
  "C": ["C","D","Eb","F","G","Ab","Bb"],
  "F": ["F","G","Ab","Bb","C","Db","Eb"],
  "Bb":["Bb","C","Db","Eb","F","Gb","Ab"],
  "Eb":["Eb","F","Gb","Ab","Bb","Cb","Db"]
};

const degreeMapMajor:any={
  "I":0,"ii":1,"iii":2,"IV":3,"V":4,"vi":5,"vii":6
};
const degreeMapMinor:any={
  "i":0,"ii°":1,"III":2,"iv":3,"v":4,"VI":5,"VII":6
};

const degreeQualityMapMajor:any={
  "I":"maj","ii":"min","iii":"min","IV":"maj","V":"maj","vi":"min","vii":"dim"
};
const degreeQualityMapMinor:any={
  "i":"min","ii°":"dim","III":"maj","iv":"min","v":"min","VI":"maj","VII":"maj"
};

const degreeSeventhQualityMapMajor: { [key: string]: ChordQuality } = {
  "I":"maj7","ii":"min7","iii":"min7","IV":"maj7","V":"dom7","vi":"min7","vii":"hdim7"
};
const degreeSeventhQualityMapMinor: { [key: string]: ChordQuality } = {
  "i":"min7","ii°":"hdim7","III":"maj7","iv":"min7","v":"min7","VI":"maj7","VII":"dom7"
};

const degreeNinthQualityMapMajor: { [key: string]: ChordQuality } = {
  "I":"maj9","ii":"min9","iii":"min9","IV":"maj9","V":"dom9","vi":"min9","vii":"hdim9"
};
const degreeNinthQualityMapMinor: { [key: string]: ChordQuality } = {
  "i":"min9","ii°":"hdim9","III":"maj9","iv":"min9","v":"min9","VI":"maj9","VII":"dom9"
};

const majorProgressions=[
  ["I","IV","V","I"],
  ["I","vi","IV","V"],
  ["ii","V","I","I"]
];

const minorProgressions=[
  ["i","iv","v","i"],
  ["i","VI","III","VII"],
  ["ii°","v","i","i"]
];

function ensureAudioContext():void {
  if(!audioContext) audioContext=new AudioContext();
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
  let ctx= audioContext!;
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
  for(let i=0; i<chordNotes.length; i++){
    let cNote= toSharpName(chordNotes[i]);
    let pNote= toSharpName(midiNoteToName(playedAsc[i].midiNumber));
    if(cNote!== pNote) return false;
  }
  if(playedAsc.length>=2){
    let bassMidi= playedAsc[0].midiNumber;
    let secondMidi= playedAsc[1].midiNumber;
    if(bassMidi> secondMidi) return false;
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
  let ctx= audioContext!;
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
  if(typeof AudioContext==='undefined') return;
  ensureAudioContext();
  engineStep= 0;
  engineNextStepTime= audioContext!.currentTime+ 0.05;
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
  let ctx= audioContext!;
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

function chordDegreesToChordNotes(key:string, degree:string, mode:"major"|"minor"):string[] {
  let scale= (mode==="major"? majorScales[key]: minorScales[key])|| [];
  let degMap= (mode==="major"? degreeMapMajor: degreeMapMinor);
  let idx= degMap[degree];
  if(idx===undefined) return ["C","E","G"];
  let root= scale[idx];
  let third= scale[(idx+2)%7];
  let fifth= scale[(idx+4)%7];
  return [root, third, fifth].map(normalizeChordNote);
}

function chordQualityToIntervals(quality: ChordQuality): number[] {
  switch(quality){
    case "maj":
      return [0,4,7];
    case "min":
      return [0,3,7];
    case "dim":
      return [0,3,6];
    case "aug":
      return [0,4,8];
    case "dom7":
      return [0,4,7,10];
    case "maj7":
      return [0,4,7,11];
    case "min7":
      return [0,3,7,10];
    case "hdim7":
      return [0,3,6,10];
    case "dim7":
      return [0,3,6,9];
    case "maj9":
      return [0,4,7,11,14];
    case "min9":
      return [0,3,7,10,14];
    case "dom9":
      return [0,4,7,10,14];
    case "hdim9":
      return [0,3,6,10,14];
    default:
      return [0,4,7];
  }
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

function getTriadQuality(degree: string): ChordQuality {
  let mapRef= (chosenMode==="major"? degreeQualityMapMajor: degreeQualityMapMinor);
  return mapRef[degree] || "maj";
}

function getSeventhQuality(degree: string): ChordQuality {
  let mapRef= (chosenMode==="major"? degreeSeventhQualityMapMajor: degreeSeventhQualityMapMinor);
  return mapRef[degree] || "dom7";
}

function getNinthQuality(degree: string): ChordQuality {
  let mapRef= (chosenMode==="major"? degreeNinthQualityMapMajor: degreeNinthQualityMapMinor);
  return mapRef[degree] || "dom9";
}

function isDominantDegree(degree: string): boolean {
  let clean= degree.replace("°","");
  return clean==="V" || clean==="v";
}

function chooseLevel8Quality(degree: string): ChordQuality {
  let baseQuality= getTriadQuality(degree);
  let options: ChordQuality[] = [baseQuality];
  if(baseQuality==="maj"){
    options.push("maj7","maj9");
  } else if(baseQuality==="min"){
    options.push("min7","min9");
  } else if(baseQuality==="dim"){
    options.push("hdim7","hdim9","dim7");
  }
  if(isDominantDegree(degree)){
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

function getChordRootFromDegree(key: string, degree: string, mode: "major"|"minor"): string {
  let scale= (mode==="major"? majorScales[key]: minorScales[key])|| [];
  let degMap= (mode==="major"? degreeMapMajor: degreeMapMinor);
  let idx= degMap[degree];
  if(idx===undefined) return "C";
  return scale[idx] || "C";
}

function getChordSpecForLevel(degree: string): { root: string; quality: ChordQuality; notes: string[] } {
  let root= getChordRootFromDegree(chosenKey, degree, chosenMode);
  let quality: ChordQuality;
  if(selectedLevel===6){
    quality= getSeventhQuality(degree);
  } else if(selectedLevel===7){
    quality= Math.random()<0.5 ? "dim" : "aug";
  } else if(selectedLevel===8){
    quality= chooseLevel8Quality(degree);
  } else {
    quality= getTriadQuality(degree);
  }
  let notes= buildChordFromRoot(root, quality);
  return { root, quality, notes };
}

function getProgressions():string[][] {
  return (chosenMode==="major"? majorProgressions: minorProgressions);
}

function getNextChordName():string {
  let p= getProgressions();
  let progression= p[progressionIndex];
  let chordName= progression[chordIndex];
  chordIndex++;
  if(chordIndex>= progression.length){
    chordIndex=0;
    progressionIndex=(progressionIndex+1)% p.length;
  }
  return chordName;
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
  let scale= (chosenMode==="major"? majorScales[chosenKey]: minorScales[chosenKey])|| [];
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

function getChordFullName(
  key: string,
  degree: string,
  baseChord: string[],
  finalChord: string[],
  quality?: ChordQuality
): string {
  let root= baseChord[0];
  let resolvedQuality= quality || getTriadQuality(degree);
  let labelSuffix= chordQualityToLabel(resolvedQuality);
  if(labelSuffix==="") return root;
  return `${root}${labelSuffix}`;
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
  let chordDegree= getNextChordName();
  let chordSpec= getChordSpecForLevel(chordDegree);
  let baseChord= chordSpec.notes;
  let lastChord= circles.length>0? circles[circles.length-1].noteOrChordNotes: null;
  let ci= closestInversion(lastChord, baseChord);
  let invertedChord= ci.inv;
  let chordAsc= [...invertedChord].sort((a,b)=> noteNames.indexOf(a)- noteNames.indexOf(b));
  let chordLabel= getChordFullName(chosenKey, chordDegree, baseChord, invertedChord, chordSpec.quality);

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
  element.innerHTML= orbInnerHtml(chordDegree, chordLabel, displayChord, showNotes);

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
  let modeInputs= document.querySelectorAll('input[name="mode"]') as NodeListOf<HTMLInputElement>;
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

  if(keySel) chosenKey= keySel.value;

  if(!isValidMidiInput(midi?.options)){
    alert("Please select a valid MIDI input device");
    return;
  }

  modeInputs.forEach(m=>{
    if(m.checked) chosenMode= m.value as "major"|"minor";
  });

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
      alert("MIDI access was denied. Please allow MIDI access to use Chord Nebula.");
    });
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
