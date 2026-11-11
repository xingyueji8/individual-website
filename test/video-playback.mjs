import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const script = await readFile("public/video-playback.js", "utf8");
const flush = async () => { for (let i=0;i<8;i++) await Promise.resolve(); };
function fixture() {
  let now=1000,id=0;const timers=new Map(),classes=new Set();
  const context=vm.createContext({navigator:{userAgent:"Android",deviceMemory:4},document:{hidden:false,body:{classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name)}}}},
    Date:{now:()=>now},setInterval(callback){timers.set(++id,callback);return id},clearInterval(id){timers.delete(id)},matchMedia:()=>({matches:false})});
  vm.runInContext(script,context);
  return { policy:context.XYJVideo,timers,classes,async tick(ms=1500){now+=ms;for(const callback of [...timers.values()])callback();await flush()} };
}
class Video extends EventTarget {
  constructor(){super();Object.assign(this,{paused:true,seeking:false,ended:false,readyState:4,currentTime:0,duration:120,playbackRate:1,frames:0,dropped:0,loads:0,src:""})}
  load(){this.loads++;this.currentTime=0;this.frames=this.dropped=0;this.readyState=0;this.paused=true;this.dispatchEvent(new Event("pause"))}
  metadata(){this.readyState=4;this.dispatchEvent(new Event("loadedmetadata"))}
  play(){this.paused=false;this.dispatchEvent(new Event("play"));this.dispatchEvent(new Event("playing"));return Promise.resolve()}
  pause(){this.paused=true;this.dispatchEvent(new Event("pause"))}
  getVideoPlaybackQuality(){return {totalVideoFrames:this.frames,droppedVideoFrames:this.dropped}}
  removeAttribute(name){if(name==="src")this.src=""}
  querySelectorAll(){return []}
}
const variants=[360,480,720,1080].map(height=>({label:`${height}p`,url:`/${height}.mp4`,status:"ready"}));
const f=fixture(),video=new Video(),statuses=[];
const controller=f.policy.attachPlayer(video,{originalUrl:"/original.mp4",variants,onStatus:message=>statuses.push(message)});
await controller.ready;assert.equal(video.src,"/720.mp4");assert.equal(video.preload,"none");
video.metadata();video.currentTime=37;await video.play();
video.frames=100;await f.tick();video.frames=200;video.dropped=40;await f.tick();
assert.equal(video.src,"/480.mp4");video.metadata();await flush();assert.equal(video.currentTime,37);assert.equal(video.paused,false);
video.frames=100;await f.tick();video.frames=200;video.dropped=40;await f.tick();
assert.equal(video.src,"/360.mp4","monitoring continues after an automatic source switch");video.metadata();await flush();
video.currentTime=51;await controller.select("/1080.mp4");video.metadata();await flush();
assert.equal(video.currentTime,51);assert.equal(video.paused,false);assert.ok(f.timers.size>0,"manual switching keeps health monitoring");
const sameLoads=video.loads;await controller.select("/1080.mp4");assert.equal(video.loads,sameLoads,"selecting the current quality never reloads it");
video.readyState=2;video.dispatchEvent(new Event("waiting"));await f.tick(9000);
assert.equal(video.src,"/720.mp4","sustained buffering selects a smaller ready rendition");video.metadata();await flush();
const beforeSeek=video.src;video.seeking=true;video.readyState=2;await f.tick(10000);assert.equal(video.src,beforeSeek);
video.seeking=false;video.readyState=4;video.dispatchEvent(new Event("seeked"));
assert.ok(statuses.some(message=>message.includes("持续缓冲")));

// Only one decoder plays at a time; disposal releases monitors and effect state.
const second=new Video(),secondController=f.policy.attachPlayer(second,{originalUrl:"/second.mp4"});await secondController.ready;second.metadata();await second.play();
assert.equal(video.paused,true);assert.equal(video.preload,"metadata");assert.ok(f.classes.has("video-preview-active"));
f.policy.disposeMedia(second);assert.ok(!f.classes.has("video-preview-active"));
f.policy.disposeMedia(video);assert.equal(f.timers.size,0);
const disposedLoads=video.loads;video.dispatchEvent(new Event("error"));await flush();assert.equal(video.loads,disposedLoads);

// HLS level changes need no new playing event and no video reload.
const h=fixture(),stream=new Video();let hlsLoads=0,lowerLevels=0;
stream.paused=false;stream.readyState=4;stream.currentTime=20;
const streaming=h.policy.attachPlayer(stream,{originalUrl:"/original.mp4",variants,streamUrl:"/stream.m3u8",setSource:()=>{hlsLoads++},lowerStream:()=>{lowerLevels++;return true}});
await streaming.ready;
stream.frames=100;await h.tick();stream.frames=200;stream.dropped=40;await h.tick();
stream.frames=300;await h.tick();stream.frames=400;stream.dropped=80;await h.tick();
assert.equal(lowerLevels,2);assert.equal(hlsLoads,1);assert.equal(stream.currentTime,20);h.policy.disposeMedia(stream);
const cap={levels:[{height:1080},{height:360},{height:720},{height:480}]};h.policy.capHlsLevels(cap);assert.equal(cap.autoLevelCapping,2);

// Unsupported sources are tried once and never create a source-reload loop.
const e=fixture(),unsupported=new Video(),errors=[];
const failed=e.policy.attachPlayer(unsupported,{originalUrl:"/original.mp4",variants,onStatus:message=>errors.push(message)});await failed.ready;
for(let i=0;i<8;i++){unsupported.dispatchEvent(new Event("error"));await flush()}
assert.equal(unsupported.loads,5);assert.match(errors.at(-1),/无法播放/);e.policy.disposeMedia(unsupported);

// Late metadata for an older video cannot steal playback from the next video.
const n=fixture(),older=new Video(),newer=new Video();
const olderPlayer=n.policy.attachPlayer(older,{originalUrl:"/original.mp4",variants});await olderPlayer.ready;older.metadata();await older.play();
await olderPlayer.select("/480.mp4");
const newerPlayer=n.policy.attachPlayer(newer,{originalUrl:"/next.mp4"});await newerPlayer.ready;newer.metadata();await newer.play();
older.metadata();await flush();assert.equal(older.paused,true);assert.equal(newer.paused,false);n.policy.disposeMedia(older);n.policy.disposeMedia(newer);

// A slow old source's completion must not re-arm or restore the newer source.
const r=fixture(),racing=new Video();let finishOldSource;
const race=r.policy.attachPlayer(racing,{originalUrl:"/original.mp4",variants,setSource(url){racing.src=url;racing.load();if(url==="/720.mp4")return new Promise(resolve=>{finishOldSource=resolve})}});
await race.select("/480.mp4");racing.metadata();finishOldSource();await race.ready;
assert.equal(racing.src,"/480.mp4");r.policy.disposeMedia(racing);assert.equal(r.timers.size,0);

// A single original file is not misrepresented as an automatically transcoded preview.
const o=fixture(),original=new Video(),messages=[];
const one=o.policy.attachPlayer(original,{originalUrl:"/only-original.mp4",onStatus:message=>messages.push(message)});await one.ready;original.metadata();await original.play();
original.frames=100;await o.tick();original.frames=200;original.dropped=50;await o.tick();
assert.equal(original.loads,1);assert.match(messages.at(-1),/没有更低清晰度/);o.policy.disposeMedia(original);
// Even browsers without quality counters can detect a fully buffered freeze.
const b=fixture(),buffered=new Video();buffered.getVideoPlaybackQuality=undefined;
const frozen=b.policy.attachPlayer(buffered,{originalUrl:"/original.mp4",variants});await frozen.ready;buffered.metadata();await buffered.play();
await b.tick(11000);assert.equal(buffered.src,"/480.mp4");b.policy.disposeMedia(buffered);
console.log("adaptive video: buffering, repeated drops, manual quality, progress, HLS re-arming, decoder exclusivity and teardown passed");
