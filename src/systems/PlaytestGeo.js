// Coarse IP-derived geography, pre-alpha only. Never persist the raw response.
// Cache a failed attempt too, so a blocked or rate-limited endpoint stays quiet.
export const GEO_KEY = 'bb.playtest.geo.v1';
const DAY_MS = 86400000;
export function coarseGeo(data) {
  if (!data || typeof data.country_code !== 'string' || !/^[A-Z]{2}$/.test(data.country_code)) return null;
  const region = data.region_code;
  return {country:data.country_code, ...(typeof region === 'string' && /^[A-Z0-9-]{1,12}$/.test(region) ? {region} : {})};
}
export function startPlaytestGeo(win, onGeo, now = Date.now) {
  let stopped = false, controller, timer;
  const stop = () => {
    stopped = true;
    if (timer !== undefined) win.clearTimeout(timer);
    controller?.abort();
  };
  try {
    const cached = JSON.parse(win.localStorage.getItem(GEO_KEY) || 'null');
    if (cached && Number.isFinite(cached.at) && now()-cached.at >= 0 && now()-cached.at < DAY_MS) {
      const value = coarseGeo({country_code:cached.geo?.country,region_code:cached.geo?.region});
      if (value) onGeo(value);
      return stop;
    }
    // Claim today's attempt before fetching, including failures and reloads.
    // Storage-denied browsers do not make the third-party request.
    win.localStorage.setItem(GEO_KEY,JSON.stringify({at:now(),geo:null}));
    controller = new win.AbortController();
    timer = win.setTimeout(()=>controller.abort(),2500);
    Promise.resolve(win.fetch('https://ipapi.co/json/',{
      credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,
    })).then(r=>r.ok?r.json():null).then(data=>{
      if(stopped||controller.signal.aborted)return;
      const geo=coarseGeo(data);
      if(!geo)return;
      win.localStorage.setItem(GEO_KEY,JSON.stringify({at:now(),geo}));
      onGeo(geo);
    }).catch(()=>{}).finally(()=>win.clearTimeout(timer));
  } catch { stop(); }
  return stop;
}
