(() => {
  'use strict';

  const form = document.getElementById('monumental-filters');
  const list = document.querySelector('#two .features');
  if (!form || !list) return;

  const search = form.elements.search;
  const challenge = form.elements.challenge;
  const sort = form.elements.sort;
  const results = document.getElementById('monumental-results');
  const empty = document.getElementById('monumental-empty');
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

  // Read visible text in HTML lines, including nested spans and links.
  function lines(paragraph) {
    const output = [];
    let text = '';
    let dates = [];
    function flush() {
      if (normalize(text)) output.push({ text: normalize(text), date: dates.sort().pop() || null });
      text = '';
      dates = [];
    }
    function visit(node, inheritedDate = null) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
        if (inheritedDate) dates.push(inheritedDate);
      } else if (node.nodeName === 'BR') flush();
      else {
        const value = node.getAttribute('data-date');
        const date = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : inheritedDate;
        node.childNodes.forEach(child => visit(child, date));
      }
    }
    paragraph.childNodes.forEach(node => visit(node));
    flush();
    return output;
  }

  // Match complete challenge phrases, longest first, rather than searching the
  // whole card. Only labels actually encountered are added to the dropdowns.
  const challengePattern = /No Sprint\/Roll\/Block\/Parry|No Roll\/Block\/Parry|\+0 weapons|Bow Only|Broken Weapons?|Shield Only(?: \(Except Storm King\))?|Deathless(?: \(Full run\))?|No Hit \(Full run\)|NG\+5|No Sprint|Speediest Monumental/gi;
  function challengeLabels(text) {
    return [...text.matchAll(challengePattern)].map(match => {
      if (/^broken weapons?$/i.test(match[0])) return 'Broken Weapons';
      return match[0];
    });
  }

  function runsFor(card) {
    const runs = [];
    let current = null;
    for (const line of lines(card.querySelector('.inner p'))) {
      const text = line.text;
      // Keep restrictions, variations and boss entries with their primary run.
      // Their text is searchable, but never introduces challenge categories.
      if (text.startsWith('\u21aa')) {
        if (current) current.text.push(text);
        continue;
      }
      // Preserve the three existing unbulleted primary titles.
      const primary = text.startsWith('\u2022') ||
        /Speediest Monumental/i.test(text) || text === '+0 weapons';
      if (!primary) continue;
      current = { challenges: new Set(challengeLabels(text)), text: [text], date: line.date };
      runs.push(current);
    }
    return runs.map(run => ({
      challenges: run.challenges,
      date: run.date,
      searchText: normalize(run.text.join(' ')).toLocaleLowerCase()
    }));
  }

  const cards = [...list.querySelectorAll(':scope > article')].map((element, index) => {
    const dates = [element, ...element.querySelectorAll('[data-date]')]
      .map(node => node.getAttribute('data-date'))
      .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date || ''))
      .sort();
    const runs = runsFor(element);
    return {
      element, index,
      name: normalize(element.querySelector('h4').textContent),
      searchText: normalize(element.innerText).toLocaleLowerCase(),
      date: dates.length ? dates[dates.length - 1] : null,
      runs,
      challenges: new Set(runs.flatMap(run => [...run.challenges]))
    };
  });

  const labels = new Set();
  cards.forEach(card => card.challenges.forEach(label => labels.add(label)));
  [...labels].sort(collator.compare).forEach(label => challenge.add(new Option(label, label)));

  // Use primary-run dates for a selected challenge or matching run text.
  // Empty/card-only searches keep the existing aggregate card date.
  function dateFor(card, query = '') {
    let runs;
    if (challenge.value) {
      runs = card.runs.filter(run => run.challenges.has(challenge.value));
    } else {
      if (!query) return card.date;
      runs = card.runs.filter(run => run.searchText.includes(query));
      if (!runs.length) return card.date;
    }
    const dates = runs
      .filter(run => run.date)
      .map(run => run.date)
      .sort();
    return dates.length ? dates[dates.length - 1] : null;
  }

  function update() {
    const query = normalize(search.value).toLocaleLowerCase();
    const ordered = [...cards];
    if (sort.value === 'az' || sort.value === 'za') {
      ordered.sort((a, b) => (sort.value === 'za' ? -1 : 1) * collator.compare(a.name, b.name) || a.index - b.index);
    } else if (sort.value === 'newest' || sort.value === 'oldest') {
      const dates = new Map(cards.map(card => [card, dateFor(card, query)]));
      ordered.sort((a, b) => {
        const aDate = dates.get(a);
        const bDate = dates.get(b);
        if (!aDate || !bDate) return aDate ? -1 : bDate ? 1 : a.index - b.index;
        return (sort.value === 'newest' ? -1 : 1) * aDate.localeCompare(bDate) || a.index - b.index;
      });
    }
    let count = 0;
    ordered.forEach(card => {
      const matches = challenge.value
        ? card.runs.some(run => run.challenges.has(challenge.value) &&
          (card.name.toLocaleLowerCase().includes(query) || run.searchText.includes(query)))
        : card.searchText.includes(query);
      card.element.hidden = !matches;
      if (matches) count++;
      list.appendChild(card.element);
    });
    results.textContent = `${count} of ${cards.length} Monumentals`;
    empty.hidden = count !== 0;
  }

  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('reset', () => {
    search.value = '';
    challenge.value = '';
    sort.value = '';
    update();
  });
  form.hidden = false;
  update();
})();
