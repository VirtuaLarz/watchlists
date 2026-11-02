#!/bin/bash
# Publishes the latest app from GitHub to https://all-content-watchlists.web.app (run in Firebase Cloud Shell).
set -e
cd ~/wl && git pull -q
mkdir -p public && cp index.html app.js styles.css config.js genres.txt *.png public/
sed -i 's/all-content-watchlists.firebaseapp.com/all-content-watchlists.web.app/' public/config.js
# no-cache: browsers always check for the newest version of the app
echo '{"hosting":{"public":"public","headers":[{"source":"**/*.@(html|js|css)","headers":[{"key":"Cache-Control","value":"no-cache"}]},{"source":"/","headers":[{"key":"Cache-Control","value":"no-cache"}]}]},"firestore":{"rules":"firestore.rules"}}' > firebase.json
firebase deploy --only hosting,firestore:rules --project all-content-watchlists --non-interactive
