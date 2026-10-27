// The scripted player for the Night Shift Run Club comparison's clips (scripts/record-clips.mjs), on a phone's screen.
// Each scene runs in the page: `setup` opens a screen through the app's own tabs and is not recorded; `play` taps the
// app's own buttons and types into its own fields in real time. Nothing in either app is changed. Both arms open on
// their own sample data (the Qloo arm's #demo, the guess arm's #sample), as their captures did; the only words typed
// are the Qloo arm's own example for an oddity, from its field's placeholder.
export default {
  viewport: { width: 390, height: 844 },
  arms: {
    'with-qloo': {
      page: 'index.html#demo',
      poster: { scene: 0, at: 0.75 },
      scenes: [
        {
          name: 'the wall of every Thursday, and a run back as a flashback', seconds: 4,
          setup: async () => {
            document.querySelector('[role="tab"][data-tab="wall"]').click();
            window.scrollTo(0, 0);
            await window.__clip.sleep(300);
          },
          play: async () => {
            const clip = window.__clip, button = document.getElementById('flash-btn');
            await clip.sleep(500);
            button.scrollIntoView({ block: 'center', behavior: 'smooth' });
            await clip.sleep(700);
            button.click();
            await clip.sleep(1500);
            button.click();
            await clip.sleep(1100);
          },
        },
        {
          name: 'a pace plan read like a radio rundown', seconds: 4,
          setup: async () => {
            document.querySelector('[role="tab"][data-tab="plan"]').click();
            window.scrollTo(0, 0);
            await window.__clip.sleep(300);
          },
          play: async () => {
            const clip = window.__clip, pace = document.getElementById('plan-pace'), route = document.getElementById('plan-route');
            await clip.sleep(500);
            // Type a faster pace, digit by digit, and the rundown of kilometres and clock times rewrites itself.
            for (const value of ['', '5', '5:', '5:3', '5:30']) { pace.value = value; pace.dispatchEvent(new Event('input', { bubbles: true })); await clip.sleep(260); }
            await clip.sleep(700);
            if (route.value !== '10') { route.value = '10'; route.dispatchEvent(new Event('change', { bubbles: true })); }
            await clip.sleep(1300);
          },
        },
        {
          name: 'filing an oddity', seconds: 4,
          setup: async () => {
            document.querySelector('[role="tab"][data-tab="odd"]').click();
            window.scrollTo(0, 0);
            await window.__clip.sleep(300);
          },
          play: async () => {
            const clip = window.__clip, field = document.getElementById('odd-text');
            const words = field.getAttribute('placeholder') || '';
            await clip.sleep(400);
            field.focus();
            for (let i = 1; i <= words.length; i += 3) { field.value = words.slice(0, i); await clip.sleep(55); }
            field.value = words;
            await clip.sleep(400);
            document.getElementById('odd-form').requestSubmit();
            await clip.sleep(1400);
          },
        },
      ],
    },
    'without-qloo': {
      page: 'index.html#sample',
      poster: { scene: 1, at: 0.6 },
      scenes: [
        {
          name: 'a door that opens when you say you are coming', seconds: 4,
          setup: async () => {
            // The sample runner has already said yes; the door is shut first, and its note left to fade, so the scene
            // can open it.
            const door = document.getElementById('door-rsvp');
            if (door.getAttribute('aria-pressed') === 'true') { door.click(); await window.__clip.sleep(3000); }
            window.scrollTo(0, 0);
            await window.__clip.sleep(300);
          },
          play: async () => {
            const clip = window.__clip, door = document.getElementById('door-rsvp');
            await clip.sleep(500);
            door.scrollIntoView({ block: 'center', behavior: 'smooth' });
            await clip.sleep(700);
            door.click();
            await clip.sleep(2700);
          },
        },
        {
          name: 'sixteen Thursdays to light as a streak', seconds: 4,
          setup: async () => { location.hash = 'sample-loop'; await window.__clip.sleep(400); window.scrollTo(0, 0); },
          play: async () => {
            const clip = window.__clip, steps = [...document.querySelectorAll('#loop-grid .step')];
            await clip.sleep(400);
            steps[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            await clip.sleep(600);
            // Tap back through the last Thursdays, one square at a time, as a runner reads their streak.
            for (const step of steps.slice(-5).reverse()) { step.click(); await clip.sleep(520); }
          },
        },
        {
          name: 'a page turned back in the notebook', seconds: 4,
          setup: async () => { location.hash = 'sample-notebook'; await window.__clip.sleep(400); window.scrollTo(0, 0); },
          play: async () => {
            const clip = window.__clip, button = document.getElementById('turn-back');
            await clip.sleep(400);
            button.scrollIntoView({ block: 'center', behavior: 'smooth' });
            await clip.sleep(700);
            button.click();
            await clip.sleep(1400);
            button.click();
            await clip.sleep(1300);
          },
        },
      ],
    },
  },
};
