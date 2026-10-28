(function () {
  "use strict";

  const STORAGE_KEY = "spm-quiz-v1";
  const SET_SIZE = 10;
  const QUESTIONS = window.QUESTIONS || [];
  const byId = new Map(QUESTIONS.map((q) => [q.id, q]));

  // Bộ câu hỏi: "all" = toàn bộ, "1", "2", ... = từng 10 câu theo thứ tự tài liệu (id tăng dần).
  const docIds = QUESTIONS.map((q) => q.id).sort((a, b) => a - b);
  const SETS = [{ key: "all", name: `Tất cả ${docIds.length} câu`, ids: docIds }];
  for (let i = 0; i < docIds.length; i += SET_SIZE) {
    const ids = docIds.slice(i, i + SET_SIZE);
    SETS.push({ key: String(SETS.length), name: `Bộ ${SETS.length}`, ids });
  }
  const setByKey = new Map(SETS.map((s) => [s.key, s]));

  // state.learned: id các câu đã làm đúng (dùng chung cho mọi bộ)
  // state.sets[key]: { order, round } — round = { queue, pos, answers }; answers[id] là đáp án đã chọn
  //   (DUNNO = bấm "không biết"; "?" = đã làm sai nhưng không rõ chọn gì, dữ liệu chuyển từ bản cũ);
  //   pos === queue.length là màn tổng kết
  // state.view: "home" hoặc key của bộ đang làm
  const DUNNO = "-";
  let state = load();

  const $ = (id) => document.getElementById(id);

  function validRound(round) {
    return round && Array.isArray(round.queue) && round.queue.every((id) => byId.has(id)) ? round : null;
  }

  function load() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      saved = null;
    }
    saved = saved || {};
    const learned = new Set((Array.isArray(saved.learned) ? saved.learned : []).filter((id) => byId.has(id)));
    const sets = {};
    if (saved.sets && typeof saved.sets === "object") {
      for (const [key, s] of Object.entries(saved.sets)) {
        if (!setByKey.has(key) || !s) continue;
        const st = { order: s.order === "doc" ? "doc" : "random", orderChosen: !!s.orderChosen, round: validRound(s.round) };
        // Chưa từng tự chọn thứ tự thì theo mặc định hiện tại của bộ
        if (!st.orderChosen && st.order !== defaultOrder(key)) {
          st.order = defaultOrder(key);
          if (st.round) reorder(st.round, st.order);
        }
        sets[key] = st;
      }
    } else if (saved.round || saved.order) {
      // Bản cũ chỉ có một lượt cho toàn bộ câu hỏi
      let round = validRound(saved.round);
      if (round && !round.answers) round = migrate(round, learned);
      sets.all = { order: saved.order === "doc" ? "doc" : "random", orderChosen: true, round };
    }
    const view = setByKey.has(saved.view) ? saved.view : "home";
    return { learned, sets, view, shuffleOptions: !!saved.shuffleOptions };
  }

  // Bản cũ chỉ lưu đáp án của câu hiện tại; các câu trước đó suy ra từ danh sách đã thuộc.
  function migrate(old, learned) {
    const answers = {};
    old.queue.slice(0, old.pos).forEach((id) => {
      answers[id] = learned.has(id) ? byId.get(id).answer : "?";
    });
    if (old.choice && old.pos < old.queue.length) answers[old.queue[old.pos]] = old.choice;
    return { queue: old.queue, pos: old.pos, answers };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        learned: [...state.learned],
        sets: state.sets,
        view: state.view,
        shuffleOptions: state.shuffleOptions,
      }));
    } catch (e) {
      /* không lưu được (chế độ ẩn danh...) — vẫn chạy bình thường */
    }
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Bộ đang mở và trạng thái của nó
  function activeSet() {
    return setByKey.get(state.view);
  }

  // Bộ 10 câu mặc định theo thứ tự tài liệu, bộ "Tất cả" mặc định ngẫu nhiên
  function defaultOrder(key) {
    return key === "all" ? "random" : "doc";
  }

  function setState(key) {
    if (!state.sets[key]) state.sets[key] = { order: defaultOrder(key), orderChosen: false, round: null };
    return state.sets[key];
  }

  function learnedIn(set) {
    return set.ids.filter((id) => state.learned.has(id)).length;
  }

  // id được đánh theo thứ tự xuất hiện trong PDF, nên sắp theo id = thứ tự tài liệu
  function arrange(ids, order) {
    return order === "doc" ? ids.sort((a, b) => a - b) : shuffle(ids);
  }

  function newRound() {
    const set = activeSet();
    const st = setState(set.key);
    st.round = { queue: arrange(set.ids.filter((id) => !state.learned.has(id)), st.order), pos: 0, answers: {} };
    save();
    render();
  }

  // Đổi thứ tự giữa lượt: giữ kết quả đã làm, nhảy tới câu đầu tiên chưa làm.
  function reorder(r, order) {
    r.queue = arrange([...r.queue], order);
    const first = r.queue.findIndex((id) => !r.answers[id]);
    r.pos = first === -1 ? r.queue.length : first;
  }

  function setOrder(order) {
    const st = setState(state.view);
    st.order = order;
    st.orderChosen = true;
    reorder(st.round, order);
    save();
    render();
  }

  function openView(key) {
    state.view = key;
    save();
    render();
    window.scrollTo(0, 0);
  }

  function round() {
    return state.view === "home" ? null : setState(state.view).round;
  }

  function current() {
    const r = round();
    return r && r.pos < r.queue.length ? byId.get(r.queue[r.pos]) : null;
  }

  // Lựa chọn nhắc tới các lựa chọn khác ("All of them", "Both ...", "None ...") giữ nguyên vị trí khi đảo.
  const PINNED_RE = /^(all|both|none|neither)\b/i;

  // Thứ tự hiển thị các lựa chọn (danh sách nhãn gốc). Khi bật đảo đáp án, mỗi câu được đảo một lần
  // trong lượt và lưu ở r.optOrder để lùi lại / tải lại trang vẫn giữ nguyên.
  function displayOrder(q, r) {
    const labels = Object.keys(q.options);
    if (!state.shuffleOptions) return labels;
    r.optOrder = r.optOrder || {};
    const saved = r.optOrder[q.id];
    if (saved && saved.length === labels.length && saved.every((l) => l in q.options)) return saved;
    const movable = shuffle(labels.filter((l) => !PINNED_RE.test(q.options[l])));
    const order = labels.map((l) => (PINNED_RE.test(q.options[l]) ? l : movable.shift()));
    r.optOrder[q.id] = order;
    save();
    return order;
  }

  const letter = (i) => String.fromCharCode(65 + i);

  function counts(r) {
    let correct = 0;
    let wrong = 0;
    for (const id of r.queue) {
      const choice = r.answers[id];
      if (!choice) continue;
      if (choice === byId.get(id).answer) correct++;
      else wrong++;
    }
    return { correct, wrong, skipped: r.queue.length - correct - wrong };
  }

  function answer(label) {
    const q = current();
    const r = round();
    if (!q || r.answers[q.id] || !(label in q.options || label === DUNNO)) return;
    r.answers[q.id] = label;
    if (label === q.answer) state.learned.add(q.id);
    save();
    render();
  }

  function go(delta) {
    const r = round();
    if (!r) return;
    const pos = r.pos + delta;
    if (pos < 0 || pos > r.queue.length) return;
    r.pos = pos;
    save();
    render();
  }

  function renderLearnedMeter(learned, total) {
    $("learned-count").textContent = learned;
    $("total-count").textContent = total;
    $("learned-pct").textContent = total ? Math.round((learned / total) * 100) + "%" : "";
    $("learned-bar").style.width = total ? (learned / total) * 100 + "%" : "0";
  }

  function renderRoundMeter(r) {
    const c = counts(r);
    const done = c.correct + c.wrong;
    $("round-label").textContent = `Lượt này: đã làm ${done} / ${r.queue.length}`;
    $("round-score").textContent = `✓ ${c.correct}  ✗ ${c.wrong}`;
    $("round-bar").style.width = r.queue.length ? (done / r.queue.length) * 100 + "%" : "0";
  }

  function range(set) {
    return `Câu #${set.ids[0]}–#${set.ids[set.ids.length - 1]}`;
  }

  function cardStatus(set, learned) {
    if (learned === set.ids.length) return "✓ Đã thuộc hết";
    const r = state.sets[set.key] && state.sets[set.key].round;
    if (r && r.pos < r.queue.length && Object.keys(r.answers).length) {
      const c = counts(r);
      return `Đang làm: ${c.correct + c.wrong} / ${r.queue.length}`;
    }
    return learned ? "Chưa thuộc hết" : "Chưa làm";
  }

  function renderHome() {
    const grid = $("set-grid");
    grid.replaceChildren();
    for (const set of SETS) {
      const learned = learnedIn(set);
      const total = set.ids.length;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "set-card" + (set.key === "all" ? " all" : "") + (learned === total ? " done" : "");
      const parts = [
        ["name", set.name],
        ["range", set.key === "all" ? "Toàn bộ câu hỏi" : range(set)],
        ["count", `Đã thuộc ${learned} / ${total}`],
      ];
      for (const [cls, text] of parts) {
        const el = document.createElement("span");
        el.className = cls;
        el.textContent = text;
        card.append(el);
      }
      const bar = document.createElement("span");
      bar.className = "bar";
      const fill = document.createElement("span");
      fill.className = "fill learned";
      fill.style.display = "block";
      fill.style.width = (learned / total) * 100 + "%";
      bar.append(fill);
      const status = document.createElement("span");
      status.className = "status";
      status.textContent = cardStatus(set, learned);
      card.append(bar, status);
      card.addEventListener("click", () => openView(set.key));
      grid.append(card);
    }
  }

  function renderQuestion(q, r) {
    const choice = r.answers[q.id];
    $("q-meta").textContent = `Câu ${r.pos + 1} / ${r.queue.length} · #${q.id} trong tài liệu` + (choice ? " · đã làm" : "");
    $("q-text").textContent = q.question;

    const order = displayOrder(q, r);
    const list = $("q-options");
    list.replaceChildren();
    order.forEach((label, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.label = label;
      const lab = document.createElement("span");
      lab.className = "label";
      lab.textContent = letter(i) + ".";
      const body = document.createElement("span");
      body.textContent = q.options[label];
      btn.append(lab, body);
      btn.title = `Phím ${i + 1} hoặc ${letter(i)}`;
      if (choice) {
        btn.disabled = true;
        if (label === q.answer) btn.classList.add(choice === DUNNO ? "revealed" : "correct");
        else if (label === choice) btn.classList.add("wrong");
      } else {
        btn.addEventListener("click", () => answer(label));
      }
      li.append(btn);
      list.append(li);
    });

    $("btn-dunno").hidden = !!choice;
    $("feedback").hidden = !choice;
    if (choice) {
      const ok = choice === q.answer;
      const shown = letter(order.indexOf(q.answer));
      const verdict = $("verdict");
      verdict.className = "verdict " + (ok ? "ok-text" : "bad-text");
      verdict.textContent = ok
        ? "✓ Chính xác!"
        : choice === DUNNO
          ? `Đáp án đúng là ${shown}. Câu này sẽ quay lại ở lượt sau.`
          : `✗ Sai rồi — đáp án đúng là ${shown}.`;
      $("note").hidden = !q.note;
      $("note").textContent = q.note ? "Ghi chú: " + q.note : "";
    }

    const last = r.pos + 1 === r.queue.length;
    $("btn-prev").disabled = r.pos === 0;
    $("btn-next").textContent = last ? "Xem tổng kết →" : choice ? "Câu tiếp →" : "Bỏ qua →";
    $("btn-next").classList.toggle("primary", !!choice);
    if (choice) $("btn-next").focus();
  }

  function renderSummary(set, r) {
    const c = counts(r);
    const left = set.ids.length - learnedIn(set);
    const next = set.key === "all" ? null : setByKey.get(String(Number(set.key) + 1));
    $("s-correct").textContent = c.correct;
    $("s-wrong").textContent = c.wrong;
    $("s-skipped").textContent = c.skipped;
    $("s-left").textContent = left;
    $("s-message").textContent = left === 0
      ? `🎉 Bạn đã thuộc hết ${set.key === "all" ? "toàn bộ câu hỏi" : set.name}! Bấm "Reset" nếu muốn ôn lại từ đầu.`
      : `Còn ${left} câu chưa thuộc. Làm lại để ôn tiếp nhé.`;
    $("btn-again").hidden = left === 0;
    $("btn-back").hidden = r.queue.length === 0;
    $("btn-nextset").hidden = !next;
    if (next) $("btn-nextset").textContent = `Sang ${next.name} →`;
  }

  function render() {
    const home = state.view === "home";
    const set = activeSet();
    $("btn-home").hidden = home;
    $("set-actions").hidden = home;
    $("round-meter").hidden = home;
    $("page-title").textContent = home ? "Luyện trắc nghiệm SPM" : set.name;
    $("home").hidden = !home;

    if (home) {
      $("quiz").hidden = true;
      $("summary").hidden = true;
      renderLearnedMeter(state.learned.size, QUESTIONS.length);
      renderHome();
      return;
    }

    const st = setState(set.key);
    if (!st.round) return newRound();
    $("order").value = st.order;
    $("btn-shuffle-opts").setAttribute("aria-pressed", String(state.shuffleOptions));
    $("btn-shuffle-opts").textContent = "Đảo đáp án: " + (state.shuffleOptions ? "Bật" : "Tắt");
    $("btn-reset").textContent = set.key === "all" ? "Reset toàn bộ" : "Reset bộ này";
    renderLearnedMeter(learnedIn(set), set.ids.length);
    renderRoundMeter(st.round);
    const q = current();
    $("quiz").hidden = !q;
    $("summary").hidden = !!q;
    if (q) renderQuestion(q, st.round);
    else renderSummary(set, st.round);
  }

  $("btn-home").addEventListener("click", () => openView("home"));
  $("order").addEventListener("change", (e) => {
    setOrder(e.target.value);
    e.target.blur(); // trả phím mũi tên về cho việc chuyển câu
  });
  $("btn-shuffle-opts").addEventListener("click", () => {
    state.shuffleOptions = !state.shuffleOptions;
    save();
    render();
  });
  $("btn-dunno").addEventListener("click", () => answer(DUNNO));
  $("btn-prev").addEventListener("click", () => go(-1));
  $("btn-next").addEventListener("click", () => go(1));
  $("btn-back").addEventListener("click", () => go(-1));
  $("btn-again").addEventListener("click", newRound);
  $("btn-nextset").addEventListener("click", () => openView(String(Number(state.view) + 1)));
  $("btn-restart").addEventListener("click", newRound);
  $("btn-reset").addEventListener("click", () => {
    const set = activeSet();
    const msg = set.key === "all"
      ? "Xóa toàn bộ tiến độ (mọi bộ) và đưa tất cả câu hỏi quay lại?"
      : `Xóa tiến độ của ${set.name} và đưa ${set.ids.length} câu này quay lại?`;
    if (!confirm(msg)) return;
    if (set.key === "all") {
      state.learned.clear();
      for (const st of Object.values(state.sets)) st.round = null;
    } else {
      set.ids.forEach((id) => state.learned.delete(id));
    }
    newRound();
  });

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === "SELECT" || state.view === "home") return;
    const q = current();
    const answered = q && round().answers[q.id];
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      go(e.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (e.key === "Enter") {
      if (answered) {
        e.preventDefault();
        go(1);
      } else if (!q && !$("btn-again").hidden) {
        e.preventDefault();
        newRound();
      }
      return;
    }
    if (!q || answered) return;
    // Phím chọn theo vị trí đang hiển thị, đổi về nhãn gốc
    const order = displayOrder(q, round());
    let label = null;
    if (e.key === "0") label = DUNNO;
    else if (/^[1-5]$/.test(e.key)) label = order[Number(e.key) - 1];
    else if (/^[a-e]$/i.test(e.key)) label = order[e.key.toUpperCase().charCodeAt(0) - 65];
    if (label) {
      e.preventDefault();
      answer(label);
    }
  });

  if (!QUESTIONS.length) {
    document.getElementById("app").textContent = "Không tải được questions.js — hãy chạy extract.py trước.";
    return;
  }
  render();
})();
