"""Trích xuất câu hỏi trắc nghiệm từ PDF SPM sang questions.json + questions.js.

Đáp án đúng = lựa chọn có nền tô vàng (hình chữ nhật fill (1,1,0) trong PDF).
Chạy: py extract.py ["đường dẫn pdf"]
"""
import difflib
import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).parent
PDF = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "SPM-Question Bank - multiple choices.pdf"

OPTION_RE = re.compile(r"^([A-Ea-e])\.\s*(.*)$")
JUNK_RE = re.compile(r"messages\.|lOMoARcPSD|studeersnel", re.I)
WRAP_X = 470  # dòng lựa chọn kết thúc xa hơn mốc này thì dòng sau là phần tiếp theo
# Từ nối được bỏ qua khi so hai câu hỏi có trùng nhau không
FILLER = set("a an n the of to is are be will need needs which these this following".split())

# Đáp án nghi sai: giữ key tài liệu, hiển thị ghi chú sau khi trả lời.
NOTES = [
    ("Auditing is activity of",
     "Key tài liệu là Testing, nhưng theo lý thuyết Auditing (configuration audit) thuộc SCM."),
    ("The software equation can be used to show that",
     "Key tài liệu là 'Any deadline can be met by increasing team size', nhưng đúng ra là 'Cost may become prohibitive with schedule compression'."),
    ("What is the preferred order for performing testing",
     "Key tài liệu đặt UAT trước system testing, nhưng thứ tự chuẩn là unit → integration → system → UAT."),
    ("management involves generating, collecting, disseminating, and storing",
     "Key tài liệu là resource, nhưng định nghĩa này là Project communications management."),
    ("project management software integrates information from multiple projects",
     "Key tài liệu là Budget, nhưng đúng ra là Enterprise project management software."),
    ("What is the present value if the organization expects to make $100,000",
     "Key tài liệu là $100,000. Tính đúng: 100,000 / 1.06^4 ≈ $79,209 — không lựa chọn nào khớp."),
    ("If the project time and cost are not as important as the number of resources",
     "Key tài liệu là Fast track, nhưng đúng ra là Perform resource leveling."),
    ("Which of the following is NOT a main element of the project management activities",
     "Key tài liệu là Estimate, nhưng Design mới không phải hoạt động quản lý dự án."),
    ("not a fundamental activity for software processes",
     "Key tài liệu là Software Validation, nhưng Validation là hoạt động cơ bản (Sommerville); "
     "đáp án hợp lý hơn là Software Verification."),
    ("When should the scope be verified?",
     "Key tài liệu là 'at the beginning of each phase'; nghi ngờ — scope thường được verify ở cuối mỗi phase."),
    ("A task set is a collection of",
     "Key tài liệu là 'milestones, deliverables, metrics', nhưng theo Pressman task set gồm engineering work tasks, milestones, deliverables."),
]


def load_lines(doc):
    """Trả về danh sách dòng (theo thứ tự đọc) kèm bbox, bold, highlight."""
    out = []
    for pno, page in enumerate(doc):
        if pno == 0:  # trang bìa
            continue
        yellow = [d["rect"] for d in page.get_drawings()
                  if d.get("fill") and d["fill"][0] > 0.9 and d["fill"][1] > 0.9 and d["fill"][2] < 0.3]
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                spans = [s for s in line["spans"] if s["text"].strip()]
                if not spans:
                    continue
                text = "".join(s["text"] for s in line["spans"]).strip()
                if JUNK_RE.search(text):
                    continue
                x0, y0, x1, y1 = line["bbox"]
                cy = (y0 + y1) / 2
                hl = any(r.y0 - 1 <= cy <= r.y1 + 1 and r.x0 - 2 <= x0 + 5 <= r.x1 for r in yellow)
                bold = all(("Bold" in s["font"]) or (s["flags"] & 16) for s in spans)
                out.append({"page": pno + 1, "text": text, "x1": x1, "bold": bold, "hl": hl})
    return out


def parse(lines):
    questions, cur, state = [], None, None  # state: "q" đang đọc câu hỏi, "o" đang đọc lựa chọn
    last_opt_x1 = 0
    for ln in lines:
        m = OPTION_RE.match(ln["text"])
        if m and cur is not None:
            cur["opts"].append({"label": m.group(1).upper(), "text": m.group(2).strip(), "hl": ln["hl"]})
            state, last_opt_x1 = "o", ln["x1"]
            continue
        if state == "o" and not ln["bold"] and last_opt_x1 > WRAP_X:
            # dòng bị ngắt của lựa chọn trước
            cur["opts"][-1]["text"] += " " + ln["text"]
            cur["opts"][-1]["hl"] |= ln["hl"]
            last_opt_x1 = ln["x1"]
            continue
        if state == "q":
            cur["q"] += " " + ln["text"]
            continue
        cur = {"q": ln["text"], "opts": [], "page": ln["page"]}
        questions.append(cur)
        state = "q"
    return questions


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def main():
    doc = pymupdf.open(PDF)
    raw = parse(load_lines(doc))
    problems, relabeled = [], []
    items = []
    for q in raw:
        qtext = re.sub(r"\s+", " ", q["q"]).strip()
        labels = [o["label"] for o in q["opts"]]
        expected = [chr(65 + i) for i in range(len(labels))]
        if labels != expected:
            relabeled.append((q["page"], qtext, labels))
        options = {}
        hl = []
        for lab, o in zip(expected, q["opts"]):
            options[lab] = re.sub(r"\s+", " ", o["text"]).strip()
            if o["hl"]:
                hl.append(lab)
        if len(options) < 2 or len(hl) != 1:
            problems.append((q["page"], qtext, list(options), hl))
            continue
        items.append({"question": qtext, "options": options, "answer": hl[0], "page": q["page"]})

    # Gộp câu trùng: câu hỏi chỉ khác nhau ở từ nối, bộ lựa chọn gần giống nhau.
    def similar(a, b):
        return difflib.SequenceMatcher(None, a, b).ratio() >= 0.85

    def same_question(a, b):
        diff = set(norm(a).split()) ^ set(norm(b).split())
        return not (diff - FILLER)

    def opt_key(it):
        return " | ".join(sorted(norm(v) for v in it["options"].values()))

    merged, conflicts, kept = [], [], []
    for it in items:
        k = next((k for k in kept
                  if same_question(k["question"], it["question"]) and similar(opt_key(k), opt_key(it))),
                 None)
        if k:
            if similar(norm(k["options"][k["answer"]]), norm(it["options"][it["answer"]])):
                merged.append((k["page"], it["page"], it["question"]))
                continue
            conflicts.append((k, it))
        kept.append(it)

    for k, it in conflicts:
        msg = ("Câu này xuất hiện 2 lần trong tài liệu với key khác nhau: "
               f"“{k['options'][k['answer']]}” và “{it['options'][it['answer']]}”.")
        k.setdefault("notes", []).append(msg)
        it.setdefault("notes", []).append(msg)

    unused = []
    for needle, note in NOTES:
        hits = [k for k in kept if needle.lower() in k["question"].lower()]
        if not hits:
            unused.append(needle)
        for k in hits:
            k.setdefault("notes", []).append(note)

    out = []
    for i, k in enumerate(kept, 1):
        rec = {"id": i, "question": k["question"], "options": k["options"], "answer": k["answer"]}
        if k.get("notes"):
            rec["note"] = " ".join(k["notes"])
        out.append(rec)

    data = json.dumps(out, ensure_ascii=False, indent=1)
    (ROOT / "questions.json").write_text(data, encoding="utf-8")
    (ROOT / "questions.js").write_text("window.QUESTIONS = " + data + ";\n", encoding="utf-8")

    print(f"Câu đọc được: {len(raw)} | hợp lệ: {len(items)} | sau gộp trùng: {len(out)}")
    print(f"\nĐã gộp {len(merged)} câu trùng:")
    for p1, p2, t in merged:
        print(f"  tr.{p1} = tr.{p2}: {t[:80]}")
    print(f"\nTrùng nhưng key khác nhau ({len(conflicts)}) — giữ cả hai, có note:")
    for k, it in conflicts:
        print(f"  tr.{k['page']}/{it['page']}: {it['question'][:80]}")
    print(f"\nĐánh lại nhãn ({len(relabeled)}):")
    for p, t, labs in relabeled:
        print(f"  tr.{p}: {t[:70]} {labs}")
    print(f"\nKHÔNG có đúng 1 highlight ({len(problems)}) — cần kiểm tra tay:")
    for p, t, opts, hl in problems:
        print(f"  tr.{p}: {t[:80]} | options={opts} highlight={hl}")
    if unused:
        print("\nNOTE không khớp câu nào:", unused)


if __name__ == "__main__":
    main()
