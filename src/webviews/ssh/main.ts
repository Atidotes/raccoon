import { createApp } from 'vue';
// --vscode-* 变量的兜底调色板。VS Code 注入的变量永远赢过它，Visual Studio
// 的 WebView2 里没有注入，靠这份兜底 + 宿主下发的主题切深浅（见 shared/theme.css）
import '../shared/theme.css';
import App from './App.vue';

createApp(App).mount('#app');
