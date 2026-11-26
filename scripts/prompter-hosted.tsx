import {BrowserVosk} from './recognition/vosk';
import {CommercialSherpa} from './recognition/commercialSherpa';
import {LocalSpeech} from './recognition/localEngine';
import {freeFallback} from './recognition/policy';
import type {SpeechCallbacks, SpeechPhase} from './recognition/browser';
import type {RecognitionTiming} from './recognition/latency';
import type {Segment} from './tracking/matcher';
import {prepareScript, ScriptGuide, type GuideDecision} from './tracking/guide';

export {formattedSegments, spans} from './formatting';
export {ScrollMotion} from './tracking/motion';
export {predictedProgress} from './tracking/progress';
export {openCapture, openMicrophone, switchCaptureCamera, closeCapture, recordingMime} from './recording/capture';
export {VideoSession} from './recording/recorder';
export {DraftStore} from './recording/drafts';
export {downloadVideo, shareVideo} from './recording/export';

type Spoken = {text:string; final:boolean; timing?:RecognitionTiming; sequence:number};
type Request = Spoken & {revision:number; at:number; position:number; rangeKey:string};
type AudioInput = {stream:MediaStream; context:AudioContext};
type VoiceOptions = {
  segments:Segment[];
  active:()=>boolean;
  visibleRange?:()=>{first:number;last:number};
  follow:(decision:GuideDecision, before:number)=>void;
  phase:(phase:SpeechPhase)=>void;
  semantic:(ready:boolean)=>void;
  voiceActivity:(now:number)=>void;
};

export function createVoice(options:VoiceOptions) {
  const index = prepareScript(options.segments);
  const guide = new ScriptGuide();
  let recognizer:LocalSpeech|undefined, worker:Worker|undefined, audio:AudioInput|undefined;
  let sequence = 0, lastStrong = 0, revision = 0, speechSession = 0;
  let semanticReady = false, semanticFailed = false, lastVoice = -Infinity;
  let pending:Request|undefined, waiting:Spoken|undefined;

  function apply(item:Spoken, scores?:Record<number,number>) {
    if (!options.active()) return;
    const before = guide.position;
    const decision = guide.evaluate(item.text, item.final, index, {
      now:performance.now(), utterance:item.timing?.speechAt, semantic:scores, threshold:.72, range:options.visibleRange?.(),
    });
    if (decision.accepted || decision.prefixHint) options.follow(decision, before);
    return decision;
  }

  function queue(item:Spoken) {
    if (semanticFailed) return;
    if (!worker || !semanticReady || pending) {
      waiting = item;
      return;
    }
    const range=options.visibleRange?.();
    pending = {...item, revision, at:performance.now(), position:guide.position, rangeKey:JSON.stringify(range)};
    worker.postMessage({type:'match', id:item.sequence, generation:1, text:item.text, position:guide.position, range});
  }

  function prepareSemantic() {
    if (worker) return;
    semanticFailed = false;
    try {
      worker = new Worker(new URL('./tracking/semantic.worker.ts', import.meta.url), {type:'module'});
      function fail() {
        semanticReady = false;
        semanticFailed = true;
        pending = waiting = undefined;
        options.semantic(false);
      }
      worker.onerror = fail;
      worker.onmessage = ({data}) => {
        if (data.generation !== 1) return;
        if (data.type === 'error') fail();
        if (data.type === 'ready') {
          semanticReady = true;
          options.semantic(true);
        }
        if (data.type === 'match') {
          const item = pending;
          pending = undefined;
          if (item && item.sequence === data.id && item.revision === revision &&
              item.position === guide.position && item.rangeKey === JSON.stringify(options.visibleRange?.()) && item.sequence >= lastStrong &&
              performance.now() - item.at < 1800) apply(item, data.scores);
        }
        if (!pending && waiting && options.active() && semanticReady && performance.now() - lastVoice < 700) {
          const next = waiting;
          waiting = undefined;
          queue(next);
        }
      };
      worker.postMessage({type:'init', generation:1, texts:options.segments.map(segment=>segment.text)});
    } catch {
      semanticFailed = true;
    }
  }

  function stop() {
    speechSession++;
    revision++;
    waiting = undefined;
    recognizer?.stop();
    recognizer = undefined;
    audio = undefined;
    options.phase('paused');
  }

  function start(input:AudioInput) {
    if (recognizer && audio === input) return;
    stop();
    audio = input;
    prepareSemantic();
    const session = speechSession;
    function launch(fallback = false) {
      const callbacks:SpeechCallbacks = {
        status:()=>{},
        phase:phase=>{if (session === speechSession) options.phase(phase);},
        voiceActivity:voiced=>{
          if (session !== speechSession) return;
          lastVoice = voiced ? performance.now() : -Infinity;
          options.voiceActivity(lastVoice);
        },
        result:(text, final, timing)=>{
          if (session !== speechSession || !options.active()) return;
          const item = {text, final, timing, sequence:++sequence};
          const decision = apply(item);
          if (decision?.accepted) lastStrong = item.sequence;
          if (!decision?.accepted || final || decision.confidence < .82) queue(item);
        },
        fatal:code=>{
          if (session !== speechSession) return;
          if (!fallback && freeFallback('vi68',code)) launch(true);
          else {
            recognizer = undefined;
            options.phase('error');
          }
        },
      };
      options.phase('initializing');
      const processor = fallback
        ? new BrowserVosk(options.segments.map(segment=>segment.text).join('\n'))
        : new CommercialSherpa();
      recognizer = new LocalSpeech(callbacks, '', processor, 'speech', undefined, input);
      void recognizer.start();
    }
    launch();
  }

  return {
    start, stop,
    seek(position:number) {
      guide.reset(position);
      revision++;
      waiting = undefined;
    },
    destroy() {
      stop();
      worker?.terminate();
      worker = undefined;
    },
  };
}
