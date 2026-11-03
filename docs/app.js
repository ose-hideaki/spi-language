'use strict';
const $=id=>document.getElementById(id);
const KEY='kotoba-v1';
const WIKTIONARY_API='https://ja.wiktionary.org/w/api.php';
const PUBLIC_QUESTION_ISSUE_URL='https://github.com/ose-hideaki/spi-language/issues/new';
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
let state={history:[],custom:[],pending:[]},queue=[],index=0,selected=null,answered=false,startTime=0,timer=null,sessionCorrect=0,draft=null;
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
try{const saved=JSON.parse(localStorage.getItem(KEY));if(saved){if(!Array.isArray(saved.pending))saved.pending=[];if(Array.isArray(saved.custom)&&saved.custom.length)validate(saved.custom);if(saved.pending.length)validate(saved.pending);if(!Array.isArray(saved.custom)||!Array.isArray(saved.history)||!saved.history.every(h=>h&&typeof h.id==='string'&&typeof h.correct==='boolean'))throw Error();state=saved;}}catch{ $('storage-status').textContent='保存データを読み込めませんでした。このセッションで演習できます。';}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{$('storage-status').textContent='記録を保存できませんでした。ブラウザの保存設定や容量を確認してください。';}}
function all(){return [...window.SEED_QUESTIONS,...state.custom];}
function home(){clearInterval(timer);$('home').hidden=false;$('practice').hidden=true;$('result').hidden=true;const data=all();$('total').textContent=data.length;$('done').textContent=state.history.length;$('rate').textContent=state.history.length?Math.round(state.history.filter(h=>h.correct).length/state.history.length*100)+'%':'—';const current=$('category').value;$('category').replaceChildren(new Option('すべての分野','all'),...Array.from(new Set(data.map(q=>q.category))).map(c=>new Option(c,c)));if([...$('category').options].some(o=>o.value===current))$('category').value=current;renderPublishQueue();}
function shuffled(a){a=[...a];for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function shuffledWrongChoices(question){
 if(question.category!=='語句の意味')return [...question.choices];
 const wrong=shuffled(question.choices.filter((_,i)=>i!==question.answer));
 let wrongIndex=0;
 return question.choices.map((choice,i)=>i===question.answer?choice:wrong[wrongIndex++]);
}
function cleanWikiMarkup(text){
 text=text.replace(/\{\{おくりがな3\|([^{}]+)\}\}/g,(_,body)=>{const parts=body.split('|');return (parts[0]||'')+(parts[2]||'')+(parts[3]||'')+(parts[5]||'');});
 const cleaned=text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi,'').replace(/<[^>]+>/g,'').replace(/\{\{[^{}]*\}\}/g,'').replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g,'$1').replace(/'{2,}/g,'').replace(/\s+/g,' ').replace(/^[。、，・\s]+/,'').trim();
 const parts=cleaned.split('。').map(part=>part.trim()).filter(Boolean);
 if(parts.length>1&&parts.every(part=>[...part].length<=10))return parts.join('や')+'のこと。';
 return cleaned;
}
function isUsableDefinition(definition,headword){
 if(/日本語に同じ|同じ意味|同義語|を参照|に同じ/.test(definition))return false;
 const compact=definition.replace(/[（(][^）)]*[）)]/g,'').replace(/[\s。、，・「」『』【】]/g,'');
 return Boolean(compact)&&compact!==headword;
}
function extractJapaneseDefinitions(wikitext,headword){
 const lines=wikitext.split(/\r?\n/),start=lines.findIndex(line=>/^==\s*(?:\{\{(?:ja|L\|ja)\}\}|日本語)\s*==\s*$/.test(line));
 if(start<0)return [];
 let end=-1;
 end=lines.findIndex((line,i)=>i>start&&/^==[^=].*[^=]==\s*$/.test(line));
 const scoped=lines.slice(start+1,end<0?lines.length:end);
 return scoped.filter(line=>/^#(?![#*:])/.test(line)).map(line=>cleanWikiMarkup(line.slice(1))).filter(definition=>isUsableDefinition(definition,headword));
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
  const definitions=extractJapaneseDefinitions(data.parse.wikitext,data.parse.title||candidate);
  if(!definitions.length)continue;
  return {definitions,title:data.parse.title||candidate,sourceUrl:`https://ja.wiktionary.org/wiki/${encodeURIComponent(data.parse.title||candidate)}`};
 }
 throw Error('この語句は辞書で見つかりませんでした。基本形で入力すると見つかる場合があります。');
}
function meaningForQuestion(phrase,definition){
 const cleaned=definition.trim();
 if(!phrase.endsWith('な'))return cleaned;
 let meaning=cleaned.split('。').find(Boolean)?.trim()||cleaned;
 meaning=meaning.replace(/であること$/,'である').replace(/なこと$/,'である').replace(/こと$/,'').replace(/であるさま$/,'である').replace(/なさま$/,'である').replace(/さま$/,'');
 return meaning.replace(/[。]+$/,'')+'。';
}
function buildWordDraft(word,meaning,sourceUrl,dictionaryTitle=word,correctIndex=Math.floor(Math.random()*5)){
 const answerMeaning=meaningForQuestion(word,meaning);
 const distractors=shuffled(DISTRACTOR_POOL.map(x=>meaningForQuestion(word,x)).filter(x=>x!==answerMeaning)).slice(0,4);
 const choices=[...distractors];choices.splice(correctIndex,0,answerMeaning);
 const explanation=word===dictionaryTitle?`「${word}」は「${answerMeaning}」という意味です。`:`「${word}」は、辞書見出し「${dictionaryTitle}」の語義をこの形に合わせると「${answerMeaning}」という意味です。`;
 draft={id:`word-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,category:'語句の意味',question:`「${word}」の意味として最も適切なものを選んでください。`,choices,answer:correctIndex,explanation,origin:'ja-wiktionary',sourceUrl,sourceLabel:'日本語Wiktionary',contentLicense:'CC BY-SA 4.0',dictionaryTitle,reviewed:true};
 $('preview-question').textContent=draft.question;
 $('preview-choices').replaceChildren(...choices.map(x=>{const li=document.createElement('li');li.textContent=x;return li;}));
 $('preview-answer').textContent=`正解：${String.fromCharCode(65+draft.answer)}. ${answerMeaning}`;
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
  buildWordDraft(word,entry.definitions[0],entry.sourceUrl,entry.title);
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
function queueWordDraft(){
 if(!draft)return;
 try{
  validate([draft]);
  if(state.pending.some(q=>q.question===draft.question))throw Error('同じ問題が公開待ちリストにあります。');
  if(state.pending.length>=20)throw Error('一度に登録できるのは20問までです。先に現在のリストを登録してください。');
  state.pending.push(draft);save();
  $('word-form').reset();$('word-preview').hidden=true;draft=null;renderPublishQueue();
  $('word-status').textContent='公開待ちリストに1問保存しました。続けて問題を作成できます。';
 }catch(err){$('word-status').textContent='リストへ保存できませんでした：'+err.message;}
}
function renderPublishQueue(){
 $('publish-count').textContent=`${state.pending.length}問`;
 $('publish-empty').hidden=state.pending.length>0;
 $('publish-all-questions').disabled=state.pending.length===0;
 $('clear-publish-list').disabled=state.pending.length===0;
 $('publish-list').replaceChildren(...state.pending.map((q,i)=>{const li=document.createElement('li'),text=document.createElement('span'),button=document.createElement('button');text.textContent=q.question;button.type='button';button.textContent='削除';button.onclick=()=>{state.pending.splice(i,1);save();renderPublishQueue();};li.append(text,button);return li;}));
}
async function encodeQuestionBatch(questions){
 const json=JSON.stringify(questions);
 if(typeof CompressionStream==='undefined')return {start:'<!-- SPI_PUBLIC_QUESTION_START -->',end:'<!-- SPI_PUBLIC_QUESTION_END -->',language:'json',payload:JSON.stringify(questions,null,2)};
 const stream=new Blob([new TextEncoder().encode(json)]).stream().pipeThrough(new CompressionStream('gzip'));
 const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return {start:'<!-- SPI_PUBLIC_QUESTIONS_GZIP_START -->',end:'<!-- SPI_PUBLIC_QUESTIONS_GZIP_END -->',language:'text',payload:btoa(binary)};
}
function buildPublishIssueBody(questions,encoded){
 const summaries=questions.map((question,index)=>{const answer=question.choices[question.answer].replace(/\s+/g,' ');return `### ${index+1}. ${question.question}\n\n**正解：${String.fromCharCode(65+question.answer)}. ${answer}**`;}).join('\n\n');
 return [`${questions.length}問を全員向け問題リストへ登録します。アプリで確認済みの内容です。`,'','## 登録内容','',summaries,'','<details>','<summary>自動登録データ（編集しないでください）</summary>','',encoded.start,`\`\`\`${encoded.language}`,encoded.payload,'```',encoded.end,'','</details>'].join('\n');
}
async function publishPendingQuestions(){
 if(!state.pending.length)return;
 const issueWindow=window.open('about:blank','_blank');if(issueWindow)issueWindow.opener=null;
 const button=$('publish-all-questions');button.disabled=true;button.textContent='登録データを準備しています…';
 try{
  validate(state.pending);
  const encoded=await encodeQuestionBatch(state.pending);
  const body=buildPublishIssueBody(state.pending,encoded);
  const params=new URLSearchParams({title:`[公開問題一括登録] ${state.pending.length}問`,body});
  const issueUrl=`${PUBLIC_QUESTION_ISSUE_URL}?${params}`;
  if(issueWindow)issueWindow.location.replace(issueUrl);else window.location.href=issueUrl;
  $('word-status').textContent='GitHubの確認画面を開きました。Submit後、登録完了を確認してからリストを空にしてください。';
 }catch(err){if(issueWindow)issueWindow.close();$('word-status').textContent='一括登録を開始できませんでした：'+err.message;}
 finally{button.disabled=state.pending.length===0;button.textContent='リストを全員向けに登録（管理者）';}
}
function clearPublishQueue(){
 if(state.pending.length&&confirm('公開待ちリストを空にしますか？ このブラウザからは元に戻せません。')){state.pending=[];save();renderPublishQueue();$('word-status').textContent='公開待ちリストを空にしました。';}
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
$('queue-word-question').onclick=queueWordDraft;
$('publish-all-questions').onclick=publishPendingQuestions;
$('clear-publish-list').onclick=clearPublishQueue;
validate(window.SEED_QUESTIONS);home();
