import './style.css';
import { days, screenings } from './screenings.js';

const list = document.querySelector('#screening-list');
const filter = document.querySelector('#day-filter');

function card(film) {
  const times = film.times.map(slot => `<li><span class="font-medium text-slate-900">${slot.day}</span> <span class="text-slate-600">${slot.time}</span></li>`).join('');
  return `<li class="rounded-lg border border-slate-200 bg-white p-6 shadow-sm" id="film-${film.id}">
    <h3 class="font-display text-lg font-semibold">${film.title}</h3>
    <p class="mt-1 text-sm text-slate-500">${film.director}, ${film.year}</p>
    <ul class="mt-4 space-y-1 text-sm">${times}</ul>
  </li>`;
}

function show(day) {
  const shown = day === 'All' ? screenings : screenings.filter(film => film.times.some(slot => slot.day === day));
  list.innerHTML = shown.map(card).join('');
  for (const button of filter.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.day === day));
}

filter.innerHTML = ['All', ...days].map(day => `<button type="button" data-day="${day}" aria-pressed="false"
  class="rounded-full border border-slate-300 px-4 py-1.5 text-sm text-slate-700 hover:border-brand hover:text-brand aria-pressed:border-brand aria-pressed:bg-brand aria-pressed:text-white">${day}</button>`).join('');
filter.addEventListener('click', event => {
  const button = event.target.closest('button[data-day]');
  if (button) show(button.dataset.day);
});
show('All');

document.querySelector('#membership-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  document.querySelector('#membership-status').textContent = `Thank you, ${form.get('name')}. We will write to ${form.get('email')} with your membership details.`;
});
