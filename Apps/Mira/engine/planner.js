
// engine/planner.js
// Score-based router for intents. Each detector returns {score, kind, ...params}
export function plan(detectors, text){
  let best = null;
  for (const det of detectors){
    try{
      const out = det(text);
      if (out && typeof out.score === 'number'){
        if (!best || out.score > best.score) best = out;
      }
    }catch(e){ /* ignore detector errors */ }
  }
  return best;
}
