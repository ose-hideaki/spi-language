import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const form = document.getElementById('submission-form');
const input = document.getElementById('submission-word');
const button = document.getElementById('submission-submit');
const status = document.getElementById('submission-status');

form.addEventListener('submit', async event => {
  event.preventDefault();
  const word = input.value.trim();
  if (document.getElementById('submission-website').value) return;
  if (!word) return;
  if (!/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆ヵヶー・\s]+$/u.test(word)) {
    status.textContent = '日本語の語句を入力してください。';
    return;
  }

  button.disabled = true;
  button.textContent = '送信中…';
  status.textContent = '';
  const { error } = await client.from('word_submissions').insert({ word });
  button.disabled = false;
  button.textContent = '送信';

  if (!error) {
    form.reset();
    status.textContent = `「${word}」を送信しました。`;
  } else if (error.code === '23505') {
    status.textContent = 'その語句はすでに送信されています。';
  } else {
    console.error(error);
    status.textContent = '送信できませんでした。時間をおいてもう一度お試しください。';
  }
});
