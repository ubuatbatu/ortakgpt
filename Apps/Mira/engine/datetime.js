
// engine/datetime.js
import { normalizeTr, tokenize } from './nlp.js';

export const TR_DAYS = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
export const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

function parseDayName(t){
  const map = {
    'pazar':0,'pazartesi':1,'salı':2,'sali':2,'çarşamba':3,'carsamba':3,
    'perşembe':4,'persembe':4,'cuma':5,'cumartesi':6
  };
  for (const [k,v] of Object.entries(map)){
    if (t.includes(k)) return v;
  }
  return null;
}

export function detectDateTimeIntent(raw){
  const t0 = normalizeTr(raw);
  const t = t0;
  const has = (x)=>t.includes(x);
  const ask = /(ne|hangi|kaç)/.test(t);
  const when = has('yarın') ? 'tomorrow' : has('dün') ? 'yesterday' : 'today';

  // explicit day name (e.g., "haftaya salı günlerden ne")
  const dayName = parseDayName(t);
  if (dayName!==null && (has('hangi gün') || has('günlerden') || has('haftaya') || has('gelecek'))){
    return { score:0.95, kind:'dow_of_next', day:dayName };
  }

  if ((has('günlerden') && (has('bugün')||has('yarın')||has('dün')||ask)) || has('hangi gün') || has('ne gün')){
    return { score: 0.92, kind:'dow', when };
  }
  if (has('tarih') || /bug[uü]n.*(tarih|kaç|hangi)/.test(t)){
    return { score: 0.9, kind:'date', when };
  }
  if (has('saat kaç') || /^saat[?]?$/.test(t) || (has('şimdi') && has('saat'))){
    return { score: 0.9, kind:'time', when:'now' };
  }
  // date difference: "X'e kaç gün kaldı", "X'e kaç gün var"
  if (/kaç gün (kaldı|var)/.test(t)){
    return { score: 0.9, kind:'daydiff' };
  }
  return null;
}

export function applyWhen(baseDate, when){
  const d = new Date(baseDate);
  if (when==='tomorrow') d.setDate(d.getDate()+1);
  else if (when==='yesterday') d.setDate(d.getDate()-1);
  return d;
}

export function nextWeekday(weekday){
  const now = new Date();
  const d = new Date(now);
  const delta = (7 + weekday - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d;
}

export function parseDateTR(text){
  const t = normalizeTr(text);
  // YYYY-MM-DD
  let m = t.match(/(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (m){
    const y = +m[1], mo = +m[2]-1, d = +m[3];
    const dt = new Date(y, mo, d);
    if (!isNaN(dt)) return dt;
  }
  // DD/MM/YYYY or DD.MM.YYYY
  m = t.match(/(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})/);
  if (m){
    const d = +m[1], mo = +m[2]-1, y = +m[3];
    const dt = new Date(y, mo, d);
    if (!isNaN(dt)) return dt;
  }
  // "18 ağustos 2025"
  const months = TR_MONTHS.map(s=>s.toLowerCase());
  m = t.match(/(\d{1,2})\s+([a-zçğıöşü]+)\s+(\d{4})/);
  if (m){
    const d = +m[1], name = m[2], y = +m[3];
    const idx = months.findIndex(mn => mn===name);
    if (idx>=0){ const dt = new Date(y, idx, d); if (!isNaN(dt)) return dt; }
  }
  if (t.includes('yarın')) return applyWhen(new Date(),'tomorrow');
  if (t.includes('dün')) return applyWhen(new Date(),'yesterday');
  if (t.includes('bugün')) return new Date();
  return null;
}

export function formatDateTR(d){
  const day = d.getDate();
  const month = TR_MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const w = TR_DAYS[d.getDay()];
  return `${day} ${month} ${year} ${w}`;
}
