"""Add owner-approved GitHub issue questions to the public question set."""
import base64
import gzip
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from validate_questions import validate


START = '<!-- SPI_PUBLIC_QUESTION_START -->'
END = '<!-- SPI_PUBLIC_QUESTION_END -->'
GZIP_START = '<!-- SPI_PUBLIC_QUESTIONS_GZIP_START -->'
GZIP_END = '<!-- SPI_PUBLIC_QUESTIONS_GZIP_END -->'
ALLOWED_KEYS = {
    'id', 'category', 'question', 'choices', 'answer', 'explanation', 'passage',
    'origin', 'sourceUrl', 'sourceLabel', 'contentLicense', 'dictionaryTitle', 'reviewed'
}


def extract_questions(event):
    body = event.get('issue', {}).get('body', '')
    match = re.search(
        re.escape(START) + r'\s*```json\s*([\s\S]*?)\s*```\s*' + re.escape(END),
        body,
    )
    if match:
        payload = json.loads(match.group(1))
    else:
        match = re.search(
            re.escape(GZIP_START) + r'\s*```text\s*([A-Za-z0-9+/=\s]+?)\s*```\s*' + re.escape(GZIP_END),
            body,
        )
        if not match:
            raise ValueError('問題データの区切りが見つかりません')
        compressed = base64.b64decode(''.join(match.group(1).split()), validate=True)
        payload = json.loads(gzip.decompress(compressed).decode('utf-8'))
    questions = [payload] if isinstance(payload, dict) else payload
    if not isinstance(questions, list) or not questions:
        raise ValueError('1問以上の問題リストが必要です')
    cleaned = [{key: value for key, value in question.items() if key in ALLOWED_KEYS} for question in questions if isinstance(question, dict)]
    if len(cleaned) != len(questions):
        raise ValueError('問題リストの形式が正しくありません')
    validate(cleaned)
    for question in cleaned:
        if question.get('category') != '語句の意味':
            raise ValueError('公開フォームから登録できるのは語句の意味だけです')
        if question.get('origin') != 'ja-wiktionary':
            raise ValueError('日本語Wiktionary由来の問題だけを登録できます')
        source = urlparse(question.get('sourceUrl', ''))
        if source.scheme != 'https' or source.netloc != 'ja.wiktionary.org':
            raise ValueError('日本語Wiktionaryの出典URLが必要です')
        question['reviewed'] = True
    if len({question['question'] for question in cleaned}) != len(cleaned):
        raise ValueError('同じ問題文がリスト内で重複しています')
    return cleaned


def main(event_path):
    root = Path(__file__).resolve().parents[1]
    event = json.loads(Path(event_path).read_text(encoding='utf-8'))
    requested = extract_questions(event)
    target = root / 'questions.json'
    questions = json.loads(target.read_text(encoding='utf-8'))
    validate(questions)
    existing_ids = {item['id'] for item in questions}
    existing_texts = {item['question'] for item in questions}
    additions = [item for item in requested if item['id'] not in existing_ids and item['question'] not in existing_texts]
    if not additions:
        print('追加対象はありません')
        return
    questions.extend(additions)
    validate(questions)
    target.write_text(json.dumps(questions, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{len(additions)}問を追加しました')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: publish_issue_question.py EVENT_JSON')
    main(sys.argv[1])
