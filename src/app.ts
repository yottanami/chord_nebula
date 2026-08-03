let audioContext: AudioContext | null = null;
let midiAccess: MIDIAccess | null = null;
let midiInput: MIDIInput | undefined;
let gameRunning: boolean = false;
let score: number = 0;
let lives: number = 3;

interface Circle {
  element: HTMLElement;
  noteOrChordName: string;
  noteOrChordNotes: string[];
  y: number;
  speed: number;
  destroyed: boolean;
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
let showNotes: boolean = true;
let showFunctions: boolean = false;
let lastSpawn: number = 0;
let lastFrameTime: number = 0;
let activeOscillators: { [key: number]: { osc: OscillatorNode; gain: GainNode } } = {};
let selectedLevel: number = 4;
let circleSpawnCount: number = 0;

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
//    if(secondMidi- bassMidi<12) return false;
  }
  return true;
}

function updateScore():void {
  let s= document.getElementById('scoreDisplay');
  if(s) s.innerText= "Score: "+score;
}

function updateLives():void {
  let l= document.getElementById('livesDisplay');
  if(l) l.innerText= "Lives: "+lives;
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

function createBassForLevel5(baseChord:string[], chordAsc:string[]):string {
  let root= baseChord[0];
  let bassMidi= noteNameToMidi(root,2);
  if(bassMidi<0) bassMidi=0;
  let bassNote= noteNames[bassMidi%12]|| root;
  return bassNote;
}

function generateNoteCircle():void {
  let note= getNextSingleNote();
  let element= document.createElement('div');
  element.className= "chordCircle";
  element.innerHTML= note;
  let gameArea= document.getElementById('gameArea')!;
  element.style.left= (Math.random()*(window.innerWidth-100))+"px";
  element.style.top= "-100px";
  gameArea.appendChild(element);

  circleSpawnCount++;
  let speedScale= 1 + circleSpawnCount*0.01;

  circles.push({
    element,
    noteOrChordName: note,
    noteOrChordNotes: [note],
    y: -100,
    speed: speedScale,
    destroyed: false
  });
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
    let bass= createBassForLevel5(baseChord, chordAsc);
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
  let htmlContent= "";
  if(showFunctions){
    htmlContent+= `<div>${chordDegree}</div>`;
  }
  htmlContent+= `<div>${chordLabel}</div>`;

  if(score>5) showNotes= false;

  if(showNotes){
    htmlContent+= `<div>${displayChord.join("-")}</div>`;
  }

  element.innerHTML= htmlContent;

  let gameArea= document.getElementById('gameArea')!;
  element.style.left= (Math.random()*(window.innerWidth-100))+"px";
  element.style.top= "-100px";
  gameArea.appendChild(element);

  circleSpawnCount++;
  let speedScale= 1 + circleSpawnCount*0.01;

  circles.push({
    element,
    noteOrChordName: chordLabel,
    noteOrChordNotes: finalChord,
    y: -100,
    speed: speedScale,
    destroyed: false
  });
}

function generateCircleByLevel():void {
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
  for(let i= circles.length-1;i>=0;i--){
    let c= circles[i];
    if(!c.destroyed){
      c.y+= c.speed*deltaFactor;
      c.element.style.top= c.y+"px";
      if(c.y> (window.innerHeight-50)){
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
  if(timestamp- lastSpawn> 3000){
    generateCircleByLevel();
    lastSpawn= timestamp;
  }
}

function endGame():void {
  gameRunning= false;
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
}

async function startGame():Promise<void> {
  let midi= document.getElementById('midiSelect') as HTMLSelectElement|null;
  let keySel= document.getElementById('keySelect') as HTMLSelectElement|null;
  let notesCheck= document.getElementById('showNotesCheckbox') as HTMLInputElement|null;
  let functionsCheck= document.getElementById('showFunctionsCheckbox') as HTMLInputElement|null;
  let modeInputs= document.querySelectorAll('input[name="mode"]') as NodeListOf<HTMLInputElement>;
  let levelSelect= document.getElementById('levelSelect') as HTMLSelectElement|null;
  let setupScreen= document.getElementById('setupScreen');
  let gameScreen= document.getElementById('gameScreen');
  let endScreen= document.getElementById('endScreen');

  circleSpawnCount= 0;

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

  if(notesCheck) showNotes= notesCheck.checked;
  if(functionsCheck) showFunctions= functionsCheck.checked;
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
  lives=3;
  updateScore();
  updateLives();

  if(setupScreen) setupScreen.classList.remove('active');
  if(gameScreen) gameScreen.classList.add('active');
  if(endScreen) endScreen.classList.remove('active');

  circles= [];
  gameRunning= true;
  progressionIndex= 0;
  chordIndex= 0;
  lastSpawn= 0;
  lastFrameTime= 0;

  requestAnimationFrame(gameLoop);
}

function populateMIDIInputs():void {
  let select= document.getElementById('midiSelect') as HTMLSelectElement|null;
  if(!select) return;
  select.innerHTML= "";
  let inputs:MIDIInput[]=[];
  midiAccess!.inputs.forEach(inp=> inputs.push(inp));
  if(inputs.length===0){
    let option= document.createElement('option');
    option.innerText= "No MIDI devices found";
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

function isValidMidiInput(midiInputs:HTMLOptionsCollection| undefined):boolean {
  if(!midiInputs|| midiInputs.length===0) return false;
  if(midiInputs.length===1 && (midiInputs[0] as HTMLOptionElement).innerText==="Midi Through Port-0"){
    return false;
  }
  return true;
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
  menuSubscribeButton: 'subscribeScreen',
  menuOptionsButton: 'optionsScreen'
};
for(let buttonId in menuButtonTargets){
  let button= document.getElementById(buttonId);
  let targetId= menuButtonTargets[buttonId];
  if(button) button.addEventListener('click', ()=> showScreen(targetId));
}

document.querySelectorAll('.backButton').forEach(button=>{
  let targetId= (button as HTMLElement).dataset.backTo|| 'mainMenuScreen';
  button.addEventListener('click', ()=> showScreen(targetId));
});

// Arrow-key navigation between menu buttons -- Tab/Enter/Space already
// work via native <button> focus semantics, this just adds the arcade-y
// up/down cycling on top of that (mouse/touch works regardless).
const menuNav= document.getElementById('menuNav');
if(menuNav){
  let menuButtons= Array.from(menuNav.querySelectorAll('button')) as HTMLButtonElement[];
  menuNav.addEventListener('keydown', (e:KeyboardEvent)=>{
    let idx= menuButtons.indexOf(document.activeElement as HTMLButtonElement);
    if(e.key==='ArrowDown'){
      e.preventDefault();
      menuButtons[(idx+1+menuButtons.length)% menuButtons.length]?.focus();
    } else if(e.key==='ArrowUp'){
      e.preventDefault();
      menuButtons[(idx-1+menuButtons.length)% menuButtons.length]?.focus();
    }
  });
}

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
  let setupScreen= document.getElementById('setupScreen');
  let gameScreen= document.getElementById('gameScreen');
  let endScreen= document.getElementById('endScreen');
  if(setupScreen) setupScreen.classList.add('active');
  if(gameScreen) gameScreen.classList.remove('active');
  if(endScreen) endScreen.classList.remove('active');
});

if(navigator.requestMIDIAccess){
  navigator.requestMIDIAccess()
    .then((access: MIDIAccess)=>{
      midiAccess= access;
      populateMIDIInputs();
    })
    .catch((err:any)=>{
      console.error("Failed to access MIDI devices:", err);
      alert("MIDI access was denied. Please allow MIDI access to use Chord Nebula.");
    });
}
