
// engine/nlp.js
// Lightweight Turkish NLP utilities without external dependencies

export function normalizeTr(s){
  return (s||'')
    .replace(/İ/g,'i').replace(/I/g,'ı')
    .toLowerCase()
    .replace(/\s+/g,' ')
    .replace(/bu g[uü]n/g,'bugün')
    .replace(/bugun/g,'bugün')
    .replace(/yarin/g,'yarın')
    .replace(/dun/g,'dün')
    .replace(/haftaya\s+/g,'gelecek ')
    .trim();
}

export function tokenize(s){
  return (s||'').toLowerCase()
   .normalize('NFKD')
   .replace(/[^\p{L}\p{N}\s]/gu,' ')
   .split(/\s+/).filter(Boolean);
}

// Naive suffix stripping (ultra-light stemming)
const SUFFIXES = [
  'lardan','lerden','imiz','ımız','umuz','ümüz','niz','nız','nuz','nüz',
  'leri','ları','ler','lar',
  'den','dan','ten','tan',
  'de','da','te','ta',
  'nin','nın','nun','nün','in','ın','un','ün',
  'e','a','i','ı','u','ü'
];

export function stemTR(word){
  let w = word.toLowerCase();
  for (const suf of SUFFIXES){
    if (w.length > 4 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w;
}

export function keyTokens(s){
  return tokenize(s).map(stemTR);
}

export function overlapScore(aTokens, bTokens){
  const A = new Set(aTokens);
  const B = new Set(bTokens);
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(3, Math.min(A.size, B.size));
}

// Basic synonyms map to improve intent matching
const SYN = {
  'bugün':['bugun','bu gün','şimdi'],
  'yarın':['gelecek gün','ertesi'],
  'dün':['geçen gün'],
  'saat':['zaman'],
  'gün':['günler','gündüz'],
  'tarih':['gün','ay','yıl','date'],
  'nedir':['kimdir','ne demek','tanım','anlamı'],
  'kaç':['ne kadar','sayı','adet'],
  'dönüştür':['çevir','convert','çevirir','dönüşüm'],
  'karşılaştır':['kıyasla','hangisi','daha']
};

export function expandSynonyms(text){
  const t = normalizeTr(text);
  let extra = [];
  for (const [k, arr] of Object.entries(SYN)){
    if (t.includes(k) || arr.some(a=>t.includes(a))) extra.push(k);
  }
  return t + ' ' + extra.join(' ');
}
