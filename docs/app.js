'use strict';
const $=id=>document.getElementById(id);
const KEY='kotoba-v1';
const WIKTIONARY_API='https://ja.wiktionary.org/w/api.php';
const DISTRACTOR_POOL=[
 'ある物事だけに心を奪われ、周囲が見えなくなること',
 '状況に応じて素早く考えや行動を変えること',
 '自分の考えを曲げず、最後まで押し通すこと',
 '物事の一部分だけを取り上げて判断すること',
 '互いに関係がなく、別々に存在していること',
 '前例や慣習を重んじ、それに従うこと',
 '物事の全体を広い視点から捉えること',
 '表面には現れず、内側に隠れて存在すること',
 '根拠が十分でないまま推測して決めること',
 '対立する意見の間を取り持ち、調整すること',
 '必要以上に遠慮し、自分の意見を控えること',
 '失敗を恐れず、新しいことに取り組むこと',
 '複数のものを比べ、共通点と相違点を調べること',
 '事実を順序立てて、分かりやすく説明すること',
 '問題の原因をさかのぼって詳しく調べること',
 '決められた役割や責任を最後まで果たすこと',
 '意見や要求を強く主張し、相手に迫ること',
 '相手の事情を考え、判断や行動を控えめにすること',
 '以前の状態を改め、よりよい形に変えること',
 'すでに決まった事柄を、改めて確認すること'
];
let state={history:[],custom:[]},queue=[],index=0,selected=null,answered=false,startTime=0,timer=null,sessionCorrect=0,draft=null;
function validate(data){
 if(!Array.isArray(data)||!data.length||data.length>500)throw Error('1〜500問の配列にしてください。');
 const ids=new Set();
 for(const q of data){
  if(!q||typeof q!=='object'||!['id','category','question','explanation'].every(k=>typeof q[k]==='string'&&q[k].trim()&&q[k].length<=10000))throw Error('id・category・question・explanationは空でない文字列が必要です。');
  if(ids.has(q.id))throw Error('問題IDが重複しています。');ids.add(q.id);
  if(!Array.isArray(q.choices)||q.choices.length!==5||!q.choices.every(c=>typeof c==='string'&&c.trim()&&c.length<3000)||new Set(q.choices).size!==5)throw Error('異なる5個の選択肢が必要です。');
  if(!Number.isInteger(q.answer)||q.answer<0||q.answer>4)throw Error('answerは0〜4の整数にしてください。');
  if(q.passage!==undefined&&(typeof q.passage!=='string'||q.passage.length>20000))throw Error('passageは20000文字以下の文字列にしてください。');
 }
 return data;
}
try{const saved=JSON.parse(localStorage.getItem(KEY));if(saved){if(Array.isArray(saved.custom)&&saved.custom.length)validate(saved.custom);if(!Array.isArray(saved.custom)||!Array.isArray(saved.history)||!saved.history.every(h=>h&&typeof h.id==='string'&&typeof h.correct==='boolean'))throw Error();state=saved;}}catch{ $('storage-status').textContent='保存データを読み込めませんでした。このセッションで演習できます。';}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{$('storage-status').textContent='記録を保存できませんでした。ブラウザの保存設定や容量を確認してください。';}}
function all(){return [...window.SEED_QUESTIONS,...state.custom];}
function home(){clearInterval(timer);$('home').hidden=false;$('practice').hidden=true;$('result').hidden=true;const data=all();$('total').textContent=data.length;$('done').textContent=state.history.length;$('rate').textContent=state.history.length?Math.round(state.history.filter(h=>h.correct).length/state.history.length*100)+'%':'—';const current=$('category').value;$('category').replaceChildren(new Option('すべての分野','all'),...Array.from(new Set(data.map(q=>q.category))).map(c=>new Option(c,c)));if([...$('category').options].some(o=>o.value===current))$('category').value=current;}
function shuffled(a){a=[...a];for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function shuffledWrongChoices(question){
 if(question.category!=='語句の意味')return [...question.choices];
 const wrong=shuffled(question.choices.filter((_,i)=>i!==question.answer));
 let wrongIndex=0;
 return question.choices.map((choice,i)=>i===question.answer?choice:wrong[wrongIndex++]);
}
function cleanWikiMarkup(text){
 return text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi,'').replace(/<[^>]+>/g,'').replace(/\{\{[^{}]*\}\}/g,'').replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g,'$1').replace(/'{2,}/g,'').replace(/\s+/g,' ').trim();
}
function extractJapaneseDefinitions(wikitext){
 const lines=wikitext.split(/\r?\n/),start=lines.findIndex(line=>/^==\s*(?:\{\{ja\}\}|日本語)\s*==\s*$/.test(line));
 let end=-1;
 if(start>=0)end=lines.findIndex((line,i)=>i>start&&/^==[^=].*[^=]==\s*$/.test(line));
 const scoped=start<0?lines:lines.slice(start+1,end<0?lines.length:end);
 return scoped.filter(line=>/^#(?![#*:])/.test(line)).map(line=>cleanWikiMarkup(line.slice(1))).filter(Boolean);
}
function wiktionaryCandidates(phrase){
 const candidates=[phrase];
 const endings=['である','だった','でした','される','させる','している','して','した','する','な','に','の','だ'];
 for(const ending of endings){
  if(phrase.endsWith(ending)&&phrase.length>ending.length)candidates.push(phrase.slice(0,-ending.length));
 }
 return [...new Set(candidates)];
}
async function fetchWiktionaryEntry(phrase){
 for(const candidate of wiktionaryCandidates(phrase)){
  const params=new URLSearchParams({action:'parse',page:candidate,prop:'wikitext',format:'json',formatversion:'2',origin:'*'});
  const response=await fetch(`${WIKTIONARY_API}?${params}`);
  if(!response.ok)throw Error('辞書へ接続できませんでした。');
  const data=await response.json();
  if(data.error||!data.parse?.wikitext)continue;
  const definitions=extractJapaneseDefinitions(data.parse.wikitext);
  if(!definitions.length)continue;
  return {definitions,title:data.parse.title||candidate,sourceUrl:`https://ja.wiktionary.org/wiki/${encodeURIComponent(data.parse.title||candidate)}`};
 }
 throw Error('この語句は辞書で見つかりませんでした。基本形で入力すると見つかる場合があります。');
}
function buildWordDraft(word,meaning,sourceUrl,dictionaryTitle=word,correctIndex=Math.floor(Math.random()*5)){
 const distractors=shuffled(DISTRACTOR_POOL.filter(x=>x!==meaning)).slice(0,4);
 const choices=[...distractors];choices.splice(correctIndex,0,meaning);
 const explanation=word===dictionaryTitle?`「${word}」は「${meaning}」という意味です。`:`「${word}」は、辞書見出し「${dictionaryTitle}」の語義では「${meaning}」という意味です。`;
 draft={id:`word-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,category:'語句の意味',question:`「${word}」の意味として最も適切なものを選んでください。`,choices,answer:correctIndex,explanation,origin:'ja-wiktionary',sourceUrl,sourceLabel:'日本語Wiktionary',contentLicense:'CC BY-SA 4.0',dictionaryTitle,reviewed:true};
 $('preview-question').textContent=draft.question;
 $('preview-choices').replaceChildren(...choices.map(x=>{const li=document.createElement('li');li.textContent=x;return li;}));
 $('preview-answer').textContent=`正解：${String.fromCharCode(65+draft.answer)}. ${meaning}`;
 $('preview-source').href=sourceUrl;
 $('word-preview').hidden=false;$('word-status').textContent=word===dictionaryTitle?'問題案を作りました。誤答も含めて内容を確認してください。':`辞書見出し「${dictionaryTitle}」の意味から問題案を作りました。内容を確認してください。`;
}
async function lookupWordDraft(){
 const word=$('word-input').value.trim(),button=$('lookup-submit');
 if(!word){$('word-status').textContent='語句を入力してください。';return;}
 if(!/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆ヵヶー・\s]+$/u.test(word)){$('word-status').textContent='日本語の語句を入力してください。';return;}
 button.disabled=true;button.textContent='意味を調べています…';$('word-status').textContent='日本語Wiktionaryを検索しています。';$('word-preview').hidden=true;
 try{
  const entry=await fetchWiktionaryEntry(word);
  buildWordDraft(word,entry.definitions.at(-1),entry.sourceUrl,entry.title);
 }catch(err){draft=null;$('word-status').textContent=`問題を作れませんでした：${err.message}`;}
 finally{button.disabled=false;button.textContent='意味を調べて問題案を作る';}
}
function regenerateWordDraft(){if(draft)buildWordDraft($('word-input').value.trim(),draft.choices[draft.answer],draft.sourceUrl,draft.dictionaryTitle||$('word-input').value.trim(),draft.answer);}
function addWordDraft(){
 if(!draft)return;
 try{
  validate([draft]);
  if(all().some(q=>q.question===draft.question))throw Error('同じ言葉の問題がすでにあります。');
  if(state.custom.length>=500)throw Error('追加問題は合計500問までです。');
  state.custom.push(draft);save();
  $('word-form').reset();$('word-preview').hidden=true;draft=null;home();
  $('word-status').textContent='1問を追加しました。「語句の意味」の演習で出題されます。';
 }catch(err){$('word-status').textContent='追加できませんでした：'+err.message;}
}
function begin(review=false){let data=all();if(review){const latest=new Map(state.history.map(h=>[h.id,h.correct]));data=data.filter(q=>latest.get(q.id)===false);}else if($('category').value!=='all'){data=data.filter(q=>q.category===$('category').value);}if(!data.length){$('notice').textContent=review?'復習する問題はありません。最新の解答が不正解の問題がここに入ります。':'問題がありません。';return;}queue=shuffled(data).slice(0,Number($('count').value));index=0;sessionCorrect=0;startTime=Date.now();$('home').hidden=true;$('result').hidden=true;$('practice').hidden=false;const tick=()=>{$('timer').textContent=formatTime(Date.now()-startTime);};tick();timer=setInterval(tick,1000);render();}
function formatTime(ms){let s=Math.floor(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
function render(){selected=null;answered=false;let q=queue[index],displayChoices=shuffledWrongChoices(q);$('position').textContent=`${index+1} / ${queue.length}`;$('progress').max=queue.length;$('progress').value=index;$('kind').textContent=q.category;$('question').textContent=q.question;$('passage').hidden=!q.passage;$('passage').textContent=q.passage||'';$('feedback').hidden=true;$('next').hidden=true;$('submit').hidden=false;$('submit').disabled=true;$('choices').replaceChildren();const legend=document.createElement('legend');legend.className='sr';legend.textContent='回答を一つ選択';$('choices').append(legend);displayChoices.forEach((c,i)=>{const label=document.createElement('label');label.className='choice';const radio=document.createElement('input');radio.type='radio';radio.name='answer';radio.value=i;radio.addEventListener('change',()=>{selected=i;$('submit').disabled=false;});const span=document.createElement('span');span.textContent=String.fromCharCode(65+i)+'. '+c;label.append(radio,span);$('choices').append(label);});$('question').tabIndex=-1;$('question').focus();}
$('submit').onclick=()=>{if(answered||selected===null)return;answered=true;const q=queue[index],correct=selected===q.answer;if(correct)sessionCorrect++;state.history.push({id:q.id,correct,at:new Date().toISOString()});save();[...$('choices').querySelectorAll('label')].forEach((el,i)=>{el.querySelector('input').disabled=true;if(i===q.answer)el.classList.add('correct');else if(i===selected)el.classList.add('wrong');});$('feedback').textContent=`${correct?'正解です。':'今回は不正解です。'} 正解：${String.fromCharCode(65+q.answer)}\n\n${q.explanation}`;if(q.sourceUrl){const p=document.createElement('p'),a=document.createElement('a');a.href=q.sourceUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent=q.sourceLabel||'出典';p.className='source-note';p.append('意味の出典：',a,q.contentLicense?`（${q.contentLicense}）`:'');$('feedback').append(p);}$('feedback').hidden=false;$('submit').hidden=true;$('next').hidden=false;$('next').textContent=index===queue.length-1?'結果を見る →':'次の問題 →';$('progress').value=index+1;};
$('next').onclick=()=>{index++;if(index<queue.length){render();return;}clearInterval(timer);$('practice').hidden=true;$('result').hidden=false;$('score').textContent=`${sessionCorrect} / ${queue.length} 問正解`;$('duration').textContent=`正答率 ${Math.round(sessionCorrect/queue.length*100)}% ・ 解答時間 ${formatTime(Date.now()-startTime)}`;};
$('start').onclick=()=>begin();$('review').onclick=()=>begin(true);$('again').onclick=home;$('exit').onclick=()=>{if(confirm('演習を終了してホームに戻りますか？ 回答済みの記録は保存されます。'))home();};
$('word-form').onsubmit=e=>{e.preventDefault();lookupWordDraft();};
$('regenerate-word-question').onclick=regenerateWordDraft;
$('add-word-question').onclick=addWordDraft;
validate(window.SEED_QUESTIONS);home();
