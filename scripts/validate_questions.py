"""Validate structure only; semantic review is still required."""
import argparse
import json
from pathlib import Path


def validate(data):
    if not isinstance(data, list) or not 1 <= len(data) <= 500:
        raise ValueError('1〜500問の配列が必要です')
    ids = set()
    for q in data:
        if not isinstance(q, dict):
            raise ValueError('各問題はオブジェクトが必要です')
        for key in ('id', 'category', 'question', 'explanation'):
            if not isinstance(q.get(key), str) or not q[key].strip() or len(q[key]) > 10000:
                raise ValueError(f'{key}: 空でない10000文字以下の文字列が必要です')
        if q['id'] in ids:
            raise ValueError(f'重複ID: {q["id"]}')
        ids.add(q['id'])
        choices = q.get('choices')
        if not isinstance(choices, list) or len(choices) != 5 or not all(isinstance(c, str) and c.strip() and len(c) < 3000 for c in choices) or len(set(choices)) != 5:
            raise ValueError(f'{q["id"]}: 異なる5つの選択肢が必要です')
        if type(q.get('answer')) is not int or not 0 <= q['answer'] < 5:
            raise ValueError(f'{q["id"]}: answerは0〜4の整数です')
        if not isinstance(q.get('passage', ''), str) or len(q.get('passage', '')) > 20000:
            raise ValueError('passageは20000文字以下の文字列です')
    return data


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('file', type=Path)
    p.add_argument('--build', action='store_true')
    args = p.parse_args()
    try:
        data = validate(json.loads(args.file.read_text(encoding='utf-8')))
        if args.build:
            target = Path(__file__).resolve().parents[1] / 'docs/questions.js'
            target.write_text('window.SEED_QUESTIONS = ' + json.dumps(data, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
        print(f'構造検証OK: {len(data)}問（内容の正確性・正解の一意性は未検証）')
    except (ValueError, OSError) as e:
        p.exit(1, f'検証エラー: {e}\n')
