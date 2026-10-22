/**
 * Tabler Icons 内联模块 —— 由 tools/make-icons.mjs 依据 extension/lib/tabler/*.svg 生成。
 * 请勿手工编辑；改动图标请更新 lib/tabler 下的官方文件后重新运行该脚本。
 * 以传统脚本形式输出，页面可在 <head> 中同步引入，避免图标缺失导致的布局抖动。
 */

(function (global) {
  'use strict';

  var ICONS = {
  "arrows-split-2": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M21 17h-5.397a5 5 0 0 1 -4.096 -2.133l-.514 -.734a5 5 0 0 0 -4.096 -2.133h-3.897\" />\n  <path d=\"M21 7h-5.395a5 5 0 0 0 -4.098 2.135l-.51 .73a5 5 0 0 1 -4.097 2.135h-3.9\" />\n  <path d=\"M18 10l3 -3l-3 -3\" />\n  <path d=\"M18 20l3 -3l-3 -3\" />",
  "arrows-split": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M21 17h-8l-3.5 -5h-6.5\" />\n  <path d=\"M21 7h-8l-3.495 5\" />\n  <path d=\"M18 10l3 -3l-3 -3\" />\n  <path d=\"M18 20l3 -3l-3 -3\" />",
  "chevron-down": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M6 9l6 6l6 -6\" />",
  "chevron-left": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M15 6l-6 6l6 6\" />",
  "chevron-right": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M9 6l6 6l-6 6\" />",
  "chevron-up": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M6 15l6 -6l6 6\" />",
  "chevrons-down": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M7 7l5 5l5 -5\" />\n  <path d=\"M7 13l5 5l5 -5\" />",
  "chevrons-up": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M7 11l5 -5l5 5\" />\n  <path d=\"M7 17l5 -5l5 5\" />",
  "circle-check": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\" />\n  <path d=\"M9 12l2 2l4 -4\" />",
  "external-link": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6\" />\n  <path d=\"M11 13l9 -9\" />\n  <path d=\"M15 4h5v5\" />",
  "fold-down": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M12 11v8l3 -3m-6 0l3 3\" />\n  <path d=\"M9 7l1 0\" />\n  <path d=\"M14 7l1 0\" />\n  <path d=\"M19 7l1 0\" />\n  <path d=\"M4 7l1 0\" />",
  "fold-up": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M12 13v-8l-3 3m6 0l-3 -3\" />\n  <path d=\"M9 17l1 0\" />\n  <path d=\"M14 17l1 0\" />\n  <path d=\"M19 17l1 0\" />\n  <path d=\"M4 17l1 0\" />",
  "keyboard": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M2 6m0 2a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2z\" />\n  <path d=\"M6 10l0 .01\" />\n  <path d=\"M10 10l0 .01\" />\n  <path d=\"M14 10l0 .01\" />\n  <path d=\"M18 10l0 .01\" />\n  <path d=\"M6 14l0 .01\" />\n  <path d=\"M18 14l0 .01\" />\n  <path d=\"M10 14l4 .01\" />",
  "layers-off": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M8.59 4.581c.362 -.359 .86 -.581 1.41 -.581h8a2 2 0 0 1 2 2v8c0 .556 -.227 1.06 -.594 1.422m-3.406 .578h-6a2 2 0 0 1 -2 -2v-6\" />\n  <path d=\"M16 16v2a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2h2\" />\n  <path d=\"M3 3l18 18\" />",
  "plus": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M12 5l0 14\" />\n  <path d=\"M5 12l14 0\" />",
  "refresh": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4\" />\n  <path d=\"M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4\" />",
  "settings": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z\" />\n  <path d=\"M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0\" />",
  "stack-2-filled": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M20.894 15.553a1 1 0 0 1 -.447 1.341l-8 4a1 1 0 0 1 -.894 0l-8 -4a1 1 0 0 1 .894 -1.788l7.553 3.774l7.554 -3.775a1 1 0 0 1 1.341 .447m0 -4a1 1 0 0 1 -.447 1.341l-8 4a1 1 0 0 1 -.894 0l-8 -4a1 1 0 0 1 .894 -1.788l7.552 3.775l7.554 -3.775a1 1 0 0 1 1.341 .447m-8.887 -8.552q .056 0 .111 .007l.111 .02l.086 .024l.012 .006l.012 .002l.029 .014l.05 .019l.016 .009l.012 .005l8 4a1 1 0 0 1 0 1.788l-8 4a1 1 0 0 1 -.894 0l-8 -4a1 1 0 0 1 0 -1.788l8 -4l.011 -.005l.018 -.01l.078 -.032l.011 -.002l.013 -.006l.086 -.024l.11 -.02l.056 -.005z\" />",
  "stack-2": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M12 4l-8 4l8 4l8 -4l-8 -4\" />\n  <path d=\"M4 12l8 4l8 -4\" />\n  <path d=\"M4 16l8 4l8 -4\" />",
  "trash-filled": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M20 6a1 1 0 0 1 .117 1.993l-.117 .007h-.081l-.919 11a3 3 0 0 1 -2.824 2.995l-.176 .005h-8c-1.598 0 -2.904 -1.249 -2.992 -2.75l-.005 -.167l-.923 -11.083h-.08a1 1 0 0 1 -.117 -1.993l.117 -.007h16z\" />\n  <path d=\"M14 2a2 2 0 0 1 2 2a1 1 0 0 1 -1.993 .117l-.007 -.117h-4l-.007 .117a1 1 0 0 1 -1.993 -.117a2 2 0 0 1 1.85 -1.995l.15 -.005h4z\" />",
  "trash": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M4 7l16 0\" />\n  <path d=\"M10 11l0 6\" />\n  <path d=\"M14 11l0 6\" />\n  <path d=\"M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12\" />\n  <path d=\"M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3\" />",
  "unlink": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M17 22v-2\" />\n  <path d=\"M9 15l6 -6\" />\n  <path d=\"M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464\" />\n  <path d=\"M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463\" />\n  <path d=\"M20 17h2\" />\n  <path d=\"M2 7h2\" />\n  <path d=\"M7 2v2\" />",
  "world": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\" />\n  <path d=\"M3.6 9h16.8\" />\n  <path d=\"M3.6 15h16.8\" />\n  <path d=\"M11.5 3a17 17 0 0 0 0 18\" />\n  <path d=\"M12.5 3a17 17 0 0 1 0 18\" />",
  "x": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\"/>\n  <path d=\"M18 6l-12 12\" />\n  <path d=\"M6 6l12 12\" />",
  };

  /**
   * 生成一个内联 SVG 图标。
   * @param {string} name 图标名，如 'chevron-down'
   * @param {{size?: number, className?: string}} [options]
   * @returns {string}
   */
  function icon(name, options) {
    var body = ICONS[name];
    if (!body) throw new Error('未知图标：' + name);
    var size = (options && options.size) || 18;
    var className = (options && options.className) || '';
    return [
      '<svg class="icon ' + className + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24"',
      '  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"',
      '  stroke-linejoin="round" aria-hidden="true" focusable="false">',
      body,
      '</svg>',
    ].join('');
  }

  global.TabMergeIcons = {
    ICON_SOURCE: 'Tabler Icons (MIT) - https://tabler.io/icons',
    ICONS: ICONS,
    icon: icon,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
