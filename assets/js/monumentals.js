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
      lines: run.text,
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

  // Autocomplete terms come only from runner names and primary-run lines, so
  // page copy and descriptions never become suggestions. Each term keeps the
  // runs it came from, letting the selected challenge narrow the suggestions.
  const bossPattern = /\b(?:Vanguard|Phalanx|Tower Knight|Penetrator|Armou?r(?:ed)? Spider|Flamelurker|Dragon God|Fool'?s Idol|Maneaters?|Old Monk|Adjudicator|Old Hero|Storm King|Leechmonger|Dirty Colossus|Maiden Astraea|(?:True |False )?King Allant|both Allants)\b/gi;
  const restrictionPattern = /^(?:No\b|PBWT\b|Buffs\b|.*\bonly\b)/i;
  const wholeChallenge = new RegExp(`^(?:${challengePattern.source})$`, 'i');
  const suggestionTypes = ['Runner', 'Challenge', 'Boss', 'Restriction'];
  const suggestions = new Map();

  function addSuggestion(text, type, runs) {
    const label = normalize(text);
    if (!label) return;
    const key = label.toLocaleLowerCase();
    const entry = suggestions.get(key);
    if (!entry) {
      suggestions.set(key, { label, key, type, runs: new Set(runs) });
      return;
    }
    runs.forEach(run => entry.runs.add(run));
    if (suggestionTypes.indexOf(type) < suggestionTypes.indexOf(entry.type)) entry.type = type;
  }

  // Split on commas outside parentheses: "No Hyper (Except Maneaters, FKA)" stays whole.
  function splitList(text) {
    const parts = [''];
    let depth = 0;
    for (const char of text) {
      if (char === '(') depth++;
      else if (char === ')') depth = Math.max(0, depth - 1);
      if (char === ',' && !depth) parts.push('');
      else parts[parts.length - 1] += char;
    }
    return parts.map(part => normalize(part).replace(/[;:.]+$/, ''));
  }

  cards.forEach(card => {
    addSuggestion(card.name, 'Runner', card.runs);
    card.runs.forEach(run => run.lines.forEach(line => {
      for (const match of line.matchAll(challengePattern)) addSuggestion(match[0], 'Challenge', [run]);
      for (const match of line.matchAll(bossPattern)) addSuggestion(match[0], 'Boss', [run]);
      line.replace(/^[•↪]\s*/, '').replace(/^Variation:\s*/i, '')
        .split(/\s+-\s+/).flatMap(splitList)
        .filter(part => restrictionPattern.test(part) && !wholeChallenge.test(part))
        .forEach(part => addSuggestion(part, 'Restriction', [run]));
    }));
  });

  // Prefix matches first, then matches at a word start, then any other match;
  // within each tier runners, challenges and bosses come before restrictions.
  function suggestionsFor(query) {
    if (!query) return [];
    const ranked = [];
    suggestions.forEach(entry => {
      const at = entry.key.indexOf(query);
      if (at < 0) return;
      if (challenge.value && ![...entry.runs].some(run => run.challenges.has(challenge.value))) return;
      ranked.push({ entry, rank: at === 0 ? 0 : /[\s(/'-]/.test(entry.key[at - 1]) ? 1 : 2 });
    });
    return ranked
      .sort((a, b) => a.rank - b.rank ||
        suggestionTypes.indexOf(a.entry.type) - suggestionTypes.indexOf(b.entry.type) ||
        collator.compare(a.entry.label, b.entry.label))
      .slice(0, 8)
      .map(item => item.entry);
  }

  const listbox = document.createElement('ul');
  listbox.id = 'monumental-suggestions';
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', 'Search suggestions');
  listbox.hidden = true;
  search.parentElement.classList.add('monumental-search');
  search.parentElement.appendChild(listbox);
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-autocomplete', 'list');
  search.setAttribute('aria-controls', listbox.id);
  search.setAttribute('aria-expanded', 'false');
  search.setAttribute('autocomplete', 'off');

  let shown = [];
  let active = -1;

  function closeSuggestions() {
    listbox.hidden = true;
    listbox.replaceChildren();
    shown = [];
    active = -1;
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
  }

  function openSuggestions() {
    shown = suggestionsFor(normalize(search.value).toLocaleLowerCase());
    if (!shown.length) return closeSuggestions();
    active = -1;
    listbox.replaceChildren(...shown.map((entry, index) => {
      const option = document.createElement('li');
      option.id = `monumental-suggestion-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      const label = document.createElement('span');
      label.textContent = entry.label;
      const type = document.createElement('span');
      type.className = 'monumental-suggestion-type';
      type.textContent = entry.type;
      option.append(label, type);
      return option;
    }));
    listbox.hidden = false;
    search.setAttribute('aria-expanded', 'true');
    search.removeAttribute('aria-activedescendant');
  }

  function highlight(index) {
    active = index;
    [...listbox.children].forEach((option, i) => option.setAttribute('aria-selected', String(i === index)));
    const option = listbox.children[index];
    search.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  }

  function choose(index) {
    search.value = shown[index].label;
    closeSuggestions();
    update();
  }

  search.addEventListener('input', openSuggestions);
  search.addEventListener('blur', closeSuggestions);
  search.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (listbox.hidden) openSuggestions();
      if (listbox.hidden) return;
      event.preventDefault();
      const last = shown.length - 1;
      if (event.key === 'ArrowDown') highlight(active < 0 || active === last ? 0 : active + 1);
      else highlight(active <= 0 ? last : active - 1);
    } else if (event.key === 'Enter' && !listbox.hidden) {
      event.preventDefault();
      if (active >= 0) choose(active);
      else closeSuggestions();
    } else if (event.key === 'Escape' && !listbox.hidden) {
      // Close only; without this the browser would also clear the search field.
      event.preventDefault();
      closeSuggestions();
    }
  });
  // Keep focus on the input while an option is pressed, so blur does not close first.
  listbox.addEventListener('mousedown', event => event.preventDefault());
  listbox.addEventListener('click', event => {
    const option = event.target.closest('[role="option"]');
    if (option) choose([...listbox.children].indexOf(option));
  });
  document.addEventListener('pointerdown', event => {
    if (event.target !== search && !listbox.contains(event.target)) closeSuggestions();
  });

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
    closeSuggestions();
    update();
  });
  form.hidden = false;
  update();
})();
