import {normalize, type Decision, type Segment} from './prompter-matcher.ts';

type Phrase = {key:string; text:string; start:number; count:number};
type Line = {
  segment:Segment;
  words:string[];
  phrases:Phrase[];
  terms:Set<string>;
  neighbors:number[];
  similar:number[];
};
export type VisibleRange = {first:number;last:number};
export type ScriptIndex = {lines:Line[]; frequency:Map<string,number>};
export type GuideDecision = Decision & {progress:number; source:'words'|'meaning'|'hold';prefixHint?:boolean};
const tokenCache = new Map<string,{words:string[];phrases:Phrase[]}>();
const weakTerms = new Set('va la cua nhung mot cac thi da dang se duoc cho do ma voi nhu chung ta toi ban nay ay cai su viec co hay roi'.split(' '));

function tokenize(text:string) {
  const cached=tokenCache.get(text);
  if(cached)return cached;
  const original=[...text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)].map(match=>match[0]);
  const words=original.map(normalize);
  const phrases:Phrase[]=[];
  for(let start=0;start<words.length;start++){
    for(let count=1;count<=3&&start+count<=words.length;count++){
      const tokens=words.slice(start,start+count);
      if(tokens.every(token=>weakTerms.has(token)))continue;
      phrases.push({key:tokens.join(' '),text:original.slice(start,start+count).join(' '),start,count});
    }
  }
  const entry={words,phrases};
  if(tokenCache.size>=3000)tokenCache.delete(tokenCache.keys().next().value!);
  tokenCache.set(text,entry);
  return entry;
}

export function prepareScript(segments:Segment[]):ScriptIndex {
  const frequency=new Map<string,number>();
  const lines=segments.map((segment,index)=>{
    const {words,phrases}=tokenize(segment.text);
    const terms=new Set(phrases.map(phrase=>phrase.key));
    for(const term of terms)frequency.set(term,(frequency.get(term)??0)+1);
    const neighbors=Array.from({length:Math.min(segments.length-1,index+3)-Math.max(0,index-2)+1},(_,offset)=>Math.max(0,index-2)+offset)
      .filter(neighbor=>neighbor!==index);
    return {segment,words,phrases,terms,neighbors,similar:[] as number[]};
  });
  for(const line of lines){
    line.similar=line.neighbors.filter(index=>{
      const other=lines[index].words;
      if(line.words.length>=2&&line.words[0]===other[0]&&line.words[1]===other[1])return true;
      const words=new Set(line.words), rival=new Set(other);
      const common=[...words].filter(word=>rival.has(word)).length;
      return common>=3 && 2*common/(words.size+rival.size)>=.62;
    });
  }
  return {lines,frequency};
}

/** Only short distinguishing phrases from nearby sentences, never full sentences. */
export function nearbyKeyterms(script:ScriptIndex,position:number) {
  const lines=script.lines.slice(Math.max(0,position-1),position+4);
  const phrases=lines.flatMap(line=>line.phrases.filter(item=>item.count>=2&&item.count<line.words.length
    && item.text.length<=36&&lines.filter(other=>other.terms.has(item.key)).length===1));
  phrases.sort((a,b)=>(script.frequency.get(a.key)??0)-(script.frequency.get(b.key)??0)||b.count-a.count);
  const selected:string[]=[];
  for(const phrase of phrases){
    if(selected.every(text=>!normalize(text).includes(phrase.key))){
      selected.push(phrase.text);
      if(selected.length===8)break;
    }
  }
  return selected;
}

function recentWords(text:string) {
  return normalize(text).split(' ').filter(Boolean).slice(-42);
}

function mergeAdjacent(previous:string[],next:string[]) {
  for(let length=Math.min(previous.length,next.length);length>=2;length--){
    if(previous.slice(-length).every((word,index)=>word===next[index]))return [...previous,...next.slice(length)].slice(-42);
  }
  return next.length<=3 && previous.length<=7 ? [...previous,...next].slice(-12) : next;
}

function weightedOrder(heard:string[],words:string[],weight:(word:string)=>number) {
  const row=new Float32Array(heard.length+1);
  for(const word of words){
    let diagonal=0;
    for(let i=1;i<=heard.length;i++){
      const old=row[i];
      row[i]=word===heard[i-1]?Math.max(old,row[i-1],diagonal+weight(word)):Math.max(old,row[i-1]);
      diagonal=old;
    }
  }
  return row[heard.length];
}

type Candidate = {
  index:number; score:number; progress:number; phrase:number;
  matches:number; lexical:number; semantic:number; confirmed:boolean; ambiguity:boolean;
  opening:boolean;
};

function rank(script:ScriptIndex,position:number,heard:string[],semantic:Record<number,number>,allowPrevious:boolean,final:boolean,currentProgress=0,range?:VisibleRange) {
  const first=Math.max(0,range?.first??position-(allowPrevious?1:0)), last=Math.min(script.lines.length-1,range?.last??position+2);
  const occurrences=new Map<string,number>();
  for(let start=0;start<heard.length;start++){
    for(let count=1;count<=3&&start+count<=heard.length;count++)occurrences.set(heard.slice(start,start+count).join(' '),start+count);
  }
  const candidates:Candidate[]=[];
  for(let index=first;index<=last;index++){
    const {words,phrases,similar}=script.lines[index];
    if(!words.length)continue;
    const rivals=script.lines.slice(first,last+1).filter(line=>line.segment.id!==index);
    const weight=(word:string)=>weakTerms.has(word)?.24:
      Math.max(.35,(rivals.some(line=>line.terms.has(word))?.62:1.4)/(1+Math.log2(script.frequency.get(word)??1)*.18));
    const expected=words.reduce((sum,word)=>sum+weight(word),0);
    const matched=words.filter(word=>occurrences.has(word));
    const matches=new Set(matched).size;
    const coverage=matched.reduce((sum,word)=>sum+weight(word),0)/expected;
    const ordered=weightedOrder(heard,words,weight)/expected;
    const lexical=.55*coverage+.45*ordered;
    let phrase=0,progress=0,phraseTail=42,end=0,opening=false;
    const progressCues:Array<{tail:number;count:number;end:number}>=[];
    for(const item of phrases){
      const spokenEnd=occurrences.get(item.key);
      if(spokenEnd===undefined)continue;
      const tail=heard.length-spokenEnd;
      if(tail<=3&&item.count>=2)progressCues.push({tail,count:item.count,end:item.start+item.count});
      const distinctive=!rivals.some(line=>line.terms.has(item.key));
      if(distinctive&&(tail<=4||(final&&item.count>=2&&lexical>=.82))){
        if(tail<=1&&item.count>=2&&item.start<=1&&words.slice(0,item.start).every(word=>weakTerms.has(word)))opening=true;
        if(item.count>=2&&(item.count>phrase||tail<phraseTail)){
          phrase=item.count;phraseTail=tail;end=item.start+item.count;
        }
      }
    }
    // Use the most recent, longest context first. A repeated phrase must not
    // jump to its last occurrence merely because that character offset is larger.
    progressCues.sort((a,b)=>a.tail-b.tail||b.count-a.count||a.end-b.end);
    const cue=progressCues[0];
    if(cue){
      const tied=progressCues.filter(item=>item.tail===cue.tail&&item.count===cue.count);
      const floor=index===position?Math.max(0,currentProgress-.08)*words.length:0;
      const aligned=tied.find(item=>item.end>=floor)||tied[0];
      progress=aligned.end/words.length;
    }
    // The head of a rolling ASR window can belong to the previous line.
    const recent=phrase>0?Math.max(0,1-phraseTail*.17):0;
    const localized=phrase>=3?.82*recent:phrase===2?.69*recent:0;
    const rawSemantic=semantic[index]??0;
    const semanticScore=rawSemantic>=.62 ? .82*(rawSemantic+1)/2+.18*lexical : 0;
    const ambiguity=rivals.some(line=>{
      const common=words.filter(word=>!weakTerms.has(word)&&line.terms.has(word)).length;
      return common>=3&&common/Math.max(1,words.filter(word=>!weakTerms.has(word)).length)>=.6;
    })||similar.some(other=>other>=first&&other<=last);
    const contrast=ambiguity&&phrase>=2?.17*recent:0;
    const score=Math.max(lexical*.93*(progressCues.length?1:.65)+(phrase>=2?.07*recent:0),localized,semanticScore)+contrast
      -Math.min(.06,Math.max(0,Math.abs(index-position)-1)*.015)-(index<position?.025:0);
    const confirmed=matches>=2&&(phrase>=2||lexical>=.74)&&(!ambiguity||phrase>=2);
    candidates.push({index,score,progress:progressCues.length?progress:end/words.length,phrase,matches,lexical,semantic:rawSemantic,confirmed,ambiguity,opening});
  }
  return candidates.sort((a,b)=>b.score-a.score||Math.abs(a.index-position)-Math.abs(b.index-position));
}

export class ScriptGuide {
  position=0;
  private previous?:{words:string[];at:number;utterance?:number};
  private confirmation?:{index:number;evidence:string;count:number;at:number};
  private lastForward=-Infinity;
  private lastAccepted?:{index:number;evidence:string;at:number;progress:number};

  reset(position=0){
    this.position=position;
    this.previous=undefined;
    this.confirmation=undefined;
    this.lastForward=-Infinity;
    this.lastAccepted=undefined;
  }

  evaluate(text:string,final:boolean,script:ScriptIndex,options:{
    now:number;utterance?:number;semantic?:Record<number,number>;threshold?:number;range?:VisibleRange;
  }):GuideDecision {
    const {now,utterance,semantic={},threshold=.72}=options;
    const current=recentWords(text), evidence=current.join(' ');
    const hold=(reason:string,confidence=0):GuideDecision=>{
      const decision:GuideDecision={index:this.position,progress:0,source:'hold',accepted:false,reason,confidence};
      const line=script.lines[this.position],rivals=line?.similar.map(index=>script.lines[index])||[];
      if(!final&&line&&rivals.length){
        let shared=line.words.length;
        for(const rival of rivals){let length=0;while(length<shared&&line.words[length]===rival.words[length])length++;shared=Math.min(shared,length);}
        const prefix=line.words.slice(0,shared);let matched=0;
        for(const word of current){const index=prefix.indexOf(word,matched);if(index>=0)matched=index+1;}
        if(shared>=3&&matched>=3&&current.slice(-3).every(word=>prefix.includes(word))){
          decision.progress=Math.min(.35,matched/line.words.length);decision.prefixHint=true;
          decision.confidence=Math.max(.65,confidence);decision.reason='Theo cụm mở đầu chung · chờ từ phân biệt';
        }
      }
      return decision;
    };
    if(current.length<2)return hold('Chờ thêm lời nói');
    const previous=this.previous;
    if(!options.semantic&&previous?.words.join(' ')!==evidence)this.previous=final?undefined:{words:current,at:now,utterance};
    const canMerge=previous&&now-previous.at<850&&utterance!==undefined&&previous.utterance===utterance;
    const allowPrevious=now-this.lastForward>950;
    const progress=this.lastAccepted?.index===this.position?this.lastAccepted.progress:0;
    let ranked=rank(script,this.position,current,semantic,allowPrevious,final,progress,options.range);
    if(canMerge && (!ranked[0]?.confirmed || ranked[0].score<.68)){
      const expanded=mergeAdjacent(previous.words,current);
      if(expanded.join(' ')!==evidence){
        const merged=rank(script,this.position,expanded,semantic,allowPrevious,final,progress,options.range);
        if(merged[0]?.confirmed && merged[0].score>(ranked[0]?.score??0)+.06)ranked=merged;
      }
    }
    const [best,other]=ranked;
    if(!best)return hold('Chưa có câu phù hợp');
    const margin=best.score-(other?.score??0);
    const rivalMeaning=Math.max(0,...ranked.filter(row=>row.index!==best.index).map(row=>row.semantic));
    const meaningGap=best.semantic-rivalMeaning;
    const meaning=best.semantic>=.71
      && (best.matches>=2||(!best.ambiguity&&best.semantic>=.84&&meaningGap>=.14))
      && meaningGap>=(best.ambiguity?.115:.065);
    const confidence=Math.min(1,best.score);
    if(best.ambiguity&&best.phrase<2&&!meaning)return hold('Chờ từ khóa phân biệt',confidence);
    const moving=best.index!==this.position;
    const informative=evidence.replace(/\b((?:va )?(?:dieu )?quan trong(?: nhat)?|chung ta can|nhu toi da noi)\b/g,' ').split(' ').filter(word=>word&&!weakTerms.has(word));
    if(moving&&informative.length<2)return hold('Chờ nội dung phân biệt',confidence);
    const sufficient=best.confirmed||meaning||(!moving&&best.phrase>=2);
    const gate=meaning?Math.max(.67,threshold-.04):
      best.phrase>=2?Math.max(.59,threshold-.12):threshold;
    if(!sufficient||best.score<gate||margin<(best.ambiguity?.085:.063)){
      return hold('Chưa đủ chắc chắn',confidence);
    }
    if(this.lastAccepted?.evidence===evidence&&this.lastAccepted.index!==best.index&&now-this.lastAccepted.at<2400){
      return hold('Câu đọc lặp lại',confidence);
    }
    const same=this.confirmation?.index===best.index&&now-this.confirmation.at<1400;
    const count=same
      ? this.confirmation!.count+Number(this.confirmation!.evidence!==evidence)
      : 1;
    this.confirmation={index:best.index,count,evidence,at:now};
    const jump=best.index-this.position;
    const strong=best.phrase>=3&&(best.lexical>=.36||best.matches>=5);
    const skipsSafely=strong&&best.matches>=5&&margin>=.10;
    const clearMeaning=meaning&&best.semantic>=.84&&meaningGap>=.14&&margin>=.10&&current.length>=6;
    if(jump<0 && !(options.range&&(skipsSafely||clearMeaning)) && (!strong||count<2||(!final&&best.lexical<.65)))return hold('Đang xác nhận đọc lại',confidence);
    if(Math.abs(jump)>1 && !skipsSafely && !clearMeaning && (count<2 || (!meaning && best.matches<4)))return hold('Đang xác nhận câu cách xa hơn',confidence);
    const nextOpening=best.opening&&!best.ambiguity&&margin>=.18;
    if(jump===1 && !final && !meaning && !strong && !nextOpening && count<2&&!(best.phrase>=2&&best.lexical>=.77&&margin>=.16)){
      return hold('Đang xác nhận cụm từ',confidence);
    }
    if(jump>0)this.lastForward=now;
    this.position=best.index;
    const source=meaning&&(!best.confirmed||best.lexical<.6)?'meaning':'words';
    const nextProgress=source==='meaning'?Math.max(.12,best.progress):best.progress;
    this.lastAccepted={index:best.index,evidence,at:now,progress:Math.max(this.lastAccepted?.index===best.index?this.lastAccepted.progress:0,nextProgress)};
    return {index:best.index,confidence,accepted:true,progress:nextProgress,reason:source==='meaning'?'Khớp theo ý nghĩa':'Khớp theo cụm từ',source};
  }
}
