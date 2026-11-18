#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
日本語で書いた内容に、英語を自動で付けるスクリプト。
GitHub Actions（.github/workflows/auto-translate.yml）から、サイトを更新するたびに実行されます。

しくみ
  ・お知らせ（_posts）、各ページ、_data の一覧を調べ、「日本語はあるのに英語の欄が空」の項目を探す。
  ・見つかった項目を Claude API で英訳し、英語の欄（title_en、body_en など）に書き込む。
  ・自動で入れた英語は tools/translation-state.json に記録する。あとで日本語を書き直すと、
    その英語が自動翻訳のままなら作り直す。人が英語を直した項目には、二度と触らない。
  ・人名の読み（name_en）は自動では作らない（読み間違いを避けるため）。

必要なもの
  ・リポジトリの Secret「ANTHROPIC_API_KEY」（Claude API のキー）。無ければ何もせずに終わる。

用語や人名の英語表記は _data/glossary.yml（編集画面の「翻訳の用語集」）で指定できます。
"""
import copy
import glob
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

import yaml  # PyYAML

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_PATH = os.path.join(ROOT, "tools", "translation-state.json")
API_URL = os.environ.get("ANTHROPIC_API_URL", "https://api.anthropic.com").rstrip("/")
MODEL = os.environ.get("TRANSLATE_MODEL", "").strip() or "claude-sonnet-5-5"
MAX_SEGMENTS = int(os.environ.get("TRANSLATE_MAX_SEGMENTS", "80"))  # 1 回の実行で翻訳する上限
DRY_RUN = os.environ.get("TRANSLATE_DRY_RUN", "") not in ("", "0", "false")

# ---------------------------------------------------------------------------
# どこを翻訳するか： (日本語の項目, 英語の項目, 形式, 翻訳者への説明)
#   形式 … text = ただの文字 / html = HTML / markdown = [文字](URL) のリンクを含むことがある文字
#   "@body" はファイルの本文（先頭の --- と --- の間ではなく、その下の部分）
# ---------------------------------------------------------------------------
POSTS = [
    ("title", "title_en", "text", "headline of a lab news post"),
    ("@body", "body_en", "html", "body of the same lab news post"),
]
PAGES = {
    "research/index.html": [
        ("@body", "body_en", "html", "main text of the Research page"),
        ("societies", "societies_en", "text", "list of academic societies the lab head belongs to"),
    ],
    "access/index.html": [("@body", "body_en", "html", "main text of the Access page (address, directions)")],
    "papers/index.html": [("@body", "body_en", "html", "introduction of the Papers page")],
}
LISTS = {
    "_data/links.yml": [
        ("name", "name_en", "text", "name of a university, institute, lab or project on the Links page; use its official English name"),
        ("note", "note_en", "markdown", "casual one-line note about that link"),
    ],
    "_data/outreach.yml": [("name", "name_en", "text", "label of a link (website, video, outreach programme)")],
    "_data/awards.yml": [("award", "award_en", "text", "award entry in a formal list: award name, meeting, then the recipient in parentheses with grade and full name")],
    "_data/funding.yml": [("name", "name_en", "text", "research grant in a formal list; use the official English programme name")],
    "_data/members.yml": [
        ("note", "note_en", "text", "short note on a lab member's affiliation or fellowship"),
        ("theme", "theme_en", "text", "a lab member's research theme, written casually"),
    ],
    "_data/theses.yml": [("title", "title_en", "text", "title of a bachelor's or master's thesis (formal academic English)")],
    "_data/group_photos.yml": [("caption", "caption_en", "text", "casual caption of a group photo")],
    "_data/videos.yml": [
        ("ja", "en", "text", "title of a microscope video"),
        ("dja", "den", "text", "one-line description of that video"),
    ],
    "_data/papers_featured.yml": [("comment", "comment_en", "html", "the lab head's own commentary on one of his papers, first person")],
    "_data/social.yml": [("label", "label_en", "text", "label of a footer link")],
}
MAPS = {
    "_data/pi.yml": [
        ("title", "title_en", "text", "academic job title of the lab head"),
        ("message", "message_en", "text", "the lab head's one-line message"),
        ("field", "field_en", "text", "the lab head's research fields"),
        ("bio", "bio_en", "html", "the lab head's biography and teaching list"),
    ],
}

JA_CHARS = re.compile(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]")
UNSAFE_IN_BLOCK = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x85\u2028\u2029\ufeff]")


# ---------------------------------------------------------------------------
# 小さな道具
# ---------------------------------------------------------------------------
def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8", newline="") as f:
        return f.read()


def write(path, text):
    with open(os.path.join(ROOT, path), "w", encoding="utf-8", newline="") as f:
        f.write(text)


def visible(s):
    """タグや空白の違いを無視した「見える文字」だけを取り出す（変更の検出に使う）。"""
    s = re.sub(r"<[^>]+>", " ", str(s))
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def digest(s):
    return hashlib.sha1(visible(s).encode("utf-8")).hexdigest()[:16]


def load_state():
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            st = json.load(f)
        if isinstance(st.get("auto"), dict):
            return st
    except (OSError, ValueError):
        pass
    return {"auto": {}}


def save_state(state):
    state["auto"] = {k: sorted(set(v)) for k, v in sorted(state["auto"].items())}
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")


def needs_translation(ja, en, state):
    """英語が空、または「自動翻訳のままで、元の日本語が変わった」ときに True。"""
    if not isinstance(ja, str) or not visible(ja):
        return False
    if not isinstance(en, str) or not visible(en):
        return True
    sources = state["auto"].get(digest(en))
    return sources is not None and digest(ja) not in sources


# ---------------------------------------------------------------------------
# YAML を「必要な行だけ」書き換える（ほかの行の書式は変えない）
# ---------------------------------------------------------------------------
def indent_of(line):
    return len(line) - len(line.lstrip(" "))


def find_block(lines, start, end, indent, key):
    """lines[start:end] の中で、字下げ indent にあるキー key の範囲 (i, j) を返す。無ければ None。"""
    alts = [" " * indent]
    if indent >= 2:
        alts.append(" " * (indent - 2) + "- ")
    pat = re.compile(r"^(?:%s)%s:(?:\s|$)" % ("|".join(re.escape(a) for a in alts), re.escape(key)))
    for i in range(start, end):
        if pat.match(lines[i]):
            j = i + 1
            while j < end and (not lines[j].strip() or indent_of(lines[j]) > indent):
                j += 1
            while j - 1 > i and not lines[j - 1].strip():
                j -= 1
            return i, j
    return None


def render(prefix, indent, key, value):
    """key: value を YAML の行にする。複数行は | で、1 行は "…" で書く。"""
    pad = " " * indent
    rows = value.split("\n")
    multi = (
        len(rows) > 1
        and "\r" not in value
        and not UNSAFE_IN_BLOCK.search(value)
        and rows[0].strip()
        and rows[-1].strip()
        and all(not r[:1].isspace() for r in rows if r)
    )
    if multi:
        return ["%s%s: |-" % (prefix, key)] + [(pad + "  " + r) if r else "" for r in rows]
    quoted = json.dumps(value, ensure_ascii=False)
    quoted = quoted.replace("\x7f", "\\u007f").replace("\x85", "\\u0085").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029").replace("\ufeff", "\\ufeff")
    return ["%s%s: %s" % (prefix, key, quoted)]


def set_key(lines, start, end, indent, src_key, dst_key, value):
    """範囲 [start, end) のマッピングで dst_key を value にする。無ければ src_key のすぐ下に足す。"""
    found = find_block(lines, start, end, indent, dst_key)
    if found:
        i, j = found
        prefix = lines[i][:indent]
        return lines[:i] + render(prefix, indent, dst_key, value) + lines[j:]
    anchor = find_block(lines, start, end, indent, src_key) if src_key else None
    at = anchor[1] if anchor else end
    while at - 1 > start and not lines[at - 1].strip():
        at -= 1
    return lines[:at] + render(" " * indent, indent, dst_key, value) + lines[at:]


FRONT_MATTER = re.compile(r"\A---[ \t]*\r?\n(.*?\r?\n)---[ \t]*(?:\r?\n|\Z)", re.S)


def split_front_matter(text):
    m = FRONT_MATTER.match(text)
    if not m:
        return None, None
    return m.group(1), text[m.end():]


def list_item_ranges(lines):
    """トップレベルが「- 」で始まる一覧の、各項目の行範囲。"""
    starts = [i for i, l in enumerate(lines) if l.startswith("- ") or l.rstrip() == "-"]
    return [(s, (starts[k + 1] if k + 1 < len(starts) else len(lines))) for k, s in enumerate(starts)]


# ---------------------------------------------------------------------------
# 翻訳が必要な項目を集める
# ---------------------------------------------------------------------------
class Job(object):
    def __init__(self, path, shape, index, src_key, dst_key, typ, desc, src, label):
        self.path, self.shape, self.index = path, shape, index
        self.src_key, self.dst_key, self.typ, self.desc = src_key, dst_key, typ, desc
        self.src, self.label = src, label
        self.result = None


def collect(state):
    jobs, problems = [], []

    def consider(path, shape, index, data, body, spec, label):
        for src_key, dst_key, typ, desc in spec:
            src = body if src_key == "@body" else (data or {}).get(src_key)
            if isinstance(src, str) and src_key == "@body":
                src = re.sub(r"<!--.*?-->", "", src, flags=re.S).strip()   # <!-- メモ --> は翻訳しない
            if needs_translation(src, (data or {}).get(dst_key), state):
                if typ == "html" and path.endswith((".md", ".markdown")):
                    typ = "markdown"
                jobs.append(Job(path, shape, index, src_key, dst_key, typ, desc, src, label))

    for full in sorted(glob.glob(os.path.join(ROOT, "_posts", "*"))):
        path = os.path.relpath(full, ROOT).replace(os.sep, "/")
        if not path.endswith((".html", ".md", ".markdown")):
            continue
        try:
            fm, body = split_front_matter(read(path))
            data = yaml.safe_load(fm) if fm is not None else None
        except yaml.YAMLError as e:
            problems.append("%s: 読み込めません (%s)" % (path, str(e).split("\n")[0]))
            continue
        if isinstance(data, dict):
            consider(path, "front", None, data, body, POSTS, str(data.get("title", path)))

    for path, spec in PAGES.items():
        if not os.path.exists(os.path.join(ROOT, path)):
            continue
        try:
            fm, body = split_front_matter(read(path))
            data = yaml.safe_load(fm) if fm is not None else None
        except yaml.YAMLError as e:
            problems.append("%s: 読み込めません (%s)" % (path, str(e).split("\n")[0]))
            continue
        if isinstance(data, dict):
            consider(path, "front", None, data, body, spec, path)

    for path, spec in LISTS.items():
        if not os.path.exists(os.path.join(ROOT, path)):
            continue
        try:
            data = yaml.safe_load(read(path))
        except yaml.YAMLError as e:
            problems.append("%s: 読み込めません (%s)" % (path, str(e).split("\n")[0]))
            continue
        if isinstance(data, list):
            for i, item in enumerate(data):
                if isinstance(item, dict):
                    consider(path, "list", i, item, None, spec, "%s #%d" % (path, i + 1))

    for path, spec in MAPS.items():
        if not os.path.exists(os.path.join(ROOT, path)):
            continue
        try:
            data = yaml.safe_load(read(path))
        except yaml.YAMLError as e:
            problems.append("%s: 読み込めません (%s)" % (path, str(e).split("\n")[0]))
            continue
        if isinstance(data, dict):
            consider(path, "map", None, data, None, spec, path)

    return jobs, problems


# ---------------------------------------------------------------------------
# 翻訳（Claude API）
# ---------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, code, detail):
        Exception.__init__(self, "HTTP %s: %s" % (code, detail))
        self.code, self.detail = code, detail


def http_json(url, key, payload=None, timeout=300):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers={"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"},
    )
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:600]
            last = ApiError(e.code, detail)
            if e.code not in (408, 429, 500, 502, 503, 504, 529):
                raise last
        except (urllib.error.URLError, OSError) as e:  # 通信エラー・タイムアウト
            last = ApiError("network", str(e))
        if attempt < 3:
            time.sleep(5 * 2 ** attempt)
    raise last


def newest_model_like(model, key):
    """指定のモデルが引退していたら、同じ系列（sonnet など）のいちばん新しいモデルを探す。"""
    family = next((f for f in ("haiku", "sonnet", "opus") if f in model), None)
    if not family:
        return None
    try:
        listing = http_json(API_URL + "/v1/models?limit=100", key, timeout=60)
        for m in listing.get("data", []):
            if family in str(m.get("id", "")):
                return m["id"]
    except Exception:  # noqa: BLE001  ここで失敗しても、元のエラーを知らせれば十分
        pass
    return None


def ask_claude(system, user, key):
    global MODEL
    payload = {"model": MODEL, "max_tokens": 16000, "system": system, "messages": [{"role": "user", "content": user}]}
    try:
        data = http_json(API_URL + "/v1/messages", key, payload)
    except ApiError as e:
        newer = newest_model_like(MODEL, key) if e.code == 404 else None
        if not newer or newer == MODEL:
            raise
        print("モデル %s は使えなくなっていたので、%s を使います。" % (MODEL, newer))
        MODEL = payload["model"] = newer
        data = http_json(API_URL + "/v1/messages", key, payload)
    text = "".join(b.get("text", "") for b in data.get("content", []) if isinstance(b, dict) and b.get("type") == "text")
    return text, data.get("usage", {})


def glossary_text():
    people, terms = [], []

    def person(ja, en, role):
        if isinstance(ja, str) and isinstance(en, str) and ja.strip() and en.strip() and ja.strip() != en.strip():
            line = "%s = %s (%s)" % (ja.strip(), en.strip(), role)
            if line not in people:
                people.append(line)

    def load(path):
        try:
            return yaml.safe_load(read(path))
        except (OSError, yaml.YAMLError):
            return None

    pi = load("_data/pi.yml") or {}
    if isinstance(pi, dict):
        person(pi.get("name"), pi.get("name_en"), "lab head, the author of the site")
    for m in load("_data/members.yml") or []:
        if isinstance(m, dict):
            person(m.get("name"), m.get("name_en"), "current lab member")
    for t in load("_data/theses.yml") or []:
        if isinstance(t, dict):
            person(t.get("name"), t.get("name_en"), "lab alumnus/alumna")
    for g in load("_data/glossary.yml") or []:
        if isinstance(g, dict) and g.get("ja") and g.get("en"):
            note = " (%s)" % g["note"] if g.get("note") else ""
            terms.append("%s = %s%s" % (str(g["ja"]).strip(), str(g["en"]).strip(), note))
    # リンク一覧にすでにある英語名（大学・研究室の正式名や、共同研究者の名前の読み）も手がかりにする
    for l in load("_data/links.yml") or []:
        if isinstance(l, dict) and isinstance(l.get("name"), str) and isinstance(l.get("name_en"), str) and JA_CHARS.search(l["name"]) and l["name_en"].strip():
            terms.append("%s = %s" % (l["name"].strip(), l["name_en"].strip()))
    return people, terms


def system_prompt():
    people, terms = glossary_text()
    return "\n".join([
        "You translate text for the website of Nakane Lab at The University of Electro-Communications (UEC), Tokyo, from Japanese into English. The lab studies how and why bacteria move, using optical microscopy and microfluidic devices. Your translations are published on the lab's public website as they are, so they must be accurate, natural and complete.",
        "",
        "Voice",
        "- The site is written by the lab head, Daisuke Nakane, in a friendly, plain, lightly playful voice. Keep that voice: \"we\" for the lab, \"I\" where he clearly speaks for himself.",
        "- Translate what is there. Keep each translation about as long as its source. Do not add explanations, notes or facts, and do not leave anything out.",
        "",
        "Names",
        "- Lab members and alumni are listed below with the Japanese name (family name first) and the English name (given name first).",
        "- In news posts, captions and other casual text, call them by given name only, with no honorific: 佐藤くん -> Atsuya, 長坂さん -> Moyu, 中根 -> Daisuke. In formal lists (awards, thesis lists, grants) write the full name, given name first: Atsuya Sato.",
        "- Two people in the list share the given name Naoki. 上村 is plain \"Naoki\"; 小倉 is always \"Naoki Ogura\". When both appear in one sentence, write \"Naoki Uemura\" and \"Naoki Ogura\". Do the same for any other pair with the same given name.",
        "- A lab name keeps the family name: 中根研 / 中根研究室 -> \"the Nakane Lab\".",
        "- People who are not in the list or the glossary: family name only, in Hepburn romanization. Write \"Prof. Family-name\" when the Japanese says 先生 or 教授. Never guess a given name.",
        "- Use the official English name of a university, institute, society, journal or funding programme when you know it.",
        "",
        "Markup",
        "- type=\"html\": keep every tag and every attribute exactly as it is, in the same order, with the same src and href values. Translate only the text a reader sees. The one change you may make is to put <em>...</em> around a Latin genus or species name.",
        "- type=\"markdown\": keep the Markdown syntax and every URL unchanged; translate the link text.",
        "- type=\"text\": plain text on one line, with no markup.",
        "- Keep numbers, dates such as 2026.10.09, units, URLs and Latin species names as they are.",
        "",
        "Style examples from the site",
        "- 上村くんがCHRO2026で口頭発表をしました -> Naoki gave an oral presentation at CHRO2026",
        "- 細菌学会関東支部会で佐藤くんと長坂さんが発表しました。 -> Atsuya and Moyu presented at the Kanto Branch Meeting of the Japanese Society for Bacteriology",
        "",
        "People",
    ] + (["- " + p for p in people] or ["- (none listed)"]) + [
        "",
        "Glossary (always use these renderings)",
    ] + (["- " + t for t in terms] or ["- (none listed)"]) + [
        "",
        "Format",
        "The user message holds one or more segments, each written as <seg id=\"N\" type=\"...\" kind=\"...\">Japanese source</seg>. The kind attribute says what the segment is; it is not part of the text.",
        "Reply with exactly one <seg id=\"N\">English translation</seg> for every segment, in the same order, and nothing else.",
    ])


SEG_OUT = re.compile(r"<seg id=\"(\d+)\">(.*?)</seg>", re.S)


def attr_values(s, name):
    return sorted(html.unescape(v) for v in re.findall(r"\b%s\s*=\s*\"([^\"]*)\"" % name, s))


INLINE_TAGS = {"em", "i", "b", "strong", "u", "span", "sup", "sub", "br"}


def structure(s):
    """段落・画像・リンクなどの骨組み（太字や斜体などの飾りは数えない）。"""
    return sorted(t.lower() for t in re.findall(r"<\s*([a-zA-Z][a-zA-Z0-9]*)", s) if t.lower() not in INLINE_TAGS)


def accept(job, out):
    """翻訳結果の点検。問題があれば理由を返す（その項目は書き込まない）。"""
    if not visible(out):
        return "空の結果"
    if job.typ == "html":
        if attr_values(job.src, "src") != attr_values(out, "src") or attr_values(job.src, "href") != attr_values(out, "href"):
            return "画像やリンクの指定が元と違う"
        if structure(job.src) != structure(out):
            return "HTML タグの構成が元と違う"
    if job.typ == "markdown":
        if sorted(re.findall(r"\]\(([^)\s]+)", job.src)) != sorted(re.findall(r"\]\(([^)\s]+)", out)):
            return "リンクの URL が元と違う"
    if job.typ == "text" and "\n" in out.strip():
        return "1 行のはずが複数行になった"
    vis = visible(out)
    if len(JA_CHARS.findall(vis)) > 0.3 * max(1, len(vis)):
        return "日本語のまま返ってきた"
    return None


def translate(batch, key, system):
    user = "\n".join('<seg id="%d" type="%s" kind="%s">%s</seg>' % (n, j.typ, j.desc.replace('"', "'"), j.src) for n, j in enumerate(batch, 1))
    text, usage = ask_claude(system, user, key)
    found = {int(n): body.strip() for n, body in SEG_OUT.findall(text)}
    rejected = []
    for n, job in enumerate(batch, 1):
        out = found.get(n)
        if out is None:
            rejected.append((job, "返事にこの項目が無い"))
            continue
        if job.typ == "text":
            out = html.unescape(out)
        why = accept(job, out)
        if why:
            rejected.append((job, why))
        else:
            job.result = out
    return usage, rejected


def batches(jobs):
    """同じファイルの項目をまとめて 1 回で頼む（記事はタイトルと本文を一緒に）。"""
    out, cur, size = [], [], 0
    for j in jobs:
        if cur and (j.path != cur[0].path or len(cur) >= 12 or size + len(j.src) > 9000):
            out.append(cur)
            cur, size = [], 0
        cur.append(j)
        size += len(j.src)
    if cur:
        out.append(cur)
    return out


# ---------------------------------------------------------------------------
# 結果をファイルに書き込む（書いたあとで、ほかの内容が変わっていないことを確かめる）
# ---------------------------------------------------------------------------
def apply_to_file(path, done):
    original = read(path)
    shape = done[0].shape
    if shape == "front":
        m = FRONT_MATTER.match(original)
        fm, body = m.group(1), original[m.end():]
        before = yaml.safe_load(fm)
        lines = fm.split("\n")
        for j in done:
            end = len(lines) - 1 if lines and lines[-1] == "" else len(lines)
            lines = set_key(lines, 0, end, 0, None if j.src_key == "@body" else j.src_key, j.dst_key, j.result)
        new_fm = "\n".join(lines)
        new_text = original[: m.start(1)] + new_fm + original[m.end(1):]
        after = yaml.safe_load(new_fm)
        expected = copy.deepcopy(before)
        for j in done:
            expected[j.dst_key] = j.result
        ok = after == expected and split_front_matter(new_text)[1] == body
    else:
        before = yaml.safe_load(original)
        lines = original.split("\n")
        for j in done:
            if shape == "list":
                ranges = list_item_ranges(lines)
                if len(ranges) != len(before):
                    lines = ["?"]  # 行単位では直せない形。下の「全体を書き直す」に任せる
                    break
                start, end = ranges[j.index]
                lines = set_key(lines, start, end, 2, j.src_key, j.dst_key, j.result)
            else:
                end = len(lines) - 1 if lines and lines[-1] == "" else len(lines)
                lines = set_key(lines, 0, end, 0, j.src_key, j.dst_key, j.result)
        new_text = "\n".join(lines)
        try:
            after = yaml.safe_load(new_text)
        except yaml.YAMLError:
            after = None
        expected = copy.deepcopy(before)
        for j in done:
            (expected[j.index] if shape == "list" else expected)[j.dst_key] = j.result
        ok = after == expected
        if not ok:
            # 1 行に { … } で書かれた項目など、行単位で直せない書き方のとき：ファイル全体を書き直す（コメントは消えます）
            new_text = yaml.safe_dump(expected, allow_unicode=True, sort_keys=False, width=100000, default_flow_style=False)
            ok = yaml.safe_load(new_text) == expected
    if not ok:
        return False
    write(path, new_text)
    return True


# ---------------------------------------------------------------------------
def report(lines):
    text = "\n".join(lines)
    print(text)
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    if target:
        with open(target, "a", encoding="utf-8") as f:
            f.write(text.replace("\n", "  \n") + "\n")


def main():
    state = load_state()
    jobs, problems = collect(state)
    for p in problems:
        print("注意: " + p)

    # 日本語を含まない項目（英語やローマ字だけ）は、そのまま英語欄に写す
    for j in jobs:
        if not JA_CHARS.search(visible(j.src)):
            j.result = j.src
    todo = [j for j in jobs if j.result is None]

    if not jobs:
        report(["英語が空の項目はありませんでした。翻訳するものはありません。"])
        return 0

    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if todo and (DRY_RUN or not key):
        head = "確認だけの実行です。" if DRY_RUN else "ANTHROPIC_API_KEY が設定されていないので、翻訳は行いませんでした。"
        report([head, "英語が空（または日本語が書き直された）項目: %d 件" % len(todo)] + ["- %s → %s" % (j.label, j.dst_key) for j in todo[:40]])
        todo = []

    if len(todo) > MAX_SEGMENTS:
        print("項目が多いので、今回は %d 件だけ翻訳します（残り %d 件は次回）。" % (MAX_SEGMENTS, len(todo) - MAX_SEGMENTS))
        todo = todo[:MAX_SEGMENTS]

    failed, rejected_all, tokens_in, tokens_out = None, [], 0, 0
    if todo:
        system = system_prompt()
        for batch in batches(todo):
            try:
                usage, rejected = translate(batch, key, system)
            except ApiError as e:
                failed = e
                break
            tokens_in += int(usage.get("input_tokens", 0) or 0)
            tokens_out += int(usage.get("output_tokens", 0) or 0)
            rejected_all += rejected

    written, skipped = [], []
    by_file = {}
    for j in jobs:
        if j.result is not None and not DRY_RUN:
            by_file.setdefault(j.path, []).append(j)
    for path, done in by_file.items():
        if apply_to_file(path, done):
            for j in done:
                written.append(j)
                state["auto"].setdefault(digest(j.result), []).append(digest(j.src))
        else:
            skipped.append(path)
    if written:
        save_state(state)

    lines = []
    if written:
        lines.append("英語を自動で入れました: %d 件（モデル %s、入力 %d / 出力 %d トークン）" % (len(written), MODEL, tokens_in, tokens_out))
        lines += ["- %s → %s" % (j.label, j.dst_key) for j in written[:60]]
    for job, why in rejected_all:
        lines.append("- 見送り: %s → %s（%s）。英語欄は空のままです。" % (job.label, job.dst_key, why))
    for path in skipped:
        lines.append("- 書き込みを中止: %s（安全確認に通りませんでした。ファイルは元のままです）" % path)
    if failed:
        lines.append("")
        lines.append("翻訳サービスでエラーが起きました: %s" % failed)
        detail = str(failed.detail).lower()
        if failed.code == 401:
            lines.append("→ API キーが正しくないようです。リポジトリの Secret「ANTHROPIC_API_KEY」を確認してください。")
        elif "credit balance" in detail or "billing" in detail:
            lines.append("→ Claude API のクレジット残高が足りないようです。Claude Console の Billing で残高を確認してください。")
        elif failed.code == 404:
            lines.append("→ 指定したモデル（%s）が使えません。.github/workflows/auto-translate.yml の TRANSLATE_MODEL を新しいモデル名に変えてください。" % MODEL)
        lines.append("英語が入らなかった項目は、サイトでは日本語のまま表示されます。")
    if lines:
        report(lines)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
