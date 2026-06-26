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
  "Bb":"A#","Eb":"D#","Ab":"G#","Db":"C#","Gb":"F#","Cb":"B","Fb":"E"
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
  }
}

function checkChords():void {
  for(let i= circles.length-1; i>=0; i--){
    let c= circles[i];
    if(!c.destroyed){
      if(selectedLevel===4){
        if(matchesLevel4(c.noteOrChordNotes)){
          playChordSound(c.noteOrChordNotes);
          c.destroyed=true;
          score++;
          updateScore();
        }
      } else if(selectedLevel===5){
        if(matchesLevel5(c.noteOrChordNotes)){
          playChordSound(c.noteOrChordNotes);
          c.destroyed=true;
          score++;
          updateScore();
        }
      } else if(selectedLevel>=6){
        if(matchesLevel1to3(c.noteOrChordNotes)){
          playChordSound(c.noteOrChordNotes);
          c.destroyed=true;
          score++;
          updateScore();
        }
      } else {
        if(matchesLevel1to3(c.noteOrChordNotes)){
          playChordSound(c.noteOrChordNotes);
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

function gameLoop(timestamp:number):void {
  if(!gameRunning) return;
  updateCirclesAndSpawn(timestamp);
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

function updateCircles():void {
  for(let i= circles.length-1;i>=0;i--){
    let c= circles[i];
    if(!c.destroyed){
      c.y+= c.speed;
      c.element.style.top= c.y+"px";
      if(c.y> (window.innerHeight-50)){
        if(c.element.parentNode) c.element.parentNode.removeChild(c.element);
        circles.splice(i,1);
        lives--;
        updateLives();
        if(lives<=0) endGame();
      }
    } else {
      if(c.element.parentNode) c.element.parentNode.removeChild(c.element);
      circles.splice(i,1);
    }
  }
}

function updateCirclesAndSpawn(timestamp:number):void {
  updateCircles();
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

function startGame():void {
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

function showPopup(): void {
  if (popupOverlay) {
    popupOverlay.classList.add('active');
  }
}


function hidePopup(): void {
  if (popupOverlay) {
    popupOverlay.classList.remove('active');
  }
}

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

const startButton= document.getElementById('startButton');
if(startButton) startButton.addEventListener('click', startGame);

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
