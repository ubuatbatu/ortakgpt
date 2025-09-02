
// engine/math.js
// Tiny arithmetic evaluator with shunting-yard (no eval). Supports + - * / ^ and parentheses.
export function detectMathIntent(text){
  // heuristics: has at least a digit and an operator or Turkish verbs for ops
  const t = text.toLowerCase();
  const hasDigit = /\d/.test(t);
  const hasOp = /[+\-*/^]/.test(t) || /(topla|çarp|böl|çıkar)/.test(t);
  if (hasDigit && hasOp){
    // Extract a safe math expression (digits, operators, spaces, parentheses, decimal separators)
    const expr = (t.match(/[\d\.\,\s+\-*/^()]+/g)||[]).join(' ').replace(/,/g,'.');
    if (expr.trim().length>0) return { score: 0.8, kind:'math', expr: expr.trim() };
  }
  return null;
}

export function evalMathExpression(expr){
  // Tokenize
  const tokens = [];
  const re = /\s*([0-9]*\.?[0-9]+|[\+\-\*\/\^\(\)])/g;
  let m; while ((m = re.exec(expr))){ tokens.push(m[1]); }

  // Shunting-yard
  const out = [];
  const ops = [];
  const prec = { '+':1, '-':1, '*':2, '/':2, '^':3 };
  const rightAssoc = { '^': true };
  for (const tok of tokens){
    if (/^[0-9]*\.?[0-9]+$/.test(tok)){
      out.push(parseFloat(tok));
    }else if (tok in prec){
      while (ops.length){
        const top = ops[ops.length-1];
        if ((top in prec) && (prec[top] > prec[tok] || (prec[top]===prec[tok] && !rightAssoc[tok]))){
          out.push(ops.pop());
        }else break;
      }
      ops.push(tok);
    }else if (tok==='('){
      ops.push(tok);
    }else if (tok===')'){
      while (ops.length && ops[ops.length-1]!=='('){ out.push(ops.pop()); }
      if (ops.length && ops[ops.length-1]==='(') ops.pop();
    }
  }
  while (ops.length) out.push(ops.pop());

  // Evaluate RPN
  const st = [];
  for (const t of out){
    if (typeof t === 'number'){ st.push(t); }
    else {
      const b = st.pop(), a = st.pop();
      if (a===undefined || b===undefined) return null;
      switch(t){
        case '+': st.push(a+b); break;
        case '-': st.push(a-b); break;
        case '*': st.push(a*b); break;
        case '/': st.push(b===0 ? NaN : a/b); break;
        case '^': st.push(Math.pow(a,b)); break;
      }
    }
  }
  return st.length===1 ? st[0] : null;
}
