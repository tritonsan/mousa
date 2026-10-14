// What the live try asks Kiro, published with every entry it makes. The prediction session only freezes the model's
// own guess; the host measures. In a pair, both arms get the same request, model, tools and limits, and differ only
// in where their taste comes from. Pictures are off on the server, so imagery is drawn in SVG or CSS.

export const TRY_PROMPTS_VERSION = '1.0';

/** The prediction session: freeze the model's own guess for the planned domains, and nothing more. */
export function predictPrompt({ brief }) {
  return `You are Moûsa's agent for a live try on a hosted server. The request is at the end. Moûsa has already planned the taste questions for it, so do only this:

1. Call taste_profile with dryRun: true and no other field. It returns the saved plan and the domains your prediction must cover.
2. Before any Qloo data, write your own prediction of what this audience loves in each of those domains, three to six entries each, and the design you would make from that alone, as the taste-brief skill describes. Save it with design_validate({ stage: 'prediction', artifact }). If it is refused, repair what the message names and save it again.
3. Stop there. Do not measure the audience, design anything or write any file: the host measures the audience next.

The request:
${brief}`;
}

/** One arm of a pair: the Qloo arm reads the measured Taste Brief, the baseline arm its own prediction. */
export function armPrompt({ brief, arm }) {
  const taste = arm === 'qloo'
    ? '2. Call taste_profile({}) to read the Taste Brief. The audience was measured already, so it answers from the saved measurement with no new Qloo request.'
    : '2. Call taste_profile({ baseline: true }) to read your own frozen prediction as this design\'s taste input. This arm designs without Qloo: never measure.';
  return `You are Moûsa's agent for one arm of a live comparison on a hosted server: the design ${arm === 'qloo' ? 'made with what Qloo measured about the audience' : 'made from your own prediction alone, without Qloo'}. The other arm gets the same request, the same frozen prediction and the same stages. The plan and your prediction are saved in this project folder.

1. Call mousa_status.
${taste}
3. Follow the design skill from the reading to the last review round, building the design in this folder with your write tool. Pictures are off on this server, so draw imagery with SVG or CSS.
4. Finish with design_report({}).

Keep every fact the request states, and change no file the request does not ask you to design.

The request:
${brief}`;
}
