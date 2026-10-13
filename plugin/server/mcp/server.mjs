import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { QlooClient, QlooError, QLOO_RESULT_TYPES, QLOO_SEARCH_TYPES } from '../qloo/client.mjs';
import { CultureBriefError, validateCultureBrief, compileCultureBrief } from '../culture/brief.mjs';
import { assessCreativeDecision, CulturePolicyError, CREATIVE_POLICY_TEXT, CREATIVE_DOMAINS, REFERENCE_POLICIES, REFERENCE_ROLES, REFERENCE_ORIGINS, DECISION_KINDS } from '../culture/policy.mjs';
import { TASTE_POLICY_TEXT, TASTE_DOMAINS, DEFAULT_TASTE_DOMAINS, TASTE_LIMITS, TasteProtocolError, buildTasteProfile, normalizeTasteAssumption, normalizeTasteDomains, tasteInputFromProfile,
  compactTasteInput, normalizeDesignSketch, designFingerprint, compareDesignFingerprints } from '../culture/taste.mjs';
import { PRODUCTION_POLICY_TEXT } from '../production/policy.mjs';
import { mediumProfile } from '../production/media.mjs';
import { normalizeTasteReading, applyReadingToDna } from '../production/reading.mjs';
import { PRODUCTION_TOOLS, MEDIUM_IDS, createProductionTools, tasteInputArgument, ProductionToolError, ProjectScopeError, ImageRequestError } from '../production/tools.mjs';
import { projectRoot, readProjectFiles } from '../production/project-files.mjs';

export const PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);
export const SERVER_VERSION = '0.4.0';
export const CREATIVE_PROTOCOLS = Object.freeze(['research', 'taste']);
const MAX_MESSAGE_BYTES = 256 * 1024;
const FILES_SCHEMA = { type: 'object', maxProperties: 20, additionalProperties: { type: 'string', maxLength: 120000 }, description: 'Relative file paths mapped to their UTF-8 text, such as index.html and styles.css.' };
const PHOTO_LIBRARY_SCHEMA = { type: 'array', maxItems: 200, items: { type: 'object', properties: {
  path: { type: 'string', minLength: 1, maxLength: 90 },
  tags: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 120 } },
}, required: ['path', 'tags'], additionalProperties: true },
description: 'Optional host photo library, such as the photos of culture-library.json: each photo path (library/<id>.jpg) with the tags that describe what it shows. Devices may list only these photos, each sharing a tag with the device qualities.' };
const FONT_LIBRARY_SCHEMA = { type: 'array', maxItems: 80, items: { type: 'object', properties: {
  family: { type: 'string', minLength: 1, maxLength: 60 },
  files: { type: 'array', maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 120 } },
  similarTo: { type: 'array', maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 60 } },
}, required: ['family'], additionalProperties: true },
description: 'Optional host font library, such as the families of culture-fonts.json: each family name with the relative paths of its font files (fonts/<file>.woff2). Typography may then use only these families, and conformance checks that each is loaded from its files with @font-face.' };

const QLOO_TOOLS = [
  {
    name: 'qloo_search_entities',
    description: 'Resolve cultural names to real Qloo entity IDs. Confirm ambiguous matches before using IDs. Searches the existing Qloo catalog; does not create a graph or infer a personal identity.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', minLength: 1, maxLength: 200 },
      types: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', enum: QLOO_SEARCH_TYPES } },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    }, required: ['query'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'qloo_search_tags',
    description: 'Resolve genre, interest or style names such as "ambient" or "independent film" to real Qloo tag IDs for seedTagIds. Searches the existing tag catalog only; a returned tag is a catalog match, not an audience claim.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', minLength: 1, maxLength: 200 },
      tagTypes: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 9, maxLength: 148, pattern: '^urn:tag:[a-zA-Z0-9:_-]{1,140}$' }, description: 'Optional tag namespaces, for example urn:tag:genre:media.' },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    }, required: ['query'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'qloo_get_insights',
    description: 'Retrieve cross-domain cultural neighbors grounded in resolved Qloo seed entity IDs and/or tag IDs. Exclude the seeds to surface new neighbors, cap popularity to reach lesser-known matches, or pass candidate IDs to rank an existing shortlist. Request explainability for actual seed-to-entity contribution metadata when available. Returned affinity does not score generated designs or individual enjoyment.',
    inputSchema: { type: 'object', properties: {
      seedEntityIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 160 } },
      seedTagIds: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', minLength: 9, maxLength: 168, pattern: '^urn:tag:[a-zA-Z0-9:_.-]{1,160}$' }, description: 'Resolved tag IDs from qloo_search_tags, sent as signal.interests.tags.' },
      resultType: { type: 'string', enum: QLOO_RESULT_TYPES },
      location: { type: 'string', minLength: 1, maxLength: 300 },
      candidateEntityIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 160 } },
      excludeEntityIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 160 }, description: 'Entity IDs to remove from results, usually the seeds themselves.' },
      popularityMin: { type: 'number', minimum: 0, maximum: 1 },
      popularityMax: { type: 'number', minimum: 0, maximum: 1, description: 'Maximum popularity percentile; lower values surface lesser-known neighbors.' },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
      explainability: { type: 'boolean' },
      tagTypes: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 9, maxLength: 148, pattern: '^urn:tag:[a-zA-Z0-9:_-]{1,140}$' }, description: 'Optional tag namespace filters; valid only for tag results.' },
      parentTypes: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', enum: QLOO_RESULT_TYPES.filter(type => type !== 'tag') }, description: 'Optional parent entity categories; valid only for tag results.' },
    }, required: ['resultType'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'qloo_compare_tastes',
    description: 'Perform 2–3 separate Qloo insights requests for explicit taste groups, then intersect the returned entity IDs. Each group retains its own original affinity and source record. An empty intersection only describes these bounded result lists, not incompatible people or a verified audience intersection. Consumes one API request per group.',
    inputSchema: { type: 'object', properties: {
      groups: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'object', properties: {
        id: { type: 'string', minLength: 1, maxLength: 100 },
        label: { type: 'string', minLength: 1, maxLength: 200 },
        seedEntityIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 160 } },
      }, required: ['id', 'label', 'seedEntityIds'], additionalProperties: false } },
      resultType: { type: 'string', enum: QLOO_RESULT_TYPES },
      location: { type: 'string', minLength: 1, maxLength: 300 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
      explainability: { type: 'boolean' },
      tagTypes: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', minLength: 9, maxLength: 148, pattern: '^urn:tag:[a-zA-Z0-9:_-]{1,140}$' }, description: 'Optional tag namespace filters; valid only for tag results.' },
      parentTypes: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', enum: QLOO_RESULT_TYPES.filter(type => type !== 'tag') }, description: 'Optional parent entity categories; valid only for tag results.' },
    }, required: ['groups', 'resultType'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'qloo_taste_profile',
    description: 'Taste-led design step 2. In one bounded pass (at most 24 requests), resolve named references to Qloo entities or tags, then request cross-domain neighbors that exclude the seeds, plus a lower-popularity band for brands and films. The style and aesthetic domains return Qloo tags ranked for the same seeds: the pacing and look of the films and TV the audience likes, and the aesthetic properties of what it likes, which a design translates into motion and illustration. The qualities domain costs no request: it gathers the look, mood and meaning tags Qloo returned on the measured works and keeps those two or more works share, which set palette and type. Pass your own prediction as assumption, written before calling, to mark measured entities and tags you did not expect (the surprise set) and receive required anchors for culture_validate_design_dna. Unresolved references and empty domains are reported, never filled in. Affinity does not score designs.',
    inputSchema: { type: 'object', properties: {
      references: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        role: { type: 'string', enum: REFERENCE_ROLES },
        origin: { type: 'string', enum: REFERENCE_ORIGINS },
        entityId: { type: 'string', minLength: 1, maxLength: 160 },
      }, required: ['name'], additionalProperties: false } },
      domains: { type: 'array', minItems: 1, maxItems: TASTE_LIMITS.domains, items: { type: 'string', enum: TASTE_DOMAINS }, description: `Defaults to ${DEFAULT_TASTE_DOMAINS.join(', ')}.` },
      location: { type: 'string', minLength: 1, maxLength: 300 },
      deepCuts: { type: 'boolean' },
      assumption: { type: 'object', maxProperties: 4, additionalProperties: true, description: '{schemaVersion:"1.0",audienceSummary,predictions:{domain:[3-6 real names, or 3-6 qualities for style, aesthetic and qualities]},designSketch?:{summary,palette:[3-6 hex],fonts:[1-3 families],sections:[3-8 element IDs],motifs:[1-5 phrases]}} for the same domains. The optional sketch is the design you would make from the prediction alone.' },
      knownNames: { type: 'array', maxItems: 40, items: { type: 'string', minLength: 1, maxLength: 200 }, description: 'Names already present in the brief; matching entities are not counted as surprises.' },
    }, required: ['references'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

const TASTE_CULTURE_TOOLS = [
  {
    name: 'culture_validate_design_dna',
    description: 'Taste-led design step 3. Validate a Design DNA against the taste input you received: five to ten concrete devices across at least four layers including palette and typography, each anchored to returned refs with checkable literal tokens, and every required anchor used or rejected with a reason (at most two rejections). Devices anchored to surprises name returned tags as qualities. With your frozen designSketch, surprise-anchored devices must depart from it in palette, type and structure. When the taste input has style refs, a motion device anchored to one declares its keyframes or animation; with aesthetic refs, a device anchored to one lists an inline SVG illustration in tokens.svg. Measured tags take precedence over predicted ones. With your taste reading, devices anchor only to refs it kept, each to at least one clustered ref, and required anchors it set aside count as rejected. For the generic medium, devices may also declare tokens.literals, exact strings the project contains, and motion and illustration may use any token. No network access; validates structure and links, not design quality.',
    inputSchema: { type: 'object', properties: {
      dna: { type: 'object', maxProperties: 4, additionalProperties: true },
      tasteInput: { type: 'object', maxProperties: 12, additionalProperties: true, description: 'The tasteInput object returned by qloo_taste_profile, or an equivalent host record.' },
      sketch: { type: 'object', maxProperties: 5, additionalProperties: true, description: 'The designSketch from your frozen prediction.' },
      existingIds: { type: 'array', maxItems: 200, items: { type: 'string', minLength: 1, maxLength: 120 }, description: 'Element IDs already in the starter, which do not count as new structure.' },
      library: PHOTO_LIBRARY_SCHEMA,
      fonts: FONT_LIBRARY_SCHEMA,
      reading: { type: 'object', maxProperties: 10, additionalProperties: true, description: 'Your taste reading, as saved or as culture_validate_reading returned it.' },
      medium: { type: 'string', enum: MEDIUM_IDS, description: 'web (default), app-ui or generic.' },
    }, required: ['dna', 'tasteInput'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'culture_check_dna_conformance',
    description: 'Taste-led design step 5. Check that each Design DNA device\'s declared colors, font families, CSS values, keyframes, element IDs, inline SVG illustrations, visible copy and library photo paths literally occur in the supplied files. A device that animates also needs a prefers-reduced-motion fallback and, for an endless loop, a data-motion-toggle pause control. Returns present, partial and missing devices; with a photo library it lists referenced photo paths the library does not contain, and with a font library whether each family is loaded from its files. For app-ui, each palette and typography value must also be a design token used through var(); for generic, every token is found as written. Pass files, or paths that the plugin reads from MOUSA_PROJECT_DIR. Does not judge quality, legibility or visitor preference.',
    inputSchema: { type: 'object', properties: { dna: { type: 'object', maxProperties: 8, additionalProperties: true }, files: FILES_SCHEMA, library: PHOTO_LIBRARY_SCHEMA, fonts: FONT_LIBRARY_SCHEMA,
      paths: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 200 }, description: 'Relative paths of project text files to read from MOUSA_PROJECT_DIR instead of passing files.' },
      tokensFile: { type: 'string', minLength: 1, maxLength: 200, description: 'For app-ui, the design token file among the files; defaults to the first tokens.json.' },
      medium: { type: 'string', enum: MEDIUM_IDS, description: 'web (default), app-ui or generic.' } }, required: ['dna'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'culture_compare_designs',
    description: 'Fingerprint two static designs (palette, font classes, landmark sections, CSS features) and return a bounded heuristic distance. Use repeated comparisons to separate a data-driven difference from ordinary model variance; one distance is not a quality or preference measure.',
    inputSchema: { type: 'object', properties: { a: FILES_SCHEMA, b: FILES_SCHEMA }, required: ['a', 'b'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const CULTURE_TOOLS = [
  {
    name: 'culture_assess_decision',
    description: 'Assess declared creative decision/context without network access. Returns research, reuse, clarify or skip; missing references can prompt one targeted host conversation question. Works across web, game, RPG, writing and general work, even without Qloo. The agent declares semantic relevance; this tool checks structured conditions and never authenticates imported research or scores creative quality.',
    inputSchema: { type: 'object', properties: {
      decision: { type: 'object', properties: {
        id: { type: 'string', minLength: 1, maxLength: 100 },
        domain: { type: 'string', enum: CREATIVE_DOMAINS },
        kind: { type: 'string', enum: DECISION_KINDS },
        decision: { type: 'string', minLength: 1, maxLength: 4000 },
        goal: { type: 'string', maxLength: 4000 },
        openChoice: { anyOf: [{ type: 'boolean' }, { type: 'string', minLength: 1, maxLength: 4000 }] },
        culturalQuestion: { type: 'string', maxLength: 4000 },
        expectedEffect: { type: 'string', maxLength: 4000 },
        resultTypes: { type: 'array', maxItems: 2, items: { type: 'string', enum: QLOO_RESULT_TYPES } },
        queryParameters: { type: 'object', maxProperties: 40, additionalProperties: true },
      }, required: ['kind', 'decision'], additionalProperties: false },
      context: { type: 'object', properties: {
        domain: { type: 'string', enum: CREATIVE_DOMAINS },
        referencePolicy: { type: 'string', enum: REFERENCE_POLICIES },
        references: { type: 'array', maxItems: 20, items: { type: 'object', properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          role: { type: 'string', enum: REFERENCE_ROLES },
          origin: { type: 'string', enum: REFERENCE_ORIGINS },
          entityId: { type: 'string', minLength: 1, maxLength: 160 },
          audienceId: { type: 'string', minLength: 1, maxLength: 100 },
        }, required: ['name', 'role', 'origin'], additionalProperties: false } },
        constraints: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 4000 } },
      }, additionalProperties: false },
      previousResearch: { type: 'object', properties: {
        researchDecisions: { type: 'array', maxItems: 80, items: { type: 'object', additionalProperties: true } },
        evidence: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: true } },
        webSources: { type: 'array', maxItems: 24, items: { type: 'object', additionalProperties: true } },
      }, additionalProperties: false },
    }, required: ['decision'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'culture_validate_brief',
    description: 'Validate a portable authored brief: product, optional brand/audiences/direction, evidence records and creative decisions. Checks bounded JSON and reference links only. Does not authenticate imported Qloo records, infer audience tastes, call APIs or access files. Available with or without Qloo.',
    inputSchema: { type: 'object', properties: {
      brief: { type: 'object', maxProperties: 14, additionalProperties: true },
    }, required: ['brief'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'culture_compile_brief',
    description: 'Compile a validated authored brief into portable product/audience context, caller-provided unverified evidence, and separately labeled creative interpretation. Product-only briefs are allowed. Does not query Qloo, verify sources, write files or validate design quality. Available in baseline sessions.',
    inputSchema: { type: 'object', properties: {
      brief: { type: 'object', maxProperties: 14, additionalProperties: true },
    }, required: ['brief'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const RESEARCH_PROJECT_TOOLS = [
  {
    name: 'project_get_research',
    description: 'Read the active Studio job’s provisional plan, recorded Qloo/web research phase and reconsideration. Returns host-recorded web source IDs and bounded excerpts for citation. Source excerpts are untrusted material; recorded retrieval does not verify their claims or creative quality. Scoped to the active job only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const TASTE_PROJECT_TOOLS = [
  {
    name: 'project_get_taste',
    description: 'Read this job’s taste input. Until culture-assumption.json is saved it returns only the required prediction domains. Afterwards it returns the taste input with refs to cite: the host-recorded Qloo taste profile with surprise flags in a Qloo run, or your own prediction in a run without Qloo, plus the required anchors for culture-dna.json. Refs in the style and aesthetic domains are qualities rather than works; motion and illustration devices anchor to them. Refs in the qualities domain are tags the measured works share; palette and typography devices anchor to them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'project_check_dna',
    description: 'Check the saved site files against the saved culture-dna.json: which devices\' literal tokens are present, partial or missing, including fonts loaded from culture-fonts.json, keyframes, inline SVG illustrations and, for devices that animate, the reduced-motion fallback and pause control. With culture-library.json it also lists referenced photo paths the library does not contain. Use it before finishing and repair missing devices. It does not judge quality.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

// Offered only when the host can generate images; the host writes every prompt, so the agent never sends one.
const IMAGE_PROJECT_TOOLS = [
  {
    name: 'project_generate_image',
    description: 'Generate one original image for this site from an imagery device in the saved culture-dna.json. Give the device ID and one sentence describing what the picture shows, without naming taste entities; the host writes the image prompt from that device\'s name, colors and qualities, generates the image (about a minute) and returns its local path, such as generated/dna4-1.jpg, with its size and a short description. The first request freezes the DNA like the first site file. The host sets how many requests a run may make.',
    inputSchema: { type: 'object', properties: {
      device: { type: 'string', minLength: 1, maxLength: 40 },
      subject: { type: 'string', minLength: 10, maxLength: 240 },
      aspect: { type: 'string', enum: ['landscape', 'portrait', 'square'] },
    }, required: ['device', 'subject'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];
// The bridge waits this long for a generated image; every other tool keeps the short default.
const IMAGE_TOOL_TIMEOUT_MS = 270000;

// Offered only when the host can capture the saved site for the production stages' review.
const CAPTURE_PROJECT_TOOLS = [
  {
    name: 'project_capture_review',
    description: 'Production review, after project_check_dna. Capture the saved site for your visual review: the host opens index.html in a headless browser at each view (desktop 1440x900 and mobile 390x844), as a visitor sees it, and writes one PNG a view to review/ in your working folder. target scrolls to an element ID of index.html; full captures the whole page height. Returns each capture\'s ID and path. Open every capture you cite with your read tool, then save culture-review.json for the round. The host sets how many rounds and captures a run may take.',
    inputSchema: { type: 'object', properties: {
      views: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', enum: ['desktop', 'mobile'] } },
      target: { type: 'string', minLength: 1, maxLength: 60, pattern: '^[A-Za-z][A-Za-z0-9_:=-]{0,59}$' },
      full: { type: 'boolean' },
    }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];
// A capture opens a browser and waits for the page to settle, so the bridge waits longer for it too.
const CAPTURE_TOOL_TIMEOUT_MS = 150000;

const PROJECT_TOOLS = [
  {
    name: 'project_list_files',
    description: 'List files inside the active, scoped design job only. Does not list the machine or other projects.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'project_read_file',
    description: 'Read one UTF-8 file inside the active design job by its relative path.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['path'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'project_write_file',
    description: 'Create or replace one UTF-8 artifact inside the active design job. Writes cannot leave this job. Keep creative interpretation separate from Qloo evidence.',
    inputSchema: { type: 'object', properties: {
      path: { type: 'string', minLength: 1, maxLength: 200 },
      content: { type: 'string', maxLength: 131072 },
    }, required: ['path', 'content'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

/**
 * Portable sessions get the pure taste tools; a Studio bridge replaces them with host-owned project tools.
 * The host runs the bounded taste pass itself, so qloo_taste_profile is never exposed through a bridge.
 */
export function getToolDefinitions({ includeProjectTools = false, includeQlooTools = true, protocol = 'research', imageTool = false, captureTool = false } = {}) {
  const tasteTools = [...TASTE_PROJECT_TOOLS, ...(imageTool ? IMAGE_PROJECT_TOOLS : []), ...(captureTool ? CAPTURE_PROJECT_TOOLS : [])];
  return structuredClone([
    ...CULTURE_TOOLS,
    ...(includeProjectTools ? [] : [...TASTE_CULTURE_TOOLS, ...PRODUCTION_TOOLS]),
    ...(includeQlooTools ? QLOO_TOOLS.filter(tool => !includeProjectTools || tool.name !== 'qloo_taste_profile') : []),
    ...(includeProjectTools ? [...(protocol === 'taste' ? tasteTools : RESEARCH_PROJECT_TOOLS), ...PROJECT_TOOLS] : []),
  ]);
}

/** A taste bridge whose host runs the production stages (`production`) adds their policy to the taste-led one. */
export function sessionInstructions({ includeProjectTools = false, protocol = 'research', production = false } = {}) {
  const policy = !includeProjectTools ? `${CREATIVE_POLICY_TEXT}\n${TASTE_POLICY_TEXT}\n${PRODUCTION_POLICY_TEXT}`
    : protocol === 'taste' ? (production ? `${TASTE_POLICY_TEXT}\n${PRODUCTION_POLICY_TEXT}` : TASTE_POLICY_TEXT) : CREATIVE_POLICY_TEXT;
  return `${policy}\nUse culture tools for portable authored briefs in every mode; imported evidence remains caller-provided and unverified. Project files are scoped to the active job when bridge mode is enabled.`;
}

export const toolDefinitions = getToolDefinitions();

function validate(value, schema, path = 'arguments') {
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) throw new Error(`${path}.${required} is required.`);
    if (Object.keys(value).length > (schema.maxProperties ?? Infinity)) throw new Error(`${path} contains too many fields.`);
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(schema.properties ?? {}, key)) validate(value[key], schema.properties[key], `${path}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${path} contains an unsupported field.`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validate(value[key], schema.additionalProperties, `${path}.${key}`);
    }
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) throw new Error(`${path} has an invalid string length.`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) throw new Error(`${path} has an invalid format.`);
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error(`${path} is outside the allowed integer range.`);
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new Error(`${path} is outside the allowed number range.`);
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw new Error(`${path} has an invalid array length.`);
    value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`));
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} is not a supported value.`);
}

function scopedPath(path) {
  const segments = path.replaceAll('\\', '/').split('/');
  if (/^[\/\\]/u.test(path) || /[:\u0000-\u001f]/u.test(path) || segments.some(part => !part || part === '.' || part === '..' || ['.git', '.aws', '.codex', '.agents', 'node_modules'].includes(part.toLowerCase()))) {
    throw new Error('path must be a relative artifact path inside the active job.');
  }
  return segments.join('/');
}

function toolResult(value, isError = false) {
  const structuredContent = value && typeof value === 'object' && !Array.isArray(value) ? value : { result: value };
  return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, ...(isError ? { isError: true } : {}) };
}

function toolError(code, message, retryable = false) {
  return toolResult({ status: 'error', error: { code, message, retryable } }, true);
}

function standaloneSourceResult(result) {
  if (!result || !['ok', 'empty'].includes(result.status) || !result.evidence
    || typeof result.evidence !== 'object' || Array.isArray(result.evidence)) return result;
  return { ...result, evidence: { ...result.evidence,
    id: `culture-source:${randomUUID()}`, idKind: 'application-source-record',
  } };
}

function standaloneEvidence(record) {
  if (record?.evidence && typeof record.evidence === 'object' && !Array.isArray(record.evidence)) {
    record.evidence.id = `culture-source:${randomUUID()}`;
    record.evidence.idKind = 'application-source-record';
  }
}

/**
 * `production` configures the standalone production tools: `env` (MOUSA_PROJECT_DIR and the machine checks), and for
 * tests or other hosts `inspect`, `generate` and `capture` in place of Codex and the browser.
 */
export function createToolHandler({ qlooClient, project, onEvidence, includeQlooTools = true, protocol = 'research', imageTool = false, captureTool = false, production = {} } = {}) {
  const definitions = getToolDefinitions({ includeProjectTools: Boolean(project), includeQlooTools, protocol, imageTool, captureTool });
  const productionTools = project ? null : createProductionTools(production);
  const productionEnv = production.env || process.env;
  return async function handleTool(name, argumentsValue = {}) {
    const definition = definitions.find(tool => tool.name === name);
    if (!definition) return toolError('TOOL_UNKNOWN', 'This tool is not available in the current session.');
    try { validate(argumentsValue, definition.inputSchema); }
    catch (error) { return toolError('TOOL_INPUT_INVALID', error.message); }
    if (['qloo_get_insights', 'qloo_compare_tastes'].includes(name) && argumentsValue.resultType !== 'tag'
      && (argumentsValue.tagTypes !== undefined || argumentsValue.parentTypes !== undefined)) {
      return toolError('TOOL_INPUT_INVALID', 'Tag namespace and parent category filters require tag results.');
    }
    if (name === 'qloo_get_insights' && argumentsValue.seedEntityIds === undefined && argumentsValue.seedTagIds === undefined) {
      return toolError('TOOL_INPUT_INVALID', 'Provide resolved seedEntityIds, seedTagIds or both.');
    }
    try {
      let result;
      if (name === 'qloo_search_entities' || name === 'qloo_get_insights' || name === 'qloo_search_tags') {
        if (!qlooClient) return toolError('QLOO_KEY_MISSING', 'Qloo is not configured on this server.');
        result = name === 'qloo_search_entities' ? await qlooClient.searchEntities(argumentsValue)
          : name === 'qloo_search_tags' ? await qlooClient.searchTags(argumentsValue) : await qlooClient.getInsights(argumentsValue);
        if (onEvidence) await onEvidence({ tool: name, ...result });
        else result = standaloneSourceResult(result);
      } else if (name === 'qloo_taste_profile') {
        if (!qlooClient) return toolError('QLOO_KEY_MISSING', 'Qloo is not configured on this server.');
        const domains = normalizeTasteDomains(argumentsValue.domains ?? DEFAULT_TASTE_DOMAINS);
        // The prediction is validated before any request so it cannot be written after reading the data.
        const assumption = argumentsValue.assumption === undefined ? null : normalizeTasteAssumption(argumentsValue.assumption, { domains });
        let keyMissing = false;
        const profile = await buildTasteProfile({ client: qlooClient, references: argumentsValue.references, domains, location: argumentsValue.location,
          deepCuts: argumentsValue.deepCuts ?? true, knownNames: argumentsValue.knownNames ?? [],
          onEvidence: onEvidence ? record => onEvidence(record) : async record => standaloneEvidence(record),
          onCall: async call => { if (call.error?.code === 'QLOO_KEY_MISSING') keyMissing = true; } });
        if (keyMissing) return toolError('QLOO_KEY_MISSING', 'Qloo is not configured. Add QLOO_API_KEY on the server to build a taste profile.');
        result = assumption
          ? { status: profile.status, tasteInput: compactTasteInput(tasteInputFromProfile(profile, assumption)), assumption,
            profile: { status: profile.status, domains: profile.domains, seeds: profile.seeds, results: profile.results, signature: profile.signature, calls: profile.calls, limitations: profile.limitations, createdAt: profile.createdAt },
            interpretation: profile.interpretation }
          : { status: profile.status, profile, note: 'No prediction was supplied. To separate measured signal from what you already expected, save a prediction before reading a profile and pass it as assumption.' };
      } else if (name === 'culture_validate_design_dna') {
        const input = tasteInputArgument(argumentsValue.tasteInput);
        const profile = mediumProfile(argumentsValue.medium ?? 'web');
        const sketch = argumentsValue.sketch === undefined ? undefined : normalizeDesignSketch(argumentsValue.sketch, 'sketch', { fonts: argumentsValue.fonts });
        // The reading binds the DNA: set-aside refs cannot anchor, and its set-aside required anchors count as rejected.
        const reading = argumentsValue.reading === undefined ? null : normalizeTasteReading(argumentsValue.reading, { input, medium: profile.id });
        const dna = profile.validateDna(reading ? applyReadingToDna(argumentsValue.dna, reading) : argumentsValue.dna,
          { input, sketch, existingIds: argumentsValue.existingIds ?? [], library: argumentsValue.library, fonts: argumentsValue.fonts });
        result = { status: 'valid', dna: { ...dna, ...(profile.id !== 'web' ? { medium: profile.id } : {}) },
          interpretation: 'Structure and anchor links are valid. The devices remain creative interpretation; validity does not establish design quality.' };
      } else if (name === 'culture_check_dna_conformance') {
        const profile = mediumProfile(argumentsValue.medium ?? 'web');
        if (argumentsValue.files === undefined && argumentsValue.paths === undefined) return toolError('TOOL_INPUT_INVALID', 'Pass files, or paths to read from MOUSA_PROJECT_DIR.');
        const files = argumentsValue.files ?? await readProjectFiles(await projectRoot(productionEnv), argumentsValue.paths);
        result = profile.checkConformance(profile.dnaForCheck(argumentsValue.dna), files, { library: argumentsValue.library, fonts: argumentsValue.fonts, tokensFile: argumentsValue.tokensFile });
      } else if (productionTools?.names.includes(name)) {
        result = await productionTools.handle(name, argumentsValue);
      } else if (name === 'culture_compare_designs') {
        const fingerprints = { a: designFingerprint(argumentsValue.a), b: designFingerprint(argumentsValue.b) };
        result = { status: 'compared', fingerprints, distance: compareDesignFingerprints(fingerprints.a, fingerprints.b),
          limitation: 'A single heuristic distance. Compare it with repeated same-condition distances before attributing a difference to taste data.' };
      } else if (name === 'qloo_compare_tastes') {
        if (!qlooClient) return toolError('QLOO_KEY_MISSING', 'Qloo is not configured on this server.');
        if (new Set(argumentsValue.groups.map(group => group.id)).size !== argumentsValue.groups.length
          || argumentsValue.groups.some(group => !group.id.trim() || !group.label.trim()
            || group.seedEntityIds.some(id => !/^[a-zA-Z0-9:_-]{1,160}$/u.test(id)))) {
          return toolError('TOOL_INPUT_INVALID', 'Groups need unique nonempty ids and labels and resolved Qloo seed IDs.');
        }
        const responses = await Promise.allSettled(argumentsValue.groups.map(group => qlooClient.getInsights({
            seedEntityIds: group.seedEntityIds, resultType: argumentsValue.resultType,
            location: argumentsValue.location, limit: argumentsValue.limit,
            explainability: argumentsValue.explainability,
            tagTypes: argumentsValue.tagTypes, parentTypes: argumentsValue.parentTypes,
          })));
        const groups = [], failedGroups = [];
        for (const [index, response] of responses.entries()) {
          const group = argumentsValue.groups[index];
          if (response.status === 'fulfilled') {
            const insights = onEvidence ? response.value : standaloneSourceResult(response.value);
            if (onEvidence) {
              try { await onEvidence({ tool: 'qloo_get_insights', comparisonGroupId: group.id, ...insights }); }
              catch { failedGroups.push({ id: group.id, label: group.label, error: {
                code: 'QLOO_EVIDENCE_AUDIT_FAILED', message: 'The group query succeeded but its host evidence audit failed.', retryable: false,
              } }); }
            }
            groups.push({ id: group.id, label: group.label, insights });
          } else {
            const error = response.reason;
            failedGroups.push({ id: group.id, label: group.label, error: error instanceof QlooError
              ? { code: error.code, message: error.message, retryable: error.retryable }
              : { code: 'TOOL_EXECUTION_FAILED', message: 'The group query could not complete.', retryable: false } });
          }
        }
        if (failedGroups.length) return toolResult({
          status: 'partial', comparisonComplete: false, groups, failedGroups,
          attemptedQueries: argumentsValue.groups.length,
          error: { code: 'QLOO_COMPARISON_INCOMPLETE', message: 'At least one group query or host evidence audit failed. No shared intersection was computed.', retryable: failedGroups.some(group => group.error.retryable) },
          interpretation: 'Successful queries retain their actual returned data. A failed query or host source audit prevents a complete comparison; no completed comparison is claimed.',
        }, true);
        const groupMaps = groups.map(group => new Map(group.insights.results.map(entity => [entity.entityId, entity])));
        const sharedCandidates = groups[0].insights.results.filter(entity => groupMaps.every(map => map.has(entity.entityId))).map(entity => ({
          entityId: entity.entityId, name: entity.name, type: entity.type,
          support: groups.map((group, index) => ({
            groupId: group.id,
            ...(groupMaps[index].get(entity.entityId).affinity !== undefined ? { affinity: groupMaps[index].get(entity.entityId).affinity } : {}),
            ...(group.insights.evidence.id ? { evidenceId: group.insights.evidence.id } : {}),
          })),
        }));
        result = {
          status: sharedCandidates.length ? 'ok' : 'no-shared-candidates',
          groups, sharedCandidates, apiCalls: groups.length,
          interpretation: 'Application intersection of separate bounded Qloo result lists. Original per-group affinities are preserved. This is not a compatibility score, verified audience overlap, or proof that an empty result means no common taste.',
        };
      } else if (name === 'culture_assess_decision') result = assessCreativeDecision(argumentsValue);
      else if (name === 'culture_validate_brief') result = validateCultureBrief(argumentsValue.brief);
      else if (name === 'culture_compile_brief') result = compileCultureBrief(argumentsValue.brief);
      else if (name === 'project_get_research') {
        if (typeof project.getResearch !== 'function') return toolError('PROJECT_RESEARCH_UNAVAILABLE', 'This host has no recorded research phase for the current project.');
        result = await project.getResearch();
      } else if (name === 'project_get_taste' || name === 'project_check_dna') {
        const method = name === 'project_get_taste' ? 'getTaste' : 'checkDna';
        if (typeof project[method] !== 'function') return toolError('PROJECT_TASTE_UNAVAILABLE', 'This host has no recorded taste-led phase for the current project.');
        result = await project[method]();
      } else if (name === 'project_generate_image') {
        if (typeof project.generateImage !== 'function') return toolError('PROJECT_IMAGES_UNAVAILABLE', 'This host cannot generate images for the current project.');
        result = await project.generateImage(argumentsValue);
      } else if (name === 'project_capture_review') {
        if (typeof project.captureReview !== 'function') return toolError('PROJECT_CAPTURE_UNAVAILABLE', 'This host cannot capture the current project for review.');
        result = await project.captureReview(argumentsValue);
      }
      else if (name === 'project_list_files') result = { files: await project.listFiles() };
      else if (name === 'project_read_file') {
        let path;
        try { path = scopedPath(argumentsValue.path); } catch (error) { return toolError('PROJECT_SCOPE_INVALID', error.message); }
        result = { path, content: await project.readFile(path) };
      } else if (name === 'project_write_file') {
        if (Buffer.byteLength(argumentsValue.content, 'utf8') > 131072) return toolError('TOOL_INPUT_INVALID', 'File content exceeds the 128 KiB UTF-8 limit.');
        let path;
        try { path = scopedPath(argumentsValue.path); } catch (error) { return toolError('PROJECT_SCOPE_INVALID', error.message); }
        await project.writeFile(path, argumentsValue.content);
        result = { status: 'written', path };
      }
      return toolResult(result);
    } catch (error) {
      if (error instanceof CultureBriefError) return toolResult({ status: 'invalid', error: { code: error.code, message: error.message, retryable: false }, validation: error.validation }, true);
      if (error instanceof CulturePolicyError || error instanceof TasteProtocolError) return toolError(error.code, error.message);
      if (error instanceof ProductionToolError) return toolError(error.code, error.message, error.retryable);
      if (error instanceof ProjectScopeError || error instanceof ImageRequestError) return toolError(error.code, error.message);
      if (error instanceof QlooError) return toolError(error.code, error.message, error.retryable);
      return toolError('TOOL_EXECUTION_FAILED', 'The tool could not complete. Check the active job or server status.');
    }
  };
}

function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

export async function dispatchRpc({ message, handler, includeProjectTools = false, includeQlooTools = true, protocol = 'research', imageTool = false, captureTool = false, production = false }) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return rpcError(null, -32600, 'Invalid JSON-RPC request.');
  }
  const hasId = Object.hasOwn(message, 'id');
  if (hasId && typeof message.id !== 'string' && (typeof message.id !== 'number' || !Number.isFinite(message.id))) return rpcError(null, -32600, 'Invalid request ID.');
  if (!hasId) return null;
  const { id, method } = message;
  let result;
  if (method === 'initialize') {
    if (typeof message.params?.protocolVersion !== 'string') return rpcError(id, -32602, 'protocolVersion is required.');
    result = {
      protocolVersion: PROTOCOL_VERSIONS.includes(message.params.protocolVersion) ? message.params.protocolVersion : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'culture-grounded-design', version: SERVER_VERSION },
      instructions: sessionInstructions({ includeProjectTools, protocol, production }),
    };
  } else if (method === 'ping') result = {};
  else if (method === 'tools/list') result = { tools: getToolDefinitions({ includeProjectTools, includeQlooTools, protocol, imageTool, captureTool }) };
  else if (method === 'tools/call') {
    if (typeof message.params?.name !== 'string') return rpcError(id, -32602, 'A tool name is required.');
    if (!getToolDefinitions({ includeProjectTools, includeQlooTools, protocol, imageTool, captureTool }).some(tool => tool.name === message.params.name)) {
      return { jsonrpc: '2.0', id, result: toolError('TOOL_UNKNOWN', 'This tool is not available in the current session.') };
    }
    if (typeof handler !== 'function') return rpcError(id, -32603, 'The tool handler is unavailable.');
    try { result = await handler(message.params.name, message.params.arguments ?? {}); }
    catch { return rpcError(id, -32603, 'The tool could not complete.'); }
  } else return rpcError(id, -32601, 'Method not found.');
  return { jsonrpc: '2.0', id, result };
}

export function createBridgeHandler({ baseUrl, token, fetchImpl = globalThis.fetch, timeoutMs = 25000 }) {
  let url;
  try { url = new URL('/internal/tools', baseUrl); } catch { throw new Error('The culture bridge URL is invalid.'); }
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('The culture bridge must use HTTPS or a loopback HTTP address without URL credentials.');
  }
  if (typeof token !== 'string' || !token.trim()) throw new Error('A culture bridge token is required.');
  return async (name, argumentsValue) => {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, arguments: argumentsValue }),
        signal: AbortSignal.timeout(name === 'project_generate_image' ? Math.max(timeoutMs, IMAGE_TOOL_TIMEOUT_MS) : name === 'project_capture_review' ? Math.max(timeoutMs, CAPTURE_TOOL_TIMEOUT_MS) : timeoutMs), redirect: 'error',
      });
      if (!response.ok) return toolError('BRIDGE_UNAVAILABLE', 'The active design job bridge is unavailable or rejected this session.');
      const result = await response.json();
      if (Array.isArray(result?.content)) return result;
      return toolResult(result);
    } catch { return toolError('BRIDGE_UNAVAILABLE', 'The active design job bridge could not be reached.'); }
  };
}

export async function startStdio({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  const bridge = Boolean(env.CULTURE_BRIDGE_URL);
  const includeQlooTools = !bridge || env.CULTURE_ENABLE_QLOO !== 'false';
  const protocol = bridge && env.CULTURE_PROTOCOL === 'taste' ? 'taste' : 'research';
  const imageTool = protocol === 'taste' && env.CULTURE_IMAGE_TOOL === 'true';
  // A taste bridge whose host runs the production stages, and can capture the site for their review.
  const production = protocol === 'taste' && env.CULTURE_PRODUCTION === 'true';
  const captureTool = production && env.CULTURE_CAPTURE_TOOL === 'true';
  const handler = bridge
    ? createBridgeHandler({ baseUrl: env.CULTURE_BRIDGE_URL, token: env.CULTURE_BRIDGE_TOKEN })
    : createToolHandler({ qlooClient: new QlooClient({ apiKey: env.QLOO_API_KEY, baseUrl: env.QLOO_BASE_URL || undefined }) });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let initialized = false;
  for await (const line of lines) {
    if (!line.trim()) continue;
    let response;
    if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) response = rpcError(null, -32600, 'Request exceeded the size limit.');
    else {
      let message;
      let parsed = false;
      try { message = JSON.parse(line); parsed = true; } catch { response = rpcError(null, -32700, 'Parse error.'); }
      if (parsed) {
        const validRequest = message && typeof message === 'object' && !Array.isArray(message) && message.jsonrpc === '2.0' && typeof message.method === 'string';
        if (validRequest && message.method !== 'initialize' && !initialized && Object.hasOwn(message, 'id') && message.method !== 'ping') response = rpcError(message.id, -32000, 'Initialize the MCP session first.');
        else {
          response = await dispatchRpc({ message, handler, includeProjectTools: bridge, includeQlooTools, protocol, imageTool, captureTool, production });
          if (message?.method === 'initialize' && response?.result?.protocolVersion) initialized = true;
        }
      }
    }
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}
