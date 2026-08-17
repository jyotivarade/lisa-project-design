/* ============================================================
   expr.js — Safe arithmetic expression compiler for custom rules.
   No eval / no Function constructor. Recursive-descent parser over a
   whitelisted grammar: numbers, [Field References], + - * / % ^, parens
   and a fixed set of math functions.
   ============================================================ */
(function (global) {
  'use strict';

  var FUNCS = {
    abs: function (a) { return Math.abs(a); },
    round: function (a, d) { var p = Math.pow(10, d === undefined ? 0 : d); return Math.round(a * p) / p; },
    floor: function (a) { return Math.floor(a); },
    ceil: function (a) { return Math.ceil(a); },
    sqrt: function (a) { return Math.sqrt(a); },
    min: function () { return Math.min.apply(null, arguments); },
    max: function () { return Math.max.apply(null, arguments); },
    pow: function (a, b) { return Math.pow(a, b); },
    avg: function () { return U.sum(Array.prototype.slice.call(arguments)) / arguments.length; }
  };
  var FUNC_NAMES = Object.keys(FUNCS);

  function ExprError(msg, pos) { this.name = 'ExprError'; this.message = msg; this.pos = pos; }
  ExprError.prototype = Object.create(Error.prototype);

  /* ---------- tokenizer ---------- */
  function tokenize(src) {
    var t = [], i = 0, s = String(src);
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '[') {
        var close = s.indexOf(']', i);
        if (close === -1) throw new ExprError('Unclosed field reference — missing "]"', i);
        t.push({ k: 'field', v: s.slice(i + 1, close).trim(), p: i });
        i = close + 1; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        var m = /^[0-9]*\.?[0-9]+/.exec(s.slice(i));
        t.push({ k: 'num', v: parseFloat(m[0]), p: i }); i += m[0].length; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        var mi = /^[A-Za-z_][A-Za-z0-9_ ]*/.exec(s.slice(i));
        var raw = mi[0], name = raw.trim();
        // trailing "(" (ignoring spaces) → function call, else a bare field name
        var after = s.slice(i + raw.length).replace(/^\s*/, '');
        t.push({ k: after[0] === '(' ? 'func' : 'field', v: name, p: i });
        i += raw.length; continue;
      }
      if ('+-*/%^(),'.indexOf(c) > -1) { t.push({ k: 'op', v: c, p: i }); i++; continue; }
      throw new ExprError('Unexpected character "' + c + '"', i);
    }
    return t;
  }

  /* ---------- parser ---------- */
  function parse(src) {
    var toks = tokenize(src), pos = 0;
    function peek() { return toks[pos]; }
    function isOp(v) { var t = peek(); return t && t.k === 'op' && t.v === v; }
    function eat(v) { if (!isOp(v)) throw new ExprError('Expected "' + v + '"', peek() ? peek().p : src.length); pos++; }

    function parseExpr() {
      var node = parseTerm();
      while (isOp('+') || isOp('-')) { var op = toks[pos++].v; node = { k: 'bin', op: op, a: node, b: parseTerm() }; }
      return node;
    }
    function parseTerm() {
      var node = parseUnary();
      while (isOp('*') || isOp('/') || isOp('%')) { var op = toks[pos++].v; node = { k: 'bin', op: op, a: node, b: parseUnary() }; }
      return node;
    }
    function parseUnary() {
      if (isOp('-')) { pos++; return { k: 'neg', a: parseUnary() }; }
      if (isOp('+')) { pos++; return parseUnary(); }
      return parsePower();
    }
    function parsePower() {
      var base = parsePrimary();
      if (isOp('^')) { pos++; return { k: 'bin', op: '^', a: base, b: parseUnary() }; }
      return base;
    }
    function parsePrimary() {
      var t = peek();
      if (!t) throw new ExprError('Unexpected end of expression', src.length);
      if (t.k === 'num') { pos++; return { k: 'num', v: t.v }; }
      if (t.k === 'field') { pos++; return { k: 'field', v: t.v, p: t.p }; }
      if (t.k === 'func') {
        pos++;
        var name = t.v.toLowerCase();
        if (FUNC_NAMES.indexOf(name) === -1) throw new ExprError('Unknown function "' + t.v + '"', t.p);
        eat('(');
        var args = [];
        if (!isOp(')')) {
          args.push(parseExpr());
          while (isOp(',')) { pos++; args.push(parseExpr()); }
        }
        eat(')');
        return { k: 'call', name: name, args: args };
      }
      if (t.k === 'op' && t.v === '(') { pos++; var e = parseExpr(); eat(')'); return e; }
      throw new ExprError('Unexpected token "' + t.v + '"', t.p);
    }

    var ast = parseExpr();
    if (pos < toks.length) throw new ExprError('Unexpected token "' + toks[pos].v + '"', toks[pos].p);
    return ast;
  }

  /* ---------- evaluation ---------- */
  function refsOf(ast, acc) {
    acc = acc || [];
    if (!ast || typeof ast !== 'object') return acc;
    if (ast.k === 'field' && acc.indexOf(ast.v) === -1) acc.push(ast.v);
    ['a', 'b'].forEach(function (k) { if (ast[k]) refsOf(ast[k], acc); });
    (ast.args || []).forEach(function (n) { refsOf(n, acc); });
    return acc;
  }

  function resolveField(name, record, fieldNames) {
    if (record && Object.prototype.hasOwnProperty.call(record, name)) return record[name];
    var lower = String(name).toLowerCase();
    var hit = (fieldNames || (record ? Object.keys(record) : [])).filter(function (f) {
      return String(f).toLowerCase() === lower;
    })[0];
    if (hit !== undefined && record) return record[hit];
    return undefined;
  }

  function evalAst(ast, record, fieldNames) {
    switch (ast.k) {
      case 'num': return ast.v;
      case 'neg': return -evalAst(ast.a, record, fieldNames);
      case 'field': {
        var raw = resolveField(ast.v, record, fieldNames);
        if (raw === undefined) throw new ExprError('Unknown field "' + ast.v + '"', ast.p);
        if (U.isBlank(raw)) throw new ExprError('Field "' + ast.v + '" is empty');
        var n = U.toNumber(raw);
        if (isNaN(n)) {
          if (U.isBoolLike(raw)) return U.toBool(raw) ? 1 : 0;
          throw new ExprError('Field "' + ast.v + '" is not numeric ("' + raw + '")');
        }
        return n;
      }
      case 'call': {
        var args = ast.args.map(function (a) { return evalAst(a, record, fieldNames); });
        return FUNCS[ast.name].apply(null, args);
      }
      case 'bin': {
        var a = evalAst(ast.a, record, fieldNames), b = evalAst(ast.b, record, fieldNames);
        switch (ast.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': if (b === 0) throw new ExprError('Division by zero'); return a / b;
          case '%': if (b === 0) throw new ExprError('Modulo by zero'); return a % b;
          case '^': return Math.pow(a, b);
        }
        throw new ExprError('Unsupported operator "' + ast.op + '"');
      }
    }
    throw new ExprError('Malformed expression');
  }

  /**
   * compile(src, fieldNames) → {ok, ast, refs, error}
   * Validates syntax and that every referenced field exists.
   */
  function compile(src, fieldNames) {
    if (U.isBlank(src)) return { ok: false, error: 'Expression is empty' };
    var ast;
    try { ast = parse(src); }
    catch (e) { return { ok: false, error: e.message }; }
    var refs = refsOf(ast);
    if (fieldNames && fieldNames.length) {
      var lower = fieldNames.map(function (f) { return String(f).toLowerCase(); });
      var bad = refs.filter(function (r) { return lower.indexOf(String(r).toLowerCase()) === -1; });
      if (bad.length) {
        return { ok: false, error: 'Unknown field' + (bad.length > 1 ? 's' : '') + ': ' + bad.map(function (b) { return '[' + b + ']'; }).join(', ') };
      }
    }
    return { ok: true, ast: ast, refs: refs };
  }

  /** evaluate(src|compiled, record, fieldNames) → {ok, value, error} */
  function evaluate(srcOrCompiled, record, fieldNames) {
    var c = typeof srcOrCompiled === 'string' ? compile(srcOrCompiled, fieldNames) : srcOrCompiled;
    if (!c.ok) return { ok: false, error: c.error };
    try { return { ok: true, value: evalAst(c.ast, record, fieldNames) }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  global.Expr = {
    compile: compile, evaluate: evaluate, parse: parse, refsOf: refsOf,
    FUNC_NAMES: FUNC_NAMES,
    COMPARATORS: [
      { op: '<=', label: '≤  less than or equal' },
      { op: '<', label: '<  less than' },
      { op: '>=', label: '≥  greater than or equal' },
      { op: '>', label: '>  greater than' },
      { op: '==', label: '=  equal to' },
      { op: '!=', label: '≠  not equal to' }
    ],
    compare: function (a, op, b) {
      switch (op) {
        case '<=': return a <= b;
        case '<': return a < b;
        case '>=': return a >= b;
        case '>': return a > b;
        case '==': return Math.abs(a - b) < 1e-9;
        case '!=': return Math.abs(a - b) >= 1e-9;
      }
      return false;
    }
  };
}(typeof window !== 'undefined' ? window : this));
