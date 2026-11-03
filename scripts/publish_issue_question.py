"""Add one owner-approved GitHub issue question to the public question set."""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from validate_questions import validate


START = '<!-- SPI_PUBLIC_QUESTION_START -->'
END = '<!-- SPI_PUBLIC_QUESTION_END -->'
ALLOWED_KEYS = {
    'id', 'category', 'question', 'choices', 'answer', 'explanation', 'passage',
    'origin', 'sourceUrl', 'sourceLabel', 'contentLicense', 'dictionaryTitle', 'reviewed'
}


def extract_question(event):
    body = event.get('issue', {}).get('body', '')
    match = re.search(
        re.escape(START) + r'\s*```json\s*([\s\S]*?)\s*```\s*' + re.escape(END),
        body,
    )
    if not match:
        raise ValueError('問題JSONの区切りが見つかりません')
    question = json.loads(match.group(1))
    if not isinstance(question, dict):
        raise ValueError('問題は1個のオブジェクトである必要があります')
    question = {key: value for key, value in question.items() if key in ALLOWED_KEYS}
    validate([question])
    if question.get('category') != '語句の意味':
        raise ValueError('公開フォームから登録できるのは語句の意味だけです')
    if question.get('origin') != 'ja-wiktionary':
        raise ValueError('日本語Wiktionary由来の問題だけを登録できます')
    source = urlparse(question.get('sourceUrl', ''))
    if source.scheme != 'https' or source.netloc != 'ja.wiktionary.org':
        raise ValueError('日本語Wiktionaryの出典URLが必要です')
    question['reviewed'] = True
    return question


def main(event_path):
    root = Path(__file__).resolve().parents[1]
    event = json.loads(Path(event_path).read_text(encoding='utf-8'))
    question = extract_question(event)
    target = root / 'questions.json'
    questions = json.loads(target.read_text(encoding='utf-8'))
    validate(questions)
    if any(item['id'] == question['id'] for item in questions):
        raise ValueError('同じ問題IDがすでに登録されています')
    if any(item['question'] == question['question'] for item in questions):
        raise ValueError('同じ問題文がすでに登録されています')
    questions.append(question)
    validate(questions)
    target.write_text(json.dumps(questions, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(question['id'])


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: publish_issue_question.py EVENT_JSON')
    main(sys.argv[1])
