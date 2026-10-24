# Vendored libraries

## i18next.min.js

A verbatim copy of `node_modules/i18next/dist/umd/i18next.min.js` from
i18next **26.4.0**. It is loaded by a plain `<script>` tag in
`renderer/index.html` and puts `i18next` on `window`.

It lives here rather than being referenced out of `node_modules` because the
renderer has no module resolution: no bundler, no `type="module"`, and
context isolation means no `require()`. Keeping the copy inside the app also
keeps the page within its `script-src 'self'` policy.

To update it:

```sh
npm install i18next@latest
cp node_modules/i18next/dist/umd/i18next.min.js renderer/vendor/i18next.min.js
```

Then bump the version named above and run `npm test`.
