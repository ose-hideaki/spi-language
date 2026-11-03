import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const $ = id => document.getElementById(id);
const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const KEY = 'kotoba-v1';
const WIKTIONARY_API = 'https://ja.wiktionary.org/w/api.php';
const ISSUE_URL = 'https://github.com/ose-hideaki/spi-language/issues/new';
const DISTRACTORS = [
  'ある物事だけに心を奪われ、周囲が見えなくなること', '状況に応じて素早く考えや行動を変えること',
  '自分の考えを曲げず、最後まで押し通すこと', '物事の一部分だけを取り上げて判断すること',
  '互いに関係がなく、別々に存在していること', '前例や慣習を重んじ、それに従うこと',
  '物事の全体を広い視点から捉えること', '表面には現れず、内側に隠れて存在すること',
  '根拠が十分でないまま推測して決めること', '対立する意見の間を取り持ち、調整すること',
  '必要以上に遠慮し、自分の意見を控えること', '失敗を恐れず、新しいことに取り組むこと',
  '複数のものを比べ、共通点と相違点を調べること', '事実を順序立てて、分かりやすく説明すること',
  '問題の原因をさかのぼって詳しく調べること', '決められた役割や責任を最後まで果たすこと',
  '意見や要求を強く主張し、相手に迫ること', '相手の事情を考え、判断や行動を控えめにすること',
  '以前の状態を改め、よりよい形に変えること', 'すでに決まった事柄を、改めて確認すること'
];

let state = { pending: [], publishReady: false };
let submissions = [];
let lookupEntry = null;
let draft = null;
let activeSubmissionId = null;

try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved && Array.isArray(saved.pending)) {
    state.pending = saved.pending;
    state.publishReady = saved.publishReady === true;
  }
} catch {}

function save() {
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  localStorage.setItem(KEY, JSON.stringify({ ...saved, pending: state.pending, publishReady: state.publishReady }));
}

function shuffled(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function validateQuestion(question) {
  if (!question || typeof question.id !== 'string' || typeof question.question !== 'string') throw Error('問題データが不正です。');
  if (!Array.isArray(question.choices) || question.choices.length !== 5 || new Set(question.choices).size !== 5) throw Error('異なる5個の選択肢が必要です。');
  if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer > 4) throw Error('正解の位置が不正です。');
  if (question.reading !== undefined && (typeof question.reading !== 'string' || question.reading.length > 200)) throw Error('ふりがなのデータが不正です。');
}

async function updateAuthView() {
  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    $('login-panel').hidden = false;
    $('admin-panel').hidden = true;
    return;
  }
  const { data: admin, error } = await client.from('app_admins').select('user_id').maybeSingle();
  if (error || !admin) {
    $('login-panel').hidden = false;
    $('admin-panel').hidden = true;
    $('login-form').hidden = true;
    $('login-status').textContent = 'ログインできました。管理者登録が完了するまでお待ちください。';
    return;
  }
  $('login-panel').hidden = true;
  $('admin-panel').hidden = false;
  renderPublishQueue();
  await loadSubmissions();
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('login-button');
  button.disabled = true;
  button.textContent = '送信中…';
  const redirect = new URL('admin.html', location.href).href;
  const { error } = await client.auth.signInWithOtp({
    email: $('admin-email').value.trim(),
    options: { emailRedirectTo: redirect, shouldCreateUser: true }
  });
  button.disabled = false;
  button.textContent = 'ログイン用リンクを送る';
  $('login-status').textContent = error ? `送信できませんでした：${error.message}` : 'メールを送りました。届いたログイン用リンクを開いてください。';
});

$('logout').addEventListener('click', async () => {
  await client.auth.signOut();
  location.reload();
});

client.auth.onAuthStateChange(() => setTimeout(updateAuthView, 0));

async function loadSubmissions() {
  $('submission-list-status').textContent = '読み込んでいます…';
  const { data, error } = await client.from('word_submissions').select('id,word,created_at').eq('status', 'pending').order('created_at', { ascending: false });
  if (error) {
    $('submission-list-status').textContent = '一覧を読み込めませんでした。管理者権限を確認してください。';
    return;
  }
  submissions = data;
  $('submission-count').textContent = `${data.length}件`;
  $('submission-list-status').textContent = data.length ? '' : '届いた語句はありません。';
  renderSubmissions();
}

function renderSubmissions() {
  $('submission-list').replaceChildren(...submissions.map(item => {
    const li = document.createElement('li');
    const word = document.createElement('span');
    word.className = 'submission-word';
    word.textContent = item.word;
    const date = document.createElement('span');
    date.className = 'submission-date';
    date.textContent = new Date(item.created_at).toLocaleString('ja-JP');
    word.append(date);
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'primary';
    create.textContent = '問題を作る';
    create.onclick = () => useSubmission(item);
    li.append(word, create);

    const reject = document.createElement('button');
    reject.type = 'button';
    reject.textContent = '見送る';
    reject.onclick = () => markSubmission(item.id, 'rejected');
    li.append(reject);
    return li;
  }));
}

async function markSubmission(id, status, questionId = null) {
  const label = status === 'processed' ? '公開済み' : '見送り';
  if (!confirm(`この語句を「${label}」にしますか？`)) return;
  const values = { status, processed_at: new Date().toISOString(), question_id: questionId };
  const { error } = await client.from('word_submissions').update(values).eq('id', id);
  if (error) {
    $('submission-list-status').textContent = `更新できませんでした：${error.message}`;
    return;
  }
  await loadSubmissions();
}

async function useSubmission(item) {
  activeSubmissionId = item.id;
  $('word-input').value = item.word;
  document.querySelector('.question-builder').scrollIntoView({ behavior: 'smooth' });
  await lookupWordDraft();
}

function mergeFollowingKana(surface, following) {
  let overlap = Math.min(surface.length, following.length);
  while (overlap > 0 && !surface.endsWith(following.slice(0, overlap))) overlap--;
  const duplicated = overlap >= 2 || (overlap === 1 && surface.endsWith('る') && following.startsWith('るよう'));
  return surface + (duplicated ? following.slice(overlap) : following);
}

function cleanWikiMarkup(text) {
  text = text
    .replace(/\{\{おくりがな2\|([^{}]+)\}\}([ぁ-ゖー]*)/gu, (_, body, following) => { const p = body.split('|'); return mergeFollowingKana((p[0] || '') + (p[2] || ''), following); })
    .replace(/\{\{おくりがな3\|([^{}]+)\}\}([ぁ-ゖー]*)/gu, (_, body, following) => { const p = body.split('|'); return mergeFollowingKana((p[0] || '') + (p[2] || '') + (p[4] || ''), following); })
    .replace(/\{\{おくりがな\|([^{}]+)\}\}([ぁ-ゖー]*)/gu, (_, body, following) => { const p = body.split('|'); return mergeFollowingKana((p[0] || '') + (p[1] || ''), following); })
    .replace(/\{\{ふりがな\|([^{}|]+)\|[^{}]+\}\}/g, '$1')
    .replace(/\{\{context\|figuratively\|[^{}]*\}\}/g, '（比喩的に）');
  const cleaned = text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<[^>]+>/g, '').replace(/\{\{[^{}]*\}\}/g, '').replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1').replace(/'{2,}/g, '').replace(/\s+/g, ' ').replace(/^[。、，・\s]+/, '').trim();
  const parts = cleaned.split('。').map(part => part.trim()).filter(Boolean);
  if (parts.length > 1 && parts.every(part => [...part].length <= 10)) return `${parts.join('や')}のこと。`;
  return cleaned;
}

function extractDefinitions(wikitext, headword) {
  const lines = wikitext.split(/\r?\n/);
  const start = lines.findIndex(line => /^==\s*(?:\{\{(?:ja|L\|ja)\}\}|日本語)\s*==\s*$/.test(line));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && /^==[^=].*[^=]==\s*$/.test(line));
  return lines.slice(start + 1, end < 0 ? lines.length : end)
    .filter(line => /^#(?![#*:])/.test(line))
    .map(line => cleanWikiMarkup(line.slice(1)))
    .filter(definition => {
      if (/日本語に同じ|同じ意味|同義語|を参照|に同じ/.test(definition)) return false;
      if (/(ている){2}|るる|[、，]\s*な(?=[\p{Script=Han}])/u.test(definition)) return false;
      const compact = definition.replace(/[（(][^）)]*[）)]/g, '').replace(/[\s。、，・「」『』【】]/g, '');
      return compact && compact !== headword && [...compact].length >= 4;
    });
}

function extractReading(wikitext) {
  const match = wikitext.match(/\{\{kana-DEFAULTSORT\|([^{}|]+)(?:\|[^{}]*)?\}\}/) || wikitext.match(/\{\{ja-pron\|([^{}|]+)(?:\|[^{}]*)?\}\}/);
  if (!match) return '';
  const reading = match[1].replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1').trim();
  return /^[ぁ-ゖァ-ヺー・\s]+$/u.test(reading) ? reading : '';
}

function readingForPhrase(phrase, dictionaryTitle, baseReading) {
  if (!baseReading) return '';
  return phrase.startsWith(dictionaryTitle) ? baseReading + phrase.slice(dictionaryTitle.length) : baseReading;
}

async function fetchEntry(phrase) {
  const endings = ['である', 'だった', 'でした', 'される', 'させる', 'している', 'して', 'した', 'する', 'な', 'に', 'の', 'だ'];
  const candidates = [...new Set([phrase, ...endings.filter(x => phrase.endsWith(x) && phrase.length > x.length).map(x => phrase.slice(0, -x.length))])];
  for (const candidate of candidates) {
    const params = new URLSearchParams({ action: 'parse', page: candidate, prop: 'wikitext', format: 'json', formatversion: '2', origin: '*' });
    const response = await fetch(`${WIKTIONARY_API}?${params}`);
    if (!response.ok) throw Error('辞書へ接続できませんでした。');
    const data = await response.json();
    if (!data.parse?.wikitext) continue;
    const title = data.parse.title || candidate;
    const definitions = extractDefinitions(data.parse.wikitext, title);
    if (definitions.length) return { title, definitions, reading: readingForPhrase(phrase, title, extractReading(data.parse.wikitext)), sourceUrl: `https://ja.wiktionary.org/wiki/${encodeURIComponent(title)}` };
  }
  throw Error('辞書で見つかりませんでした。基本形で入力すると見つかる場合があります。');
}

function meaningForQuestion(word, definition) {
  const cleaned = definition.trim();
  if (!word.endsWith('な')) return cleaned;
  let meaning = cleaned.split('。').find(Boolean)?.trim() || cleaned;
  meaning = meaning.replace(/であること$/, 'である').replace(/なこと$/, 'である').replace(/こと$/, '').replace(/であるさま$/, 'である').replace(/なさま$/, 'である').replace(/さま$/, '');
  return `${meaning.replace(/[。]+$/, '')}。`;
}

function buildDraft(word, definition, correctIndex = Math.floor(Math.random() * 5)) {
  const answer = meaningForQuestion(word, definition);
  const reading = draft?.headword === word ? draft.reading : lookupEntry.reading;
  const wrong = shuffled(DISTRACTORS.map(x => meaningForQuestion(word, x)).filter(x => x !== answer)).slice(0, 4);
  const choices = [...wrong];
  choices.splice(correctIndex, 0, answer);
  draft = {
    id: `word-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    category: '語句の意味',
    question: `「${word}」の意味として最も適切なものを選んでください。`,
    headword: word,
    reading,
    choices,
    answer: correctIndex,
    explanation: `「${word}」は「${answer}」という意味です。`,
    origin: 'ja-wiktionary', sourceUrl: lookupEntry.sourceUrl, sourceLabel: '日本語Wiktionary',
    contentLicense: 'CC BY-SA 4.0', dictionaryTitle: lookupEntry.title, reviewed: true,
    submissionId: activeSubmissionId
  };
  $('reading-input').value = reading;
  $('reading-input').required = /\p{Script=Han}/u.test(word);
  $('preview-question').textContent = draft.question;
  $('preview-choices').replaceChildren(...choices.map(choice => { const li = document.createElement('li'); li.textContent = choice; return li; }));
  $('preview-answer').textContent = `正解：${String.fromCharCode(65 + correctIndex)}. ${answer}`;
  $('preview-source').href = lookupEntry.sourceUrl;
  $('word-preview').hidden = false;
}

function chooseDefinition(index, correctIndex) {
  const definition = lookupEntry?.definitions[index];
  if (definition) {
    $('meaning-input').value = definition;
    buildDraft($('word-input').value.trim(), definition, correctIndex);
  }
}

async function lookupWordDraft() {
  const word = $('word-input').value.trim();
  if (!word) return;
  const button = $('lookup-submit');
  button.disabled = true;
  button.textContent = '検索中…';
  $('word-status').textContent = '日本語Wiktionaryを検索しています。';
  $('word-preview').hidden = true;
  try {
    lookupEntry = await fetchEntry(word);
    $('definition-select').replaceChildren(...lookupEntry.definitions.map((definition, index) => new Option(`${index + 1}. ${definition}`, String(index))));
    $('definition-field').hidden = lookupEntry.definitions.length === 1;
    chooseDefinition(0);
    $('word-status').textContent = '問題案を作りました。使う意味と選択肢を確認してください。';
  } catch (error) {
    draft = null;
    $('word-status').textContent = `問題を作れませんでした：${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = '意味を調べる';
  }
}

function queueDraft() {
  try {
    if (/\p{Script=Han}/u.test(draft?.headword || '') && !draft?.reading) throw Error('漢字の語句にはふりがなを入力してください。');
    validateQuestion(draft);
    if (state.pending.some(item => item.question === draft.question)) throw Error('同じ問題がリストにあります。');
    if (state.pending.length >= 20) throw Error('一度に登録できるのは20問までです。');
    state.pending.push(draft);
    state.publishReady = false;
    save();
    $('word-form').reset();
    $('word-preview').hidden = true;
    draft = null;
    lookupEntry = null;
    activeSubmissionId = null;
    $('word-status').textContent = '公開待ちリストに保存しました。';
    renderPublishQueue();
    renderSubmissions();
  } catch (error) {
    $('word-status').textContent = `保存できませんでした：${error.message}`;
  }
}

function renderPublishQueue() {
  $('publish-count').textContent = `${state.pending.length}問`;
  $('publish-empty').hidden = state.pending.length > 0;
  $('publish-all-questions').disabled = state.pending.length === 0;
  $('publish-complete').hidden = state.pending.length === 0 || !state.publishReady;
  $('publish-complete').disabled = state.pending.length === 0 || !state.publishReady;
  $('clear-publish-list').disabled = state.pending.length === 0;
  $('publish-list').replaceChildren(...state.pending.map((question, index) => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    const remove = document.createElement('button');
    text.textContent = question.question;
    remove.type = 'button';
    remove.textContent = '削除';
    remove.onclick = () => { state.pending.splice(index, 1); state.publishReady = false; save(); renderPublishQueue(); renderSubmissions(); };
    li.append(text, remove);
    return li;
  }));
}

async function encodeQuestions(questions) {
  const json = JSON.stringify(questions.map(({ submissionId, ...question }) => question));
  const stream = new Blob([new TextEncoder().encode(json)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

async function publishPending() {
  if (!state.pending.length) return;
  const popup = window.open('about:blank', '_blank');
  const button = $('publish-all-questions');
  button.disabled = true;
  button.textContent = '準備中…';
  try {
    state.pending.forEach(validateQuestion);
    const payload = await encodeQuestions(state.pending);
    const summaries = state.pending.map((question, index) => `### ${index + 1}. ${question.question}\n\n**正解：${String.fromCharCode(65 + question.answer)}. ${question.choices[question.answer]}**`).join('\n\n');
    const body = `${state.pending.length}問を全員向け問題リストへ登録します。アプリで確認済みの内容です。\n\n## 登録内容\n\n${summaries}\n\n<details>\n<summary>自動登録データ（編集しないでください）</summary>\n\n<!-- SPI_PUBLIC_QUESTIONS_GZIP_START -->\n\`\`\`text\n${payload}\n\`\`\`\n<!-- SPI_PUBLIC_QUESTIONS_GZIP_END -->\n\n</details>`;
    const url = `${ISSUE_URL}?${new URLSearchParams({ title: `[公開問題一括登録] ${state.pending.length}問`, body })}`;
    if (popup) popup.location.replace(url); else location.href = url;
    state.publishReady = true;
    save();
    renderPublishQueue();
    $('word-status').textContent = 'GitHubでSubmitして公開を確認したら、この画面の「公開完了」を押してください。';
  } catch (error) {
    if (popup) popup.close();
    $('word-status').textContent = `登録を始められませんでした：${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'GitHubへまとめて登録';
  }
}

async function completePublishedQuestions() {
  if (!state.pending.length || !state.publishReady) return;
  if (!confirm('GitHubでSubmitし、問題が公開されたことを確認しましたか？')) return;
  const button = $('publish-complete');
  button.disabled = true;
  button.textContent = '届いたリストを更新中…';
  const completedAt = new Date().toISOString();
  const results = await Promise.all(state.pending.map(async question => {
    if (!question.submissionId) return { question, success: true };
    const { data, error } = await client
      .from('word_submissions')
      .update({ status: 'processed', processed_at: completedAt, question_id: question.id })
      .eq('id', question.submissionId)
      .eq('status', 'pending')
      .select('id');
    return { question, success: !error && data.length === 1, error };
  }));
  const failed = results.filter(result => !result.success);
  state.pending = failed.map(result => result.question);
  state.publishReady = failed.length > 0;
  save();
  renderPublishQueue();
  await loadSubmissions();
  if (failed.length) {
    console.error(failed.map(result => result.error));
    $('word-status').textContent = `${results.length - failed.length}問を処理済みにしました。${failed.length}問は更新できなかったため、公開待ちリストに残しています。`;
  } else {
    $('word-status').textContent = '公開した問題を処理済みにし、対応する語句を届いたリストから消しました。';
  }
  button.textContent = '公開完了（届いたリストから消す）';
}

$('reload-submissions').onclick = loadSubmissions;
$('word-form').onsubmit = event => { event.preventDefault(); activeSubmissionId = activeSubmissionId || null; lookupWordDraft(); };
$('word-input').addEventListener('input', () => { if (!submissions.some(item => item.id === activeSubmissionId && item.word === $('word-input').value.trim())) activeSubmissionId = null; });
$('definition-select').onchange = () => chooseDefinition(Number($('definition-select').value), draft?.answer);
$('meaning-input').oninput = () => { if (draft && $('meaning-input').value.trim()) buildDraft($('word-input').value.trim(), $('meaning-input').value.trim(), draft.answer); };
$('reading-input').oninput = () => { if (draft) draft.reading = $('reading-input').value.trim(); };
$('regenerate-word-question').onclick = () => { if (draft) buildDraft($('word-input').value.trim(), $('meaning-input').value.trim(), draft.answer); };
$('queue-word-question').onclick = queueDraft;
$('publish-all-questions').onclick = publishPending;
$('publish-complete').onclick = completePublishedQuestions;
$('clear-publish-list').onclick = () => {
  if (state.pending.length && confirm('公開待ちリストを空にしますか？')) {
    state.pending = [];
    state.publishReady = false;
    save();
    renderPublishQueue();
    renderSubmissions();
  }
};

updateAuthView();
