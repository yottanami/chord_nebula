let audioContext: AudioContext | null = null;
let activeOscillators: { [key: number]: { osc: OscillatorNode; gain: GainNode } } = {};
let midiAccess: MIDIAccess | null = null;
let midiInput: MIDIInput | undefined;
let gameRunning: boolean = false;
let score: number = 0;
let lives: number = 3;
let circles: { element: HTMLElement; chordName: string; chordNotes: string[]; y: number; speed: number }[] = [];
let noteOnStack: string[] = [];
let lastSpawn: number = 0;
let chosenKey: string = "C";
let chosenMode: "major" | "minor" = "major";
let progressionIndex: number = 0;
let chordIndex: number = 0;
let showNotes: boolean = true;

const noteNames: string[] = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

const majorScales: { [key: string]: string[] } = {
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

const minorScales: { [key: string]: string[] } = {
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

const degreeMapMajor: { [key: string]: number } = {"I":0,"ii":1,"iii":2,"IV":3,"V":4,"vi":5,"vii":6};
const degreeMapMinor: { [key: string]: number } = {"i":0,"ii°":1,"III":2,"iv":3,"v":4,"VI":5,"VII":6};

const degreeQualityMapMajor: { [key: string]: string } = {
  "I":"maj","ii":"min","iii":"min","IV":"maj","V":"maj","vi":"min","vii":"dim"
};
const degreeQualityMapMinor: { [key: string]: string } = {
  "i":"min","ii°":"dim","III":"maj","iv":"min","v":"min","VI":"maj","VII":"maj"
};

const majorProgressions: string[][] = [
  ["I","IV","V","I"],
  ["I","vi","IV","V"],
  ["ii","V","I","I"]
];
const minorProgressions: string[][] = [
  ["i","iv","v","i"],
  ["i","VI","III","VII"],
  ["ii°","v","i","i"]
];

const chordDegreesToChordNotes = (key: string, degree: string, mode: "major"|"minor"): string[] => {
  const scale = mode==="major"? majorScales[key]: minorScales[key];
  const degMap = mode==="major"? degreeMapMajor: degreeMapMinor;
  const rootNote = scale[degMap[degree]];
  const third = scale[(degMap[degree]+2)%7];
  const fifth = scale[(degMap[degree]+4)%7];
  return [rootNote,third,fifth];
};

const normalizeNoteName = (n: string): string => {
  const map: { [key:string]:string } = {"Cb":"B","B#":"C","E#":"F","Fb":"E"};
  return map[n]||n;
};

const midiNoteToName = (noteNumber:number):string => {
  return noteNames[noteNumber%12];
};

const freqFromMidiNote=(m:number):number=>{
  return 440*Math.pow(2,(m-69)/12);
};

const chordMatchesPlayedNotes=(chord:string[], played:string[]):boolean=>{
  if(played.length!==chord.length)return false;
  let chordSet=new Set(chord);
  let playedSet=new Set(played);
  if(chordSet.size!==playedSet.size)return false;
  for(let note of chordSet){
    if(!playedSet.has(note))return false;
  }
  return true;
};

const invertChord=(notes:string[],inversion:number):string[]=>{
  let arr=notes.slice();
  for(let i=0;i<inversion;i++){
    let x=arr.shift();
    if(x)arr.push(x);
  }
  return arr;
};

const voiceLeadingDistance=(ch1:string[],ch2:string[]):number=>{
  let dist=0;
  for(let i=0;i<ch1.length;i++){
    dist+=noteDistance(ch1[i],ch2[i]);
  }
  return dist;
};

const noteDistance=(a:string,b:string):number=>{
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
};

const closestInversion=(prevChord:string[]|null,chord:string[]):{inv:string[],inversion:number}=>{
  if(!prevChord){
    return {inv:chord,inversion:0};
  }
  let candidates:{inv:string[],dist:number,inversion:number}[]=[];
  for(let i=0;i<chord.length;i++){
    let inv=invertChord(chord,i);
    let dist=voiceLeadingDistance(prevChord,inv);
    candidates.push({inv:inv,dist:dist,inversion:i});
  }
  candidates.sort((a,b)=>a.dist-b.dist);
  return {inv:candidates[0].inv,inversion:candidates[0].inversion};
};

const getChordFullName=(key:string,degree:string,originalChord:string[],finalChord:string[],inversion:number,mode:"major"|"minor"):string=>{
  const qmap = mode==="major"?degreeQualityMapMajor:degreeQualityMapMinor;
  const quality=qmap[degree];
  const root=originalChord[0];
  let chordName=`${root} ${quality}`;
  if(inversion>0) {
    chordName=chordName.split(' ')[0];
    chordName+=`/${finalChord[0]}`;
  }
  return chordName;
};

const getNextChordName=():string=>{
  let progression = chosenMode==="major"?majorProgressions[progressionIndex]:minorProgressions[progressionIndex];
  let chordName=progression[chordIndex];
  chordIndex++;
  if(chordIndex>=progression.length){
    chordIndex=0;
    progressionIndex=(progressionIndex+1)%progression.length;
  }
  return chordName;
};

const generateChordCircle=():void=>{
  let chordDegree=getNextChordName();
  let originalChord=chordDegreesToChordNotes(chosenKey,chordDegree,chosenMode).map(normalizeNoteName);
  let lastChord=null;
  if(circles.length>0){
    lastChord=circles[circles.length-1].chordNotes;
  }
  let ci=closestInversion(lastChord,originalChord);
  let invertedChord=ci.inv;
  let chordFullName=getChordFullName(chosenKey,chordDegree,originalChord,invertedChord,ci.inversion,chosenMode);

  let element=document.createElement('div');
  element.className='chordCircle';
  let htmlContent=`<div>${chordDegree}</div><div>${chordFullName}</div>`;
  if(showNotes){
    htmlContent+=`<div>${invertedChord.join("-")}</div>`;
  }
  element.innerHTML=htmlContent;

  let gameArea=document.getElementById('gameArea')!;
  element.style.left=(Math.random()*(window.innerWidth-100))+"px";
  element.style.top="-100px";
  gameArea.appendChild(element);
  circles.push({element:element,chordName:chordDegree,chordNotes:invertedChord,y:-100,speed:1+Math.random()*1});
};

const updateCircles=():void=>{
  for(let i=circles.length-1;i>=0;i--){
    let c=circles[i];
    c.y+=c.speed;
    c.element.style.top=c.y+"px";
    if(c.y>(window.innerHeight-50)){
      if(c.element.parentNode)c.element.parentNode.removeChild(c.element);
      circles.splice(i,1);
      lives--;
      updateLives();
      if(lives<=0)endGame();
    }
  }
};

const gameLoop=(timestamp:number):void=>{
  if(!gameRunning)return;
  updateCircles();
  if(timestamp-lastSpawn>3000){generateChordCircle();lastSpawn=timestamp;}
  requestAnimationFrame(gameLoop);
};

const updateScore=():void=>{
  (document.getElementById('scoreDisplay') as HTMLElement).innerText="Score: "+score;
};
const updateLives=():void=>{
  (document.getElementById('livesDisplay') as HTMLElement).innerText="Lives: "+lives;
};

const endGame=():void=>{
  gameRunning=false;
  (document.getElementById('finalScore') as HTMLElement).innerText="Your score: "+score;
  (document.getElementById('gameScreen') as HTMLElement).classList.remove('active');
  (document.getElementById('endScreen') as HTMLElement).classList.add('active');
  stopAllSounds();
};

const stopAllSounds=():void=>{
  for (let note in activeOscillators) {
    let oscData=activeOscillators[note];
    if(oscData.osc) oscData.osc.stop();
  }
  activeOscillators={};
};

const onMIDIMessage=(event: WebMidi.MIDIMessageEvent):void=>{
  const [status,note,velocity]=event.data;
  if(status>=0x90&&status<=0x9f&&velocity>0){
    let noteNameStr=midiNoteToName(note);
    noteOnStack.push(noteNameStr);
    playNoteSound(note,velocity);
    checkChords();
  }
  if((status>=0x80&&status<=0x8f)||(status>=0x90&&status<=0x9f&&velocity===0)){
    let noteNameStr=midiNoteToName(note);
    let idx=noteOnStack.indexOf(noteNameStr);
    if(idx>-1)noteOnStack.splice(idx,1);
    stopNoteSound(note);
  }
};

const ensureAudioContext=():AudioContext=>{
  if(!audioContext) {
    audioContext=new AudioContext();
  }
  return audioContext;
};

const playNoteSound=(noteNumber:number,velocity:number):void=>{
  let ctx=ensureAudioContext();
  let freq=freqFromMidiNote(noteNumber);
  let osc=ctx.createOscillator();
  osc.type='sine';
  osc.frequency.setValueAtTime(freq,ctx.currentTime);
  let gainNode=ctx.createGain();
  gainNode.gain.setValueAtTime(velocity/127*0.3,ctx.currentTime);
  osc.connect(gainNode).connect(ctx.destination);
  osc.start();
  activeOscillators[noteNumber]={osc:osc,gain:gainNode};
};

const stopNoteSound=(noteNumber:number):void=>{
  let oscData=activeOscillators[noteNumber];
  if(oscData){
    oscData.osc.stop();
    delete activeOscillators[noteNumber];
  }
};

const noteNameToFreq=(name:string):number=>{
  let ctx=ensureAudioContext();
  let baseFreq=440;
  let baseIndex=noteNames.indexOf("A");
  let noteIndex=noteNames.indexOf(name);
  if(noteIndex<0)noteIndex=noteNames.indexOf(name.replace('b','#'));
  if(noteIndex<0)noteIndex=0;
  let semitoneDiff=noteIndex-baseIndex;
  return baseFreq*Math.pow(2,semitoneDiff/12);
};

const playChordSound=(chord:string[]):void=>{
  let ctx=ensureAudioContext();
  let startTime=ctx.currentTime;
  chord.forEach((noteNameStr)=>{
    let freq=noteNameToFreq(noteNameStr);
    let osc=ctx.createOscillator();
    osc.type='triangle';
    osc.frequency.setValueAtTime(freq,startTime);
    let gainNode=ctx.createGain();
    gainNode.gain.setValueAtTime(0.3,startTime);
    osc.connect(gainNode).connect(ctx.destination);
    osc.start();
    setTimeout(()=>{
      osc.stop();
    },300);
  });
};

const checkChords=():void=>{
  for(let i=circles.length-1;i>=0;i--){
    let c=circles[i];
    if(chordMatchesPlayedNotes(c.chordNotes,noteOnStack)){
      playChordSound(c.chordNotes);
      if(c.element.parentNode)c.element.parentNode.removeChild(c.element);
      circles.splice(i,1);
      score++;
      updateScore();
    }
  }
};

const populateMIDIInputs=():void=>{
  const select=document.getElementById('midiSelect') as HTMLSelectElement;
  select.innerHTML="";
  let inputs=Array.from(midiAccess!.inputs.values());
  if(inputs.length===0){
    let option=document.createElement('option');
    option.innerText="No MIDI devices found";
    select.appendChild(option);
  } else {
    inputs.forEach((input:MIDIInput)=>{
      let option=document.createElement('option');
      option.value=input.id;
      option.innerText=input.name;
      select.appendChild(option);
    });
  }
};

if (navigator.requestMIDIAccess) {
  navigator.requestMIDIAccess().then((access: MIDIAccess)=>{
    midiAccess=access;
    populateMIDIInputs();
  });
}

const startGame=():void=>{
  let select=document.getElementById('midiSelect') as HTMLSelectElement;
  let keySel=document.getElementById('keySelect') as HTMLSelectElement;
  let notesCheck=document.getElementById('showNotesCheckbox') as HTMLInputElement;
  showNotes=notesCheck.checked;
  chosenKey=keySel.value;
  let modeInputs=document.querySelectorAll('input[name="mode"]') as NodeListOf<HTMLInputElement>;
  modeInputs.forEach(m=>{
    if(m.checked) chosenMode=m.value as "major"|"minor";
  });
  let selectedId=select.value;
  let inputs=Array.from(midiAccess!.inputs.values());
  midiInput=inputs.find((i:MIDIInput)=>i.id===selectedId);
  if(midiInput)midiInput.onmidimessage=onMIDIMessage;
  score=0;
  lives=3;
  updateScore();
  updateLives();
  document.getElementById('setupScreen')!.classList.remove('active');
  document.getElementById('gameScreen')!.classList.add('active');
  document.getElementById('endScreen')!.classList.remove('active');
  circles.forEach(c=>{if(c.element.parentNode)c.element.parentNode.removeChild(c.element);});
  circles=[];
  gameRunning=true;
  progressionIndex=0;
  chordIndex=0;
  requestAnimationFrame(gameLoop);
};

const startButton=document.getElementById('startButton')!;
startButton.addEventListener('click',startGame);

const restartButton=document.getElementById('restartButton')!;
restartButton.addEventListener('click',()=>{
  document.getElementById('setupScreen')!.classList.add('active');
  document.getElementById('gameScreen')!.classList.remove('active');
  document.getElementById('endScreen')!.classList.remove('active');
});
