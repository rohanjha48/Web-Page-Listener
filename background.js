// Page Listener - background service worker
// Flow: extract page text -> split into chunks -> translate each chunk -> speak with chrome.tts

const TTS_LANG = {
  en: 'en-US', hi: 'hi-IN', kn: 'kn-IN', ta: 'ta-IN', te: 'te-IN', ml: 'ml-IN',
  mr: 'mr-IN', bn: 'bn-IN', gu: 'gu-IN', pa: 'pa-IN', ur: 'ur-PK',
  es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ar: 'ar-SA', 'zh-CN': 'zh-CN',
  ja: 'ja-JP', ko: 'ko-KR', pt: 'pt-BR', ru: 'ru-RU'
};

let S = { state: 'idle', i: 0, total: 0, msg: '' };
let token = 0; // bumps on every start/stop so stale callbacks stop themselves

function setState(patch) {
  S = { ...S, ...patch };
  chrome.runtime.sendMessage({ action: 'status', status: S }).catch(() => {});
}

// Runs inside the web page
function extractText() {
  const lang = document.documentElement.lang || '';
  const sel = String(getSelection()).trim();
  if (sel.length > 20) return { text: sel, lang, source: 'selection' };

  const root =
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('[role=main]') ||
    document.body;
  const skip = 'nav,header,footer,aside,form,script,style,noscript,[role=navigation],[aria-hidden=true]';
  const parts = [document.title];
  root.querySelectorAll('h1,h2,h3,h4,p,li').forEach((el) => {
    if (el.closest(skip)) return;
    const t = el.innerText.trim();
    if (t.length > 1) parts.push(t);
  });
  return { text: parts.join('\n'), lang, source: 'page' };
}

function chunk(text, max = 350) {
  const sentences = text.match(/[^.!?।\n]+[.!?।]?\s*/g) || [text];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur + s).length > max) { out.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function translate(text, target) {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
    encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(text);
  const r = await fetch(url);
  if (!r.ok) throw new Error('translate ' + r.status);
  const j = await r.json();
  return j[0].map((s) => s[0]).join('');
}

function speak(text, lang, rate, my) {
  return new Promise((resolve) => {
    chrome.tts.speak(text, {
      lang, rate,
      onEvent: (e) => {
        if (my !== token) return resolve(false);
        if (e.type === 'end') resolve(true);
        else if (e.type === 'error') {
          setState({ state: 'error', msg: e.errorMessage || 'Speech error.' });
          resolve(false);
        } else if (e.type === 'interrupted' || e.type === 'cancelled') resolve(false);
      }
    });
  });
}

async function start({ tabId, lang, rate }) {
  const my = ++token;
  chrome.tts.stop();
  setState({ state: 'loading', i: 0, total: 0, msg: 'Reading the page…' });

  let data;
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: extractText });
    data = result;
  } catch (e) {
    return setState({ state: 'error', msg: "Chrome doesn't allow reading this page. Try a normal website." });
  }
  if (!data || !data.text || data.text.length < 20) {
    return setState({ state: 'error', msg: 'No readable text found on this page.' });
  }

  const ttsLang = TTS_LANG[lang] || lang;
  const voices = await chrome.tts.getVoices();
  const prefix = ttsLang.slice(0, 2).toLowerCase();
  if (!voices.some((v) => v.lang && v.lang.toLowerCase().startsWith(prefix))) {
    return setState({
      state: 'error',
      msg: 'No voice installed for this language. Add one in your computer’s speech settings, or pick another language.'
    });
  }

  const chunks = chunk(data.text);
  const sameLang = (data.lang || '').toLowerCase().startsWith(prefix);
  const prep = (t) => (sameLang ? Promise.resolve(t) : translate(t, lang));

  setState({ state: 'playing', total: chunks.length, i: 0, msg: data.source === 'selection' ? 'Reading your selection' : 'Reading the page' });

  let next = prep(chunks[0]);
  next.catch(() => {});
  for (let i = 0; i < chunks.length; i++) {
    if (my !== token) return;
    let text;
    try { text = await next; } catch (e) {
      return setState({ state: 'error', msg: 'Translation failed. Check your internet connection.' });
    }
    if (i + 1 < chunks.length) { next = prep(chunks[i + 1]); next.catch(() => {}); } // prefetch
    if (my !== token) return;
    setState({ i: i + 1 });
    if (!(await speak(text, ttsLang, rate, my))) return;
  }
  if (my === token) setState({ state: 'idle', msg: 'Finished.' });
}

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m.action === 'start') start(m);
  else if (m.action === 'pause') { chrome.tts.pause(); setState({ state: 'paused' }); }
  else if (m.action === 'resume') { chrome.tts.resume(); setState({ state: 'playing' }); }
  else if (m.action === 'stop') { token++; chrome.tts.stop(); setState({ state: 'idle', i: 0, total: 0, msg: '' }); }
  else if (m.action === 'status') reply(S);
});
