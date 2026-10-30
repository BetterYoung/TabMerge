/** Shared hover and keyboard tooltips for compact icon actions. */
(function (global) {
  'use strict';

  function init() {
    if (document.getElementById('action-tooltip')) return;

    const tooltip = document.createElement('div');
    tooltip.id = 'action-tooltip';
    tooltip.className = 'action-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.append(tooltip);

    let activeButton = null;
    const hide = (button) => {
      if (button && button !== activeButton) return;
      activeButton = null;
      tooltip.hidden = true;
    };
    const show = (button) => {
      if (!button?.dataset.tooltip) return;
      activeButton = button;
      button.setAttribute('aria-describedby', tooltip.id);
      tooltip.textContent = button.dataset.tooltip;
      tooltip.hidden = false;
      tooltip.style.left = '0px';
      tooltip.style.top = '0px';

      const anchor = button.getBoundingClientRect();
      const tip = tooltip.getBoundingClientRect();
      const left = Math.max(6, Math.min(anchor.left + (anchor.width - tip.width) / 2, innerWidth - tip.width - 6));
      const above = anchor.top - tip.height - 6;
      const top = above >= 6 ? above : Math.max(6, Math.min(anchor.bottom + 6, innerHeight - tip.height - 6));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };
    const target = (node) => node instanceof Element ? node.closest('[data-tooltip]') : null;

    document.querySelectorAll('[data-tooltip]').forEach((button) => {
      button.setAttribute('aria-describedby', tooltip.id);
    });
    document.addEventListener('pointerover', (event) => {
      const button = target(event.target);
      if (button && !button.contains(event.relatedTarget)) show(button);
    });
    document.addEventListener('pointerout', (event) => {
      const button = target(event.target);
      if (button && !button.contains(event.relatedTarget)) hide(button);
    });
    document.addEventListener('focusin', (event) => show(target(event.target)));
    document.addEventListener('focusout', (event) => hide(target(event.target)));
    document.addEventListener('scroll', () => hide(), true);
    window.addEventListener('resize', () => hide());
  }

  global.TabMergeTooltips = { init };
})(globalThis);
