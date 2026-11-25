/**
 * @file The blocks page: the wallet's names as Blockly blocks, snapped
 * into calls, run through the same `/api` as the form page.
 * @see runStatement for what a statement on the pegboard does
 * @see BLOCKS_PAGE
 * @see BLOCKS_SCRIPT
 */

/**
 * An expression on the pegboard: a petname, a JSON literal, or a call.
 *
 * @typedef {{ pet: string } | { lit: unknown } | { call: { target: Expr, method: string, args: Expr[] } }} Expr
 */

/**
 * A statement: save an expression's answer as a name, or endow a
 * definition from the inbox with names for its slots.
 *
 * @typedef {{ save: string, expr: Expr } | { endow: number, bindings: Record<string, string>, saveAs: string }} Statement
 */

/**
 * `expr` as text, in the E() form the pegboard's call blocks show:
 * a name, JSON for data, `E(target).method(args)` for a call.
 *
 * @param {Expr} expr
 * @returns {string}
 */
export const exprText = expr =>
  'pet' in expr
    ? expr.pet
    : 'lit' in expr
      ? JSON.stringify(expr.lit)
      : `E(${exprText(expr.call.target)}).${expr.call.method}(${expr.call.args.map(exprText).join(', ')})`;

/**
 * `stmt` as text: `name = expression`, or an endowment of a definition's
 * slots.
 *
 * @param {Statement} stmt
 * @returns {string}
 */
export const statementText = stmt =>
  'save' in stmt
    ? `${stmt.save} = ${exprText(stmt.expr)}`
    : `${stmt.saveAs} = endow(#${stmt.endow}, { ${Object.entries(stmt.bindings)
        .map(([slot, name]) => (slot === name ? slot : `${slot}: ${name}`))
        .join(', ')} })`;

/**
 * Run `stmt` through `api`, the page's `/api`, one call per round trip:
 * a nested call's answer is saved under a fresh name from `fresh` when
 * it holds a reference, and those names are forgotten afterward. The
 * answer of the last call is what the statement answers.
 *
 * @param {(req: Record<string, unknown>) => Promise<Record<string, unknown>>} api
 * @param {Statement} stmt
 * @param {() => string} fresh a name not otherwise in use
 * @returns {Promise<unknown>}
 */
export const runStatement = async (api, stmt, fresh) => {
  /** @type {string[]} */
  const temps = [];
  /**
   * `expr` as the page API takes an argument: `{ "@name": … }` for a
   * reference, else plain data. `saveAs` names the outermost answer.
   *
   * @param {Expr} expr
   * @param {string} [saveAs]
   * @returns {Promise<unknown>}
   */
  const arg = async (expr, saveAs) => {
    if ('pet' in expr) return { '@name': expr.pet };
    if ('lit' in expr) return expr.lit;
    const { target, method, args } = expr.call;
    const t = await arg(target);
    if (typeof t !== 'object' || t === null || !('@name' in t))
      throw Error(`${method}: the target is data, not a reference`);
    const name = saveAs ?? fresh();
    const { answer } = await api({
      op: 'call',
      target: t['@name'],
      method,
      args: await Promise.all(args.map(a => arg(a))),
      saveAs: name,
    });
    if (
      !saveAs &&
      typeof answer === 'object' &&
      answer !== null &&
      '@name' in answer
    )
      temps.push(name);
    return answer;
  };
  try {
    if ('save' in stmt) {
      if ('call' in stmt.expr) return await arg(stmt.expr, stmt.save);
      throw Error(`save as ${stmt.save}: only a call's answer is saved`);
    }
    const { answer } = await api({
      op: 'endow',
      number: stmt.endow,
      bindings: stmt.bindings,
      saveAs: stmt.saveAs,
    });
    return answer;
  } finally {
    for (const name of temps) await api({ op: 'forget', name });
  }
};

/** Blockly 10.4.3, from cdnjs, pinned by its hash. */
const BLOCKLY = {
  src: 'https://cdnjs.cloudflare.com/ajax/libs/blockly/10.4.3/blockly.min.js',
  integrity:
    'sha384-/1qMEpeVmzE/uziwDI7/6KKVXkk47cs2W1gDbV4EZ2Y08YpcgARmvVet4dcovLIY',
};

import { HLJS_TAG, REVIEW_CSS, REVIEW_SCRIPT } from './review.js';

export const BLOCKS_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>toybox blocks</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 0; padding: 0 1em; }
  header { display: flex; gap: 1em; align-items: baseline; flex-wrap: wrap; }
  h1 { font-size: 1.3em; }
  main { display: grid; grid-template-columns: minmax(0, 1fr) 22em; gap: 1em; }
  @media (max-width: 800px) { main { grid-template-columns: minmax(0, 1fr); } }
  #pegboard { height: 70vh; min-height: 24em; border: 1px solid #ccc; }
  pre { background: #f4f4f4; padding: .5em; white-space: pre-wrap; overflow-wrap: anywhere; }
  .err { color: #a00; }
  #review h2 { font-size: 1.1em; } #review h3 { font-size: 1em; margin-bottom: .2em; }
${REVIEW_CSS}
</style>
</head>
<body>
<header><h1>toybox blocks <small id="label"></small></h1><a href="/">the form</a></header>
<p id="status">loading…</p>
<main>
<div id="pegboard"></div>
<aside>
<p>What Run will do, in order:</p>
<pre id="expr"></pre>
<button id="run" type="button">Run</button>
<pre id="log"></pre>
</aside>
</main>
<section id="review"><h2>Review</h2><p id="reviewNone">No definitions in the inbox.</p></section>
${HLJS_TAG}
<script src="${BLOCKLY.src}" integrity="${BLOCKLY.integrity}" crossorigin="anonymous"></script>
<script src="/blocks.js"></script>
</body>
</html>
`;

export const BLOCKS_SCRIPT = `'use strict';
${REVIEW_SCRIPT}
const runStatement = ${runStatement};
const exprText = ${exprText};
const statementText = ${statementText};
const $ = id => document.getElementById(id);
const api = async req => {
  const resp = await fetch('/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: localStorage.getItem('agent') ?? undefined, ...req }),
  });
  const data = await resp.json();
  if (!resp.ok) throw Error(data.error);
  return data;
};
const log = (text, bad) => {
  const line = document.createElement('div');
  line.textContent = text;
  if (bad) line.className = 'err';
  $('log').append(line);
};

const COLOUR = { pet: '#13836f', call: '#4b52c9', lit: '#b7791f', save: '#4c5566', defn: '#8c3f8f' };

const defineBlocks = (names, definitions) => {
  for (const { name, iface } of names) {
    Blockly.Blocks['pet:' + name] = {
      init() {
        this.appendDummyInput().appendField(name);
        this.setOutput(true, null);
        this.setColour(COLOUR.pet);
        this.setTooltip(iface);
      },
    };
  }
  for (const n of [0, 1, 2]) {
    Blockly.Blocks['call' + n] = {
      init() {
        // E( target ).method( args ): the target is the first socket
        this.appendValueInput('TARGET').appendField('E(');
        this.appendDummyInput().appendField(').').appendField(new Blockly.FieldTextInput('method'), 'METHOD').appendField('(');
        for (let i = 0; i < n; i += 1) this.appendValueInput('ARG' + i).appendField(i ? ',' : '');
        this.appendDummyInput().appendField(')');
        this.setInputsInline(true);
        this.setTooltip('call method on the target, with ' + n + ' argument' + (n === 1 ? '' : 's'));
        this.setOutput(true, null);
        this.setColour(COLOUR.call);
      },
    };
  }
  Blockly.Blocks.number = { init() { this.appendDummyInput().appendField(new Blockly.FieldNumber(0), 'N'); this.setOutput(true, null); this.setColour(COLOUR.lit); } };
  Blockly.Blocks.text = { init() { this.appendDummyInput().appendField(new Blockly.FieldTextInput(''), 'T'); this.setOutput(true, null); this.setColour(COLOUR.lit); } };
  Blockly.Blocks.save = {
    init() {
      this.appendValueInput('VALUE').appendField('save as').appendField(new Blockly.FieldTextInput('it'), 'NAME');
      this.setPreviousStatement(true); this.setNextStatement(true);
      this.setColour(COLOUR.save);
    },
  };
  for (const { number, from, slots } of definitions) {
    Blockly.Blocks['endow:' + number] = {
      init() {
        this.appendDummyInput().appendField('endow #' + number + ' from ' + from + ', as').appendField(new Blockly.FieldTextInput('helper'), 'NAME');
        for (const [slot, { label }] of Object.entries(slots))
          this.appendValueInput('SLOT:' + slot).appendField(slot + ': ' + label);
        this.setPreviousStatement(true); this.setNextStatement(true);
        this.setColour(COLOUR.defn);
      },
    };
  }
};

const toolboxOf = (names, definitions) => ({
  kind: 'categoryToolbox',
  contents: [
    { kind: 'category', name: 'Names', colour: COLOUR.pet, contents: names.map(({ name }) => ({ kind: 'block', type: 'pet:' + name })) },
    { kind: 'category', name: 'Calls', colour: COLOUR.call, contents: [0, 1, 2].map(n => ({ kind: 'block', type: 'call' + n })) },
    { kind: 'category', name: 'Values', colour: COLOUR.lit, contents: [{ kind: 'block', type: 'number' }, { kind: 'block', type: 'text' }] },
    { kind: 'category', name: 'Save', colour: COLOUR.save, contents: [{ kind: 'block', type: 'save' }] },
    { kind: 'category', name: 'Inbox', colour: COLOUR.defn, contents: definitions.map(({ number }) => ({ kind: 'block', type: 'endow:' + number })) },
  ],
});

const exprOf = b => {
  if (!b) throw Error('a socket is empty');
  if (b.type.startsWith('pet:')) return { pet: b.type.slice(4) };
  if (b.type === 'number') return { lit: Number(b.getFieldValue('N')) };
  if (b.type === 'text') return { lit: b.getFieldValue('T') };
  if (b.type.startsWith('call')) {
    const args = b.inputList.filter(i => i.name.startsWith('ARG')).map(i => exprOf(i.connection.targetBlock()));
    return { call: { target: exprOf(b.getInputTargetBlock('TARGET')), method: b.getFieldValue('METHOD'), args } };
  }
  throw Error('not an expression: ' + b.type);
};

const statementsOf = ws => ws.getTopBlocks(true).flatMap(top => {
  const out = [];
  for (let b = top; b; b = b.getNextBlock()) {
    if (b.type === 'save') out.push({ save: b.getFieldValue('NAME'), expr: exprOf(b.getInputTargetBlock('VALUE')) });
    else if (b.type.startsWith('endow:')) {
      const bindings = {};
      for (const i of b.inputList.filter(i => i.name.startsWith('SLOT:'))) {
        const t = i.connection.targetBlock();
        if (!t || !t.type.startsWith('pet:')) throw Error('slot ' + i.name.slice(5) + ' takes a name');
        bindings[i.name.slice(5)] = t.type.slice(4);
      }
      out.push({ endow: Number(b.type.slice(6)), bindings, saveAs: b.getFieldValue('NAME') });
    }
  }
  return out;
});

const main = async () => {
  if (!localStorage.getItem('agent')) {
    $('status').textContent = 'No agent here yet: open your link on the form page first.';
    return;
  }
  const view = await api({ op: 'view' });
  $('label').textContent = view.label + ' (' + view.kind + ')';
  const definitions = view.messages.filter(m => m.type === 'definition');
  defineBlocks(view.names, definitions);
  // what each definition would run, to read before endowing it
  $('reviewNone').hidden = definitions.length > 0;
  for (const { number, from, slots, modules } of definitions) {
    const h = document.createElement('h3');
    h.textContent = '#' + number + ' from ' + from + ': asks for ' + Object.entries(slots).map(([k, { label }]) => k + ' (' + label + ')').join(', ');
    $('review').append(h, ...Object.entries(modules).map(([path, source]) => sourceView(path, source)));
  }
  const ws = Blockly.inject('pegboard', {
    toolbox: toolboxOf(view.names, definitions),
    renderer: 'zelos',
    grid: { spacing: 24, length: 2, colour: '#e3e6ee', snap: true },
    zoom: { wheel: true },
    sounds: false,
    trashcan: false,
  });
  $('status').textContent = 'Drag names and calls onto the pegboard, then Run.';
  // the pegboard as text, as it changes, so it's read before it's run
  const showText = () => {
    try {
      const lines = statementsOf(ws).map(statementText);
      $('expr').textContent = lines.length ? lines.join('\\n') : '(nothing yet: a save as or endow block starts a statement)';
      $('expr').className = '';
    } catch (e) {
      $('expr').textContent = e.message;
      $('expr').className = 'err';
    }
  };
  ws.addChangeListener(ev => { if (!ev.isUiEvent) showText(); });
  showText();
  let n = 0;
  const fresh = () => '_blocks' + Date.now().toString(36) + (n += 1);
  $('run').addEventListener('click', async () => {
    $('log').textContent = '';
    try {
      for (const stmt of statementsOf(ws)) {
        const answer = await runStatement(api, stmt, fresh);
        log(('save' in stmt ? stmt.save : stmt.saveAs) + ' ← ' + JSON.stringify(answer));
      }
    } catch (e) {
      log(e.message, true);
    }
  });
};
main().catch(e => { $('status').textContent = e.message; $('status').className = 'err'; });
`;
