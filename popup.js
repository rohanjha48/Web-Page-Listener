const $ = (id) => document.getElementById(id);
let state = 'idle';

function render(s) {
  state = s.state;
  $('status').textContent = s.msg || '';
  $('status').className = s.state === 'error' ? 'error' : '';
  $('fill').style.width = s.total ? Math.round((s.i / s.total) * 100) + '%' : '0';
  const active = s.state === 'playing' || s.state === 'paused' || s.state === 'loading';
  $('pause').hidden = !active;
  $('pause').textContent = s.state === 'paused' ? 'Resume' : 'Pause';
  $('play').textContent = active ? 'Restart' : 'Read page';
}

(async () => {
  const saved = await chrome.storage.local.get({ lang: 'en', rate: 1 });
  $('lang').value = saved.lang;
  $('rate').value = saved.rate;
  render(await chrome.runtime.sendMessage({ action: 'status' }));
})();

chrome.runtime.onMessage.addListener((m) => { if (m.action === 'status') render(m.status); });

$('play').onclick = async () => {
  const lang = $('lang').value, rate = parseFloat($('rate').value);
  chrome.storage.local.set({ lang, rate });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.runtime.sendMessage({ action: 'start', tabId: tab.id, lang, rate });
};
$('pause').onclick = () => chrome.runtime.sendMessage({ action: state === 'paused' ? 'resume' : 'pause' });
$('stop').onclick = () => chrome.runtime.sendMessage({ action: 'stop' });
