/**
 * Browser-only model preferences. localStorage is NOT a secret vault.
 * Endpoint + model persist automatically; key is persisted only when the
 * user explicitly opts in to storing it in this browser profile.
 */
export const SETTINGS_KEY='stn.model-settings.v1';
export const EMPTY_SETTINGS=Object.freeze({endpoint:'',model:'',rememberKey:false,apiKey:''});

export function loadModelSettings(storage) {
  try {
    const raw=storage?.getItem(SETTINGS_KEY);
    if (!raw) return {...EMPTY_SETTINGS};
    const value=JSON.parse(raw);
    if (!value || typeof value!=='object' || Array.isArray(value)) return {...EMPTY_SETTINGS};
    const rememberKey=value.rememberKey===true;
    return {
      endpoint:typeof value.endpoint==='string'?value.endpoint.slice(0,500):'',
      model:typeof value.model==='string'?value.model.slice(0,150):'',
      rememberKey,
      apiKey:rememberKey && typeof value.apiKey==='string'?value.apiKey.slice(0,4096):''
    };
  } catch { return {...EMPTY_SETTINGS}; }
}
export function saveModelSettings(storage,{endpoint='',model='',rememberKey=false,apiKey=''}={}) {
  const value={
    endpoint:String(endpoint).trim().slice(0,500),
    model:String(model).trim().slice(0,150),
    rememberKey:rememberKey===true
  };
  if (value.rememberKey) value.apiKey=String(apiKey).slice(0,4096);
  try { storage?.setItem(SETTINGS_KEY,JSON.stringify(value)); return true; }
  catch { return false; }
}
export function clearModelSettings(storage) {
  try { storage?.removeItem(SETTINGS_KEY); return true; }
  catch { return false; }
}
