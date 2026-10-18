// The /onboarding page (product.md §5.8, mockup noobly-platform-onboarding-first-login): its own layout, without the
// rail or sidebar. The kit's styles, onboarding.css and one module, which draws the four steps into #onboarding.
import { html } from './html.js';

export const onboardingPage = ({ name }) => html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Getting started · NooblyJS</title>
<link rel="icon" href="/ui/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/ui/css/tokens.css">
<link rel="stylesheet" href="/ui/css/base.css">
<link rel="stylesheet" href="/ui/css/components.css">
<link rel="stylesheet" href="/css/onboarding.css">
<script type="module" src="/js/pages/onboarding/steps.js"></script>
</head>
<body class="onboarding">
<a class="skip-link" href="#onboarding-main">Skip to content</a>
<aside class="onboarding__side">
  <div class="onboarding__brand"><span class="onboarding__logo" aria-hidden="true"><span></span><span></span></span><span>noobly</span></div>
  <div class="onboarding__intro">
    <span class="onboarding__eyebrow">Getting started</span>
    <p class="onboarding__title">Set up NooblyJS around the work you actually do.</p>
    <p class="onboarding__lead">Four short steps. You can change any of this later from your profile.</p>
  </div>
  <nav aria-label="Steps" id="onboarding-steps"></nav>
  <p class="onboarding__who">Signed in as ${name}</p>
</aside>
<main class="onboarding__main" id="onboarding-main" tabindex="-1">
  <div id="onboarding"><p class="loading" role="status">Loading…</p></div>
</main>
</body>
</html>`;
