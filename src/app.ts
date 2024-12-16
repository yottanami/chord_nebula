let audioContext: AudioContext | null = null;
let midiAccess: MIDIAccess | null = null;
let midiInput: MIDIInput | undefined;
let gameRunning: boolean = false;
let score: number = 0;
let lives: number = 3;
interface Circle {
  element: HTMLElement;
  chordName: string;
  chordNotes: string[];
  y: number;
  speed: number;
  destroyed: boolean;
}
let circles: Circle[] = [];
let noteOnStack: string[] = [];
let chosenKey: string = "C";
let chosenMode: "major" | "minor" = "major";
let progressionIndex: number = 0;
let chordIndex: number = 0;
let showNotes: boolean = true;
let showFunctions: boolean = false;
let lastSpawn: number = 0;
let activeOscillators: { [key: number]: { osc: OscillatorNode; gain: GainNode } } = {};
const noteNames: string[] = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const enhMapToSharp: { [key:string]:string } = {
  "Bb":"A#","Eb":"D#","Ab":"G#","Db":"C#","Gb":"F#","Cb":"B","Fb":"E"
};
const majorScales:{[key:string]:string[]}={
  "C":["C","D","E","F","G","A","B"],
  "G":["G","A","B","C","D","E","F#"],
  "D":["D","E","F#","G","A","B","C#"],
  "A":["A","B","C#","D","E","F#","G#"],
  "E":["E","F#","G#","A","B","C#","D#"],
  "B":["B","C#","D#","E","F#","G#","A#"],
  "F#":["F#","G#","A#","B","C#","D#","E#"],
  "C#":["C#","D#","E#","F#","G#","A#","B#"],
  "F":["F","G","A","Bb","C","D","E"],
  "Bb":["Bb","C","D","Eb","F","G","A"],
  "Eb":["Eb","F","G","Ab","Bb","C","D"],
  "Ab":["Ab","Bb","C","Db","Eb","F","G"],
  "Db":["Db","Eb","F","Gb","Ab","Bb","C"],
  "Gb":["Gb","Ab","Bb","Cb","Db","Eb","F"]
};
const minorScales:{[key:string]:string[]}={
  "A":["A","B","C","D","E","F","G"],
  "E":["E","F#","G","A","B","C","D"],
  "B":["B","C#","D","E","F#","G","A"],
  "F#":["F#","G#","A","B","C#","D","E"],
  "C#":["C#","D#","E","F#","G#","A","B"],
  "G#":["G#","A#","B","C#","D#","E","F#"],
  "D#":["D#","E#","F#","G#","A#","B","C#"],
  "A#":["A#","B#","C#","D#","E#","F#","G#"],
  "D":["D","E","F","G","A","Bb","C"],
  "G":["G","A","Bb","C","D","Eb","F"],
  "C":["C","D","Eb","F","G","Ab","Bb"],
  "F":["F","G","Ab","Bb","C","Db","Eb"],
  "Bb":["Bb","C","Db","Eb","F","Gb","Ab"],
  "Eb":["Eb","F","Gb","Ab","Bb","Cb","Db"]
};
const degreeMapMajor:any={"I":0,"ii":1,"iii":2,"IV":3,"V":4,"vi":5,"vii":6};
const degreeMapMinor:any={"i":0,"ii°":1,"III":2,"iv":3,"v":4,"VI":5,"VII":6};
const degreeQualityMapMajor:any={
"I":"maj","ii":"min","iii":"min","IV":"maj","V":"maj","vi":"min","vii":"dim"
};
const degreeQualityMapMinor:any={
"i":"min","ii°":"dim","III":"maj","iv":"min","v":"min","VI":"maj","VII":"maj"
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
  if(!audioContext) {
    audioContext=new AudioContext();
  }
}
function midiNoteToName(noteNumber:number): string {
  return noteNames[noteNumber % 12];
}
function freqFromMidiNote(m:number):number {
  return 440*Math.pow(2,(m-69)/12);
}
function toSharpName(n:string):string {
  if(enhMapToSharp[n])return enhMapToSharp[n];
  return n;
}
function normalizePlayedNote(n:string):string {
  // played notes come in sharps mostly from midiNoteToName, but if needed we can ensure they are in sharp form
  // midiNoteToName never returns flats, so this is fine
  return n;
}
function normalizeChordNote(n:string):string {
  n=toSharpName(n);
  return n;
}
function playNoteSound(noteNumber:number,velocity:number):void {
  ensureAudioContext();
  let ctx=audioContext!;
  let freq=freqFromMidiNote(noteNumber);
  let osc=ctx.createOscillator();
  osc.type='sine';
  osc.frequency.setValueAtTime(freq,ctx.currentTime);
  let gainNode=ctx.createGain();
  gainNode.gain.setValueAtTime(velocity/127*0.3,ctx.currentTime);
  osc.connect(gainNode).connect(ctx.destination);
  osc.start();
  activeOscillators[noteNumber]={osc:osc,gain:gainNode};
}
function stopNoteSound(noteNumber:number):void {
  let oscData=activeOscillators[noteNumber];
  if(oscData){
    oscData.osc.stop();
    delete activeOscillators[noteNumber];
  }
}
function checkChords(): void {
  for(let i=circles.length-1;i>=0;i--){
    let c=circles[i];
    if(!c.destroyed){
      if(chordMatchesPlayedNotes(c.chordNotes,noteOnStack)){
        playChordSound(c.chordNotes);
        c.destroyed=true;
        score++;
        updateScore();
      }
    }
  }
}
function updateScore(): void {
  const s=document.getElementById('scoreDisplay');
  if(s)s.innerText="Score: "+score;
}
function updateLives(): void {
  const l=document.getElementById('livesDisplay');
  if(l)l.innerText="Lives: "+lives;
}
function gameLoop(timestamp:number): void {
  if(!gameRunning)return;
  updateCirclesAndSpawn(timestamp);
  requestAnimationFrame(gameLoop);
}
function playChordSound(chord:string[]):void {
  ensureAudioContext();
  let ctx=audioContext!;
  let startTime=ctx.currentTime;
  for(const noteNameStr of chord){
    let freq=noteNameToFreq(noteNameStr);
    let osc=ctx.createOscillator();
    osc.type='triangle';
    osc.frequency.setValueAtTime(freq,startTime);
    let gainNode=ctx.createGain();
    gainNode.gain.setValueAtTime(0.3,startTime);
    osc.connect(gainNode).connect(ctx.destination);
    osc.start();
    setTimeout(()=>{osc.stop();},300);
  }
}
function noteNameToFreq(name:string):number {
  ensureAudioContext();
  name=toSharpName(name);
  let baseFreq=440;
  let baseIndex=noteNames.indexOf("A");
  let noteIndex=noteNames.indexOf(name);
  if(noteIndex<0)noteIndex=noteNames.indexOf(name.replace('b','#'));
  if(noteIndex<0)noteIndex=0;
  let semitoneDiff=noteIndex-baseIndex;
  return baseFreq*Math.pow(2,semitoneDiff/12);
}
function onMIDIMessage(event:MIDIMessageEvent):void {
  const data=event.data;
  if(!data||data.length<3)return;
  const arr=data as Uint8Array;
  const [status,note,velocity]=arr;
  if(status>=0x90&&status<=0x9f&&velocity>0){
    let noteNameStr=midiNoteToName(note);
    noteNameStr=normalizePlayedNote(noteNameStr);
    noteOnStack.push(noteNameStr);
    playNoteSound(note,velocity);
    checkChords();
  }
  if((status>=0x80&&status<=0x8f)||(status>=0x90&&status<=0x9f&&velocity===0)){
    let noteNameStr=midiNoteToName(note);
    noteNameStr=normalizePlayedNote(noteNameStr);
    let idx=noteOnStack.indexOf(noteNameStr);
    if(idx>-1)noteOnStack.splice(idx,1);
    stopNoteSound(note);
  }
}
function chordMatchesPlayedNotes(chord:string[],played:string[]):boolean {
  if(chord.length!==played.length)return false;
  // normalize chord and played notes to sharps so they match
  let normalizedChord=chord.map(n=>normalizeChordNote(n));
  let normalizedPlayed=played.map(n=>toSharpName(n));
  let chordSet=new Set(normalizedChord);
  let playedSet=new Set(normalizedPlayed);
  if(chordSet.size!==playedSet.size)return false;
  for(let note of chordSet){
    if(!playedSet.has(note))return false;
  }
  return true;
}
function chordDegreesToChordNotes(key:string,degree:string,mode:"major"|"minor"):string[] {
  const scale=mode==="major"?majorScales[key]:minorScales[key];
  const degMap=mode==="major"?degreeMapMajor:degreeMapMinor;
  const root=scale[degMap[degree]];
  const third=scale[(degMap[degree]+2)%7];
  const fifth=scale[(degMap[degree]+4)%7];
  return [root,third,fifth];
}
function getNextChordName():string {
  const progressions=chosenMode==="major"?majorProgressions:minorProgressions;
  let progression=progressions[progressionIndex];
  let chordName=progression[chordIndex];
  chordIndex++;
  if(chordIndex>=progression.length){chordIndex=0;progressionIndex=(progressionIndex+1)%progressions.length;}
  return chordName;
}
function getChordFullName(key:string,degree:string,originalChord:string[],finalChord:string[],inversion:number,mode:"major"|"minor"):string {
  const qmap=mode==="major"?degreeQualityMapMajor:degreeQualityMapMinor;
  const quality=qmap[degree];
  const root=originalChord[0];

  let chordName = quality=="maj" ? root : `${root} ${quality}`;
  if(inversion>0){
    chordName=chordName.split(' ')[0];
    chordName+=`/${finalChord[0]}`;
  }
  return chordName;
}
function invertChord(notes:string[],inversion:number):string[] {
  let arr=notes.slice();
  for(let i=0;i<inversion;i++){
    let x=arr.shift();
    if(x)arr.push(x);
  }
  return arr;
}
function voiceLeadingDistance(ch1:string[],ch2:string[]):number {
  let dist=0;
  for(let i=0;i<ch1.length;i++){
    dist+=noteDistance(ch1[i],ch2[i]);
  }
  return dist;
}
function noteDistance(a:string,b:string):number {
  const enhToSharp=(n:string):string=>{
    const map:any={"Bb":"A#","Eb":"D#","Ab":"G#","Db":"C#","Gb":"F#","Cb":"B","Fb":"E"};
    return map[n]||n;
  };
  let A=enhToSharp(a);
  let B=enhToSharp(b);
  let iA=noteNames.indexOf(A);
  let iB=noteNames.indexOf(B);
  if(iA<0||iB<0)return 12;
  let d=Math.abs(iA-iB);
  if(d>6)d=12-d;
  return d;
}
function closestInversion(prevChord:string[]|null,chord:string[]):{inv:string[],inversion:number}{
  if(!prevChord)return {inv:chord,inversion:0};
  let candidates:{inv:string[],dist:number,inversion:number}[]=[];
  for(let i=0;i<chord.length;i++){
    let inv=invertChord(chord,i);
    let dist=voiceLeadingDistance(prevChord,inv);
    candidates.push({inv:inv,dist:dist,inversion:i});
  }
  candidates.sort((a,b)=>a.dist-b.dist);
  return {inv:candidates[0].inv,inversion:candidates[0].inversion};
}
function generateChordCircle():void {
  let chordDegree=getNextChordName();
  let originalChord=chordDegreesToChordNotes(chosenKey,chordDegree,chosenMode);
  originalChord=originalChord.map(n=>normalizeChordNote(n));
  let lastChord=circles.length>0?circles[circles.length-1].chordNotes:null;
  let ci=closestInversion(lastChord,originalChord);
  let invertedChord=ci.inv.map(n=>normalizeChordNote(n));
  let chordFullName=getChordFullName(chosenKey,chordDegree,originalChord,invertedChord,ci.inversion,chosenMode);
  let element=document.createElement('div');
  element.className='chordCircle';
  let htmlContent = "";
  if(showFunctions){
      htmlContent+=`<div>${chordDegree}</div>`;
  }
  htmlContent+=`<div>${chordFullName}</div>`;
  if(showNotes){
    htmlContent+=`<div>${invertedChord.join("-")}</div>`;
  }
  element.innerHTML=htmlContent;
  const gameArea=document.getElementById('gameArea')!;
  element.style.left=(Math.random()*(window.innerWidth-100))+"px";
  element.style.top="-100px";
  gameArea.appendChild(element);
  circles.push({element:element,chordName:chordDegree,chordNotes:invertedChord,y:-100,speed:1+Math.random(),destroyed:false});
}
function updateCircles():void {
  for(let i=circles.length-1;i>=0;i--){
    let c=circles[i];
    if(!c.destroyed){
      c.y+=c.speed;
      c.element.style.top=c.y+"px";
      if(c.y>(window.innerHeight-50)){
        if(c.element.parentNode)c.element.parentNode.removeChild(c.element);
        circles.splice(i,1);
        lives--;
        updateLives();
        if(lives<=0)endGame();
      }
    } else {
      if(c.element.parentNode)c.element.parentNode.removeChild(c.element);
      circles.splice(i,1);
    }
  }
}
function updateCirclesAndSpawn(timestamp:number):void {
  updateCircles();
  if(timestamp-lastSpawn>3000){
    generateChordCircle();
    lastSpawn=timestamp;
  }
}
function endGame():void {
  gameRunning=false;
  const finalScore=document.getElementById('finalScore');
  if(finalScore)finalScore.innerText="Your score: "+score;
  const gameScreen=document.getElementById('gameScreen');
  const endScreen=document.getElementById('endScreen');
  if(gameScreen)gameScreen.classList.remove('active');
  if(endScreen)endScreen.classList.add('active');
  stopAllSounds();
}

function stopAllSounds():void {
  for(let note in activeOscillators){
    let oscData=activeOscillators[note];
    oscData.osc.stop();
  }
  activeOscillators={};
}

function startGame():void {
  const midi=document.getElementById('midiSelect')as HTMLSelectElement|null;
  const keySel=document.getElementById('keySelect')as HTMLSelectElement|null;
  const notesCheck=document.getElementById('showNotesCheckbox')as HTMLInputElement|null;
  const functionsCheck=document.getElementById('showFunctionsCheckbox')as HTMLInputElement|null;
  const modeInputs=document.querySelectorAll('input[name="mode"]')as NodeListOf<HTMLInputElement>;
  const setupScreen=document.getElementById('setupScreen');
  const gameScreen=document.getElementById('gameScreen');
  const endScreen=document.getElementById('endScreen');
    
  if(notesCheck)showNotes=notesCheck.checked;
  if(functionsCheck)showFunctions=functionsCheck.checked;
  if(keySel)chosenKey=keySel.value;

  if(!isValidMidiInput(midi?.options)){
    alert("Please select a valid MIDI input device");
    return;
  }

  modeInputs.forEach(m=>{if(m.checked) chosenMode=m.value as "major"|"minor";});
  const selectedId=midi?midi.value:"";
  let inputs:MIDIInput[]=[];
  midiAccess!.inputs.forEach((input:MIDIInput)=>{inputs.push(input);});
  midiInput=inputs.find((i:MIDIInput)=>i.id===selectedId);
  if(midiInput)midiInput.onmidimessage=onMIDIMessage;
  score=0;
  lives=3;

  updateScore();
  updateLives();

  if(setupScreen)setupScreen.classList.remove('active');
  if(gameScreen)gameScreen.classList.add('active');
  if(endScreen)endScreen.classList.remove('active');
  circles=[];
  gameRunning=true;
  progressionIndex=0;
  chordIndex=0;
  lastSpawn=0;
  requestAnimationFrame(gameLoop);
}

function populateMIDIInputs():void {
  const select=document.getElementById('midiSelect')as HTMLSelectElement|null;
  if(!select)return;
  select.innerHTML="";
  let inputs:MIDIInput[]=[];
  midiAccess!.inputs.forEach((input:MIDIInput)=>{inputs.push(input);});
  if(inputs.length===0){
    let option=document.createElement('option');
    option.innerText="No MIDI devices found";
    select.appendChild(option);
  }else{
    inputs.forEach((input:MIDIInput)=>{
      let option=document.createElement('option');
      option.value=input.id;
      option.innerText=input.name||"";
      select.appendChild(option);
    });
  }
}
const startButton=document.getElementById('startButton');
if(startButton)startButton.addEventListener('click',startGame);
const restartButton=document.getElementById('restartButton');
if(restartButton)restartButton.addEventListener('click',()=>{
  const setupScreen=document.getElementById('setupScreen');
  const gameScreen=document.getElementById('gameScreen');
  const endScreen=document.getElementById('endScreen');
  if(setupScreen)setupScreen.classList.add('active');
  if(gameScreen)gameScreen.classList.remove('active');
  if(endScreen)endScreen.classList.remove('active');
});

if (navigator.requestMIDIAccess) {
  navigator.requestMIDIAccess()
    .then((access: MIDIAccess) => {
      midiAccess = access;
      populateMIDIInputs();
    })
    .catch((err: any) => {
      console.error("Failed to access MIDI devices:", err);
      alert("MIDI access was denied. Please allow MIDI access to use Chord Nebula.");
    });
}


function isValidMidiInput(midiInputs) {
    if (!midiInputs || midiInputs.length === 0) {
        return false;
    }

    if (midiInputs.length === 1 && midiInputs[0].innerText === "Midi Through Port-0") {
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
