import DefaultTheme from 'vitepress/theme'
import { useRoute } from 'vitepress'
import { onMounted, watch } from 'vue'

// Anonymous website page counts only; never bundled with the distributed tool.
function trackPageView() {
  if (location.hostname !== "webkubor.github.io" || !location.pathname.startsWith("/vite-plugin-agent-eyes/") || navigator.doNotTrack === '1') return;
  try {
    if (localStorage.getItem('core-analytics') === 'off' || localStorage.getItem('vite-plugin-agent-eyes-analytics') === 'off') return;
    void fetch('https://api.webkubor.online/v1/analytics/events', {
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
      headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(3000),
      body: JSON.stringify({ project: 'vite-plugin-agent-eyes', event_id: crypto.randomUUID(), event: 'page.view', properties: {} }),
    }).catch(() => {});
  } catch { /* Measurement must never interrupt browsing. */ }
}

export default {
  extends: DefaultTheme,
  setup() {
    const route = useRoute()
    onMounted(() => {
      trackPageView()
      watch(() => route.path, trackPageView)
    })
  },
}
