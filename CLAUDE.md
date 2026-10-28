# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Answer user
- luôn trả lời bằng tiếng việt


## Project

A static web app for drilling the SPM (Software Project Management) multiple-choice question bank. No build step and no server: open `index.html` directly in a browser.

- `extract.py` reads `SPM-Question Bank - multiple choices.pdf` with PyMuPDF and writes `questions.json` plus `questions.js` (the same data as `window.QUESTIONS`, so the page works over `file://`).
- `index.html`, `app.js` and `style.css` make up the quiz UI. Progress is stored in `localStorage` under the key `spm-quiz-v1`.
- The home screen lists an "all questions" card plus sets of 10 (`SET_SIZE`) in document order (by `id`). The learned set is shared across all cards, while each card keeps its own order setting and round. `load()` migrates older saved formats, so keep that path working when the stored shape changes.

## Commands

- Install the dependency: `py -m pip install pymupdf`
- Regenerate the data: `py -W ignore extract.py` (set `PYTHONIOENCODING=utf-8` in Git Bash). It prints the merged duplicates, relabeled questions and any questions without exactly one highlight.

## How extraction works

- The correct answer is the option line covered by a yellow filled rectangle (`fill ≈ (1,1,0)` in `page.get_drawings()`), not an annotation.
- Question lines are usually bold. A non-bold line without an option label starts a new question unless the previous option line was long enough to have wrapped (`WRAP_X`).
- Duplicates are merged when the question texts differ only by words in `FILLER` and the option sets are similar. If the keys conflict, both copies are kept and each gets a note.
- Answers suspected to be wrong keep the key from the document and get a `note` from the `NOTES` list in `extract.py`.
- Questions with no highlight are left out and reported. Never guess an answer.
