
// engine/units.js
import { normalizeTr } from './nlp.js';

const len = {
  m: 1,
  km: 1000,
  cm: 0.01,
  mm: 0.001,
  mi: 1609.344, // mil (mile)
  ft: 0.3048,   // foot
  in: 0.0254    // inch
};
const lenAliases = {
  'metre':'m','m':'m',
  'kilometre':'km','km':'km',
  'santimetre':'cm','cm':'cm',
  'milimetre':'mm','mm':'mm',
  'mil':'mi','mile':'mi',
  'fit':'ft','feet':'ft','ft':'ft',
  'inç':'in','inch':'in','in':'in'
};

const mass = { kg:1, g:0.001, lb:0.45359237 };
const massAliases = {
  'kilogram':'kg','kg':'kg',
  'gram':'g','g':'g',
  'libre':'lb','pound':'lb','lb':'lb','lbs':'lb'
};

export function detectUnitIntent(text){
  const t = normalizeTr(text);
  if (!/(kaç|ne kadar|dönüştür|çevir)/.test(t)) return null;

  // temperature special case
  if (/(c|°c|fahrenheit|f|kelvin|k)/.test(t) && /(derece|sıcaklık|°|c|f|k)/.test(t)){
    const m = t.match(/(-?\d+[.,]?\d*)\s*(c|°c|fahrenheit|f|kelvin|k)/);
    if (m){
      const val = parseFloat(m[1].replace(',','.'));
      const unit = m[2].toLowerCase();
      return { score:0.85, kind:'temp', val, unit };
    }
  }

  // length/mass generic
  const mnum = t.match(/(-?\d+[.,]?\d*)/);
  if (!mnum) return null;
  const val = parseFloat(mnum[1].replace(',','.'));
  const fromUnitWord = (t.match(/([a-zçğıöşü]{1,12})\s*$/) || [])[1]; // last word
  const anyUnit = findUnit(t);
  if (!anyUnit) return null;
  return { score:0.8, kind:'unit', val, ...anyUnit };
}

function findUnit(t){
  // try to find two units: source and target
  const words = t.split(/\s+/);
  let src=null, dst=null;
  for (let i=0;i<words.length;i++){
    const w = words[i];
    if (!src){ src = aliasToUnit(w); continue; }
    if (!dst){ const u = aliasToUnit(w); if (u) { dst = u; break; } }
  }
  // heuristics: if only src exists, infer target from question word
  if (src && !dst){
    if (t.includes('metre')||t.includes('m ')) dst='m';
    else if (t.includes('kilometre')||t.includes(' km')) dst='km';
  }
  if (src) return { src, dst };
  return null;
}

function aliasToUnit(w){
  const a = w.toLowerCase();
  if (lenAliases[a]) return lenAliases[a];
  if (massAliases[a]) return massAliases[a];
  return null;
}

export function convertUnit(val, src, dst){
  if (!dst) return null;
  if (len[src] && len[dst]){
    return val * len[src] / len[dst];
  }
  if (mass[src] && mass[dst]){
    return val * mass[src] / mass[dst];
  }
  return null;
}

export function convertTemp(val, unit){
  const u = unit.toLowerCase();
  if (u==='c' || u==='°c'){
    return { C: val, F: val*9/5+32, K: val+273.15 };
  }else if (u==='f' || u==='fahrenheit'){
    return { C: (val-32)*5/9, F: val, K: (val-32)*5/9+273.15 };
  }else if (u==='k' || u==='kelvin'){
    return { C: val-273.15, F: (val-273.15)*9/5+32, K: val };
  }
  return null;
}
